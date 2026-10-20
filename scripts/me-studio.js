/**
 * 「我的」运行时页面：/me（个人资料）与 /me/works（个人作品）。
 *
 * 服务器上只有 Vite 构建产物。沿用成果展厅的做法：
 *   1. 等 app 挂载后，用 $router 新增两条路由（requiresAuth 交给站点原有守卫）；
 *   2. 组件 render() 返回 null，在 $el（注释占位节点）前插入自己的 DOM；
 *   3. 交互全部原生 DOM，样式走站点 CSS 变量，自动跟随明暗主题。
 *
 * 作品语义：训练页保存的作品先落个人作品库（published=false），
 * 只有在这里或成果展厅显式「发布」后才出现在公开作品墙。
 * 头像支持上传图片（PNG/JPEG/WebP ≤2MB），没有图片时回退到底色 + 昵称首字。
 */
;(() => {
  'use strict'

  if (window.__AIQ_ME_STUDIO__) return
  window.__AIQ_ME_STUDIO__ = true

  // 本模块在入口 bundle 之前加载：此时地址栏还是用户原始深链接。
  // 入口的 catch-all 会把未知的 /me 重定向到 /，晚一步就读不到了。
  const INITIAL_HASH = window.location.hash

  // ── 站点元数据（与 gallery-studio 同一套口径）──────────────
  const MODULES = [
    { id: 'm1', code: 'AI·认知', name: '探索智能', color: '#4f7cff' },
    { id: 'm2', code: 'AI·生成', name: '创作智能', color: '#a855f7' },
    { id: 'm3', code: 'AI·交互', name: '体验智能', color: '#14b8a6' },
    { id: 'm4', code: 'AI·实践', name: '创造智能', color: '#f59e0b' },
  ]
  const GRADES = { low: '低段', mid: '中段', high: '高段' }
  const CREATE_TYPES = [
    'AI 发现地图',
    'AI 课文绘本',
    '提示词设计',
    'MR 空间方案',
    'AI 发明作品',
    'AI 创新项目',
    'AI 伦理守则',
  ]
  const PAGE_SIZE = 24
  const MAX_AVATAR_BYTES = 2 * 1024 * 1024
  const MAX_AVATAR_SOURCE_BYTES = 15 * 1024 * 1024
  const AVATAR_OUTPUT_SIZE = 512
  const AVATAR_QUALITY = 0.86
  const HUE_SWATCHES = [0, 20, 45, 90, 140, 175, 200, 225, 265, 300, 330]

  const TYPES = {
    'AI 课文绘本': { icon: 'book', color: '#a855f7' },
    提示词设计: { icon: 'prompt', color: '#f59e0b' },
    观察记录: { icon: 'radar', color: '#14b8a6' },
    'AI 发现地图': { icon: 'map', color: '#4f7cff' },
    'MR 空间方案': { icon: 'cube', color: '#06b6d4' },
    'AI 发明作品': { icon: 'bulb', color: '#f97316' },
    'AI 创新项目': { icon: 'rocket', color: '#ec4899' },
    'AI 伦理守则': { icon: 'shield', color: '#10b981' },
  }
  const FALLBACK_TYPE = { icon: 'palette', color: '#64748b' }

  const ICONS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    users:
      '<path d="M16 20.5v-1.6a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1.6"/><circle cx="9" cy="7.5" r="3.5"/><path d="M22 20.5v-1.6a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75"/>',
    camera:
      '<path d="M4 8.5h3l1.5-2h7L17 8.5h3a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 4 8.5z"/><circle cx="12" cy="13.5" r="3.5"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 14.5v2"/>',
    logout:
      '<path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
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
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    check: '<path d="M5 12.5l4.3 4.3L19 7"/>',
    trash:
      '<path d="M4 6.5h16M9 6.5V4h6v2.5M6.5 6.5l.8 13a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-13"/><path d="M10 10.5v6M14 10.5v6"/>',
    heart:
      '<path d="M12 20.3l-1.3-1.2C6 14.9 3 12.2 3 8.8 3 6.1 5.1 4 7.8 4c1.6 0 3.1.7 4.2 2 1.1-1.3 2.6-2 4.2-2C18.9 4 21 6.1 21 8.8c0 3.4-3 6.1-7.7 10.3L12 20.3z"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17h.01"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  }

  const svgIcon = (name, cls) =>
    `<svg class="me-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.sparkles}</svg>`

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

  const clampHue = (v) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(359, Math.round(n))) : 210
  }

  function typeMeta(type, hue) {
    return TYPES[type] || { ...FALLBACK_TYPE, color: hslHex(clampHue(hue), 68, 55) }
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

  function imagesOf(work) {
    return Array.isArray(work && work.images)
      ? work.images.filter(
          (p) => typeof p === 'string' && /^\/uploads\/works\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(p),
        )
      : []
  }

  function avatarUrlSafe(url) {
    return typeof url === 'string' && /^\/uploads\/avatars\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(url)
      ? url
      : ''
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

  // ── 状态 ───────────────────────────────────────────────────
  const S = {
    mode: 'profile',
    me: null,
    stats: { total: 0, published: 0, drafts: 0 },
    profileLoading: false,
    profileError: '',
    avatarBusy: false,
    works: [],
    worksPage: 0,
    worksHasMore: false,
    worksFiltered: 0,
    worksFilter: 'all',
    worksLoading: false,
    worksLoaded: false,
    worksError: '',
    busy: new Set(),
  }
  let worksSeq = 0
  let root = null
  let toastEl = null
  let toastTimer = 0
  let modalEl = null
  let modalReturnFocus = null
  let modalReturnTarget = null
  let modalKeyHandler = null
  let modalCleanup = null
  const ctx = { router: null, pinia: null }
  const listeners = { click: null, change: null, input: null, submit: null, keydown: null }

  function authStore() {
    try {
      return (ctx.pinia && ctx.pinia._s.get('user')) || null
    } catch {
      return null
    }
  }

  function syncAuthUser(user) {
    const store = authStore()
    if (store && typeof store.patchUser === 'function') store.patchUser(user)
  }

  function resetState(mode) {
    S.mode = mode
    S.me = null
    S.stats = { total: 0, published: 0, drafts: 0 }
    S.profileLoading = false
    S.profileError = ''
    S.avatarBusy = false
    S.works = []
    S.worksPage = 0
    S.worksHasMore = false
    S.worksFiltered = 0
    S.worksFilter = 'all'
    S.worksLoading = false
    S.worksLoaded = false
    S.worksError = ''
    S.busy.clear()
    worksSeq++
  }

  // ── 头像展示 ───────────────────────────────────────────────
  function avatarStyle(me) {
    const url = avatarUrlSafe(me && me.avatarUrl)
    if (url) {
      // URL 已由 avatarUrlSafe 收敛为安全字符，不加引号避免打断 style 属性
      return `background-image:url(${url});background-size:cover;background-position:center;color:transparent`
    }
    const h = clampHue(me && me.avatarHue)
    return `background:linear-gradient(135deg, hsl(${h} 82% 62%), hsl(${(h + 42) % 360} 78% 56%))`
  }

  function avatarHTML(me, size) {
    const initial = esc(String((me && me.nickname) || '?').slice(0, 1))
    const label = avatarUrlSafe(me && me.avatarUrl) ? '头像' : `${esc((me && me.nickname) || '用户')}的头像`
    return `<span class="me-avatar ${size || ''}" data-me-avatar style="${avatarStyle(me)}" role="img" aria-label="${label}">${initial}</span>`
  }

  // ── 骨架 / 空态 / 登录提示 ─────────────────────────────────
  function profileSkeleton() {
    return `<div class="me-container">
      <div class="me-skel me-skel-head"><span class="me-skel-line w30 tall"></span><span class="me-skel-line w60"></span></div>
      <div class="me-hero me-card me-skel">
        <span class="me-skel-circle"></span>
        <div class="me-skel-lines"><span class="me-skel-line w40 tall"></span><span class="me-skel-line w60"></span><span class="me-skel-line w30"></span></div>
      </div>
      <div class="me-columns">
        <div class="me-card me-skel"><span class="me-skel-line w30 tall"></span><span class="me-skel-line"></span><span class="me-skel-line w80"></span><span class="me-skel-line w60"></span></div>
        <div class="me-card me-skel"><span class="me-skel-line w30 tall"></span><span class="me-skel-line"></span><span class="me-skel-line w80"></span></div>
      </div>
    </div>`
  }

  function loginPrompt() {
    const redirect = S.mode === 'works' ? '%2Fme%2Fworks' : '%2Fme'
    return `<div class="me-container">
      <div class="me-login">
        <div class="me-empty-icon">${svgIcon('user')}</div>
        <h1>登录后进入「我的」</h1>
        <p>登录后可以编辑个人资料、上传头像、修改密码，也可以管理自己的作品，并把作品发布到成果展厅。</p>
        <div class="me-empty-actions">
          <a class="me-btn me-primary" href="#/login?redirect=${redirect}">去登录</a>
          <a class="me-btn" href="#/register">注册新账号</a>
        </div>
      </div>
    </div>`
  }

  function errorShell(message, retryAct) {
    return `<div class="me-container">
      <div class="me-login">
        <div class="me-empty-icon">${svgIcon('alert')}</div>
        <h1>页面没有加载出来</h1>
        <p>${esc(message || '网络开小差了，请稍后再试')}</p>
        <div class="me-empty-actions"><button type="button" class="me-btn me-primary" data-act="${retryAct}">重新加载</button></div>
      </div>
    </div>`
  }

  // ── 个人资料页 ─────────────────────────────────────────────
  function statHTML(label, value) {
    return `<span class="me-stat"><b>${Number(value) || 0}</b><span>${esc(label)}</span></span>`
  }

  function profileShell() {
    const me = S.me
    const hue = clampHue(me.avatarHue)
    const hasImage = !!avatarUrlSafe(me.avatarUrl)
    const swatches = HUE_SWATCHES.map((h) => {
      const active = h === hue ? ' is-active' : ''
      return `<button type="button" class="me-swatch${active}" data-act="hue" data-hue="${h}" style="--sw:hsl(${h} 82% 60%)" aria-label="头像底色 ${h} 度" aria-pressed="${h === hue}"></button>`
    }).join('')

    return `<div class="me-container">
      <header class="me-head">
        <span class="me-tag">${svgIcon('user')}我的</span>
        <h1 class="me-title"><span class="me-grad">个人中心 · 我的学习与作品</span></h1>
        <p class="me-sub">这里可以编辑昵称与头像、修改登录密码，也可以查看并管理自己的作品。作品先保存在个人作品库，选好后发布到成果展厅。</p>
      </header>

      <section class="me-hero me-card">
        <div class="me-avatar-col">
          ${avatarHTML(me, 'xl')}
          <div class="me-avatar-actions">
            <button type="button" class="me-btn me-sm" data-act="avatar-choose">${svgIcon('camera')}上传头像</button>
            ${hasImage ? '<button type="button" class="me-btn me-sm me-ghost" data-act="avatar-remove">移除</button>' : ''}
          </div>
          <input type="file" id="me-avatar-file" accept="image/png,image/jpeg,image/webp" hidden>
          <span class="me-avatar-hint">PNG / JPEG / WebP，≤15MB</span>
          <span class="me-avatar-hint">上传前裁剪 · AI 安全检查</span>
        </div>
        <div class="me-hero-info">
          <h2>${esc(me.nickname)}</h2>
          <p class="me-email">${esc(me.email)}</p>
          <div class="me-stats">
            ${statHTML('个人作品', S.stats.total)}
            ${statHTML('已发布', S.stats.published)}
            ${statHTML('草稿', S.stats.drafts)}
            ${statHTML('挑战赛最好成绩', me.quizBest)}
          </div>
        </div>
        <a class="me-btn me-primary me-hero-cta" href="#/me/works">我的作品${svgIcon('arrowRight')}</a>
      </section>

      <div class="me-columns">
        <div class="me-col">
          <section class="me-card">
            <div class="me-card-head">
              <h2>个人资料</h2>
              <p>昵称会作为作品署名；改昵称会同步更新已发布作品的署名。</p>
            </div>
            <form class="me-form" id="me-profile-form" novalidate>
              <div class="me-field">
                <label for="me-nickname">昵称</label>
                <input class="me-input" id="me-nickname" name="nickname" maxlength="20" autocomplete="nickname" value="${esc(me.nickname)}">
                <div class="me-form-note"><span>1–20 个字</span><span data-me-nick-count>${String(me.nickname).length} / 20</span></div>
              </div>

              <div class="me-field">
                <label for="me-hue">头像底色 <span class="me-muted" data-me-hue-value>${hue}°</span></label>
                <input class="me-range" type="range" id="me-hue" name="avatarHue" min="0" max="359" step="1" value="${hue}">
                <div class="me-swatches" role="group" aria-label="常用头像底色">${swatches}</div>
                <p class="me-hint">${hasImage ? '已上传头像图片，底色只在移除图片后显示。' : '没有上传图片时，头像使用底色 + 昵称首字。'}</p>
              </div>

              <div class="me-form-error" data-me-error role="alert"></div>
              <div class="me-form-actions">
                <button type="submit" class="me-btn me-primary">保存资料</button>
              </div>
            </form>
          </section>

          <section class="me-card">
            <div class="me-card-head">
              <h2>快捷入口</h2>
              <p>常用页面与账号操作。</p>
            </div>
            <div class="me-links">
              <a class="me-link" href="#/me/classes"><span class="me-link-icon">${svgIcon('users')}</span><span><b>班级管理</b><small>名单、作业链接与完成情况</small></span>${svgIcon('arrowRight')}</a>
              <a class="me-link" href="#/me/works"><span class="me-link-icon">${svgIcon('image')}</span><span><b>我的作品</b><small>查看全部作品、发布或撤下</small></span>${svgIcon('arrowRight')}</a>
              <a class="me-link" href="#/gallery"><span class="me-link-icon">${svgIcon('star')}</span><span><b>成果展厅</b><small>看看同学们发布的作品</small></span>${svgIcon('arrowRight')}</a>
              <a class="me-link" href="#/lab"><span class="me-link-icon">${svgIcon('sparkles')}</span><span><b>互动训练</b><small>继续完成课程训练</small></span>${svgIcon('arrowRight')}</a>
            </div>
            <div class="me-form-actions me-logout-row">
              <button type="button" class="me-btn me-danger" data-act="logout">${svgIcon('logout')}退出登录</button>
            </div>
          </section>
        </div>

        <div class="me-col">
          <section class="me-card">
            <div class="me-card-head">
              <h2>修改密码</h2>
              <p>修改成功后，其他设备上的登录会立即失效，当前设备保持登录。</p>
            </div>
            <form class="me-form" id="me-password-form" novalidate>
              <div class="me-field">
                <label for="me-password-current">当前密码</label>
                <input class="me-input" type="password" id="me-password-current" autocomplete="current-password">
              </div>
              <div class="me-field">
                <label for="me-password-new">新密码</label>
                <input class="me-input" type="password" id="me-password-new" autocomplete="new-password">
                <div class="me-form-note"><span>至少 8 位，最多 72 字节</span></div>
              </div>
              <div class="me-field">
                <label for="me-password-confirm">确认新密码</label>
                <input class="me-input" type="password" id="me-password-confirm" autocomplete="new-password">
              </div>
              <div class="me-form-error" data-me-error role="alert"></div>
              <div class="me-form-actions">
                <button type="submit" class="me-btn me-primary">${svgIcon('lock')}更新密码</button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>`
  }

  async function loadProfile() {
    const seq = ++worksSeq // 与作品页共用递增序号，切换路由时旧请求自然作废
    S.profileLoading = true
    S.profileError = ''
    if (root) root.innerHTML = profileSkeleton()
    try {
      const data = await api('/api/auth/me')
      if (seq !== worksSeq) return
      S.me = data && data.user ? data.user : null
      if (!S.me) {
        if (root) root.innerHTML = loginPrompt()
        return
      }
      syncAuthUser(S.me)
      try {
        const stats = await api('/api/works/mine?pageSize=1')
        if (seq !== worksSeq) return
        S.stats = {
          total: Number(stats.total) || 0,
          published: Number(stats.published) || 0,
          drafts: Number(stats.drafts) || 0,
        }
      } catch {
        /* 统计失败不影响资料编辑 */
      }
      if (seq !== worksSeq || !root) return
      root.innerHTML = profileShell()
      document.title = '我的'
    } catch (err) {
      if (seq !== worksSeq || !root) return
      S.profileError = err && err.message ? err.message : '加载失败'
      root.innerHTML = errorShell(S.profileError, 'retry-profile')
    } finally {
      if (seq === worksSeq) S.profileLoading = false
    }
  }

  // ── 个人作品页 ─────────────────────────────────────────────
  function tabButton(key, label, count) {
    const active = S.worksFilter === key
    return `<button type="button" role="tab" id="me-works-tab-${key}" aria-controls="me-works-grid" class="me-tab" data-act="filter" data-filter="${key}" aria-selected="${active}" tabindex="${active ? 0 : -1}">${esc(label)}<span class="me-tab-num" data-filter-count="${key}">${Number(count) || 0}</span></button>`
  }

  function worksShell() {
    return `<div class="me-container">
      <nav class="me-crumb" aria-label="面包屑"><a href="#/me">我的</a><span aria-hidden="true">/</span><span>我的作品</span></nav>
      <header class="me-head">
        <span class="me-tag">${svgIcon('image')}个人作品</span>
        <h1 class="me-title"><span class="me-grad">我的作品 · 先收藏，再发布</span></h1>
        <p class="me-sub">互动训练里保存的作品都会先来到这里。挑满意的作品发布到成果展厅，全校同学就能看到；没发布的作品只有自己可见。</p>
      </header>
      <div class="me-toolbar">
        <div class="me-tabs" role="tablist" aria-label="按发布状态筛选">
          ${tabButton('all', '全部', S.stats.total)}
          ${tabButton('published', '已发布', S.stats.published)}
          ${tabButton('draft', '草稿', S.stats.drafts)}
        </div>
        <span class="me-count" data-me-count>共 ${S.stats.total} 件作品 · 已发布 ${S.stats.published} · 草稿 ${S.stats.drafts}</span>
        <div class="me-toolbar-actions">
          <a class="me-btn" href="#/gallery">${svgIcon('star')}成果展厅</a>
          <button type="button" class="me-btn me-primary" data-act="new-work">${svgIcon('plus')}新建作品</button>
        </div>
      </div>
      <div class="me-works" id="me-works-grid" role="tabpanel" aria-labelledby="me-works-tab-${S.worksFilter}" tabindex="0" aria-busy="true">${skeletonCards(6)}</div>
      <div data-me-more></div>
    </div>`
  }

  function skeletonCards(n) {
    return Array.from(
      { length: n },
      () =>
        '<div class="me-work-card me-skel" aria-hidden="true"><div class="me-skel-cover"></div><div class="me-work-body"><span class="me-skel-line w70 tall"></span><span class="me-skel-line w40"></span><span class="me-skel-line"></span><span class="me-skel-line w60"></span></div></div>',
    ).join('')
  }

  function coverStyle(work) {
    const meta = typeMeta(work.type, work.hue)
    const h = clampHue(work.hue)
    return `--me-tint:${meta.color};--me-tint-a:${alpha(meta.color, 0.18)};--me-tint-b:${alpha(meta.color, 0.05)};--me-hue:hsla(${h}, 85%, 60%, .14)`
  }

  function workCard(work) {
    const meta = typeMeta(work.type, work.hue)
    const mod = moduleOf(work.module)
    const imgs = imagesOf(work)
    const cover = imgs.length
      ? `<img class="me-work-img" src="${esc(imgs[0])}" alt="" loading="lazy">`
      : `<span class="me-work-art">${svgIcon(meta.icon)}</span>`
    const status = work.published
      ? '<span class="me-badge is-pub">已发布</span>'
      : '<span class="me-badge is-draft">草稿</span>'
    const action = work.published
      ? `<button type="button" class="me-btn me-sm" data-act="unpublish" data-id="${esc(work.id)}">从展厅撤下</button>`
      : `<button type="button" class="me-btn me-sm me-primary" data-act="publish" data-id="${esc(work.id)}">发布到展厅</button>`
    return `<article class="me-work-card" role="listitem" style="${coverStyle(work)}">
      <a class="me-work-cover" href="#/gallery/${encodeURIComponent(work.id)}" aria-label="查看《${esc(work.title)}》">${cover}${status}<span class="me-work-hover">${svgIcon('arrowRight')}</span></a>
      <div class="me-work-body">
        <h3><a href="#/gallery/${encodeURIComponent(work.id)}">${esc(work.title)}</a></h3>
        <p class="me-work-meta">${esc(work.type || '学生创作')} · ${esc(mod.name)} · ${esc(gradeLabel(work.grade))}</p>
        <p class="me-work-desc">${esc(truncate(work.desc || '（没有填写作品说明）', 64))}</p>
        <div class="me-work-foot">
          <span>${esc(dateText(work.createdAt))}</span>
          <span class="me-work-likes">${svgIcon('heart')}${Number(work.likes) || 0}</span>
        </div>
        <div class="me-work-actions">
          <a class="me-btn me-sm" href="#/gallery/${encodeURIComponent(work.id)}">查看</a>
          ${action}
          <button type="button" class="me-btn me-sm me-danger me-work-del" data-act="del" data-id="${esc(work.id)}" aria-label="删除《${esc(work.title)}》">${svgIcon('trash')}</button>
        </div>
      </div>
    </article>`
  }

  function renderWorksGrid(loading) {
    if (!root || S.mode !== 'works') return
    const grid = root.querySelector('#me-works-grid')
    if (!grid) return
    if (loading && !S.works.length) {
      grid.innerHTML = skeletonCards(6)
      grid.setAttribute('aria-busy', 'true')
    } else if (S.worksError) {
      grid.innerHTML = `<div class="me-empty me-empty-wide"><div class="me-empty-icon">${svgIcon('alert')}</div><h2>作品没有加载出来</h2><p>${esc(S.worksError)}</p><div class="me-empty-actions"><button type="button" class="me-btn me-primary" data-act="retry-works">重新加载</button></div></div>`
      grid.setAttribute('aria-busy', 'false')
    } else if (!S.works.length) {
      const isFiltered = S.worksFilter !== 'all'
      grid.innerHTML = `<div class="me-empty me-empty-wide">
        <div class="me-empty-icon">${svgIcon(isFiltered ? 'check' : 'image')}</div>
        <h2>${isFiltered ? '这个分类下还没有作品' : '还没有个人作品'}</h2>
        <p>${isFiltered ? '换个分类看看，或者先去互动训练里完成并保存一份作品。' : '去互动训练完成一份作品，或直接新建一份文字作品。'}</p>
        <div class="me-empty-actions">
          <button type="button" class="me-btn me-primary" data-act="new-work">${svgIcon('plus')}新建作品</button>
          <a class="me-btn" href="#/lab">去互动训练</a>
        </div>
      </div>`
      grid.setAttribute('aria-busy', 'false')
    } else {
      grid.innerHTML = S.works.map(workCard).join('')
      grid.setAttribute('aria-busy', 'false')
    }

    const more = root.querySelector('[data-me-more]')
    if (more) {
      if (S.worksLoading && S.works.length) {
        more.innerHTML = '<div class="me-more"><button type="button" class="me-btn" disabled>加载中…</button></div>'
      } else if (S.worksHasMore) {
        more.innerHTML = `<div class="me-more"><button type="button" class="me-btn" data-act="more">加载更多（还有 ${Math.max(0, S.worksFiltered - S.works.length)} 件）</button></div>`
      } else {
        more.innerHTML = ''
      }
    }
  }

  function updateWorkChrome() {
    if (!root || S.mode !== 'works') return
    root.querySelectorAll('[data-act="filter"]').forEach((btn) => {
      const active = btn.getAttribute('data-filter') === S.worksFilter
      btn.setAttribute('aria-selected', active ? 'true' : 'false')
      btn.setAttribute('tabindex', active ? '0' : '-1')
    })
    const panel = root.querySelector('#me-works-grid')
    if (panel) panel.setAttribute('aria-labelledby', `me-works-tab-${S.worksFilter}`)
    const counts = { all: S.stats.total, published: S.stats.published, draft: S.stats.drafts }
    root.querySelectorAll('[data-filter-count]').forEach((el) => {
      const key = el.getAttribute('data-filter-count')
      if (key in counts) el.textContent = String(counts[key] || 0)
    })
    const count = root.querySelector('[data-me-count]')
    if (count) {
      count.textContent = `共 ${S.stats.total} 件作品 · 已发布 ${S.stats.published} · 草稿 ${S.stats.drafts}`
    }
  }

  async function loadWorks(reset) {
    if (!reset && S.worksLoading) return
    const returnTarget = reset ? describePageFocus(document.activeElement) : null
    const seq = ++worksSeq
    const page = reset ? 1 : S.worksPage + 1
    if (reset) {
      S.works = []
      S.worksPage = 0
      S.worksFiltered = 0
      S.worksError = ''
      S.worksLoaded = false
      renderWorksGrid(true)
    }
    S.worksLoading = true
    if (!reset) renderWorksGrid(false)
    try {
      const res = await api(
        `/api/works/mine?status=${encodeURIComponent(S.worksFilter)}&page=${page}&pageSize=${PAGE_SIZE}`,
      )
      if (seq !== worksSeq || S.mode !== 'works') return
      S.works = reset ? res.works || [] : S.works.concat(res.works || [])
      S.worksPage = Number(res.page) || page
      S.worksHasMore = !!res.hasMore
      S.worksFiltered = Number(res.filtered) || 0
      S.stats = {
        total: Number(res.total) || 0,
        published: Number(res.published) || 0,
        drafts: Number(res.drafts) || 0,
      }
      S.worksLoaded = true
      S.worksError = ''
      renderWorksGrid(false)
      updateWorkChrome()
    } catch (err) {
      if (seq !== worksSeq || S.mode !== 'works') return
      if (err.status === 401) {
        if (root) root.innerHTML = loginPrompt()
        return
      }
      S.worksError = err && err.message ? err.message : '加载失败'
      renderWorksGrid(false)
    } finally {
      if (seq === worksSeq) S.worksLoading = false
      if (seq === worksSeq && S.works.length) renderWorksGrid(false)
      if (seq === worksSeq && returnTarget && !modalEl && !root?.contains(document.activeElement)) restorePageFocus(returnTarget)
    }
  }

  function mountWorks() {
    if (!root) return
    root.innerHTML = worksShell()
    document.title = '我的作品'
    loadWorks(true)
  }

  // ── 资料保存 ───────────────────────────────────────────────
  function formError(form, msg) {
    const el = form && form.querySelector('[data-me-error]')
    if (!el) return
    el.textContent = msg || ''
    el.classList.toggle('show', !!msg)
  }

  async function saveProfile(form) {
    if (S.busy.has('profile')) return
    const nickname = String((form.querySelector('#me-nickname') || {}).value || '').trim()
    const hueInput = form.querySelector('#me-hue')
    const hue = clampHue(hueInput ? hueInput.value : 210)
    const bad = /[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/.test(nickname)
    if (!nickname) return formError(form, '请填写昵称')
    if (nickname.length > 20) return formError(form, '昵称最多 20 个字')
    if (bad) return formError(form, '昵称包含非法字符')

    const returnTarget = describePageFocus(document.activeElement)
    S.busy.add('profile')
    const btn = form.querySelector('button[type="submit"]')
    if (btn) {
      btn.disabled = true
      btn.dataset.label = btn.innerHTML
      btn.textContent = '保存中…'
    }
    formError(form, '')
    try {
      const res = await api('/api/auth/profile', { method: 'PATCH', body: { nickname, avatarHue: hue } })
      if (res.user) {
        S.me = res.user
        syncAuthUser(res.user)
      }
      if (root && S.mode === 'profile') {
        root.innerHTML = profileShell()
        toast('个人资料已保存')
        if (returnTarget && !modalEl) restorePageFocus(returnTarget)
      }
    } catch (err) {
      formError(form, err && err.message ? err.message : '保存失败，请稍后再试')
    } finally {
      S.busy.delete('profile')
      if (root && S.mode === 'profile') {
        const now = root.querySelector('#me-profile-form button[type="submit"]')
        if (now && now.disabled) {
          now.disabled = false
          now.innerHTML = now.dataset.label || '保存资料'
        }
      }
    }
  }

  async function savePassword(form) {
    if (S.busy.has('password')) return
    const current = String((form.querySelector('#me-password-current') || {}).value || '')
    const next = String((form.querySelector('#me-password-new') || {}).value || '')
    const confirm = String((form.querySelector('#me-password-confirm') || {}).value || '')

    if (!current) return formError(form, '请输入当前密码')
    if (next.length < 8) return formError(form, '新密码至少 8 位')
    if (new TextEncoder().encode(next).length > 72) {
      return formError(form, '新密码过长：最多 72 字节（约 24 个汉字）')
    }
    if (next === current) return formError(form, '新密码不能和当前密码相同')
    if (next !== confirm) return formError(form, '两次输入的新密码不一致')

    S.busy.add('password')
    const btn = form.querySelector('button[type="submit"]')
    if (btn) {
      btn.disabled = true
      btn.dataset.label = btn.innerHTML
      btn.textContent = '更新中…'
    }
    formError(form, '')
    try {
      const res = await api('/api/auth/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      })
      if (res.user) {
        S.me = res.user
        syncAuthUser(res.user)
      }
      form.reset()
      toast('密码已修改，其他设备需要重新登录')
    } catch (err) {
      formError(form, err && err.message ? err.message : '修改失败，请稍后再试')
    } finally {
      S.busy.delete('password')
      if (btn && btn.isConnected) {
        btn.disabled = false
        btn.innerHTML = btn.dataset.label || '更新密码'
      }
    }
  }

  // ── 头像上传 / 移除 ────────────────────────────────────────
  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('读取图片失败，请换一张试试'))
      reader.readAsDataURL(file)
    })
  }

  function setAvatarBusy(busy) {
    if (!root) return
    root.querySelectorAll('[data-act="avatar-choose"], [data-act="avatar-remove"]').forEach((btn) => {
      btn.disabled = busy
    })
    const choose = root.querySelector('[data-act="avatar-choose"]')
    if (choose) {
      if (busy) {
        choose.dataset.label = choose.innerHTML
        choose.textContent = '上传中…'
      } else if (choose.dataset.label) {
        choose.innerHTML = choose.dataset.label
      }
    }
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('图片读取失败，请换一张试试'))
      img.src = src
    })
  }

  function cropToDataUrl(img, view) {
    const scale = view.cover * view.zoom
    const sourceSize = view.stage / scale
    const sourceX = img.naturalWidth / 2 - sourceSize / 2 - view.dx / scale
    const sourceY = img.naturalHeight / 2 - sourceSize / 2 - view.dy / scale
    const sx = Math.max(0, Math.min(img.naturalWidth - sourceSize, sourceX))
    const sy = Math.max(0, Math.min(img.naturalHeight - sourceSize, sourceY))
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_OUTPUT_SIZE
    canvas.height = AVATAR_OUTPUT_SIZE
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法处理这张图片')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(
      img,
      sx,
      sy,
      sourceSize,
      sourceSize,
      0,
      0,
      AVATAR_OUTPUT_SIZE,
      AVATAR_OUTPUT_SIZE,
    )
    return canvas.toDataURL('image/jpeg', AVATAR_QUALITY)
  }

  async function openCropper(file) {
    if (!file || S.avatarBusy) return
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      toast('仅支持 PNG / JPEG / WebP 图片', 'error')
      return
    }
    if (file.size > MAX_AVATAR_SOURCE_BYTES) {
      toast('原图不能超过 15MB', 'error')
      return
    }

    let src
    let img
    try {
      src = await readFileAsDataUrl(file)
      img = await loadImage(src)
    } catch (err) {
      toast(err && err.message ? err.message : '图片读取失败，请换一张试试', 'error')
      return
    }
    if (!img.naturalWidth || !img.naturalHeight) {
      toast('图片尺寸异常，请换一张试试', 'error')
      return
    }
    if (img.naturalWidth < 64 || img.naturalHeight < 64) {
      toast('图片太小，请选择至少 64×64 的图片', 'error')
      return
    }

    const view = { zoom: 1, dx: 0, dy: 0, stage: 320, cover: 1, dragging: false }
    let stageEl = null
    let imgEl = null
    let zoomEl = null
    let confirmBtn = null

    const body = `<div class="me-crop" data-me-crop>
      <div class="me-crop-stage" data-me-crop-stage tabindex="0" role="application" aria-label="拖动图片调整裁剪位置，方向键微调，加减号缩放">
        <img data-me-crop-image alt="" draggable="false">
        <span class="me-crop-mask" aria-hidden="true"></span>
      </div>
      <label class="me-crop-zoom">缩放
        <input type="range" min="1" max="3" step="0.01" value="1" data-me-crop-zoom>
      </label>
      <p class="me-crop-note">拖动图片调整位置，圆形区域内的部分会作为头像。原图不会上传，只上传裁剪后的 ${AVATAR_OUTPUT_SIZE}×${AVATAR_OUTPUT_SIZE} JPEG；图片会经过 AI 安全检查。</p>
      <div class="me-form-error" data-me-crop-error role="alert"></div>
    </div>`

    function clampView() {
      const scale = view.cover * view.zoom
      const maxX = Math.max(0, (img.naturalWidth * scale - view.stage) / 2)
      const maxY = Math.max(0, (img.naturalHeight * scale - view.stage) / 2)
      view.dx = Math.max(-maxX, Math.min(maxX, view.dx))
      view.dy = Math.max(-maxY, Math.min(maxY, view.dy))
    }

    function renderView() {
      if (!imgEl) return
      const scale = view.cover * view.zoom
      imgEl.style.transform = `translate(-50%, -50%) translate(${view.dx}px, ${view.dy}px) scale(${scale})`
      if (zoomEl && Number(zoomEl.value) !== view.zoom) zoomEl.value = String(view.zoom)
    }

    function measure() {
      if (!stageEl) return
      view.stage = stageEl.clientWidth || 320
      view.cover = Math.max(view.stage / img.naturalWidth, view.stage / img.naturalHeight)
      clampView()
      renderView()
    }

    createModal({
      title: '裁剪头像',
      subtitle: '拖动图片调整位置，使用滑块缩放；圆形框内的部分会被保留。',
      body,
      footer:
        '<button type="button" class="me-btn" data-modal-cancel>取消</button><button type="button" class="me-btn me-primary" data-me-crop-confirm>裁剪并上传</button>',
      onMount(backdrop) {
        stageEl = backdrop.querySelector('[data-me-crop-stage]')
        imgEl = backdrop.querySelector('[data-me-crop-image]')
        zoomEl = backdrop.querySelector('[data-me-crop-zoom]')
        confirmBtn = backdrop.querySelector('[data-me-crop-confirm]')
        if (!stageEl || !imgEl || !zoomEl || !confirmBtn) return

        imgEl.src = src
        imgEl.style.width = `${img.naturalWidth}px`
        imgEl.style.height = `${img.naturalHeight}px`
        measure()

        let startX = 0
        let startY = 0
        let baseX = 0
        let baseY = 0
        stageEl.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return
          view.dragging = true
          startX = e.clientX
          startY = e.clientY
          baseX = view.dx
          baseY = view.dy
          stageEl.setPointerCapture(e.pointerId)
          stageEl.classList.add('is-dragging')
          e.preventDefault()
        })
        stageEl.addEventListener('pointermove', (e) => {
          if (!view.dragging) return
          view.dx = baseX + (e.clientX - startX)
          view.dy = baseY + (e.clientY - startY)
          clampView()
          renderView()
        })
        const endDrag = (e) => {
          if (!view.dragging) return
          view.dragging = false
          stageEl.classList.remove('is-dragging')
          try {
            stageEl.releasePointerCapture(e.pointerId)
          } catch {
            /* 指针可能已经释放 */
          }
        }
        stageEl.addEventListener('pointerup', endDrag)
        stageEl.addEventListener('pointercancel', endDrag)

        zoomEl.addEventListener('input', () => {
          view.zoom = Math.max(1, Math.min(3, Number(zoomEl.value) || 1))
          clampView()
          renderView()
        })
        stageEl.addEventListener(
          'wheel',
          (e) => {
            e.preventDefault()
            view.zoom = Math.max(1, Math.min(3, view.zoom + (e.deltaY < 0 ? 0.08 : -0.08)))
            clampView()
            renderView()
          },
          { passive: false },
        )
        stageEl.addEventListener('keydown', (e) => {
          const step = e.shiftKey ? 12 : 4
          let handled = true
          switch (e.key) {
            case 'ArrowLeft':
              view.dx -= step
              break
            case 'ArrowRight':
              view.dx += step
              break
            case 'ArrowUp':
              view.dy -= step
              break
            case 'ArrowDown':
              view.dy += step
              break
            case '+':
            case '=':
              view.zoom = Math.min(3, view.zoom + 0.08)
              break
            case '-':
              view.zoom = Math.max(1, view.zoom - 0.08)
              break
            default:
              handled = false
          }
          if (!handled) return
          e.preventDefault()
          clampView()
          renderView()
        })

        confirmBtn.addEventListener('click', async () => {
          if (confirmBtn.disabled) return
          confirmBtn.disabled = true
          confirmBtn.textContent = '处理中…'
          const errorEl = backdrop.querySelector('[data-me-crop-error]')
          try {
            const dataUrl = cropToDataUrl(img, view)
            closeModal()
            await uploadAvatarDataUrl(dataUrl)
          } catch (err) {
            if (errorEl) {
              errorEl.textContent = (err && err.message) || '裁剪失败，请换一张图片'
              errorEl.classList.add('show')
            }
            if (confirmBtn.isConnected) {
              confirmBtn.disabled = false
              confirmBtn.textContent = '裁剪并上传'
            }
          }
        })
      },
    })
  }

  async function uploadAvatarDataUrl(dataUrl) {
    const returnTarget = describePageFocus(document.activeElement)
    const approxBytes = Math.ceil((dataUrl.length * 3) / 4)
    if (approxBytes > MAX_AVATAR_BYTES) {
      toast('裁剪后的图片仍然太大，请换一张试试', 'error')
      return
    }
    S.avatarBusy = true
    setAvatarBusy(true)
    try {
      const res = await api('/api/auth/avatar', { method: 'POST', body: { image: dataUrl } })
      if (res.user) {
        S.me = res.user
        syncAuthUser(res.user)
      }
      if (root && S.mode === 'profile') {
        root.innerHTML = profileShell()
        toast('头像已更新')
        if (returnTarget && !modalEl) restorePageFocus(returnTarget)
      }
    } catch (err) {
      toast(err && err.message ? err.message : '头像上传失败，请稍后再试', 'error')
    } finally {
      S.avatarBusy = false
      setAvatarBusy(false)
    }
  }

  function askRemoveAvatar() {
    if (!S.me || !avatarUrlSafe(S.me.avatarUrl)) return
    openConfirm({
      title: '移除头像图片？',
      message: '移除后会恢复为底色 + 昵称首字的默认头像。',
      confirmText: '移除',
      onConfirm: async () => {
        const res = await api('/api/auth/avatar', { method: 'DELETE' })
        if (res.user) {
          S.me = res.user
          syncAuthUser(res.user)
        }
        if (root && S.mode === 'profile') {
          root.innerHTML = profileShell()
          toast('头像已移除')
        }
      },
    })
  }

  function askLogout() {
    openConfirm({
      title: '退出登录？',
      message: '退出后学习进度会从页面上隐藏，重新登录即可恢复。',
      confirmText: '退出',
      onConfirm: async () => {
        const store = authStore()
        if (store && typeof store.logout === 'function') await store.logout()
        else await api('/api/auth/logout', { method: 'POST' })
        toast('已退出登录')
        if (ctx.router) ctx.router.push('/')
      },
    })
  }

  // ── 作品操作 ───────────────────────────────────────────────
  async function publishWork(id) {
    if (!id || S.busy.has('pub:' + id)) return
    S.busy.add('pub:' + id)
    const button = root && Array.from(root.querySelectorAll('[data-act="publish"]')).find((el) => el.dataset.id === id)
    const returnTarget = describePageFocus(button || document.activeElement)
    if (button) {
      button.disabled = true
      button.setAttribute('aria-busy', 'true')
      button.dataset.label = button.innerHTML
      button.textContent = '发布中…'
    }
    try {
      await api(`/api/works/${encodeURIComponent(id)}/publish`, { method: 'POST' })
      toast('已发布到成果展厅')
      await loadWorks(true)
    } catch (err) {
      toast(err && err.message ? err.message : '发布失败，请稍后再试', 'error')
    } finally {
      S.busy.delete('pub:' + id)
      if (button && button.isConnected) {
        button.disabled = false
        button.removeAttribute('aria-busy')
        button.innerHTML = button.dataset.label || '发布到展厅'
      }
      if (returnTarget && !modalEl && !root?.contains(document.activeElement)) restorePageFocus(returnTarget)
    }
  }

  function askUnpublish(id) {
    const work = S.works.find((w) => w.id === id)
    if (!work) return
    openConfirm({
      title: '从展厅撤下？',
      message: `《${work.title}》会从成果展厅移除，但仍保留在个人作品中；重新发布后点赞数还在。`,
      confirmText: '撤下',
      onConfirm: async () => {
        await api(`/api/works/${encodeURIComponent(id)}/publish`, { method: 'DELETE' })
        toast('已从展厅撤下')
        await loadWorks(true)
      },
    })
  }

  function askDeleteWork(id) {
    const work = S.works.find((w) => w.id === id)
    if (!work) return
    openConfirm({
      title: '删除这份作品？',
      message: `《${work.title}》删除后无法恢复，插画文件也会一起删除。`,
      confirmText: '删除',
      danger: true,
      onConfirm: async () => {
        await api(`/api/works/${encodeURIComponent(id)}`, { method: 'DELETE' })
        toast('作品已删除')
        await loadWorks(true)
      },
    })
  }

  // ── 新建作品弹层 ───────────────────────────────────────────
  function openCreateModal() {
    const typeOptions = CREATE_TYPES.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('')
    const moduleOptions = MODULES.map(
      (m) => `<option value="${m.id}">${esc(m.code)} ${esc(m.name)}</option>`,
    ).join('')
    const gradeOptions = Object.entries(GRADES)
      .map(([key, label]) => `<option value="${key}">${esc(label)}</option>`)
      .join('')
    const body = `<form class="me-form" id="me-create-form" novalidate>
      <div class="me-field">
        <label for="me-new-title">作品标题</label>
        <input class="me-input" id="me-new-title" maxlength="120" autocomplete="off" placeholder="例如：《我的 AI 发现地图》" data-autofocus>
      </div>
      <div class="me-form-row">
        <div class="me-field">
          <label for="me-new-type">作品类型</label>
          <select class="me-input" id="me-new-type">${typeOptions}</select>
        </div>
        <div class="me-field">
          <label for="me-new-module">所属模块</label>
          <select class="me-input" id="me-new-module">${moduleOptions}</select>
        </div>
      </div>
      <div class="me-field">
        <label for="me-new-grade">学段</label>
        <select class="me-input" id="me-new-grade">${gradeOptions}</select>
      </div>
      <div class="me-field">
        <label for="me-new-desc">作品说明</label>
        <textarea class="me-input" id="me-new-desc" maxlength="1000" rows="4" placeholder="用几句话介绍这份作品"></textarea>
        <div class="me-form-note"><span>新作品先保存在个人作品库，需要手动发布到展厅</span><span data-me-charcount>0 / 1000</span></div>
      </div>
      <div class="me-form-error" data-me-error role="alert"></div>
    </form>`
    createModal({
      title: '新建作品',
      subtitle: '适合保存文字方案、观察记录等没有插画的内容；有插画的作品建议在互动训练里保存。',
      body,
      footer:
        '<button type="button" class="me-btn" data-modal-cancel>取消</button><button type="submit" form="me-create-form" class="me-btn me-primary" data-me-create-submit>保存到个人作品</button>',
      onMount(backdrop) {
        const form = backdrop.querySelector('#me-create-form')
        const desc = backdrop.querySelector('#me-new-desc')
        const count = backdrop.querySelector('[data-me-charcount]')
        if (desc && count) {
          desc.addEventListener('input', () => {
            count.textContent = `${desc.value.length} / 1000`
          })
        }
        if (form) {
          form.addEventListener('submit', (e) => {
            e.preventDefault()
            submitCreate(form, backdrop)
          })
        }
      },
    })
  }

  async function submitCreate(form, backdrop) {
    if (S.busy.has('create')) return
    const title = String((form.querySelector('#me-new-title') || {}).value || '').trim()
    if (!title) {
      formError(form, '给作品起个标题吧')
      const input = form.querySelector('#me-new-title')
      if (input) input.focus()
      return
    }
    const type = String((form.querySelector('#me-new-type') || {}).value || '')
    const module = String((form.querySelector('#me-new-module') || {}).value || '')
    const grade = String((form.querySelector('#me-new-grade') || {}).value || 'low')
    const desc = String((form.querySelector('#me-new-desc') || {}).value || '').trim()
    const hue = Math.floor(Math.random() * 360)

    S.busy.add('create')
    const btn = backdrop.querySelector('[data-me-create-submit]')
    if (btn) {
      btn.disabled = true
      btn.textContent = '保存中…'
    }
    formError(form, '')
    try {
      await api('/api/works', { method: 'POST', body: { title, type, module, grade, desc, hue } })
      if (modalEl === backdrop) closeModal()
      toast('已保存到个人作品')
      if (S.mode === 'works') {
        if (S.worksFilter === 'published') S.worksFilter = 'all'
        await loadWorks(true)
      }
    } catch (err) {
      if (modalEl === backdrop) formError(form, err && err.message ? err.message : '保存失败，请稍后再试')
    } finally {
      S.busy.delete('create')
      if (btn && btn.isConnected) {
        btn.disabled = false
        btn.textContent = '保存到个人作品'
      }
    }
  }

  // ── 弹层 / Toast ───────────────────────────────────────────
  function describePageFocus(element) {
    if (!root || !element || !root.contains(element)) return null
    return { id: element.id, act: element.getAttribute('data-act'), workId: element.getAttribute('data-id'), filter: element.getAttribute('data-filter'), formId: element.form?.id, type: element.type }
  }

  function restorePageFocus(target) {
    if (!root || !target) return
    const actions = Array.from(root.querySelectorAll('[data-act]'))
    const sameId = target.id && root.querySelector('#' + CSS.escape(target.id))
    const sameForm = target.formId && target.type === 'submit' && root.querySelector('#' + CSS.escape(target.formId) + ' button[type="submit"]')
    const sameAction = target.act && actions.find((el) => el.getAttribute('data-act') === target.act && el.getAttribute('data-id') === target.workId && el.getAttribute('data-filter') === target.filter)
    const sameWork = target.workId && actions.find((el) => el.getAttribute('data-id') === target.workId)
    const fallback = S.mode === 'works' ? root.querySelector('[role="tab"][aria-selected="true"]') : root.querySelector('[data-act="avatar-choose"],#me-profile-form button[type="submit"]')
    const element = sameId || sameForm || sameAction || sameWork || fallback
    if (element && !element.disabled) element.focus({ preventScroll: true })
  }

  function createModal({ title, subtitle, body, footer, onMount }) {
    const returnFocus = modalEl ? modalReturnFocus : document.activeElement
    const returnTarget = modalEl ? modalReturnTarget : describePageFocus(returnFocus)
    closeModal(false)
    modalReturnFocus = returnFocus
    modalReturnTarget = returnTarget
    const backdrop = document.createElement('div')
    backdrop.className = 'me-modal-backdrop'
    backdrop.innerHTML = `<div class="me-modal" role="dialog" aria-modal="true" aria-labelledby="me-modal-title" tabindex="-1">
      <div class="me-modal-head">
        <div><h2 id="me-modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button type="button" class="me-icon-btn" data-modal-cancel aria-label="关闭">${svgIcon('close')}</button>
      </div>
      ${body}
      <div class="me-modal-foot">${footer || '<button type="button" class="me-btn" data-modal-cancel>关闭</button>'}</div>
    </div>`
    document.body.appendChild(backdrop)
    modalEl = backdrop
    const background = Array.from(document.body.children).filter((el) => el !== backdrop && el !== toastEl && el instanceof HTMLElement).map((el) => [el, el.inert])
    const overflow = document.body.style.overflow
    background.forEach(([el]) => { el.inert = true })
    document.body.style.overflow = 'hidden'
    modalCleanup = () => {
      background.forEach(([el, inert]) => { el.inert = inert })
      document.body.style.overflow = overflow
    }
    backdrop.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target : null
      if (!target) return
      if (target.closest('[data-modal-cancel]') || target === backdrop) closeModal()
    })
    modalKeyHandler = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeModal()
        return
      }
      if (e.key === 'Tab') trapTab(e)
    }
    document.addEventListener('keydown', modalKeyHandler, true)
    try {
      if (onMount) onMount(backdrop)
    } catch (err) {
      console.warn('[me-studio] 弹层初始化失败', err)
    }
    const focusable =
      backdrop.querySelector('[data-autofocus]') ||
      modalFocusables()[0] || backdrop.querySelector('[role="dialog"]')
    if (focusable) focusable.focus()
    return backdrop
  }

  function modalFocusables() {
    return modalEl ? Array.from(
      modalEl.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => el.getClientRects().length && el.tabIndex >= 0 && !el.disabled) : []
  }

  function trapTab(e) {
    if (!modalEl) return
    const items = modalFocusables()
    if (!items.length) {
      e.preventDefault()
      modalEl.querySelector('[role="dialog"]').focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    if (!items.includes(document.activeElement)) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  function closeModal(restoreFocus = true) {
    if (!modalEl) return
    document.removeEventListener('keydown', modalKeyHandler, true)
    modalKeyHandler = null
    const el = modalEl
    modalEl = null
    if (modalCleanup) modalCleanup()
    modalCleanup = null
    el.remove()
    if (restoreFocus && modalReturnFocus && document.contains(modalReturnFocus)) {
      try {
        modalReturnFocus.focus({ preventScroll: true })
      } catch {
        /* 元素可能已随重渲染消失 */
      }
    } else if (restoreFocus) {
      restorePageFocus(modalReturnTarget)
    }
    modalReturnFocus = null
    modalReturnTarget = null
  }

  function openConfirm({ title, message, confirmText, danger, onConfirm }) {
    const backdrop = createModal({
      title,
      body: `<p class="me-confirm-text">${esc(message)}</p><div class="me-form-error" data-me-error role="alert"></div>`,
      footer:
        `<button type="button" class="me-btn" data-modal-cancel>取消</button><button type="button" class="me-btn ${danger ? 'me-danger-solid' : 'me-primary'}" data-me-confirm>${esc(confirmText || '确定')}</button>`,
    })
    const btn = backdrop.querySelector('[data-me-confirm]')
    if (!btn) return
    btn.addEventListener('click', async () => {
      if (btn.disabled) return
      btn.disabled = true
      btn.dataset.label = btn.textContent
      btn.textContent = '处理中…'
      try {
        await onConfirm()
        if (modalEl === backdrop) closeModal()
      } catch (err) {
        if (modalEl !== backdrop) return
        const el = backdrop.querySelector('[data-me-error]')
        if (el) {
          el.textContent = (err && err.message) || '操作失败，请稍后再试'
          el.classList.add('show')
        }
        btn.disabled = false
        btn.textContent = btn.dataset.label || '确定'
      }
    })
  }

  function toast(msg, kind = 'info') {
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.className = 'me-toast'
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

  // ── 颜色预览 ───────────────────────────────────────────────
  function applyHue(hue) {
    const h = clampHue(hue)
    const range = root && root.querySelector('#me-hue')
    if (range) range.value = String(h)
    const label = root && root.querySelector('[data-me-hue-value]')
    if (label) label.textContent = `${h}°`
    const avatar = root && root.querySelector('[data-me-avatar]')
    if (avatar && S.me && !avatarUrlSafe(S.me.avatarUrl)) {
      avatar.style.background = `linear-gradient(135deg, hsl(${h} 82% 62%), hsl(${(h + 42) % 360} 78% 56%))`
    }
    if (root && S.me) S.me.avatarHue = h
    root &&
      root.querySelectorAll('.me-swatch').forEach((el) => {
        const on = Number(el.getAttribute('data-hue')) === h
        el.classList.toggle('is-active', on)
        el.setAttribute('aria-pressed', on ? 'true' : 'false')
      })
  }

  // ── 事件 ───────────────────────────────────────────────────
  function onKeyDown(e) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const tab = e.target instanceof Element ? e.target.closest('[role="tab"][data-act="filter"]') : null
    if (!tab || !root || !root.contains(tab)) return
    const tabs = Array.from(root.querySelectorAll('.me-tabs [role="tab"]'))
    const index = tabs.indexOf(tab)
    if (index < 0) return
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    tabs[next].click()
    tabs[next].focus()
  }

  function onClick(e) {
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    const btn = target.closest('[data-act]')
    if (!btn || !root || !root.contains(btn)) return
    const act = btn.getAttribute('data-act')
    const id = btn.getAttribute('data-id') || ''
    switch (act) {
      case 'avatar-choose': {
        e.preventDefault()
        const input = root.querySelector('#me-avatar-file')
        if (input) input.click()
        break
      }
      case 'avatar-remove':
        e.preventDefault()
        askRemoveAvatar()
        break
      case 'hue':
        e.preventDefault()
        applyHue(btn.getAttribute('data-hue'))
        break
      case 'logout':
        e.preventDefault()
        askLogout()
        break
      case 'retry-profile':
        e.preventDefault()
        loadProfile()
        break
      case 'retry-works':
        e.preventDefault()
        loadWorks(true)
        break
      case 'filter': {
        e.preventDefault()
        const filter = btn.getAttribute('data-filter') || 'all'
        if (filter === S.worksFilter) return
        S.worksFilter = filter
        updateWorkChrome()
        loadWorks(true)
        break
      }
      case 'new-work':
        e.preventDefault()
        openCreateModal()
        break
      case 'publish':
        e.preventDefault()
        publishWork(id)
        break
      case 'unpublish':
        e.preventDefault()
        askUnpublish(id)
        break
      case 'del':
        e.preventDefault()
        askDeleteWork(id)
        break
      case 'more':
        e.preventDefault()
        loadWorks(false)
        break
      default:
        break
    }
  }

  function onChange(e) {
    const target = e.target
    if (target && target.id === 'me-avatar-file') {
      const file = target.files && target.files[0]
      // 先取出 File 再清空 value，否则同一张图第二次选择不会触发 change
      if (file) openCropper(file)
      target.value = ''
    }
  }

  function onInput(e) {
    const target = e.target
    if (!target) return
    if (target.id === 'me-hue') applyHue(target.value)
    if (target.id === 'me-nickname') {
      const count = root && root.querySelector('[data-me-nick-count]')
      if (count) count.textContent = `${target.value.length} / 20`
    }
  }

  function onSubmit(e) {
    const form = e.target
    if (!(form instanceof HTMLFormElement)) return
    if (form.id === 'me-profile-form') {
      e.preventDefault()
      saveProfile(form)
    } else if (form.id === 'me-password-form') {
      e.preventDefault()
      savePassword(form)
    }
  }

  // ── 挂载 / 卸载 ────────────────────────────────────────────
  let styleEl = null
  function ensureStyle() {
    if (styleEl && document.head.contains(styleEl)) return
    styleEl = document.getElementById('me-studio-style')
    if (styleEl) return
    styleEl = document.createElement('style')
    styleEl.id = 'me-studio-style'
    styleEl.textContent = CSS_TEXT
    document.head.appendChild(styleEl)
  }

  function mountPage(vm, mode) {
    ensureStyle()
    const host = (vm.$el && vm.$el.parentNode) || document.querySelector('main') || document.body
    root = document.createElement('div')
    root.className = 'me-page'
    root.setAttribute('data-me-root', '')
    if (vm.$el && vm.$el.parentNode === host) host.insertBefore(root, vm.$el)
    else host.appendChild(root)
    listeners.click = onClick
    listeners.change = onChange
    listeners.input = onInput
    listeners.submit = onSubmit
    listeners.keydown = onKeyDown
    root.addEventListener('click', listeners.click)
    root.addEventListener('change', listeners.change)
    root.addEventListener('input', listeners.input)
    root.addEventListener('submit', listeners.submit)
    root.addEventListener('keydown', listeners.keydown)
    resetState(mode)
    window.scrollTo(0, 0)
    if (mode === 'works') mountWorks()
    else loadProfile()
  }

  function unmountPage() {
    worksSeq++
    closeModal(false)
    hideToast()
    if (root) {
      root.removeEventListener('click', listeners.click)
      root.removeEventListener('change', listeners.change)
      root.removeEventListener('input', listeners.input)
      root.removeEventListener('submit', listeners.submit)
      root.removeEventListener('keydown', listeners.keydown)
      root.remove()
      root = null
    }
  }

  const ProfileComponent = {
    name: 'MeStudioProfile',
    mounted() {
      mountPage(this, 'profile')
    },
    beforeUnmount() {
      unmountPage()
    },
    render() {
      return null
    },
  }

  const WorksComponent = {
    name: 'MeStudioWorks',
    mounted() {
      mountPage(this, 'works')
    },
    beforeUnmount() {
      unmountPage()
    },
    render() {
      return null
    },
  }

  // ── 启动：新增 /me 与 /me/works ───────────────────────────
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
    try {
      ctx.pinia = app.config.globalProperties.$pinia || null
    } catch {
      ctx.pinia = null
    }

    if (router.hasRoute('me')) router.removeRoute('me')
    if (router.hasRoute('me-works')) router.removeRoute('me-works')
    router.addRoute({
      path: '/me',
      name: 'me',
      component: ProfileComponent,
      meta: { title: '我的', requiresAuth: true },
    })
    router.addRoute({
      path: '/me/works',
      name: 'me-works',
      component: WorksComponent,
      meta: { title: '我的作品', requiresAuth: true },
    })

    try {
      await router.isReady()
    } catch {
      /* isReady 只在启动错误时 reject */
    }

    // 深链接：以地址栏 hash 为准（初始导航发生在路由注册之前）。
    const raw = INITIAL_HASH.replace(/^#/, '')
    const qAt = raw.indexOf('?')
    const rawPath = qAt >= 0 ? raw.slice(0, qAt) : raw
    if (!(rawPath === '/me' || rawPath === '/me/works')) return
    const query = Object.fromEntries(new URLSearchParams(qAt >= 0 ? raw.slice(qAt + 1) : ''))
    const cur = router.currentRoute.value
    const ours = cur.matched.some(
      (r) =>
        r.components &&
        (r.components.default === ProfileComponent || r.components.default === WorksComponent),
    )
    if (!ours || cur.path !== rawPath) {
      try {
        await router.replace({ path: rawPath, query, force: true })
      } catch {
        /* 守卫重定向属于正常结果 */
      }
    }
  }

  boot().catch((err) => {
    console.warn('[me-studio] 启动失败，继续使用原页面', err)
  })

  // ── 样式 ───────────────────────────────────────────────────
  const CSS_TEXT = `
.me-page,.me-modal-backdrop,.me-toast{
  --me-accent:var(--aiq-accent,#3559f6);
  --me-border:var(--aiq-border,#e4e8f2);
  --me-card:var(--aiq-panel-solid,#fff);
  --me-soft:var(--aiq-bg-soft,#f2f5fc);
  --me-text:var(--aiq-text,#1f2937);
  --me-soft-text:var(--aiq-text-soft,#475569);
  --me-mute:var(--aiq-text-mute,#64748b);
  --me-danger:#dc2626;
  --me-ok:#059669;
}
.me-page{color:var(--me-text);padding-bottom:64px}
.me-container{width:min(1200px,calc(100% - 48px));margin:0 auto;padding:40px 0 24px}
.me-head{margin-bottom:22px}
.me-tag{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 12px;font-size:12px;font-weight:600;background:rgba(53,89,246,.1);color:var(--me-accent);margin-bottom:12px}
.me-tag .me-i{font-size:13px}
.me-title{font-size:26px;line-height:1.25;font-weight:700;letter-spacing:-.01em;margin:0}
.me-grad{background:linear-gradient(100deg,#4f7cff,#a855f7 45%,#14b8a6);-webkit-background-clip:text;background-clip:text;color:transparent}
.me-sub{margin-top:10px;max-width:52rem;font-size:14px;line-height:1.7;color:var(--me-soft-text)}
.me-i{width:1em;height:1em;display:inline-block;vertical-align:-.14em;flex:none}
.me-muted{color:var(--me-mute);font-weight:500}
.me-card{background:var(--me-card);border:1px solid var(--me-border);border-radius:20px;padding:24px;box-shadow:0 12px 30px -24px rgba(15,23,42,.35)}
.me-card-head{margin-bottom:16px}
.me-card-head h2{font-size:16px;font-weight:700;margin:0}
.me-card-head p{margin:6px 0 0;font-size:12.5px;line-height:1.7;color:var(--me-mute)}

/* 头部卡片 */
.me-hero{display:flex;align-items:center;gap:24px;margin-bottom:20px}
.me-avatar-col{display:flex;flex-direction:column;align-items:center;gap:10px;flex:none}
.me-avatar{display:grid;place-items:center;border-radius:50%;background-size:cover;background-position:center;color:#fff;font-weight:700;flex:none;box-shadow:inset 0 0 0 2px rgba(255,255,255,.18),0 14px 28px -16px rgba(15,23,42,.5);overflow:hidden;line-height:1}
.me-avatar.xl{width:92px;height:92px;font-size:36px}
.me-avatar-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:center}
.me-avatar-hint{font-size:11px;color:var(--me-mute);text-align:center;line-height:1.5}

/* 头像裁剪 */
.me-crop{display:flex;flex-direction:column;align-items:center;gap:14px;margin-top:16px}
.me-crop-stage{position:relative;width:min(320px,100%);aspect-ratio:1;border-radius:16px;overflow:hidden;background:#0f172a;cursor:grab;touch-action:none;user-select:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.me-crop-stage.is-dragging{cursor:grabbing}
.me-crop-stage:focus-visible{outline:2px solid var(--me-accent);outline-offset:2px}
.me-crop-stage img{position:absolute;left:50%;top:50%;max-width:none;transform-origin:50% 50%;user-select:none;pointer-events:none;will-change:transform}
.me-crop-mask{position:absolute;inset:0;border-radius:50%;box-shadow:0 0 0 999px rgba(8,13,26,.62);border:2px solid rgba(255,255,255,.9);pointer-events:none}
.me-crop-zoom{display:flex;align-items:center;gap:10px;width:min(320px,100%);font-size:12.5px;font-weight:600;color:var(--me-soft-text)}
.me-crop-zoom input{flex:1;accent-color:var(--me-accent);cursor:pointer}
.me-crop-note{margin:0;max-width:360px;font-size:11.5px;line-height:1.65;color:var(--me-mute);text-align:center}
.me-hero-info{min-width:0;flex:1}
.me-hero-info h2{font-size:22px;font-weight:700;margin:0;overflow-wrap:anywhere}
.me-email{margin:5px 0 0;font-size:13px;color:var(--me-mute);overflow-wrap:anywhere}
.me-stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
.me-stat{display:flex;align-items:baseline;gap:6px;padding:6px 12px;border-radius:10px;background:var(--me-soft);border:1px solid var(--me-border)}
.me-stat b{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.me-stat span{font-size:11.5px;color:var(--me-mute)}
.me-hero-cta{flex:none}

/* 两栏 */
.me-columns{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,.95fr);gap:20px;align-items:start}
.me-col{display:flex;flex-direction:column;gap:20px;min-width:0}

/* 表单 */
.me-form{display:flex;flex-direction:column;gap:15px}
.me-form-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.me-field{display:flex;flex-direction:column;min-width:0}
.me-field>label{font-size:12.5px;font-weight:600;color:var(--me-soft-text);margin-bottom:6px}
.me-input{box-sizing:border-box;width:100%;border:1px solid var(--me-border);background:var(--me-card);color:var(--me-text);border-radius:10px;padding:9px 12px;font-size:13.5px;font-family:inherit;outline:none;transition:border-color .2s ease,box-shadow .2s ease}
.me-input:focus{border-color:var(--me-accent);box-shadow:0 0 0 3px rgba(53,89,246,.13)}
select.me-input{appearance:none;-webkit-appearance:none;height:38px;padding-right:34px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 12px center;cursor:pointer}
textarea.me-input{min-height:92px;resize:vertical;line-height:1.65}
.me-form-note{display:flex;justify-content:space-between;gap:10px;margin-top:5px;font-size:11px;color:var(--me-mute)}
.me-form-error{display:none;font-size:12.5px;line-height:1.6;color:var(--me-danger);padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.08)}
.me-form-error.show{display:block}
.me-form-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.me-hint{margin:8px 0 0;font-size:11.5px;line-height:1.6;color:var(--me-mute)}
.me-range{width:100%;accent-color:var(--me-accent);cursor:pointer}
.me-swatches{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.me-swatch{width:24px;height:24px;border-radius:50%;border:2px solid transparent;background:var(--sw);cursor:pointer;box-shadow:inset 0 0 0 1px rgba(15,23,42,.12);transition:transform .15s ease,box-shadow .15s ease}
.me-swatch:hover{transform:scale(1.1)}
.me-swatch.is-active{box-shadow:0 0 0 3px var(--me-card),0 0 0 5px var(--me-accent)}

/* 按钮 */
.me-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:38px;padding:0 16px;border-radius:10px;border:1px solid var(--me-border);background:var(--me-card);color:var(--me-text);font-size:13.5px;font-weight:600;font-family:inherit;cursor:pointer;text-decoration:none;white-space:nowrap;transition:border-color .2s ease,color .2s ease,transform .15s ease,box-shadow .2s ease}
.me-btn:hover{border-color:var(--me-accent);color:var(--me-accent)}
.me-btn.me-primary{background:linear-gradient(135deg,#4f7cff,#a855f7);color:#fff;border-color:transparent;box-shadow:0 10px 22px -12px rgba(79,124,255,.75)}
.me-btn.me-primary:hover{color:#fff;filter:brightness(1.05)}
.me-btn.me-ghost{background:transparent}
.me-btn.me-danger{color:var(--me-danger);border-color:rgba(220,38,38,.28)}
.me-btn.me-danger:hover{border-color:var(--me-danger);color:var(--me-danger)}
.me-btn.me-danger-solid{background:var(--me-danger);border-color:var(--me-danger);color:#fff}
.me-btn.me-danger-solid:hover{filter:brightness(1.06);color:#fff}
.me-btn.me-sm{height:32px;padding:0 10px;font-size:12.5px;border-radius:9px}
.me-btn[disabled]{opacity:.55;cursor:not-allowed;transform:none!important}
.me-icon-btn{display:grid;place-items:center;width:32px;height:32px;border-radius:9px;border:1px solid var(--me-border);background:var(--me-card);color:var(--me-mute);cursor:pointer;transition:color .2s ease,border-color .2s ease}
.me-icon-btn:hover{color:var(--me-text);border-color:var(--me-accent)}

/* 快捷入口 */
.me-links{display:flex;flex-direction:column;gap:8px}
.me-link{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:12px;border:1px solid transparent;color:var(--me-text);text-decoration:none;transition:background .2s ease,border-color .2s ease}
.me-link:hover{background:var(--me-soft);border-color:var(--me-border)}
.me-link>span:nth-child(2){display:flex;flex-direction:column;min-width:0;flex:1}
.me-link b{font-size:13.5px;font-weight:600}
.me-link small{font-size:11.5px;color:var(--me-mute);margin-top:2px}
.me-link>svg{color:var(--me-mute);font-size:15px}
.me-link-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--me-soft);color:var(--me-accent);font-size:17px;flex:none}
.me-logout-row{justify-content:flex-start;margin-top:16px}

/* 面包屑 / 工具栏 */
.me-crumb{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--me-mute);margin-bottom:14px}
.me-crumb a{color:var(--me-soft-text);text-decoration:none;font-weight:600}
.me-crumb a:hover{color:var(--me-accent)}
.me-toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:18px}
.me-tabs{display:inline-flex;background:var(--me-soft);border:1px solid var(--me-border);padding:3px;border-radius:12px;gap:2px}
.me-tab{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 13px;border:0;background:transparent;border-radius:9px;font-size:13px;font-weight:600;font-family:inherit;color:var(--me-mute);cursor:pointer;transition:background .2s ease,color .2s ease,box-shadow .2s ease}
.me-tab:hover{color:var(--me-text)}
.me-tab[aria-selected="true"]{background:var(--me-card);color:var(--me-text);box-shadow:0 1px 4px rgba(15,23,42,.14)}
.me-tab-num{font-size:11px;font-weight:700;color:var(--me-mute);background:var(--me-soft);border-radius:999px;padding:1px 6px;min-width:18px;text-align:center}
.me-tab[aria-selected="true"] .me-tab-num{background:rgba(53,89,246,.12);color:var(--me-accent)}
.me-count{font-size:12.5px;color:var(--me-mute)}
.me-toolbar-actions{margin-left:auto;display:flex;align-items:center;gap:10px;flex-wrap:wrap}

/* 作品卡片 */
.me-works{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:18px}
.me-work-card{display:flex;flex-direction:column;background:var(--me-card);border:1px solid var(--me-border);border-radius:16px;overflow:hidden;transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease;min-width:0}
.me-work-card:hover{transform:translateY(-2px);border-color:var(--me-tint,var(--me-accent));box-shadow:0 18px 34px -24px rgba(15,23,42,.55)}
.me-work-cover{position:relative;display:block;aspect-ratio:4/3;background:radial-gradient(120% 120% at 15% 0%,var(--me-tint-a,rgba(79,124,255,.16)),transparent 55%),linear-gradient(135deg,var(--me-hue,rgba(79,124,255,.12)),var(--me-tint-b,rgba(79,124,255,.05))),var(--me-soft);overflow:hidden;text-decoration:none}
.me-work-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.me-work-art{position:absolute;inset:0;display:grid;place-items:center;color:var(--me-tint,var(--me-accent));font-size:64px}
.me-work-art .me-i{width:1em;height:1em}
.me-badge{position:absolute;left:10px;top:10px;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:.02em;backdrop-filter:blur(4px)}
.me-badge.is-pub{background:rgba(5,150,105,.14);color:#047857;border:1px solid rgba(5,150,105,.25)}
.me-badge.is-draft{background:rgba(180,83,9,.12);color:#b45309;border:1px solid rgba(180,83,9,.22)}
.me-work-hover{position:absolute;right:10px;bottom:10px;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:rgba(15,23,42,.55);color:#fff;font-size:14px;opacity:0;transform:translateX(4px);transition:opacity .2s ease,transform .2s ease}
.me-work-card:hover .me-work-hover{opacity:1;transform:none}
.me-work-body{padding:14px 16px 16px;display:flex;flex-direction:column;gap:6px;flex:1;min-width:0}
.me-work-body h3{margin:0;font-size:14.5px;line-height:1.45;font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.me-work-body h3 a{color:var(--me-text);text-decoration:none}
.me-work-body h3 a:hover{color:var(--me-accent)}
.me-work-meta{margin:0;font-size:11.5px;color:var(--me-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.me-work-desc{margin:0;font-size:12px;line-height:1.65;color:var(--me-soft-text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.me-work-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;color:var(--me-mute);margin-top:2px}
.me-work-likes{display:inline-flex;align-items:center;gap:4px}
.me-work-likes .me-i{font-size:12px;color:#ef4444}
.me-work-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:10px;margin-top:auto;border-top:1px solid var(--me-border)}
.me-work-del{margin-left:auto;width:32px;padding:0}

/* 空态 / 登录提示 / 骨架 */
.me-login,.me-empty{padding:56px 24px;text-align:center;border:1px dashed var(--me-border);border-radius:20px;background:var(--me-card)}
.me-empty-wide{grid-column:1/-1}
.me-empty-icon{display:grid;place-items:center;width:58px;height:58px;border-radius:16px;background:var(--me-soft);color:var(--me-mute);font-size:27px;margin:0 auto 14px}
.me-login h1,.me-empty h2{font-size:18px;font-weight:700;margin:0 0 8px}
.me-login p,.me-empty p{max-width:34rem;margin:0 auto 18px;font-size:13px;line-height:1.75;color:var(--me-mute)}
.me-empty-actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
.me-more{display:flex;justify-content:center;margin-top:22px}
.me-skel{pointer-events:none}
.me-skel-head{display:flex;flex-direction:column;gap:10px;margin-bottom:22px}
.me-skel-line{display:block;width:100%;height:10px;border-radius:6px;background:linear-gradient(90deg,var(--me-soft) 25%,var(--me-border) 37%,var(--me-soft) 63%);background-size:400% 100%;animation:me-shimmer 1.4s ease infinite}
.me-skel-line.tall{height:18px}
.me-skel-line.w30{width:30%}
.me-skel-line.w40{width:40%}
.me-skel-line.w60{width:60%}
.me-skel-line.w70{width:70%}
.me-skel-line.w80{width:80%}
.me-skel-circle{display:block;width:92px;height:92px;border-radius:50%;background:var(--me-soft);flex:none}
.me-skel-lines{display:flex;flex-direction:column;gap:10px;flex:1;min-width:180px}
.me-skel-cover{aspect-ratio:4/3;background:linear-gradient(90deg,var(--me-soft) 25%,var(--me-border) 37%,var(--me-soft) 63%);background-size:400% 100%;animation:me-shimmer 1.4s ease infinite}
@keyframes me-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}

/* Toast */
.me-toast{position:fixed;left:50%;bottom:32px;z-index:150;max-width:min(90vw,480px);padding:10px 16px;border-radius:999px;background:#0f172a;color:#fff;font-size:13px;line-height:1.5;text-align:center;opacity:0;pointer-events:none;transform:translate(-50%,16px);transition:opacity .2s ease,transform .2s ease;box-shadow:0 18px 40px -18px rgba(15,23,42,.7)}
.me-toast.show{opacity:1;transform:translate(-50%,0)}
.me-toast.warn{background:#b45309}
.me-toast.error{background:#b91c1c}

/* 弹层 */
.me-modal-backdrop{position:fixed;inset:0;z-index:140;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(10,16,32,.5);backdrop-filter:blur(3px)}
.me-modal{width:min(560px,100%);max-height:min(86vh,720px);overflow:auto;background:var(--me-card);color:var(--me-text);border:1px solid var(--me-border);border-radius:20px;padding:24px;box-shadow:0 30px 80px -30px rgba(15,23,42,.6)}
.me-modal-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:6px}
.me-modal-head h2{font-size:18px;font-weight:700;margin:0}
.me-modal-head p{font-size:12.5px;line-height:1.65;color:var(--me-mute);margin:6px 0 0}
.me-modal-head .me-icon-btn{margin-left:auto;flex:none}
.me-modal-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;flex-wrap:wrap}
.me-confirm-text{margin:14px 0 0;font-size:13.5px;line-height:1.8;color:var(--me-soft-text);overflow-wrap:anywhere}

/* 焦点 */
.me-page a:focus-visible,.me-page button:focus-visible,.me-page input:focus-visible,
.me-page select:focus-visible,.me-page textarea:focus-visible,
.me-modal-backdrop a:focus-visible,.me-modal-backdrop button:focus-visible,
.me-modal-backdrop input:focus-visible,.me-modal-backdrop select:focus-visible,
.me-modal-backdrop textarea:focus-visible{outline:2px solid var(--me-accent);outline-offset:2px}

/* 移动端 */
@media(max-width:960px){
  .me-columns{grid-template-columns:minmax(0,1fr)}
}
@media(max-width:640px){
  .me-container{width:calc(100% - 32px);padding-top:28px}
  .me-title{font-size:23px}
  .me-hero{flex-direction:column;align-items:flex-start;padding:20px}
  .me-avatar-col{align-self:center}
  .me-hero-cta{width:100%}
  .me-toolbar{gap:10px}
  .me-count{order:3;flex-basis:100%}
  .me-toolbar-actions{margin-left:0;flex:1 1 100%;justify-content:flex-end}
  .me-tabs{width:100%;justify-content:space-between}
  .me-tab{flex:1;justify-content:center}
  .me-form-row{grid-template-columns:minmax(0,1fr)}
  .me-card{padding:20px}
  .me-works{grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px}
  .me-modal{padding:20px}
  .me-work-actions{gap:6px}
}
@media(prefers-reduced-motion:reduce){
  .me-btn,.me-work-card,.me-link,.me-work-hover,.me-toast,.me-swatch{transition:none}
  .me-work-card:hover{transform:none}
  .me-skel-line,.me-skel-cover{animation:none}
}
`
})()
