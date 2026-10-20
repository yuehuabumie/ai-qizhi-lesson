#!/usr/bin/env node
/**
 * 成果展厅验收：真实图片落盘 + 分类型展示 + 详情深链接。
 *
 * 覆盖三层：
 *   API   —— 图片下载/校验/落盘/回读、SSRF 与数量校验、访客权限
 *   列表  —— 24 张首屏、图片封面、各类型真实内容、加载更多、移动端单列
 *   详情  —— /gallery/:id 深链接、绘本逐页插画、各类型正文、点赞、删除清理
 *
 * 用法：node scripts/gallery-e2e.mjs   （在服务器上直连 https://yuehua.online）
 *
 * 依赖本机 Playwright 缓存的 Chromium；脚本直连 CDP，不需要 npm 安装浏览器库。
 * 跑完自动删测试账号与作品，图片作品走正常 DELETE 接口以同步清理磁盘。
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { makeChecker, makeClient, registerUser, cleanupUser, flushRateLimits } from './lib/kit.mjs'
import { launch, sleep } from './lib/cdp-kit.mjs'

const BASE = process.env.E2E_BASE || 'https://yuehua.online'
const ORIGIN = new URL(BASE).origin
const ROOT = '/home/ubuntu/aiq-api'
const EMAIL = `gal-e2e-${Date.now()}-${randomBytes(2).toString('hex')}@example.com`
const PASSWORD = 'E2e-' + randomBytes(6).toString('hex')
const NICK = '展厅E2E'

const { check, summary } = makeChecker()

// ── 生成合法 PNG（服务端会验魔数，浏览器也要能真正解码）────────
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

const IMG_BOOK = [pngUrl(160, 120, [220, 90, 90]), pngUrl(160, 120, [90, 180, 110]), pngUrl(160, 120, [90, 120, 220])]
const IMG_PROMPT = [pngUrl(140, 105, [230, 180, 60])]
const IMG_OBSERVE = [pngUrl(140, 105, [60, 190, 170])]

function validStoredPath(p) {
  return typeof p === 'string' && /^\/uploads\/works\/[A-Za-z0-9_-]{1,80}\.(png|jpg|webp)$/.test(p)
}
function diskPath(p) {
  return join(ROOT, 'site', p.replace(/^\//, ''))
}
function sizeOf(p) {
  try {
    return statSync(diskPath(p)).size
  } catch {
    return -1
  }
}

const client = makeClient(BASE)

// 作品句柄（失败清理时用）
const created = []
let browser = null

async function postWork(body, label, { publish = true } = {}) {
  const res = await client.call('/api/works', { method: 'POST', body })
  if (res.status !== 200) {
    throw new Error(`建作品「${label}」失败 ${res.status}: ${res.text.slice(0, 200)}`)
  }
  const work = res.json.work
  created.push(work.id)
  // 作品默认是草稿；展厅列表只展示已发布作品，验收数据要显式发布。
  if (publish) {
    const pub = await client.call(`/api/works/${work.id}/publish`, { method: 'POST' })
    if (pub.status !== 200) {
      throw new Error(`发布作品「${label}」失败 ${pub.status}: ${pub.text.slice(0, 200)}`)
    }
    work.published = true
  }
  return work
}

async function main() {
  console.log(`\n▶ 成果展厅 E2E  ${BASE}\n`)

  cleanupUser(BASE, EMAIL, NICK)
  flushRateLimits(BASE, EMAIL)

  // ── 账号 ─────────────────────────────────────────────────
  const user = await registerUser(client, { email: EMAIL, password: PASSWORD, nickname: NICK })
  const me = await client.call('/api/auth/me')
  check('测试账号注册并登录', me.status === 200 && me.json?.user?.id === user.id, `me=${me.status}`)
  check('拿到会话 cookie', /^aiq_session=.+/.test(client.jar), client.jar ? 'jar 已就绪' : 'jar 为空')

  // ── 先建占位作品，保证「加载更多」有第二页 ──────────────────
  const fillers = []
  for (let i = 1; i <= 20; i++) {
    fillers.push(
      await postWork(
        {
          title: `测试占位作品 ${String(i).padStart(2, '0')}`,
          type: 'AI 绘画',
          grade: ['low', 'mid', 'high'][i % 3],
          module: ['m1', 'm2', 'm3', 'm4'][i % 4],
          desc: `第 ${i} 份用于翻页验收的作品说明文字。`,
          hue: (i * 37) % 360,
        },
        `filler-${i}`,
      ),
    )
  }

  // ── 九件功能作品（最后创建 → 一定在第一页）─────────────────
  const book = await postWork(
    {
      title: '《静夜思》AI 课文绘本',
      type: 'AI 课文绘本',
      grade: 'low',
      module: 'm2',
      desc: '第1页：李白在窗前抬头看月亮。第2页：他低下头想起故乡。第3页：月光像霜一样铺在地上。',
      images: IMG_BOOK,
      hue: 280,
    },
    'book',
  )
  const plainBook = await postWork(
    {
      title: '《小池》文字绘本',
      type: 'AI 课文绘本',
      grade: 'low',
      module: 'm2',
      desc: '第1页：泉眼无声惜细流。第2页：树阴照水爱晴柔。',
      hue: 200,
    },
    'plain-book',
  )
  const prompt = await postWork(
    {
      title: '会飞的鲸鱼提示词',
      type: '提示词设计',
      grade: 'mid',
      module: 'm2',
      desc: '主体: 一头巨大的蓝鲸。动作: 在星空中缓慢游动。场景: 紫色星云和发光水母。风格: 儿童绘本，色彩明亮。',
      images: IMG_PROMPT,
      hue: 320,
    },
    'prompt',
  )
  const observe = await postWork(
    {
      title: '我家 AI 设备大搜查',
      type: '观察记录',
      grade: 'low',
      module: 'm1',
      desc: '客厅：智能音箱、扫地机器人、智能电视\n门口：智能门锁、可视门铃\n书房：平板电脑、智能台灯',
      images: IMG_OBSERVE,
      hue: 170,
    },
    'observe',
  )
  const map = await postWork(
    {
      title: '校园 AI 发现地图',
      type: 'AI 发现地图',
      grade: 'mid',
      module: 'm1',
      desc: '教学楼：人脸识别门禁、智能黑板\n图书馆：自助借还机\n操场：智能跑道',
      hue: 215,
    },
    'map',
  )
  const mr = await postWork(
    {
      title: '未来教室 MR 空间',
      type: 'MR 空间方案',
      grade: 'high',
      module: 'm3',
      desc: '学习区：可交互全息投影\n休息区：氛围灯光\n展示区：3D 作品墙',
      hue: 190,
    },
    'mr',
  )
  const invent = await postWork(
    {
      title: '自动整理书包机器人',
      type: 'AI 发明作品',
      grade: 'mid',
      module: 'm4',
      desc: '我想发明一个会自动整理书包的机器人。它能把课本按课表分类。它还能提醒我带上水杯。',
      hue: 30,
    },
    'invent',
  )
  const project = await postWork(
    {
      title: '校园垃圾分类小助手',
      type: 'AI 创新项目',
      grade: 'high',
      module: 'm4',
      desc: '先调查校园垃圾的种类。再设计分类提示牌。然后训练一个识别模型。最后在班级试用并改进。',
      hue: 330,
    },
    'project',
  )
  const ethics = await postWork(
    {
      title: '我们班的 AI 使用守则',
      type: 'AI 伦理守则',
      grade: 'mid',
      module: 'm4',
      desc: '用 AI 生成的内容要注明来源。不把同学的照片上传给 AI。遇到不确定的答案要自己核实。',
      hue: 150,
    },
    'ethics',
  )
  // 远端 https 下载：拿本站已落盘的图片当源，走完整的 DNS/TLS/直连路径
  const remoteWork = await postWork(
    {
      title: '远程链接插画作品',
      type: '提示词设计',
      grade: 'mid',
      module: 'm2',
      desc: '验证 https 图片下载与落盘。',
      images: [`${ORIGIN}${book.images[0]}`],
      hue: 10,
    },
    'remote-image',
  )
  const privateWork = await postWork(
    {
      title: '内网图片应被拒绝',
      type: '提示词设计',
      grade: 'mid',
      module: 'm2',
      desc: 'SSRF 防护验收。',
      images: ['https://127.0.0.1/secret.png'],
      hue: 0,
    },
    'ssrf',
  )
  const fakeWork = await postWork(
    {
      title: '伪装图片应被拒绝',
      type: '提示词设计',
      grade: 'mid',
      module: 'm2',
      desc: '魔数校验验收。',
      images: ['data:image/png;base64,bm90IGFuIGltYWdl'],
      hue: 0,
    },
    'fake-image',
  )

  // ══ API 层 ═════════════════════════════════════════════════
  console.log('\n── API：图片落盘与校验 ──')
  check('绘本返回 3 张站内图片', book.images?.length === 3, JSON.stringify(book.images))
  check('图片路径全部是站内 /uploads/works/', (book.images || []).every(validStoredPath), JSON.stringify(book.images))
  check(
    '三张图片确实写到了磁盘',
    (book.images || []).every((p) => sizeOf(p) > 0),
    (book.images || []).map((p) => `${p}:${sizeOf(p)}`).join(' '),
  )
  check(
    '非绘本类型也保存图片',
    prompt.images?.length === 1 && observe.images?.length === 1,
    `prompt=${prompt.images?.length} observe=${observe.images?.length}`,
  )
  check(
    '远端 https 图片能下载并落盘',
    remoteWork.images?.length === 1 && validStoredPath(remoteWork.images[0]) && sizeOf(remoteWork.images[0]) > 0,
    JSON.stringify(remoteWork.images),
  )
  check(
    '远端图片是独立副本（不依赖源作品）',
    remoteWork.images?.[0] !== book.images[0],
    `${remoteWork.images?.[0]} vs ${book.images[0]}`,
  )
  check('内网地址被 SSRF 防护丢弃', (privateWork.images || []).length === 0, JSON.stringify(privateWork.images))
  check('伪装成 PNG 的文本被魔数校验拒绝', (fakeWork.images || []).length === 0, JSON.stringify(fakeWork.images))

  const serveChecks = []
  for (const p of [...(book.images || []), ...(prompt.images || []), ...(observe.images || [])]) {
    const r = await fetch(ORIGIN + p)
    serveChecks.push({ p, status: r.status, type: r.headers.get('content-type') || '' })
  }
  check(
    '图片可通过站点静态访问',
    serveChecks.every((s) => s.status === 200 && /image\/(png|jpeg|webp)/.test(s.type)),
    serveChecks.map((s) => `${s.status}`).join(','),
  )

  const detailApi = await client.call(`/api/works/${book.id}`)
  check('GET /api/works/:id 返回详情', detailApi.status === 200 && detailApi.json?.work?.id === book.id)
  check(
    '详情接口回读同一组图片',
    JSON.stringify(detailApi.json?.work?.images) === JSON.stringify(book.images),
    JSON.stringify(detailApi.json?.work?.images),
  )
  const listApi = await client.call('/api/works?pageSize=60')
  const listed = (listApi.json?.works || []).find((w) => w.id === book.id)
  check('列表接口携带图片字段', Array.isArray(listed?.images) && listed.images.length === 3)

  const guest = makeClient(BASE)
  const guestList = await guest.call('/api/works?pageSize=5')
  check('访客可浏览展厅列表', guestList.status === 200 && Array.isArray(guestList.json?.works))
  const guestPost = await guest.call('/api/works', {
    method: 'POST',
    body: { title: '访客作品', desc: 'x' },
  })
  check('访客不能上传作品（401）', guestPost.status === 401, `status=${guestPost.status}`)

  const badScheme = await client.call('/api/works', {
    method: 'POST',
    body: { title: '非法图片', images: ['http://127.0.0.1/secret.png'] },
  })
  check('非 https/data 图片地址被拒（400）', badScheme.status === 400, `status=${badScheme.status}`)
  const tooMany = await client.call('/api/works', {
    method: 'POST',
    body: { title: '超量图片', images: Array.from({ length: 21 }, () => IMG_PROMPT[0]) },
  })
  check('超过 20 张图片被拒（400）', tooMany.status === 400, `status=${tooMany.status}`)

  // ══ 浏览器 ═════════════════════════════════════════════════
  browser = await launch()
  const p = browser
  const cookieVal = client.jar.replace(/^aiq_session=/, '')
  await p.setCookie('aiq_session', cookieVal, ORIGIN)

  console.log('\n── 列表：不同内容不同封面 ──')
  await p.goto(`${BASE}/#/gallery`)
  await p.waitFor('document.querySelectorAll(".gal-card").length > 0', 30_000, '首屏卡片')

  const firstPageCount = await p.evaluate('document.querySelectorAll(".gal-card").length')
  check('首屏渲染 24 张卡片', firstPageCount === 24, `实际 ${firstPageCount}`)

  const layout = await p.evaluate(`(() => {
    const c = document.querySelector('.gal-container')
    const par = c.parentElement
    const cr = c.getBoundingClientRect()
    const pr = par.getBoundingClientRect()
    return { cw: Math.round(cr.width), expect: Math.round(pr.width - 48), lg: Math.round(cr.left - pr.left), rg: Math.round(pr.right - cr.right) }
  })()`)
  check('容器宽度与居中符合站点栅格', Math.abs(layout.cw - layout.expect) <= 2 && Math.abs(layout.lg - layout.rg) <= 2, JSON.stringify(layout))

  const bookCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${book.id}"]')
    if (!el) return null
    const img = el.querySelector('.gal-cover--photo img')
    return {
      hasPhotoCover: !!el.querySelector('.gal-cover--photo'),
      src: img ? img.getAttribute('src') : '',
      badge: (el.querySelector('.gal-badge-count') || {}).textContent || '',
      preview: (el.querySelector('.gal-preview') || {}).textContent || '',
    }
  })()`)
  check('绘本卡片用真实插画做封面', !!bookCard?.hasPhotoCover && bookCard?.src === book.images[0], JSON.stringify(bookCard))

  // 封面图带 loading="lazy"，在无头视口里要先滚到可见区才会真正拉取
  await p.evaluate(`document.querySelector('[data-work-id="${book.id}"]').scrollIntoView({ block: 'center' })`)
  await p.waitFor(
    `(() => { const img = document.querySelector('[data-work-id="${book.id}"] .gal-cover--photo img'); return !!(img && img.complete && img.naturalWidth > 0) })()`,
    10_000,
    '封面图解码',
  )
  check('封面插画在浏览器里解码成功', true)
  check('绘本角标显示插画数量', /3 张插画/.test(bookCard?.badge || ''), bookCard?.badge)
  check('绘本卡片预览是第 1 页真实文字', /李白在窗前/.test(bookCard?.preview || ''), bookCard?.preview)

  const plainCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${plainBook.id}"]')
    return {
      booklet: !!el?.querySelector('.gal-booklet'),
      photo: !!el?.querySelector('.gal-cover--photo'),
      preview: (el?.querySelector('.gal-preview') || {}).textContent || '',
    }
  })()`)
  check('无图绘本退回绘本母题（不伪造插画）', plainCard?.booklet === true && plainCard?.photo === false, JSON.stringify(plainCard))
  check('无图绘本仍显示真实分页文字', /泉眼无声/.test(plainCard?.preview || ''), plainCard?.preview)

  const promptCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${prompt.id}"]')
    const img = el?.querySelector('.gal-cover--photo img')
    return {
      photo: !!img,
      src: img?.getAttribute('src') || '',
      preview: (el?.querySelector('.gal-preview') || {}).textContent || '',
    }
  })()`)
  check('提示词作品用图片做封面', promptCard?.photo === true && promptCard?.src === prompt.images[0], JSON.stringify(promptCard))
  check('提示词卡片显示真实提示词', /巨大的蓝鲸/.test(promptCard?.preview || ''), promptCard?.preview)

  const observeCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${observe.id}"]')
    return {
      src: el.querySelector('.gal-cover--photo img')?.getAttribute('src') || '',
      chips: [...el.querySelectorAll('.gal-preview .gal-chip')].map((n) => n.textContent),
    }
  })()`)
  check('观察记录卡片列出真实设备', (observeCard?.chips || []).length >= 4 && observeCard.chips.some((t) => t.includes('智能音箱')), JSON.stringify(observeCard?.chips))
  check('观察记录也展示真实图片', observeCard?.src === observe.images[0], observeCard?.src)

  const mapCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${map.id}"]')
    return {
      nodes: [...el.querySelectorAll('.gal-map-node span')].map((n) => n.textContent),
      chips: [...el.querySelectorAll('.gal-chip')].map((n) => n.textContent),
    }
  })()`)
  check('发现地图封面显示真实地点节点', (mapCard?.nodes || []).length >= 3 && mapCard.nodes.some((t) => t.includes('人脸识别')), JSON.stringify(mapCard?.nodes))

  const mrCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${mr.id}"]')
    return [...el.querySelectorAll('.gal-room-tile')].map((n) => n.textContent)
  })()`)
  check('MR 封面显示真实区域名', (mrCard || []).length === 3 && mrCard.includes('学习区'), JSON.stringify(mrCard))

  const inventCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${invent.id}"]')
    return {
      note: el.querySelector('.gal-note-mini--invent p')?.textContent || '',
      preview: el.querySelector('.gal-preview')?.textContent || '',
    }
  })()`)
  check('发明封面写出真实发明想法', /自动整理书包/.test(inventCard?.note || '') && /自动整理书包/.test(inventCard?.preview || ''), JSON.stringify(inventCard))

  const projectCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${project.id}"]')
    return {
      count: el.querySelector('.gal-note-count')?.textContent || '',
      note: el.querySelector('.gal-note-mini--project p')?.textContent || '',
    }
  })()`)
  check('项目封面显示真实步骤数与第一步', projectCard?.count === '4 步' && /调查校园垃圾/.test(projectCard?.note || ''), JSON.stringify(projectCard))

  const ethicsCard = await p.evaluate(`(() => {
    const el = document.querySelector('[data-work-id="${ethics.id}"]')
    return {
      count: el.querySelector('.gal-rule-count')?.textContent || '',
      lines: [...el.querySelectorAll('.gal-rule-lines em')].map((n) => n.textContent),
    }
  })()`)
  check('伦理封面显示真实守则条数与条目', ethicsCard?.count === '3 条' && ethicsCard.lines.length === 3 && ethicsCard.lines.some((t) => t.includes('注明')), JSON.stringify(ethicsCard))

  const typeBadges = await p.evaluate(
    `[...document.querySelectorAll('.gal-badge-type')].map((n) => n.textContent.trim())`,
  )
  check('不同内容类型使用不同角标', new Set(typeBadges).size >= 7, `种类 ${new Set(typeBadges).size}`)

  // 加载更多
  const moreExists = await p.evaluate('!!document.querySelector(\'[data-act="more"]\')')
  check('作品超过一页时出现「加载更多」', moreExists === true)
  if (moreExists) {
    await p.evaluate('document.querySelector(\'[data-act="more"]\').click()')
    await p.waitFor('document.querySelectorAll(".gal-card").length > 24', 15_000, '加载更多')
  }
  const afterMore = await p.evaluate('document.querySelectorAll(".gal-card").length')
  check('加载更多后卡片数增加', afterMore > 24, `实际 ${afterMore}`)

  await p.screenshot('/tmp/gal-list.png')

  // 点击卡片进详情
  console.log('\n── 详情：绘本逐页插画 ──')
  await p.evaluate(`document.querySelector('[data-work-id="${book.id}"] .gal-hit').click()`)
  await p.waitFor(`location.hash === '#/gallery/${book.id}'`, 10_000, '路由跳转')
  await p.waitFor('!!document.querySelector(".gal-detail .gal-hero")', 15_000, '详情渲染')

  const bookHero = await p.evaluate(`(() => ({
    title: document.querySelector('.gal-detail .gal-hero h1')?.textContent || '',
    crumb: document.querySelector('.gal-crumbs')?.textContent || '',
    heroSrc: document.querySelector('.gal-hero-icon--photo img')?.getAttribute('src') || '',
    note: document.querySelector('.gal-reader')?.parentElement?.querySelector('.gal-sec-note')?.textContent || '',
    info: document.querySelector('.gal-info')?.textContent || '',
  }))()`)
  check('点击卡片进入作品详情', /静夜思/.test(bookHero?.title || ''), bookHero?.title)
  check('详情页有面包屑与返回入口', /成果展厅/.test(bookHero?.crumb || ''))
  check('详情 hero 用第一张插画', bookHero?.heroSrc === book.images[0], bookHero?.heroSrc)
  check('阅读器标注总页数与插画数', /共 3 页/.test(bookHero?.note || '') && /3 张插画/.test(bookHero?.note || ''), bookHero?.note)
  check('信息栏显示插画数量', /3 张/.test(bookHero?.info || ''), bookHero?.info)

  const spread1 = await p.evaluate(`(() => [...document.querySelectorAll('.gal-face')].map((f) => ({
    img: f.querySelector('.gal-face-media img')?.getAttribute('src') || '',
    art: !!f.querySelector('.gal-face-art'),
    text: f.querySelector('p')?.textContent || '',
  })))()`)
  check('第 1 页渲染真实插画', spread1?.[0]?.img === book.images[0] && spread1?.[0]?.art === false, JSON.stringify(spread1?.[0]))
  check('第 2 页渲染真实插画', spread1?.[1]?.img === book.images[1], JSON.stringify(spread1?.[1]))
  const spreadImgsLoaded = await p.evaluate(
    `[...document.querySelectorAll('.gal-face-media img')].every((i) => i.complete && i.naturalWidth > 0)`,
  )
  check('绘本内页插画全部解码成功', spreadImgsLoaded === true)

  await p.evaluate('document.querySelector(\'[data-act="spread-next"]\').click()')
  await p.waitFor(`!!document.querySelector('.gal-face-media img[src="${book.images[2]}"]')`, 10_000, '翻页')
  const spread2 = await p.evaluate(`(() => ({
    img: document.querySelector('.gal-face-media img')?.getAttribute('src') || '',
    text: document.querySelector('.gal-face p')?.textContent || '',
    range: document.querySelector('[data-gal-range]')?.textContent || '',
  }))()`)
  check('翻页后第 3 页插画同步切换', spread2?.img === book.images[2], spread2?.img)
  check('翻页后正文同步更新', /月光像霜/.test(spread2?.text || ''), spread2?.text)
  check('阅读进度文案同步', /第 3 页/.test(spread2?.range || ''), spread2?.range)

  await p.screenshot('/tmp/gal-book.png')

  // 无图绘本：用场景图标兜底
  await p.evaluate(`location.hash = '#/gallery/${plainBook.id}'`)
  await p.waitFor('!!document.querySelector(".gal-detail .gal-hero")', 15_000, '文字绘本详情')
  const plainFaces = await p.evaluate(`(() => ({
    art: document.querySelectorAll('.gal-face-art').length,
    media: document.querySelectorAll('.gal-face-media').length,
    text: document.querySelector('.gal-face p')?.textContent || '',
  }))()`)
  check('无插画绘本用场景图标兜底', plainFaces?.art === 2 && plainFaces?.media === 0, JSON.stringify(plainFaces))
  check('无插画绘本仍显示正文', /泉眼无声/.test(plainFaces?.text || ''), plainFaces?.text)

  // ── 其他类型详情 ────────────────────────────────────────────
  console.log('\n── 详情：其他类型 ──')
  async function openDetail(id) {
    await p.evaluate(`location.hash = '#/gallery/${id}'`)
    await p.waitFor(`location.hash === '#/gallery/${id}' && !!document.querySelector('.gal-detail .gal-hero')`, 15_000, `详情 ${id.slice(0, 6)}`)
  }

  await openDetail(prompt.id)
  const promptDetail = await p.evaluate(`(() => ({
    imgs: [...document.querySelectorAll('.gal-image-strip img')].map((i) => i.getAttribute('src')),
    loaded: [...document.querySelectorAll('.gal-image-strip img')].every((i) => i.complete && i.naturalWidth > 0),
    sheet: document.querySelector('.gal-prompt-sheet p')?.textContent || '',
    copy: !!document.querySelector('[data-act="copy-prompt"]'),
  }))()`)
  check('提示词详情展示真实图片', promptDetail?.imgs?.length === 1 && promptDetail.imgs[0] === prompt.images[0] && promptDetail.loaded === true, JSON.stringify(promptDetail))
  check('提示词详情展示全文', /巨大的蓝鲸/.test(promptDetail?.sheet || '') && promptDetail?.copy === true)
  await p.screenshot('/tmp/gal-prompt.png')

  await openDetail(observe.id)
  const observeDetail = await p.evaluate(`(() => ({
    imgs: document.querySelectorAll('.gal-image-strip img').length,
    devices: document.querySelectorAll('.gal-device-item').length,
    zones: document.querySelectorAll('.gal-zone').length,
    stats: document.querySelector('.gal-stat b')?.textContent || '',
  }))()`)
  check('观察详情展示真实图片', observeDetail?.imgs === 1, `图片 ${observeDetail?.imgs}`)
  check('观察详情按区域列出 7 件设备', observeDetail?.devices === 7 && observeDetail?.zones === 3 && observeDetail?.stats === '7 件', JSON.stringify(observeDetail))

  await openDetail(map.id)
  const mapDetail = await p.evaluate(`(() => ({
    pins: document.querySelectorAll('.gal-map-pin').length,
    items: [...document.querySelectorAll('.gal-number-list li')].map((n) => n.textContent),
  }))()`)
  check('发现地图详情画出 4 个真实地点', mapDetail?.pins === 4 && mapDetail?.items?.length === 4, JSON.stringify(mapDetail))

  await openDetail(mr.id)
  const mrDetail = await p.evaluate(`(() => ({
    zones: document.querySelectorAll('.gal-plan-zone').length,
    bullets: document.querySelectorAll('.gal-bullets li').length,
    text: document.querySelector('.gal-bullets')?.textContent || '',
  }))()`)
  check('MR 详情有 3 个区域和真实方案要点', mrDetail?.zones === 3 && mrDetail?.bullets === 3 && /全息投影/.test(mrDetail?.text || ''), JSON.stringify(mrDetail))

  await openDetail(invent.id)
  const inventDetail = await p.evaluate(`(() => ({
    visual: !!document.querySelector('.gal-feature-visual .gal-bulb'),
    bullets: [...document.querySelectorAll('.gal-bullets li')].map((n) => n.textContent),
  }))()`)
  check('发明详情有视觉主体与真实创作说明', inventDetail?.visual === true && inventDetail?.bullets?.length === 3 && /自动整理书包/.test(inventDetail.bullets[0] || ''), JSON.stringify(inventDetail))

  await openDetail(project.id)
  const projectDetail = await p.evaluate(`(() => ({
    steps: [...document.querySelectorAll('.gal-timeline li')].map((n) => n.textContent),
  }))()`)
  check('项目详情按步骤展示真实路径', projectDetail?.steps?.length === 4 && /训练一个识别模型/.test(projectDetail.steps.join('')), JSON.stringify(projectDetail))

  await openDetail(ethics.id)
  const ethicsDetail = await p.evaluate(`(() => ({
    rules: [...document.querySelectorAll('.gal-rule p')].map((n) => n.textContent),
    note: document.querySelector('.gal-sec-note')?.textContent || '',
  }))()`)
  check('伦理详情逐条展示真实守则', ethicsDetail?.rules?.length === 3 && /注明来源/.test(ethicsDetail.rules[0] || '') && /3 条/.test(ethicsDetail?.note || ''), JSON.stringify(ethicsDetail))

  // 返回列表
  await p.evaluate('document.querySelector(\'.gal-back-card\').click()')
  await p.waitFor(`location.hash === '#/gallery' && document.querySelectorAll('.gal-card').length > 0`, 15_000, '返回列表')
  check('详情页可返回展厅列表', true)

  // ── 深链接 ─────────────────────────────────────────────────
  console.log('\n── 深链接 ──')
  await p.goto(`${BASE}/#/gallery/${book.id}`)
  await p.waitFor(`!!document.querySelector('.gal-detail .gal-hero h1')`, 20_000, '深链接详情')
  const deep = await p.evaluate(`(() => ({
    title: document.querySelector('.gal-detail .gal-hero h1')?.textContent || '',
    imgs: document.querySelectorAll('.gal-face-media img').length,
  }))()`)
  check('首屏直接打开 /gallery/:id 能渲染详情', /静夜思/.test(deep?.title || ''), deep?.title)
  check('深链接详情同样带真实插画', deep?.imgs === 2, `图片 ${deep?.imgs}`)

  // ── 点赞 ───────────────────────────────────────────────────
  console.log('\n── 互动 ──')
  await p.goto(`${BASE}/#/gallery`)
  await p.waitFor('document.querySelectorAll(".gal-card").length > 0', 20_000, '列表')
  const likeSel = `[data-work-id="${map.id}"] [data-act="like"]`
  const likeBefore = await p.evaluate(`Number(document.querySelector('${likeSel} [data-like-count]').textContent)`)
  await p.evaluate(`document.querySelector('${likeSel}').click()`)
  await p.waitFor(`document.querySelector('${likeSel}').classList.contains('is-on')`, 10_000, '点赞')
  const likeAfter = await p.evaluate(`Number(document.querySelector('${likeSel} [data-like-count]').textContent)`)
  const apiLiked = await client.call(`/api/works/${map.id}`)
  check('点赞后即时高亮并 +1', likeAfter === likeBefore + 1, `${likeBefore} → ${likeAfter}`)
  check('点赞状态已写入后端', apiLiked.json?.work?.liked === true && apiLiked.json?.work?.likes === likeAfter, `liked=${apiLiked.json?.work?.liked} likes=${apiLiked.json?.work?.likes}`)
  await p.evaluate(`document.querySelector('${likeSel}').click()`)
  await p.waitFor(`!document.querySelector('${likeSel}').classList.contains('is-on')`, 10_000, '取消点赞')
  const likeBack = await p.evaluate(`Number(document.querySelector('${likeSel} [data-like-count]').textContent)`)
  check('再次点击取消点赞并还原计数', likeBack === likeBefore, `${likeBack}`)

  // ── 移动端 ─────────────────────────────────────────────────
  console.log('\n── 移动端与游客态 ──')
  await p.setViewport(390, 844)
  await sleep(500)
  const mobile = await p.evaluate(`(() => {
    const grid = document.querySelector('.gal-grid')
    const c = document.querySelector('.gal-container')
    const cr = c.getBoundingClientRect()
    const pr = c.parentElement.getBoundingClientRect()
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
    return {
      cols,
      cw: Math.round(cr.width),
      pw: Math.round(pr.width),
      lg: Math.round(cr.left - pr.left),
      rg: Math.round(pr.right - cr.right),
    }
  })()`)
  check('移动端展厅为单列布局', mobile?.cols === 1, JSON.stringify(mobile))
  check(
    '移动端容器宽度贴合父级（左右各留 16px）',
    Math.abs(mobile?.cw - (mobile?.pw - 32)) <= 2 && Math.abs(mobile.lg - mobile.rg) <= 2,
    JSON.stringify(mobile),
  )
  await p.screenshot('/tmp/gal-mobile.png')
  await p.setViewport(1366, 900)

  // ── 从个人作品发布 ────────────────────────────────────────
  // 展厅不再直接建作品：草稿先在「我的作品」里，挑选后才上墙。
  console.log('\n── 个人作品：挑选发布与撤下 ──')
  const draft = await postWork(
    {
      title: '个人草稿待发布',
      type: 'AI 创新项目',
      grade: 'mid',
      module: 'm4',
      desc: '这份作品先保存在个人作品库，等待挑选发布。',
      hue: 120,
    },
    'picker-draft',
    { publish: false },
  )
  await p.goto(`${BASE}/#/gallery`)
  await p.waitFor('document.querySelector(\'[data-act="publish-mine"]\')', 20_000, '发布入口')
  check(
    '展厅工具栏有「我的作品」入口',
    await p.evaluate('!!document.querySelector(\'.gal-toolbar a[href="#/me/works"]\')'),
  )
  await p.evaluate('document.querySelector(\'[data-act="publish-mine"]\').click()')
  await p.waitFor('document.querySelectorAll("[data-gal-pick]").length === 1', 20_000, '个人作品弹层')
  const picker = await p.evaluate(`(() => ({
    rows: document.querySelectorAll('[data-gal-pick]').length,
    titles: Array.from(document.querySelectorAll('.gal-pick-title')).map((el) => el.textContent),
    disabled: document.querySelector('[data-gal-publish]').disabled,
    manage: !!document.querySelector('.gal-modal-foot a[href="#/me/works"]'),
  }))()`)
  check('发布弹层只列出草稿作品', picker.rows === 1 && picker.titles.some((t) => /个人草稿待发布/.test(t)), JSON.stringify(picker))
  check('未选中时发布按钮禁用', picker.disabled === true)
  check('弹层里有「管理我的作品」入口', picker.manage === true)
  await p.evaluate('document.querySelector("[data-gal-pick]").click()')
  await p.waitFor('!document.querySelector("[data-gal-publish]").disabled', 5_000, '选择后启用发布')
  await p.evaluate('document.querySelector("[data-gal-publish]").click()')
  await p.waitFor(`document.querySelector('[data-work-id="${draft.id}"]')`, 20_000, '发布后卡片')
  const publishedApi = await client.call(`/api/works/${draft.id}`)
  check('挑选发布的草稿出现在展厅', publishedApi.status === 200 && publishedApi.json?.work?.published === true)
  check('发布后弹层自动关闭', await p.evaluate('!document.querySelector(".gal-modal-backdrop")'))
  await p.evaluate(`document.querySelector('[data-work-id="${draft.id}"] [data-act="unpublish"]').click()`)
  await p.waitFor('document.querySelector("[data-modal-ok]")', 5_000, '撤下确认')
  await p.evaluate('document.querySelector("[data-modal-ok]").click()')
  await p.waitFor(`!document.querySelector('[data-work-id="${draft.id}"]')`, 20_000, '撤下后消失')
  const unpublishedApi = await client.call(`/api/works/${draft.id}`)
  check('撤下后作品回到草稿状态', unpublishedApi.status === 200 && unpublishedApi.json?.work?.published === false)

  await p.clearCookies()
  await p.goto('about:blank', null)
  await p.goto(`${BASE}/#/gallery`)
  await p.waitFor('document.querySelectorAll(".gal-card").length > 0', 20_000, '游客列表')
  const guestCards = await p.evaluate('document.querySelectorAll(".gal-card").length')
  check('游客也能浏览展厅', guestCards === 24, `卡片 ${guestCards}`)
  await p.evaluate('document.querySelector(\'[data-act="publish-mine"]\').click()')
  await p.waitFor('document.querySelector(".gal-toast") && /登录后才能发布作品/.test(document.querySelector(".gal-toast").textContent)', 8_000, '发布登录提示')
  check('游客点发布提示先登录', true)

  // ── 删除与文件清理 ─────────────────────────────────────────
  console.log('\n── 删除：数据库与磁盘同步 ──')
  for (const w of [book, prompt, observe, remoteWork]) {
    const del = await client.call(`/api/works/${w.id}`, { method: 'DELETE' })
    check(`删除作品「${w.title}」成功`, del.status === 200 && del.json?.ok === true, `status=${del.status}`)
  }
  const gone = await client.call(`/api/works/${book.id}`)
  check('删除后详情接口返回 404', gone.status === 404, `status=${gone.status}`)
  const lingering = [
    ...(book.images || []),
    ...(prompt.images || []),
    ...(observe.images || []),
    ...(remoteWork.images || []),
  ]
  check(
    '删除作品时磁盘图片一并清理',
    lingering.every((path) => sizeOf(path) === -1),
    lingering.map((path) => `${path}:${sizeOf(path)}`).join(' '),
  )
}

let exitErr = null
try {
  await main()
} catch (err) {
  exitErr = err
  console.error(`\n💥 验收中断: ${err.message}`)
} finally {
  // 图片作品若还在，先按正常接口删掉，避免验收失败后留下孤儿文件
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
    cleanupUser(BASE, EMAIL, NICK)
  } catch (err) {
    console.error(`清理测试账号失败: ${err.message}`)
  }
}

const failed = summary() + (exitErr ? 1 : 0)
process.exit(failed ? 1 : 0)
