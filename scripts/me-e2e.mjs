#!/usr/bin/env node
/**
 * 「我的」页与个人作品验收。
 *
 * 覆盖三层：
 *   API   —— 个人作品含草稿、展厅只列已发布、草稿详情仅本人可见、
 *            昵称回填作品署名、头像上传/替换/删除（文件与数据库同步）、
 *            改密码后旧会话失效
 *   页面  —— /me、/me/works 深链接，资料保存，裁剪后上传头像，
 *            页头头像联动，作品筛选/发布/撤下/新建/删除
 *   权限  —— 游客深链接被守卫送到登录页
 *
 * 用法：node scripts/me-e2e.mjs   （在服务器上直连 https://yuehua.online）
 *
 * 头像审核会调用真实 AI（失败按放行处理）；跑完自动删测试账号和头像文件。
 */
import { statSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { makeChecker, makeClient, registerUser, cleanupUser, flushRateLimits, mysql } from './lib/kit.mjs'
import { launch } from './lib/cdp-kit.mjs'

const BASE = process.env.E2E_BASE || 'https://yuehua.online'
const ORIGIN = new URL(BASE).origin
const ROOT = '/home/ubuntu/aiq-api'
const AVATAR_DIR = join(ROOT, 'site', 'uploads', 'avatars')
const EMAIL = `me-e2e-${Date.now()}-${randomBytes(2).toString('hex')}@example.com`
const PASSWORD = 'E2e-' + randomBytes(6).toString('hex')
const NEW_PASSWORD = 'E2e-' + randomBytes(6).toString('hex')
// 昵称会随验收步骤变化；清理护栏接受这三种「本脚本」的昵称。
const NICK = '我的E2E'
const NICK_API = '我的E2E改'
const NICK_UI = '我的E2E界面'
const NICK_OK = new Set([NICK, NICK_API, NICK_UI])

const { check, summary } = makeChecker()

// ── 合法 PNG（服务端验魔数，浏览器也要能解码）──────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}
function makePng(w, h, [r, g, b]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3)
  for (let x = 0; x < w; x++) {
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const pngUrl = (w, h, rgb) => `data:image/png;base64,${makePng(w, h, rgb).toString('base64')}`

const AVATAR_RE = /^\/uploads\/avatars\/[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)$/
const avatarDisk = (p) => join(ROOT, 'site', String(p).replace(/^\//, ''))
function fileSize(p) {
  try {
    return statSync(avatarDisk(p)).size
  } catch {
    return -1
  }
}

const client = makeClient(BASE)
const guest = makeClient(BASE)

const created = []
let browser = null
let userId = null

async function newWork(body) {
  const res = await client.call('/api/works', { method: 'POST', body })
  if (res.status !== 200) throw new Error(`建作品失败 ${res.status}: ${res.text.slice(0, 200)}`)
  created.push(res.json.work.id)
  return res.json.work
}

async function waitToast(p, text, timeout = 15_000) {
  await p.waitFor(
    `(() => { const el = document.querySelector('.me-toast.show'); return !!el && el.textContent.includes(${JSON.stringify(text)}) })()`,
    timeout,
    `toast「${text}」`,
  )
}

async function main() {
  console.log(`\n▶ 我的页面 E2E  ${BASE}\n`)

  const prevNick = mysql(`SELECT nickname FROM users WHERE email='${EMAIL.replace(/'/g, "''")}'`).trim()
  cleanupUser(BASE, EMAIL, NICK_OK.has(prevNick) ? prevNick : NICK)
  flushRateLimits(BASE, EMAIL)

  const user = await registerUser(client, { email: EMAIL, password: PASSWORD, nickname: NICK })
  userId = user.id
  const oldCookie = client.jar
  check('测试账号注册并登录', user.id && user.nickname === NICK, `id=${user.id}`)
  check('新账号没有头像', user.avatarUrl === null, `avatarUrl=${user.avatarUrl}`)

  // ══ API：个人作品与发布语义 ═══════════════════════════════
  console.log('\n── API：个人作品 / 草稿 / 发布 ──')
  const draft = await newWork({
    title: '个人草稿作品',
    type: 'AI 绘画',
    grade: 'low',
    module: 'm1',
    desc: '只在个人作品里可见，发布后才进展厅。',
    hue: 24,
  })
  const pub = await newWork({
    title: '已发布的作品',
    type: '提示词设计',
    grade: 'mid',
    module: 'm2',
    desc: '验收发布态与撤下。',
    hue: 210,
  })
  const pubRes = await client.call(`/api/works/${pub.id}/publish`, { method: 'POST' })
  check('新建作品默认是草稿', draft.published === false && draft.publishedAt === null)
  check('显式发布作品成功', pubRes.status === 200 && pubRes.json?.work?.published === true, `status=${pubRes.status}`)

  const mine = await client.call('/api/works/mine?pageSize=20')
  check(
    '我的作品含草稿且统计正确',
    mine.status === 200 &&
      mine.json?.total === 2 &&
      mine.json?.published === 1 &&
      mine.json?.drafts === 1 &&
      mine.json?.works?.length === 2,
    `total=${mine.json?.total} published=${mine.json?.published} drafts=${mine.json?.drafts}`,
  )
  const draftsOnly = await client.call('/api/works/mine?status=draft&pageSize=20')
  check(
    'status=draft 只返回草稿',
    draftsOnly.status === 200 &&
      draftsOnly.json?.works?.length === 1 &&
      draftsOnly.json.works[0].id === draft.id &&
      draftsOnly.json.filtered === 1,
    JSON.stringify(draftsOnly.json?.works?.map((w) => w.title)),
  )

  const publicList = await client.call('/api/works?pageSize=60')
  const publicTitles = (publicList.json?.works || []).map((w) => w.title)
  check('展厅列表不含草稿', !publicTitles.includes(draft.title))
  check('展厅列表含已发布作品', publicTitles.includes(pub.title))

  const guestDraft = await guest.call(`/api/works/${draft.id}`)
  check('游客打不开草稿详情', guestDraft.status === 404, `status=${guestDraft.status}`)
  const ownerDraft = await client.call(`/api/works/${draft.id}`)
  check(
    '本人可以预览草稿详情',
    ownerDraft.status === 200 && ownerDraft.json?.work?.id === draft.id && ownerDraft.json?.work?.published === false,
    `status=${ownerDraft.status}`,
  )

  // ══ API：资料修改与署名回填 ═════════════════════════════════
  console.log('\n── API：资料修改 ──')
  const badNick = await client.call('/api/auth/profile', { method: 'PATCH', body: { nickname: '' } })
  check('空昵称被拒绝', badNick.status === 400, `status=${badNick.status}`)
  const profile = await client.call('/api/auth/profile', {
    method: 'PATCH',
    body: { nickname: NICK_API, avatarHue: 123 },
  })
  check(
    '昵称与头像底色保存成功',
    profile.status === 200 && profile.json?.user?.nickname === NICK_API && profile.json?.user?.avatarHue === 123,
    `status=${profile.status}`,
  )
  const reMine = await client.call('/api/works/mine?pageSize=20')
  check(
    '改昵称后旧作品署名同步',
    (reMine.json?.works || []).length === 2 && reMine.json.works.every((w) => w.author === NICK_API),
    JSON.stringify((reMine.json?.works || []).map((w) => w.author)),
  )

  // ══ API：头像生命周期 ═══════════════════════════════════════
  console.log('\n── API：头像上传 / 替换 / 删除 ──')
  const badUrl = await client.call('/api/auth/avatar', {
    method: 'POST',
    body: { image: 'not-a-data-url' },
  })
  check('非 data URL 被拒绝', badUrl.status === 400, `status=${badUrl.status}`)
  const fake = await client.call('/api/auth/avatar', {
    method: 'POST',
    body: { image: 'data:image/png;base64,bm90IGFuIGltYWdl' },
  })
  check('伪装 PNG 被魔数校验拒绝', fake.status === 400, `status=${fake.status}`)

  const first = await client.call('/api/auth/avatar', {
    method: 'POST',
    body: { image: pngUrl(240, 240, [200, 70, 70]) },
  })
  const firstUrl = first.json?.user?.avatarUrl
  check('头像上传成功', first.status === 200 && AVATAR_RE.test(firstUrl || ''), `status=${first.status} url=${firstUrl}`)
  check('头像文件已落盘', fileSize(firstUrl) > 0, `${firstUrl}:${fileSize(firstUrl)}`)
  const served = await fetch(ORIGIN + firstUrl)
  check(
    '头像可通过站点静态访问',
    served.status === 200 && /image\/png/.test(served.headers.get('content-type') || ''),
    `status=${served.status}`,
  )
  const dbAvatar = mysql(`SELECT avatarUrl FROM users WHERE id='${userId}'`).trim()
  check('数据库记录新头像', dbAvatar === firstUrl, dbAvatar)

  const second = await client.call('/api/auth/avatar', {
    method: 'POST',
    body: { image: pngUrl(240, 240, [70, 150, 210]) },
  })
  const secondUrl = second.json?.user?.avatarUrl
  check('再次上传会换新地址', second.status === 200 && secondUrl && secondUrl !== firstUrl, `status=${second.status}`)
  check('旧头像文件被清理', fileSize(firstUrl) === -1, `${firstUrl}:${fileSize(firstUrl)}`)
  check('新头像文件存在', fileSize(secondUrl) > 0, `${secondUrl}:${fileSize(secondUrl)}`)

  const removed = await client.call('/api/auth/avatar', { method: 'DELETE' })
  check('删除头像成功', removed.status === 200 && removed.json?.user?.avatarUrl === null, `status=${removed.status}`)
  check('删除后文件被清理', fileSize(secondUrl) === -1, `${secondUrl}:${fileSize(secondUrl)}`)
  const afterRemove = await client.call('/api/auth/me')
  check('删除后当前用户头像为空', afterRemove.json?.user?.avatarUrl === null)

  // ══ 浏览器：/me 深链接、资料、裁剪头像 ═════════════════════
  console.log('\n── 页面：/me 深链接与资料 ──')
  browser = await launch()
  const p = browser
  const cookieVal = client.jar.replace(/^aiq_session=/, '')
  await p.setCookie('aiq_session', cookieVal, ORIGIN)

  await p.goto(`${BASE}/#/me`, '!!document.querySelector(".me-page")')
  await p.waitFor('!!document.querySelector("#me-profile-form")', 20_000, '资料表单')
  check('/me 深链接直接渲染', true)
  check(
    '顶部导航不再重复「我的」',
    await p.evaluate(
      `![...document.querySelectorAll('header nav a')].some((a) => a.getAttribute('href') === '#/me')`,
    ),
  )
  const title = await p.evaluate('document.title')
  check('页面标题正确', title === '我的', title)

  // 从头像下拉进入「我的主页」：桌面端不再占用顶部导航。
  await p.goto(`${BASE}/#/`, '!!document.querySelector("header button span.rounded-full")', 20_000)
  check(
    '头像按钮存在于页头',
    await p.evaluate(`(() => {
      const span = document.querySelector('header button span.rounded-full')
      if (!span) return false
      span.closest('button').click()
      return true
    })()`),
  )
  await p.waitFor(
    `[...document.querySelectorAll('.el-dropdown-menu__item')].some((el) => el.textContent.includes('我的主页'))`,
    10_000,
    '头像下拉菜单',
  )
  check('下拉菜单有「我的主页」', true)
  await p.evaluate(`(() => {
    const item = [...document.querySelectorAll('.el-dropdown-menu__item')].find((el) => el.textContent.includes('我的主页'))
    item.click()
    return true
  })()`)
  await p.waitFor(`location.hash === '#/me' && !!document.querySelector('.me-page')`, 20_000, '下拉进入我的主页')
  check('下拉菜单进入我的主页', true)
  await p.waitFor('!!document.querySelector("#me-profile-form")', 20_000, '资料表单')

  await p.evaluate(`(() => {
    const form = document.querySelector('#me-profile-form')
    const nick = form.querySelector('#me-nickname')
    const hue = form.querySelector('#me-hue')
    nick.value = ${JSON.stringify(NICK_UI)}
    nick.dispatchEvent(new Event('input', { bubbles: true }))
    hue.value = '87'
    hue.dispatchEvent(new Event('input', { bubbles: true }))
    form.requestSubmit()
    return true
  })()`)
  await waitToast(p, '个人资料已保存')
  const savedState = await p.evaluate(`(() => {
    const form = document.querySelector('#me-profile-form')
    const store = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('user')
    return {
      nick: form && form.querySelector('#me-nickname') ? form.querySelector('#me-nickname').value : '',
      hue: form && form.querySelector('#me-hue') ? form.querySelector('#me-hue').value : '',
      storeNick: store && store.user ? store.user.nickname : '',
      storeHue: store && store.user ? store.user.avatarHue : null,
    }
  })()`)
  check('表单显示新昵称', savedState.nick === NICK_UI, savedState.nick)
  check('滑块显示新底色', savedState.hue === '87', savedState.hue)
  check('登录态同步新昵称', savedState.storeNick === NICK_UI, savedState.storeNick)
  check('登录态同步新底色', Number(savedState.storeHue) === 87, String(savedState.storeHue))

  console.log('\n── 页面：头像裁剪与页头联动 ──')
  const avatarB64 = makePng(320, 320, [80, 170, 120]).toString('base64')
  const injected = await p.evaluate(`(() => {
    const bin = atob(${JSON.stringify(avatarB64)})
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const input = document.querySelector('#me-avatar-file')
    if (!input) return 'no-input'
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'avatar-e2e.png', { type: 'image/png' }))
    const count = dt.files.length
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return count
  })()`)
  check('文件选择进入裁剪流程', injected === 1, String(injected))
  await p.waitFor('!!document.querySelector("[data-me-crop-stage]")', 15_000, '裁剪弹层')
  await p.waitFor(
    '(() => { const img = document.querySelector("[data-me-crop-image]"); return !!img && img.complete && img.naturalWidth > 0 })()',
    15_000,
    '裁剪图片就绪',
  )
  check('裁剪弹层有缩放滑杆', await p.evaluate('!!document.querySelector("[data-me-crop-zoom]")'))
  await p.evaluate('document.querySelector("[data-me-crop-confirm]").click()')
  await waitToast(p, '头像已更新', 45_000)
  await p.waitFor(
    '(() => { const el = document.querySelector(".me-avatar[data-me-avatar]"); return !!el && /uploads\\/avatars/.test(el.getAttribute("style") || "") })()',
    15_000,
    '我的页头像',
  )
  await p.waitFor(
    '!!document.querySelector(\'button span[style*="/uploads/avatars/"]\')',
    15_000,
    '页头头像',
  )
  check('裁剪上传后页头头像同步', true)
  const avatarApi = await client.call('/api/auth/me')
  const browserAvatar = avatarApi.json?.user?.avatarUrl
  check('裁剪上传的头像已入库', AVATAR_RE.test(browserAvatar || ''), browserAvatar)
  check('裁剪上传的头像文件存在', fileSize(browserAvatar) > 0, `${browserAvatar}:${fileSize(browserAvatar)}`)

  // ══ 浏览器：/me/works 管理 ═════════════════════════════════
  console.log('\n── 页面：/me/works 筛选与管理 ──')
  await p.goto(`${BASE}/#/me/works`, '!!document.querySelector(".me-page")')
  await p.waitFor('document.querySelectorAll("#me-works-grid .me-work-card:not(.me-skel)").length === 2', 20_000, '作品卡片')
  const countText = await p.evaluate('document.querySelector("[data-me-count]").textContent')
  check('统计显示 2 件 / 已发布 1 / 草稿 1', /共 2 件作品.*已发布 1.*草稿 1/.test(countText), countText)
  check(
    '筛选计数正确',
    (await p.evaluate('document.querySelector(\'[data-filter-count="all"]\').textContent')) === '2' &&
      (await p.evaluate('document.querySelector(\'[data-filter-count="published"]\').textContent')) === '1' &&
      (await p.evaluate('document.querySelector(\'[data-filter-count="draft"]\').textContent')) === '1',
  )
  await p.evaluate('document.querySelector(\'[data-act="filter"][data-filter="draft"]\').click()')
  await p.waitFor('document.querySelectorAll("#me-works-grid .me-work-card:not(.me-skel)").length === 1', 10_000, '草稿筛选')
  check('草稿筛选只剩 1 件', await p.evaluate('!!document.querySelector("#me-works-grid .me-work-card")'))
  await p.evaluate('document.querySelector(\'[data-act="filter"][data-filter="all"]\').click()')
  await p.waitFor('document.querySelectorAll("#me-works-grid .me-work-card:not(.me-skel)").length === 2', 10_000, '全部筛选')

  // 草稿详情走展厅详情页，显示草稿标记且不能点赞
  await p.evaluate(`(() => {
    const card = [...document.querySelectorAll('#me-works-grid .me-work-card')].find((c) => c.textContent.includes(${JSON.stringify(draft.title)}))
    card.querySelector('a[href^="#/gallery/"]').click()
    return true
  })()`)
  await p.waitFor(`location.hash === '#/gallery/${draft.id}' && !!document.querySelector('.gal-detail')`, 20_000, '草稿详情')
  await p.waitFor('!!document.querySelector(".gal-draft-tag")', 10_000, '草稿标记')
  const draftDetail = await p.evaluate(`({
    tag: document.querySelector('.gal-draft-tag').textContent,
    like: !!document.querySelector('[data-act="like"]'),
    publish: !!document.querySelector('[data-act="publish"]'),
  })`)
  check('草稿详情显示「仅自己可见」', /草稿/.test(draftDetail.tag), draftDetail.tag)
  check('草稿详情不显示点赞', draftDetail.like === false)
  check('草稿详情提供发布按钮', draftDetail.publish === true)

  await p.goto(`${BASE}/#/me/works`, '!!document.querySelector("#me-works-grid")')
  await p.waitFor('document.querySelectorAll("#me-works-grid .me-work-card:not(.me-skel)").length === 2', 20_000, '返回作品页')

  // 发布草稿
  await p.evaluate(`(() => {
    const card = [...document.querySelectorAll('#me-works-grid .me-work-card')].find((c) => c.textContent.includes(${JSON.stringify(draft.title)}))
    card.querySelector('[data-act="publish"]').click()
    return true
  })()`)
  await waitToast(p, '已发布到成果展厅')
  await p.waitFor('document.querySelector("[data-me-count]").textContent.includes("已发布 2")', 10_000, '发布后统计')
  const pubApi = await client.call(`/api/works/${draft.id}`)
  check('页面发布后接口状态为已发布', pubApi.json?.work?.published === true)
  check('发布后草稿计数归零', (await p.evaluate('document.querySelector(\'[data-filter-count="draft"]\').textContent')) === '0')

  // 新建作品
  await p.evaluate('document.querySelector(\'[data-act="new-work"]\').click()')
  await p.waitFor('!!document.querySelector("#me-create-form")', 10_000, '新建弹层')
  await p.evaluate(`(() => {
    document.querySelector('#me-new-title').value = '界面新建的作品'
    document.querySelector('#me-create-form').requestSubmit()
    return true
  })()`)
  await waitToast(p, '已保存到个人作品')
  await p.waitFor(
    `[...document.querySelectorAll('#me-works-grid .me-work-card')].some((c) => c.textContent.includes('界面新建的作品'))`,
    15_000,
    '新建作品卡片',
  )
  check('新建作品进入统计', (await p.evaluate('document.querySelector("[data-me-count]").textContent')).includes('共 3 件'))

  // 从展厅撤下
  await p.evaluate(`(() => {
    const card = [...document.querySelectorAll('#me-works-grid .me-work-card')].find((c) => c.textContent.includes(${JSON.stringify(pub.title)}))
    card.querySelector('[data-act="unpublish"]').click()
    return true
  })()`)
  await p.waitFor('!!document.querySelector("[data-me-confirm]")', 10_000, '撤下确认')
  await p.evaluate('document.querySelector("[data-me-confirm]").click()')
  await waitToast(p, '已从展厅撤下')
  await p.waitFor('document.querySelector("[data-me-count]").textContent.includes("已发布 1")', 10_000, '撤下后统计')
  const unpubApi = await client.call(`/api/works/${pub.id}`)
  check('页面撤下后接口状态为草稿', unpubApi.json?.work?.published === false)
  const wall = await client.call('/api/works?pageSize=60')
  check(
    '撤下后从展厅列表消失',
    !(wall.json?.works || []).some((w) => w.id === pub.id),
  )

  // 删除新建的作品
  await p.evaluate(`(() => {
    const card = [...document.querySelectorAll('#me-works-grid .me-work-card')].find((c) => c.textContent.includes('界面新建的作品'))
    card.querySelector('[data-act="del"]').click()
    return true
  })()`)
  await p.waitFor('!!document.querySelector("[data-me-confirm]")', 10_000, '删除确认')
  await p.evaluate('document.querySelector("[data-me-confirm]").click()')
  await waitToast(p, '作品已删除')
  await p.waitFor(
    `![...document.querySelectorAll('#me-works-grid .me-work-card')].some((c) => c.textContent.includes('界面新建的作品'))`,
    15_000,
    '删除后卡片消失',
  )
  check('删除后统计回到 2 件', (await p.evaluate('document.querySelector("[data-me-count]").textContent')).includes('共 2 件'))

  // ══ 浏览器：移动端入口 ═════════════════════════════════════
  console.log('\n── 页面：移动端入口 ──')
  await p.setViewport(390, 844)
  await p.goto(`${BASE}/#/me`, '!!document.querySelector("header")')
  const burger = await p.evaluate(`(() => {
    const btn = [...document.querySelectorAll('header button')].find((b) => (b.getAttribute('class') || '').includes('lg:hidden'))
    if (!btn) return false
    btn.click()
    return true
  })()`)
  check('移动端汉堡按钮存在', burger === true)
  await p.waitFor(`!!document.querySelector('.el-drawer a[href="#/me"]')`, 10_000, '移动端抽屉入口')
  check('移动端抽屉保留「我的」入口', true)
  await p.setViewport(1366, 900)

  // ══ 浏览器：游客守卫生效 ═══════════════════════════════════
  console.log('\n── 页面：游客访问守卫 ──')
  await p.clearCookies()
  await p.goto('about:blank', null)
  await p.goto(`${BASE}/#/me`, null)
  await p.waitFor('location.hash.startsWith("#/login")', 20_000, '游客跳登录')
  check('游客访问 /me 被送到登录页', true)
  await p.goto(`${BASE}/#/me/works`, null)
  await p.waitFor('location.hash.startsWith("#/login")', 20_000, '游客跳登录（作品页）')
  check('游客访问 /me/works 被送到登录页', true)

  // ══ API：改密码与旧会话失效 ═══════════════════════════════
  console.log('\n── API：改密码 / 会话失效 ──')
  const wrong = await client.call('/api/auth/password', {
    method: 'POST',
    body: { currentPassword: 'definitely-wrong', newPassword: NEW_PASSWORD },
  })
  check('旧密码错误被拒绝', wrong.status === 400, `status=${wrong.status}`)
  const short = await client.call('/api/auth/password', {
    method: 'POST',
    body: { currentPassword: PASSWORD, newPassword: 'short' },
  })
  check('过短的新密码被拒绝', short.status === 400, `status=${short.status}`)
  const changed = await client.call('/api/auth/password', {
    method: 'POST',
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  })
  check('改密码成功', changed.status === 200 && changed.json?.ok === true, `status=${changed.status}`)
  const meAfter = await client.call('/api/auth/me')
  check('当前设备保持登录', meAfter.json?.user?.id === userId, `user=${meAfter.json?.user?.id}`)

  const stale = await client.call('/api/auth/me', { cookie: oldCookie })
  check('旧 cookie 立即失效', stale.json?.user === null, `user=${JSON.stringify(stale.json?.user)}`)

  const oldClient = makeClient(BASE)
  const oldLogin = await oldClient.call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
  })
  check('旧密码不能再登录', oldLogin.status === 401, `status=${oldLogin.status}`)
  const newClient = makeClient(BASE)
  const newLogin = await newClient.call('/api/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: NEW_PASSWORD },
  })
  check(
    '新密码可以登录',
    newLogin.status === 200 && newLogin.json?.user?.id === userId,
    `status=${newLogin.status}`,
  )
}

let exitErr = null
try {
  await main()
} catch (err) {
  exitErr = err
  console.error(`\n💥 验收中断: ${err.message}`)
} finally {
  // 头像不随用户行级联删除，先走接口删，再兜底扫磁盘。
  try {
    if (client.jar) await client.call('/api/auth/avatar', { method: 'DELETE' })
  } catch {
    /* ignore */
  }
  if (userId) {
    try {
      for (const name of readdirSync(AVATAR_DIR)) {
        if (name.startsWith(`${userId}-`)) {
          try {
            unlinkSync(join(AVATAR_DIR, name))
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* 目录不存在说明没有头像文件 */
    }
  }
  for (const id of created) {
    try {
      await client.call(`/api/works/${id}`, { method: 'DELETE' })
    } catch {
      /* ignore */
    }
  }
  if (browser) {
    try {
      await browser.close()
    } catch {
      /* ignore */
    }
  }
  try {
    const nick = mysql(`SELECT nickname FROM users WHERE email='${EMAIL.replace(/'/g, "''")}'`).trim()
    cleanupUser(BASE, EMAIL, NICK_OK.has(nick) ? nick : NICK)
  } catch (err) {
    console.error(`清理测试账号失败: ${err.message}`)
  }
}

const failed = summary() + (exitErr ? 1 : 0)
process.exit(failed ? 1 : 0)
