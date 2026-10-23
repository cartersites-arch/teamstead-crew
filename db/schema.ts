import { blob, integer, sqliteTable, text, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const workspace = sqliteTable('workspace', {
  id: text('id').primaryKey(), name: text('name').notNull(), ownerId: text('owner_id').notNull(), accessBootstrapped: integer('access_bootstrapped').notNull().default(0), createdAt: integer('created_at').notNull(), aiEnabled: integer('ai_enabled').notNull().default(1),
});
export const people = sqliteTable('people', {
  id: text('id').primaryKey(), email: text('email').notNull(), name: text('name').notNull(), role: text('role').notNull().default('member'), active: integer('active').notNull().default(1), joinedAt: integer('joined_at').notNull(), authVersion: integer('auth_version').notNull().default(1), passkeyEnrolled: integer('passkey_enrolled').notNull().default(0), webauthnUserId: text('webauthn_user_id'),
});
export const rooms = sqliteTable('rooms', {
  id: text('id').primaryKey(), name: text('name').notNull(), description: text('description').notNull().default(''), kind: text('kind').notNull().default('channel'), visibility: text('visibility').notNull().default('private'), dmKey: text('dm_key'), createdBy: text('created_by').notNull(), createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('idx_rooms_dm_key').on(t.dmKey)]);
export const roomMembers = sqliteTable('room_members', {
  roomId: text('room_id').notNull().references(()=>rooms.id), userId: text('user_id').notNull().references(()=>people.id), readAt: integer('read_at').notNull().default(0),
}, t => [primaryKey({columns:[t.roomId,t.userId]}),index('idx_room_members_user').on(t.userId,t.roomId)]);
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(), roomId: text('room_id').notNull().references(()=>rooms.id), userId: text('user_id').notNull().references(()=>people.id), parentId: text('parent_id'), body: text('body').notNull(), createdAt: integer('created_at').notNull(), editedAt: integer('edited_at'), deleted: integer('deleted').notNull().default(0), pinned: integer('pinned').notNull().default(0),
}, t => [index('idx_messages_room_parent_created').on(t.roomId,t.parentId,t.createdAt,t.id),index('idx_messages_parent').on(t.parentId)]);
export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(), messageId: text('message_id').notNull().references(()=>messages.id), objectKey: text('object_key').notNull(), name: text('name').notNull(), mime: text('mime').notNull(), size: integer('size').notNull(),
}, t => [index('idx_attachments_message').on(t.messageId)]);
export const reactions = sqliteTable('reactions', {
  messageId: text('message_id').notNull().references(()=>messages.id), userId: text('user_id').notNull().references(()=>people.id), emoji: text('emoji').notNull(),
}, t => [primaryKey({columns:[t.messageId,t.userId,t.emoji]})]);
export const invitations = sqliteTable('invitations', {
  email: text('email').primaryKey(), name: text('name').notNull(), roomIds: text('room_ids').notNull().default('[]'), createdAt: integer('created_at').notNull(),
});
export const maintenanceLinks = sqliteTable('maintenance_links', {
  userId: text('user_id').primaryKey().references(()=>people.id), environment: text('environment').notNull(), ciphertext: text('ciphertext').notNull(), iv: text('iv').notNull(), connectedAt: integer('connected_at').notNull(),
});
export const accessTokens = sqliteTable('access_tokens', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull().references(()=>people.id), createdAt: integer('created_at').notNull(), expiresAt: integer('expires_at').notNull().default(0), usedAt: integer('used_at').notNull().default(0), purpose: text('purpose').notNull().default('invite'),
}, t=>[uniqueIndex('idx_access_tokens_user').on(t.userId)]);
export const sessions = sqliteTable('sessions', {
  sessionHash: text('session_hash').primaryKey(), userId: text('user_id').notNull().references(()=>people.id), authVersion: integer('auth_version').notNull(), expiresAt: integer('expires_at').notNull(), id: text('id'), authLevel: text('auth_level').notNull().default('legacy'), setupTokenHash: text('setup_token_hash'), createdAt: integer('created_at').notNull().default(0), verifiedAt: integer('verified_at').notNull().default(0), lastSeenAt: integer('last_seen_at').notNull().default(0), deviceLabel: text('device_label').notNull().default('Browser'),
},t=>[index('idx_sessions_user').on(t.userId),index('idx_sessions_expiry').on(t.expiresAt)]);

