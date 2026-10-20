#!/usr/bin/env node
/**
 * P4 验收：真实浏览器跑通「注册 → 刷新仍登录 → 退出 → 再登录」。
 *
 * 为什么不用 curl：P3 的 smoke-auth.mjs 已经用 curl + 手工 cookie jar 覆盖了 API 层，
 * 但它验证不了浏览器真正在意的那几件事——
 *   · cookie 的 path=/ 、SameSite=Strict、Secure 在真实浏览器里到底认不认
 *   · 刷新页面后 ensureLoaded() 能不能从 httpOnly cookie 恢复登录态
 *   · Vue 的 v-model / 路由跳转 / 顶栏条件渲染是否真的接对了
 * 这些只有真跑一个浏览器才算数。
 *
 * 实现上用 CDP（Chrome DevTools Protocol）直连 Edge，不装 playwright/puppeteer——
 * Node 24 自带 WebSocket，几十行就够，也省得为一次性验收拉几百 MB 依赖。
 *
 * 验证码不读邮箱，走和 smoke-auth.mjs 同一套路：从库里取 codeHash 反推。
 * 用法：SSH_PASS=... node scripts/cdp-e2e-auth.mjs
 *       KEEP=1 保留测试账号（默认跑完删掉）
 */
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.E2E_BASE || 'https://yuehua.online'
const EMAIL = process.env.E2E_EMAIL || '301@301.group'
const PASSWORD = 'E2e-' + randomBytes(6).toString('hex')
const NICKNAME = '浏览器验收'
const SSH_HOST = process.env.E2E_SSH_HOST || '2'
const PORT = Number(process.env.E2E_CDP_PORT || 9333)

const EDGE_CANDIDATES = [
  process.env.E2E_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean)

// Node 是原生 Windows 进程，不认 MSYS 的 /usr/bin/ssh —— 必须给 .exe 全路径
const SSH_CANDIDATES = [
  process.env.E2E_SSH,
  'C:\\Program Files\\Git\\usr\\bin\\ssh.exe',
  'C:\\Program Files (x86)\\Git\\usr\\bin\\ssh.exe',
  'ssh',
].filter(Boolean)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── 断言收集 ────────────────────────────────────────────────
const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 260) })
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  — ${detail}` : ''}`)
  return !!ok
}

// ── 服务端取验证码 ──────────────────────────────────────────
function sshR(remoteCmd) {
  const ssh = SSH_CANDIDATES.find((p) => p === 'ssh' || existsSync(p))
  if (!ssh) throw new Error('找不到 ssh.exe，可用 E2E_SSH 指定')
  const out = execFileSync(
    ssh,
    [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'NumberOfPasswordPrompts=1',
      '-o', 'ConnectTimeout=20',
      SSH_HOST,
      remoteCmd,
    ],
    {
      encoding: 'utf8',
      input: '',   // 关键：stdin 给空，逼 ssh 走 askpass 而不是从 stdin 读密码
      timeout: 90_000,
      env: {
        ...process.env,
        SSH_ASKPASS: '/tmp/ssh-askpass.sh',
        SSH_ASKPASS_REQUIRE: 'force',
        DISPLAY: ':0',
      },
    },
  )
  return out.trim()
}

function mysqlR(sql) {
  return sshR(`sudo mysql -N -B aiq_course -e ${JSON.stringify(sql)}`)
}

/** 清掉本应用的限流计数键。db1 + aiq: 前缀是本项目独占的，不会碰到别的站 */
function redisFlush() {
  return sshR(
    `sudo redis-cli -n 1 --scan --pattern 'aiq:*' | xargs -r sudo redis-cli -n 1 DEL | wc -l`,
  )
}

function crackCode(email, codeHash) {
  for (let i = 0; i < 1_000_000; i++) {
    const code = String(i).padStart(6, '0')
    if (createHash('sha256').update(`${email}:${code}`).digest('hex') === codeHash) return code
  }
  return null
}

