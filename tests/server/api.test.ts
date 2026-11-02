import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleApiRequest } from '../../src/server/api'
import * as auth from '../../src/server/auth'
import type { AppEnv } from '../../src/server/env'
import { createNonce } from '../../src/server/store'
import { activity, environment, identity, png, sqliteD1 } from './helpers'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

async function fixture(saveImages = true) {
  const { db, sqlite } = sqliteD1()
  const nonce = await createNonce(db)
  vi.spyOn(auth, 'verifyIdentity').mockResolvedValue({ ...identity, nonce })
  const published = structuredClone(activity)
  const saveParam = published.activity.judge.params.find(entry => entry.param.key === 'saveImages')!
  saveParam.value = saveImages
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(Response.json(published))))
  const run = vi.fn().mockResolvedValue({ answers: { match: { type: 'noul', noul: 0.85 }, nsfw: { type: 'noul', noul: 0.12 } } })
  const put = vi.fn().mockResolvedValue({ key: 'saved' })
  const env = { ...environment, DB: db, AI: { run }, IMAGES: { put } } as unknown as AppEnv
  const key = crypto.randomUUID()
  const request = (overrides: { key?: string; bytes?: Uint8Array<ArrayBuffer>; nonce?: string } = {}) => new Request('https://challenge.example.com/api/upload', {
    method: 'POST', body: overrides.bytes ?? png(), headers: {
      Authorization: 'Bearer signed-page-token', 'X-Hb-Nonce': overrides.nonce ?? nonce,
      'Idempotency-Key': overrides.key ?? key, 'Content-Type': 'image/png',
    },
  })
  return { db, sqlite, env, request, run, put, nonce }
}

