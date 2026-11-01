import type { ChallengeConfig } from '../shared/contracts'
import type { Identity } from './auth'
import type { ImageType } from './images'
import { ApiFailure } from './errors'

export interface Attempt {
  id: string
  hongbao: string
  user_id: string
  idempotency_key: string
  image_sha256: string
  attempt_no: number
  config_json: string
  status: 'processing' | 'ready' | 'failed'
  image_key: string | null
  content_type: ImageType
  score: number | null
  error_code: string | null
  created_at: number
  updated_at: number
}

export const RESERVE_SQL = `INSERT INTO image_attempts
  (id, hongbao, user_id, idempotency_key, image_sha256, attempt_no, config_json,
   status, content_type, created_at, updated_at)
  SELECT ?, ?, ?, ?, ?, COALESCE(MAX(attempt_no), 0) + 1, ?, 'processing', ?, ?, ?
  FROM image_attempts WHERE hongbao = ? AND user_id = ?
  HAVING COUNT(*) < ?
  ON CONFLICT DO NOTHING RETURNING *`

export async function existingAttempt(db: D1Database, identity: Identity, idempotencyKey: string): Promise<Attempt | null> {
  return db.prepare('SELECT * FROM image_attempts WHERE hongbao = ? AND user_id = ? AND idempotency_key = ?')
    .bind(identity.hongbao, identity.sub, idempotencyKey).first<Attempt>()
}

export async function reserveAttempt(db: D1Database, identity: Identity, key: string, hash: string, contentType: ImageType, config: ChallengeConfig): Promise<{ attempt: Attempt; created: boolean }> {
  const id = crypto.randomUUID(), now = Date.now()
  const attempt = await db.prepare(RESERVE_SQL).bind(
    id, identity.hongbao, identity.sub, key, hash, JSON.stringify(config), contentType,
    now, now, identity.hongbao, identity.sub, config.maxAttempts,
  ).first<Attempt>()
  if (attempt) return { attempt, created: true }
  const existing = await existingAttempt(db, identity, key)
  if (existing) return { attempt: existing, created: false }
  throw new ApiFailure(429, 'attempts_exhausted', '这个红包的图片尝试次数已用完')
}

export async function createNonce(db: D1Database): Promise<string> {
  const nonce = crypto.randomUUID() + crypto.randomUUID(), now = Date.now()
  await db.batch([
    db.prepare('DELETE FROM upload_nonces WHERE expires_at < ?').bind(now),
    db.prepare('INSERT INTO upload_nonces (nonce, expires_at) VALUES (?, ?)').bind(nonce, now + 5 * 60_000),
  ])
  return nonce
}

export async function consumeNonce(db: D1Database, nonce: string): Promise<void> {
  const consumed = await db.prepare('DELETE FROM upload_nonces WHERE nonce = ? AND expires_at > ? RETURNING nonce')
    .bind(nonce, Date.now()).first<{ nonce: string }>()
  if (!consumed) throw new ApiFailure(401, 'nonce_used', '上传许可已过期或已使用，请重新验证身份')
}
