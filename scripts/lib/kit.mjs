/**
 * 冒烟测试公共件。
 *
 * ⚠️ 这些脚本设计为**在服务器上**运行：`mysql()` 依赖 `sudo mysql`，
 * `flushRateLimits()` 依赖本机 `redis-cli`。不要在本地直连生产库跑。
 *
 * 关于「怎么拿到验证码」：不去读邮箱，而是从数据库取 codeHash 再暴力反推。
 * 码空间只有 90 万种，sha256 跑一遍一两秒。这样脚本无需邮箱密码，
 * 也不需要后端开后门接口——**任何**能让验证码生效的捷径，在生产里都是漏洞；
 * 测试用途不值得为它降低安全性。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

// ── 断言 ────────────────────────────────────────────────────
export function makeChecker() {
  let passed = 0
  let failed = 0
  const failures = []

  return {
    check(name, cond, detail = '') {
      if (cond) {
        passed++
        console.log(`  ✅ ${name}`)
      } else {
        failed++
        failures.push(name)
        console.log(`  ❌ ${name}${detail ? `  → ${detail}` : ''}`)
      }
      return !!cond
    },
    /** 打印汇总并返回失败数，调用方据此设 exitCode */
    summary() {
      console.log(`\n${'─'.repeat(46)}`)
      console.log(`结果：${passed} 通过 / ${failed} 失败`)
      if (failures.length) {
        console.log('\n失败项：')
        for (const f of failures) console.log(`  ❌ ${f}`)
      }
      return failed
    },
  }
}

// ── 数据库 ──────────────────────────────────────────────────
export function mysql(sql) {
  return execFileSync('sudo', ['mysql', '-N', '-B', 'aiq_course', '-e', sql], { encoding: 'utf8' })
}

// ── HTTP 客户端（带浏览器式 cookie jar）─────────────────────
/**
 * 用 jar 而不是手工传 cookie 字符串，这一步不能省：
 * `logout` 在无状态 JWT 方案里就是「回一个 Set-Cookie 让浏览器删掉」，
 * 服务端并没有、也无法撤销已经签发出去的 token。测试如果手工传 cookie
 * 而不理会 Set-Cookie，就会误判成「登出无效」——第一版就踩了这个坑。
 */
export function makeClient(base) {
  let jar = ''
  const cookieName = 'aiq_session'

  async function call(path, { method = 'GET', body, cookie } = {}) {
    const useCookie = cookie !== undefined ? cookie : jar
    const res = await fetch(base + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(useCookie ? { cookie: useCookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON（比如 nginx 的 HTML 错误页），留给调用方断言 */
    }

    const sc = res.headers.get('set-cookie') || ''
    if (sc) {
      const m = sc.match(new RegExp(`${cookieName}=([^;]*)`))
      // 空值 = 服务端要求删除，跟浏览器一样把 jar 清掉
      if (m) jar = m[1] ? `${cookieName}=${m[1]}` : ''
    }
    return { status: res.status, json, text, setCookie: sc }
  }

  return {
    call,
    get jar() {
      return jar
    },
    clearJar() {
      jar = ''
    },
  }
}

// ── 验证码反推 ──────────────────────────────────────────────
export function crackCode(email, codeHash) {
  for (let n = 100000; n < 1000000; n++) {
    const code = String(n)
    if (createHash('sha256').update(`${email}:${code}`).digest('hex') === codeHash) return code
  }
  return null
}

export function latestCodeHash(email) {
  const safe = email.replace(/'/g, "''")
  return mysql(
    `SELECT codeHash FROM email_registration_codes WHERE email='${safe}' ORDER BY id DESC LIMIT 1`,
  ).trim()
}

// ── 限流清理 ────────────────────────────────────────────────
/**
 * 清掉限流键，保证脚本可以连着跑第二次。
 *
 * 必须连 **IP 维度**一起清：脚本是直连 127.0.0.1:3020 的，不带
 * x-real-ip 头，所以后端眼里所有请求都来自 127.0.0.1，几轮跑下来会把
 * 机房级的额度耗光，后面就开始误报「注册过于频繁」——那是限流在正常工作，
 * 不是 bug，但会让脚本自己把自己绊倒。
 */
export function flushRateLimits(base, email) {
  const host = (() => {
    try {
      return new URL(base).hostname
    } catch {
      return ''
    }
  })()
  const ips = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', host])

  const keys = [`aiq:sc:mail:${email}`, `aiq:vc:fail:${email}`, `aiq:lg:lock:${email}`]
  for (const ip of ips) {
    if (!ip) continue
    keys.push(
      `aiq:sc:ip:${ip}`,
      `aiq:sc:ipd:${ip}`,
      `aiq:vc:ip:${ip}`,
      `aiq:rg:ip:${ip}`,
      `aiq:rg:ipd:${ip}`,
      `aiq:lg:ip:${ip}`,
    )
  }

  try {
    execFileSync('redis-cli', ['-n', '1', 'DEL', ...keys], { encoding: 'utf8', stdio: 'pipe' })
  } catch {
    console.log('  ⚠️  没清掉限流键（redis-cli 不可用？），连跑两次可能误报限流\n')
  }
}

/**
 * 删掉测试账号。进度/作品/点赞有 onDelete: Cascade，会跟着一起没。
 *
 * ⚠️ 护栏：只删「看起来确实是本脚本注册的测试账号」的行——昵称必须严格等于
 * 脚本注册时用的 expectedNickname。SMOKE_EMAIL 可能被误设成真人邮箱，
 * 而删号不可逆（级联清掉进度/作品/点赞），所以不匹配就拒绝启动；
 * 确认可删时用 SMOKE_FORCE=1 明确压过护栏。
 */
export function cleanupUser(base, email, expectedNickname) {
  const safe = email.replace(/'/g, "''")
  const nick = mysql(`SELECT nickname FROM users WHERE email='${safe}'`).trim()
  if (nick && nick !== expectedNickname && process.env.SMOKE_FORCE !== '1') {
    console.error(`\n⛔ 拒绝清理：${email} 已存在，但昵称是「${nick}」，不像本脚本的测试账号。`)
    console.error('   护栏防的是误删真人账号。确认可以删再设 SMOKE_FORCE=1 重跑。\n')
    process.exit(1)
  }
  mysql(
    `DELETE FROM users WHERE email='${safe}'; DELETE FROM email_registration_codes WHERE email='${safe}';`,
  )
  flushRateLimits(base, email)
}

// ── 完整注册（三段式）──────────────────────────────────────
/**
 * 跑完「发码 → 反推验证码 → 换 proof → 注册」并返回已登录的 user。
 * 失败直接抛，因为后续断言全都依赖这个前置状态。
 */
export async function registerUser(client, { email, password, nickname }) {
  const sent = await client.call('/api/auth/send-code', { method: 'POST', body: { email } })
  if (sent.status !== 200) {
    throw new Error(`发码失败 ${sent.status}: ${sent.text.slice(0, 160)}`)
  }

  const code = crackCode(email, latestCodeHash(email))
  if (!code) throw new Error('验证码反推失败（codeHash 与 email 不匹配？）')

  const verified = await client.call('/api/auth/verify-code', {
    method: 'POST',
    body: { email, code },
  })
  const proof = verified.json?.proof
  if (!proof) throw new Error(`换 proof 失败 ${verified.status}: ${verified.text.slice(0, 160)}`)

  const reg = await client.call('/api/auth/register', {
    method: 'POST',
    body: { email, proof, password, nickname },
  })
  if (reg.status !== 200) throw new Error(`注册失败 ${reg.status}: ${reg.text.slice(0, 200)}`)

  return reg.json.user
}