describe('upload workflow', () => {
  it('starts storage and inference together, waits for both, then replays without extra AI', async () => {
    const { sqlite, env, request, run, put } = await fixture()
    let finishAI!: (value: unknown) => void, finishR2!: (value: unknown) => void
    run.mockImplementation(() => new Promise(resolve => { finishAI = resolve }))
    put.mockImplementation(() => new Promise(resolve => { finishR2 = resolve }))
    let finished = false
    const pending = handleApiRequest(request(), env).then(response => { finished = true; return response! })
    await vi.waitFor(() => { expect(run).toHaveBeenCalledTimes(1); expect(put).toHaveBeenCalledTimes(1) })
    finishAI({ answers: { match: { type: 'noul', noul: 0.85 }, nsfw: { type: 'noul', noul: 0.12 } } })
    await Promise.resolve()
    expect(finished).toBe(false)
    finishR2({ key: 'saved' })
    const response = await pending
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ model: '@cf/cloudflare/clef-flash', score: 85, nsfwScore: 12, width: 1, height: 1, attempt: 1, remaining: 2, saved: true })
    const frozen = sqlite.prepare('SELECT config_json FROM image_attempts').get() as { config_json: string }
    expect(JSON.parse(frozen.config_json)).toMatchObject({ model: '@cf/cloudflare/clef-flash' })
    const repeated = await handleApiRequest(request(), env)
    expect(repeated!.status).toBe(200)
    expect(await repeated!.json()).toMatchObject({ model: '@cf/cloudflare/clef-flash', score: 85 })
    expect(run).toHaveBeenCalledTimes(1); expect(put).toHaveBeenCalledTimes(1)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM image_attempts').get()).toMatchObject({ n: 1 })
    sqlite.close()
  })
  it('shares new uploads only with an explicit v1 disclosure acknowledgment, leaving older clients private', async () => {
    const { sqlite, env, request } = await fixture()
    const optedIn = request()
    optedIn.headers.set('X-Hb-Gallery-Consent', 'v1')
    expect((await handleApiRequest(optedIn, env))!.status).toBe(200)
    expect(sqlite.prepare('SELECT gallery_shared, image_width, image_height, nsfw_score FROM image_attempts').get())
      .toMatchObject({ gallery_shared: 1, image_width: 1, image_height: 1, nsfw_score: 12 })
    sqlite.close()

    const legacy = await fixture()
    expect((await handleApiRequest(legacy.request(), legacy.env))!.status).toBe(200)
    expect(legacy.sqlite.prepare('SELECT gallery_shared FROM image_attempts').get()).toMatchObject({ gallery_shared: 0 })
    legacy.sqlite.close()
  })
  it('retains a matching score with unknown safety if the NSFW answer is absent', async () => {
    const { sqlite, env, request, run } = await fixture()
    run.mockResolvedValue({ answers: { match: { type: 'noul', noul: 0.9 } } })
    const response = await handleApiRequest(request(), env)
    expect(await response!.json()).toMatchObject({ score: 90, nsfwScore: null })
    expect(sqlite.prepare('SELECT nsfw_score FROM image_attempts').get()).toMatchObject({ nsfw_score: null })
    sqlite.close()
  })
  it('never declares a ready result if R2 fails even when AI succeeds', async () => {
    const { sqlite, env, request, run, put } = await fixture()
    put.mockRejectedValue(new Error('R2 unavailable'))
    const response = await handleApiRequest(request(), env)
    expect(response!.status).toBe(502)
    expect(await response!.json()).toMatchObject({ code: 'image_save_failed' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(sqlite.prepare('SELECT status, score FROM image_attempts').get()).toMatchObject({ status: 'failed', score: null })
    sqlite.close()
  })
  it('retains author-requested metadata without saving images when retention is off', async () => {
    const { sqlite, env, request, put } = await fixture(false)
    const response = await handleApiRequest(request(), env)
    expect(response!.status).toBe(200)
    expect(await response!.json()).toMatchObject({ saved: false, score: 85 })
    expect(put).not.toHaveBeenCalled()
    expect(sqlite.prepare('SELECT status, image_key FROM image_attempts').get()).toMatchObject({ status: 'ready', image_key: null })
    sqlite.close()
  })
  it('rejects changed bytes for a reused idempotency key and a reused nonce for a new request', async () => {
    const { sqlite, env, request, run } = await fixture()
    expect((await handleApiRequest(request(), env))!.status).toBe(200)
    const conflict = await handleApiRequest(request({ bytes: png(2, 1) }), env)
    expect(conflict!.status).toBe(409)
    expect(await conflict!.json()).toMatchObject({ code: 'idempotency_conflict' })
    const replay = await handleApiRequest(request({ key: crypto.randomUUID() }), env)
    expect(replay!.status).toBe(401)
    expect(run).toHaveBeenCalledTimes(1)
    sqlite.close()
  })
  it('does not expose another player result to the judge', async () => {
    const { sqlite, env, request } = await fixture()
    const saved = await (await handleApiRequest(request(), env))!.json() as { id: string }
    const wrongPlayer = await handleApiRequest(new Request(`https://challenge.example.com/api/results/${saved.id}?user=99`, { headers: { 'X-Hb-Token': 'signed-judge-token' } }), env)
    expect(await wrongPlayer!.json()).toEqual({ found: false })
    const correctPlayer = await handleApiRequest(new Request(`https://challenge.example.com/api/results/${saved.id}?user=42`, { headers: { 'X-Hb-Token': 'signed-judge-token' } }), env)
    expect(await correctPlayer!.json()).toMatchObject({ found: true, score: 85, minScore: 70, maxScore: 100, maxAttempts: 3 })
    sqlite.close()
  })
  it('rejects a cross-origin browser request and preserves SSR routing', async () => {
    const { sqlite, env } = await fixture()
    const cross = await handleApiRequest(new Request('https://challenge.example.com/api/nonce', { method: 'POST', headers: { Origin: 'https://evil.example' } }), env)
    expect(cross!.status).toBe(403)
    expect(await handleApiRequest(new Request('https://challenge.example.com/'), env)).toBeNull()
    sqlite.close()
  })
})
