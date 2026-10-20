/**
 * 服务器端 E2E 用的极简 CDP 驱动（Node 22 自带 WebSocket）。
 * 只做本验收需要的事：起 Chromium、开一个 tab、求值、导航、截图。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME =
  process.env.E2E_BROWSER ||
  '/home/ubuntu/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class CDP {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.waiters = new Map()
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (!msg.id || !this.waiters.has(msg.id)) return
      const { resolve, reject, timer } = this.waiters.get(msg.id)
      this.waiters.delete(msg.id)
      clearTimeout(timer)
      if (msg.error) reject(new Error(`${msg.error.message} (${msg.error.code})`))
      else resolve(msg.result)
    }
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error(`连不上 CDP: ${url}`))
    })
    return new CDP(ws)
  }

  send(method, params = {}) {
    const id = ++this.seq
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiters.delete(id)) reject(new Error(`CDP 超时: ${method}`))
      }, 30_000)
      this.waiters.set(id, { resolve, reject, timer })
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      /* ignore */
    }
  }
}

export async function launch({ width = 1366, height = 900 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'gal-e2e-'))
  const proc = spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--hide-scrollbars',
      '--mute-audio',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--remote-debugging-port=0',
      `--window-size=${width},${height}`,
      ...(process.env.E2E_BROWSER_FLAGS ? process.env.E2E_BROWSER_FLAGS.split(/\s+/).filter(Boolean) : []),
      // 需要带空格的参数（如 --host-resolver-rules=MAP a 127.0.0.1）用 JSON 数组传
      ...(process.env.E2E_BROWSER_FLAGS_JSON ? JSON.parse(process.env.E2E_BROWSER_FLAGS_JSON) : []),
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  )

  const portFile = join(profile, 'DevToolsActivePort')
  for (let i = 0; i < 200 && !existsSync(portFile); i++) await sleep(100)
  if (!existsSync(portFile)) {
    proc.kill('SIGKILL')
    throw new Error('Chromium 没有写出 DevToolsActivePort')
  }
  const port = readFileSync(portFile, 'utf8').trim().split('\n')[0]
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const browser = await CDP.connect(version.webSocketDebuggerUrl)
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })

  let target = null
  for (let i = 0; i < 50 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
    target = list.find((t) => t.id === targetId) || null
    if (!target) await sleep(100)
  }
  if (!target) throw new Error('找不到新开的 tab')

  const page = await CDP.connect(target.webSocketDebuggerUrl)
  await page.send('Page.enable')
  await page.send('Runtime.enable')
  await page.send('Network.enable')

  async function evaluate(expression, { awaitPromise = true } = {}) {
    const r = await page.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    })
    if (r.exceptionDetails) {
      const desc =
        r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'unknown'
      throw new Error(`页面求值异常: ${desc.slice(0, 400)}`)
    }
    return r.result.value
  }

  /** 轮询一个返回真值的表达式；页面导航期间上下文销毁会自动重试 */
  async function waitFor(expression, timeoutMs = 20_000, label = '') {
    const started = Date.now()
    let lastErr = ''
    while (Date.now() - started < timeoutMs) {
      try {
        const v = await evaluate(expression)
        if (v) return v
      } catch (err) {
        lastErr = err.message
      }
      await sleep(120)
    }
    throw new Error(`等待超时${label ? `（${label}）` : ''}: ${expression.slice(0, 160)} ${lastErr}`)
  }

  async function goto(url, readyExpression = '!!document.querySelector(".gal-page")', timeoutMs = 30_000) {
    await page.send('Page.navigate', { url })
    await waitFor('document.readyState === "complete"', timeoutMs, 'load')
    if (readyExpression) await waitFor(readyExpression, timeoutMs, 'render')
  }

  async function clearCookies() {
    await page.send('Network.clearBrowserCookies')
  }

  async function setCookie(name, value, origin) {
    await page.send('Network.setCookie', {
      name,
      value,
      url: origin,
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    })
  }

  async function setViewport(w, h, { mobile = w < 700 } = {}) {
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile,
      screenWidth: w,
      screenHeight: h,
    })
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: mobile })
  }

  async function screenshot(path) {
    const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(path, Buffer.from(data, 'base64'))
  }

  async function close() {
    try {
      await browser.send('Browser.close')
    } catch {
      /* ignore */
    }
    browser.close()
    page.close()
    proc.kill('SIGKILL')
    await sleep(200)
    try {
      rmSync(profile, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }

  return { browser, page, evaluate, waitFor, goto, clearCookies, setCookie, setViewport, screenshot, close }
}