function latestCodeHash(email) {
  const safe = email.replace(/'/g, "''")
  return mysqlR(
    `SELECT codeHash FROM email_registration_codes WHERE email='${safe}' ORDER BY id DESC LIMIT 1`,
  )
}

function cleanup() {
  const safe = EMAIL.replace(/'/g, "''")
  // 护栏：只删昵称与脚本注册时一致的测试账号，防止 E2E_EMAIL 被误设成真人邮箱后静默删号
  const nick = mysqlR(`SELECT nickname FROM users WHERE email='${safe}'`).trim()
  if (nick && nick !== NICKNAME && process.env.SMOKE_FORCE !== '1') {
    throw new Error(`拒绝清理：${EMAIL} 昵称是「${nick}」，不像测试账号（确认可删设 SMOKE_FORCE=1）`)
  }
  mysqlR(
    `DELETE FROM users WHERE email='${safe}'; DELETE FROM email_registration_codes WHERE email='${safe}';`,
  )
}

// ── 极简 CDP 客户端 ─────────────────────────────────────────
class CDP {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.handlers = new Map()
    ws.onmessage = (ev) => this._onMessage(JSON.parse(ev.data))
  }

  static async connect(url) {
    const ws = new WebSocket(url)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = () => reject(new Error(`连不上 CDP: ${url}`))
    })
    return new CDP(ws)
  }

  _onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? '')})`))
      else resolve(msg.result)
      return
    }
    if (msg.method) {
      const key = `${msg.sessionId || ''}:${msg.method}`
      const set = this.handlers.get(key)
      if (set) for (const h of [...set]) h(msg.params)
    }
  }

  send(method, params = {}, sessionId) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }

  once(key, timeoutMs = 45_000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.handlers.get(key)?.delete(h)
        reject(new Error(`等待事件超时: ${key}`))
      }, timeoutMs)
      const h = (p) => {
        clearTimeout(t)
        this.handlers.get(key)?.delete(h)
        resolve(p)
      }
      if (!this.handlers.has(key)) this.handlers.set(key, new Set())
      this.handlers.get(key).add(h)
    })
  }
}

// 页面侧小工具。用 addScriptToEvaluateOnNewDocument 注入，
// 这样每次导航（包括 reload）都自动可用，不用重复内联。
const PAGE_HELPERS = `
// ElMessage 几秒就自动消失，事后去 DOM 里捞是捞不到的。
// 挂个轮询把它们全记下来，失败时才有线索可看。
window.__aiqLog = [];
setInterval(function () {
  var nodes = document.querySelectorAll('.el-message, .el-message-box__message');
  for (var i = 0; i < nodes.length; i++) {
    var t = (nodes[i].innerText || '').trim();
    if (t && window.__aiqLog.indexOf(t) === -1) window.__aiqLog.push(t);
  }
}, 150);

