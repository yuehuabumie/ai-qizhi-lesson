#!/usr/bin/env node
/**
 * 注册链路冒烟测试 —— 部署后跑一次，确认认证系统真的通。
 *
 *   node scripts/smoke-auth.mjs
 *
 * 环境变量：
 *   SMOKE_BASE   默认 http://127.0.0.1:3020
 *   SMOKE_EMAIL  默认 301@301.group（必须是未注册过的邮箱，能收到信）
 *   SMOKE_KEEP=1 保留测试账号，不自动清理
 *
 * 会**真的发一封验证码邮件**。默认跑完自动删掉测试账号和临时数据。
 * 公共件（cookie jar、验证码反推、限流清理）见 scripts/lib/kit.mjs。
 */
import { randomBytes } from 'node:crypto'
import {
  makeChecker,
  makeClient,
  cleanupUser,
  crackCode,
  latestCodeHash,
} from './lib/kit.mjs'

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
const EMAIL = process.env.SMOKE_EMAIL || '301@301.group'
const KEEP = process.env.SMOKE_KEEP === '1'
const PASSWORD = 'Smoke-' + randomBytes(6).toString('hex')
const NICKNAME = '冒烟测试'

const { check, summary } = makeChecker()
const client = makeClient(BASE)
const call = client.call
const cleanup = (email) => cleanupUser(BASE, email, NICKNAME)

console.log(`\n冒烟测试 @ ${BASE}   邮箱=${EMAIL}\n`)

cleanup(EMAIL) // 清掉上一轮残留，保证可重复运行

console.log('【匿名】')
{
  client.clearJar()
  const me = await call('/api/auth/me')
  check(
    'GET /auth/me 未登录返回 200 + user:null',
    me.status === 200 && me.json?.user === null,
    `${me.status} ${me.text.slice(0, 120)}`,
  )

  const guard = await call('/api/auth/logout', { method: 'POST' })
  check('POST /auth/logout 无 cookie 也不报错', guard.status === 200, String(guard.status))
}

console.log('\n【发验证码 + 限流】')
{
  const r1 = await call('/api/auth/send-code', { method: 'POST', body: { email: EMAIL } })
  check(
    '首次发码成功（SMTP 真的发出去了）',
    r1.status === 200 && r1.json?.ok === true,
    `${r1.status} ${r1.text.slice(0, 160)}`,
  )

  const r2 = await call('/api/auth/send-code', { method: 'POST', body: { email: EMAIL } })
  check('60 秒内重发被限流（429）', r2.status === 429, `${r2.status} ${r2.text.slice(0, 160)}`)
  check('限流响应体带中文 message 和 retryAfter', typeof r2.json?.error?.message === 'string' &&
    typeof r2.json?.error?.retryAfter === 'number', JSON.stringify(r2.json))

  const bad = await call('/api/auth/send-code', { method: 'POST', body: { email: '不是邮箱' } })
  check('非法邮箱被拒（400）', bad.status === 400, String(bad.status))

  const junk = await call('/api/auth/send-code', { method: 'POST', body: { email: 'a@mailinator.com' } })
  check('临时邮箱域名被拒（400）', junk.status === 400, String(junk.status))
}

console.log('\n【验证码 → proof】')
let proof = ''
{
  const codeHash = latestCodeHash(EMAIL)
  check('数据库里存的是 codeHash 而非明文', /^[0-9a-f]{64}$/.test(codeHash), codeHash.slice(0, 16))

  const code = crackCode(EMAIL, codeHash)
  check('能从 codeHash 反推出 6 位验证码（说明发码链路完整）', !!code, code || '(未命中)')

  const wrong = await call('/api/auth/verify-code', {
    method: 'POST',
    body: { email: EMAIL, code: code === '000000' ? '111111' : '000000' },
  })
  check(
    '错误验证码被拒（400 CODE_INVALID）',
    wrong.status === 400 && wrong.json?.error?.code === 'CODE_INVALID',
    `${wrong.status} ${wrong.text.slice(0, 120)}`,
  )

  const v = await call('/api/auth/verify-code', { method: 'POST', body: { email: EMAIL, code } })
  proof = v.json?.proof || ''
  check('正确验证码换到 proof', v.status === 200 && proof.length >= 20, `${v.status} ${v.text.slice(0, 160)}`)

  const again = await call('/api/auth/verify-code', { method: 'POST', body: { email: EMAIL, code } })
  check('同一验证码可重复换 proof（设计如此，proof 才是凭证）', again.status === 200, String(again.status))
  proof = again.json?.proof || proof
}

