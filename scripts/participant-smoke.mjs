/* global document, window, parent, getComputedStyle, Element */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://127.0.0.1:5175'
const appBase = 'https://image-challenge.test'
const station = 'https://hb.lafi.sh'
const sdkSource = await readFile(new URL('../judge/cli/page/sdk-v1.js', import.meta.url), 'utf8')
const resultId = '2b990cc9-45da-44e2-8ce5-45a7bd6257d3'
const picture = { name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=', 'base64') }
const normalMe = { signedIn: true, name: '小明', open: true, cooldownUntil: null, claim: null, registered: false, pending: null, settled: false }
const hongbao = { id: 'lifecycle-test', title: '猫咪挑战', url: 'https://hb.lafi.sh/lifecycle-test', code: true, status: 'active', unit: 'LDC', params: { challenge: '这张图片里有一只猫', minScore: 70, maxScore: 100, maxAttempts: 3, saveImages: true } }
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const errors = []
const debug = process.env.SMOKE_DEBUG === '1'
let currentPage
let currentCounts
await mkdir('shots', { recursive: true })

async function reloadChallenge(page) {
  const frame = page.frames().find(frame => frame.url().startsWith(appBase))
  await frame.goto(`${appBase}/`, { waitUntil: 'networkidle' })
}

async function chooseImage(frame, file = picture) {
  // A real participant focuses the iframe by opening its chooser. Injecting a
  // File directly leaves the first focus event on the later upload click.
  const page = frame.owner().page()
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10_000 }),
    frame.getByRole('button', { name: '选择图片', exact: true }).click(),
  ])
  await chooser.setFiles(file)
  await frame.getByText(file.name, { exact: true }).waitFor()
  if (debug) console.log('File selected:', file.name, 'upload enabled:', await frame.getByRole('button', { name: '上传并评分' }).isEnabled())
}