window.__aiq = {
  set(sel, val) {
    const el = document.querySelector(sel)
    if (!el) throw new Error('找不到输入框: ' + sel)
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(el, val)
    // Vue 的 v-model 监听原生 input 事件，直接改 .value 它是不会知道的
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.value
  },
  click(text) {
    const norm = (s) => s.replace(/\\s+/g, '')
    const want = norm(text)
    // 排除顶栏：登录页顶栏也有个「登录」按钮，不排除会点错
    const cands = [...document.querySelectorAll('button')].filter(b => !b.closest('header'))
    const b = cands.find(x => norm(x.textContent) === want)
    if (!b) throw new Error('找不到按钮: ' + text + ' / 候选: ' + cands.map(x=>norm(x.textContent)).join('|'))
    b.click()
    return true
  },
  hash: () => location.hash,
  body: () => document.body.innerText.replace(/\\s+/g, ' '),
  toasts: () => [...document.querySelectorAll('.el-message')].map(e => e.innerText.trim()),
  toastLog: () => window.__aiqLog.slice(),
  headerText: () => (document.querySelector('header') || document.body).innerText.replace(/\\s+/g,' '),
  user() {
    const app = document.querySelector('#app') && document.querySelector('#app').__vue_app__
    if (!app) return { mounted: false }
    const s = app.config.globalProperties.$pinia._s.get('user')
    return { mounted: true, isLoggedIn: s.isLoggedIn, nickname: s.nickname, email: s.user && s.user.email }
  },
  busy: () => !!document.querySelector('.el-button.is-loading'),
}
`

async function main() {
  const edge = EDGE_CANDIDATES.find((p) => existsSync(p))
  if (!edge) throw new Error('找不到 Edge/Chrome，可用 E2E_BROWSER 指定路径')
  console.log(`浏览器: ${edge}`)
  console.log(`目标:   ${BASE}`)
  console.log(`账号:   ${EMAIL}\n`)

  if (process.env.E2E_FLUSH === '1') {
    // 上一次跑留下的 60 秒发码冷却会让这次假失败。限流本身已由 P3 的
    // smoke-auth.mjs 覆盖，这里只测前端接线，先清干净保证可重复。
    console.log(`已清空限流计数键: ${redisFlush()} 个\n`)
  }

  const userDataDir = mkdtempSync(join(tmpdir(), 'aiq-e2e-'))
  const proc = spawn(
    edge,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=Translate,AcceptCHFrame',
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let browser = null
  try {
    // 等调试端口起来
    let version = null
    for (let i = 0; i < 60 && !version; i++) {
      try {
        version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
      } catch {
        await sleep(500)
      }
    }
    if (!version) throw new Error(`Edge 调试端口 ${PORT} 没起来`)
    console.log(`内核:   ${version.Browser}\n`)

    browser = await CDP.connect(version.webSocketDebuggerUrl)
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId: sid } = await browser.send('Target.attachToTarget', { targetId, flatten: true })

    await browser.send('Page.enable', {}, sid)
    await browser.send('Runtime.enable', {}, sid)
    await browser.send('Network.enable', {}, sid)
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: PAGE_HELPERS }, sid)

    const evalJS = async (expr) => {
      const r = await browser.send(
        'Runtime.evaluate',
        { expression: expr, awaitPromise: true, returnByValue: true },
        sid,
      )
      if (r.exceptionDetails) {
        throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails)))
      }
      return r.result.value
    }

    const goto = async (url) => {
      const target = new URL(url)
      const cur = new URL(await evalJS('location.href'))
      // 只差 hash 属于同文档导航，Page.loadEventFired 根本不会触发，
      // 傻等就是超时。这种情况下直接改 hash 让 vue-router 自己响应。
      if (target.origin === cur.origin && target.pathname === cur.pathname) {
        await evalJS(`location.hash = ${JSON.stringify(target.hash || '')}`)
      } else {
        const loaded = browser.once(`${sid}:Page.loadEventFired`)
        await browser.send('Page.navigate', { url }, sid)
        await loaded
      }
      await sleep(2500) // 等 Vue 挂载 + 异步 chunk 落地
    }

    // hash 变了不等于页面渲染好了：路由组件是懒加载的，chunk 还在路上。
    // 要断言内容就得轮询内容本身，不能靠 sleep 赌时间。
    const waitFor = async (expr, timeoutMs = 15_000) => {
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        try {
          if (await evalJS(expr)) return true
        } catch {
          /* 组件还没挂载时选择器会抛，忽略继续轮询 */
        }
        await sleep(250)
      }
      return false
    }

    // 必须精确匹配：'#/verify-email'.startsWith('#/') 是 true，
    // 用前缀匹配会把「还停在验证页」误判成「已跳到首页」。
    const waitHash = async (wanted, timeoutMs = 20_000) => {
      const want = Array.isArray(wanted) ? wanted : [wanted]
      const t0 = Date.now()
      while (Date.now() - t0 < timeoutMs) {
        const h = await evalJS('location.hash')
        if (want.includes(h)) return h
        await sleep(250)
      }
      return await evalJS('location.hash')
    }

    // 页面报错要抓出来——否则白屏时只会看到一堆「找不到元素」
    const pageErrors = []
    browser.handlers.set(`${sid}:Runtime.exceptionThrown`, new Set())
    browser.handlers.get(`${sid}:Runtime.exceptionThrown`).add((p) => {
      pageErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || '?')
    })

    // ══ 1. 初始状态：未登录 ═══════════════════════════════
    console.log('【1】未登录初始状态')
    await goto(`${BASE}/`)
    check('页面挂载成功（#app 内非空）', (await evalJS('document.querySelector("#app").children.length')) > 0)
    const st0 = await evalJS('__aiq.user()')
    check('store 里 isLoggedIn=false', st0.mounted && st0.isLoggedIn === false, JSON.stringify(st0))
    check('顶栏显示「登录」按钮', (await evalJS('__aiq.headerText()')).includes('登录'))

    // ══ 2. 注册页填表发码 ════════════════════════════════
    console.log('\n【2】注册并发送验证码')
    await goto(`${BASE}/#/register`)
    check('注册页标题正确', (await evalJS('__aiq.body()')).includes('注册账号'))

    await evalJS(`__aiq.set('input[placeholder^="you@example.com"]', ${JSON.stringify(EMAIL)})`)
    await evalJS(`__aiq.set('input[placeholder="展示在作品展厅里的名字"]', ${JSON.stringify(NICKNAME)})`)
    await evalJS(`__aiq.set('input[placeholder="至少 8 位"]', ${JSON.stringify(PASSWORD)})`)
    await evalJS(`__aiq.set('input[placeholder="再输一次"]', ${JSON.stringify(PASSWORD)})`)
    check(
      '四个输入框都写进去了',
      (await evalJS(`document.querySelector('input[placeholder="再输一次"]').value`)) === PASSWORD,
    )

    await evalJS(`__aiq.click('发送验证码并继续')`)
    await sleep(1500)
    const h2 = await waitHash('#/verify-email', 15_000)
    check(
      '发码后跳到 /verify-email',
      h2 === '#/verify-email',
      h2 === '#/verify-email'
        ? h2
        : `${h2} | 页面提示=${JSON.stringify(await evalJS('__aiq.toastLog()'))}`,
    )
    await waitFor(`document.body.innerText.includes(${JSON.stringify(EMAIL)})`)
    const body2 = await evalJS('__aiq.body()')
    check('验证页显示收件邮箱', body2.includes(EMAIL), body2.slice(0, 110))
    check(
      '重发倒计时已启动（60 秒冷却）',
      /\d+\s*秒后可重新发送/.test(body2),
      (body2.match(/[^。]*秒后可重新发送/) || ['(没找到)'])[0],
    )

    // ══ 3. 反推验证码并完成注册 ══════════════════════════
    console.log('\n【3】校验验证码、完成注册')
    const codeHash = latestCodeHash(EMAIL)
    check('库里存的是 codeHash 且已落库', /^[0-9a-f]{64}$/.test(codeHash), codeHash.slice(0, 16) + '…')
    const code = crackCode(EMAIL, codeHash)
    check('能从 codeHash 反推出 6 位码', !!code)

    await evalJS(`__aiq.set('input[placeholder="······"]', ${JSON.stringify(code)})`)
    await evalJS(`__aiq.click('完成注册')`)
    const h3 = await waitHash(['#/', '', '#'], 25_000)
    check('注册成功后跳到首页', ['#/', '', '#'].includes(h3), h3)

    const st1 = await evalJS('__aiq.user()')
    check('store 里 isLoggedIn=true', st1.isLoggedIn === true, JSON.stringify(st1))
    check('昵称正确回填', st1.nickname === NICKNAME, String(st1.nickname))
    check('邮箱正确回填', st1.email === EMAIL, String(st1.email))
    check('顶栏换成账号菜单（含昵称）', (await evalJS('__aiq.headerText()')).includes(NICKNAME))
    check('顶栏不再有「登录」按钮', !(await evalJS('__aiq.headerText()')).includes('登录'))

    // ══ 4. 刷新页面仍登录（cookie 真实持久化）════════════
    console.log('\n【4】刷新页面 → 仍登录（httpOnly cookie 跨刷新生效）')
    // 用 Network.getCookies（会话级）而不是 getAllCookies——后者在 Edge 155 上已经没了
    const before = await browser.send('Network.getCookies', { urls: [`${BASE}/`] }, sid)
    const sess = before.cookies.find((c) => c.name === 'aiq_session')
    check('浏览器确实存下了 aiq_session', !!sess)
    if (sess) {
      check('cookie Path=/ （不是 /api/auth）', sess.path === '/', sess.path)
      check('cookie HttpOnly', sess.httpOnly === true)
      check('cookie Secure', sess.secure === true)
      check('cookie SameSite=Strict', String(sess.sameSite).toLowerCase() === 'strict', sess.sameSite)
    }

    const reloaded = browser.once(`${sid}:Page.loadEventFired`)
    await browser.send('Page.reload', {}, sid)
    await reloaded
    await waitFor('__aiq.user().mounted === true')
    await sleep(1500) // 再给 ensureLoaded() 的 /api/auth/me 一点时间落地
    const st2 = await evalJS('__aiq.user()')
    check('刷新后 store 仍是登录态', st2.isLoggedIn === true, JSON.stringify(st2))
    check('刷新后顶栏仍显示昵称', (await evalJS('__aiq.headerText()')).includes(NICKNAME))

    // ══ 5. 退出登录 ═════════════════════════════════════
    console.log('\n【5】退出登录')
    check('调 store.logout() 成功', (await evalJS(`
      (async () => {
        const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('user')
        await s.logout()
        return true
      })()
    `)) === true)
    await sleep(1200)
    const st4 = await evalJS('__aiq.user()')
    check('退出后 isLoggedIn=false', st4.isLoggedIn === false, JSON.stringify(st4))

    const after = await browser.send('Network.getCookies', { urls: [`${BASE}/`] }, sid)
    const sess2 = after.cookies.find((c) => c.name === 'aiq_session' && c.value)
    check('aiq_session 已被清掉', !sess2, sess2 ? '仍有值' : '')

    const reloaded2 = browser.once(`${sid}:Page.loadEventFired`)
    await browser.send('Page.reload', {}, sid)
    await reloaded2
    await waitFor('__aiq.user().mounted === true')
    await sleep(1500)
    check('刷新后仍是未登录', (await evalJS('__aiq.user()')).isLoggedIn === false)
    check('顶栏回到「登录」按钮', (await evalJS('__aiq.headerText()')).includes('登录'))

    // ══ 6. 用同一账号重新登录 ═══════════════════════════
    console.log('\n【6】重新登录')
    await goto(`${BASE}/#/login`)
    await evalJS(`__aiq.set('input[placeholder="you@example.com"]', ${JSON.stringify(EMAIL)})`)
    await evalJS(`__aiq.set('input[placeholder="请输入密码"]', ${JSON.stringify(PASSWORD)})`)
    await evalJS(`__aiq.click('登录')`)
    await sleep(3500)
    const st5 = await evalJS('__aiq.user()')
    check('登录成功', st5.isLoggedIn === true, JSON.stringify(st5))
    const h6 = await waitHash(['#/', '', '#'], 8000)
    check('跳回首页', ['#/', '', '#'].includes(h6), h6)

    // ══ 7. 密码错误的提示 ═══════════════════════════════
    console.log('\n【7】错误密码应有中文提示')
    await evalJS(`
      (async () => {
        const s = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('user')
        await s.logout()
      })()
    `)
    await sleep(800)
    await goto(`${BASE}/#/login`)
    await evalJS(`__aiq.set('input[placeholder="you@example.com"]', ${JSON.stringify(EMAIL)})`)
    await evalJS(`__aiq.set('input[placeholder="请输入密码"]', 'WrongPass-12345')`)
    await evalJS(`__aiq.click('登录')`)
    await sleep(3000)
    const toasts = await evalJS('__aiq.toasts()')
    check('弹出错误提示', toasts.length > 0, JSON.stringify(toasts))
    check('提示是中文', toasts.some((t) => /[\u4e00-\u9fa5]/.test(t)), JSON.stringify(toasts))
    check('仍未登录', (await evalJS('__aiq.user()')).isLoggedIn === false)

    // ══ 8. 页面控制台无异常 ═════════════════════════════
    console.log('\n【8】页面运行时异常')
    check('全程无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))

    // ══ 汇总 ════════════════════════════════════════════
    const failed = results.filter((r) => !r.ok)
    console.log(`\n${'─'.repeat(56)}`)
    console.log(`总计 ${results.length} 项，通过 ${results.length - failed.length}，失败 ${failed.length}`)
    if (failed.length) {
      console.log('\n失败项：')
      for (const f of failed) console.log(`  ✗ ${f.name}  ${f.detail}`)
    }
    process.exitCode = failed.length ? 1 : 0
  } finally {
    try { browser?.ws?.close() } catch {}
    try { proc.kill() } catch {}
    await sleep(500)
    try { rmSync(userDataDir, { recursive: true, force: true }) } catch {}
    if (process.env.KEEP !== '1') {
      try {
        cleanup()
        console.log('（测试账号已清理）')
      } catch (e) {
        console.log('（清理失败，需手工删：' + EMAIL + '）', e.message)
      }
    } else {
      console.log('（KEEP=1，保留测试账号）')
    }
  }
}

main().catch((e) => {
  console.error('\n致命错误:', e.message)
  process.exitCode = 1
})
