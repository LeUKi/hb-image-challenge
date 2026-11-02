import type { Hb, HbIdentityReason, HbIdentityResult } from '../types/hb-sdk'

type Identified = Extract<HbIdentityResult, { identified: true }>
const IDENTITY_MESSAGES: Record<HbIdentityReason, string> = {
  login: '登录状态已变化，请先登录红包站后继续。',
  denied: '请允许身份验证后继续。',
  away: '请回到当前红包页，再打开图片挑战继续。',
  busy: '红包站仍在核对身份，请稍后再试。',
  unavailable: '红包站暂时无法签发身份，请稍后再试。',
  error: '暂时无法核对身份，请稍后再试。',
}

export class PageIdentityError extends Error {
  constructor(readonly reason: HbIdentityReason, message?: string) {
    super(message || IDENTITY_MESSAGES[reason])
    this.name = 'PageIdentityError'
  }
}

/** Tokens stay in this page's memory. Uploads always obtain a fresh nonce-bound token. */
export class PageIdentityCache {
  readonly cacheKey = crypto.randomUUID()
  private cached: Identified | null = null
  private expiresAt = 0
  private pending: Promise<Identified> | null = null
  private inFlight: Promise<Identified> | null = null
  private revision = 0

  constructor(private sdk: Pick<Hb, 'identity'>, private now: () => number = Date.now, readonly scope = '') {}

  remember(identity: Identified): void {
    if (this.cached && this.cached.user.id !== identity.user.id) this.clear()
    this.cached = identity
    this.expiresAt = Date.parse(identity.expiresAt)
  }

  get version(): number { return this.revision }
  subject(): string | null { return this.cached?.user.id ?? null }
  clear(): void { this.cached = null; this.expiresAt = 0; this.pending = null; this.revision += 1 }

  async get(): Promise<Identified> {
    if (this.cached && this.expiresAt > this.now() + 5_000) return this.cached
    return this.revalidate()
  }

  /** Keep the current actor usable until a fresh trusted identity proves a change. */
  async revalidate(): Promise<Identified> {
    if (this.pending) return this.pending
    const pending = this.requestIdentity()
    this.pending = pending
    try { return await pending }
    finally { if (this.pending === pending) this.pending = null }
  }

  /** Each upload needs its own nonce token, after any background identity read. */
  authorizeUpload(nonce: string): Promise<Identified> {
    if (!/^[A-Za-z0-9._~-]{8,128}$/.test(nonce)) return Promise.reject(new Error('上传许可无效，请重新开始上传。'))
    return this.requestIdentity({ nonce })
  }

  private async requestIdentity(options?: { nonce: string }): Promise<Identified> {
    const revision = this.revision
    const previous = this.inFlight
    const assertCurrent = () => { if (this.revision !== revision) throw new Error('参与身份正在重新核对，请稍后继续') }
    const request = (async () => {
      // The production parent answers overlapping identity requests with busy.
      // Keep this queue across clear() until the parent's active request drains.
      if (previous) await previous.catch(() => undefined)
      for (let attempt = 0; ; attempt += 1) {
        assertCurrent()
        const identity = await this.sdk.identity(options)
        assertCurrent()
        if (identity.identified) { this.remember(identity); return identity }
        // Retrying a busy identity only asks for a token. It never uploads,
        // consumes a nonce or repeats an AI/payment operation or a denial.
        if (identity.reason !== 'busy' || attempt >= 2) throw new PageIdentityError(identity.reason, identity.message)
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    })()
    this.inFlight = request
    try { return await request }
    finally { if (this.inFlight === request) this.inFlight = null }
  }
}

export function galleryGrant(view: { data: unknown } | null | undefined): string | null {
  const data = view?.data
  if (!data || typeof data !== 'object' || !('galleryGrant' in data)) return null
  return typeof data.galleryGrant === 'string' && /^[a-f0-9]{64}$/.test(data.galleryGrant) ? data.galleryGrant : null
}

export function galleryHeaders(token: string, grant: string | null): Headers {
  const headers = new Headers({ Authorization: `Bearer ${token}` })
  if (grant) headers.set('X-Hb-Gallery-Grant', grant)
  return headers
}
