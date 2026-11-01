import { MAX_ATTEMPTS, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS, MODEL } from '../shared/contracts'
import type { ChallengeConfig, PublicConfig, UploadResult } from '../shared/contracts'
import type { AppEnv } from './env'
import { pageToken, platformSite, verifyIdentity } from './auth'
import { loadChallenge } from './challenge'
import { ApiFailure } from './errors'
import { imageHash, readImage, validateImage } from './images'
import { scoreImage } from './ai'
import { consumeNonce, createNonce, existingAttempt, reserveAttempt } from './store'
import type { Attempt } from './store'

function json(value: unknown, status = 200): Response { return Response.json(value, { status }) }

function replay(attempt: Attempt, hash: string): Response {
  if (attempt.image_sha256 !== hash) throw new ApiFailure(409, 'idempotency_conflict', '同一个上传编号不能用于不同的图片')
  if (attempt.status === 'processing') throw new ApiFailure(409, 'processing', '这张图片仍在处理，请稍后查询已有结果，不要重新上传')
  if (attempt.status === 'failed') throw new ApiFailure(502, attempt.error_code ?? 'processing_failed', '本次处理未完成，已记录这次尝试，请勿重复提交同一上传')
  const config = JSON.parse(attempt.config_json) as ChallengeConfig
  if (attempt.score === null) throw new Error('Ready result is missing score')
  const result: UploadResult = {
    id: attempt.id, score: attempt.score, challenge: config.challenge,
    attempt: attempt.attempt_no, remaining: Math.max(0, config.maxAttempts - attempt.attempt_no),
    saved: attempt.image_key !== null,
  }
  return json(result)
}

async function upload(request: Request, env: AppEnv): Promise<Response> {
  const identity = await verifyIdentity(pageToken(request), 'page', request, env)
  const nonce = request.headers.get('X-Hb-Nonce') ?? ''
  if (!/^[a-zA-Z0-9_.~-]{8,128}$/.test(nonce) || identity.nonce !== nonce) throw new ApiFailure(401, 'nonce_mismatch', '上传许可与身份令牌不匹配，请重新验证身份')
  const key = request.headers.get('Idempotency-Key') ?? ''
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(key)) throw new ApiFailure(400, 'idempotency_required', '上传缺少有效的唯一编号')
  const bytes = await readImage(request)
  const info = validateImage(bytes, request.headers.get('Content-Type'))
  const hash = await imageHash(bytes)
  const existing = await existingAttempt(env.DB, identity, key)
  if (existing) return replay(existing, hash)
  const config = await loadChallenge(env, identity, new URL(request.url).origin)
  await consumeNonce(env.DB, nonce)
  const reserved = await reserveAttempt(env.DB, identity, key, hash, info.contentType, config)
  if (!reserved.created) return replay(reserved.attempt, hash)
  const attempt = reserved.attempt
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[info.contentType]
  const imageKey = config.saveImages ? `images/${identity.hongbao}/${identity.sub}/${attempt.id}.${extension}` : null
  // Neither operation depends on the other. Await both before declaring a result ready.
  const [stored, evaluated] = await Promise.allSettled([
    imageKey ? env.IMAGES.put(imageKey, bytes, {
      httpMetadata: { contentType: info.contentType },
      customMetadata: { hongbao: identity.hongbao, user: identity.sub, result: attempt.id },
    }).then(object => { if (!object) throw new Error('Image write returned no object'); return imageKey }) : Promise.resolve(null),
    scoreImage(env, bytes, info.contentType, config.challenge),
  ])
  const savedKey = stored.status === 'fulfilled' ? stored.value : null
  if (stored.status === 'rejected' || evaluated.status === 'rejected') {
    const code = stored.status === 'rejected' ? 'image_save_failed' : 'ai_failed'
    await env.DB.prepare("UPDATE image_attempts SET status = 'failed', image_key = ?, error_code = ?, updated_at = ? WHERE id = ? AND status = 'processing'")
      .bind(savedKey, code, Date.now(), attempt.id).run()
    throw new ApiFailure(502, code, stored.status === 'rejected' ? '图片保存失败，本次没有生成可兑奖结果；已记录这次尝试' : 'AI 评分失败，本次没有生成可兑奖结果；已记录这次尝试')
  }
  await env.DB.prepare("UPDATE image_attempts SET status = 'ready', image_key = ?, score = ?, updated_at = ? WHERE id = ? AND status = 'processing'")
    .bind(savedKey, evaluated.value, Date.now(), attempt.id).run()
  return replay({ ...attempt, status: 'ready', image_key: savedKey, score: evaluated.value }, hash)
}

