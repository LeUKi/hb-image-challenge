/* global document, window */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://127.0.0.1:5173'
const htmlResponse = await fetch(base)
assert.equal(htmlResponse.status, 200)
const html = await htmlResponse.text()
assert.match(html, /这张图片里有一只猫/)
assert.doesNotMatch(html, /见图|A LITTLE IMAGE CHALLENGE|CURRENT CHALLENGE/)
const styles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(match => match[1])
assert.ok(styles.length, 'SSR must include its stylesheet before hydration')
for (const stylesheet of styles) assert.equal((await fetch(new URL(stylesheet, base))).status, 200)

await mkdir('shots', { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const errors = []

async function checkReadability(page, name) {
  const undersized = await page.locator('p, button, a, label, summary, dt, dd, input').evaluateAll(elements => elements
    .filter(element => element.getClientRects().length && (element.textContent?.trim() || element.tagName === 'INPUT'))
    .filter(element => Number.parseFloat(window.getComputedStyle(element).fontSize) < 16)
    .map(element => ({ text: element.textContent?.trim().slice(0, 50), size: window.getComputedStyle(element).fontSize })))
  assert.deepEqual(undersized, [], `${name}: visible text and controls must be at least 16px`)
  const choose = page.getByRole('button', { name: '选择图片', exact: true })
  if (await choose.isVisible()) assert.ok((await choose.boundingBox()).height >= 48, `${name}: image selection needs a 48px touch target`)
}

try {
  for (const [name, width, height] of [['desktop', 1440, 1050], ['mobile', 390, 844], ['narrow', 320, 720]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '选择图片' }).waitFor()
    await page.getByText('当前是玩法预览，可以选择图片。', { exact: false }).waitFor()
    assert.ok(await page.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} must not overflow`)
    assert.ok(await page.getByRole('button', { name: '请从红包页参与' }).isDisabled())
    await checkReadability(page, name)
    const guide = page.getByRole('button', { name: '怎么玩' })
    assert.equal(await guide.getAttribute('aria-expanded'), 'true', 'Initial guidance stays visible')
    await guide.click()
    assert.ok(await page.locator('#instructions').isHidden())
    await guide.click()
    assert.ok(await page.locator('#instructions').isVisible())
    await page.screenshot({ path: `shots/${name}.png`, fullPage: true })

    await page.locator('#photo').setInputFiles({ name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
    await page.getByRole('alert').filter({ hasText: '请选择 JPG' }).waitFor()
    if (name === 'mobile') await page.screenshot({ path: 'shots/mobile-error.png', fullPage: true })
    await page.locator('#photo').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=', 'base64') })
    await page.getByAltText('你选择的挑战图片').waitFor()
    assert.ok(await page.getByRole('button', { name: '请从红包页参与' }).isDisabled())
    assert.ok((await page.getByRole('button', { name: '移除图片' }).boundingBox()).height >= 44)
    await page.getByRole('button', { name: '移除图片' }).click()
    await page.getByRole('button', { name: '选择图片' }).waitFor()

    await page.getByRole('link', { name: '部署自己的服务' }).click()
    await page.getByRole('heading', { name: '部署图片挑战服务' }).waitFor()
    await checkReadability(page, `${name} setup`)
    await page.getByText('本地开发配置', { exact: true }).click()
    const id = page.getByLabel('LINUX DO 数字 ID')
    await id.fill('hello')
    await id.blur()
    await page.getByText('请输入 LINUX DO 数字 ID', { exact: true }).waitFor()
    await id.fill('10000')
    assert.ok(await page.getByRole('button', { name: '复制本地开发配置' }).isEnabled())
    assert.ok(await page.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} setup must not overflow`)
    await checkReadability(page, `${name} setup form`)
    await page.screenshot({ path: `shots/${name === 'desktop' ? 'setup' : `${name}-setup`}.png`, fullPage: true })
    await context.close()
  }
  assert.deepEqual(errors, [], 'No browser errors or hydration failures')
  console.log('SSR HTML + CSS, 1440/390/320px, 16px minimum readable text, touch targets, initial guidance, upload selection, validation, removal, navigation and author form: passed')
} finally {
  await browser.close()
}
