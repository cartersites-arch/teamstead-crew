import encryption from 'web-push/src/encryption-helper.js';
import {fromBase64url,toBase64url} from './access';
export async function pushRequest(subscription:{endpoint:string;keys:{p256dh:string;auth:string}},payload:string,publicKey:string,privateKey:string){
 const point=fromBase64url(publicKey);if(point.length!==65||point[0]!==4||fromBase64url(privateKey).length!==32)throw new Error('Phone notifications need valid server keys.');
 const key=await crypto.subtle.importKey('jwk',{kty:'EC',crv:'P-256',x:toBase64url(point.slice(1,33)),y:toBase64url(point.slice(33)),d:privateKey,ext:true},{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const encode=(data:unknown)=>toBase64url(new TextEncoder().encode(JSON.stringify(data)));
 const jwt=encode({typ:'JWT',alg:'ES256'})+'.'+encode({aud:new URL(subscription.endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:'https://teamstead-crew.pages.dev'});
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(jwt));
 const encrypted=encryption.encrypt(subscription.keys.p256dh,subscription.keys.auth,payload,'aes128gcm');
 return {endpoint:subscription.endpoint,headers:{Authorization:'vapid t='+jwt+'.'+toBase64url(new Uint8Array(signature))+', k='+publicKey,TTL:'3600',Urgency:'normal','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'},body:new Uint8Array(encrypted.cipherText)};
}
