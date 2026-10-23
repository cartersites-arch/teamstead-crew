/**
 * Deterministic-shape software WebAuthn credential for isolated server tests.
 *
 * Uses a real, freshly generated ES256 P-256 key pair, a minimal CBOR encoder,
 * and a `none` attestation. No browser, network, application code, or database.
 * One instance represents one credential; create another instance for another
 * device/account. The key and credential ID stay stable across ceremonies.
 *
 *   const device = new SoftwareAuthenticator({ origin });
 *   const registrationJSON = device.register(registrationOptions);
 *   const assertionJSON = device.authenticate(authenticationOptions);
 *   const serverCredential = device.credential; // id/publicKey/counter/transports
 *
 * register() binds the normal RP ID and user handle from the server options.
 * The server should keep the credential/counter returned by its verifier.
 * The fixture's counter models the authenticator's counter, which advances even
 * when a generated assertion is rejected or never reaches the server.
 *
 * Common response overrides (register/authenticate):
 *   origin, rpId, rpIdHash (32-byte Buffer/Uint8Array or base64url string),
 *   challenge, type, crossOrigin, userPresent/up/UP, userVerified/uv/UV,
 *   flags (exact byte), credentialId, id, rawId, counter,
 *   clientDataJSON (raw bytes), clientExtensionResults.
 * Authentication additionally supports:
 *   userHandle (base64url/bytes/null), signature (raw bytes),
 *   signatureTamper/tamperSignature (boolean), advanceCounter (default true).
 *
 * Identity overrides affect the emitted response only, leaving the canonical
 * credential ID/key mapping intact. To register a particular canonical ID,
 * supply credentialId to the constructor. Registration always records the
 * server options' user.id; use an authentication userHandle override to test
 * a response that names a different account.
 */

import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';

const hasOwn = (object, name) => Object.prototype.hasOwnProperty.call(object, name);
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export function base64url(value) {
  return bytes(value).toString('base64url');
}

/** Strings at binary boundaries are base64url; use Buffer.from(s) for UTF-8. */
export function bytes(value, label = 'value') {
  if (typeof value === 'string') return Buffer.from(value, 'base64url');
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  }
  throw new TypeError(`${label} must be base64url text or binary bytes`);
}