console.log('\n【注册】')
{
  const noProof = await call('/api/auth/register', {
    method: 'POST',
    body: { email: EMAIL, proof: 'x'.repeat(43), password: PASSWORD, nickname: NICKNAME },
  })
  check(
    '伪造 proof 无法注册（400 PROOF_INVALID）',
    noProof.status === 400 && noProof.json?.error?.code === 'PROOF_INVALID',
    `${noProof.status} ${noProof.text.slice(0, 140)}`,
  )

  const weak = await call('/api/auth/register', {
    method: 'POST',
    body: { email: EMAIL, proof, password: '123', nickname: NICKNAME },
  })
  check('弱密码被拒（400）', weak.status === 400, `${weak.status} ${weak.text.slice(0, 140)}`)

  const reg = await call('/api/auth/register', {
    method: 'POST',
    body: { email: EMAIL, proof, password: PASSWORD, nickname: NICKNAME },
  })
  check(
    '注册成功并自动登录',
    reg.status === 200 && reg.json?.user?.email === EMAIL,
    `${reg.status} ${reg.text.slice(0, 200)}`,
  )
  check('下发了 aiq_session cookie', /aiq_session=/.test(reg.setCookie), reg.setCookie.slice(0, 80))
  check('cookie 带 HttpOnly', /HttpOnly/i.test(reg.setCookie), reg.setCookie)
  check('cookie 带 SameSite=Strict', /SameSite=Strict/i.test(reg.setCookie), reg.setCookie)
  check('cookie Path=/（写成默认值就只覆盖 /api/auth，其它接口全 401）', /Path=\//i.test(reg.setCookie), reg.setCookie)

  const replay = await call('/api/auth/register', {
    method: 'POST',
    body: { email: EMAIL, proof, password: PASSWORD, nickname: NICKNAME },
  })
  check('同一 proof 重放被拒（防重放）', replay.status >= 400, `${replay.status} ${replay.text.slice(0, 140)}`)
}

console.log('\n【会话】')
{
  const me = await call('/api/auth/me')
  check('带 cookie 能拿到自己的信息', me.status === 200 && me.json?.user?.email === EMAIL, `${me.status} ${me.text.slice(0, 140)}`)
  check('响应里不含 passwordHash', !/passwordHash/i.test(me.text), me.text.slice(0, 140))

  const tampered = await call('/api/auth/me', { cookie: client.jar.slice(0, -4) + 'AAAA' })
  check('篡改签名的 token 被判为未登录', tampered.status === 200 && tampered.json?.user === null, String(tampered.status))

  const out = await call('/api/auth/logout', { method: 'POST' })
  check('登出回了一个清空 cookie 的 Set-Cookie', /aiq_session=;|Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(out.setCookie), out.setCookie.slice(0, 120))
  check('浏览器式 jar 里 cookie 已被清掉', client.jar === '', JSON.stringify(client.jar))

  const after = await call('/api/auth/me')
  check('登出后再访问 /auth/me 是未登录', after.json?.user === null, after.text.slice(0, 120))
}

console.log('\n【登录】')
{
  const bad = await call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: 'wrong-password-xyz' },
  })
  check('错误密码被拒（401）', bad.status === 401, `${bad.status} ${bad.text.slice(0, 120)}`)
  check('错误提示不区分「邮箱不存在」和「密码错」', /邮箱或密码/.test(bad.json?.error?.message || ''), bad.json?.error?.message)

  const ghost = await call('/api/auth/login', {
    method: 'POST',
    body: { email: 'nobody-xyz@301.group', password: 'wrong-password-xyz' },
  })
  check(
    '不存在的邮箱返回与密码错完全一致的响应（防枚举）',
    ghost.status === 401 && ghost.json?.error?.message === bad.json?.error?.message,
    `${ghost.status} ${ghost.json?.error?.message}`,
  )

  const good = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
  check('正确密码登录成功', good.status === 200 && good.json?.user?.email === EMAIL, `${good.status} ${good.text.slice(0, 160)}`)
  check('登录后 jar 里重新有了 cookie', client.jar.startsWith('aiq_session='), client.jar.slice(0, 40))

  const reMe = await call('/api/auth/me')
  check('登录后能读到自己的信息', reMe.json?.user?.email === EMAIL, reMe.text.slice(0, 120))

  const tooLong = await call('/api/auth/register', {
    method: 'POST',
    body: { email: EMAIL, proof: 'x'.repeat(43), password: 'a'.repeat(80), nickname: 'x' },
  })
  check('超长密码被拒（bcrypt 只取前 72 字节，不如直接挡）', tooLong.status === 400, String(tooLong.status))
}

if (!KEEP) {
  cleanup(EMAIL)
  console.log('\n已清理测试账号和临时数据。')
} else {
  console.log(`\n保留了测试账号 ${EMAIL} / ${PASSWORD}`)
}

process.exit(summary() === 0 ? 0 : 1)