async function judgeResult(request: Request, env: AppEnv, id: string): Promise<Response> {
  const identity = await verifyIdentity(request.headers.get('X-Hb-Token'), 'judge', request, env)
  const user = new URL(request.url).searchParams.get('user') ?? ''
  if (!/^\d+$/.test(user)) throw new ApiFailure(400, 'player_required', '缺少待核验的玩家 ID')
  const result = await env.DB.prepare("SELECT * FROM image_attempts WHERE id = ? AND hongbao = ? AND user_id = ? AND status = 'ready'")
    .bind(id, identity.hongbao, user).first<Attempt>()
  if (!result || result.score === null) return json({ found: false })
  const config = JSON.parse(result.config_json) as ChallengeConfig
  return json({
    found: true, id: result.id, hongbao: result.hongbao, user: result.user_id,
    ...config, score: result.score, attempt: result.attempt_no, saved: result.image_key !== null,
  })
}

async function playerResult(request: Request, env: AppEnv, id: string): Promise<Response> {
  const identity = await verifyIdentity(pageToken(request), 'page', request, env)
  const result = await env.DB.prepare('SELECT * FROM image_attempts WHERE id = ? AND hongbao = ? AND user_id = ?')
    .bind(id, identity.hongbao, identity.sub).first<Attempt>()
  if (!result) throw new ApiFailure(404, 'result_not_found', '没有找到这次上传')
  if (result.status !== 'ready') return json({ id: result.id, status: result.status, code: result.error_code })
  return replay(result, result.image_sha256)
}

async function image(request: Request, env: AppEnv, id: string): Promise<Response> {
  const identity = await verifyIdentity(pageToken(request), 'page', request, env)
  const result = await env.DB.prepare('SELECT * FROM image_attempts WHERE id = ? AND hongbao = ?')
    .bind(id, identity.hongbao).first<Attempt>()
  if (!result?.image_key || (result.user_id !== identity.sub && identity.sub !== env.OWNER_ID)) throw new ApiFailure(404, 'image_not_found', '图片不存在或你没有查看权限')
  const object = await env.IMAGES.get(result.image_key)
  if (!object) throw new ApiFailure(404, 'image_not_found', '图片不存在')
  return new Response(object.body, { headers: { 'Content-Type': result.content_type, 'Content-Disposition': 'inline', 'Content-Security-Policy': "default-src 'none'; sandbox", 'X-Content-Type-Options': 'nosniff' } })
}

async function route(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  if (origin && origin !== url.origin) throw new ApiFailure(403, 'cross_origin', '请从当前服务的网页发起请求')
  if (url.pathname === '/api/config' && request.method === 'GET') {
    const config: PublicConfig = {
      model: MODEL, ownerConfigured: /^\d+$/.test(env.OWNER_ID),
      maxImageBytes: MAX_IMAGE_BYTES, maxImagePixels: MAX_IMAGE_PIXELS,
      maxAttempts: MAX_ATTEMPTS, storage: 'r2', hbSite: platformSite(env),
    }
    return json(config)
  }
  if (url.pathname === '/api/nonce' && request.method === 'POST') {
    if (!/^\d+$/.test(env.OWNER_ID)) throw new ApiFailure(503, 'owner_not_configured', '服务尚未配置红包作者 ID')
    return json({ nonce: await createNonce(env.DB) })
  }
  if (url.pathname === '/api/upload' && request.method === 'POST') return upload(request, env)
  const resultMatch = /^\/api\/results\/([a-f0-9-]{36})$/.exec(url.pathname)
  if (resultMatch && request.method === 'GET') return judgeResult(request, env, resultMatch[1])
  const imageMatch = /^\/api\/images\/([a-f0-9-]{36})$/.exec(url.pathname)
  if (imageMatch && request.method === 'GET') return image(request, env, imageMatch[1])
  const uploadMatch = /^\/api\/uploads\/([a-f0-9-]{36})$/.exec(url.pathname)
  if (uploadMatch && request.method === 'GET') return playerResult(request, env, uploadMatch[1])
  throw new ApiFailure(404, 'not_found', '接口不存在')
}

export async function handleApiRequest(request: Request, env: AppEnv): Promise<Response | null> {
  if (!new URL(request.url).pathname.startsWith('/api/')) return null
  let response: Response
  try { response = await route(request, env) }
  catch (error) {
    response = error instanceof ApiFailure
      ? json({ error: error.message, code: error.code }, error.status)
      : json({ error: '服务暂时无法完成请求，请稍后重试', code: 'service_unavailable' }, 503)
  }
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}
