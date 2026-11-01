/* global document, window */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const base = process.env.BASE_URL || 'http://127.0.0.1:5173'
const htmlResponse = await fetch(base)
assert.equal(htmlResponse.status, 200)
const html = await htmlResponse.text()
assert.match(html, /让图片，来回答/)
assert.match(html, /这张图片里有一只猫/)
const styles = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(match => match[1])
assert.ok(styles.length, 'SSR must include its stylesheet before hydration')
for (const stylesheet of styles) assert.equal((await fetch(new URL(stylesheet, base))).status, 200)

await mkdir('shots', { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const errors = []
try {
  for (const [name, width, height] of [['desktop', 1440, 1050], ['mobile', 390, 844], ['narrow', 320, 720]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: '选择图片' }).waitFor()
    await page.getByText('这里可以预览玩法和选择图片。', { exact: false }).waitFor()
    assert.ok(await page.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} must not overflow`)
    assert.ok(await page.getByRole('button', { name: '请从红包页参与' }).isDisabled())
    await page.screenshot({ path: `shots/${name}.png`, fullPage: true })

    await page.locator('#photo').setInputFiles({ name: 'test.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
    await page.getByRole('alert').filter({ hasText: '请选择 JPG' }).waitFor()
    await page.locator('#photo').setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=', 'base64') })
    await page.getByAltText('你选择的挑战图片').waitFor()
    assert.ok(await page.getByRole('button', { name: '请从红包页参与' }).isDisabled())
    await page.getByRole('button', { name: '移除图片' }).click()
    await page.getByRole('button', { name: '选择图片' }).waitFor()

    await page.getByRole('link', { name: '部署自己的服务' }).click()
    await page.getByRole('heading', { name: '你的挑战，你的服务。' }).waitFor()
    const id = page.getByLabel('LINUX DO 数字 ID')
    await id.fill('hello')
    await id.blur()
    await page.getByText('请输入 LINUX DO 数字 ID', { exact: true }).waitFor()
    await id.fill('10000')
    assert.ok(await page.getByRole('button', { name: '复制本地开发配置' }).isEnabled())
    assert.ok(await page.locator('body').evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name} setup must not overflow`)
    if (name === 'desktop') await page.screenshot({ path: 'shots/setup.png', fullPage: true })
    await context.close()
  }
  assert.deepEqual(errors, [], 'No browser errors or hydration failures')
  console.log('SSR HTML + CSS, 1440/390/320px, upload selection, validation, removal, navigation and author form: passed')
} finally {
  await browser.close()
}