function uint(value, max, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${label} must be an integer from 0 through ${max}`);
  }
  return value;
}

function cborHead(majorType, length) {
  uint(length, Number.MAX_SAFE_INTEGER, 'CBOR length');
  if (length < 24) return Buffer.from([(majorType << 5) | length]);
  if (length <= 0xff) return Buffer.from([(majorType << 5) | 24, length]);
  if (length <= 0xffff) {
    const encoded = Buffer.alloc(3);
    encoded[0] = (majorType << 5) | 25;
    encoded.writeUInt16BE(length, 1);
    return encoded;
  }
  if (length <= 0xffffffff) {
    const encoded = Buffer.alloc(5);
    encoded[0] = (majorType << 5) | 26;
    encoded.writeUInt32BE(length, 1);
    return encoded;
  }
  const encoded = Buffer.alloc(9);
  encoded[0] = (majorType << 5) | 27;
  encoded.writeBigUInt64BE(BigInt(length), 1);
  return encoded;
}

/** Minimal definite-length CBOR, including integer-keyed COSE maps. */
export function encodeCBOR(value) {
  if (value === null) return Buffer.from([0xf6]);
  if (value === false) return Buffer.from([0xf4]);
  if (value === true) return Buffer.from([0xf5]);
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  }
  if (typeof value === 'string') {
    const text = Buffer.from(value, 'utf8');
    return Buffer.concat([cborHead(3, text.length), text]);
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    const binary = bytes(value);
    return Buffer.concat([cborHead(2, binary.length), binary]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([cborHead(4, value.length), ...value.map(encodeCBOR)]);
  }
  if (value instanceof Map) {
    return Buffer.concat([
      cborHead(5, value.size),
      ...Array.from(value, ([key, entry]) => [encodeCBOR(key), encodeCBOR(entry)]).flat(),
    ]);
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return encodeCBOR(new Map(Object.entries(value)));
  }
  throw new TypeError(`Unsupported CBOR value: ${String(value)}`);
}

function overrideFlag(overrides, names, fallback) {
  for (const name of names) {
    if (hasOwn(overrides, name)) return Boolean(overrides[name]);
  }
  return fallback;
}

function ceremonyFlags(overrides, registration) {
  if (hasOwn(overrides, 'flags')) return uint(overrides.flags, 0xff, 'flags');
  return (overrideFlag(overrides, ['userPresent', 'up', 'UP'], true) ? FLAG_UP : 0)
    | (overrideFlag(overrides, ['userVerified', 'uv', 'UV'], true) ? FLAG_UV : 0)
    | (registration ? FLAG_AT : 0);
}

function clientData(options, overrides, expectedType, defaultOrigin) {
  if (hasOwn(overrides, 'clientDataJSON')) return bytes(overrides.clientDataJSON, 'clientDataJSON');
  const challenge = hasOwn(overrides, 'challenge') ? overrides.challenge : options.challenge;
  if (typeof challenge !== 'string') throw new TypeError('challenge must be base64url text');
  const data = {
    type: hasOwn(overrides, 'type') ? overrides.type : expectedType,
    challenge,
    origin: hasOwn(overrides, 'origin') ? overrides.origin : defaultOrigin,
    crossOrigin: hasOwn(overrides, 'crossOrigin') ? overrides.crossOrigin : false,
  };
  if (hasOwn(overrides, 'topOrigin')) data.topOrigin = overrides.topOrigin;
  return Buffer.from(JSON.stringify(data), 'utf8');
}

function rpHash(rpId, overrides) {
  if (hasOwn(overrides, 'rpIdHash') || hasOwn(overrides, 'rpHash')) {
    const hash = bytes(overrides.rpIdHash ?? overrides.rpHash, 'rpIdHash');
    if (hash.length !== 32) throw new RangeError('rpIdHash must contain exactly 32 bytes');
    return hash;
  }
  const actualRpId = hasOwn(overrides, 'rpId') ? overrides.rpId : rpId;
  if (typeof actualRpId !== 'string' || !actualRpId) throw new TypeError('rpId must be nonempty text');
  return createHash('sha256').update(actualRpId, 'utf8').digest();
}

function counterBytes(counter) {
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32BE(uint(counter, 0xffffffff, 'counter'));
  return encoded;
}

function responseIdentity(canonicalId, overrides) {
  const emittedId = hasOwn(overrides, 'credentialId')
    ? base64url(overrides.credentialId)
    : canonicalId;
  return {
    id: hasOwn(overrides, 'id') ? overrides.id : emittedId,
    rawId: hasOwn(overrides, 'rawId') ? overrides.rawId : emittedId,
    credentialBytes: Buffer.from(emittedId, 'base64url'),
  };
}

export class SoftwareAuthenticator {
  #privateKey;
  #publicKeyObject;
  #credentialId;
  #cosePublicKey;
  #publicKeySPKI;
  #counter;

  constructor({
    origin = 'https://project-room.test',
    rpId = null,
    userHandle = null,
    credentialId = randomBytes(32),
    counter = 0,
    aaguid = Buffer.alloc(16),
    transports = ['internal'],
  } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    this.#privateKey = privateKey;
    this.#publicKeyObject = publicKey;
    this.#credentialId = bytes(credentialId, 'credentialId');
    if (!this.#credentialId.length || this.#credentialId.length > 0xffff) {
      throw new RangeError('credentialId must contain from 1 through 65535 bytes');
    }
    this.#cosePublicKey = encodeCBOR(new Map([
      [1, 2],                 // kty: EC2
      [3, -7],                // alg: ES256
      [-1, 1],                // crv: P-256
      [-2, bytes(jwk.x)],      // x coordinate
      [-3, bytes(jwk.y)],      // y coordinate
    ]));
    this.#publicKeySPKI = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }));
    this.#counter = uint(counter, 0xffffffff, 'counter');
    this.origin = origin;
    this.rpId = rpId;
    this.userHandle = userHandle === null ? null : base64url(userHandle);
    this.aaguid = bytes(aaguid, 'aaguid');
    if (this.aaguid.length !== 16) throw new RangeError('aaguid must contain exactly 16 bytes');
    this.transports = [...transports];
  }

  get id() { return this.#credentialId.toString('base64url'); }
  get credentialId() { return new Uint8Array(this.#credentialId); }
  get publicKey() { return new Uint8Array(this.#cosePublicKey); }
  get publicKeySPKI() { return new Uint8Array(this.#publicKeySPKI); }
  get publicKeyObject() { return this.#publicKeyObject; }
  get counter() { return this.#counter; }
  set counter(value) { this.#counter = uint(value, 0xffffffff, 'counter'); }

  /** Snapshot compatible with SimpleWebAuthn's WebAuthnCredential shape. */
  get credential() {
    return {
      id: this.id,
      publicKey: this.publicKey,
      counter: this.counter,
      transports: [...this.transports],
    };
  }

  /** Stable identity mapping plus current authenticator state; no private key. */
  snapshot() {
    return {
      ...this.credential,
      credentialId: this.credentialId,
      publicKeySPKI: this.publicKeySPKI,
      userHandle: this.userHandle,
      rpId: this.rpId,
      origin: this.origin,
    };
  }

  register(options, overrides = {}) {
    if (!options?.rp || !options?.user || !hasOwn(options.user, 'id')) {
      throw new TypeError('registration options must contain rp and user.id');
    }
    this.rpId = options.rp.id || this.rpId || new URL(this.origin).hostname;
    this.userHandle = base64url(options.user.id);

    const identity = responseIdentity(this.id, overrides);
    if (identity.credentialBytes.length > 0xffff) throw new RangeError('attested credential ID is too long');
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(identity.credentialBytes.length);
    const clientDataJSON = clientData(options, overrides, 'webauthn.create', this.origin);
    const authData = Buffer.concat([
      rpHash(this.rpId, overrides),
      Buffer.from([ceremonyFlags(overrides, true)]),
      counterBytes(hasOwn(overrides, 'counter') ? overrides.counter : this.counter),
      this.aaguid,
      idLength,
      identity.credentialBytes,
      this.#cosePublicKey,
    ]);
    const attestationObject = encodeCBOR({ fmt: 'none', attStmt: {}, authData });
    return {
      id: identity.id,
      rawId: identity.rawId,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: hasOwn(overrides, 'clientExtensionResults')
        ? overrides.clientExtensionResults
        : { credProps: { rk: true } },
      response: {
        clientDataJSON: base64url(clientDataJSON),
        attestationObject: base64url(attestationObject),
        authenticatorData: base64url(authData),
        publicKey: base64url(this.#publicKeySPKI),
        publicKeyAlgorithm: -7,
        transports: [...this.transports],
      },
    };
  }

  authenticate(options, overrides = {}) {
    if (!options || !hasOwn(options, 'challenge')) {
      throw new TypeError('authentication options must contain challenge');
    }
    const rpId = options.rpId || this.rpId || new URL(this.origin).hostname;
    const nextCounter = hasOwn(overrides, 'counter') ? overrides.counter : this.counter + 1;
    uint(nextCounter, 0xffffffff, 'counter');
    if (overrides.advanceCounter !== false) this.counter = nextCounter;

    const identity = responseIdentity(this.id, overrides);
    const clientDataJSON = clientData(options, overrides, 'webauthn.get', this.origin);
    const authenticatorData = Buffer.concat([
      rpHash(rpId, overrides),
      Buffer.from([ceremonyFlags(overrides, false)]),
      counterBytes(nextCounter),
    ]);
    const signatureBase = Buffer.concat([
      authenticatorData,
      createHash('sha256').update(clientDataJSON).digest(),
    ]);
    let signature = hasOwn(overrides, 'signature')
      ? bytes(overrides.signature, 'signature')
      : sign('sha256', signatureBase, { key: this.#privateKey, dsaEncoding: 'der' });
    if (overrides.signatureTamper || overrides.tamperSignature) {
      signature = Buffer.from(signature);
      if (!signature.length) signature = Buffer.from([1]);
      else signature[signature.length - 1] ^= 0x01;
    }
    const selectedHandle = hasOwn(overrides, 'userHandle') ? overrides.userHandle : this.userHandle;
    return {
      id: identity.id,
      rawId: identity.rawId,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: overrides.clientExtensionResults ?? {},
      response: {
        clientDataJSON: base64url(clientDataJSON),
        authenticatorData: base64url(authenticatorData),
        signature: base64url(signature),
        userHandle: selectedHandle === null ? null : base64url(selectedHandle),
      },
    };
  }

  registrationResponse(options, overrides = {}) { return this.register(options, overrides); }
  authenticationResponse(options, overrides = {}) { return this.authenticate(options, overrides); }
}

export function createSoftwareAuthenticator(options = {}) {
  return new SoftwareAuthenticator(options);
}

export function createRegistrationResponse(authenticator, options, overrides = {}) {
  return authenticator.register(options, overrides);
}

export function createAuthenticationResponse(authenticator, options, overrides = {}) {
  return authenticator.authenticate(options, overrides);
}

export default SoftwareAuthenticator;