async function fixture(overrides = {}, width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' })
  await context.route(`${appBase}/**`, async route => {
    const url = new URL(route.request().url())
    const response = await route.fetch({ url: `${base}${url.pathname}${url.search}` })
    await route.fulfill({ response })
  })
  await context.route(`${station}/sdk/v1.js`, route => route.fulfill({ contentType: 'text/javascript', body: sdkSource }))
  await context.route(`${appBase}/api/config`, route => route.fulfill({ json: { ownerConfigured: true, hbSite: station } }))
  await context.route(`${appBase}/api/nonce`, route => route.fulfill({ json: { nonce: 'fixture-nonce' } }))
  let uploadCount = 0
  let galleryReads = 0
  let imageReads = 0
  const likeBatches = []
  const likeTotals = new Map()
  const acceptedLikes = new Map()
  let loseLikeReply = Boolean(overrides.loseLikeReply)
  let releaseLike
  const likeGate = overrides.holdLikes ? new Promise(resolve => { releaseLike = resolve }) : Promise.resolve()
  let currentActor = '123'
  const actors = new Map([['123', { latest: overrides.galleryLatest ?? null, items: overrides.galleryItems ?? [], remaining: overrides.galleryRemaining ?? 3 }]])
  const actorFor = request => {
    const userId = request.headers().authorization?.split(':').at(-1) ?? '123'
    if (!actors.has(userId)) actors.set(userId, { latest: null, items: [], remaining: 3 })
    return actors.get(userId)
  }
  let releaseUpload
  const uploadGate = overrides.holdUpload ? new Promise(resolve => { releaseUpload = resolve }) : Promise.resolve()
  await context.route(`${appBase}/api/upload`, async route => {
    assert.equal(route.request().headers()['x-hb-gallery-consent'], 'v1')
    uploadCount += 1
    const actor = actorFor(route.request())
    await uploadGate
    const uploadedResult = { id: resultId, score: overrides.score ?? 80, challenge: hongbao.params.challenge, attempt: 1, remaining: overrides.remaining ?? 2, saved: overrides.saved ?? true, nsfwScore: 5, width: 1, height: 1 }
    actor.latest = uploadedResult
    actor.items = [{ ...uploadedResult, own: true, passed: uploadedResult.score >= 70, createdAt: Date.now() }, ...actor.items.filter(item => item.id !== resultId)]
    return route.fulfill({ json: uploadedResult })
  })
  await context.route(`${appBase}/api/gallery**`, async route => {
    galleryReads += 1
    assert.match(route.request().headers().authorization, /^Bearer test-only-token:\d+$/)
    assert.ok(!route.request().url().includes('test-only-token'))
    const actor = actorFor(route.request())
    const galleryItems = actor.items
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    const start = cursor ? galleryItems.findIndex(item => item.id === cursor.slice(7)) + 1 : 0
    const input = route.request().method() === 'POST' ? route.request().postDataJSON() : {}
    const userId = route.request().headers().authorization.split(':').at(-1)
    const receiptKey = id => `${userId}:${id}`
    let likeReceipt
    if (input.batch) {
      likeBatches.push({ ...input.batch, userId, watch: input.watch ?? [] })
      const key = receiptKey(input.batch.id)
      if (!acceptedLikes.has(key)) {
        const rejected = []
        for (const item of input.batch.items) {
          if (!galleryItems.some(image => image.id === item.id)) rejected.push(item.id)
          else likeTotals.set(item.id, (likeTotals.get(item.id) ?? 0) + item.count)
        }
        acceptedLikes.set(key, { id: input.batch.id, status: 'accepted', retryAfterMs: 30_000, rejected })
      }
      likeReceipt = acceptedLikes.get(key)
      await likeGate
      if (loseLikeReply) { loseLikeReply = false; return route.abort('failed') }
    } else if (input.receiptFor) likeReceipt = acceptedLikes.get(receiptKey(input.receiptFor))
    const items = galleryItems.slice(start, start + (overrides.pageSize ?? 24)).map(item => ({ ...item, likes: likeTotals.get(item.id) ?? item.likes ?? 0 }))
    const countIds = new Set([...items.map(item => item.id), ...(input.watch ?? [])])
    const likeCounts = Object.fromEntries(galleryItems.filter(item => countIds.has(item.id)).map(item => [item.id, likeTotals.get(item.id) ?? item.likes ?? 0]))
    return route.fulfill({ json: { items, next: start + items.length < galleryItems.length ? `before:${items.at(-1).id}` : null, remaining: actor.latest?.remaining ?? actor.remaining, latest: actor.latest, visibility: overrides.visibility ?? 'misses', likeCounts, ...(likeReceipt ? { likeReceipt } : {}) } })
  })
  await context.route(`${appBase}/api/images/*`, route => {
    imageReads += 1
    assert.match(route.request().headers().authorization, /^Bearer test-only-token:\d+$/)
    assert.equal(new URL(route.request().url()).search, '')
    return route.fulfill({ contentType: 'image/png', body: picture.buffer })
  })
  const state = { userId: '123', hongbao: { ...hongbao, ...overrides.hongbao }, viewer: { signedIn: true, name: '小明' }, theme: 'light', clock: 0, me: { ...normalMe, ...overrides.me }, myView: overrides.myView ?? null, view: null, mine: overrides.mine ?? [], receipt: overrides.receipt ?? { judged: true, claimed: true, amount: '0.50', unit: 'LDC', settled: true }, debug, ...overrides }
  const page = await context.newPage()
  if (overrides.clock) await page.clock.install({ time: new Date() })
  currentPage = page
  currentCounts = () => ({ uploadCount, galleryReads, imageReads, likeBatches })
  page.on('console', message => { if (debug || message.type() === 'error') console.log('Browser console:', message.text()) })
  if (debug) page.on('request', request => { if (request.url().startsWith(`${appBase}/api/`)) console.log('API request:', request.method(), new URL(request.url()).pathname) })
  page.on('pageerror', error => errors.push(error.message))
  // Use the official SDK with an in-memory station bridge; no real AI or reward calls.
  await context.route(`${station}/__participant_harness`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>body{margin:0}iframe{width:100%;height:100vh;border:0}</style><iframe src="${appBase}/"></iframe>` }))
  await page.addInitScript(state => {
    if (state.debug) window.addEventListener('focus', () => console.log('Harness focus:', parent === window ? 'station' : 'challenge'))
    if (state.debug) for (const type of ['pointerdown', 'click', 'submit']) document.addEventListener(type, event => {
      const target = event.target instanceof Element ? event.target : null
      console.log('Harness interaction:', type, target?.tagName, target?.closest('button')?.textContent?.trim())
    }, true)
    if (parent !== window) return
    window.fixture = state
    window.fixture.submits = 0
    window.fixture.push = (kind, value) => {
      window.fixture[kind] = value
      document.querySelector('iframe').contentWindow.postMessage({ hb: 1, event: kind, value }, '*')
    }
    const snapshot = () => Object.fromEntries(['hongbao', 'viewer', 'theme', 'clock', 'me', 'myView', 'view'].map(key => [key, window.fixture[key]]))
    window.fixture.releaseHello = () => {
      for (const message of window.fixture.held ?? []) message.source.postMessage({ hb: 1, re: message.id, value: snapshot() }, '*')
      window.fixture.held = []
    }
    window.addEventListener('message', async event => {
      const m = event.data
      if (m?.hb !== 1 || typeof m.id !== 'number') return
      if (state.debug) console.log('SDK request:', m.type)
      const reply = value => event.source.postMessage({ hb: 1, re: m.id, value }, '*')
      if (m.type === 'hello') {
        if (window.fixture.holdHello) { (window.fixture.held ??= []).push({ id: m.id, source: event.source }); return }
        reply(snapshot())
      } else if (m.type === 'identity') reply({ identified: true, token: `test-only-token:${window.fixture.userId}`, expiresAt: new Date(Date.now() + 600_000).toISOString(), user: { id: window.fixture.userId, name: window.fixture.me.name, username: 'fixture', level: null } })
      else if (m.type === 'mine') {
        const records = { total: window.fixture.mine.length, items: [...window.fixture.mine], next: null }
        if (window.fixture.holdMine) window.fixture.releaseMine = () => { window.fixture.holdMine = false; reply(records) }
        else reply(records)
      }
      else if (m.type === 'login') reply({ signedIn: true })
      else if (m.type === 'submit') {
        window.fixture.submits += 1
        const receipt = window.fixture.receipt
        const actor = window.fixture.userId
        const finish = () => {
        if (receipt.judged && actor === window.fixture.userId) {
          window.fixture.mine.unshift({ n: window.fixture.submits, at: new Date().toISOString(), input: m.input, claimed: receipt.claimed })
        }
        if (receipt.judged && window.fixture.accepted !== false && actor === window.fixture.userId) {
          const me = { ...window.fixture.me, ...(receipt.claimed ? { claim: { amount: receipt.amount, unit: receipt.unit, payment: 'paid' }, settled: true, open: false, why: 'already_claimed' } : receipt.settled ? { settled: true, open: false, why: 'already_claimed' } : {}) }
          window.fixture.push('me', me)
          window.fixture.push('myView', { summary: '最近一次评分', data: { v: 1, resultId: m.input, score: window.fixture.score ?? 80, remaining: window.fixture.remaining ?? 2, passed: receipt.claimed } })
        }
        reply(receipt)
        }
        if (window.fixture.holdSubmit) window.fixture.releaseSubmit = finish
        else finish()
      }
    })
  }, state)
  await page.goto(`${station}/__participant_harness`, { waitUntil: 'networkidle' })
  const frame = page.frameLocator('iframe')
  return { context, page, frame, uploads: () => uploadCount, galleryReads: () => galleryReads,
    imageReads: () => imageReads, likeBatches, likeTotals, releaseLike: () => releaseLike?.(),
    replaceGallery: items => { actors.get(currentActor).items = items }, releaseUpload: () => releaseUpload?.(),
    switchActor: async (id, name = '小明') => {
      currentActor = id
      if (!actors.has(id)) actors.set(id, { latest: null, items: [], remaining: 3 })
      await page.evaluate(({ id, name }) => {
        window.fixture.userId = id
        window.fixture.mine = []
        window.fixture.push('myView', null)
        window.fixture.push('me', { ...window.fixture.me, name, claim: null, settled: false, open: true, why: undefined })
      }, { id, name })
    },
  }
}

try {
  if (process.env.LIKES_ONLY !== '1') {
  {
    console.log('Checking initial loading guard')
    const { context, page, frame, uploads } = await fixture({ holdHello: true })
    await frame.getByRole('heading', { name: '正在核对参与状态' }).waitFor()
    assert.equal(await frame.locator('#photo').count(), 0, 'No chooser or form before checking platform state')
    await page.evaluate(() => { window.fixture.holdHello = false; window.fixture.releaseHello() })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    assert.equal(uploads(), 0)
    await context.close()
  }
  {
    console.log('Checking an unsubmitted score and exhausted attempts restored from gallery')
    const latest = { id: resultId, score: 85, challenge: '找猫', attempt: 3, remaining: 0, saved: false, nsfwScore: null, width: null, height: null }
    const { context, frame } = await fixture({ galleryLatest: latest, galleryRemaining: 0 })
    await frame.getByRole('heading', { name: '上传机会已用完' }).waitFor()
    await frame.getByRole('button', { name: '提交这次结果' }).waitFor()
    assert.equal(await frame.locator('#photo').count(), 0)
    assert.match(await frame.locator('.reward-preview').innerText(), /1\.00 LDC/)
    assert.match(await frame.locator('.score-result').innerText(), /本次未保存图片/)
    await context.close()
  }
  {
    console.log('Checking a verification outage keeps the final score manually retryable')
    const { context, page, frame, uploads } = await fixture({ score: 35, remaining: 0, accepted: false, receipt: { judged: true, claimed: false, reply: '暂时无法核验，请稍后提交同一结果' } })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('button', { name: '提交这次结果' }).click()
    assert.equal(uploads(), 1, 'The first explicit upload must run once')
    await frame.getByText('暂时无法核验，请稍后提交同一结果', { exact: true }).waitFor()
    assert.equal(await frame.getByRole('button', { name: '提交这次结果' }).isEnabled(), true)
    assert.equal(await page.evaluate(() => window.fixture.submits), 1, 'No automatic retry')
    await page.evaluate(() => { window.fixture.accepted = true; window.fixture.receipt = { judged: true, claimed: false, settled: true } })
    await frame.getByRole('button', { name: '提交这次结果' }).click()
    await frame.getByRole('heading', { name: '本次挑战已结算' }).waitFor()
    assert.equal(await page.evaluate(() => window.fixture.submits), 2)
    assert.equal(uploads(), 1, 'Retrying verification must reuse the existing score')
    await context.close()
  }
  {
    console.log('Checking same-name accounts cannot inherit claimed status')
    const { context, frame, switchActor } = await fixture({ me: { ...normalMe, claim: { amount: '0.50', unit: 'LDC', payment: 'paid' }, settled: true, open: false, why: 'already_claimed' } })
    await frame.getByRole('heading', { name: '奖励已领取' }).waitFor()
    await switchActor('456')
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    assert.equal(await frame.getByRole('heading', { name: '奖励已领取' }).count(), 0)
    assert.equal(await frame.locator('.claimed-reward, .score-result').count(), 0)
    await context.close()
  }
  {
    console.log('Checking same-name accounts clear private score, preview and exhausted attempts')
    const { context, frame, switchActor } = await fixture({ remaining: 0 })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('heading', { name: '上传机会已用完' }).waitFor()
    await switchActor('456')
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    assert.equal(await frame.locator('.score-result, .upload-preview, .file-meta').count(), 0)
    assert.match(await frame.locator('.challenge-summary').innerText(), /3\s*次/)
    assert.equal(await frame.locator('.gallery-item').count(), 0)
    await context.close()
  }
  {
    console.log('Checking a late upload reply cannot overwrite the next account workspace')
    const { context, page, frame, switchActor, releaseUpload } = await fixture({ holdUpload: true, remaining: 0 })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('heading', { name: '正在处理这张图片' }).waitFor()
    await switchActor('456')
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame, { ...picture, name: 'participant-b.png' })
    const response = page.waitForResponse(response => response.url().includes('/api/upload'))
    releaseUpload()
    await response
    await frame.getByText('participant-b.png', { exact: true }).waitFor()
    assert.equal(await frame.locator('.score-result, .gallery-item').count(), 0)
    assert.equal(await frame.getByRole('button', { name: '上传并评分' }).isEnabled(), true)
    await context.close()
  }
  {
    console.log('Checking a late claimed receipt cannot settle a same-name replacement account')
    const { context, page, frame, switchActor } = await fixture({ holdSubmit: true })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('button', { name: '提交这次结果' }).click()
    await page.waitForFunction(() => Boolean(window.fixture.releaseSubmit))
    await switchActor('456')
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await page.evaluate(() => window.fixture.releaseSubmit())
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    assert.equal(await frame.locator('.claimed-reward, .score-result').count(), 0)
    assert.equal(await frame.getByRole('heading', { name: '奖励已领取' }).count(), 0)
    assert.equal(await page.evaluate(() => window.fixture.submits), 1)
    await context.close()
  }
  {
    console.log('Checking delayed private records cannot clear the previous account pending marker')
    const { context, page, frame, switchActor } = await fixture({ holdMine: true, mine: [{ n: 1, at: '', input: resultId, claimed: false }], receipt: { judged: false, reason: 'unconfirmed' } })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('button', { name: '提交这次结果' }).click()
    await page.waitForFunction(() => Boolean(window.fixture.releaseMine))
    await switchActor('456')
    await page.evaluate(() => window.fixture.releaseMine())
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    const marker = await frame.locator('body').evaluate(() => window.sessionStorage.getItem('hb-image-challenge:pending:lifecycle-test:123'))
    assert.equal(JSON.parse(marker).resultId, resultId, 'A stale record lookup must not clear the original account marker')
    assert.equal(await frame.locator('.score-result, .claimed-reward').count(), 0)
    assert.equal(await frame.getByRole('heading', { name: '正在等待提交确认' }).count(), 0)
    await context.close()
  }
  {
    console.log('Checking NSFW reveal, modal dismissal, readable single-page layout and browser memory')
    const items = [
      { id: 'unknown-score', score: 88, nsfwScore: null, saved: true, createdAt: 3, own: false, width: 600, height: 800, passed: true },
      { id: 'sensitive-score', score: 30, nsfwScore: 90, saved: true, createdAt: 2, own: false, width: 800, height: 600, passed: false },
      { id: 'score-only', score: 42, nsfwScore: 10, saved: false, createdAt: 1, own: false, width: null, height: null, passed: false },
    ]
    const { context, page, frame } = await fixture({ galleryItems: items }, 320)
    await frame.locator('[data-gallery-id="unknown-score"] .gallery-photo').waitFor()
    await frame.getByRole('heading', { name: hongbao.title, exact: true }).waitFor()
    assert.equal(await frame.locator('nav, .site-header').count(), 0)
    assert.equal(await frame.locator('.gallery-photo[data-covered="true"]').count(), 2)
    assert.match(await frame.locator('[data-gallery-id="score-only"]').innerText(), /仅评分记录/)
    assert.doesNotMatch(await frame.locator('.gallery-columns').innerText(), /小明|代号|达标|你的|领取/)
    const fonts = await frame.locator('body').evaluate(() => [...document.querySelectorAll('main *')].filter(node => node.getClientRects().length && [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim())).map(node => ({ text: node.textContent.slice(0, 30), size: Number.parseFloat(getComputedStyle(node).fontSize) })).filter(node => node.size < 16))
    assert.deepEqual(fonts, [], 'Every visible body text is at least 16px')
    const unknown = frame.locator('[data-gallery-id="unknown-score"] .gallery-photo')
    await unknown.click()
    assert.equal(await unknown.getAttribute('data-covered'), 'false')
    assert.equal(await frame.locator('.gallery-photo[data-covered="true"]').count(), 1, 'Only one image is revealed')
    await unknown.click()
    await frame.getByRole('dialog', { name: '图片详情' }).waitFor()
    assert.equal(await frame.getByRole('button', { name: '关闭弹窗' }).evaluate(node => node === document.activeElement), true, 'Modal receives focus after portal mount')
    await page.keyboard.press('Escape')
    await frame.getByRole('dialog').waitFor({ state: 'hidden' })
    await frame.getByRole('button', { name: '怎么玩', exact: true }).click()
    await frame.getByRole('dialog', { name: '怎么玩' }).waitFor()
    await frame.locator('.modal-overlay').click({ position: { x: 2, y: 2 } })
    await frame.getByRole('dialog').waitFor({ state: 'hidden' })
    await frame.getByRole('button', { name: '浏览设置' }).click()
    await frame.getByRole('checkbox', { name: /直接显示 NSFW 图片/ }).check()
    await page.keyboard.press('Escape')
    await reloadChallenge(page)
    await frame.locator('[data-gallery-id="sensitive-score"] .gallery-photo[data-covered="false"]').waitFor()
    assert.ok(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '320px layout must fit')
    await page.screenshot({ path: 'shots/participant-gallery-mobile.png', fullPage: true })
    await context.close()
  }
  {
    console.log('Checking automatic insertion, stable columns, scroll anchoring and old-page retention')
    const items = Array.from({ length: 20 }, (_, index) => ({ id: `record-${index}`, score: 30 + index, nsfwScore: 5, saved: true, createdAt: 100 - index, own: false, width: 600, height: 800, passed: false }))
    const { context, page, frame, replaceGallery } = await fixture({ galleryItems: items, pageSize: 8 }, 1440)
    await frame.locator('[data-gallery-id="record-0"]').waitFor()
    await frame.getByRole('button', { name: '加载更早作品' }).click()
    await frame.locator('[data-gallery-id="record-15"]').waitFor()
    const body = frame.locator('body')
    const columns = await body.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-gallery-id]')].map(node => [node.dataset.galleryId, [...document.querySelectorAll('.gallery-column')].indexOf(node.parentElement)])))
    const anchor = await body.evaluate(() => {
      window.scrollTo(0, 1100)
      return [...document.querySelectorAll('[data-gallery-id]')].map(node => ({ id: node.dataset.galleryId, rect: node.getBoundingClientRect() })).filter(item => item.rect.bottom > 0 && item.rect.top < window.innerHeight).sort((a, b) => Math.max(0, a.rect.top) - Math.max(0, b.rect.top) || a.rect.left - b.rect.left).map(item => ({ id: item.id, top: item.rect.top }))[0]
    })
    replaceGallery([{ ...items[0], id: 'new-image', createdAt: 101 }, ...items])
    await page.evaluate(() => window.fixture.push('hongbao', { ...window.fixture.hongbao, judged: 2 }))
    await frame.locator('[data-gallery-id="new-image"]').waitFor()
    const after = await body.evaluate((node, id) => ({ top: node.querySelector(`[data-gallery-id="${id}"]`).getBoundingClientRect().top, columns: Object.fromEntries([...node.querySelectorAll('[data-gallery-id]')].map(item => [item.dataset.galleryId, [...node.querySelectorAll('.gallery-column')].indexOf(item.parentElement)])) }), anchor.id)
    assert.ok(Math.abs(after.top - anchor.top) <= 1, 'The visible image stays at the same viewport position')
    for (const [id, column] of Object.entries(columns)) assert.equal(after.columns[id], column, `${id} keeps its original column`)
    assert.equal(await frame.locator('[data-gallery-id="record-15"]').count(), 1, 'Previously paginated old images are retained')
    assert.equal(await frame.getByText(/张新图/).count(), 0, 'New images appear directly, without a click-to-refresh notice')
    await page.screenshot({ path: 'shots/participant-gallery-desktop.png', fullPage: true })
    await context.close()
  }
  for (const [name, overrides, title] of [
    ['claimed', { me: { ...normalMe, claim: { amount: '0.50', unit: 'LDC', payment: 'paid' }, settled: true, open: false, why: 'already_claimed' }, myView: { summary: null, data: { v: 1, score: 80, remaining: 2, passed: true } } }, '奖励已领取'],
    ['settled', { me: { ...normalMe, settled: true, open: false, why: 'already_claimed' } }, '本次挑战已结算'],
    ['ended', { hongbao: { ...hongbao, status: 'ended' } }, '本次活动已结束'],
  ]) {
    console.log(`Checking ${name}`)
    const { context, page, frame, uploads } = await fixture(overrides, name === 'claimed' ? 320 : 1440)
    await frame.getByRole('heading', { name: title }).waitFor()
    assert.equal(await frame.locator('#photo, form').count(), 0)
    assert.equal(await frame.getByRole('button', { name: '上传并评分' }).count(), 0)
    assert.equal(await frame.getByRole('link', { name: '回红包页查看记录' }).count(), 1)
    assert.ok(await frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} must fit`)
    await reloadChallenge(page)
    await frame.getByRole('heading', { name: title }).waitFor()
    assert.equal(uploads(), 0)
    await page.screenshot({ path: `shots/participant-${name}.png`, fullPage: true })
    await context.close()
  }
  {
    console.log('Checking a newly claimed reward remains closed after iframe reload')
    const { context, page, frame } = await fixture()
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('button', { name: '提交这次结果' }).click()
    await frame.getByRole('heading', { name: '奖励已领取' }).waitFor()
    assert.equal(await frame.locator('#photo').count(), 0)
    await reloadChallenge(page)
    await frame.getByRole('heading', { name: '奖励已领取' }).waitFor()
    assert.equal(await frame.locator('#photo').count(), 0)
    assert.equal(await page.evaluate(() => window.fixture.submits), 1)
    await context.close()
  }
  {
    console.log('Checking an accepted failed score allows a new image and restores after reload')
    const { context, page, frame } = await fixture({ score: 35, receipt: { judged: true, claimed: false, settled: false } })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('button', { name: '提交这次结果' }).click()
    await frame.getByRole('button', { name: '换张图片再试' }).waitFor()
    await frame.getByRole('button', { name: '换张图片再试' }).click()
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await reloadChallenge(page)
    await frame.locator('.score-result').getByText('35.0', { exact: false }).waitFor()
    assert.equal(await frame.locator('#photo').count(), 1)
    assert.equal(await page.evaluate(() => window.fixture.submits), 1)
    await context.close()
  }
  {
    console.log('Checking the final upload result can settle with zero reward')
    const { context, page, frame, uploads } = await fixture({ remaining: 0, score: 30, receipt: { judged: true, claimed: false, settled: true } })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('heading', { name: '上传机会已用完' }).waitFor()
    await frame.getByRole('button', { name: '提交这次结果' }).click()
    await frame.getByRole('heading', { name: '本次挑战已结算' }).waitFor()
    assert.equal(uploads(), 1)
    assert.equal(await page.evaluate(() => window.fixture.submits), 1)
    await context.close()
  }
  {
    console.log('Checking an unconfirmed submission survives reload and only reads personal records')
    const { context, page, frame, uploads } = await fixture({ receipt: { judged: false, reason: 'unconfirmed' } })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await chooseImage(frame)
    await frame.getByRole('button', { name: '上传并评分' }).click()
    await frame.getByRole('button', { name: '提交这次结果' }).click()
    await frame.getByRole('heading', { name: '正在等待提交确认' }).waitFor()
    await reloadChallenge(page)
    await frame.getByRole('heading', { name: '正在等待提交确认' }).waitFor()
    assert.equal(await frame.locator('#photo').count(), 0)
    assert.equal(await page.evaluate(() => window.fixture.submits), 1)
    await frame.getByRole('button', { name: '重新核对' }).click()
    assert.equal(await page.evaluate(() => window.fixture.submits), 1, 'Checking must never retry a reward submission')
    assert.equal(uploads(), 1)
    await page.evaluate(() => { window.fixture.mine = [{ n: 1, at: '', input: '2b990cc9-45da-44e2-8ce5-45a7bd6257d3', claimed: false }]; window.fixture.push('myView', { summary: null, data: { v: 1, score: 30, remaining: 2, passed: false } }) })
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => window.fixture.submits), 1)
    await context.close()
  }
  {
    console.log('Checking an activity-ended event closes uploading without making a request')
    const { context, page, frame, uploads } = await fixture()
    await frame.getByRole('button', { name: '选择图片', exact: true }).waitFor()
    await page.evaluate(() => window.fixture.push('hongbao', { ...window.fixture.hongbao, status: 'ended' }))
    await frame.getByRole('heading', { name: '本次活动已结束' }).waitFor()
    assert.equal(await frame.locator('#photo, form').count(), 0)
    assert.equal(uploads(), 0)
    await context.close()
  }
  }
  const likedImage = (id = resultId, createdAt = 1) => ({ id, createdAt, score: 35, saved: true, own: false, passed: false, nsfwScore: 2, width: 400, height: 600, likes: 0 })
  const pauseClock = async page => {
    const now = await page.evaluate(() => Date.now())
    await page.clock.pauseAt(new Date(now + 1_000))
  }
  const likesFixture = (overrides, width) => fixture({ ...overrides, clock: true }, width)
  const tap = async (button, count) => button.evaluate((element, count) => { for (let i = 0; i < count; i++) element.click() }, count)
  // Network responses arrive outside the paused browser clock. Let Query's
  // notification timers commit each response before observing its UI result.
  const settleClock = async (page, condition, message) => {
    for (let n = 0; n < 300; n++) {
      if (await condition()) return
      await page.clock.runFor(10)
      await delay(10)
    }
    assert.fail(message)
  }
  const waitCount = async (button, count) => {
    await settleClock(button.page(), async () => await button.count() > 0 && await button.getAttribute('aria-label') === `点赞，当前 ${count} 次`, `Expected visible like count ${count}`)
  }
  const waitSynced = button => settleClock(button.page(), async () => await button.getAttribute('data-pending') === 'false', 'Expected pending likes to be acknowledged')
  {
    console.log('Checking 300 optimistic taps, fixed 30s batch, preserved image/geometry and passive count refresh')
    const f = await likesFixture({ galleryItems: [{ ...likedImage(), score: 100, passed: true }], visibility: 'all' }, 390)
    const button = f.frame.locator('.gallery-like').first()
    await button.waitFor()
    await button.scrollIntoViewIfNeeded()
    await f.frame.locator('.private-image img').waitFor()
    await pauseClock(f.page)
    const reads = f.imageReads()
    const before = await f.frame.locator('[data-gallery-id]').first().boundingBox()
    await button.click()
    await tap(button, 299)
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 300 次')
    assert.equal(f.likeBatches.length, 0)
    assert.equal(await f.frame.getByRole('dialog').count(), 0, 'Heart must not open image details')
    await f.page.clock.runFor(29_900)
    await tap(button, 1)
    assert.equal(f.likeBatches.length, 0, 'Continued taps are local')
    await f.page.clock.runFor(100)
    await waitSynced(button)
    assert.equal(f.likeBatches.length, 1)
    assert.deepEqual(f.likeBatches[0].items, [{ id: resultId, count: 301 }])
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 301 次')
    assert.equal(f.imageReads(), reads, 'Likes never refetch an already loaded image')
    assert.deepEqual(await f.frame.locator('[data-gallery-id]').first().boundingBox(), before)
    f.likeTotals.set(resultId, 350)
    await f.page.clock.runFor(31_000)
    await waitCount(button, 350)
    assert.equal(f.likeBatches.length, 1, 'Passive refresh creates no extra write batch')
    f.likeTotals.set(resultId, 9_999)
    await f.frame.getByRole('button', { name: '刷新作品' }).click()
    await waitCount(button, 9_999)
    for (const width of [320, 360, 390, 1440]) {
      await f.page.setViewportSize({ width, height: 900 })
      await button.scrollIntoViewIfNeeded()
      const heart = await button.boundingBox()
      const score = await f.frame.locator('.gallery-score').first().boundingBox()
      const overlap = Math.max(0, Math.min(heart.x + heart.width, score.x + score.width) - Math.max(heart.x, score.x)) * Math.max(0, Math.min(heart.y + heart.height, score.y + score.height) - Math.max(heart.y, score.y))
      assert.equal(overlap, 0, `${width}px: a large like count must not cover a 100% score`)
      assert.ok(heart.height >= 44, 'Heart keeps a 44px touch target')
      assert.ok(await f.frame.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
      if (width === 390 || width === 1440) await f.page.screenshot({ path: `shots/gallery-likes-${width}.png`, fullPage: true })
    }
    await f.context.close()
  }
  {
    console.log('Checking taps during an in-flight batch survive its acknowledgement')
    const f = await likesFixture({ galleryItems: [likedImage()], holdLikes: true }, 1440)
    const button = f.frame.locator('.gallery-like').first()
    await button.waitFor()
    await pauseClock(f.page)
    await tap(button, 5)
    const started = f.page.waitForRequest(request => request.url().includes('/api/gallery') && request.postDataJSON()?.batch)
    await f.page.clock.runFor(30_000)
    await started
    assert.equal(f.likeBatches.length, 1)
    await tap(button, 3)
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 8 次')
    const acknowledged = f.page.waitForResponse(response => response.url().includes('/api/gallery') && response.request().postDataJSON()?.batch)
    f.releaseLike()
    await acknowledged
    await settleClock(f.page, () => f.frame.locator('body').evaluate(() => !JSON.parse(window.sessionStorage.getItem('hb-image-challenge:likes:lifecycle-test:123')).frozen), 'First frozen batch must be acknowledged before the next deadline')
    await f.page.clock.runFor(30_000)
    await waitSynced(button)
    assert.equal(f.likeBatches.length, 2)
    assert.equal(f.likeBatches[1].items[0].count, 3)
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 8 次')
    await f.context.close()
  }
  {
    console.log('Checking an accepted batch with a lost response recovers via a readonly receipt')
    const f = await likesFixture({ galleryItems: [likedImage()], loseLikeReply: true })
    const button = f.frame.locator('.gallery-like').first()
    await button.waitFor()
    await pauseClock(f.page)
    await tap(button, 4)
    await f.page.clock.runFor(30_000)
    await settleClock(f.page, () => f.frame.getByText('暂时无法更新作品；点赞已保留，将在恢复连接后同步。').isVisible(), 'Lost response must retain likes and report the connection failure')
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 4 次')
    await f.frame.getByRole('button', { name: '刷新作品' }).click()
    await waitSynced(button)
    assert.equal(f.likeBatches.length, 1, 'A readonly receipt query must not resubmit inside the gate')
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 4 次', 'No optimistic double count after lost response')
    assert.equal(f.likeTotals.get(resultId), 4)
    await f.context.close()
  }
  {
    console.log('Checking iframe reload preserves unsent likes and the original send deadline')
    const f = await likesFixture({ galleryItems: [likedImage()] })
    const button = f.frame.locator('.gallery-like').first()
    await button.waitFor()
    await pauseClock(f.page)
    await tap(button, 7)
    await f.page.clock.runFor(10_000)
    await reloadChallenge(f.page)
    await waitCount(button, 7)
    assert.equal(f.likeBatches.length, 0)
    await f.page.clock.runFor(19_000)
    assert.equal(f.likeBatches.length, 0, 'Reload must not reset or bypass the gate')
    await f.page.clock.runFor(1_000)
    await waitSynced(button)
    assert.equal(f.likeBatches.length, 1)
    assert.equal(f.likeTotals.get(resultId), 7)
    await f.context.close()
  }
  {
    console.log('Checking an offscreen card beyond 200 loaded images receives its acknowledged base count')
    const images = Array.from({ length: 220 }, (_, i) => likedImage(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, 220 - i))
    const f = await likesFixture({ galleryItems: images })
    await f.frame.locator('.gallery-like').first().waitFor()
    while (await f.frame.getByRole('button', { name: '加载更早作品' }).count()) {
      await f.frame.getByRole('button', { name: '加载更早作品' }).click()
      await f.frame.getByRole('button', { name: '正在加载', exact: true }).waitFor({ state: 'hidden' })
    }
    await pauseClock(f.page)
    const id = images.at(-1).id
    const button = f.frame.locator(`[data-gallery-id="${id}"] .gallery-like`)
    await button.click()
    await f.frame.locator('.gallery-heading').evaluate(element => element.scrollIntoView())
    await f.page.clock.runFor(30_000)
    await waitSynced(button)
    assert.equal(f.likeBatches.length, 1)
    assert.ok(f.likeBatches[0].watch.includes(id))
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 1 次')
    await f.context.close()
  }
  {
    console.log('Checking same-name numeric accounts keep separate pending outboxes')
    const f = await likesFixture({ galleryItems: [likedImage()] }, 320)
    const button = f.frame.locator('.gallery-like').first()
    await button.waitFor()
    await tap(button, 6)
    await f.switchActor('456')
    f.replaceGallery([likedImage()])
    await f.frame.getByRole('button', { name: '刷新作品' }).click()
    await f.frame.locator('.gallery-like').waitFor()
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 0 次')
    await tap(button, 2)
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 2 次')
    await f.switchActor('123')
    await f.frame.locator('.gallery-like').waitFor()
    assert.equal(await button.getAttribute('aria-label'), '点赞，当前 6 次')
    assert.equal(f.likeBatches.length, 0)
    await f.page.screenshot({ path: 'shots/gallery-likes-small.png', fullPage: true })
    await f.context.close()
  }
  assert.deepEqual(errors, [], 'No hydration or browser errors')
  console.log('Official SDK iframe: six batched-likes browser scenarios passed; lifecycle scenarios also run unless LIKES_ONLY=1.')
} catch (error) {
  console.log('Errors:', errors)
  console.log('Current fixture requests:', currentCounts?.())
  if (currentPage && !currentPage.isClosed()) {
    console.log('Frames:', currentPage.frames().map(frame => frame.url()))
    for (const frame of currentPage.frames()) console.log((await frame.locator('body').innerText()).slice(0, 3000))
  }
  throw error
} finally { await browser.close() }
