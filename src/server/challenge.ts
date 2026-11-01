import { MAX_ATTEMPTS } from '../shared/contracts'
import type { ChallengeConfig } from '../shared/contracts'
import type { AppEnv } from './env'
import type { Identity } from './auth'
import { platformSite } from './auth'
import { ApiFailure, record } from './errors'

export function parseChallenge(params: Record<string, unknown>, origin: string): ChallengeConfig {
  let server: URL
  try { server = new URL(String(params.server)) } catch { throw new ApiFailure(422, 'invalid_challenge', '红包没有配置有效的服务地址') }
  if (server.origin !== origin || server.pathname !== '/' || server.search || server.hash || server.username || server.password) {
    throw new ApiFailure(403, 'wrong_server', '这个红包使用的是另一个图片服务')
  }
  const { challenge, minScore, maxScore, maxAttempts, saveImages } = params
  if (typeof challenge !== 'string' || !challenge.trim() || challenge.length > 1000 ||
      typeof minScore !== 'number' || !Number.isFinite(minScore) || minScore < 0 ||
      typeof maxScore !== 'number' || !Number.isFinite(maxScore) || maxScore > 100 || minScore > maxScore ||
      typeof maxAttempts !== 'number' || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_ATTEMPTS ||
      typeof saveImages !== 'boolean') {
    throw new ApiFailure(422, 'invalid_challenge', '红包的挑战配置无效，请联系红包作者')
  }
  return { challenge, minScore, maxScore, maxAttempts, saveImages }
}

export function challengeFromActivity(data: unknown, identity: Identity, origin: string): ChallengeConfig {
  if (!record(data) || !record(data.activity)) throw new ApiFailure(502, 'activity_unavailable', '无法读取红包的挑战配置')
  const activity = data.activity
  // verifyIdentity binds the signed sender to OWNER_ID; public author.id is an unrelated internal UUID.
  if (activity.id !== identity.hongbao) {
    throw new ApiFailure(403, 'wrong_activity', '红包与当前身份不匹配')
  }
  if (activity.status !== 'active' || activity.stopped === true || !record(activity.judge) || activity.judge.paused === true || activity.judge.stopped === true) {
    throw new ApiFailure(409, 'activity_inactive', '这个红包尚未开放、已结束或已暂停')
  }
  const deadline = activity.deadlineAt
  if (typeof deadline === 'string' && (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= Date.now())) {
    throw new ApiFailure(409, 'activity_inactive', '这个红包已结束')
  }
  if (!Array.isArray(activity.judge.params)) throw new ApiFailure(422, 'invalid_challenge', '红包没有公开挑战参数')
  const params: Record<string, unknown> = Object.create(null)
  for (const item of activity.judge.params) {
    if (record(item) && record(item.param) && typeof item.param.key === 'string') params[item.param.key] = item.value
  }
  return parseChallenge(params, origin)
}

export async function loadChallenge(env: AppEnv, identity: Identity, origin: string): Promise<ChallengeConfig> {
  let response: Response
  try {
    response = await fetch(`${platformSite(env)}/api/activities/${encodeURIComponent(identity.hongbao)}`, {
      headers: { Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    })
  } catch { throw new ApiFailure(502, 'activity_unavailable', '红包站暂时无法连接，请稍后重试') }
  if (!response.ok) throw new ApiFailure(502, 'activity_unavailable', '红包站暂时无法读取这个红包')
  let data: unknown
  try { data = await response.json() } catch { throw new ApiFailure(502, 'activity_unavailable', '红包站返回了无效的挑战配置') }
  return challengeFromActivity(data, identity, origin)
}