export const passkeys = sqliteTable('passkeys', {
  id: text('id').primaryKey(), userId: text('user_id').notNull().references(()=>people.id), publicKey: text('public_key').notNull(), webauthnUserId: text('webauthn_user_id').notNull(), counter: integer('counter').notNull().default(0), transports: text('transports').notNull().default('[]'), deviceType: text('device_type').notNull(), backedUp: integer('backed_up').notNull().default(0), name: text('name').notNull(), createdAt: integer('created_at').notNull(), lastUsedAt: integer('last_used_at'), lastChallengeId: text('last_challenge_id').notNull(),
}, t=>[index('idx_passkeys_user').on(t.userId)]);
export const passkeyChallenges = sqliteTable('passkey_challenges', {
  id: text('id').primaryKey(), challenge: text('challenge').notNull(), purpose: text('purpose').notNull(), browserHash: text('browser_hash').notNull(), userId: text('user_id'), sessionHash: text('session_hash'), authVersion: integer('auth_version'), expiresAt: integer('expires_at').notNull(),
}, t=>[index('idx_passkey_challenges_expiry').on(t.expiresAt)]);
export const securityEvents = sqliteTable('security_events', {
  id: text('id').primaryKey(), actorId: text('actor_id').notNull(), targetId: text('target_id'), action: text('action').notNull(), at: integer('at').notNull(),
},t=>[index('idx_security_events_at').on(t.at),index('idx_security_events_target').on(t.targetId,t.at)]);
export const fileDeletions = sqliteTable('file_deletions', {
  objectKey: text('object_key').primaryKey(), messageId: text('message_id'), requestedBy: text('requested_by').notNull(), requestedAt: integer('requested_at').notNull(), attempts: integer('attempts').notNull().default(0),
},t=>[index('idx_file_deletions_requester').on(t.requestedBy)]);

export const photoBudget = sqliteTable('photo_budget', {
  id: integer('id').primaryKey(),
  usedBytes: integer('used_bytes').notNull().default(0),
  limitBytes: integer('limit_bytes').notNull().default(67108864),
});

export const photoObjects = sqliteTable('photo_objects', {
  objectKey: text('object_key').primaryKey(),
  size: integer('size').notNull(),
  body: blob('body', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at').notNull(),
});

export const botPreferences = sqliteTable('bot_preferences', { userId:text('user_id').primaryKey().references(()=>people.id),enabled:integer('enabled').notNull().default(0),authVersion:integer('auth_version').notNull(),connectionIv:text('connection_iv').notNull(),roomId:text('room_id').notNull().unique().references(()=>rooms.id),actorId:text('actor_id'),snapshot:text('snapshot').notNull().default('[]'),lastAttempt:integer('last_attempt').notNull().default(0),lastChecked:integer('last_checked').notNull().default(0),lastError:text('last_error').notNull().default(''),leaseUntil:integer('lease_until').notNull().default(0),leaseToken:text('lease_token').notNull().default(''),enabledAt:integer('enabled_at').notNull()});
export const botEvents = sqliteTable('bot_events', {id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>people.id),messageId:text('message_id').notNull().references(()=>messages.id),createdAt:integer('created_at').notNull(),pushDone:integer('push_done').notNull().default(0)},t=>[index('idx_bot_events_push').on(t.pushDone,t.createdAt)]);
export const pushDevices = sqliteTable('push_devices', {id:text('id').primaryKey(),userId:text('user_id').notNull().references(()=>people.id),authVersion:integer('auth_version').notNull(),subscription:text('subscription').notNull(),createdAt:integer('created_at').notNull(),lastSent:integer('last_sent').notNull().default(0)},t=>[index('idx_push_devices_user').on(t.userId)]);

export const employeeStatus=sqliteTable('employee_status',{userId:text('user_id').primaryKey().references(()=>people.id),status:text('status').notNull(),expiresAt:integer('expires_at').notNull(),authVersion:integer('auth_version').notNull()});
export const chatNotificationPreferences=sqliteTable('chat_notification_preferences',{userId:text('user_id').primaryKey().references(()=>people.id),authVersion:integer('auth_version').notNull(),enabled:integer('enabled').notNull().default(0),enabledAt:integer('enabled_at').notNull(),quietStart:integer('quiet_start').notNull().default(1320),quietEnd:integer('quiet_end').notNull().default(420),quietEnabled:integer('quiet_enabled').notNull().default(0),timezone:text('timezone').notNull().default('UTC'),mutedRooms:text('muted_rooms').notNull().default('[]'),lastAttempt:integer('last_attempt').notNull().default(0),leaseUntil:integer('lease_until').notNull().default(0),leaseToken:text('lease_token').notNull().default('')});
export const chatPushReceipts=sqliteTable('chat_push_receipts',{deviceId:text('device_id').notNull().references(()=>pushDevices.id,{onDelete:'cascade'}),messageId:text('message_id').notNull().references(()=>messages.id),createdAt:integer('created_at').notNull()},t=>[primaryKey({columns:[t.deviceId,t.messageId]})]);

export const conversationPreferences=sqliteTable('conversation_preferences',{userId:text('user_id').notNull().references(()=>people.id),roomId:text('room_id').notNull().references(()=>rooms.id),favorite:integer('favorite').notNull().default(0),section:text('section').notNull().default(''),notification:text('notification').notNull().default('mentions')},t=>[primaryKey({columns:[t.userId,t.roomId]})]);
export const savedMessages=sqliteTable('saved_messages',{userId:text('user_id').notNull().references(()=>people.id),messageId:text('message_id').notNull().references(()=>messages.id),savedAt:integer('saved_at').notNull()},t=>[primaryKey({columns:[t.userId,t.messageId]})]);
export const crewProfiles=sqliteTable('crew_profiles',{userId:text('user_id').primaryKey().references(()=>people.id),jobTitle:text('job_title').notNull().default(''),photo:blob('photo',{mode:'buffer'}),photoMime:text('photo_mime').notNull().default(''),updatedAt:integer('updated_at').notNull().default(0)});
