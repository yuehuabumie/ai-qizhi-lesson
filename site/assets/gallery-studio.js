/**
 * 「成果展厅」运行时替换 /gallery 与 /gallery/:id。
 *
 * 服务器上只有 Vite 构建产物，没有前端源码（见 HANDOFF §5）。沿用创作台的做法：
 *   1. 等 app 挂载后，用 $router 替换原有 /gallery 路由，并新增 /gallery/:id；
 *   2. 组件 render() 返回 null，在 $el（注释占位节点）前插入自己的 DOM；
 *   3. 交互全部原生 DOM，样式走站点 CSS 变量，自动跟随明暗主题。
 *
 * 这一版的两件事：
 *   · 不同作品类型有自己的封面母题与正文预览（绘本是书页，提示词是文稿，
 *     观察记录/发现地图是设备与路线，MR 是空间网格……），不再全是同一个 🎨；
 *   · 卡片可点进详情页，详情链接可收藏、可直接打开；详情页按类型展开内容。
 *
 * 约束：works 表刻意没有图片字段，所以插画区只用 CSS/SVG 母题与文字派生，
 * 不引入 schema 变更，也不假装这里存了真实图片。
 */
;(() => {
  'use strict'

  if (window.__AIQ_GALLERY_STUDIO__) return
  window.__AIQ_GALLERY_STUDIO__ = true

  // ── 站点元数据 ─────────────────────────────────────────────
  const MODULES = [
    { id: 'm1', code: 'AI·认知', name: '探索智能', color: '#4f7cff' },
    { id: 'm2', code: 'AI·生成', name: '创作智能', color: '#a855f7' },
    { id: 'm3', code: 'AI·交互', name: '体验智能', color: '#14b8a6' },
    { id: 'm4', code: 'AI·实践', name: '创造智能', color: '#f59e0b' },
  ]
  const GRADES = { low: '低段', mid: '中段', high: '高段' }
  const PAGE_SIZE = 24

  /**
   * 类型 → 视觉身份。
   * key 决定封面母题与详情页排布，color 决定类型色（不是作品的 hue）。
   * 作品 hue 仍保留，作为封面里一层很淡的洗色，避免同类型卡片完全一样。
   */
  const TYPES = {
    'AI 课文绘本': { key: 'book', icon: 'book', color: '#a855f7', kicker: '图文叙事' },
    提示词设计: { key: 'prompt', icon: 'prompt', color: '#f59e0b', kicker: '提示词创作' },
    观察记录: { key: 'observe', icon: 'radar', color: '#14b8a6', kicker: '观察探究' },
    'AI 发现地图': { key: 'map', icon: 'map', color: '#4f7cff', kicker: '发现地图' },
    'MR 空间方案': { key: 'mr', icon: 'cube', color: '#06b6d4', kicker: '空间设计' },
    'AI 发明作品': { key: 'invent', icon: 'bulb', color: '#f97316', kicker: '发明创造' },
    'AI 创新项目': { key: 'project', icon: 'rocket', color: '#ec4899', kicker: '项目实践' },
    'AI 伦理守则': { key: 'ethics', icon: 'shield', color: '#10b981', kicker: '伦理约定' },
  }
  const FALLBACK_TYPE = { key: 'create', icon: 'palette', color: '#64748b', kicker: '学生创作' }

  // ── 图标（与站点 Element Plus 图标同一路数：24 视框、圆头描边）──
  const ICONS = {
    star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6z"/>',
    sparkles:
      '<path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7L12 3.5z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
    book: '<path d="M12 5.5C10 4.2 7.6 3.5 5 3.5v15c2.6 0 5 .7 7 2 2-1.3 4.4-2 7-2v-15c-2.6 0-5 .7-7 2z"/><path d="M12 5.5v15"/>',
    prompt:
      '<path d="M5 4.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z"/><path d="M8 9h8M8 12.5h5"/>',
    radar:
      '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/><path d="M12 12l6-6"/>',
    map: '<path d="M9 4.5L3.5 6.8v13l5.5-2.3 6 2.3 5.5-2.3v-13L15 6.8 9 4.5z"/><path d="M9 4.5v13M15 6.8v13"/>',
    cube: '<path d="M12 3.2l8 4.4v8.8l-8 4.4-8-4.4V7.6l8-4.4z"/><path d="M12 12l8-4.4M12 12L4 7.6M12 12v8.8"/>',
    bulb: '<path d="M9.5 18h5M10 21h4"/><path d="M12 3.5a6 6 0 0 0-3.6 10.8c.8.6 1.3 1.5 1.3 2.5v.7h4.6v-.7c0-1 .5-1.9 1.3-2.5A6 6 0 0 0 12 3.5z"/>',
    rocket:
      '<path d="M14.5 3.5c3 .4 5.5 2.9 6 6l-6.8 6.8-4.3-4.3L14.5 3.5z"/><circle cx="16.5" cy="7.5" r="1.7"/><path d="M9.4 12l-4.9 1.6L2.5 21.5l7.9-2L12 14.6"/><path d="M7 17l-2 3"/>',
    shield:
      '<path d="M12 3l7.5 2.8v5.4c0 4.4-3 8.1-7.5 9.8-4.5-1.7-7.5-5.4-7.5-9.8V5.8L12 3z"/><path d="M9 12l2.1 2.1L15.4 10"/>',
    palette:
      '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.9-.8 1.9-1.8 0-.5-.2-1-.5-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7h1.9a4.9 4.9 0 0 0 4.9-4.9c0-3.3-4.2-5.9-9.5-5.9z"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="17" cy="10.5" r="1" fill="currentColor" stroke="none"/>',
    heart:
      '<path d="M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.8 3 6.1 5.1 4 7.8 4c1.6 0 3.1.7 4.2 2 1.1-1.3 2.6-2 4.2-2C18.9 4 21 6.1 21 8.8c0 3.4-3 6.1-7.7 10.3L12 20.3z"/>',
    trash:
      '<path d="M4 6.5h16M9 6.5V4h6v2.5M6.5 6.5l.8 13a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-13"/><path d="M10 10.5v6M14 10.5v6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    check: '<path d="M5 12.5l4.3 4.3L19 7"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/>',
    alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17h.01"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    // 设备图标：观察记录 / 发现地图按关键词配对
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 14.5v2"/>',
    tv: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 21h8M12 18v3"/>',
    camera:
      '<path d="M4 8.5h3l1.5-2h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 4 8.5z"/><circle cx="12" cy="13.5" r="3.5"/>',
    vacuum:
      '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/>',
    speaker:
      '<rect x="6" y="3" width="12" height="18" rx="3"/><circle cx="12" cy="8.5" r="2.5"/><circle cx="12" cy="15.5" r="1.5"/>',
    phone: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
    watch: '<rect x="7" y="6" width="10" height="12" rx="3"/><path d="M9 6V3.5h6V6M9 18v2.5h6V18"/><path d="M12 9.5V12l1.5 1"/>',
    car: '<path d="M4 16.5v-3l2-5h12l2 5v3"/><path d="M4 13.5h16"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/>',
    drone:
      '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.5"/><path d="M8 8l3 3M16 8l-3 3M8 16l3-3M16 16l-3-3"/>',
    nav: '<path d="M12 3l7 18-7-4-7 4 7-18z"/>',
    wind: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3M3 16h7"/>',
    fridge: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M6 10h12M9 6.5v1.5M9 13v2"/>',
    robot:
      '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9.5 4h5"/><circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none"/><path d="M9.5 16h5"/>',
    chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3.5v3.5M14 3.5v3.5M10 17v3.5M14 17v3.5M3.5 10H7M3.5 14H7M17 10h3.5M17 14h3.5"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8.2 8.2 0 1 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>',
    water: '<path d="M3 8c2-1.7 4-1.7 6 0s4 1.7 6 0 4-1.7 6 0M3 13c2-1.7 4-1.7 6 0s4 1.7 6 0 4-1.7 6 0M3 18c2-1.7 4-1.7 6 0s4 1.7 6 0 4-1.7 6 0"/>',
    sprout:
      '<path d="M12 21v-8"/><path d="M12 13C12 9 9 6 5 6c0 4 3 7 7 7zM12 11c0-3 2.5-5.5 5.5-5.5 0 3-2.5 5.5-5.5 5.5z"/>',
    cloud: '<path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6.3 9.5 4.3 4.3 0 0 0 7 18z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c0-4.1 3.4-6.5 7.5-6.5s7.5 2.4 7.5 6.5"/>',
    eyeOff:
      '<path d="M3 3l18 18"/><path d="M10.6 10.6a2.5 2.5 0 0 0 3.5 3.5"/><path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c5 0 9 4.5 9 7 0 .8-.6 2-1.7 3.1M6.2 6.2C4 7.8 3 9.5 3 12c0 2.5 4 7 9 7 1.2 0 2.3-.2 3.3-.7"/>',
  }

  const svgIcon = (name, cls) =>
    `<svg class="gal-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.sparkles}</svg>`

  // ── 小工具 ─────────────────────────────────────────────────
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })

  const truncate = (s, n) => {
    const t = String(s == null ? '' : s)
    return t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t
  }

  const alpha = (hex, a) => {
    const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ''))
    if (!m) return `rgba(100,116,139,${a})`
    const n = parseInt(m[1], 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
  }

  function hslHex(h, s, l) {
    s /= 100
    l /= 100
    const k = (n) => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
    const to = (x) => Math.round(255 * x).toString(16).padStart(2, '0')
    return '#' + to(f(0)) + to(f(8)) + to(f(4))
  }

  function metaFor(work) {
    const known = TYPES[work.type]
    if (known) return known
    const hue = Number(work.hue)
    const h = Number.isFinite(hue) ? Math.max(0, Math.min(360, hue)) : 210
    return { ...FALLBACK_TYPE, color: hslHex(h, 68, 55) }
  }

  function moduleOf(id) {
    return MODULES.find((m) => m.id === id) || { id: '', code: 'AI', name: '综合', color: '#64748b' }
  }

  const gradeLabel = (key) => GRADES[key] || '全段'

  function dateText(iso) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }

  function coverVars(work, meta) {
    const hue = Number(work.hue)
    const h = Number.isFinite(hue) ? Math.max(0, Math.min(360, hue)) : 210
    return `--gal-tint:${meta.color};--gal-tint-a:${alpha(meta.color, 0.17)};--gal-tint-b:${alpha(meta.color, 0.05)};--gal-hue-a:hsla(${h}, 85%, 60%, .14)`
  }

  /** API 已保证是站内 /uploads/works/ 路径；这里再过滤一次，别让异常值进 src */
  function imagesOf(work) {
    return Array.isArray(work && work.images)
      ? work.images.filter(
          (p) => typeof p === 'string' && /^\/uploads\/works\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(p),
        )
      : []
  }

  // ── 内容解析（works 没有图片，展示只能从文字里长出来）──────
  function parsePages(desc) {
    const text = String(desc || '')
    const re = /第\s*(\d+)\s*页\s*[：:]\s*/g
    const marks = []
    let m
    while ((m = re.exec(text))) marks.push({ index: m.index, end: re.lastIndex, n: Number(m[1]) })
    return marks
      .map((mk, i) => ({
        n: mk.n,
        // 与提交时的页序对齐：第 i 个分页标记用 images[i]。
        // 即使某页文字为空被过滤，后面的页也不会因此错位。
        idx: i,
        text: text
          .slice(mk.end, i + 1 < marks.length ? marks[i + 1].index : text.length)
          .trim(),
      }))
      .filter((p) => p.text)
  }

  function splitSentences(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .split(/(?<=[。！？!?；;])|\n+/)
      .map((s) => s.trim().replace(/[；;]$/, ''))
      .filter(Boolean)
  }

  function splitItems(text) {
    return String(text || '')
      .split(/[、,，；;。\n]/)
      .map((s) => s.trim())
      .filter((s) => s && s.length <= 60)
  }

  function parseZones(desc) {
    const segments = String(desc || '')
      .replace(/\r/g, '')
      .split(/\n+|[；;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const zones = []
    for (const seg of segments) {
      const m = seg.match(/^([^：:]{1,20})[：:]\s*(.+)$/)
      if (m) {
        const items = splitItems(m[2])
        if (items.length) zones.push({ title: m[1].trim(), items })
      } else {
        const items = splitItems(seg)
        if (!items.length) continue
        const prev = zones[zones.length - 1]
        if (prev && prev.implicit) prev.items.push(...items)
        else zones.push({ title: '观察到的设备', items, implicit: true })
      }
    }
    return zones
  }

  function parseCounts(title) {
    const t = String(title || '')
    const pair = t.match(/(\d+)\s*\/\s*(\d+)/)
    const score = t.match(/(\d+)\s*分/)
    const pieces = t.match(/(\d+)\s*件/)
    return {
      found: pair ? Number(pair[1]) : pieces ? Number(pieces[1]) : null,
      target: pair ? Number(pair[2]) : null,
      score: score ? Number(score[1]) : null,
    }
  }

  const DEVICE_RULES = [
    [/门锁|门禁|闸机/, 'lock'],
    [/电视|屏幕/, 'tv'],
    [/摄像|监控|相机|人脸/, 'camera'],
    [/扫地|吸尘/, 'vacuum'],
    [/音箱|语音|助手|喇叭/, 'speaker'],
    [/手机|平板/, 'phone'],
    [/手表|手环/, 'watch'],
    [/汽车|车|导航/, 'car'],
    [/无人|飞机/, 'drone'],
    [/空调|风扇|空气/, 'wind'],
    [/冰箱|冷柜/, 'fridge'],
    [/机器人/, 'robot'],
    [/灯|照明/, 'bulb'],
  ]
  function deviceIcon(name) {
    for (const [re, icon] of DEVICE_RULES) if (re.test(name)) return icon
    return 'chip'
  }

  const SCENE_RULES = [
    [/月亮|夜|星星|窗前/, 'moon'],
    [/太阳|春天|早晨|天亮|阳光/, 'sun'],
    [/池塘|河|水|鹅|蝌蚪|游/, 'water'],
    [/田|禾|苗|农/, 'sprout'],
    [/云|天空|风/, 'cloud'],
  ]
  function sceneIcon(text) {
    for (const [re, icon] of SCENE_RULES) if (re.test(text)) return icon
    return 'sparkles'
  }

  function paragraphs(text) {
    return String(text || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => `<p>${esc(s)}</p>`)
      .join('')
  }

  // ── API ────────────────────────────────────────────────────
  async function api(path, opts = {}) {
    const init = {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: {},
    }
    if (opts.body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(opts.body)
    }
    let res
    try {
      res = await fetch(path, init)
    } catch {
      throw new Error('网络连接失败，请稍后再试')
    }
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      /* 非 JSON（nginx 错误页等） */
    }
    if (!res.ok) {
      const e = json && json.error
      const msg =
        (e && typeof e === 'string' ? e : e && e.message) ||
        (json && typeof json.message === 'string' ? json.message : '') ||
        `请求失败（${res.status}）`
      const err = new Error(msg)
      err.status = res.status
      throw err
    }
    return json
  }

  const hrefFor = (name, params) => {
    try {
      return ctx.router.resolve({ name, params }).href
    } catch {
      return name === 'gallery' ? '#/gallery' : `#/gallery/${encodeURIComponent(params?.id || '')}`
    }
  }

  // ── 页面状态 ───────────────────────────────────────────────
  const S = {
    mode: 'list',
    workId: '',
    works: [],
    total: 0,
    page: 0,
    hasMore: false,
    filter: 'all',
    loading: false,
    loaded: false,
    error: '',
    me: null,
    meLoaded: false,
    work: null,
    workLoading: false,
    workError: '',
    workMissing: false,
    spread: 0,
    busy: new Set(),
    reqSeq: 0,
  }
  let mePromise = null
  let root = null
  let toastEl = null
  let toastTimer = 0
  let modalEl = null
  let modalReturnFocus = null
  let modalKeyHandler = null
  const ctx = { router: null }

  function resetState(mode, id) {
    S.mode = mode
    S.workId = id || ''
    S.works = []
    S.total = 0
    S.page = 0
    S.hasMore = false
    S.filter = 'all'
    S.loading = false
    S.loaded = false
    S.error = ''
    S.work = null
    S.workLoading = mode === 'detail'
    S.workError = ''
    S.workMissing = false
    S.spread = 0
    S.busy.clear()
    S.reqSeq++
  }

  function ensureMeLoaded() {
    if (!mePromise) {
      mePromise = api('/api/auth/me')
        .then((data) => {
          S.me = data && data.user ? data.user : null
          return S.me
        })
        .catch(() => {
          S.me = null
          return null
        })
        .finally(() => {
          S.meLoaded = true
        })
    }
    return mePromise
  }

  // ── 列表页 ─────────────────────────────────────────────────
  function listShell() {
    const options = [
      '<option value="all">全部模块</option>',
      ...MODULES.map((m) => `<option value="${m.id}">${esc(m.code)} ${esc(m.name)}</option>`),
    ].join('')
    return `<div class="gal-container">
      <header class="gal-head">
        <span class="gal-tag">${svgIcon('star')}成果展厅</span>
        <h2 class="gal-title"><span class="gal-grad">学生作品墙 · 看得见的成长</span></h2>
        <p class="gal-sub">AI 发现地图、课文绘本、MR 设计方案、发明作品……互动训练里保存的作品都会出现在这里。点开卡片可以查看完整作品，支持点赞、筛选与展示汇报。</p>
      </header>
      <div class="gal-toolbar">
        <label class="gal-sr" for="gal-filter">按模块筛选作品</label>
        <select class="gal-select" id="gal-filter">${options}</select>
        <span class="gal-count">共 <b data-gal-count>0</b> 份作品</span>
        <div class="gal-actions">
          <a class="gal-btn" href="#/me/works">${svgIcon('user')}我的作品</a>
          <button type="button" class="gal-btn gal-primary gal-upload" data-act="publish-mine">${svgIcon('plus')}发布我的作品</button>
        </div>
      </div>
      <div class="gal-grid" id="gal-grid" role="list" aria-busy="true">${skeletonCards(6)}</div>
      <div id="gal-more"></div>
    </div>`
  }

  function skeletonCards(n) {
    return Array.from(
      { length: n },
      () =>
        '<div class="gal-card gal-skel" aria-hidden="true"><div class="gal-skel-cover"></div><div class="gal-body"><span class="gal-skel-line w60"></span><span class="gal-skel-line w40"></span><span class="gal-skel-line"></span><span class="gal-skel-line w80"></span></div></div>',
    ).join('')
  }

  function updateCount() {
    const el = root && root.querySelector('[data-gal-count]')
    if (el) el.textContent = String(S.total)
  }

  function loadMoreHTML() {
    if (S.loading && S.works.length) {
      return '<div class="gal-more"><button type="button" class="gal-btn" disabled>加载中…</button></div>'
    }
    if (S.hasMore) {
      return `<div class="gal-more"><button type="button" class="gal-btn" data-act="more">加载更多（还有 ${Math.max(0, S.total - S.works.length)} 份）</button></div>`
    }
    return ''
  }

  function renderMore() {
    const el = root && root.querySelector('#gal-more')
    if (el) el.innerHTML = loadMoreHTML()
  }

  function emptyHTML(icon, title, text, action) {
    return `<div class="gal-empty">
      <div class="gal-empty-icon">${svgIcon(icon)}</div>
      <h3>${esc(title)}</h3>
      <p>${esc(text)}</p>
      ${action || ''}
    </div>`
  }

  function renderGrid() {
    const grid = root && root.querySelector('#gal-grid')
    if (!grid) return
    if (S.error && !S.works.length) {
      grid.setAttribute('aria-busy', 'false')
      grid.innerHTML = emptyHTML(
        'alert',
        '作品加载失败',
        S.error,
        '<button type="button" class="gal-btn" data-act="retry-list">重新加载</button>',
      )
      renderMore()
      return
    }
    if (!S.works.length) {
      grid.setAttribute('aria-busy', S.loading ? 'true' : 'false')
      grid.innerHTML = emptyHTML(
        'image',
        '还没有作品',
        '作品会先保存到「我的作品」，挑一份发布就能上墙',
        '<button type="button" class="gal-btn gal-primary" data-act="publish-mine">从我的作品发布</button>',
      )
      renderMore()
      return
    }
    grid.setAttribute('aria-busy', S.loading ? 'true' : 'false')
    grid.innerHTML = S.works.map(cardHTML).join('')
    renderMore()
  }

  // ── 卡片 ───────────────────────────────────────────────────
  function coverBadge(work, meta) {
    switch (meta.key) {
      case 'book': {
        const n = parsePages(work.desc).length
        return n ? `${n} 页` : '绘本'
      }
      case 'prompt':
        return work.desc ? `${String(work.desc).length} 字` : '提示词'
      case 'observe': {
        const n = parseZones(work.desc).reduce((sum, z) => sum + z.items.length, 0)
        return n ? `${n} 件` : '观察'
      }
      case 'map': {
        const n = parseZones(work.desc).reduce((sum, z) => sum + z.items.length, 0)
        return n ? `${n} 处` : '地图'
      }
      case 'mr': {
        const n = parseZones(work.desc).length
        return n ? `${n} 区` : '空间'
      }
      case 'invent':
        return '发明'
      case 'project':
        return '项目'
      case 'ethics': {
        const n = splitSentences(work.desc).length
        return n ? `${n} 条` : '守则'
      }
      default:
        return '作品'
    }
  }

  function artFor(work, meta) {
    switch (meta.key) {
      case 'book': {
        const pages = parsePages(work.desc)
        return `<span class="gal-booklet">
          <span class="gal-booklet-page gal-booklet-page--l"><b>${pages[0] ? pages[0].n : 1}</b><i class="l1"></i><i class="l2"></i><i class="l3"></i><span class="gal-booklet-moon"></span></span>
          <span class="gal-booklet-page gal-booklet-page--r"><b>${pages[1] ? pages[1].n : 2}</b><i class="l1"></i><i class="l2"></i><i class="l3 short"></i></span>
          <span class="gal-booklet-spine"></span>
        </span>`
      }
      case 'prompt': {
        const snippet = truncate(work.desc || '把想到的画面写下来，让 AI 帮你画出来。', 52)
        return `<span class="gal-prompt-mini"><span class="gal-prompt-spark">${svgIcon('sparkles')}</span><p>${esc(snippet)}</p><span class="gal-prompt-caret"></span></span>`
      }
      case 'observe': {
        const devices = parseZones(work.desc)
          .flatMap((z) => z.items)
          .slice(0, 6)
        if (!devices.length) return `<span class="gal-device-empty">${svgIcon('radar')}</span>`
        return `<span class="gal-device-grid">${devices
          .map(
            (d) =>
              `<span class="gal-device">${svgIcon(deviceIcon(d))}<em>${esc(truncate(d, 6))}</em></span>`,
          )
          .join('')}</span>`
      }
      case 'map': {
        const nodes = parseZones(work.desc)
          .flatMap((z) => z.items)
          .slice(0, 4)
        const pos = MAP_POS.slice(0, Math.max(1, nodes.length))
        const path = pos.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')
        return `<span class="gal-map-mini"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 3" stroke-linecap="round"/></svg>${nodes
          .map(
            (n, i) =>
              `<span class="gal-map-node" style="left:${pos[i][0]}%;top:${pos[i][1]}%"><b>${i + 1}</b><span>${esc(truncate(n, 7))}</span></span>`,
          )
          .join('')}${nodes.length ? '' : '<span class="gal-map-node" style="left:50%;top:50%"><b>+</b><span>发现 AI</span></span>'}</span>`
      }
      case 'mr': {
        const zones = parseZones(work.desc)
        const labels = (zones.some((z) => !z.implicit) ? zones.map((z) => z.title) : zones.flatMap((z) => z.items)).slice(0, 3)
        return `<span class="gal-room-mini"><span class="gal-room-floor"></span>${(labels.length ? labels : ['空间方案'])
          .map(
            (t, i) =>
              `<span class="gal-room-tile" style="left:${ROOM_POS[i][0]}%;top:${ROOM_POS[i][1]}%">${esc(truncate(t, 6))}</span>`,
          )
          .join('')}</span>`
      }
      case 'invent': {
        const first = splitSentences(work.desc)[0] || '作者还没有写下发明想法'
        return `<span class="gal-note-mini gal-note-mini--invent">
          <span class="gal-note-badge">${svgIcon('bulb')}发明想法</span>
          <p>${esc(truncate(first, 46))}</p>
          <span class="gal-note-deco">${svgIcon('gear')}</span>
        </span>`
      }
      case 'project': {
        const steps = splitSentences(work.desc)
        return `<span class="gal-note-mini gal-note-mini--project">
          <span class="gal-note-badge">${svgIcon('rocket')}项目路径</span>
          <p>${esc(truncate(steps[0] || '作者还没有写下项目步骤', 44))}</p>
          <span class="gal-note-count">${steps.length ? `${steps.length} 步` : '待开始'}</span>
          <span class="gal-note-deco">${svgIcon('rocket')}</span>
        </span>`
      }
      case 'ethics': {
        const rules = splitSentences(work.desc)
        const shown = rules.length ? rules : ['作者还没有写下守则']
        return `<span class="gal-ethics-mini">
          <span class="gal-shield">${svgIcon('shield')}</span>
          <span class="gal-rule-lines">${shown
            .slice(0, 3)
            .map((r) => `<em>${esc(truncate(r, 14))}</em>`)
            .join('')}</span>
          <span class="gal-rule-count">${rules.length ? `${rules.length} 条` : ''}</span>
        </span>`
      }
      default: {
        const hue = Number(work.hue)
        const h = Number.isFinite(hue) ? Math.max(0, Math.min(360, hue)) : 210
        return `<span class="gal-note-mini gal-note-mini--create">
          <span class="gal-note-badge">${svgIcon('palette')}${esc(work.type || '学生创作')}</span>
          <p>${esc(truncate(work.desc || '作者还没有填写作品说明', 48))}</p>
          <span class="gal-palette-dots"><i style="background:hsl(${h},80%,65%)"></i><i style="background:hsl(${(h + 60) % 360},80%,65%)"></i><i style="background:hsl(${(h + 120) % 360},80%,65%)"></i></span>
        </span>`
      }
    }
  }

  const MAP_POS = [
    [16, 26],
    [43, 15],
    [72, 23],
    [85, 51],
    [64, 77],
    [36, 79],
    [17, 60],
    [50, 48],
  ]
  const ROOM_POS = [
    [31, 33],
    [67, 28],
    [70, 65],
    [36, 70],
  ]

  function chipsHTML(items, max) {
    const shown = items.slice(0, max)
    const extra = items.length - shown.length
    return `<span class="gal-preview-chips">${shown
      .map((t) => `<span class="gal-chip">${esc(truncate(t, 10))}</span>`)
      .join('')}${extra > 0 ? `<span class="gal-chip gal-chip-more">+${extra}</span>` : ''}</span>`
  }

  function previewHTML(work, meta) {
    switch (meta.key) {
      case 'book': {
        const pages = parsePages(work.desc)
        if (pages.length) {
          return `<span class="gal-quote-preview"><span class="gal-quote-tag">第 ${pages[0].n} 页</span><span class="gal-clamp2">${esc(pages[0].text)}</span></span>`
        }
        return `<span class="gal-clamp3">${esc(work.desc || '还没有填写页面文字')}</span>`
      }
      case 'prompt':
        return `<span class="gal-prompt-preview">“${esc(truncate(work.desc || '还没有填写提示词', 92))}”</span>`
      case 'observe': {
        const items = parseZones(work.desc).flatMap((z) => z.items)
        return items.length ? chipsHTML(items, 4) : `<span class="gal-clamp3">${esc(work.desc || '还没有填写观察记录')}</span>`
      }
      case 'map': {
        const items = parseZones(work.desc).flatMap((z) => z.items)
        return items.length ? chipsHTML(items, 3) : `<span class="gal-clamp3">${esc(work.desc || '还没有填写发现内容')}</span>`
      }
      case 'mr': {
        const zones = parseZones(work.desc)
        const items = zones.some((z) => !z.implicit) ? zones.map((z) => z.title) : zones.flatMap((z) => z.items)
        return items.length ? chipsHTML(items, 3) : `<span class="gal-clamp3">${esc(work.desc || '还没有填写空间方案')}</span>`
      }
      default:
        return `<span class="gal-clamp3">${esc(work.desc || '作者还没有填写作品说明')}</span>`
    }
  }

  function cardHTML(work) {
    const meta = metaFor(work)
    const module = moduleOf(work.module)
    const imgs = imagesOf(work)
    const badge = imgs.length
      ? `${imgs.length} 张${meta.key === 'book' ? '插画' : '图片'}`
      : coverBadge(work, meta)
    const badges = `
        <span class="gal-badge gal-badge-type">${svgIcon(meta.icon)}${esc(work.type || '学生创作')}</span>
        <span class="gal-badge gal-badge-count">${esc(badge)}</span>`
    // 有真实插画就用插画当封面——作品本身长什么样，比任何母题都直观。
    const cover = imgs.length
      ? `<div class="gal-cover gal-cover--photo" style="${coverVars(work, meta)}">
        <img class="gal-cover-img" src="${esc(imgs[0])}" alt="" loading="lazy" decoding="async">
        <span class="gal-cover-shade" aria-hidden="true"></span>${badges}
      </div>`
      : `<div class="gal-cover gal-cover--${meta.key}" style="${coverVars(work, meta)}">
        <span class="gal-cover-glow" aria-hidden="true"></span>
        <div class="gal-cover-art" aria-hidden="true">${artFor(work, meta)}</div>${badges}
      </div>`
    return `<article class="gal-card" data-work-id="${esc(work.id)}" role="listitem">
      <a class="gal-hit" href="${hrefFor('gallery-work', { id: work.id })}" aria-label="查看作品《${esc(work.title)}》详情"></a>
      ${cover}
      <div class="gal-body">
        <h3 class="gal-card-title">${esc(work.title)}</h3>
        <div class="gal-card-sub"><span>${esc(work.author)}</span><span class="gal-dot" aria-hidden="true"></span><span>${esc(dateText(work.createdAt))}</span></div>
        <div class="gal-preview">${previewHTML(work, meta)}</div>
        <div class="gal-foot">
          <button type="button" class="gal-like${work.liked ? ' is-on' : ''}" data-act="like" data-id="${esc(work.id)}" aria-pressed="${work.liked ? 'true' : 'false'}" aria-label="${work.liked ? '取消点赞' : '点赞'}《${esc(work.title)}》，当前 ${work.likes} 个赞">${svgIcon('heart')}<span data-like-count>${work.likes}</span></button>
          ${work.mine ? `<button type="button" class="gal-icon-btn gal-unpublish" data-act="unpublish" data-id="${esc(work.id)}" aria-label="从展厅撤下《${esc(work.title)}》">${svgIcon('eyeOff')}</button>` : ''}
          <span class="gal-module" style="--gal-mc:${module.color}">${esc(module.code)}</span>
          <span class="gal-grade">${esc(gradeLabel(work.grade))}</span>
        </div>
      </div>
    </article>`
  }

  // ── 详情页 ─────────────────────────────────────────────────
  function detailShell() {
    return `<div class="gal-container">
      <nav class="gal-crumbs" aria-label="面包屑">
        <a href="${hrefFor('gallery')}">${svgIcon('arrowLeft')}成果展厅</a>
        <span aria-hidden="true">/</span>
        <span aria-current="page">作品详情</span>
      </nav>
      <div id="gal-detail-slot">${detailSkeleton()}</div>
    </div>`
  }

  function detailSkeleton() {
    return `<div class="gal-hero gal-skel-hero"><span class="gal-skel-circle"></span><div class="gal-skel-lines"><span class="gal-skel-line w50"></span><span class="gal-skel-line w70 tall"></span><span class="gal-skel-line w40"></span></div></div>
    <div class="gal-detail-grid"><div class="gal-panel gal-main"><span class="gal-skel-line w30"></span><div class="gal-skel-block"></div><div class="gal-skel-block short"></div></div><div class="gal-panel gal-info"><span class="gal-skel-line w50"></span><span class="gal-skel-line"></span><span class="gal-skel-line"></span><span class="gal-skel-line"></span></div></div>`
  }

  function renderDetailSlot() {
    const slot = root && root.querySelector('#gal-detail-slot')
    if (!slot) return
    if (S.workLoading) {
      slot.innerHTML = detailSkeleton()
      return
    }
    if (!S.work) {
      const missing = S.workMissing
      slot.innerHTML = `<div class="gal-empty" role="status">
        <div class="gal-empty-icon">${svgIcon('image')}</div>
        <h1>${esc(missing ? '作品不存在或已被删除' : '作品加载失败')}</h1>
        <p>${esc(missing ? '它可能已被作者删除，或者链接不正确。' : S.workError || '网络开小差了，请稍后再试。')}</p>
        <div class="gal-empty-actions">
          <a class="gal-btn gal-primary" href="${hrefFor('gallery')}">返回成果展厅</a>
          ${missing ? '' : '<button type="button" class="gal-btn" data-act="retry-work">重新加载</button>'}
        </div>
      </div>`
      return
    }
    slot.innerHTML = detailHTML(S.work)
  }

  const infoRow = (k, v) => `<div class="gal-info-row"><dt>${k}</dt><dd>${v}</dd></div>`

  function detailHTML(work) {
    const meta = metaFor(work)
    const module = moduleOf(work.module)
    const imgs = imagesOf(work)
    return `<div class="gal-detail" style="${coverVars(work, meta)}">
    <header class="gal-hero">
      <div class="gal-hero-icon${imgs.length ? ' gal-hero-icon--photo' : ''}">${imgs.length ? `<img src="${esc(imgs[0])}" alt="">` : svgIcon(meta.icon)}</div>
      <div class="gal-hero-text">
        <div class="gal-hero-kicker">${esc(meta.kicker)} · ${esc(work.type || '学生创作')}</div>
        <h1>${esc(work.title)}</h1>
        <div class="gal-hero-meta">
          ${work.published === false ? '<span class="gal-draft-tag">草稿 · 仅自己可见</span><span class="gal-dot" aria-hidden="true"></span>' : ''}
          <span>${esc(work.author)}</span><span class="gal-dot" aria-hidden="true"></span>
          <span>${esc(dateText(work.createdAt))}</span><span class="gal-dot" aria-hidden="true"></span>
          <span>${esc(module.code)} ${esc(module.name)}</span><span class="gal-dot" aria-hidden="true"></span>
          <span>${esc(gradeLabel(work.grade))}</span>
          ${imgs.length ? `<span class="gal-dot" aria-hidden="true"></span><span>${imgs.length} 张${meta.key === 'book' ? '插画' : '图片'}</span>` : ''}
        </div>
      </div>
      <div class="gal-hero-actions">
        ${work.published === false ? '' : `<button type="button" class="gal-btn gal-like-big${work.liked ? ' is-on' : ''}" data-act="like" data-id="${esc(work.id)}" aria-pressed="${work.liked ? 'true' : 'false'}" aria-label="${work.liked ? '取消点赞' : '点赞'}《${esc(work.title)}》，当前 ${work.likes} 个赞">${svgIcon('heart')}<span data-like-count>${work.likes}</span></button>`}
        ${work.mine ? `<a class="gal-btn" href="#/me/works">${svgIcon('user')}管理作品</a>${work.published === false ? `<button type="button" class="gal-btn gal-primary" data-act="publish" data-id="${esc(work.id)}">${svgIcon('plus')}发布到展厅</button>` : `<button type="button" class="gal-btn" data-act="unpublish" data-id="${esc(work.id)}">${svgIcon('eyeOff')}撤下</button>`}` : ''}
      </div>
    </header>
    <div class="gal-detail-grid">
      <section class="gal-panel gal-main" aria-label="作品内容">${detailBody(work, meta)}</section>
      <aside class="gal-side">
        <div class="gal-panel gal-info">
          <h2>作品信息</h2>
          <dl>
            ${infoRow('作品类型', `<span class="gal-type-inline" style="--gal-tint:${meta.color}">${svgIcon(meta.icon)}${esc(work.type || '学生创作')}</span>`)}
            ${infoRow('所属模块', esc(`${module.code} ${module.name}`))}
            ${infoRow('适用学段', esc(gradeLabel(work.grade)))}
            ${infoRow('作者', esc(work.author))}
            ${infoRow('发布时间', esc(dateText(work.createdAt)))}
            ${imgs.length ? infoRow('插画', `${imgs.length} 张`) : ''}
            ${infoRow('点赞', `<span data-gal-info-likes>${work.likes}</span>`)}
          </dl>
        </div>
        <a class="gal-back-card" href="${hrefFor('gallery')}">${svgIcon('arrowLeft')}返回成果展厅</a>
      </aside>
    </div>
    </div>`
  }

  function imageStrip(work) {
    const imgs = imagesOf(work)
    if (!imgs.length) return ''
    return `<div class="gal-image-strip">${imgs
      .map((src, i) => `<img src="${esc(src)}" alt="作品图片 ${i + 1}" loading="lazy" decoding="async">`)
      .join('')}</div>`
  }

  function detailBody(work, meta) {
    const desc = String(work.desc || '').trim()
    switch (meta.key) {
      case 'book':
        return bookDetail(work)
      case 'prompt':
        return imageStrip(work) + promptDetail(desc)
      case 'observe':
        return imageStrip(work) + observeDetail(work, desc)
      case 'map':
        return imageStrip(work) + mapDetail(desc)
      case 'mr':
        return imageStrip(work) + mrDetail(desc)
      case 'invent':
        return imageStrip(work) + inventDetail(desc)
      case 'project':
        return imageStrip(work) + projectDetail(desc)
      case 'ethics':
        return imageStrip(work) + ethicsDetail(desc)
      default:
        return imageStrip(work) + proseDetail(desc)
    }
  }

  function emptyInline(msg) {
    return `<div class="gal-empty-inline">${svgIcon('image')}<span>${esc(msg)}</span></div>`
  }

  function bookDetail(work) {
    const desc = String(work.desc || '').trim()
    const imgs = imagesOf(work)
    const pages = parsePages(desc)
    if (!pages.length) {
      return `<div class="gal-sec-head"><h2>成书预览</h2></div>${emptyInline('这件作品还没有分页文字，暂时不能做成书预览。')}${desc ? `<div class="gal-prose">${paragraphs(desc)}</div>` : ''}`
    }
    const spreads = Math.ceil(pages.length / 2)
    S.spread = Math.max(0, Math.min(S.spread, spreads - 1))
    const dots = Array.from({ length: spreads }, (_, i) => `<span class="gal-dot-ind${i === S.spread ? ' is-on' : ''}" aria-hidden="true"></span>`).join('')
    return `<div class="gal-sec-head"><h2>成书预览</h2><span class="gal-sec-note">共 ${pages.length} 页${imgs.length ? ` · ${imgs.length} 张插画` : ''} · 双页阅读</span></div>
      <div class="gal-reader" id="gal-reader">
        <div class="gal-spread" data-gal-spread>${spreadFaces(pages, S.spread, imgs)}</div>
        <div class="gal-reader-bar">
          <button type="button" class="gal-nav-btn" data-act="spread-prev" aria-label="上一页">${svgIcon('chevronLeft')}</button>
          <span class="gal-range" data-gal-range>${rangeText(pages.length, S.spread)}</span>
          <button type="button" class="gal-nav-btn" data-act="spread-next" aria-label="下一页">${svgIcon('chevronRight')}</button>
        </div>
        <div class="gal-dots" data-gal-dots>${dots}</div>
      </div>
      <div class="gal-fulltext"><h3>全书文字</h3>${pages.map((p) => `<p><b>第 ${p.n} 页</b>${esc(p.text)}</p>`).join('')}</div>`
  }

  function spreadFaces(pages, spread, images) {
    const start = spread * 2
    const faces = [pages[start], pages[start + 1]]
    return faces
      .map((p, i) => {
        if (!p) return i === 0 ? '' : blankFace()
        // 插画按页序与文字对齐（parsePages 的 idx 是原页序号）：
        // 有图就展示真图，没图才退回装饰性场景图标，绝不用图标假装插画。
        const img = images && images[p.idx]
        const visual = img
          ? `<span class="gal-face-media"><img src="${esc(img)}" alt="第 ${p.n} 页插画" loading="lazy" decoding="async"></span>`
          : `<span class="gal-face-art" aria-hidden="true">${svgIcon(sceneIcon(p.text))}</span>`
        return `<article class="gal-face${img ? ' gal-face--illustrated' : ''}">${visual}<span class="gal-face-no">第 ${p.n} 页</span><p>${esc(p.text)}</p></article>`
      })
      .join('')
  }

  const blankFace = () => '<div class="gal-face gal-face--blank"><span>封底</span></div>'

  function rangeText(total, spread) {
    const start = spread * 2 + 1
    const end = Math.min(total, start + 1)
    return `第 ${start}${end > start ? '–' + end : ''} 页 / 共 ${total} 页`
  }

  function updateReader() {
    const work = S.work
    if (!work || !root) return
    const pages = parsePages(work.desc)
    if (!pages.length) return
    const spreads = Math.ceil(pages.length / 2)
    S.spread = Math.max(0, Math.min(S.spread, spreads - 1))
    const spreadEl = root.querySelector('[data-gal-spread]')
    if (spreadEl) spreadEl.innerHTML = spreadFaces(pages, S.spread, imagesOf(work))
    const range = root.querySelector('[data-gal-range]')
    if (range) range.textContent = rangeText(pages.length, S.spread)
    root.querySelectorAll('[data-gal-dots] .gal-dot-ind').forEach((d, i) => d.classList.toggle('is-on', i === S.spread))
    const prev = root.querySelector('[data-act="spread-prev"]')
    if (prev) prev.disabled = S.spread <= 0
    const next = root.querySelector('[data-act="spread-next"]')
    if (next) next.disabled = S.spread >= spreads - 1
  }

  function promptDetail(desc) {
    if (!desc) return emptyInline('作者还没有填写提示词。')
    return `<div class="gal-sec-head"><h2>提示词全文</h2><button type="button" class="gal-btn gal-btn-sm" data-act="copy-prompt">${svgIcon('copy')}复制提示词</button></div>
      <div class="gal-prompt-sheet"><span class="gal-bigquote" aria-hidden="true">“</span><p>${esc(desc)}</p></div>
      <div class="gal-tips"><b>提示词小贴士</b><span>写清主体、动作、场景和风格，AI 更容易画出想要的效果。</span></div>`
  }

  function observeDetail(work, desc) {
    const zones = parseZones(desc)
    const devices = zones.flatMap((z) => z.items)
    if (!devices.length) {
      return `<div class="gal-sec-head"><h2>观察清单</h2></div>${desc ? `<div class="gal-prose">${paragraphs(desc)}</div>` : emptyInline('作者还没有填写观察记录。')}`
    }
    const counts = parseCounts(work.title)
    const target = counts.target
    const pct = target ? Math.min(100, Math.round((Math.min(devices.length, target) / target) * 100)) : null
    const stats = [
      { v: `${devices.length} 件`, l: '发现设备' },
      ...(counts.found != null && target != null ? [{ v: `${counts.found} / ${target}`, l: '任务进度' }] : []),
      ...(counts.score != null ? [{ v: `${counts.score} 分`, l: '训练得分' }] : []),
    ]
    return `<div class="gal-sec-head"><h2>观察清单</h2><span class="gal-sec-note">共 ${devices.length} 件 AI 设备</span></div>
      <div class="gal-stats">${stats.map((s) => `<div class="gal-stat"><b>${esc(s.v)}</b><span>${esc(s.l)}</span></div>`).join('')}</div>
      ${pct != null ? `<div class="gal-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="任务完成进度"><i style="width:${pct}%"></i></div>` : ''}
      <div class="gal-zones">${zones
        .map(
          (z) =>
            `<div class="gal-zone"><h3>${svgIcon('radar')}<span>${esc(z.title)}</span></h3><div class="gal-device-list">${z.items
              .map((d) => `<span class="gal-device-item">${svgIcon(deviceIcon(d))}<span>${esc(d)}</span></span>`)
              .join('')}</div></div>`,
        )
        .join('')}</div>
      <div class="gal-raw"><h3>原始记录</h3><p>${esc(desc)}</p></div>`
  }

  function mapDetail(desc) {
    const zones = parseZones(desc)
    const items = zones.flatMap((z) => z.items)
    if (!items.length) return emptyInline('作者还没有填写发现内容。')
    const pins = items.slice(0, 8)
    const pos = MAP_POS.slice(0, pins.length)
    const points = pos.map((p) => `${p[0]},${p[1]}`).join(' ')
    const namedZones = zones.filter((z) => !z.implicit)
    return `<div class="gal-sec-head"><h2>发现地图</h2><span class="gal-sec-note">${items.length} 处 AI 发现</span></div>
      ${namedZones.length ? `<div class="gal-chip-row">${namedZones.map((z) => `<span class="gal-chip">${esc(z.title)}</span>`).join('')}</div>` : ''}
      <div class="gal-map-board">
        <svg class="gal-map-path" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2.5 2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        ${pins
          .map(
            (t, i) =>
              `<span class="gal-map-pin" style="left:${pos[i][0]}%;top:${pos[i][1]}%"><b>${i + 1}</b><span>${esc(truncate(t, 10))}</span></span>`,
          )
          .join('')}
      </div>
      <div class="gal-sec-head gal-sec-sub"><h2>发现清单</h2></div>
      <ol class="gal-number-list">${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <div class="gal-raw"><h3>记录原文</h3><p>${esc(desc)}</p></div>`
  }

  function mrDetail(desc) {
    const zones = parseZones(desc)
    const items = zones.flatMap((z) => z.items)
    if (!items.length) return emptyInline('作者还没有填写空间方案。')
    const labels = (zones.some((z) => !z.implicit) ? zones.map((z) => z.title) : items).slice(0, 4)
    return `<div class="gal-sec-head"><h2>空间方案</h2><span class="gal-sec-note">示意图，非真实 3D 场景</span></div>
      <div class="gal-plan">
        <span class="gal-plan-floor" aria-hidden="true"></span>
        ${labels.map((t, i) => `<span class="gal-plan-zone" style="left:${ROOM_POS[i][0]}%;top:${ROOM_POS[i][1]}%">${esc(truncate(t, 8))}</span>`).join('')}
      </div>
      <div class="gal-sec-head gal-sec-sub"><h2>方案要点</h2></div>
      <ul class="gal-bullets">${items.slice(0, 10).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      <div class="gal-raw"><h3>方案原文</h3><p>${esc(desc)}</p></div>`
  }

  function inventDetail(desc) {
    if (!desc) return emptyInline('作者还没有填写创作说明。')
    const points = splitSentences(desc)
    return `<div class="gal-feature">
      <div class="gal-feature-visual" aria-hidden="true"><span class="gal-bulb gal-bulb-lg"><span class="gal-bulb-gear">${svgIcon('gear')}</span>${svgIcon('bulb')}<i class="gal-spark s1"></i><i class="gal-spark s2"></i></span></div>
      <div><div class="gal-sec-head"><h2>创作说明</h2></div><ul class="gal-bullets">${points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
    </div>`
  }

  function projectDetail(desc) {
    if (!desc) return emptyInline('作者还没有填写项目说明。')
    const steps = splitSentences(desc)
    return `<div class="gal-feature">
      <div class="gal-feature-visual gal-feature-visual--rocket" aria-hidden="true"><span class="gal-rocket gal-rocket-lg">${svgIcon('rocket')}<span class="gal-orbit"></span><i class="gal-spark s1"></i><i class="gal-spark s2"></i></span></div>
      <div><div class="gal-sec-head"><h2>项目路径</h2></div><ol class="gal-timeline">${steps.map((s, i) => `<li><b>步骤 ${i + 1}</b><p>${esc(s)}</p></li>`).join('')}</ol></div>
    </div>`
  }

  function ethicsDetail(desc) {
    if (!desc) return emptyInline('作者还没有填写伦理守则。')
    const rules = splitSentences(desc)
    return `<div class="gal-sec-head"><h2>AI 使用守则</h2><span class="gal-sec-note">共 ${rules.length} 条</span></div>
      <div class="gal-rules-list">${rules
        .map(
          (r, i) =>
            `<div class="gal-rule"><b>${i + 1}</b><p>${esc(r)}</p><span class="gal-rule-check" aria-hidden="true">${svgIcon('check')}</span></div>`,
        )
        .join('')}</div>`
  }

  function proseDetail(desc) {
    if (!desc) return emptyInline('作者还没有填写作品说明。')
    return `<div class="gal-sec-head"><h2>作品说明</h2></div><div class="gal-prose">${paragraphs(desc)}</div>`
  }

  // ── 数据加载 ───────────────────────────────────────────────
  async function loadWorks(reset) {
    const seq = ++S.reqSeq
    if (reset) {
      S.loading = true
      S.loaded = false
      S.error = ''
      S.works = []
      S.total = 0
      S.page = 0
      S.hasMore = false
      const grid = root && root.querySelector('#gal-grid')
      if (grid) {
        grid.setAttribute('aria-busy', 'true')
        grid.innerHTML = skeletonCards(6)
      }
      renderMore()
      updateCount()
    } else {
      if (S.loading) return
      S.loading = true
      renderMore()
    }
    try {
      const params = new URLSearchParams({ page: String(S.page + 1), pageSize: String(PAGE_SIZE) })
      if (S.filter !== 'all') params.set('module', S.filter)
      const data = await api('/api/works?' + params.toString())
      if (seq !== S.reqSeq) return
      S.works = reset ? data.works : S.works.concat(data.works)
      S.total = Number(data.total) || 0
      S.page = Number(data.page) || 1
      S.hasMore = !!data.hasMore
      S.loaded = true
    } catch (err) {
      if (seq !== S.reqSeq) return
      S.error = err.message || '作品加载失败'
      S.loaded = true
    } finally {
      if (seq === S.reqSeq) {
        S.loading = false
        renderGrid()
        updateCount()
        renderMore()
      }
    }
  }

  async function loadWork() {
    const seq = ++S.reqSeq
    S.workLoading = true
    S.work = null
    S.workError = ''
    S.workMissing = false
    S.spread = 0
    renderDetailSlot()
    if (!S.workId) {
      S.workLoading = false
      S.workError = '作品不存在或已被删除'
      S.workMissing = true
      renderDetailSlot()
      return
    }
    try {
      const data = await api('/api/works/' + encodeURIComponent(S.workId))
      if (seq !== S.reqSeq) return
      S.work = data.work
    } catch (err) {
      if (seq !== S.reqSeq) return
      S.workError = err.message || '作品加载失败'
      S.workMissing = err.status === 404
    } finally {
      if (seq === S.reqSeq) {
        S.workLoading = false
        renderDetailSlot()
        if (S.work) {
          updateReader()
          document.title = '作品详情 · 成果展厅'
        }
      }
    }
  }

  function findWork(id) {
    if (S.work && S.work.id === id) return S.work
    return S.works.find((w) => w.id === id)
  }

  // ── 点赞 ───────────────────────────────────────────────────
  function setLikeBusy(id, busy) {
    if (!root) return
    root.querySelectorAll('[data-act="like"]').forEach((btn) => {
      if (btn.dataset.id !== id) return
      btn.setAttribute('aria-busy', busy ? 'true' : 'false')
      btn.classList.toggle('is-busy', busy)
    })
  }

  function updateLikeUI(id) {
    if (!root) return
    const work = findWork(id)
    if (!work) return
    root.querySelectorAll('[data-act="like"]').forEach((btn) => {
      if (btn.dataset.id !== id) return
      btn.classList.toggle('is-on', !!work.liked)
      btn.setAttribute('aria-pressed', work.liked ? 'true' : 'false')
      btn.setAttribute(
        'aria-label',
        `${work.liked ? '取消点赞' : '点赞'}《${work.title}》，当前 ${work.likes} 个赞`,
      )
      const count = btn.querySelector('[data-like-count]')
      if (count) count.textContent = String(work.likes)
    })
    const info = root.querySelector('[data-gal-info-likes]')
    if (info) info.textContent = String(work.likes)
  }

  async function toggleLike(id) {
    const key = 'like:' + id
    if (S.busy.has(key)) return
    const me = await ensureMeLoaded()
    if (!me) {
      toast('登录后才能点赞', 'warn')
      return
    }
    const work = findWork(id)
    if (!work) return
    S.busy.add(key)
    setLikeBusy(id, true)
    try {
      const res = work.liked
        ? await api(`/api/works/${encodeURIComponent(id)}/like`, { method: 'DELETE' })
        : await api(`/api/works/${encodeURIComponent(id)}/like`, { method: 'POST' })
      work.liked = !!res.liked
      work.likes = Number(res.likes) || 0
      updateLikeUI(id)
    } catch (err) {
      toast(err.message || '操作失败，请稍后再试', 'error')
    } finally {
      S.busy.delete(key)
      setLikeBusy(id, false)
    }
  }

  // ── 发布草稿（从我的作品详情进入时用）─────────────────────
  async function publishWork(id) {
    try {
      await api('/api/works/' + encodeURIComponent(id) + '/publish', { method: 'POST' })
      toast('已发布到展厅')
      if (S.mode === 'detail') await loadWork()
    } catch (err) {
      toast(err.message || '发布失败，请稍后再试', 'error')
    }
  }

  // ── 撤下 ───────────────────────────────────────────────────
  // 展厅只负责「展示」：删除和重新发布都在「我的作品」里做。
  // 这里保留撤下，是因为学生站在展厅看到自己的作品时，最自然的操作是收回来。
  function askUnpublish(id) {
    const work = findWork(id) || (S.work && S.work.id === id ? S.work : null)
    if (!work) return
    if (!work.mine) {
      toast('只能撤下自己的作品', 'warn')
      return
    }
    openConfirm({
      title: '从展厅撤下这件作品？',
      message: `《${work.title}》会从展厅隐藏，作品本身和收到的赞都保留，之后可以在「我的作品」里重新发布。`,
      confirmText: '撤下',
      onConfirm: async () => {
        await api('/api/works/' + encodeURIComponent(id) + '/publish', { method: 'DELETE' })
        toast('已从展厅撤下')
        if (S.mode === 'detail' && S.work && S.work.id === id) {
          ctx.router.push({ name: 'gallery' })
        } else {
          S.works = S.works.filter((w) => w.id !== id)
          S.total = Math.max(0, S.total - 1)
          updateCount()
          renderGrid()
        }
      },
    })
  }

  // ── 发布我的作品 ───────────────────────────────────────────
  // 展厅不再直接创建作品。「创作 → 保存到个人作品 → 挑选发布」这条路径
  // 让每件作品只有一个可管理的位置，也避免展厅里冒出一堆无来源的条目。
  async function askPublishFromMine() {
    const me = await ensureMeLoaded()
    if (!me) {
      toast('登录后才能发布作品', 'warn')
      return
    }
    openPublishPicker()
  }

  function pickerRow(work) {
    const meta = metaFor(work)
    const imgs = imagesOf(work)
    const cover = imgs.length
      ? `<span class="gal-pick-cover"><img src="${esc(imgs[0])}" alt="" loading="lazy" decoding="async"></span>`
      : `<span class="gal-pick-cover gal-pick-cover--icon" style="--gal-tint:${meta.color}">${svgIcon(meta.icon)}</span>`
    return `<label class="gal-pick">
      <input type="checkbox" data-gal-pick value="${esc(work.id)}">
      ${cover}
      <span class="gal-pick-main">
        <span class="gal-pick-title">${esc(work.title)}</span>
        <span class="gal-pick-meta">${esc(work.type || '学生创作')} · ${esc(dateText(work.createdAt))}</span>
      </span>
      <span class="gal-pick-tick" aria-hidden="true">${svgIcon('check')}</span>
    </label>`
  }

  function openPublishPicker() {
    let drafts = []
    let hasMore = false
    let loading = false
    createModal({
      title: '发布我的作品',
      subtitle: '从「我的作品」里挑几份上墙。已发布的作品不在这个列表里。',
      body: `<div class="gal-picker" data-gal-picker>
        <div class="gal-picker-head" data-gal-picker-head hidden>
          <label class="gal-pick-all"><input type="checkbox" data-gal-pick-all>全选</label>
          <span class="gal-pick-count" data-gal-pick-count>已选 0 份</span>
        </div>
        <div class="gal-picker-list" data-gal-pick-list aria-busy="true"><div class="gal-pick-loading">正在读取我的作品…</div></div>
        <div class="gal-form-error" data-gal-pick-error role="alert"></div>
      </div>`,
      footer:
        '<a class="gal-btn" href="#/me/works">管理我的作品</a><button type="button" class="gal-btn" data-modal-cancel>取消</button><button type="button" class="gal-btn gal-primary" data-gal-publish disabled>发布所选</button>',
      onMount(el) {
        const head = el.querySelector('[data-gal-picker-head]')
        const list = el.querySelector('[data-gal-pick-list]')
        const all = el.querySelector('[data-gal-pick-all]')
        const countEl = el.querySelector('[data-gal-pick-count]')
        const publishBtn = el.querySelector('[data-gal-publish]')
        const errEl = el.querySelector('[data-gal-pick-error]')
        const selected = new Set()

        function sync() {
          const total = drafts.length
          const n = selected.size
          countEl.textContent = `已选 ${n} 份`
          all.checked = total > 0 && n === total
          all.indeterminate = n > 0 && n < total
          publishBtn.disabled = n === 0
          publishBtn.textContent = n ? `发布所选（${n}）` : '发布所选'
        }

        function showError(msg) {
          errEl.textContent = msg
          errEl.classList.add('show')
        }

        function renderList() {
          head.hidden = drafts.length === 0
          list.innerHTML = drafts.length
            ? drafts.map(pickerRow).join('') +
              (hasMore
                ? '<p class="gal-picker-hint">只显示最近 60 份未发布作品，<a href="#/me/works">去我的作品看全部</a>。</p>'
                : '')
            : `<div class="gal-picker-empty">
                <span class="gal-picker-empty-icon">${svgIcon('image')}</span>
                <p>没有待发布的个人作品</p>
                <p class="gal-picker-hint">先去互动训练里完成一份，保存后会出现在 <a href="#/me/works">我的作品</a>。</p>
              </div>`
          sync()
        }

        async function load() {
          if (loading) return
          loading = true
          errEl.classList.remove('show')
          list.setAttribute('aria-busy', 'true')
          list.innerHTML = '<div class="gal-pick-loading">正在读取我的作品…</div>'
          try {
            const res = await api('/api/works/mine?status=draft&page=1&pageSize=60')
            drafts = (res.works || []).filter((w) => !w.hidden)
            hasMore = !!res.hasMore
            renderList()
          } catch (err) {
            const msg =
              err && err.status === 401
                ? '登录已失效，请重新登录后再试'
                : err.message || '读取我的作品失败'
            list.innerHTML = `<div class="gal-picker-empty">
              <span class="gal-picker-empty-icon">${svgIcon('alert')}</span>
              <p>${esc(msg)}</p>
              <button type="button" class="gal-btn" data-gal-pick-retry>重新加载</button>
            </div>`
          } finally {
            loading = false
            list.setAttribute('aria-busy', 'false')
          }
        }

        list.addEventListener('change', (e) => {
          const input = e.target
          if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return
          if (input.hasAttribute('data-gal-pick-all')) {
            selected.clear()
            if (input.checked) drafts.forEach((w) => selected.add(w.id))
            list.querySelectorAll('input[data-gal-pick]').forEach((box) => {
              box.checked = input.checked
            })
          } else if (input.hasAttribute('data-gal-pick')) {
            if (input.checked) selected.add(input.value)
            else selected.delete(input.value)
          }
          sync()
        })

        list.addEventListener('click', (e) => {
          const target = e.target instanceof Element ? e.target : null
          if (target && target.closest('[data-gal-pick-retry]')) load()
        })

        publishBtn.addEventListener('click', async () => {
          if (publishBtn.disabled || !selected.size) return
          const ids = Array.from(selected)
          publishBtn.disabled = true
          publishBtn.textContent = '发布中…'
          errEl.classList.remove('show')
          const succeeded = new Set()
          let firstErr = ''
          for (const id of ids) {
            try {
              await api('/api/works/' + encodeURIComponent(id) + '/publish', { method: 'POST' })
              succeeded.add(id)
            } catch (err) {
              if (!firstErr) firstErr = err.message || '发布失败'
            }
          }
          if (succeeded.size) {
            // 新作品不一定落在当前筛选的模块里，发布后统一回到「全部」，
            // 让学生立刻看到自己刚上墙的作品。
            S.filter = 'all'
            const select = root && root.querySelector('#gal-filter')
            if (select) select.value = 'all'
            toast(
              succeeded.size === ids.length
                ? `已发布 ${succeeded.size} 份作品`
                : `已发布 ${succeeded.size} 份，${ids.length - succeeded.size} 份失败`,
            )
            await loadWorks(true)
          }
          if (succeeded.size === ids.length) {
            closeModal()
            return
          }
          drafts = drafts.filter((w) => !succeeded.has(w.id))
          selected.clear()
          renderList()
          showError(`${ids.length - succeeded.size} 份没能发布：${firstErr}`)
        })

        load()
      },
    })
  }

  // ── 弹层 / 提示 ────────────────────────────────────────────
  function openConfirm({ title, message, confirmText = '确定', danger = false, onConfirm }) {
    return createModal({
      title,
      body: `<p class="gal-confirm-text">${esc(message)}</p>`,
      footer: `<button type="button" class="gal-btn" data-modal-cancel data-autofocus>取消</button><button type="button" class="gal-btn ${danger ? 'gal-danger' : 'gal-primary'}" data-modal-ok>${esc(confirmText)}</button>`,
      onMount(modal) {
        const ok = modal.querySelector('[data-modal-ok]')
        ok.addEventListener('click', async () => {
          if (ok.disabled) return
          ok.disabled = true
          const old = ok.textContent
          ok.textContent = '处理中…'
          try {
            await onConfirm()
            closeModal()
          } catch (err) {
            ok.disabled = false
            ok.textContent = old
            toast(err.message || '操作失败，请稍后再试', 'error')
          }
        })
      },
    })
  }

  function trapTab(e) {
    if (!modalEl) return
    const items = Array.from(
      modalEl.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      ),
    ).filter((el) => el.offsetParent !== null)
    if (!items.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function createModal({ title, subtitle, body, footer, onMount }) {
    closeModal(false)
    modalReturnFocus = document.activeElement
    const backdrop = document.createElement('div')
    backdrop.className = 'gal-modal-backdrop'
    backdrop.innerHTML = `<div class="gal-modal" role="dialog" aria-modal="true" aria-labelledby="gal-modal-title">
      <div class="gal-modal-head">
        <div><h2 id="gal-modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button type="button" class="gal-icon-btn" data-modal-close aria-label="关闭">${svgIcon('close')}</button>
      </div>
      ${body || ''}
      ${footer ? `<div class="gal-modal-foot">${footer}</div>` : ''}
    </div>`
    document.body.appendChild(backdrop)
    modalEl = backdrop
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) closeModal()
    })
    backdrop.addEventListener('click', (e) => {
      const t = e.target instanceof Element ? e.target : null
      if (t && t.closest('[data-modal-close], [data-modal-cancel]')) closeModal()
    })
    modalKeyHandler = (e) => {
      if (!modalEl) return
      if (e.key === 'Escape') {
        e.preventDefault()
        closeModal()
        return
      }
      if (e.key === 'Tab') trapTab(e)
    }
    document.addEventListener('keydown', modalKeyHandler, true)
    try {
      onMount && onMount(backdrop)
    } catch (err) {
      console.warn('[gallery-studio] 弹层初始化失败', err)
    }
    const focusable =
      backdrop.querySelector('[data-autofocus]') ||
      backdrop.querySelector('button, input, select, textarea, a[href]')
    if (focusable) focusable.focus()
    return backdrop
  }

  function closeModal(restoreFocus = true) {
    if (!modalEl) return
    document.removeEventListener('keydown', modalKeyHandler, true)
    modalKeyHandler = null
    const el = modalEl
    modalEl = null
    el.remove()
    if (restoreFocus && modalReturnFocus && document.contains(modalReturnFocus)) {
      try {
        modalReturnFocus.focus({ preventScroll: true })
      } catch {
        /* 元素可能已随重渲染消失 */
      }
    }
    modalReturnFocus = null
  }

  function toast(msg, kind = 'info') {
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.className = 'gal-toast'
      document.body.appendChild(toastEl)
    }
    toastEl.textContent = msg
    toastEl.classList.remove('show', 'warn', 'error')
    if (kind === 'warn') toastEl.classList.add('warn')
    if (kind === 'error') toastEl.classList.add('error')
    toastEl.setAttribute('role', kind === 'error' ? 'alert' : 'status')
    toastEl.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite')
    void toastEl.offsetWidth
    toastEl.classList.add('show')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      if (toastEl) toastEl.classList.remove('show')
    }, 2600)
  }

  function hideToast() {
    clearTimeout(toastTimer)
    if (toastEl) toastEl.classList.remove('show')
  }

  async function copyText(text) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast('提示词已复制')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        toast('提示词已复制')
      } catch {
        toast('复制失败，请手动选择文本', 'warn')
      } finally {
        ta.remove()
      }
    }
  }

  // ── 事件 ───────────────────────────────────────────────────
  function onClick(e) {
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    const btn = target.closest('[data-act]')
    if (!btn || !root || !root.contains(btn)) return
    const act = btn.getAttribute('data-act')
    const id = btn.getAttribute('data-id') || ''
    switch (act) {
      case 'publish-mine':
        e.preventDefault()
        askPublishFromMine()
        break
      case 'like':
        e.preventDefault()
        toggleLike(id)
        break
      case 'unpublish':
        e.preventDefault()
        askUnpublish(id)
        break
      case 'publish':
        e.preventDefault()
        publishWork(id)
        break
      case 'more':
        e.preventDefault()
        loadWorks(false)
        break
      case 'retry-list':
        e.preventDefault()
        loadWorks(true)
        break
      case 'retry-work':
        e.preventDefault()
        loadWork()
        break
      case 'spread-prev':
        e.preventDefault()
        if (S.spread > 0) {
          S.spread--
          updateReader()
        }
        break
      case 'spread-next':
        e.preventDefault()
        S.spread++
        updateReader()
        break
      case 'copy-prompt':
        e.preventDefault()
        copyText(S.work ? S.work.desc : '')
        break
      default:
        break
    }
  }

  function onChange(e) {
    const target = e.target
    if (target && target.id === 'gal-filter') {
      S.filter = target.value
      loadWorks(true)
    }
  }

  // ── 挂载 / 卸载 ────────────────────────────────────────────
  let styleEl = null
  function ensureStyle() {
    if (styleEl && document.head.contains(styleEl)) return
    styleEl = document.getElementById('gal-studio-style')
    if (styleEl) return
    styleEl = document.createElement('style')
    styleEl.id = 'gal-studio-style'
    styleEl.textContent = CSS_TEXT
    document.head.appendChild(styleEl)
  }

  function mountPage(vm, mode) {
    ensureStyle()
    const host = (vm.$el && vm.$el.parentNode) || document.querySelector('main') || document.body
    root = document.createElement('div')
    root.className = 'gal-page'
    root.setAttribute('data-gal-root', '')
    if (vm.$el && vm.$el.parentNode === host) host.insertBefore(root, vm.$el)
    else host.appendChild(root)
    root.addEventListener('click', onClick)
    root.addEventListener('change', onChange)
    const route = ctx.router ? ctx.router.currentRoute.value : null
    const id = mode === 'detail' ? String((route && route.params && route.params.id) || '') : ''
    resetState(mode, id)
    root.innerHTML = mode === 'detail' ? detailShell() : listShell()
    window.scrollTo(0, 0)
    ensureMeLoaded()
    if (mode === 'detail') loadWork()
    else {
      document.title = '成果展厅'
      loadWorks(true)
    }
  }

  function unmountPage() {
    S.reqSeq++
    closeModal(false)
    hideToast()
    if (root) {
      root.remove()
      root = null
    }
  }

  const ListComponent = {
    name: 'GalleryStudioList',
    mounted() {
      mountPage(this, 'list')
    },
    beforeUnmount() {
      unmountPage()
    },
    render() {
      return null
    },
  }

  const DetailComponent = {
    name: 'GalleryStudioDetail',
    mounted() {
      mountPage(this, 'detail')
    },
    watch: {
      '$route.params.id'() {
        if (this.$route.name !== 'gallery-work' || !root) return
        unmountPage()
        mountPage(this, 'detail')
      },
    },
    beforeUnmount() {
      unmountPage()
    },
    render() {
      return null
    },
  }

  // ── 启动：替换 /gallery 路由，新增 /gallery/:id ────────────
  function waitFor(fn, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const started = Date.now()
      const tick = () => {
        let value = null
        try {
          value = fn()
        } catch {
          value = null
        }
        if (value) return resolve(value)
        if (Date.now() - started > timeoutMs) return resolve(null)
        setTimeout(tick, 100)
      }
      tick()
    })
  }

  async function boot() {
    const app = await waitFor(() => {
      const el = document.querySelector('#app')
      return el && el.__vue_app__
    })
    if (!app) return
    const router = app.config.globalProperties.$router
    if (!router || typeof router.addRoute !== 'function') return
    ctx.router = router

    // 同名 addRoute 会先移除旧记录；显式 remove 一次让意图更清楚。
    if (router.hasRoute('gallery')) router.removeRoute('gallery')
    if (router.hasRoute('gallery-work')) router.removeRoute('gallery-work')
    router.addRoute({
      path: '/gallery',
      name: 'gallery',
      component: ListComponent,
      meta: { title: '成果展厅' },
    })
    router.addRoute({
      path: '/gallery/:id',
      name: 'gallery-work',
      component: DetailComponent,
      meta: { title: '作品详情 · 成果展厅' },
    })

    try {
      await router.isReady()
    } catch {
      /* isReady 只在启动错误时 reject */
    }

    // 以地址栏 hash 为准，而不是 currentRoute：首屏直接打开 /gallery/:id 时，
    // 初始导航发生在详情路由注册之前，根本没有匹配上（currentRoute 可能还停在起点）。
    // 只有 /gallery 的旧路由能匹配，所以 early return 会把详情深链接留成空白页。
    const raw = window.location.hash.replace(/^#/, '')
    const qAt = raw.indexOf('?')
    const rawPath = qAt >= 0 ? raw.slice(0, qAt) : raw
    const rawQuery = qAt >= 0 ? raw.slice(qAt + 1) : ''
    if (!(rawPath === '/gallery' || rawPath.startsWith('/gallery/'))) return
    const query = Object.fromEntries(new URLSearchParams(rawQuery))
    const cur = router.currentRoute.value
    const ours = cur.matched.some(
      (r) => r.components && (r.components.default === ListComponent || r.components.default === DetailComponent),
    )
    // force 让同一路径重新匹配一次，而不是被 isSameRouteLocation 短路。
    if (!ours || cur.path !== rawPath) {
      try {
        await router.replace({ path: rawPath, query, force: true })
      } catch {
        /* 守卫重定向属于正常结果 */
      }
    }
  }

  boot().catch((err) => {
    console.warn('[gallery-studio] 启动失败，继续使用原页面', err)
  })

  // ── 样式 ───────────────────────────────────────────────────
  const CSS_TEXT = `
.gal-page,.gal-modal-backdrop,.gal-toast{
  --gal-accent:var(--aiq-accent,#3559f6);
  --gal-border:var(--aiq-border,#e4e8f2);
  --gal-card:var(--aiq-panel-solid,#fff);
  --gal-soft:var(--aiq-bg-soft,#f2f5fc);
  --gal-text:var(--aiq-text,#1f2937);
  --gal-soft-text:var(--aiq-text-soft,#475569);
  --gal-mute:var(--aiq-text-mute,#64748b);
}
.gal-page{color:var(--gal-text);padding-bottom:64px}
.gal-container{width:min(1400px,calc(100% - 48px));margin:0 auto;padding:40px 0 24px}
.gal-head{margin-bottom:0}
.gal-tag{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;background:rgba(53,89,246,.1);color:var(--gal-accent);margin-bottom:12px}
.gal-tag .gal-i{font-size:13px}
.gal-title{font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-.01em;margin:0}
.gal-grad{background:linear-gradient(100deg,#4f7cff,#a855f7 45%,#14b8a6);-webkit-background-clip:text;background-clip:text;color:transparent}
.gal-sub{margin-top:10px;max-width:48rem;font-size:14px;line-height:1.7;color:var(--gal-soft-text)}
.gal-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.gal-i{width:1em;height:1em;display:inline-block;vertical-align:-.14em;flex:none}

/* 工具栏 */
.gal-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:24px 0 20px}
.gal-actions{display:flex;align-items:center;gap:10px;margin-left:auto}
.gal-select{appearance:none;-webkit-appearance:none;height:38px;min-width:170px;padding:0 34px 0 12px;border-radius:12px;border:1px solid var(--gal-border);background-color:var(--gal-card);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;color:var(--gal-text);font-size:13px;font-family:inherit;cursor:pointer}
.gal-count{font-size:12.5px;color:var(--gal-mute)}
.gal-count b{color:var(--gal-text);font-weight:700}
.gal-upload{margin-left:auto}
.gal-page button,.gal-modal-backdrop button{font-family:inherit}
.gal-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:38px;padding:0 16px;border-radius:999px;border:1px solid var(--gal-border);background:var(--gal-card);color:var(--gal-text);font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:border-color .2s ease,color .2s ease,background .2s ease,box-shadow .2s ease}
.gal-btn:hover{border-color:var(--gal-accent);color:var(--gal-accent)}
.gal-btn:disabled{opacity:.5;cursor:default}
.gal-btn.gal-primary{border:0;background:linear-gradient(120deg,#4f7cff,#7c4dff);color:#fff;box-shadow:0 10px 24px -14px rgba(79,124,255,.75)}
.gal-btn.gal-primary:hover{color:#fff;box-shadow:0 14px 28px -14px rgba(79,124,255,.85)}
.gal-btn.gal-danger{border:0;background:#dc2626;color:#fff}
.gal-btn.gal-danger:hover{color:#fff;background:#b91c1c}
.gal-btn.gal-danger-ghost{color:#dc2626;border-color:rgba(220,38,38,.32)}
.gal-btn.gal-danger-ghost:hover{color:#b91c1c;border-color:rgba(185,28,28,.6)}
.gal-btn.gal-btn-sm{min-height:34px;padding:0 12px;font-size:12px;margin-left:auto}
.gal-icon-btn{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;border:1px solid var(--gal-border);background:var(--gal-card);color:var(--gal-mute);cursor:pointer;transition:border-color .2s ease,color .2s ease}
.gal-icon-btn:hover{border-color:var(--gal-accent);color:var(--gal-accent)}

/* 网格与卡片 */
.gal-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
@media(min-width:640px){.gal-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(min-width:1024px){.gal-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
.gal-card{position:relative;display:flex;flex-direction:column;overflow:hidden;border-radius:20px;background:var(--gal-card);border:1px solid var(--gal-border);transition:transform .28s cubic-bezier(.22,.9,.28,1),box-shadow .28s ease,border-color .28s ease}
.gal-card:hover{transform:translateY(-4px);box-shadow:0 18px 40px -22px rgba(31,45,90,.5);border-color:rgba(53,89,246,.35)}
.gal-hit{position:absolute;inset:0;z-index:1;border-radius:20px;cursor:pointer}
.gal-hit:focus-visible{outline:2px solid var(--gal-accent);outline-offset:-3px}
.gal-cover{position:relative;height:150px;overflow:hidden;background:
  radial-gradient(120% 120% at 100% 0%,var(--gal-hue-a),transparent 58%),
  radial-gradient(120% 140% at 0% 100%,var(--gal-tint-a),transparent 62%),
  var(--gal-soft)}
.gal-cover-glow{position:absolute;inset:auto -20% -70% 20%;height:140%;background:radial-gradient(ellipse at center,var(--gal-hue-a),transparent 66%);pointer-events:none}
.gal-cover-art{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:22px 16px 14px;pointer-events:none}
.gal-cover--photo{background:var(--gal-soft)}
.gal-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transform:scale(1.01);transition:transform .5s cubic-bezier(.22,.9,.28,1)}
.gal-card:hover .gal-cover-img{transform:scale(1.05)}
.gal-cover-shade{position:absolute;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(8,15,35,.16),transparent 34%,transparent 64%,rgba(8,15,35,.3))}
.gal-badge{position:absolute;z-index:2;display:inline-flex;align-items:center;gap:5px;max-width:calc(100% - 100px);border-radius:999px;padding:3px 9px;font-size:11px;font-weight:600;background:rgba(255,255,255,.84);color:#334155;border:1px solid rgba(255,255,255,.3);backdrop-filter:blur(6px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dark .gal-badge{background:rgba(17,26,44,.84);color:#e8eefc;border-color:rgba(148,163,184,.16)}
.gal-badge .gal-i{font-size:13px}
.gal-badge-type{left:12px;top:12px}
.gal-draft-tag{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;color:#b45309;background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.3)}
.gal-badge-count{right:12px;top:12px;max-width:none}
.gal-body{position:relative;display:flex;flex-direction:column;flex:1;gap:8px;padding:16px}
.gal-card-title{font-size:14.5px;line-height:1.4;font-weight:700;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.gal-card-sub{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--gal-mute)}
.gal-dot{display:inline-block;width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.55}
.gal-preview{min-height:44px;font-size:12.5px;line-height:1.65;color:var(--gal-soft-text)}
.gal-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.gal-clamp3{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.gal-quote-preview{display:flex;flex-direction:column;gap:4px}
.gal-quote-tag{font-size:10.5px;font-weight:700;color:var(--gal-tint)}
.gal-prompt-preview{font-style:italic;color:var(--gal-soft-text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.gal-preview-chips{display:flex;flex-wrap:wrap;gap:5px}
.gal-chip{display:inline-flex;align-items:center;max-width:100%;padding:2px 8px;border-radius:999px;border:1px solid var(--gal-border);background:var(--gal-soft);font-size:10.5px;line-height:1.6;color:var(--gal-soft-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gal-chip-more{color:var(--gal-mute)}
.gal-foot{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:12px;border-top:1px solid var(--gal-border)}
.gal-like{position:relative;z-index:2;display:inline-flex;align-items:center;gap:5px;min-height:34px;padding:0 11px;border-radius:999px;border:1px solid var(--gal-border);background:var(--gal-card);color:var(--gal-mute);font-size:12px;font-weight:600;cursor:pointer;transition:border-color .2s ease,color .2s ease,background .2s ease}
.gal-like:hover{border-color:#e11d48;color:#e11d48}
.gal-like.is-on{color:#e11d48;border-color:rgba(225,29,72,.3);background:rgba(225,29,72,.08)}
.gal-like.is-on .gal-i{fill:currentColor}
.gal-like.is-busy{opacity:.55;cursor:wait}
.gal-unpublish{position:relative;z-index:2}
.gal-unpublish:hover{color:#dc2626;border-color:rgba(220,38,38,.45)}
.gal-module{display:inline-flex;align-items:center;margin-left:auto;padding:2px 8px;border-radius:999px;font-size:10.5px;font-weight:600;color:var(--gal-mc);background:color-mix(in srgb,var(--gal-mc) 12%,transparent);border:1px solid color-mix(in srgb,var(--gal-mc) 22%,transparent);white-space:nowrap}
.gal-grade{font-size:10.5px;color:var(--gal-mute);white-space:nowrap}
.gal-more{display:flex;justify-content:center;margin-top:24px}

/* 封面母题：绘本 */
.gal-booklet{position:relative;display:flex;align-items:flex-end;transform:translateY(10px);filter:drop-shadow(0 12px 18px rgba(30,40,80,.18))}
.gal-booklet-page{position:relative;display:flex;flex-direction:column;gap:5px;width:76px;height:86px;padding:12px 10px;background:linear-gradient(180deg,#fff,#f3f6ff);border-radius:5px;box-shadow:0 1px 2px rgba(30,40,80,.08)}
.gal-booklet-page--l{transform:rotateY(10deg) rotate(-2.5deg);border-radius:9px 4px 4px 9px}
.gal-booklet-page--r{transform:rotateY(-10deg) rotate(2.5deg);margin-left:-3px;border-radius:4px 9px 9px 4px}
.dark .gal-booklet-page{background:linear-gradient(180deg,#f7f9ff,#e9effd)}
.gal-booklet-page b{font-size:9px;line-height:1;color:#94a3b8;font-weight:700}
.gal-booklet-page i{display:block;height:3px;border-radius:2px;background:#dbe3f3}
.gal-booklet-page .l1{width:100%}
.gal-booklet-page .l2{width:82%}
.gal-booklet-page .l3{width:60%}
.gal-booklet-page .l3.short{width:44%}
.gal-booklet-moon{position:absolute;right:9px;bottom:10px;width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fef3c7,#f59e0b);box-shadow:0 0 0 4px rgba(253,230,138,.22)}
.gal-booklet-spine{position:absolute;left:50%;top:6px;bottom:2px;width:2px;transform:translateX(-50%);background:linear-gradient(180deg,transparent,rgba(70,90,150,.2),transparent);z-index:2}

/* 封面母题：提示词 */
.gal-prompt-mini{position:relative;width:min(270px,90%);padding:12px 14px 14px;border-radius:12px;background:rgba(255,255,255,.9);border:1px solid rgba(255,255,255,.5);box-shadow:0 12px 24px -18px rgba(30,40,80,.35);color:#334155}
.dark .gal-prompt-mini{background:rgba(13,20,36,.82);border-color:rgba(148,163,184,.18);color:#e8eefc}
.gal-prompt-mini p{margin:5px 0 0;font-size:11.5px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.gal-prompt-spark{display:inline-flex;color:#d97706;font-size:14px}
.gal-prompt-caret{display:inline-block;width:8px;height:2px;border-radius:2px;background:#d97706;opacity:.6;margin-top:8px}

/* 封面母题：观察记录 */
.gal-device-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;width:min(250px,94%)}
.gal-device{display:flex;align-items:center;gap:5px;min-width:0;padding:6px 7px;border-radius:9px;background:rgba(255,255,255,.86);border:1px solid rgba(255,255,255,.45);box-shadow:0 8px 18px -16px rgba(20,50,70,.4);color:#0f766e;font-size:10px}
.dark .gal-device{background:rgba(17,26,44,.86);border-color:rgba(148,163,184,.18);color:#5eead4}
.gal-device .gal-i{font-size:14px}
.gal-device em{font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155}
.dark .gal-device em{color:#e8eefc}
.gal-device-empty{display:grid;place-items:center;width:72px;height:72px;border-radius:20px;background:rgba(255,255,255,.6);color:var(--gal-tint);font-size:34px}
.dark .gal-device-empty{background:rgba(17,26,44,.6)}

/* 封面母题：发现地图 */
.gal-map-mini{position:relative;width:100%;height:100%;color:var(--gal-tint);background-image:radial-gradient(rgba(79,124,255,.28) 1px,transparent 1px);background-size:15px 15px}
.dark .gal-map-mini{background-image:radial-gradient(rgba(148,163,184,.24) 1px,transparent 1px)}
.gal-map-mini>svg{position:absolute;inset:0;width:100%;height:100%;opacity:.75}
.gal-map-node{position:absolute;transform:translate(-50%,-50%);display:inline-flex;align-items:center;gap:4px;max-width:120px;padding:2px 8px 2px 3px;border-radius:999px;background:rgba(255,255,255,.92);border:1px solid rgba(255,255,255,.4);box-shadow:0 6px 14px -10px rgba(20,30,60,.4);font-size:9.5px;color:#334155;white-space:nowrap}
.dark .gal-map-node{background:rgba(17,26,44,.92);border-color:rgba(148,163,184,.18);color:#e8eefc}
.gal-map-node b{display:grid;place-items:center;width:15px;height:15px;border-radius:50%;background:var(--gal-tint);color:#fff;font-size:8.5px;flex:none}
.gal-map-node span{overflow:hidden;text-overflow:ellipsis}

/* 封面母题：MR 空间 */
.gal-room-mini{position:relative;width:100%;height:100%;perspective:520px;overflow:hidden}
.gal-room-floor{position:absolute;left:50%;top:52%;width:150px;height:150px;transform:translate(-50%,-50%) rotateX(62deg) rotateZ(45deg);background-image:linear-gradient(rgba(6,182,212,.35) 1px,transparent 1px),linear-gradient(90deg,rgba(6,182,212,.35) 1px,transparent 1px);background-size:24px 24px;border:1px solid rgba(6,182,212,.45);border-radius:8px;box-shadow:0 0 40px rgba(6,182,212,.16)}
.gal-room-tile{position:absolute;transform:translate(-50%,-50%);padding:3px 8px;border-radius:7px;background:rgba(255,255,255,.9);border:1px solid rgba(255,255,255,.4);box-shadow:0 8px 16px -12px rgba(8,60,80,.5);font-size:9.5px;color:#0e7490;white-space:nowrap}
.dark .gal-room-tile{background:rgba(17,26,44,.9);border-color:rgba(148,163,184,.18);color:#67e8f9}

/* 封面母题：发明 / 项目 / 伦理 / 兜底 */
.gal-bulb{position:relative;display:grid;place-items:center;width:92px;height:92px;color:#f97316;font-size:46px}
.gal-bulb>svg{position:relative;z-index:1;width:1em;height:1em;filter:drop-shadow(0 8px 14px rgba(249,115,22,.28))}
.gal-bulb::before{content:"";position:absolute;inset:8px;border-radius:50%;background:radial-gradient(circle,rgba(249,115,22,.22),transparent 68%)}
.gal-bulb-gear{position:absolute;right:2px;top:2px;font-size:30px;color:rgba(249,115,22,.28);transform:rotate(18deg)}
.gal-spark{position:absolute;width:5px;height:5px;border-radius:50%;background:currentColor;opacity:.6}
.gal-spark.s1{left:4px;top:22px}
.gal-spark.s2{right:6px;bottom:18px;width:3px;height:3px}
.gal-rocket{position:relative;display:grid;place-items:center;width:100px;height:92px;color:#ec4899;font-size:48px}
.gal-rocket>svg{width:1em;height:1em;transform:rotate(10deg);filter:drop-shadow(0 10px 16px rgba(236,72,153,.25))}
.gal-orbit{position:absolute;width:120px;height:48px;border:1.5px dashed rgba(236,72,153,.45);border-radius:50%;transform:rotate(-20deg)}
.gal-ethics-mini{display:flex;align-items:center;gap:14px;color:#10b981}
.gal-shield{display:grid;place-items:center;width:54px;height:54px;border-radius:17px;background:rgba(16,185,129,.14);font-size:28px;box-shadow:inset 0 0 0 1px rgba(16,185,129,.18)}
.gal-rules{display:flex;flex-direction:column;gap:7px}
.gal-rules i{display:block;width:96px;height:7px;border-radius:4px;background:rgba(16,185,129,.25)}
.gal-rules i:nth-child(2){width:76px}
.gal-rules i:nth-child(3){width:54px}
.gal-palette{display:flex;align-items:center;gap:12px;color:var(--gal-tint);font-size:44px}
.gal-swatches{display:flex;flex-direction:column;gap:5px}
.gal-swatches i{display:block;width:36px;height:10px;border-radius:999px;opacity:.75}
.gal-note-mini{position:relative;display:flex;flex-direction:column;gap:4px;width:min(240px,92%);min-height:96px;padding:12px 14px 14px;border-radius:14px;background:rgba(255,255,255,.9);border:1px solid rgba(255,255,255,.5);box-shadow:0 12px 24px -18px rgba(30,40,80,.35);color:#334155;text-align:left}
.dark .gal-note-mini{background:rgba(13,20,36,.82);border-color:rgba(148,163,184,.18);color:#e8eefc}
.gal-note-badge{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:var(--gal-tint)}
.gal-note-badge .gal-i{font-size:13px}
.gal-note-mini p{margin:0;font-size:11.5px;line-height:1.6;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.gal-note-deco{position:absolute;right:10px;bottom:4px;font-size:34px;color:var(--gal-tint);opacity:.13;pointer-events:none}
.gal-note-count{align-self:flex-start;margin-top:2px;padding:1px 8px;border-radius:999px;background:var(--gal-tint-a);color:var(--gal-tint);font-size:10px;font-weight:700}
.gal-palette-dots{display:flex;gap:5px;margin-top:4px}
.gal-palette-dots i{display:block;width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.55)}
.gal-rule-lines{display:flex;flex-direction:column;gap:4px;max-width:140px}
.gal-rule-lines em{display:block;font-style:normal;font-size:9.5px;line-height:1.5;color:#047857;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dark .gal-rule-lines em{color:#6ee7b7}
.gal-rule-count{padding:1px 7px;border-radius:999px;border:1px solid rgba(16,185,129,.3);background:rgba(16,185,129,.1);font-size:9.5px;font-weight:700;color:#059669;white-space:nowrap}
.dark .gal-rule-count{color:#6ee7b7}

/* 详情页 */
.gal-crumbs{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--gal-mute);margin-bottom:20px}
.gal-crumbs a{display:inline-flex;align-items:center;gap:6px;color:var(--gal-mute);text-decoration:none;transition:color .2s ease}
.gal-crumbs a:hover{color:var(--gal-accent)}
.gal-crumbs .gal-i{font-size:14px}
.gal-hero{display:flex;align-items:flex-start;gap:16px;flex-wrap:wrap;padding:22px 24px;border-radius:20px;border:1px solid var(--gal-border);background:linear-gradient(120deg,var(--gal-tint-a),transparent 62%),var(--gal-card);margin-bottom:20px}
.gal-hero-icon{display:grid;place-items:center;flex:none;width:56px;height:56px;border-radius:16px;background:var(--gal-tint-a);color:var(--gal-tint);font-size:28px}
.gal-hero-icon--photo{overflow:hidden;background:var(--gal-soft)}
.gal-hero-icon--photo img{width:100%;height:100%;object-fit:cover}
.gal-hero-text{flex:1;min-width:220px}
.gal-hero-kicker{font-size:12px;font-weight:700;letter-spacing:.02em;color:var(--gal-tint)}
.gal-hero h1{font-size:24px;line-height:1.3;font-weight:800;letter-spacing:-.01em;margin:4px 0 8px;overflow-wrap:anywhere}
.gal-hero-meta{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12.5px;color:var(--gal-mute)}
.gal-hero-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.gal-like-big{min-height:38px}
.gal-like-big.is-on{color:#e11d48;border-color:rgba(225,29,72,.3);background:rgba(225,29,72,.08)}
.gal-like-big.is-on .gal-i{fill:currentColor}
.gal-like-big.is-busy{opacity:.55;cursor:wait}
.gal-detail-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:20px}
@media(min-width:1024px){.gal-detail-grid{grid-template-columns:minmax(0,1fr) 300px}}
.gal-panel{background:var(--gal-card);border:1px solid var(--gal-border);border-radius:20px}
.gal-main{padding:22px 24px}
.gal-image-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px;margin-bottom:20px}
.gal-image-strip img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:14px;border:1px solid var(--gal-border);background:var(--gal-soft)}
.gal-side{display:flex;flex-direction:column;gap:14px}
@media(min-width:1024px){.gal-side{position:sticky;top:88px;align-self:start}}
.gal-sec-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:16px}
.gal-sec-head h2{font-size:16px;font-weight:700;margin:0}
.gal-sec-sub{margin-top:22px}
.gal-sec-note{margin-left:auto;font-size:12px;color:var(--gal-mute)}
.gal-fulltext{margin-top:22px;padding-top:18px;border-top:1px solid var(--gal-border)}
.gal-fulltext h3{font-size:13px;font-weight:600;color:var(--gal-mute);margin:0 0 10px}
.gal-fulltext p{font-size:13px;line-height:1.8;color:var(--gal-soft-text);margin:0 0 8px}
.gal-fulltext b{display:inline-block;min-width:56px;margin-right:6px;color:var(--gal-tint);font-weight:700}
.gal-empty-inline{display:flex;align-items:center;gap:10px;padding:18px;border:1px dashed var(--gal-border);border-radius:12px;color:var(--gal-mute);font-size:13px}
.gal-empty-inline .gal-i{font-size:20px;color:var(--gal-tint)}

/* 绘本阅读器 */
.gal-spread{display:grid;grid-template-columns:minmax(0,1fr);border-radius:16px;overflow:hidden;border:1px solid var(--gal-border);background:var(--gal-soft)}
@media(min-width:640px){.gal-spread{grid-template-columns:repeat(2,minmax(0,1fr))}}
.gal-face{--gal-face-pad:20px;position:relative;display:flex;flex-direction:column;min-height:220px;padding:var(--gal-face-pad) var(--gal-face-pad) calc(var(--gal-face-pad) + 6px);background:linear-gradient(180deg,rgba(255,255,255,.62),rgba(255,255,255,.08))}
.gal-face-media{display:block;overflow:hidden;margin:calc(-1 * var(--gal-face-pad)) calc(-1 * var(--gal-face-pad)) 14px;aspect-ratio:4/3;background:var(--gal-soft);border-bottom:1px solid var(--gal-border)}
.gal-face-media img{display:block;width:100%;height:100%;object-fit:cover}
.dark .gal-face{background:linear-gradient(180deg,rgba(255,255,255,.05),transparent)}
.gal-face+.gal-face{border-top:1px dashed var(--gal-border)}
@media(min-width:640px){.gal-face+.gal-face{border-top:0;border-left:1px dashed var(--gal-border)}}
.gal-face-art{position:absolute;right:12px;bottom:4px;color:var(--gal-tint);opacity:.13;font-size:110px;pointer-events:none}
.gal-face-art .gal-i{width:1em;height:1em}
.gal-face-no{position:relative;font-size:11px;font-weight:700;letter-spacing:.06em;color:var(--gal-tint)}
.gal-face p{position:relative;margin:10px 0 0;font-size:14.5px;line-height:2;color:var(--gal-text);white-space:pre-wrap;overflow-wrap:anywhere}
.gal-face--blank{align-items:center;justify-content:center;color:var(--gal-mute);font-size:12px;background:transparent}
.gal-reader-bar{display:flex;align-items:center;gap:12px;margin-top:14px}
.gal-nav-btn{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;border:1px solid var(--gal-border);background:var(--gal-card);color:var(--gal-text);font-size:18px;cursor:pointer;transition:border-color .2s ease,color .2s ease}
.gal-nav-btn:hover:not(:disabled){border-color:var(--gal-tint);color:var(--gal-tint)}
.gal-nav-btn:disabled{opacity:.35;cursor:default}
.gal-range{flex:1;text-align:center;font-size:12.5px;color:var(--gal-mute)}
.gal-dots{display:flex;justify-content:center;gap:6px;margin-top:10px}
.gal-dot-ind{width:6px;height:6px;border-radius:999px;background:var(--gal-border);transition:width .2s ease,background .2s ease}
.gal-dot-ind.is-on{width:18px;background:var(--gal-tint)}

/* 提示词详情 */
.gal-prompt-sheet{position:relative;padding:26px 22px 22px;border-radius:14px;border:1px solid var(--gal-border);background:linear-gradient(140deg,var(--gal-tint-a),transparent 70%),var(--gal-soft)}
.gal-bigquote{position:absolute;left:14px;top:0;font:700 44px/1 Georgia,serif;color:var(--gal-tint);opacity:.45}
.gal-prompt-sheet p{position:relative;margin:0;font-size:15px;line-height:1.9;color:var(--gal-text);white-space:pre-wrap;overflow-wrap:anywhere}
.gal-tips{display:flex;flex-direction:column;gap:4px;margin-top:18px;padding:14px 16px;border:1px dashed var(--gal-border);border-radius:12px;font-size:12.5px;line-height:1.7}
.gal-tips b{color:var(--gal-tint);font-size:12px}
.gal-tips span{color:var(--gal-mute)}

/* 观察 / 地图 / MR 详情 */
.gal-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:16px}
.gal-stat{padding:12px 14px;border-radius:12px;background:var(--gal-soft);border:1px solid var(--gal-border)}
.gal-stat b{display:block;font-size:20px;line-height:1.2;color:var(--gal-tint)}
.gal-stat span{font-size:11.5px;color:var(--gal-mute)}
.gal-meter{height:8px;border-radius:999px;overflow:hidden;background:var(--gal-soft);border:1px solid var(--gal-border);margin:4px 0 18px}
.gal-meter i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--gal-tint),rgba(53,89,246,.75))}
.gal-zones{display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
@media(min-width:640px){.gal-zones{grid-template-columns:repeat(2,minmax(0,1fr))}}
.gal-zone{padding:14px;border-radius:14px;border:1px solid var(--gal-border);background:var(--gal-soft)}
.gal-zone h3{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;margin:0 0 10px}
.gal-zone h3 .gal-i{font-size:15px;color:var(--gal-tint)}
.gal-device-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:7px}
.gal-device-item{display:flex;align-items:center;gap:7px;min-width:0;padding:7px 9px;border-radius:9px;background:var(--gal-card);border:1px solid var(--gal-border);font-size:12px}
.gal-device-item .gal-i{font-size:16px;color:var(--gal-tint)}
.gal-device-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gal-chip-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
.gal-map-board{position:relative;height:300px;border-radius:16px;border:1px solid var(--gal-border);background:var(--gal-soft);background-image:radial-gradient(var(--gal-border) 1px,transparent 1px);background-size:18px 18px;overflow:hidden;margin-bottom:18px;color:var(--gal-tint)}
.gal-map-path{position:absolute;inset:0;width:100%;height:100%;opacity:.8}
.gal-map-pin{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;gap:6px;max-width:160px;padding:4px 10px 4px 4px;border-radius:999px;background:var(--gal-card);border:1px solid var(--gal-border);box-shadow:0 8px 16px -12px rgba(20,30,60,.35);font-size:11.5px;white-space:nowrap}
.gal-map-pin b{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--gal-tint);color:#fff;font-size:10px;flex:none}
.gal-map-pin span{overflow:hidden;text-overflow:ellipsis}
.gal-number-list{margin:0;padding-left:22px;display:flex;flex-direction:column;gap:6px}
.gal-number-list li{font-size:13px;line-height:1.7;color:var(--gal-soft-text);overflow-wrap:anywhere}
.gal-number-list li::marker{color:var(--gal-tint);font-weight:700}
.gal-plan{position:relative;height:250px;border-radius:16px;border:1px solid var(--gal-border);background:var(--gal-soft);overflow:hidden;margin-bottom:18px;perspective:600px}
.gal-plan-floor{position:absolute;left:50%;top:52%;width:210px;height:210px;transform:translate(-50%,-50%) rotateX(60deg) rotateZ(45deg);background-image:linear-gradient(var(--gal-tint-a) 1px,transparent 1px),linear-gradient(90deg,var(--gal-tint-a) 1px,transparent 1px);background-size:30px 30px;border:1px solid var(--gal-tint);border-radius:10px;box-shadow:0 0 50px var(--gal-tint-a)}
.gal-plan-zone{position:absolute;transform:translate(-50%,-50%);padding:5px 10px;border-radius:8px;background:var(--gal-card);border:1px solid var(--gal-border);box-shadow:0 8px 16px -12px rgba(20,30,60,.35);font-size:11px;font-weight:600;color:var(--gal-tint);white-space:nowrap}

/* 发明 / 项目 / 伦理 */
.gal-feature{display:grid;grid-template-columns:minmax(0,1fr);gap:18px}
@media(min-width:720px){.gal-feature{grid-template-columns:220px minmax(0,1fr)}}
.gal-feature-visual{position:relative;display:grid;place-items:center;min-height:180px;border-radius:16px;border:1px solid var(--gal-border);background:linear-gradient(150deg,var(--gal-tint-a),transparent 70%),var(--gal-soft);overflow:hidden}
.gal-bulb-lg{font-size:80px}
.gal-rocket-lg{font-size:72px}
.gal-bullets{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.gal-bullets li{position:relative;padding-left:20px;font-size:13.5px;line-height:1.8;color:var(--gal-soft-text);overflow-wrap:anywhere}
.gal-bullets li::before{content:"";position:absolute;left:4px;top:.68em;width:6px;height:6px;border-radius:50%;background:var(--gal-tint)}
.gal-timeline{position:relative;margin:0;padding:0 0 0 22px;list-style:none}
.gal-timeline::before{content:"";position:absolute;left:6px;top:6px;bottom:6px;width:2px;background:linear-gradient(var(--gal-tint),var(--gal-border))}
.gal-timeline li{position:relative;padding:0 0 16px}
.gal-timeline li:last-child{padding-bottom:0}
.gal-timeline li::before{content:"";position:absolute;left:-21px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--gal-card);border:2px solid var(--gal-tint)}
.gal-timeline b{display:block;font-size:11px;color:var(--gal-mute);margin-bottom:2px}
.gal-timeline p{margin:0;font-size:13.5px;line-height:1.8;color:var(--gal-soft-text);overflow-wrap:anywhere}
.gal-rules-list{display:flex;flex-direction:column;gap:10px}
.gal-rule{display:flex;align-items:flex-start;gap:12px;padding:12px 14px;border-radius:12px;border:1px solid var(--gal-border);background:var(--gal-soft)}
.gal-rule b{display:grid;place-items:center;flex:none;width:26px;height:26px;border-radius:50%;background:var(--gal-tint-a);color:var(--gal-tint);font-size:11px}
.gal-rule p{margin:2px 0 0;font-size:13px;line-height:1.75;color:var(--gal-soft-text);overflow-wrap:anywhere}
.gal-rule-check{margin-left:auto;color:var(--gal-tint);font-size:16px;flex:none}
.gal-prose p{margin:0 0 12px;font-size:14px;line-height:1.9;color:var(--gal-soft-text);white-space:pre-wrap;overflow-wrap:anywhere}
.gal-prose p:last-child{margin-bottom:0}
.gal-raw{margin-top:20px;padding-top:16px;border-top:1px solid var(--gal-border)}
.gal-raw h3{font-size:12px;color:var(--gal-mute);font-weight:600;margin:0 0 6px}
.gal-raw p{margin:0;font-size:12px;line-height:1.8;color:var(--gal-mute);white-space:pre-wrap;overflow-wrap:anywhere}

/* 侧栏信息 */
.gal-info{padding:18px 20px}
.gal-info h2{font-size:14px;font-weight:700;margin:0 0 10px}
.gal-info dl{margin:0}
.gal-info-row{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--gal-border);font-size:12.5px}
.gal-info-row:first-child{border-top:0}
.gal-info-row dt{color:var(--gal-mute);white-space:nowrap}
.gal-info-row dd{margin:0;font-weight:600;text-align:right;overflow-wrap:anywhere}
.gal-type-inline{display:inline-flex;align-items:center;gap:5px;color:var(--gal-tint)}
.gal-type-inline .gal-i{font-size:14px}
.gal-back-card{display:flex;align-items:center;gap:8px;padding:16px 18px;border-radius:16px;border:1px solid var(--gal-border);background:var(--gal-card);color:var(--gal-text);text-decoration:none;font-size:13px;font-weight:600;transition:border-color .2s ease,color .2s ease}
.gal-back-card:hover{border-color:var(--gal-accent);color:var(--gal-accent)}

/* 空态 / 骨架 */
.gal-empty{padding:50px 20px;text-align:center;border:1px dashed var(--gal-border);border-radius:20px;background:var(--gal-card)}
.gal-empty-icon{display:grid;place-items:center;width:56px;height:56px;border-radius:16px;background:var(--gal-soft);color:var(--gal-mute);font-size:26px;margin:0 auto 12px}
.gal-empty h1,.gal-empty h3{font-size:15px;font-weight:700;margin:0 0 6px}
.gal-empty p{font-size:13px;color:var(--gal-mute);margin:0 0 16px;line-height:1.7}
.gal-empty-actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
.gal-skel{pointer-events:none}
.gal-skel-cover{height:150px;background:linear-gradient(90deg,var(--gal-soft) 25%,var(--gal-border) 37%,var(--gal-soft) 63%);background-size:400% 100%;animation:gal-shimmer 1.4s ease infinite}
.gal-skel-line{display:block;width:100%;height:10px;border-radius:6px;background:var(--gal-soft);margin:4px 0}
.gal-skel-line.tall{height:16px}
.gal-skel-line.w30{width:30%}
.gal-skel-line.w40{width:40%}
.gal-skel-line.w50{width:50%}
.gal-skel-line.w60{width:60%}
.gal-skel-line.w70{width:70%}
.gal-skel-line.w80{width:80%}
.gal-skel-block{height:180px;border-radius:14px;background:linear-gradient(90deg,var(--gal-soft) 25%,var(--gal-border) 37%,var(--gal-soft) 63%);background-size:400% 100%;animation:gal-shimmer 1.4s ease infinite;margin:16px 0}
.gal-skel-block.short{height:90px}
.gal-skel-hero{padding:22px 24px}
.gal-skel-circle{display:block;width:56px;height:56px;border-radius:16px;background:var(--gal-soft);flex:none}
.gal-skel-lines{display:flex;flex-direction:column;gap:8px;flex:1;min-width:200px}
@keyframes gal-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}

/* 提示条 */
.gal-toast{position:fixed;left:50%;bottom:32px;z-index:150;max-width:min(90vw,480px);padding:10px 16px;border-radius:999px;background:#0f172a;color:#fff;font-size:13px;line-height:1.5;text-align:center;opacity:0;pointer-events:none;transform:translate(-50%,16px);transition:opacity .2s ease,transform .2s ease;box-shadow:0 18px 40px -18px rgba(15,23,42,.7)}
.gal-toast.show{opacity:1;transform:translate(-50%,0)}
.gal-toast.warn{background:#b45309}
.gal-toast.error{background:#b91c1c}

/* 弹层 */
.gal-modal-backdrop{position:fixed;inset:0;z-index:140;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(10,16,32,.5);backdrop-filter:blur(3px)}
.gal-modal{width:min(560px,100%);max-height:min(86vh,720px);overflow:auto;background:var(--gal-card);color:var(--gal-text);border:1px solid var(--gal-border);border-radius:20px;padding:24px;box-shadow:0 30px 80px -30px rgba(15,23,42,.6)}
.gal-modal-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:4px}
.gal-modal-head h2{font-size:18px;font-weight:700;margin:0}
.gal-modal-head p{font-size:12.5px;line-height:1.6;color:var(--gal-mute);margin:6px 0 0}
.gal-modal-head .gal-icon-btn{margin-left:auto;flex:none}
.gal-modal-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;flex-wrap:wrap}
.gal-confirm-text{margin:16px 0 0;font-size:13.5px;line-height:1.8;color:var(--gal-soft-text);overflow-wrap:anywhere}

/* 上传表单 */
.gal-form{display:flex;flex-direction:column;gap:14px;margin-top:16px}
.gal-form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.gal-field{display:flex;flex-direction:column;min-width:0}
.gal-field label{font-size:12.5px;color:var(--gal-mute);margin-bottom:6px}
.gal-input{width:100%;border:1px solid var(--gal-border);background:var(--gal-card);color:var(--gal-text);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;outline:none;transition:border-color .2s ease,box-shadow .2s ease}
.gal-input:focus{border-color:var(--gal-accent);box-shadow:0 0 0 3px rgba(53,89,246,.12)}
select.gal-input{appearance:none;-webkit-appearance:none;height:38px;padding-right:34px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;cursor:pointer}
textarea.gal-input{min-height:86px;resize:vertical;line-height:1.6}
.gal-readonly{height:38px;display:flex;align-items:center;padding:0 12px;border-radius:10px;border:1px dashed var(--gal-border);background:var(--gal-soft);color:var(--gal-mute);font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gal-form-note{display:flex;justify-content:space-between;gap:10px;margin-top:6px;font-size:11.5px;color:var(--gal-mute)}
.gal-form-error{display:none;font-size:12.5px;line-height:1.6;color:#dc2626;padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.08)}
.gal-form-error.show{display:block}

/* 从个人作品挑选发布 */
.gal-picker{display:flex;flex-direction:column;gap:12px;margin-top:16px}
.gal-picker-head{display:flex;align-items:center;justify-content:space-between;gap:10px}
.gal-pick-all{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:var(--gal-soft-text);cursor:pointer}
.gal-pick-count{font-size:12px;color:var(--gal-mute)}
.gal-picker-list{display:flex;flex-direction:column;gap:8px;max-height:min(46vh,380px);overflow:auto;padding:2px}
.gal-pick{display:flex;align-items:center;gap:11px;padding:9px 11px;border:1px solid var(--gal-border);border-radius:12px;background:var(--gal-card);cursor:pointer;transition:border-color .2s ease,background .2s ease}
.gal-pick:hover{border-color:var(--gal-accent)}
.gal-pick:has(input:checked){border-color:var(--gal-accent);background:rgba(53,89,246,.06)}
.gal-pick input{flex:none;width:17px;height:17px;accent-color:#4f7cff;cursor:pointer}
.gal-pick-cover{flex:none;display:grid;place-items:center;width:46px;height:46px;border-radius:9px;overflow:hidden;background:var(--gal-soft);color:var(--gal-tint,#64748b)}
.gal-pick-cover img{width:100%;height:100%;object-fit:cover}
.gal-pick-cover--icon .gal-i{font-size:22px}
.gal-pick-main{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.gal-pick-title{font-size:13px;font-weight:600;color:var(--gal-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gal-pick-meta{font-size:11.5px;color:var(--gal-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gal-pick-tick{flex:none;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;border:1.5px solid var(--gal-border);color:transparent;font-size:12px}
.gal-pick:has(input:checked) .gal-pick-tick{border-color:var(--gal-accent);background:var(--gal-accent);color:#fff}
.gal-pick-loading{padding:26px 12px;text-align:center;font-size:13px;color:var(--gal-mute)}
.gal-picker-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 12px;text-align:center}
.gal-picker-empty-icon{font-size:30px;color:var(--gal-mute)}
.gal-picker-empty p{margin:0;font-size:13px;font-weight:600;color:var(--gal-soft-text)}
.gal-picker-empty .gal-picker-hint{font-size:12px;font-weight:400;color:var(--gal-mute)}
.gal-picker-hint{margin:2px 0 0;font-size:12px;line-height:1.6;color:var(--gal-mute)}
.gal-picker-hint a{color:var(--gal-accent);text-decoration:none}
.gal-picker-hint a:hover{text-decoration:underline}
.gal-picker-empty .gal-btn{margin-top:8px}

/* 焦点 */
.gal-page a:focus-visible,.gal-page button:focus-visible,.gal-page select:focus-visible,
.gal-modal-backdrop a:focus-visible,.gal-modal-backdrop button:focus-visible,.gal-modal-backdrop input:focus-visible,
.gal-modal-backdrop select:focus-visible,.gal-modal-backdrop textarea:focus-visible{outline:2px solid var(--gal-accent);outline-offset:2px}

/* 移动端 */
@media(max-width:640px){
  .gal-container{width:calc(100% - 32px);padding-top:28px}
  .gal-title{font-size:24px}
  .gal-toolbar{gap:10px}
  .gal-select{flex:1 1 150px;min-width:0}
  .gal-count{order:3;flex:1 1 auto}
  .gal-actions{order:4;width:100%;justify-content:flex-end}
  .gal-upload{margin-left:0}
  .gal-main{padding:18px}
  .gal-hero{padding:18px}
  .gal-hero h1{font-size:20px}
  .gal-hero-actions{width:100%}
  .gal-face{--gal-face-pad:16px;min-height:190px;padding:var(--gal-face-pad) var(--gal-face-pad) calc(var(--gal-face-pad) + 6px)}
  .gal-face-art{font-size:88px}
  .gal-image-strip{grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:8px}
  .gal-map-board{height:260px}
  .gal-plan{height:220px}
  .gal-form-row{grid-template-columns:minmax(0,1fr)}
  .gal-modal{padding:20px}
  .gal-sec-note{margin-left:0;flex-basis:100%}
}

@media(prefers-reduced-motion:reduce){
  .gal-card,.gal-btn,.gal-icon-btn,.gal-like,.gal-toast,.gal-dot-ind{transition:none}
  .gal-card:hover{transform:none}
  .gal-skel-cover,.gal-skel-block{animation:none}
}
`
})();
