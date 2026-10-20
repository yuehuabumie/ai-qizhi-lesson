/**
 * 「AI 课文绘本」创作台 —— 运行时替换 /lab/storybook 的原页面。
 *
 * 服务器上只有 Vite 构建产物，没有前端源码（见 HANDOFF §5），所以这里不经过
 * Vue 组件编译，而是：
 *   1. 等 app 挂载后，用 $router.addRoute 注册一个更高优先级的静态路由；
 *   2. 组件 render() 返回 null，在 $el（注释占位节点）前插入自己的 DOM；
 *   3. 全部交互用原生 DOM 完成，样式走站点 CSS 变量，自动跟随明暗主题。
 *
 * 产品流程刻意是三段式：编排 → 生成 → 审查 → 保存到个人作品。
 * 没有生成过插画、或描述改过而插画还是旧的，都不允许提交。
 */
;(() => {
  'use strict'

  if (window.__AIQ_SBK_STUDIO__) return
  window.__AIQ_SBK_STUDIO__ = true

  // 本模块在入口 bundle 之前加载：此时 hash 还是学生拿到的原始深链接。
  // 入口的 catch-all 随后会把它改写成 /，所以必须第一时间记下来。
  const INITIAL_HASH = window.location.hash

  // ── 数据（与旧绘本组件一致）────────────────────────────────
  const POEMS = [
    {
      name: '静夜思',
      who: ['李白', '月亮'],
      where: ['窗前', '院子里', '床边'],
      doing: ['抬头望月亮', '低头思念家乡'],
      mood: ['思念', '安静'],
      scene: '夜晚',
    },
    {
      name: '咏鹅',
      who: ['大白鹅', '鹅宝宝'],
      where: ['池塘里', '小河边'],
      doing: ['弯着脖子唱歌', '划水游泳'],
      mood: ['快乐', '神气'],
      scene: '池塘',
    },
    {
      name: '小蝌蚪找妈妈',
      who: ['小蝌蚪', '青蛙妈妈'],
      where: ['池塘里', '荷叶下'],
      doing: ['游来游去找妈妈', '遇到鲤鱼阿姨'],
      mood: ['着急', '开心'],
      scene: '池塘',
    },
    {
      name: '春晓',
      who: ['小鸟', '诗人'],
      where: ['春天的早晨', '窗外的树枝上'],
      doing: ['叽叽喳喳叫', '醒来发现天亮了'],
      mood: ['舒服', '快乐'],
      scene: '春天',
    },
    {
      name: '悯农',
      who: ['农民伯伯', '禾苗'],
      where: ['田里', '正午的田野'],
      doing: ['弯腰锄草', '流汗劳作'],
      mood: ['辛苦', '认真'],
      scene: '田野',
    },
  ]

  const COLORS = ['白色', '绿色', '蓝色', '金色', '红色', '粉色', '彩色']
  const MOODS = ['思念', '安静', '快乐', '神气', '着急', '舒服', '辛苦', '认真']
  const EMOJI = {
    李白: '🧑',
    月亮: '🌙',
    大白鹅: '🦢',
    鹅宝宝: '🦆',
    小蝌蚪: '🐸',
    青蛙妈妈: '🐸',
    小鸟: '🐦',
    诗人: '🧑',
    农民伯伯: '👨‍🌾',
    禾苗: '🌱',
  }
  const MOOD_PALETTE = {
    思念: ['#1e3a8a', '#4c1d95'],
    安静: ['#90caf9', '#e3f2fd'],
    快乐: ['#ffe082', '#a5d6a7'],
    神气: ['#ffd54f', '#ffb74d'],
    着急: ['#ffcc80', '#ffe0b2'],
    舒服: ['#b3e5fc', '#fff9c4'],
    辛苦: ['#ffab91', '#ffe0b2'],
    认真: ['#c5cae9', '#e8eaf6'],
  }
  const MAX_PAGES = 8
  const BATCH = 4
  const STEPS = [
    { title: '编排故事', desc: '选课文，写五要素' },
    { title: '生成插画', desc: 'AI 逐页绘制' },
    { title: '审查保存', desc: '检查成书，存到我的作品' },
  ]

  // ── 工具 ───────────────────────────────────────────────────
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })

  const safeImg = (u) => {
    if (typeof u !== 'string' || !u) return ''
    if (
      u.startsWith('data:image/png;base64,') ||
      u.startsWith('data:image/jpeg;base64,') ||
      u.startsWith('data:image/webp;base64,')
    ) {
      return u
    }
    if (/^https:\/\//.test(u)) return u
    // 学生重新打开已提交的作业时，插画已经是本站落盘路径
    if (/^\/uploads\/works\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(u)) return u
    // 线上上游实际返回 https；http 图片在 https 页面会被混合内容拦截，直接丢弃
    return ''
  }

  // 线条图标与站点的 Element Plus 图标同一路数（24 视框、圆头描边），不用 emoji 当控件图标
  const ICONS = {
    notebook:
      '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h6M9 15h3"/><path d="M5 7H3M5 12H3M5 17H3"/>',
    sparkles:
      '<path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7L12 3.5z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
    book: '<path d="M12 5.5C10 4.2 7.6 3.5 5 3.5v15c2.6 0 5 .7 7 2 2-1.3 4.4-2 7-2v-15c-2.6 0-5 .7-7 2z"/><path d="M12 5.5v15"/>',
    film: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7.5 6v12M16.5 6v12"/><path d="M11 9.5h2M11 14.5h2"/>',
    pencil: '<path d="M4.5 19.5l4.3-.9L19 8.4a2.1 2.1 0 0 0-3-3L5.4 15.2l-.9 4.3z"/><path d="M13.5 7.5l3 3"/>',
    printer:
      '<path d="M7 8V3.5h10V8"/><rect x="3.5" y="8" width="17" height="8" rx="2"/><path d="M7 13h10v7.5H7z"/><path d="M7 5.5h.01"/>',
    chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
    chevronRight: '<path d="M9 5l7 7-7 7"/>',
    alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17h.01"/>',
    checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.7 2.7L16 9.6"/>',
    feather:
      '<path d="M19 5c-3.5-2.5-9-1.5-11.5 3L4 15.5V20h4.5l7.5-3.5C20.5 14 21.5 8.5 19 5z"/><path d="M4 20L13 11"/><path d="M12 7.5l4.5 4.5"/>',
    play: '<path d="M8 5.5v13l10-6.5-10-6.5z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    camera:
      '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7l1.5-3h4l1.5 3"/><circle cx="12" cy="13" r="3.5"/>',
    award:
      '<circle cx="12" cy="9" r="5"/><path d="M9 13.5L8 21l4-2 4 2-1-7.5"/>',
  }
  const svgIcon = (name, cls) =>
    `<svg class="sbk-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`

  const emptyPage = () => ({ who: '', where: '', doing: '', color: '', mood: '' })

  const trimField = (v) => (typeof v === 'string' ? v.trim() : '')
  const textComplete = (p) => !!(p && trimField(p.who) && trimField(p.where) && trimField(p.doing))
  const filledCount = (p) =>
    ['who', 'where', 'doing', 'color', 'mood'].filter((k) => trimField(p && p[k])).length
  const clarityOf = (p) => Math.round((filledCount(p) / 5) * 100)
  const pageSnapshot = (p) =>
    JSON.stringify([trimField(p.who), trimField(p.where), trimField(p.doing), p.color || '', p.mood || ''])

  function sentenceFor(p) {
    if (!p) return '（先填写下面的五要素，句子会自动生成）'
    if (!trimField(p.who) && !trimField(p.where) && !trimField(p.doing)) {
      return '（先填写下面的五要素，句子会自动生成）'
    }
    const parts = []
    if (trimField(p.who)) parts.push(trimField(p.who))
    if (trimField(p.where)) parts.push('在' + trimField(p.where))
    if (trimField(p.doing)) parts.push(trimField(p.doing))
    if (p.color) parts.push('画面以' + p.color + '为主')
    if (p.mood) parts.push('感觉很' + p.mood)
    return parts.join('，') + '。'
  }

  function emojiFor(who) {
    const w = trimField(who)
    if (!w) return '🎨'
    if (EMOJI[w]) return EMOJI[w]
    for (const key of Object.keys(EMOJI)) {
      if (w.includes(key)) return EMOJI[key]
    }
    return '🎨'
  }

  function gradientFor(p) {
    const pair = MOOD_PALETTE[p && p.mood] || ['#dbeafe', '#ede9fe']
    return `linear-gradient(145deg, ${pair[0]}, ${pair[1]})`
  }

  const errorMessage = (e, fallback) => {
    if (!e) return fallback
    if (e.name === 'TypeError') return '网络连接失败，请检查网络后重试'
    return e.message || fallback
  }

  // ── 状态 ───────────────────────────────────────────────────
  function freshState() {
    return {
      // teacher：老师从 /lab/storybook 进入；
      // assign：学生从老师发的 /assign/:token 进入，通过姓名校验后创作并提交作业。
      mode: 'teacher',
      poemIndex: 0,
      customPoemName: '',
      pages: [emptyPage()],
      current: 0,
      phase: 'compose', // compose | generating | review | submitted
      images: [null],
      from: [null], // 生成时的五要素快照，用来判断插画是否过期
      seq: 0,
      step: 0,
      stripFocus: -1,
      viewMode: 'spread',
      gen: { total: 0, done: 0, ok: 0, fail: 0 },
      genTargets: [],
      genFailed: [],
      checkedReview: false,
      submitting: false,
      submitError: '',
      submitted: null,
      toast: null,
      // ── 学生作业模式 ──
      assignToken: '',
      assignMeta: null,
      assignMember: null,
      assignSubmission: null,
      assignStatus: 'loading', // loading | gate | editor | lab | task | submitted | closed | error
      assignError: '',
      assignName: '',
      assignBusy: false,
      assignLoaded: false,
      // 互动练习作业：监考条捕获的本次成绩与作品
      assignLabResult: null,
      assignLabNote: '',
      // 课程任务工作台：文字与照片（data URL，不压缩）
      assignTaskText: '',
      assignTaskImages: [],
      assignTaskBusy: false,
      assignTaskError: '',
    }
  }

  let state = freshState()
  let root = null
  let keyHandler = null
  let toastTimer = 0
  let ctx = { router: null }
  let modalEl = null
  let modalKey = null
  let modalPrevFocus = null

  const poem = () => POEMS[state.poemIndex] || POEMS[0]
  const poemName = () => state.customPoemName || poem().name
  const isAssign = () => state.mode === 'assign'

  const ASSIGN_TYPE_TEXT = { storybook: 'AI 绘本创作', lab: '互动练习', task: '课程任务' }
  const ASSIGN_STAGE_TEXT = { low: '低年级', mid: '中年级', high: '高年级' }
  const assignKind = () => (state.assignMeta && state.assignMeta.type) || 'storybook'

  /**
   * 学生作业监考：互动练习页要求登录，而学生没有账号。
   * 核对姓名后临时顶替 user / app store：让路由守卫放行，并拦截
   * markLab / addWork / setQuizBest，把结果收进这份作业而不是个人账号。
   * 离开作业上下文时恢复原样。
   */
  const supervisor = {
    active: false,
    token: '',
    meta: null,
    member: null,
    userStore: null,
    appStore: null,
    saved: null,
    barEl: null,
    barClick: null,
    labResult: null,
    producedWork: null,
    markAt: 0,
    busy: false,
    submitted: false,
    error: '',
  }

  function assignRemaining() {
    if (!isAssign() || !state.assignSubmission) return Infinity
    const limit = Number(state.assignSubmission.aiLimit) || 8
    const used = Number(state.assignSubmission.aiCalls) || 0
    return Math.max(0, limit - used)
  }

  /** 把服务器上的提交内容装回编辑器，用于刷新后展示已提交的成书。 */
  function hydrateFromSubmission(sub) {
    const content = sub && sub.content
    if (!content || !Array.isArray(content.pages) || !content.pages.length) return false
    const poemIndex = POEMS.findIndex((p) => p.name === content.poemName)
    state.poemIndex = poemIndex >= 0 ? poemIndex : 0
    state.customPoemName = poemIndex >= 0 ? '' : String(content.poemName || '')
    state.pages = content.pages.map((p) => ({
      who: typeof p.who === 'string' ? p.who : '',
      where: typeof p.where === 'string' ? p.where : '',
      doing: typeof p.doing === 'string' ? p.doing : '',
      color: typeof p.color === 'string' ? p.color : '',
      mood: typeof p.mood === 'string' ? p.mood : '',
    }))
    state.images = content.pages.map((p) => safeImg(p.image) || null)
    state.from = state.pages.map((p, i) => (state.images[i] ? pageSnapshot(p) : null))
    state.current = 0
    return true
  }

  async function assignApi(path, opts = {}) {
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
      throw new Error('网络连接失败，请检查网络后重试')
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      const err = new Error((data && data.error && data.error.message) || '请求失败，请稍后再试')
      err.status = res.status
      err.code = (data && data.error && data.error.code) || ''
      throw err
    }
    return data
  }

  // ── 学生作业：互动练习监考条 ───────────────────────────────
  /**
   * 互动练习路由要求登录，而学生只有班级作业会话。核对姓名后临时顶替
   * user / app store：让路由守卫放行，并拦截 markLab / addWork / setQuizBest，
   * 把成绩与作品收进这份作业。学生离开作业上下文时原样恢复。
   * 课程任务如果配了工具台，也用同一套机制放行，但不记成绩。
   */
  const clampScore = (value) => {
    const n = Math.round(Number(value))
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(100, n))
  }

  function piniaStores() {
    const el = document.querySelector('#app')
    const app = el && el.__vue_app__
    const gp = app && app.config && app.config.globalProperties
    const pinia = gp && gp.$pinia
    if (!pinia || !pinia._s || typeof pinia._s.get !== 'function') return null
    const userStore = pinia._s.get('user')
    const appStore = pinia._s.get('app')
    if (!userStore || !appStore) return null
    return { user: userStore, app: appStore }
  }

  // 成绩先落在 sessionStorage：刷新 / 从练习页返回时不用重做，换人或提交后清掉
  function labDraftKey(token) {
    return `sbk-assign-lab:${token}`
  }

  function loadLabDraft() {
    if (!isAssign() || assignKind() !== 'lab' || !state.assignToken) return
    try {
      const raw = sessionStorage.getItem(labDraftKey(state.assignToken))
      if (!raw) return
      const value = JSON.parse(raw)
      if (typeof value.score === 'number') state.assignLabResult = clampScore(value.score)
      if (typeof value.note === 'string') state.assignLabNote = value.note
      if (value.work && typeof value.work === 'object') supervisor.producedWork = value.work
    } catch {
      /* 草稿损坏时当作没有 */
    }
  }

  function saveLabDraft() {
    if (!isAssign() || assignKind() !== 'lab' || !state.assignToken) return
    try {
      const hasScore = typeof state.assignLabResult === 'number'
      const note = String(state.assignLabNote || '')
      if (!hasScore && !note.trim() && !supervisor.producedWork) {
        sessionStorage.removeItem(labDraftKey(state.assignToken))
        return
      }
      sessionStorage.setItem(
        labDraftKey(state.assignToken),
        JSON.stringify({
          score: hasScore ? state.assignLabResult : null,
          note,
          work: supervisor.producedWork || null,
        }),
      )
    } catch {
      /* 隐私模式禁用存储时忽略 */
    }
  }

  function clearLabDraft() {
    if (!state.assignToken) return
    try {
      sessionStorage.removeItem(labDraftKey(state.assignToken))
    } catch {
      /* 忽略 */
    }
  }

  /** 这份作业允许打开的互动练习（lab 作业本身 / task 作业的配套工具） */
  function supervisorLabId() {
    if (!isAssign() || !state.assignMeta) return ''
    const kind = assignKind()
    if (kind === 'lab') return state.assignMeta.labId || ''
    if (kind === 'task') return state.assignMeta.toolLabId || ''
    return ''
  }

  async function startSupervisor() {
    const labId = supervisorLabId()
    if (!isAssign() || !labId || !state.assignMeta || !state.assignMember) return false
    if (supervisor.active && supervisor.token === state.assignToken) return true

    const stores = await waitFor(() => (piniaStores() ? piniaStores() : null), 8000)
    if (!stores) return false
    stopSupervisor()

    const { user, app } = stores
    const member = state.assignMember
    supervisor.saved = {
      user: user.user,
      loaded: user.loaded,
      ensureLoaded: user.ensureLoaded,
      markLab: app.markLab,
      setQuizBest: app.setQuizBest,
      addWork: app.addWork,
    }
    supervisor.active = true
    supervisor.token = state.assignToken
    supervisor.meta = state.assignMeta
    supervisor.member = member
    supervisor.labResult = null
    supervisor.producedWork = null
    supervisor.markAt = 0
    supervisor.busy = false
    supervisor.submitted = false
    supervisor.error = ''

    // 让站点的路由守卫与页头都认为这是一名已登录的学生
    user.user = {
      id: `assign-${member.id}`,
      email: '',
      nickname: member.name || '同学',
      avatarHue: 210,
      avatarUrl: null,
      quizBest: 0,
    }
    user.loaded = true
    user.ensureLoaded = async () => {}

    const captureScore = assignKind() === 'lab'
    if (captureScore) {
      // 同一标签页里刷新或从练习页返回时，恢复上次记录的成绩与作品
      loadLabDraft()
      if (typeof state.assignLabResult === 'number') {
        supervisor.labResult = { score: state.assignLabResult, at: Date.now() }
      }
    }
    const expected = labId
    app.markLab = (labIdArg, score) => {
      if (!supervisor.active) return false
      // 任务作业借用工具台时只放行，不记成绩
      if (!captureScore || labIdArg !== expected) return false
      const n = clampScore(score)
      supervisor.labResult = { score: n, at: Date.now() }
      supervisor.markAt = Date.now()
      state.assignLabResult = n
      supervisor.error = ''
      saveLabDraft()
      updateSupervisorBar()
      if (root && state.assignStatus === 'lab') render()
      return true
    }
    app.setQuizBest = () => {}
    app.addWork = (work) => {
      if (!supervisor.active || !captureScore) return false
      // 只接收刚完成练习时随成绩一起产出的作品，避免误收别的页面数据
      if (!supervisor.markAt || Date.now() - supervisor.markAt > 15000) return false
      if (!work || typeof work !== 'object') return false
      const title = String(work.title || '').trim().slice(0, 120)
      const type = String(work.type || '').trim().slice(0, 32)
      if (!title || !type) return false
      const hue = Number(work.hue)
      supervisor.producedWork = {
        title,
        type,
        module: String(work.module || 'm1').trim().slice(0, 8) || 'm1',
        grade: String(work.grade || 'low').trim().slice(0, 8) || 'low',
        desc: String(work.desc || '').slice(0, 1000),
        hue: Number.isFinite(hue) ? Math.max(0, Math.min(360, Math.round(hue))) : undefined,
      }
      supervisor.error = ''
      saveLabDraft()
      updateSupervisorBar()
      return true
    }

    installSupervisorBar()
    updateSupervisorBar()
    return true
  }

  function stopSupervisor() {
    const saved = supervisor.saved
    if (saved) {
      const stores = piniaStores()
      if (stores) {
        try {
          stores.user.user = saved.user
          stores.user.loaded = saved.loaded
          if (saved.ensureLoaded) stores.user.ensureLoaded = saved.ensureLoaded
          stores.app.markLab = saved.markLab
          stores.app.setQuizBest = saved.setQuizBest
          stores.app.addWork = saved.addWork
        } catch {
          /* 页面切换中 store 可能已重建，恢复失败也不影响离开 */
        }
      }
    }
    supervisor.active = false
    supervisor.token = ''
    supervisor.meta = null
    supervisor.member = null
    supervisor.saved = null
    supervisor.labResult = null
    supervisor.producedWork = null
    supervisor.markAt = 0
    supervisor.busy = false
    supervisor.submitted = false
    supervisor.error = ''
    removeSupervisorBar()
  }

  function installSupervisorBar() {
    removeSupervisorBar()
    const bar = document.createElement('div')
    bar.className = 'sbk-supervisor'
    bar.setAttribute('data-sbk-supervisor', '')
    bar.setAttribute('role', 'region')
    bar.setAttribute('aria-label', '班级作业')
    const onClick = (e) => {
      const btn = e.target.closest ? e.target.closest('[data-sbk-sup-act]') : null
      if (!btn) return
      if (btn.dataset.sbkSupAct === 'back') navigate('/assign/' + state.assignToken)
      else if (btn.dataset.sbkSupAct === 'submit') submitLabAssignment()
    }
    bar.addEventListener('click', onClick)
    supervisor.barEl = bar
    supervisor.barClick = onClick
    document.body.appendChild(bar)
  }

  function removeSupervisorBar() {
    if (supervisor.barEl) {
      if (supervisor.barClick) supervisor.barEl.removeEventListener('click', supervisor.barClick)
      supervisor.barEl.remove()
    }
    supervisor.barEl = null
    supervisor.barClick = null
    document.body.classList.remove('sbk-supervisor-on')
  }

  function updateSupervisorBar() {
    const bar = supervisor.barEl
    if (!bar) return
    const route = ctx.router && ctx.router.currentRoute.value
    const onAssignPage = !!(route && route.name === 'assign-studio')
    bar.style.display = onAssignPage ? 'none' : 'flex'
    document.body.classList.toggle('sbk-supervisor-on', !onAssignPage)
    const meta = supervisor.meta || {}
    const member = supervisor.member || {}
    const result = supervisor.labResult
    const captureScore = assignKind() === 'lab'
    const status = supervisor.submitted
      ? '作业已提交'
      : !captureScore
        ? '在工具台完成后，回到作业页提交'
        : result
          ? `本次成绩 ${result.score} 分`
          : '完成练习后，成绩会自动记录'
    bar.innerHTML = `
      <div class="sbk-supervisor-main">
        <span class="sbk-supervisor-badge">${svgIcon(captureScore ? 'play' : 'sparkles')}</span>
        <div class="sbk-supervisor-text">
          <b>${esc(meta.title || '班级作业')}</b>
          <span>${esc(meta.className || '')} · ${esc(member.name || '')} · ${esc(status)}</span>
        </div>
      </div>
      <div class="sbk-supervisor-actions">
        ${
          captureScore && result && !supervisor.submitted
            ? `<button type="button" class="sbk-supervisor-submit" data-sbk-sup-act="submit" ${supervisor.busy ? 'disabled' : ''}>${supervisor.busy ? '提交中…' : '提交成绩'}</button>`
            : ''
        }
        <button type="button" class="sbk-supervisor-back" data-sbk-sup-act="back">返回作业</button>
      </div>
      ${supervisor.error ? `<p class="sbk-supervisor-error" role="alert">${esc(supervisor.error)}</p>` : ''}`
  }

  async function submitLabAssignment() {
    if (state.assignBusy) return
    const kind = assignKind()
    if (kind !== 'lab' || !state.assignMeta || !state.assignMeta.labId) return
    const score =
      supervisor.active && supervisor.labResult
        ? supervisor.labResult.score
        : Number.isInteger(state.assignLabResult)
          ? state.assignLabResult
          : null
    if (score == null) {
      supervisor.error = '先完成互动练习，拿到成绩后再提交'
      state.assignError = supervisor.error
      updateSupervisorBar()
      if (root) render()
      return
    }
    state.assignBusy = true
    state.assignError = ''
    supervisor.error = ''
    updateSupervisorBar()
    if (root) render()
    try {
      const data = await assignApi(`/api/assign/${encodeURIComponent(state.assignToken)}/submit`, {
        method: 'POST',
        body: {
          kind: 'lab',
          labId: state.assignMeta.labId,
          score,
          note: state.assignLabNote || '',
          work: supervisor.producedWork || null,
        },
      })
      if (!data || !data.ok) throw new Error('提交失败，请稍后再试')
      const submittedAt = data.submission && data.submission.submittedAt
      if (state.assignSubmission) {
        state.assignSubmission.status = 'submitted'
        state.assignSubmission.submittedAt = submittedAt
        state.assignSubmission.score = score
      } else {
        state.assignSubmission = { status: 'submitted', submittedAt, score }
      }
      state.assignLabResult = score
      state.assignStatus = 'submitted'
      state.assignBusy = false
      clearLabDraft()
      const wasOnAssign = !!root
      stopSupervisor()
      if (wasOnAssign) {
        render()
        scrollTopStudio()
      } else {
        navigate('/assign/' + state.assignToken)
      }
    } catch (e) {
      state.assignBusy = false
      supervisor.error = errorMessage(e, '提交失败，请稍后再试')
      state.assignError = supervisor.error
      updateSupervisorBar()
      if (root) render()
    }
  }

  // ── 学生作业：课程任务工作台 ───────────────────────────────
  const TASK_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']
  const TASK_IMAGE_LIMIT = 4
  // 后端单张上限 2,000,000 字符；1.35MB 原图经 base64 约 1.8MB，留够余量且不压缩
  const TASK_IMAGE_BYTES = 1_350_000

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('读取照片失败'))
      reader.readAsDataURL(file)
    })
  }

  async function addTaskImages(files) {
    const list = Array.from(files || [])
    if (!list.length) return
    let error = ''
    const room = TASK_IMAGE_LIMIT - state.assignTaskImages.length
    if (room <= 0) {
      state.assignTaskError = `最多上传 ${TASK_IMAGE_LIMIT} 张照片`
      render()
      return
    }
    const missing = list.length - room
    const accepted = []
    for (const file of list.slice(0, room)) {
      const type = String(file.type || '').toLowerCase()
      if (!TASK_IMAGE_TYPES.includes(type)) {
        error = '只支持 PNG、JPG、WebP 图片'
        continue
      }
      if (file.size > TASK_IMAGE_BYTES) {
        error = `「${file.name || '这张图片'}」太大（最多约 1.3MB），请换一张`
        continue
      }
      try {
        accepted.push(await readImageFile(file))
      } catch {
        error = '读取照片失败，请重试'
      }
    }
    if (missing > 0) error = `最多上传 ${TASK_IMAGE_LIMIT} 张照片`
    if (accepted.length) state.assignTaskImages.push(...accepted)
    state.assignTaskError = error
    render()
  }

  function removeTaskImage(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.assignTaskImages.length) return
    state.assignTaskImages.splice(index, 1)
    state.assignTaskError = ''
    render()
  }

  async function submitTaskAssignment() {
    if (state.assignTaskBusy) return
    const text = String(state.assignTaskText || '').trim()
    const images = state.assignTaskImages.slice()
    if (!text && !images.length) {
      state.assignTaskError = '先写下作业内容，或上传至少一张照片'
      render()
      return
    }
    state.assignTaskBusy = true
    state.assignTaskError = ''
    render()
    try {
      const data = await assignApi(`/api/assign/${encodeURIComponent(state.assignToken)}/submit`, {
        method: 'POST',
        body: { kind: 'task', text, images },
      })
      if (!data || !data.ok) throw new Error('提交失败，请稍后再试')
      const submittedAt = data.submission && data.submission.submittedAt
      const content = { version: 1, text, images }
      if (state.assignSubmission) {
        state.assignSubmission.status = 'submitted'
        state.assignSubmission.submittedAt = submittedAt
        state.assignSubmission.content = content
      } else {
        state.assignSubmission = { status: 'submitted', submittedAt, content }
      }
      state.assignTaskText = text
      state.assignStatus = 'submitted'
      state.assignTaskBusy = false
      stopSupervisor()
      render()
      scrollTopStudio()
      return
    } catch (e) {
      state.assignTaskError = errorMessage(e, '提交失败，请稍后再试')
    }
    state.assignTaskBusy = false
    render()
  }

  async function openAssignTool() {
    const labId = supervisorLabId()
    if (!labId) {
      toast('这份作业没有配置可打开的工具台', 'warn')
      return
    }
    state.assignError = ''
    const ok = await startSupervisor()
    if (!ok) {
      state.assignError = '工具台暂时打不开，请刷新页面后重试'
      if (root) render()
      return
    }
    navigate(`/lab/${encodeURIComponent(labId)}?assign=${encodeURIComponent(state.assignToken)}`)
  }

  function pageImage(i) {
    return safeImg(state.images[i])
  }

  function isStale(i) {
    const img = pageImage(i)
    const snap = state.from[i]
    if (!img || !snap || !state.pages[i]) return false
    return snap !== pageSnapshot(state.pages[i])
  }

  function hasFresh(i) {
    return !!pageImage(i) && !isStale(i)
  }

  function missingIndices() {
    const out = []
    state.pages.forEach((_, i) => {
      if (!hasFresh(i)) out.push(i)
    })
    return out
  }

  function firstImage() {
    for (const u of state.images) {
      const img = safeImg(u)
      if (img) return img
    }
    return ''
  }

  function nickname() {
    if (isAssign()) return (state.assignMember && state.assignMember.name) || '我'
    try {
      const app = document.querySelector('#app')
      const pinia = app && app.__vue_app__ && app.__vue_app__.config.globalProperties.$pinia
      const user = pinia && pinia._s && pinia._s.get('user')
      return (user && user.nickname) || '我'
    } catch {
      return '我'
    }
  }

  function markProgress() {
    if (isAssign()) return
    try {
      const app = document.querySelector('#app')
      const pinia = app && app.__vue_app__ && app.__vue_app__.config.globalProperties.$pinia
      const store = pinia && pinia._s && pinia._s.get('app')
      const sum = state.pages.reduce((acc, p) => acc + filledCount(p) * 4, 0)
      const score = Math.min(100, Math.round(sum / Math.max(1, state.pages.length)))
      if (store && typeof store.markLab === 'function') store.markLab('storybook', score)
    } catch {
      /* 进度同步是副作用，失败不影响创作 */
    }
  }

  function workDesc() {
    const text = state.pages
      .map((p, i) => `第${i + 1}页：${trimField(p.who)}在${trimField(p.where)}，${trimField(p.doing)}。`)
      .join('')
    return text.slice(0, 1000)
  }

  function navigate(path) {
    if (ctx.router) ctx.router.push(path).catch(() => {})
    else window.location.hash = '#' + path
  }

  function scrollTopStudio() {
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch {
      window.scrollTo(0, 0)
    }
  }

  // ── 步骤与审查统计 ─────────────────────────────────────────
  function buildSteps() {
    const steps = [{ kind: 'cover' }]
    for (let i = 0; i < state.pages.length; i += 2) {
      const pages = [i]
      if (i + 1 < state.pages.length) pages.push(i + 1)
      steps.push({ kind: 'spread', pages })
    }
    steps.push({ kind: 'end' })
    return steps
  }

  function stepLabel(step) {
    if (step.kind === 'cover') return '封面'
    if (step.kind === 'end') return '封底'
    if (step.pages.length === 1) return `第 ${step.pages[0] + 1} 页`
    return `第 ${step.pages[0] + 1}–${step.pages[1] + 1} 页`
  }

  function stepForPage(i) {
    return 1 + Math.floor(i / 2)
  }

  function activeItemForStep(step) {
    if (step.kind === 'cover') return -1
    if (step.kind === 'end') return state.pages.length
    return step.pages[0]
  }

  function reviewStats() {
    const incomplete = []
    const stale = []
    const missing = []
    let fresh = 0
    state.pages.forEach((p, i) => {
      if (!textComplete(p)) incomplete.push(i)
      const img = pageImage(i)
      if (!img) missing.push(i)
      else if (isStale(i)) stale.push(i)
      else fresh++
    })
    return {
      n: state.pages.length,
      incomplete,
      stale,
      missing,
      fresh,
      textOK: incomplete.length === 0,
      imagesOK: missing.length === 0 && stale.length === 0,
      ready: incomplete.length === 0 && missing.length === 0 && stale.length === 0,
    }
  }

  // ── Toast ──────────────────────────────────────────────────
  function updateToast() {
    const el = root && root.querySelector('[data-sbk-toast]')
    if (!el) return
    if (!state.toast) {
      el.className = 'sbk-toast'
      el.textContent = ''
      return
    }
    el.setAttribute('role', state.toast.type === 'error' ? 'alert' : 'status')
    el.setAttribute('aria-live', state.toast.type === 'error' ? 'assertive' : 'polite')
    el.className = 'sbk-toast show ' + state.toast.type
    el.textContent = state.toast.msg
  }

  function toast(msg, type) {
    state.toast = { msg, type: type || 'info' }
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => {
      state.toast = null
      updateToast()
    }, 3800)
    updateToast()
  }

  // ── 二次确认弹层 ───────────────────────────────────────────
  // 弹层挂在 body 上而不是 root 里：render() 会重建 root，焦点会丢。
  function closeConfirm(restoreFocus) {
    if (!modalEl) return
    document.removeEventListener('keydown', modalKey, true)
    modalKey = null
    modalEl.remove()
    modalEl = null
    if (restoreFocus !== false && modalPrevFocus && document.contains(modalPrevFocus)) {
      try {
        modalPrevFocus.focus()
      } catch {
        /* 原按钮可能已被重建，忽略 */
      }
    }
    modalPrevFocus = null
  }

  function openConfirm(opts) {
    closeConfirm(false)
    modalPrevFocus = document.activeElement
    const danger = !!opts.danger
    const wrap = document.createElement('div')
    wrap.className = 'sbk-modal-backdrop'
    wrap.innerHTML = `<div class="sbk-modal" role="dialog" aria-modal="true" aria-labelledby="sbk-modal-title" aria-describedby="sbk-modal-desc">
      <div class="sbk-modal-icon ${danger ? 'danger' : ''}" aria-hidden="true">${svgIcon(danger ? 'alert' : 'sparkles')}</div>
      <h2 id="sbk-modal-title">${esc(opts.title)}</h2>
      <p id="sbk-modal-desc">${esc(opts.message)}</p>
      <div class="sbk-modal-actions">
        <button type="button" class="sbk-btn" data-modal-cancel>取消</button>
        <button type="button" class="sbk-primary sbk-modal-confirm ${danger ? 'danger' : ''}" data-modal-ok>${esc(opts.confirmLabel || '确定')}</button>
      </div>
    </div>`
    const cancelBtn = wrap.querySelector('[data-modal-cancel]')
    const okBtn = wrap.querySelector('[data-modal-ok]')
    cancelBtn.addEventListener('click', () => closeConfirm())
    okBtn.addEventListener('click', () => {
      closeConfirm(false)
      try {
        if (opts.onConfirm) opts.onConfirm()
      } catch (e) {
        toast(errorMessage(e, '操作没有完成，请重试'), 'error')
      }
    })
    wrap.addEventListener('mousedown', (e) => {
      if (e.target === wrap) closeConfirm()
    })
    modalKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeConfirm()
        return
      }
      if (e.key !== 'Tab') return
      e.preventDefault()
      const order = [cancelBtn, okBtn]
      const idx = order.indexOf(document.activeElement)
      const next = e.shiftKey ? (idx <= 0 ? okBtn : order[idx - 1]) : idx === order.length - 1 ? cancelBtn : order[Math.max(0, idx + 1)]
      next.focus()
    }
    document.addEventListener('keydown', modalKey, true)
    document.body.appendChild(wrap)
    modalEl = wrap
    requestAnimationFrame(() => {
      if (modalEl === wrap) cancelBtn.focus()
    })
  }

  const pageHasWork = (i) => {
    const p = state.pages[i]
    if (!p) return false
    return ['who', 'where', 'doing', 'color', 'mood'].some((k) => trimField(p[k])) || !!pageImage(i)
  }
  const anyWorkStarted = () => state.pages.some((_, i) => pageHasWork(i))

  // ── 渲染：公共部分 ─────────────────────────────────────────
  function headHtml() {
    const phaseIndex =
      state.phase === 'submitted' ? 3 : state.phase === 'review' ? 2 : state.phase === 'generating' ? 1 : 0
    const locked = state.phase === 'generating' || state.phase === 'submitted'
    const stepDefs = isAssign()
      ? [
          STEPS[0],
          STEPS[1],
          { title: '审查提交', desc: '检查成书，交给老师' },
        ]
      : STEPS
    const steps = stepDefs.map((s, i) => {
      const done = i < phaseIndex || state.phase === 'submitted'
      const cls = done ? 'done' : i === phaseIndex ? 'active' : ''
      const current = i === phaseIndex && !done
      return `<li class="sbk-step ${cls}">
        <button type="button" class="sbk-step-btn" data-act="go-step" data-step="${i}" title="切换到${s.title}" ${locked ? 'disabled' : ''}${current ? ' aria-current="step"' : ''}>
          <span class="sbk-step-num" aria-hidden="true">${done ? svgIcon('checkCircle') : i + 1}</span>
          <span class="sbk-step-text"><b>${s.title}</b><span>${s.desc}</span></span>
          ${done ? '<span class="sbk-sr">（已完成）</span>' : ''}
        </button>
      </li>`
    }).join('')

    const meta = state.assignMeta || {}
    const member = state.assignMember || {}
    const crumbs = isAssign()
      ? `<nav class="sbk-crumbs sbk-crumbs-assign" aria-label="作业位置">
          <span class="sbk-crumb-now">${esc(meta.className || '班级作业')}</span>
          <span aria-hidden="true">/</span>
          <span aria-current="page">${esc(meta.title || 'AI 课文绘本')}</span>
          <button type="button" class="sbk-crumb-link sbk-crumb-right" data-act="assign-leave">不是我？换人</button>
        </nav>`
      : `<nav class="sbk-crumbs" aria-label="面包屑">
          <button type="button" class="sbk-crumb-link" data-act="back-lab">互动训练</button>
          <span aria-hidden="true">/</span>
          <span class="sbk-crumb-now" aria-current="page">AI 课文绘本创作台</span>
        </nav>`

    const metaPills = isAssign()
      ? `<span class="sbk-meta-pill accent">${esc(meta.className || '班级作业')}</span>
         <span class="sbk-meta-pill">${esc(member.name || '')}</span>
         <span class="sbk-meta-pill ${assignRemaining() <= 2 ? 'warn' : ''}">AI 生成剩余 ${assignRemaining()} 次</span>`
      : `<span class="sbk-meta-pill accent">AI·生成 创作智能</span>
         <span class="sbk-meta-pill">低段</span>
         <span class="sbk-meta-pill">约 12 分钟</span>`

    const notice =
      isAssign() && meta.instructions
        ? `<div class="sbk-assign-notice">${svgIcon('notebook')}<div><b>老师的要求</b><p>${esc(meta.instructions)}</p></div></div>`
        : ''

    return `${crumbs}
    <header class="sbk-hero">
      <div class="sbk-hero-main">
        <div class="sbk-hero-icon" aria-hidden="true">${svgIcon('notebook')}</div>
        <div class="sbk-hero-text">
          <h1>${esc(isAssign() && meta.title ? meta.title : 'AI 课文绘本创作台')}</h1>
          <p>用「谁 + 在哪 + 做什么 + 什么颜色 + 什么心情」说清画面，AI 逐页作画，审查后装订成书。</p>
        </div>
      </div>
      <div class="sbk-hero-meta">${metaPills}</div>
      <ol class="sbk-steps" aria-label="创作流程">${steps}${
        state.phase === 'submitted'
          ? ''
          : `<li class="sbk-steps-hint" aria-hidden="true">${state.phase === 'generating' ? '生成中，请稍候' : '点步骤可切换'}</li>`
      }</ol>
    </header>
    ${notice}`
  }

  function miniCaption(p) {
    if (!p || (!trimField(p.who) && !trimField(p.where) && !trimField(p.doing))) return '待填写'
    return [trimField(p.who), trimField(p.where), trimField(p.doing)].filter(Boolean).join(' · ')
  }

  function miniBookHtml(interactive) {
    const dis = interactive === false ? 'disabled' : ''
    const cover = firstImage()
    return `<div class="sbk-mini-book" aria-label="成书预览">
      <button type="button" class="sbk-mini-tile sbk-mini-cover ${cover ? '' : 'noimg'}" data-act="mini-page" data-i="-1" ${dis} aria-label="封面，跳到第 1 页">
        ${cover ? `<img src="${esc(cover)}" alt="">` : ''}
        <span class="sbk-mini-cover-shade"></span>
        <span class="sbk-mini-cover-text"><b>《${esc(poemName())}》</b><i>AI 课文绘本</i></span>
      </button>
      ${state.pages
        .map((page, i) => {
          const img = pageImage(i)
          const stale = !!img && isStale(i)
          return `<button type="button" class="sbk-mini-tile sbk-mini-page ${i === state.current ? 'on' : ''}" data-act="mini-page" data-i="${i}" ${dis} aria-label="第 ${i + 1} 页${stale ? '（描述已改，插画需重绘）' : img ? '' : '（待生成插画）'}" ${i === state.current && interactive !== false ? 'aria-current="true"' : ''} style="${img ? '' : `background:${gradientFor(page)}`}">
            ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span class="sbk-mini-emo" data-mini-emo="${i}">${emojiFor(page.who)}</span>`}
            <span class="sbk-mini-no">${i + 1}</span>
            <span class="sbk-mini-warn" data-mini-warn="${i}" ${stale ? '' : 'hidden'}>改</span>
            <span class="sbk-mini-cap" data-mini-cap="${i}">${esc(miniCaption(page))}</span>
          </button>`
        })
        .join('')}
      <button type="button" class="sbk-mini-tile sbk-mini-end" data-act="mini-page" data-i="-2" ${dis} aria-label="封底，跳到最后一页">
        <span class="sbk-mini-end-mark" aria-hidden="true">${svgIcon('feather')}</span>
        <span class="sbk-mini-end-text">故事讲完了<br>AI 启智课</span>
      </button>
    </div>`
  }

  function dotClass(i) {
    if (!pageImage(i)) return 'miss'
    return isStale(i) ? 'stale' : 'ok'
  }

  // ── 渲染：第一步 编排 ──────────────────────────────────────
  function chipRows(items, field, current, label) {
    return `<div class="sbk-chips" role="group"${label ? ` aria-label="${esc(label)}"` : ''}>${items
      .map(
        (v) =>
          `<button type="button" class="sbk-chip ${current === v ? 'on' : ''}" data-act="chip" data-field="${field}" data-value="${esc(v)}" aria-pressed="${current === v}">${esc(v)}</button>`,
      )
      .join('')}</div>`
  }

  function textFieldHtml(key, icon, label, placeholder, suggestions, page) {
    const id = `sbk-field-${key}`
    return `<div class="sbk-field">
      <label class="sbk-field-label" for="${id}"><span aria-hidden="true">${icon}</span>${label}</label>
      <input class="sbk-input" id="${id}" data-field="${key}" value="${esc(page[key] || '')}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" maxlength="40" />
      ${chipRows(suggestions, key, page[key], `${label}建议`)}
    </div>`
  }

  function composeCtaHtml() {
    const missing = missingIndices()
    const hasAny = state.images.some((x) => safeImg(x))
    const textOK = state.pages.every(textComplete)
    const quotaOut = isAssign() && assignRemaining() <= 0
    let html = ''
    if (missing.length === 0) {
      html = `<button type="button" class="sbk-primary sbk-cta" data-act="review">去审查成书 ${svgIcon('chevronRight')}</button>
        <p class="sbk-cta-hint">插画已就绪。逐页审查，确认后${isAssign() ? '提交作业' : '保存到个人作品'}。</p>`
    } else if (quotaOut) {
      html = `<button type="button" class="sbk-primary sbk-cta" data-act="generate" disabled>AI 生成次数已用完</button>
        <p class="sbk-cta-hint">请联系老师重置作业；已经画好的页面不会丢失。</p>`
    } else {
      const label = hasAny
        ? `补全插画 · ${missing.length} 页`
        : `${svgIcon('sparkles')}生成 ${state.pages.length} 页插画`
      html = `<button type="button" class="sbk-primary sbk-cta" data-act="generate" ${textOK ? '' : 'disabled'}>${label}</button>
        <p class="sbk-cta-hint">${
          !textOK
            ? '每一页都要填「谁 / 在哪 / 做什么」，AI 才知道要画什么。'
            : hasAny
              ? `还有 ${missing.length} 页需要绘制，生成后进入审查。`
              : `AI 会逐页作画，通常需要 8–60 秒；超过 4 页会自动分批。${
                  isAssign() ? `本次作业还剩 ${assignRemaining()} 次生成机会。` : ''
                }`
        }</p>`
    }
    if (hasAny && !quotaOut) {
      html += `<button type="button" class="sbk-btn sbk-regen" data-act="regen-all">重新生成全部插画</button>`
    }
    return html
  }

  function composeHtml() {
    if (state.current >= state.pages.length) state.current = state.pages.length - 1
    if (state.current < 0) state.current = 0
    const page = state.pages[state.current] || emptyPage()
    const p = poem()
    const canAdd = state.pages.length < MAX_PAGES

    return `<div class="sbk-compose-grid">
      <section class="sbk-col">
        <div class="sbk-card">
          <div class="sbk-card-head">
            <h2><span class="sbk-num">1</span>选一篇课文</h2>
            <span class="sbk-hint">换故事会清空当前编排</span>
          </div>
          <div class="sbk-poems" role="group" aria-label="选择课文">${POEMS.map(
            (item, i) =>
              `<button type="button" class="sbk-poem ${i === state.poemIndex ? 'on' : ''}" data-act="poem" data-i="${i}" aria-pressed="${i === state.poemIndex}">${esc(item.name)}</button>`,
          ).join('')}</div>
        </div>

        <div class="sbk-card">
          <div class="sbk-card-head">
            <h2><span class="sbk-num">2</span>编排每一页</h2>
            <span class="sbk-hint">每页描述一个画面</span>
          </div>
          <div class="sbk-tabs" role="group" aria-label="绘本页面">
            ${state.pages
              .map(
                (_, i) =>
                  `<button type="button" aria-pressed="${i === state.current}" class="sbk-tab ${i === state.current ? 'on' : ''}" data-act="tab" data-i="${i}">第 ${i + 1} 页<i class="sbk-dot ${dotClass(i)}" data-tab-dot="${i}" aria-hidden="true"></i></button>`,
              )
              .join('')}
            <button type="button" class="sbk-tab sbk-tab-add" data-act="add-page" ${canAdd ? '' : 'disabled'} aria-label="加一页">＋</button>
          </div>

          <div class="sbk-page-editor">
            <div class="sbk-editor-top">
              <span class="sbk-editor-title">第 ${state.current + 1} 页 · 五要素描述</span>
              <span class="sbk-clarity" data-live="clarity">清晰度 ${clarityOf(page)}%</span>
            </div>
            <div class="sbk-fields">
              ${textFieldHtml('who', '👦', '谁（主体）', '画面里最主要的人或物', p.who, page)}
              ${textFieldHtml('where', '🌳', '在哪（场景）', '地点与时间', p.where, page)}
              ${textFieldHtml('doing', '🏃', '做什么（动作）', '在做什么', p.doing, page)}
              <div class="sbk-field-pair">
                <div class="sbk-field">
                  <div class="sbk-field-label"><span aria-hidden="true">🎨</span>什么颜色</div>
                  ${chipRows(COLORS, 'color', page.color, '什么颜色')}
                </div>
                <div class="sbk-field">
                  <div class="sbk-field-label"><span aria-hidden="true">😊</span>什么心情</div>
                  ${chipRows(MOODS, 'mood', page.mood, '什么心情')}
                </div>
              </div>
            </div>

            <div class="sbk-sentence">
              <div class="sbk-sentence-head">AI 将照着这句话画</div>
              <p data-live="sentence">${esc(sentenceFor(page))}</p>
            </div>

            <div class="sbk-editor-actions">
              <button type="button" class="sbk-btn" data-act="add-page" ${canAdd ? '' : 'disabled'}>＋ 加一页</button>
              <button type="button" class="sbk-btn sbk-btn-danger" data-act="del-page" ${state.pages.length <= 1 ? 'disabled' : ''}>删除本页</button>
            </div>
          </div>
        </div>

        <div class="sbk-card sbk-cta-card" data-sbk-cta>${composeCtaHtml()}</div>
      </section>

      <aside class="sbk-col sbk-preview-col">
        <div class="sbk-card">
          <div class="sbk-card-head">
            <h2>成书预览</h2>
            <span class="sbk-hint">封面 + ${state.pages.length} 页 + 封底</span>
          </div>
          ${miniBookHtml()}
          <p class="sbk-note">页面会按这个顺序装订成书。点任意一页可跳回编辑。</p>
        </div>
        <div class="sbk-card sbk-tips">
          <h3>让 AI 画得更准</h3>
          <ul>
            <li>「谁 / 在哪 / 做什么」是必填，颜色和心情让画面更贴近想象。</li>
            <li>一次最多送 4 页，超过会自动分批；全部画完才会进入审查。</li>
            <li>生成后先逐页核对，确认插画和文字一致，再${isAssign() ? '提交作业' : '保存到个人作品'}。</li>
          </ul>
        </div>
      </aside>
    </div>`
  }

  // ── 渲染：第二步 生成 ──────────────────────────────────────
  function genThumbHtml(i) {
    const img = pageImage(i)
    const failed = state.genFailed.includes(i)
    return `<div class="sbk-gen-thumb ${failed ? 'fail' : ''}">
      ${img ? `<img src="${esc(img)}" alt="第 ${i + 1} 页">` : '<span class="sbk-skeleton"></span>'}
      <span class="sbk-gen-no">第 ${i + 1} 页</span>
      ${failed ? `<span class="sbk-gen-fail">${svgIcon('alert')}未画出</span>` : ''}
    </div>`
  }

  function generatingHtml() {
    const p = poem()
    const total = state.gen.total || state.genTargets.length || 1
    const done = Math.min(state.gen.done, total)
    const pct = Math.round((done / total) * 100)
    return `<div class="sbk-generating" aria-busy="true">
      <div class="sbk-card sbk-gen-card">
        <div class="sbk-gen-head">
          <div class="sbk-gen-orb" aria-hidden="true">${svgIcon('sparkles')}</div>
          <div>
            <h2>AI 正在绘制《${esc(p.name)}》</h2>
            <p>逐页作画中，请保持页面打开。通常需要 8–60 秒。</p>
          </div>
        </div>
        <div class="sbk-progress" role="progressbar" aria-label="插画生成进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="已完成 ${done} / ${total} 页">
          <div style="width:${pct}%"></div>
        </div>
        <div class="sbk-progress-meta" role="status" aria-live="polite">
          <span>已完成 ${done} / ${total} 页</span>
          <span>成功 ${state.gen.ok} 页${state.gen.fail ? ` · 未画出 ${state.gen.fail} 页` : ''}</span>
        </div>
        <div class="sbk-gen-grid">${state.genTargets.map(genThumbHtml).join('')}</div>
        <p class="sbk-note">画完后会进入审查：先逐页核对插画与描述，再${isAssign() ? '提交作业' : '保存到个人作品'}。</p>
      </div>
    </div>`
  }

  // ── 渲染：第三步 审查 ──────────────────────────────────────
  function coverPageHtml() {
    const img = firstImage()
    const p = poem()
    return `<div class="sbk-spread sbk-spread-single">
      <div class="sbk-cover-page">
        ${img ? `<img class="sbk-cover-img" src="${esc(img)}" alt="">` : '<div class="sbk-cover-img sbk-cover-fallback"></div>'}
        <div class="sbk-cover-scrim"></div>
        <div class="sbk-cover-content">
          <span class="sbk-cover-kicker">AI 课文绘本</span>
          <h2>《${esc(p.name)}》</h2>
          <p>${esc(p.who[0] || '')} · ${esc(p.scene || '')} · 共 ${state.pages.length} 页</p>
          <span class="sbk-cover-author">创作者：${esc(nickname())}</span>
        </div>
        <span class="sbk-cover-orn" aria-hidden="true">✦</span>
      </div>
    </div>`
  }

  function endPageHtml() {
    const p = poem()
    return `<div class="sbk-spread sbk-spread-single">
      <div class="sbk-end-page">
        <div class="sbk-end-mark" aria-hidden="true">${svgIcon('feather')}</div>
        <h2>故事讲完了</h2>
        <p>《${esc(p.name)}》 · 共 ${state.pages.length} 页</p>
        <div class="sbk-end-rule"></div>
        <p class="sbk-end-credit">文字由 ${esc(nickname())} 编排<br>插画由生成式 AI 绘制</p>
        <span class="sbk-end-brand">AI 启智课 · 互动训练</span>
      </div>
    </div>`
  }

  function pageFaceHtml(i) {
    const p = state.pages[i] || emptyPage()
    const img = pageImage(i)
    const stale = !!img && isStale(i)
    const missing = !img
    return `<figure class="sbk-pageface">
      <div class="sbk-page-media ${missing ? 'is-missing' : ''}" style="${missing ? `background:${gradientFor(p)}` : ''}">
        ${
          img
            ? `<img src="${esc(img)}" alt="第 ${i + 1} 页插画" loading="lazy">`
            : `<div class="sbk-page-missing">
                <span class="sbk-page-emo" aria-hidden="true">${emojiFor(p.who)}</span>
                <b>本页还没有插画</b>
                <button type="button" class="sbk-btn sbk-btn-mini" data-act="retry-page" data-page="${i}">重绘本页</button>
              </div>`
        }
        <span class="sbk-page-no">第 ${i + 1} 页</span>
        ${stale ? '<span class="sbk-page-stale">描述已修改 · 需重绘</span>' : ''}
      </div>
      <figcaption class="sbk-page-cap">
        <p class="sbk-page-sentence">${esc(sentenceFor(p))}</p>
        <span class="sbk-page-status ${stale ? 'warn' : missing ? 'miss' : 'ok'}">${
          stale ? '插画与当前描述不一致' : missing ? '等待生成' : '插画与描述一致'
        }</span>
        ${stale ? `<button type="button" class="sbk-btn sbk-btn-mini" data-act="retry-page" data-page="${i}">按新描述重绘</button>` : ''}
      </figcaption>
    </figure>`
  }

  function spreadPagesHtml(step) {
    const cells = step.pages.map(pageFaceHtml).join('')
    const blank =
      step.pages.length === 1 ? '<div class="sbk-pageface sbk-page-blank" aria-hidden="true"><span></span></div>' : ''
    return `<div class="sbk-spread">${cells}${blank}</div>`
  }

  function spreadStageHtml(steps) {
    const step = steps[state.step] || steps[0]
    return `<div class="sbk-step-wrap">
      <div class="sbk-step-label">${esc(stepLabel(step))}</div>
      <div class="sbk-spread-frame">
        ${step.kind === 'cover' ? coverPageHtml() : step.kind === 'end' ? endPageHtml() : spreadPagesHtml(step)}
      </div>
      <div class="sbk-book-nav">
        <button type="button" class="sbk-nav-btn" data-act="prev" ${state.step === 0 ? 'disabled' : ''} aria-label="上一页">${svgIcon('chevronLeft')}</button>
        <span class="sbk-nav-label" role="status" aria-live="polite">${state.step + 1} / ${steps.length} · ${esc(stepLabel(step))}</span>
        <button type="button" class="sbk-nav-btn" data-act="next" ${state.step === steps.length - 1 ? 'disabled' : ''} aria-label="下一页">${svgIcon('chevronRight')}</button>
      </div>
      <p class="sbk-keyhint">也可以用键盘 ← → 翻页</p>
    </div>`
  }

  function stripCoverHtml() {
    const p = poem()
    const img = firstImage()
    return `<div class="sbk-strip-cover ${img ? 'hasimg' : ''}">
      ${img ? `<img src="${esc(img)}" alt="">` : ''}
      <div class="sbk-strip-cover-shade"></div>
      <div class="sbk-strip-cover-text"><small>AI 课文绘本</small><b>《${esc(p.name)}》</b><span>${esc(nickname())}</span></div>
    </div>`
  }

  function stripPageHtml(i) {
    const p = state.pages[i] || emptyPage()
    const img = pageImage(i)
    const stale = !!img && isStale(i)
    return `<div class="sbk-strip-page">
      <div class="sbk-strip-media" style="${img ? '' : `background:${gradientFor(p)}`}">
        ${img ? `<img src="${esc(img)}" alt="第 ${i + 1} 页" loading="lazy">` : `<span class="sbk-strip-emo" aria-hidden="true">${emojiFor(p.who)}</span>`}
        <span class="sbk-strip-no">${i + 1}</span>
        ${stale ? '<span class="sbk-strip-warn">需重绘</span>' : ''}
      </div>
      <div class="sbk-strip-cap"><b>第 ${i + 1} 页</b><span>${esc(sentenceFor(p))}</span></div>
    </div>`
  }

  function stripEndHtml() {
    const p = poem()
    return `<div class="sbk-strip-end">
      <span aria-hidden="true">${svgIcon('feather')}</span>
      <b>故事讲完了</b>
      <small>《${esc(p.name)}》 · 共 ${state.pages.length} 页</small>
      <small>AI 启智课</small>
    </div>`
  }

  function stripStageHtml() {
    return `<div class="sbk-strip-block">
      <div class="sbk-strip-head">
        <span>拼接长卷</span>
        <span class="sbk-hint">封面 + ${state.pages.length} 页 + 封底，按装订顺序展开</span>
      </div>
      <div class="sbk-strip-wrap">
        <div class="sbk-strip">
          <div class="sbk-strip-item" data-strip-item="-1">${stripCoverHtml()}</div>
          ${state.pages.map((_, i) => `<div class="sbk-strip-item" data-strip-item="${i}">${stripPageHtml(i)}</div>`).join('')}
          <div class="sbk-strip-item" data-strip-item="${state.pages.length}">${stripEndHtml()}</div>
        </div>
      </div>
      <p class="sbk-keyhint">左右滑动查看整本 · 虚线是装订折线</p>
    </div>`
  }

  function filmstripHtml(steps) {
    const activeItem =
      state.viewMode === 'strip' ? state.stripFocus : activeItemForStep(steps[state.step] || steps[0])
    const n = state.pages.length
    const items = [{ item: -1, label: '封面', kind: 'cover' }]
    state.pages.forEach((_, i) => items.push({ item: i, label: `第${i + 1}页`, kind: 'page' }))
    items.push({ item: n, label: '封底', kind: 'end' })

    return `<div class="sbk-filmstrip" role="group" aria-label="快速跳转">
      ${items
        .map((it) => {
          if (it.kind !== 'page') {
            return `<button type="button" class="sbk-film ${activeItem === it.item ? 'on' : ''} ${it.kind === 'cover' ? 'sbk-film-cover' : 'sbk-film-end'}" data-act="film" data-item="${it.item}" title="${it.label}" aria-pressed="${activeItem === it.item}">
              <span class="sbk-film-thumb" aria-hidden="true">${svgIcon(it.kind === 'cover' ? 'book' : 'feather')}</span>
              <span class="sbk-film-cap">${it.label}</span>
            </button>`
          }
          const i = it.item
          const img = pageImage(i)
          const stale = !!img && isStale(i)
          return `<button type="button" class="sbk-film ${activeItem === i ? 'on' : ''}" data-act="film" data-item="${i}" title="第${i + 1}页" aria-pressed="${activeItem === i}" aria-label="第 ${i + 1} 页${stale ? '，插画需重绘' : ''}">
            <span class="sbk-film-thumb" style="${img ? '' : `background:${gradientFor(state.pages[i])}`}">
              ${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : `<span aria-hidden="true">${emojiFor(state.pages[i] && state.pages[i].who)}</span>`}
              ${stale ? '<i class="sbk-film-warn" aria-hidden="true"></i>' : ''}
            </span>
            <span class="sbk-film-cap">第${i + 1}页</span>
          </button>`
        })
        .join('')}
    </div>`
  }

  function submitBoxHtml(stats) {
    const enabled = stats.ready && state.checkedReview && !state.submitting
    const submitLabel = isAssign() ? '提交作业' : '保存到个人作品'
    return `<button type="button" class="sbk-primary sbk-submit" data-act="submit" ${enabled ? '' : 'disabled'}>
        ${state.submitting ? '<span class="sbk-spinner" aria-hidden="true"></span>正在提交…' : submitLabel}
      </button>
      <p class="sbk-cta-hint">${
        !stats.ready
          ? '先处理完上面的问题，再逐页核对插画。'
          : !state.checkedReview
            ? '勾选「我已逐页核对」后才能提交。'
            : isAssign()
              ? '提交后老师会在班级管理里看到这份作业；提交后不能自行修改。'
              : '保存后署名使用账号昵称；发布和撤下都在「我的作品」里操作。'
      }</p>
      ${state.submitError ? `<p class="sbk-alert" role="alert">${esc(state.submitError)}</p>` : ''}`
  }

  function checklistHtml() {
    const stats = reviewStats()
    const issueRows = [
      ...stats.stale.map(
        (i) =>
          `<div class="sbk-issue"><span>第 ${i + 1} 页：描述改过，插画还是旧的</span><button type="button" class="sbk-btn sbk-btn-mini" data-act="retry-page" data-page="${i}">重绘</button></div>`,
      ),
      ...stats.missing.map(
        (i) =>
          `<div class="sbk-issue"><span>第 ${i + 1} 页：还没有插画</span><button type="button" class="sbk-btn sbk-btn-mini" data-act="retry-page" data-page="${i}">补画</button></div>`,
      ),
      ...stats.incomplete.map(
        (i) =>
          `<div class="sbk-issue"><span>第 ${i + 1} 页：描述不完整</span><button type="button" class="sbk-btn sbk-btn-mini" data-act="edit-page" data-page="${i}">去补充</button></div>`,
      ),
    ].join('')

    return `<aside class="sbk-card sbk-check">
      <div class="sbk-card-head">
        <h2><span class="sbk-num">3</span>出版审查</h2>
        <span class="sbk-check-badge ${stats.ready ? 'ok' : 'warn'}">${stats.ready ? (isAssign() ? '可以提交' : '可以保存') : '有待处理'}</span>
      </div>
      <ul class="sbk-checklist">
        <li class="${stats.textOK ? 'ok' : 'warn'}">
          <span class="sbk-check-ico">${stats.textOK ? '✓' : '!'}</span>
          <div><b>文字描述</b><span>${stats.n - stats.incomplete.length} / ${stats.n} 页填写完整</span></div>
        </li>
        <li class="${stats.imagesOK ? 'ok' : 'warn'}">
          <span class="sbk-check-ico">${stats.imagesOK ? '✓' : '!'}</span>
          <div><b>插画完整</b><span>${stats.fresh} / ${stats.n} 页已绘制${stats.stale.length ? `（${stats.stale.length} 页描述已改）` : ''}</span></div>
        </li>
        <li class="ok">
          <span class="sbk-check-ico">✓</span>
          <div><b>成书拼接</b><span>封面 + ${stats.n} 页 + 封底</span></div>
        </li>
        <li class="ok">
          <span class="sbk-check-ico">✓</span>
          <div><b>书名与署名</b><span>《${esc(poemName())}》AI 课文绘本 · ${esc(nickname())}</span></div>
        </li>
      </ul>

      ${issueRows ? `<div class="sbk-issues">${issueRows}</div>` : ''}

      <label class="sbk-confirm ${stats.ready ? '' : 'disabled'}">
        <input type="checkbox" data-check="review" ${state.checkedReview ? 'checked' : ''} ${stats.ready ? '' : 'disabled'} />
        <span>我已逐页核对：插画与文字描述一致，可以${isAssign() ? '提交' : '保存'}。</span>
      </label>

      <div data-sbk-submit>${submitBoxHtml(stats)}</div>

      <div class="sbk-desc-preview">
        <h3>作品说明预览</h3>
        <p>${esc(workDesc())}</p>
      </div>
    </aside>`
  }

  function reviewHtml() {
    const steps = buildSteps()
    if (state.step >= steps.length) state.step = steps.length - 1
    if (state.step < 0) state.step = 0
    return `<div class="sbk-review">
      <section class="sbk-stage-card">
        <div class="sbk-stage-toolbar">
          <div class="sbk-seg" role="group" aria-label="阅读方式">
            <button type="button" class="${state.viewMode === 'spread' ? 'on' : ''}" data-act="mode-spread" aria-pressed="${state.viewMode === 'spread'}">${svgIcon('book')}翻页阅读</button>
            <button type="button" class="${state.viewMode === 'strip' ? 'on' : ''}" data-act="mode-strip" aria-pressed="${state.viewMode === 'strip'}">${svgIcon('film')}拼接长卷</button>
          </div>
          <div class="sbk-stage-actions">
            <button type="button" class="sbk-btn" data-act="edit">${svgIcon('pencil')}返回修改</button>
            <button type="button" class="sbk-btn" data-act="print">${svgIcon('printer')}打印绘本</button>
          </div>
        </div>
        ${state.viewMode === 'strip' ? stripStageHtml() : spreadStageHtml(steps)}
        ${filmstripHtml(steps)}
      </section>
      ${checklistHtml()}
    </div>`
  }

  // ── 渲染：提交成功 ─────────────────────────────────────────
  function submittedHtml() {
    const w = state.submitted || {}
    const title = w.title || `《${poemName()}》AI 课文绘本`
    return `<div class="sbk-submitted">
      <div class="sbk-card sbk-success-card">
        <div class="sbk-success-icon" aria-hidden="true">${svgIcon('checkCircle')}</div>
        <h2>已保存到个人作品</h2>
        <p class="sbk-success-sub">${esc(title)}</p>
        <div class="sbk-success-meta">
          <span>署名：${esc(w.author || nickname())}</span>
          <span>共 ${state.pages.length} 页</span>
          ${w.id ? `<span>作品编号：${esc(w.id)}</span>` : ''}
        </div>
        ${miniBookHtml(false)}
        <div class="sbk-success-actions">
          <button type="button" class="sbk-primary" data-act="works">去个人作品发布 ${svgIcon('chevronRight')}</button>
          <button type="button" class="sbk-btn" data-act="restart">再创作一本</button>
        </div>
        <p class="sbk-note">作品现在只在「我的作品」里，挑一份发布后才会出现在成果展厅。署名使用账号昵称。</p>
      </div>
    </div>`
  }

  // ── 渲染：学生作业已提交 ───────────────────────────────────
  function assignLabSubmittedHtml() {
    const sub = state.assignSubmission || {}
    const meta = state.assignMeta || {}
    const member = state.assignMember || {}
    const content = sub.content && typeof sub.content === 'object' ? sub.content : {}
    const score =
      typeof sub.score === 'number'
        ? sub.score
        : typeof content.score === 'number'
          ? content.score
          : state.assignLabResult
    const note = typeof content.note === 'string' ? content.note : state.assignLabNote
    const work = content.work && typeof content.work === 'object' ? content.work : null
    return `<div class="sbk-submitted">
      <div class="sbk-card sbk-success-card">
        <div class="sbk-success-icon" aria-hidden="true">${svgIcon('checkCircle')}</div>
        <h2>作业已提交</h2>
        <p class="sbk-success-sub">${esc(meta.className || '')} · ${esc(member.name || '')}</p>
        <div class="sbk-success-meta">
          <span>${esc(meta.labTitle || '互动练习')}</span>
          ${sub.published ? '<span>老师已选入成果展厅</span>' : '<span>等待老师查看</span>'}
        </div>
        <div class="sbk-assign-scorebox">
          <span>互动练习成绩</span>
          <strong>${typeof score === 'number' ? esc(score) : '—'}<small>分</small></strong>
        </div>
        ${work ? `<div class="sbk-assign-work"><b>${esc(work.title || '练习成果')}</b>${work.desc ? `<p>${esc(work.desc)}</p>` : ''}</div>` : ''}
        ${note ? `<div class="sbk-submit-note"><b>我的收获</b><p>${esc(note)}</p></div>` : ''}
        <div class="sbk-success-actions">
          <button type="button" class="sbk-primary" data-act="assign-leave">换一名同学</button>
        </div>
        <p class="sbk-note">老师会在班级管理的作业页面查看完成情况，并挑选优秀作品发布到成果展厅。如果老师还没有看到，或者需要重做，请让老师重置这份作业。</p>
      </div>
    </div>`
  }

  function assignTaskSubmittedHtml() {
    const sub = state.assignSubmission || {}
    const meta = state.assignMeta || {}
    const member = state.assignMember || {}
    const content = sub.content && typeof sub.content === 'object' ? sub.content : {}
    const text = typeof content.text === 'string' ? content.text : state.assignTaskText
    const rawImages = Array.isArray(content.images) ? content.images : state.assignTaskImages
    const images = rawImages.map(safeImg).filter(Boolean).slice(0, TASK_IMAGE_LIMIT)
    return `<div class="sbk-submitted">
      <div class="sbk-card sbk-success-card is-work">
        <div class="sbk-success-icon" aria-hidden="true">${svgIcon('checkCircle')}</div>
        <h2>作业已提交</h2>
        <p class="sbk-success-sub">${esc(meta.className || '')} · ${esc(member.name || '')}</p>
        <div class="sbk-success-meta">
          <span>${esc(meta.activity || meta.title || '课程任务')}</span>
          ${images.length ? `<span>${images.length} 张照片</span>` : ''}
          ${sub.published ? '<span>老师已选入成果展厅</span>' : '<span>等待老师查看</span>'}
        </div>
        <div class="sbk-submit-preview">
          ${text ? `<p class="sbk-submit-text">${esc(text)}</p>` : '<p class="sbk-note">这次提交没有文字内容。</p>'}
          ${images.length ? `<div class="sbk-task-photos is-readonly">${images.map((img, i) => `<figure class="sbk-task-thumb"><img src="${esc(img)}" alt="作业照片 ${i + 1}"></figure>`).join('')}</div>` : ''}
        </div>
        <div class="sbk-success-actions">
          <button type="button" class="sbk-primary" data-act="assign-leave">换一名同学</button>
        </div>
        <p class="sbk-note">老师会在班级管理的作业页面查看完成情况，并挑选优秀作品发布到成果展厅。如果老师还没有看到，或者需要重做，请让老师重置这份作业。</p>
      </div>
    </div>`
  }

  function assignStorybookSubmittedHtml() {
    const sub = state.assignSubmission || {}
    const meta = state.assignMeta || {}
    const member = state.assignMember || {}
    const hasBook = state.pages.some((p) => textComplete(p))
    return `<div class="sbk-submitted">
      <div class="sbk-card sbk-success-card">
        <div class="sbk-success-icon" aria-hidden="true">${svgIcon('checkCircle')}</div>
        <h2>作业已提交</h2>
        <p class="sbk-success-sub">${esc(meta.className || '')} · ${esc(member.name || '')}</p>
        <div class="sbk-success-meta">
          <span>《${esc(poemName())}》AI 课文绘本</span>
          <span>共 ${state.pages.length} 页</span>
          ${sub.published ? '<span>老师已选入成果展厅</span>' : '<span>等待老师查看</span>'}
        </div>
        ${hasBook ? miniBookHtml(false) : '<p class="sbk-note">成书内容暂时没有加载出来，刷新页面再试。</p>'}
        <div class="sbk-success-actions">
          <button type="button" class="sbk-primary" data-act="assign-leave">换一名同学</button>
        </div>
        <p class="sbk-note">老师会在班级管理的作业页面查看提交情况，并挑选优秀作品发布到成果展厅。如果老师还没有看到，或者需要重做，请让老师重置这份作业。</p>
      </div>
    </div>`
  }

  function assignSubmittedHtml() {
    const kind = assignKind()
    if (kind === 'lab') return assignLabSubmittedHtml()
    if (kind === 'task') return assignTaskSubmittedHtml()
    return assignStorybookSubmittedHtml()
  }

  // ── 渲染：学生作业入口 / 状态页 ────────────────────────────
  function assignLoadingHtml() {
    return `<div class="sbk-assign-shell">
      <div class="sbk-card sbk-assign-card sbk-assign-loading">
        <span class="sbk-spinner" aria-hidden="true"></span>
        <p>正在打开作业…</p>
      </div>
    </div>`
  }

  function assignErrorHtml() {
    return `<div class="sbk-assign-shell">
      <div class="sbk-card sbk-assign-card sbk-center">
        <div class="sbk-assign-badge is-error">${svgIcon('alert')}</div>
        <h1>作业打不开</h1>
        <p>${esc(state.assignError || '链接可能已经失效，请向老师要一份新的作业链接。')}</p>
        <button type="button" class="sbk-primary" data-act="assign-retry">重新加载</button>
      </div>
    </div>`
  }

  function assignClosedHtml() {
    const meta = state.assignMeta || {}
    return `<div class="sbk-assign-shell">
      <div class="sbk-card sbk-assign-card sbk-center">
        <div class="sbk-assign-badge">${svgIcon('notebook')}</div>
        <span class="sbk-assign-class">${esc(meta.className || '班级作业')}</span>
        <h1>${esc(meta.title || '作业')}</h1>
        <p>这份作业已经关闭，暂时不能开始或提交。请等老师重新开放，或向老师确认。</p>
        <button type="button" class="sbk-btn" data-act="assign-retry">重新检查</button>
      </div>
    </div>`
  }

  function assignGateHtml() {
    const meta = state.assignMeta || {}
    const kind = assignKind()
    const typeText = ASSIGN_TYPE_TEXT[kind] || '班级'
    const tag =
      kind === 'lab' && meta.labTitle
        ? `<span class="sbk-assign-tag">${svgIcon('play')}${esc(meta.labTitle)}</span>`
        : kind === 'task' && meta.activity
          ? `<span class="sbk-assign-tag">${svgIcon('notebook')}${esc(meta.activity)}</span>`
          : ''
    const hint =
      kind === 'lab'
        ? '不需要注册账号。姓名核对通过后打开互动练习，成绩会自动记录，再回来提交作业。'
        : kind === 'task'
          ? '不需要注册账号。姓名核对通过后按老师要求完成任务，可以写文字，也可以拍照上传作品。'
          : `不需要注册账号。姓名核对通过后，你就可以开始创作；每位同学最多可生成 ${Number(meta.aiLimit) || 8} 次插画。`
    return `<div class="sbk-assign-shell">
      <div class="sbk-card sbk-assign-card">
        <div class="sbk-assign-badge">${svgIcon(kind === 'lab' ? 'play' : 'notebook')}</div>
        <span class="sbk-assign-class">${esc(meta.className || '班级作业')}</span>
        <h1>${esc(meta.title || `${typeText}作业`)}</h1>
        <p class="sbk-assign-teacher">${esc(meta.teacherName || '老师')} 布置的${esc(typeText)}作业</p>
        ${tag ? `<div class="sbk-assign-tag-row is-center">${tag}</div>` : ''}
        ${meta.instructions ? `<div class="sbk-assign-instructions"><b>作业要求</b><p>${esc(meta.instructions)}</p></div>` : ''}
        <form class="sbk-assign-form" data-assign-form novalidate>
          <label for="sbk-assign-name">输入你的姓名</label>
          <input class="sbk-assign-input" id="sbk-assign-name" name="name" maxlength="30" autocomplete="name" value="${esc(state.assignName)}" placeholder="要和老师名单里的姓名一致">
          <button type="submit" class="sbk-primary sbk-assign-btn" ${state.assignBusy ? 'disabled' : ''}>${state.assignBusy ? '<span class="sbk-spinner" aria-hidden="true"></span>正在核对…' : '开始作业'}</button>
        </form>
        <p class="sbk-assign-error" role="alert">${esc(state.assignError || '')}</p>
        <p class="sbk-assign-hint">${hint}</p>
      </div>
    </div>`
  }

  function assignWorkShellHtml(inner) {
    const meta = state.assignMeta || {}
    const member = state.assignMember || {}
    return `<div class="sbk-assign-shell">
      <div class="sbk-card sbk-assign-card is-wide">
        <div class="sbk-assign-context">
          <span class="sbk-assign-class">${esc(meta.className || '班级作业')}</span>
          <span class="sbk-assign-member">${esc(member.name || '')}</span>
        </div>
        <div class="sbk-assign-workbench">${inner}</div>
      </div>
    </div>`
  }

  function assignLabHtml() {
    const meta = state.assignMeta || {}
    const score = state.assignLabResult
    const done = typeof score === 'number'
    return assignWorkShellHtml(`
      <div class="sbk-assign-workbench-head">
        <span class="sbk-assign-workbench-icon" aria-hidden="true">${svgIcon('play')}</span>
        <div class="sbk-assign-workbench-title">
          <h1>${esc(meta.labTitle || '互动练习')}</h1>
          <p>${esc(meta.teacherName || '老师')} 布置的互动练习作业</p>
        </div>
        ${done ? `<span class="sbk-assign-result">${svgIcon('award')}本次成绩 ${esc(score)} 分</span>` : ''}
      </div>
      ${meta.instructions ? `<div class="sbk-assign-instructions"><b>作业要求</b><p>${esc(meta.instructions)}</p></div>` : ''}
      <div class="sbk-assign-steps">
        <div class="sbk-assign-step"><span>1</span><p>打开互动练习，按页面提示完成全部任务。</p></div>
        <div class="sbk-assign-step"><span>2</span><p>成绩会自动记录。结束后点屏幕底部的「返回作业」。</p></div>
        <div class="sbk-assign-step"><span>3</span><p>选填一句收获，然后提交作业。</p></div>
      </div>
      <div class="sbk-assign-field">
        <label for="sbk-assign-lab-note">我的收获（选填）</label>
        <textarea class="sbk-assign-textarea is-short" id="sbk-assign-lab-note" maxlength="1000" data-assign-lab-note placeholder="例如：我学会了把问题拆成输入、分析、输出三步。">${esc(state.assignLabNote)}</textarea>
      </div>
      <p class="sbk-assign-error" role="alert">${esc(state.assignError || '')}</p>
      <div class="sbk-assign-actions">
        <button type="button" class="sbk-primary" data-act="assign-open-lab">${done ? '再练一次' : '打开互动练习'} ${svgIcon('chevronRight')}</button>
        ${done ? `<button type="button" class="sbk-btn sbk-assign-submit" data-act="assign-lab-submit" ${state.assignBusy ? 'disabled' : ''}>${state.assignBusy ? '<span class="sbk-spinner sbk-spinner-dark"></span>提交中…' : '提交作业'}</button>` : ''}
        <button type="button" class="sbk-btn" data-act="assign-leave">换一名同学</button>
      </div>
      <p class="sbk-assign-hint is-left">${done ? '成绩已记录，可以提交了。如果还想提高，可以再练一次，以最后一次成绩为准。' : '提交按钮会在你完成练习、拿到成绩后出现。中途离开前请先点「返回作业」，成绩会保留到本次会话结束。'}</p>
    `)
  }

  function assignTaskHtml() {
    const meta = state.assignMeta || {}
    const images = state.assignTaskImages || []
    const count = String(state.assignTaskText || '').length
    const stageText = ASSIGN_STAGE_TEXT[meta.stage] || ''
    const hasTool = !!(meta.toolLabId && meta.toolLabTitle)
    return assignWorkShellHtml(`
      <div class="sbk-assign-workbench-head">
        <span class="sbk-assign-workbench-icon is-task" aria-hidden="true">${svgIcon('notebook')}</span>
        <div class="sbk-assign-workbench-title">
          <h1>${esc(meta.activity || meta.title || '课程任务')}</h1>
          <p>${esc(meta.teacherName || '老师')} 布置的课程任务</p>
        </div>
      </div>
      <div class="sbk-assign-tag-row">
        ${meta.moduleId ? `<span class="sbk-assign-tag">${esc(String(meta.moduleId).toUpperCase())}</span>` : ''}
        ${stageText ? `<span class="sbk-assign-tag">${esc(stageText)}</span>` : ''}
        ${meta.title && meta.activity && meta.title !== meta.activity ? `<span class="sbk-assign-tag">${esc(meta.title)}</span>` : ''}
      </div>
      ${meta.instructions ? `<div class="sbk-assign-instructions"><b>作业要求</b><p>${esc(meta.instructions)}</p></div>` : ''}
      ${
        hasTool
          ? `<div class="sbk-assign-tool">
              <div>
                <b>${svgIcon('sparkles')}配套工具台：${esc(meta.toolLabTitle)}</b>
                <span>先在工具台完成练习，再回到这里写下结果。</span>
              </div>
              <button type="button" class="sbk-btn" data-act="assign-open-tool">打开工具台 ${svgIcon('chevronRight')}</button>
            </div>`
          : ''
      }
      <div class="sbk-assign-field">
        <label for="sbk-assign-task-text">作业内容</label>
        <textarea class="sbk-assign-textarea" id="sbk-assign-task-text" maxlength="5000" data-assign-task-text placeholder="写下你的观察、答案、设计思路或小组结论…">${esc(state.assignTaskText)}</textarea>
        <span class="sbk-assign-counter" data-assign-task-count>${count}/5000</span>
      </div>
      <div class="sbk-assign-field">
        <div class="sbk-assign-field-head">
          <label>照片记录 <span>（选填，最多 ${TASK_IMAGE_LIMIT} 张，不压缩）</span></label>
          ${images.length ? `<span class="sbk-assign-counter">${images.length}/${TASK_IMAGE_LIMIT}</span>` : ''}
        </div>
        <div class="sbk-task-photos">
          ${images
            .map(
              (img, i) =>
                `<figure class="sbk-task-thumb"><img src="${esc(img)}" alt="作业照片 ${i + 1}"><button type="button" data-act="assign-task-remove" data-i="${i}" aria-label="移除第 ${i + 1} 张照片">${svgIcon('close')}</button></figure>`,
            )
            .join('')}
          ${
            images.length < TASK_IMAGE_LIMIT
              ? `<label class="sbk-task-add">${svgIcon('plus')}<span>添加照片</span><input type="file" accept="image/png,image/jpeg,image/webp" multiple data-assign-task-file></label>`
              : ''
          }
        </div>
        <p class="sbk-assign-photo-hint">支持 PNG、JPG、WebP，单张约 1.3MB 以内。手工作品、实验记录可以直接拍照上传。</p>
      </div>
      <p class="sbk-assign-error" role="alert">${esc(state.assignTaskError || '')}</p>
      <div class="sbk-assign-actions">
        <button type="button" class="sbk-primary" data-act="assign-task-submit" ${state.assignTaskBusy ? 'disabled' : ''}>${state.assignTaskBusy ? '<span class="sbk-spinner"></span>提交中…' : '提交作业'}</button>
        <button type="button" class="sbk-btn" data-act="assign-leave">换一名同学</button>
      </div>
      <p class="sbk-assign-hint is-left">提交后老师会在班级管理的作业页面看到你的文字和照片。如果老师还没有处理，可以再次修改并提交。</p>
    `)
  }

  function assignShellHtml() {
    if (state.assignStatus === 'loading') return assignLoadingHtml()
    if (state.assignStatus === 'error') return assignErrorHtml()
    if (state.assignStatus === 'closed') return assignClosedHtml()
    if (state.assignStatus === 'gate') return assignGateHtml()
    if (state.assignStatus === 'lab') return assignLabHtml()
    if (state.assignStatus === 'task') return assignTaskHtml()
    if (state.assignStatus === 'submitted') return assignSubmittedHtml()
    return ''
  }

  // ── 渲染：打印页 ───────────────────────────────────────────
  function printSheetHtml() {
    return `<div class="sbk-print-sheet" aria-hidden="true">
      <div class="sbk-print-cover">
        <span>AI 课文绘本</span>
        <h1>《${esc(poemName())}》</h1>
        <p>${esc(nickname())} · 共 ${state.pages.length} 页</p>
      </div>
      ${state.pages
        .map((page, i) => {
          const img = pageImage(i)
          return `<div class="sbk-print-page">
            ${img ? `<img src="${esc(img)}" alt="">` : `<div class="sbk-print-missing">（第 ${i + 1} 页缺图）</div>`}
            <div class="sbk-print-cap"><b>第 ${i + 1} 页</b><span>${esc(sentenceFor(page))}</span></div>
          </div>`
        })
        .join('')}
      <div class="sbk-print-end"><p>—— 故事讲完了 ——</p><small>AI 启智课 · AI 课文绘本</small></div>
    </div>`
  }

  // ── 渲染入口 ───────────────────────────────────────────────
  function render() {
    if (!root) return
    // 学生作业的入口/状态页有自己的版式，不套创作台的步骤头
    if (isAssign() && state.assignStatus !== 'editor') {
      root.innerHTML = `<div class="sbk-container sbk-assign-page">${assignShellHtml()}</div>
        <div class="sbk-toast" data-sbk-toast role="status" aria-live="polite" aria-atomic="true"></div>`
      updateToast()
      return
    }
    const body =
      state.phase === 'generating'
        ? generatingHtml()
        : state.phase === 'review'
          ? reviewHtml()
          : state.phase === 'submitted'
            ? isAssign()
              ? assignSubmittedHtml()
              : submittedHtml()
            : composeHtml()
    root.innerHTML = `<div class="sbk-container">${headHtml()}${body}</div>
      <div class="sbk-toast" data-sbk-toast role="status" aria-live="polite" aria-atomic="true"></div>
      ${state.phase === 'review' ? printSheetHtml() : ''}`
    updateToast()
  }

  function updateCta() {
    const box = root && root.querySelector('[data-sbk-cta]')
    if (box) box.innerHTML = composeCtaHtml()
  }

  function updateSubmitBox() {
    const box = root && root.querySelector('[data-sbk-submit]')
    if (box) box.innerHTML = submitBoxHtml(reviewStats())
  }

  function refreshComposeLive() {
    if (state.phase !== 'compose' || !root) return
    const page = state.pages[state.current]
    if (!page) return
    const sentenceEl = root.querySelector('[data-live="sentence"]')
    if (sentenceEl) sentenceEl.textContent = sentenceFor(page)
    const clarityEl = root.querySelector('[data-live="clarity"]')
    if (clarityEl) clarityEl.textContent = `清晰度 ${clarityOf(page)}%`
    const capEl = root.querySelector(`[data-mini-cap="${state.current}"]`)
    if (capEl) capEl.textContent = miniCaption(page)
    const emoEl = root.querySelector(`[data-mini-emo="${state.current}"]`)
    if (emoEl) emoEl.textContent = emojiFor(page.who)
    const warnEl = root.querySelector(`[data-mini-warn="${state.current}"]`)
    if (warnEl) warnEl.hidden = !isStale(state.current)
    state.pages.forEach((_, i) => {
      const dot = root.querySelector(`[data-tab-dot="${i}"]`)
      if (dot) dot.className = 'sbk-dot ' + dotClass(i)
    })
    updateCta()
  }

  // ── 动作：编排 ─────────────────────────────────────────────
  function selectPoem(i) {
    if (i === state.poemIndex) return
    state.seq++
    state.poemIndex = i
    state.customPoemName = ''
    state.pages = [emptyPage()]
    state.images = [null]
    state.from = [null]
    state.current = 0
    state.phase = 'compose'
    state.checkedReview = false
    state.submitted = null
    state.submitError = ''
    state.gen = { total: 0, done: 0, ok: 0, fail: 0 }
    state.genTargets = []
    state.genFailed = []
    render()
  }

  function askSelectPoem(i) {
    if (i === state.poemIndex) return
    if (!anyWorkStarted()) {
      selectPoem(i)
      return
    }
    openConfirm({
      title: '换一篇课文？',
      message: '当前编排和已经生成的插画会被清空，无法恢复。',
      confirmLabel: '清空并更换',
      danger: true,
      onConfirm: () => selectPoem(i),
    })
  }

  function askDeletePage() {
    if (state.pages.length <= 1) return
    if (!pageHasWork(state.current)) {
      deletePage()
      return
    }
    openConfirm({
      title: `删除第 ${state.current + 1} 页？`,
      message: '这一页的文字或插画会一起删除，后面页的顺序会前移。',
      confirmLabel: '删除本页',
      danger: true,
      onConfirm: deletePage,
    })
  }

  function askRegenAll() {
    if (state.phase === 'generating') return
    openConfirm({
      title: '重新生成全部插画？',
      message: `会重新调用 AI 绘制 ${state.pages.length} 页并覆盖现有插画，通常需要 8–60 秒。`,
      confirmLabel: '重新生成',
      onConfirm: () => generateIndices(state.pages.map((_, i) => i)),
    })
  }

  function addPage() {
    if (state.pages.length >= MAX_PAGES) {
      toast(`最多 ${MAX_PAGES} 页，够讲一个完整故事啦`, 'warn')
      return
    }
    state.seq++
    state.pages.push(emptyPage())
    state.images.push(null)
    state.from.push(null)
    state.current = state.pages.length - 1
    state.phase = 'compose'
    state.checkedReview = false
    render()
    requestAnimationFrame(() => {
      const el = root && root.querySelector('[data-field="who"]')
      if (el) el.focus()
    })
  }

  function deletePage() {
    if (state.pages.length <= 1) return
    state.seq++
    state.pages.splice(state.current, 1)
    state.images.splice(state.current, 1)
    state.from.splice(state.current, 1)
    if (state.current >= state.pages.length) state.current = state.pages.length - 1
    state.phase = 'compose'
    state.checkedReview = false
    render()
    toast('已删除本页，插画顺序已同步调整', 'info')
  }

  function pickChip(field, value) {
    const page = state.pages[state.current]
    if (!page) return
    page[field] = page[field] === value ? '' : value
    render()
  }

  // ── 动作：生成 ─────────────────────────────────────────────
  async function generateIndices(indices) {
    if (state.phase === 'generating' || !indices.length) return
    if (isAssign() && assignRemaining() <= 0) {
      toast('这份作业的 AI 生成次数已用完，请联系老师重置作业', 'warn')
      return
    }
    if (!state.pages.every(textComplete)) {
      toast('每一页都要填「谁 / 在哪 / 做什么」', 'warn')
      return
    }
    const origin = state.phase === 'review' ? 'review' : 'compose'
    const seq = ++state.seq
    state.genTargets = indices.slice()
    state.genFailed = []
    state.gen = { total: indices.length, done: 0, ok: 0, fail: 0 }
    state.checkedReview = false
    state.submitError = ''
    state.phase = 'generating'
    render()
    scrollTopStudio()

    let quotaStopped = false
    try {
      for (let start = 0; start < indices.length; start += BATCH) {
        // 每批 = 一次真实计费；学生配额按次扣，批次之间要重新检查
        if (isAssign() && assignRemaining() <= 0) {
          quotaStopped = true
          break
        }
        const batch = indices.slice(start, start + BATCH)
        const prompts = batch.map((idx) => promptFor(state.pages[idx], idx))
        const res = await fetch('/api/ai/storybook', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompts }),
        })
        const payload = await res.json().catch(() => ({}))
        if (seq !== state.seq) return
        if (!res.ok) {
          throw new Error((payload && payload.error && payload.error.message) || '插画生成失败，请稍后再试')
        }
        if (isAssign() && state.assignSubmission) {
          state.assignSubmission.aiCalls = (Number(state.assignSubmission.aiCalls) || 0) + 1
        }
        const imgs = Array.isArray(payload.images) ? payload.images : []
        batch.forEach((idx, k) => {
          const img = safeImg(imgs[k])
          if (img) {
            state.images[idx] = img
            state.from[idx] = pageSnapshot(state.pages[idx])
            state.gen.ok++
          } else {
            state.gen.fail++
            if (!state.genFailed.includes(idx)) state.genFailed.push(idx)
          }
          state.gen.done++
        })
        if (seq !== state.seq) return
        render()
      }

      if (state.gen.ok === 0) {
        state.phase = origin
        toast('这一轮没有画出插画，请稍后再试', 'error')
      } else {
        markProgress()
        state.phase = 'review'
        if (origin === 'review') {
          state.step = Math.min(state.step, buildSteps().length - 1)
        } else {
          state.step = 0
          state.stripFocus = -1
        }
        state.checkedReview = false
        toast(
          quotaStopped
            ? `AI 生成次数已用完，这次画好了 ${state.gen.ok} 页；其余页面请联系老师重置作业`
            : state.gen.fail
              ? `画好了 ${state.gen.ok} 页，有 ${state.gen.fail} 页没成功，可在审查页重绘`
              : '插画生成完成，开始逐页审查吧',
          quotaStopped || state.gen.fail ? 'warn' : 'success',
        )
      }
    } catch (e) {
      if (seq !== state.seq) return
      state.phase = origin
      toast(errorMessage(e, '插画生成失败，请稍后再试'), 'error')
    } finally {
      if (seq === state.seq) {
        render()
        scrollTopStudio()
      }
    }
  }

  function promptFor(p, index) {
    let text = `儿童绘本插画（水彩童书风格，构图简洁、色彩明亮），第${index + 1}页：${trimField(p.who)}在${trimField(p.where)}，${trimField(p.doing)}`
    if (p.color) text += `，以${p.color}为主色调`
    if (p.mood) text += `，画面氛围${p.mood}`
    text += `。故事《${poemName()}》。画面中不要出现文字。`
    return text
  }

  // ── 动作：审查 / 提交 ──────────────────────────────────────
  function moveStep(dir) {
    const len = buildSteps().length
    state.step = Math.min(len - 1, Math.max(0, state.step + dir))
    render()
  }

  function moveFocus(dir) {
    if (state.viewMode === 'spread') {
      moveStep(dir)
      return
    }
    const n = state.pages.length
    state.stripFocus = Math.min(n, Math.max(-1, (state.stripFocus || 0) + dir))
    if (state.stripFocus === -1) state.step = 0
    else if (state.stripFocus >= n) state.step = buildSteps().length - 1
    else state.step = stepForPage(state.stripFocus)
    render()
    scrollStripTo(state.stripFocus)
  }

  function scrollStripTo(item) {
    requestAnimationFrame(() => {
      const el = root && root.querySelector(`[data-strip-item="${item}"]`)
      if (el) {
        try {
          el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
        } catch {
          /* 老浏览器不支持 options，忽略 */
        }
      }
    })
  }

  function handleFilm(item) {
    const n = state.pages.length
    if (item === -1) {
      state.step = 0
      state.stripFocus = -1
    } else if (item >= n) {
      state.step = buildSteps().length - 1
      state.stripFocus = n
    } else {
      state.step = stepForPage(item)
      state.stripFocus = item
    }
    render()
    if (state.viewMode === 'strip') scrollStripTo(state.stripFocus)
  }

  function enterReview() {
    if (missingIndices().length) {
      toast('还有页面没有插画，先补全再审查', 'warn')
      return
    }
    state.phase = 'review'
    state.step = 0
    state.stripFocus = -1
    state.checkedReview = false
    state.submitError = ''
    render()
    scrollTopStudio()
  }

  function editFromReview() {
    const step = buildSteps()[state.step]
    const pageIndex = step && step.pages ? step.pages[0] : 0
    state.phase = 'compose'
    state.current = Math.min(pageIndex, state.pages.length - 1)
    state.checkedReview = false
    render()
    scrollTopStudio()
  }

  function goStep(i) {
    if (state.phase === 'generating' || state.phase === 'submitted') return
    if (i === 0) {
      if (state.phase === 'review') editFromReview()
      else scrollTopStudio()
      return
    }
    if (i === 1) {
      if (!state.pages.every(textComplete)) {
        if (state.phase === 'review') editFromReview()
        else {
          state.phase = 'compose'
          render()
          scrollTopStudio()
        }
        toast('先把每一页的「谁 / 在哪 / 做什么」填完整，再生成插画', 'warn')
        return
      }
      const missing = missingIndices()
      if (!missing.length) {
        toast(`插画已经全部画好，点「${isAssign() ? '审查提交' : '审查发布'}」检查成书`, 'info')
        return
      }
      generateIndices(missing)
      return
    }
    if (i === 2) {
      if (state.phase === 'review') {
        scrollTopStudio()
        return
      }
      const stats = reviewStats()
      if (!stats.textOK) {
        state.phase = 'compose'
        state.checkedReview = false
        render()
        scrollTopStudio()
        toast('还有页面描述不完整，先在「编排故事」里补齐', 'warn')
        return
      }
      if (!stats.imagesOK) {
        toast(`还有 ${stats.missing.length + stats.stale.length} 页插画没准备好，先点「生成插画」`, 'warn')
        return
      }
      enterReview()
    }
  }

  async function submitWork() {
    if (state.submitting) return
    const stats = reviewStats()
    if (!stats.ready) {
      toast('还有页面没有插画或描述不完整', 'warn')
      return
    }
    if (!state.checkedReview) {
      toast('请先逐页核对并勾选确认项', 'warn')
      return
    }

    // ── 学生作业：提交到这一份作业，而不是个人作品库 ──
    if (isAssign()) {
      if (!state.assignToken) {
        toast('作业链接已失效，请重新打开老师发的链接', 'error')
        return
      }
      state.submitting = true
      state.submitError = ''
      render()
      try {
        const data = await assignApi(`/api/assign/${encodeURIComponent(state.assignToken)}/submit`, {
          method: 'POST',
          body: {
            poemName: poemName(),
            pages: state.pages.map((p, i) => ({
              who: trimField(p.who),
              where: trimField(p.where),
              doing: trimField(p.doing),
              color: p.color || '',
              mood: p.mood || '',
              image: state.images[i],
            })),
          },
        })
        state.submitting = false
        if (!data || !data.ok) throw new Error('提交失败，请稍后再试')
        if (state.assignSubmission) {
          state.assignSubmission.status = 'submitted'
          state.assignSubmission.submittedAt = data.submission && data.submission.submittedAt
        }
        state.assignStatus = 'submitted'
        state.phase = 'submitted'
        state.submitted = { title: `《${poemName()}》AI 课文绘本` }
        render()
        scrollTopStudio()
        return
      } catch (e) {
        state.submitError = errorMessage(e, '提交失败，请稍后再试')
        toast(state.submitError, 'error')
      }
      state.submitting = false
      render()
      return
    }

    state.submitting = true
    state.submitError = ''
    render()
    try {
      const res = await fetch('/api/works', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `《${poem().name}》AI 课文绘本`,
          type: 'AI 课文绘本',
          grade: 'low',
          module: 'm2',
          desc: workDesc(),
          // 插画必须跟着作品一起进库：只传文字的话，展厅里的绘本会退化成
          // 一页页说明文字，学生刚生成的图全丢了。提交前 reviewStats
          // 已保证每页都有最新插画，这里的顺序与页序一致。
          images: state.pages.map((_, i) => pageImage(i)).filter(Boolean),
          hue: 280,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error((data && data.error && data.error.message) || '保存失败，请稍后再试')
      }
      state.submitted = data.work || {}
      state.phase = 'submitted'
      state.submitting = false
      render()
      scrollTopStudio()
      return
    } catch (e) {
      state.submitError = errorMessage(e, '保存失败，请稍后再试')
      toast(state.submitError, 'error')
    }
    state.submitting = false
    render()
  }

  function restart() {
    state.seq++
    state.customPoemName = ''
    state.pages = [emptyPage()]
    state.images = [null]
    state.from = [null]
    state.current = 0
    state.phase = 'compose'
    state.step = 0
    state.stripFocus = -1
    state.gen = { total: 0, done: 0, ok: 0, fail: 0 }
    state.genTargets = []
    state.genFailed = []
    state.checkedReview = false
    state.submitting = false
    state.submitError = ''
    state.submitted = null
    state.toast = null
    render()
    scrollTopStudio()
  }

  // ── 学生作业：加载 / 姓名校验 / 换人 ───────────────────────
  function hydrateLabFromSubmission(sub) {
    const content = sub && sub.content
    if (!content || typeof content !== 'object') return
    if (Number.isInteger(content.score)) state.assignLabResult = content.score
    if (typeof content.note === 'string') state.assignLabNote = content.note
  }

  function hydrateTaskFromSubmission(sub) {
    const content = sub && sub.content
    if (!content || typeof content !== 'object') return
    if (typeof content.text === 'string') state.assignTaskText = content.text
    if (Array.isArray(content.images)) {
      state.assignTaskImages = content.images.map(safeImg).filter(Boolean).slice(0, TASK_IMAGE_LIMIT)
    }
  }

  /** 按作业类型把服务器状态映射到对应的学生页面 */
  function routeAssignSession() {
    const meta = state.assignMeta || {}
    const kind = assignKind()
    const sub = state.assignSubmission
    const submitted = !!(sub && sub.status === 'submitted')
    if (!state.assignMember) {
      state.assignStatus = meta.status === 'open' ? 'gate' : 'closed'
      return
    }
    if (kind === 'lab') {
      if (submitted) {
        hydrateLabFromSubmission(sub)
        clearLabDraft()
        state.assignStatus = 'submitted'
      } else {
        loadLabDraft()
        state.assignStatus = meta.status === 'open' ? 'lab' : 'closed'
      }
      return
    }
    if (kind === 'task') {
      if (submitted) {
        hydrateTaskFromSubmission(sub)
        state.assignStatus = 'submitted'
      } else {
        state.assignStatus = meta.status === 'open' ? 'task' : 'closed'
      }
      return
    }
    if (submitted) {
      hydrateFromSubmission(sub)
      state.assignStatus = 'submitted'
      state.phase = 'submitted'
    } else if (meta.status !== 'open') {
      state.assignStatus = 'closed'
    } else {
      state.assignStatus = 'editor'
      state.phase = 'compose'
    }
  }

  async function loadAssign() {
    const my = ++state.seq
    state.assignStatus = 'loading'
    state.assignError = ''
    render()
    const token = state.assignToken
    if (!token) {
      state.assignStatus = 'error'
      state.assignError = '作业链接不正确'
      render()
      return
    }
    try {
      const metaRes = await assignApi(`/api/assign/${encodeURIComponent(token)}`)
      if (my !== state.seq) return
      state.assignMeta = (metaRes && metaRes.assignment) || null
      if (!state.assignMeta) throw new Error('作业链接不存在或已失效')

      const meRes = await assignApi(`/api/assign/${encodeURIComponent(token)}/me`)
      if (my !== state.seq) return
      state.assignMember = (meRes && meRes.member) || null
      state.assignSubmission = (meRes && meRes.submission) || null

      routeAssignSession()
      state.assignLoaded = true
      render()
      document.title = `${state.assignMeta.className} · ${state.assignMeta.title}`
    } catch (e) {
      if (my !== state.seq) return
      state.assignStatus = 'error'
      state.assignError = errorMessage(e, '作业链接可能已失效，请向老师要一份新的链接')
      render()
    }
  }

  async function verifyAssignName(rawName) {
    const name = String(rawName || '')
      .replace(/[　\r\n\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name) {
      state.assignError = '请先输入你的姓名'
      render()
      return
    }
    if (state.assignBusy) return
    state.assignName = name
    state.assignBusy = true
    state.assignError = ''
    render()
    const my = state.seq
    try {
      const data = await assignApi(`/api/assign/${encodeURIComponent(state.assignToken)}/verify`, {
        method: 'POST',
        body: { name },
      })
      if (my !== state.seq) return
      state.assignMember = (data && data.member) || null
      state.assignSubmission = (data && data.submission) || null
      if (!state.assignMember) throw new Error('姓名核对失败，请重试')
      state.assignBusy = false
      routeAssignSession()
      render()
      scrollTopStudio()
    } catch (e) {
      if (my !== state.seq) return
      state.assignBusy = false
      state.assignError = errorMessage(e, '姓名核对失败，请重试')
      render()
    }
  }

  async function leaveAssign() {
    const kind = assignKind()
    const hasWork =
      isAssign() &&
      state.assignStatus !== 'submitted' &&
      (kind === 'lab'
        ? typeof state.assignLabResult === 'number' || !!state.assignLabNote.trim()
        : kind === 'task'
          ? !!state.assignTaskText.trim() || state.assignTaskImages.length > 0
          : state.assignStatus === 'editor' && anyWorkStarted())
    const doLeave = async () => {
      try {
        await assignApi(`/api/assign/${encodeURIComponent(state.assignToken)}/leave`, { method: 'POST', body: {} })
      } catch {
        /* cookie 已经过期时也按换人成功处理 */
      }
      stopSupervisor()
      clearLabDraft()
      state.seq++
      state.assignMember = null
      state.assignSubmission = null
      state.assignName = ''
      state.assignError = ''
      state.assignBusy = false
      state.assignStatus = state.assignMeta && state.assignMeta.status !== 'open' ? 'closed' : 'gate'
      // 换人必须清掉上一个学生的内容，避免同一台设备上串作品
      state.customPoemName = ''
      state.pages = [emptyPage()]
      state.images = [null]
      state.from = [null]
      state.current = 0
      state.phase = 'compose'
      state.step = 0
      state.stripFocus = -1
      state.checkedReview = false
      state.submitted = null
      state.submitError = ''
      state.assignLabResult = null
      state.assignLabNote = ''
      state.assignTaskText = ''
      state.assignTaskImages = []
      state.assignTaskBusy = false
      state.assignTaskError = ''
      render()
      scrollTopStudio()
    }
    if (hasWork) {
      openConfirm({
        title: '换一名同学？',
        message: '当前还没有提交的编排和插画会清空，无法恢复。',
        confirmLabel: '换人',
        danger: true,
        onConfirm: doLeave,
      })
      return
    }
    await doLeave()
  }

  // ── 事件绑定 ───────────────────────────────────────────────
  function onRootClick(e) {
    const btn = e.target.closest ? e.target.closest('[data-act]') : null
    if (!btn || !root || !root.contains(btn)) return
    const act = btn.dataset.act
    switch (act) {
      case 'back-lab':
        navigate('/lab')
        break
      case 'go-step':
        goStep(Number(btn.dataset.step))
        break
      case 'poem':
        askSelectPoem(Number(btn.dataset.i))
        break
      case 'tab':
        state.current = Number(btn.dataset.i)
        render()
        break
      case 'add-page':
        addPage()
        break
      case 'del-page':
        askDeletePage()
        break
      case 'chip':
        pickChip(btn.dataset.field, btn.dataset.value)
        break
      case 'mini-page': {
        let i = Number(btn.dataset.i)
        if (i === -1) i = 0
        if (i === -2) i = state.pages.length - 1
        if (i >= 0 && i < state.pages.length) {
          state.current = i
          render()
        }
        break
      }
      case 'generate':
        generateIndices(missingIndices())
        break
      case 'regen-all':
        askRegenAll()
        break
      case 'review':
        enterReview()
        break
      case 'mode-spread':
        state.viewMode = 'spread'
        render()
        break
      case 'mode-strip':
        state.viewMode = 'strip'
        render()
        scrollStripTo(state.stripFocus)
        break
      case 'edit':
        editFromReview()
        break
      case 'print':
        window.print()
        break
      case 'prev':
        moveStep(-1)
        break
      case 'next':
        moveStep(1)
        break
      case 'film':
        handleFilm(Number(btn.dataset.item))
        break
      case 'retry-page': {
        const i = Number(btn.dataset.page)
        if (Number.isInteger(i) && i >= 0 && i < state.pages.length) generateIndices([i])
        break
      }
      case 'edit-page':
        state.phase = 'compose'
        state.current = Number(btn.dataset.page)
        state.checkedReview = false
        render()
        scrollTopStudio()
        break
      case 'submit':
        submitWork()
        break
      case 'works':
        navigate('/me/works')
        break
      case 'restart':
        restart()
        break
      case 'assign-leave':
        leaveAssign()
        break
      case 'assign-retry':
        loadAssign()
        break
      case 'assign-open-lab':
      case 'assign-open-tool':
        openAssignTool()
        break
      case 'assign-lab-submit':
        submitLabAssignment()
        break
      case 'assign-task-submit':
        submitTaskAssignment()
        break
      case 'assign-task-remove':
        removeTaskImage(Number(btn.dataset.i))
        break
    }
  }

  function onRootSubmit(e) {
    const form = e.target.closest ? e.target.closest('[data-assign-form]') : null
    if (!form || !root || !root.contains(form)) return
    e.preventDefault()
    const input = form.querySelector('input[name="name"]')
    verifyAssignName(input ? input.value : '')
  }

  function onRootInput(e) {
    const target = e.target
    if (!target) return
    if (target.id === 'sbk-assign-name') {
      state.assignName = target.value
      return
    }
    if (target.hasAttribute && target.hasAttribute('data-assign-task-text')) {
      state.assignTaskText = target.value
      const counter = root && root.querySelector('[data-assign-task-count]')
      if (counter) counter.textContent = `${target.value.length}/5000`
      return
    }
    if (target.hasAttribute && target.hasAttribute('data-assign-lab-note')) {
      state.assignLabNote = target.value
      saveLabDraft()
      return
    }
    const el = target.closest ? target.closest('[data-field]') : null
    if (!el || !root || !root.contains(el)) return
    const key = el.dataset.field
    if (key !== 'who' && key !== 'where' && key !== 'doing') return
    const page = state.pages[state.current]
    if (!page) return
    page[key] = el.value
    refreshComposeLive()
  }

  function onRootChange(e) {
    const file = e.target && e.target.closest ? e.target.closest('[data-assign-task-file]') : null
    if (file) {
      const picked = Array.from(file.files || [])
      file.value = ''
      if (picked.length) addTaskImages(picked)
      return
    }
    const el = e.target && e.target.closest ? e.target.closest('[data-check="review"]') : null
    if (!el) return
    state.checkedReview = !!el.checked
    updateSubmitBox()
  }

  function bindEvents() {
    root.addEventListener('click', onRootClick)
    root.addEventListener('input', onRootInput)
    root.addEventListener('change', onRootChange)
    root.addEventListener('submit', onRootSubmit)
    keyHandler = (e) => {
      if (modalEl || state.phase !== 'review') return
      const tag = ((e.target && e.target.tagName) || '').toLowerCase()
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        moveFocus(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        moveFocus(1)
      }
    }
    document.addEventListener('keydown', keyHandler)
  }

  // ── 样式 ───────────────────────────────────────────────────
  function ensureStyle() {
    if (document.getElementById('sbk-studio-style')) return
    const style = document.createElement('style')
    style.id = 'sbk-studio-style'
    style.textContent = `
.sbk-page{--sbk-accent:var(--aiq-accent,#3559f6);--sbk-border:var(--aiq-border,#e4e8f2);--sbk-card:var(--aiq-panel-solid,#fff);--sbk-muted:var(--aiq-text-mute,#67718a);--sbk-soft:var(--aiq-bg-soft,#f2f5fc);color:var(--aiq-text,#182033);font-size:14px;line-height:1.55;padding:2px 0 36px}
.sbk-page *{box-sizing:border-box}
.sbk-container{width:min(1200px,calc(100% - 48px));margin:0 auto;padding:8px 0 64px}
.sbk-page button{font-family:inherit}
.sbk-page button:focus-visible,.sbk-modal button:focus-visible{outline:2px solid var(--sbk-accent,#3559f6);outline-offset:2px}
.sbk-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.sbk-i{width:1em;height:1em;flex:none;display:inline-block;vertical-align:-.13em}
.sbk-crumbs{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:0 0 16px;font-size:13px;color:var(--sbk-muted)}
.sbk-crumb-link{border:none;background:none;padding:2px 0;color:var(--sbk-accent);font-size:13px;font-weight:600;cursor:pointer;min-height:24px}
.sbk-crumb-link:hover{text-decoration:underline}
.sbk-crumb-now{color:var(--aiq-text-soft,var(--sbk-muted))}
.sbk-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:14px 24px;margin:0 0 20px;padding:20px 24px;border:1px solid var(--sbk-border);border-radius:20px;background:linear-gradient(120deg,rgba(168,85,247,.1),transparent)}
.sbk-hero-main{display:flex;align-items:center;gap:16px;min-width:0}
.sbk-hero-icon{width:48px;height:48px;flex:none;display:grid;place-items:center;border-radius:12px;color:#fff;font-size:23px;background:linear-gradient(135deg,#a855f7,#ec4899);box-shadow:0 10px 22px -12px rgba(168,85,247,.8)}
.sbk-hero-text{min-width:0}
.sbk-hero h1{margin:0;font-size:22px;font-weight:900;letter-spacing:-.01em;line-height:1.3}
.sbk-hero-text p{margin:2px 0 0;color:var(--sbk-muted);font-size:13px;line-height:1.55}
.sbk-hero-meta{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.sbk-meta-pill{font-size:12px;font-weight:600;color:var(--sbk-muted);background:var(--sbk-card);border:1px solid var(--sbk-border);border-radius:999px;padding:3px 10px;white-space:nowrap}
.sbk-meta-pill.accent{color:var(--sbk-accent);border-color:rgba(53,89,246,.28);background:rgba(53,89,246,.07)}
.sbk-steps{grid-column:1/-1;list-style:none;display:flex;align-items:center;gap:10px;margin:0;padding:14px 0 0;border-top:1px solid var(--sbk-border);flex-wrap:wrap}
.sbk-step{display:flex;align-items:center;opacity:.55;transition:.2s;position:relative}
.sbk-step + .sbk-step::before{content:"";position:absolute;left:-7px;top:50%;width:8px;height:1px;background:var(--sbk-border)}
.sbk-step-btn{display:flex;align-items:center;gap:8px;padding:5px 12px 5px 6px;min-height:38px;border:none;border-radius:999px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:.16s}
.sbk-step-btn:hover:not(:disabled){background:rgba(53,89,246,.07)}
.sbk-step-btn:disabled{cursor:default}
.sbk-step.active,.sbk-step.done{opacity:1}
.sbk-step.active .sbk-step-btn{background:rgba(53,89,246,.08);box-shadow:0 0 0 1px rgba(53,89,246,.22) inset}
.sbk-steps-hint{margin-left:auto;font-size:11px;font-weight:500;color:var(--sbk-muted);padding-left:8px}
.sbk-step.done .sbk-step-num{background:rgba(22,163,74,.12);color:#15803d}
.sbk-step-num{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:800;background:var(--sbk-soft);color:var(--sbk-muted);flex:none}
.sbk-step-num .sbk-i{font-size:17px}
.sbk-step.active .sbk-step-num{background:var(--sbk-accent);color:#fff}
.sbk-step-text{display:flex;flex-direction:column;line-height:1.25}
.sbk-step-text b{font-size:12.5px}
.sbk-step-text > span{font-size:11px;color:var(--sbk-muted)}
.sbk-card{background:var(--sbk-card);border:1px solid var(--sbk-border);border-radius:20px;padding:20px;box-shadow:0 10px 34px -24px rgba(18,30,60,.35)}
.sbk-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}
.sbk-card-head h2{margin:0;font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px}
.sbk-num{width:22px;height:22px;border-radius:8px;background:rgba(53,89,246,.1);color:var(--sbk-accent);display:inline-grid;place-items:center;font-size:12px;font-weight:800;flex:none}
.sbk-hint,.sbk-note{color:var(--sbk-muted);font-size:12px}
.sbk-note{margin:12px 0 0;line-height:1.65}
.sbk-compose-grid{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(0,1fr);gap:18px;align-items:start}
.sbk-col{display:flex;flex-direction:column;gap:18px;min-width:0}
.sbk-preview-col{position:sticky;top:84px}
.sbk-poems{display:flex;flex-wrap:wrap;gap:8px}
.sbk-poem{border:1px solid var(--sbk-border);background:var(--sbk-soft);color:var(--aiq-text);border-radius:999px;padding:9px 17px;min-height:40px;font-size:13px;font-weight:600;cursor:pointer;transition:.18s}
.sbk-poem:hover{border-color:rgba(53,89,246,.35);color:var(--sbk-accent)}
.sbk-poem.on{background:var(--sbk-accent);border-color:var(--sbk-accent);color:#fff;box-shadow:0 8px 18px -10px rgba(53,89,246,.7)}
.sbk-tabs{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px}
.sbk-tab{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--sbk-border);background:transparent;color:var(--sbk-muted);border-radius:10px;padding:7px 12px;min-height:36px;font-size:12px;font-weight:600;cursor:pointer}
.sbk-tab:hover{border-color:rgba(53,89,246,.35)}
.sbk-tab.on{background:rgba(53,89,246,.1);border-color:rgba(53,89,246,.35);color:var(--sbk-accent)}
.sbk-tab-add{padding:6px 10px;font-size:14px;line-height:1}
.sbk-tab:disabled,.sbk-btn:disabled,.sbk-primary:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.sbk-dot{width:6px;height:6px;border-radius:50%;display:inline-block;background:#c7cedd}
.sbk-dot.ok{background:#16a34a}
.sbk-dot.stale{background:#f59e0b}
.sbk-dot.miss{background:#c7cedd}
.sbk-page-editor{background:var(--sbk-soft);border:1px solid var(--sbk-border);border-radius:16px;padding:16px}
.sbk-editor-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.sbk-editor-title{font-size:12.5px;font-weight:700;color:var(--sbk-muted)}
.sbk-clarity{font-size:11.5px;font-weight:700;color:var(--sbk-accent);background:rgba(53,89,246,.1);border-radius:999px;padding:3px 9px}
.sbk-fields{display:flex;flex-direction:column;gap:13px}
.sbk-field-label{font-size:12px;font-weight:600;color:var(--sbk-muted);margin-bottom:6px;display:flex;align-items:center;gap:5px}
.sbk-input{width:100%;border:1px solid var(--sbk-border);background:var(--sbk-card);color:var(--aiq-text);border-radius:11px;padding:10px 13px;font-size:13.5px;outline:none;transition:.16s}
.sbk-input::placeholder{color:var(--sbk-muted);opacity:.7}
.sbk-input:focus{border-color:var(--sbk-accent);box-shadow:0 0 0 3px rgba(53,89,246,.13)}
.sbk-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}
.sbk-chip{border:1px solid var(--sbk-border);background:var(--sbk-card);color:var(--sbk-muted);border-radius:999px;padding:6px 12px;min-height:32px;font-size:12px;font-weight:600;cursor:pointer;transition:.15s}
.sbk-chip:hover{border-color:rgba(53,89,246,.35);color:var(--sbk-accent)}
.sbk-chip.on{background:rgba(53,89,246,.12);border-color:rgba(53,89,246,.4);color:var(--sbk-accent)}
.sbk-field-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.sbk-sentence{margin-top:14px;border-radius:12px;border:1px dashed rgba(53,89,246,.35);background:rgba(53,89,246,.06);padding:11px 14px}
.sbk-sentence-head{font-size:11px;font-weight:700;color:var(--sbk-accent);margin-bottom:4px}
.sbk-sentence p{margin:0;font-size:13.5px;font-weight:600;line-height:1.65;min-height:22px}
.sbk-editor-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.sbk-btn{border:1px solid var(--sbk-border);background:var(--sbk-card);color:var(--aiq-text);border-radius:999px;padding:8px 15px;min-height:36px;font-size:12.5px;font-weight:600;cursor:pointer;transition:.16s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.sbk-btn:hover{border-color:rgba(53,89,246,.4);color:var(--sbk-accent)}
.sbk-btn-danger:hover{border-color:rgba(220,38,38,.4);color:#dc2626}
.sbk-btn-mini{padding:5px 10px;min-height:30px;font-size:11px}
.sbk-primary{border:none;border-radius:999px;padding:13px 24px;background:linear-gradient(135deg,var(--sbk-accent),#7c5cff);color:#fff;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 14px 26px -12px rgba(53,89,246,.65);transition:.18s;display:inline-flex;align-items:center;justify-content:center;gap:6px}
.sbk-primary:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 18px 30px -12px rgba(53,89,246,.7)}
.sbk-cta-card{display:flex;flex-direction:column;align-items:stretch;gap:10px}
.sbk-cta{width:100%}
.sbk-cta-hint{margin:0;color:var(--sbk-muted);font-size:12px;line-height:1.6;text-align:center}
.sbk-regen{align-self:center}
.sbk-mini-book{display:flex;gap:6px;overflow-x:auto;padding:4px 2px 14px;scroll-snap-type:x proximity}
.sbk-mini-book::-webkit-scrollbar{height:6px}
.sbk-mini-book::-webkit-scrollbar-thumb{background:rgba(120,135,165,.35);border-radius:5px}
.sbk-mini-tile{position:relative;flex:0 0 112px;width:112px;aspect-ratio:4/3;border-radius:10px;overflow:hidden;border:1px solid var(--sbk-border);background:var(--sbk-soft);padding:0;cursor:pointer;scroll-snap-align:start;box-shadow:inset 5px 0 8px -6px rgba(30,40,70,.45)}
.sbk-mini-tile img{width:100%;height:100%;object-fit:cover;display:block}
.sbk-mini-tile.on{outline:2px solid var(--sbk-accent);outline-offset:1px}
.sbk-mini-tile:disabled{cursor:default}
.sbk-mini-cover{background:linear-gradient(145deg,#1d2b64,#5b3fd1)}
.sbk-mini-cover.shade{position:relative}
.sbk-mini-cover-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(10,16,46,.05),rgba(10,16,46,.78))}
.sbk-mini-cover-text{position:absolute;left:9px;right:9px;bottom:8px;color:#fff;display:flex;flex-direction:column;gap:1px;text-align:left}
.sbk-mini-cover-text b{font-size:12px;line-height:1.25}
.sbk-mini-cover-text i{font-size:9px;font-style:normal;opacity:.8}
.sbk-mini-emo{position:absolute;inset:0;display:grid;place-items:center;font-size:32px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.18))}
.sbk-mini-no{position:absolute;top:5px;left:6px;background:rgba(12,18,40,.62);color:#fff;font-size:10px;font-weight:700;border-radius:6px;padding:1px 5px}
.sbk-mini-warn{position:absolute;top:5px;right:6px;background:#f59e0b;color:#fff;font-size:9px;font-weight:800;border-radius:6px;padding:1px 4px}
.sbk-mini-cap{position:absolute;left:0;right:0;bottom:0;background:linear-gradient(180deg,transparent,rgba(12,18,40,.82));color:#fff;font-size:10.5px;line-height:1.3;padding:14px 6px 5px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sbk-mini-end{background:linear-gradient(145deg,#3b2f63,#17203f);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
.sbk-mini-end-mark{font-size:22px;color:rgba(255,255,255,.85)}
.sbk-mini-end-text{font-size:9px;color:rgba(255,255,255,.85);line-height:1.4;text-align:center}
.sbk-tips h3{margin:0 0 8px;font-size:13.5px}
.sbk-tips ul{margin:0;padding-left:17px;color:var(--sbk-muted);font-size:12px;line-height:1.75}
.sbk-generating{display:flex;justify-content:center}
.sbk-gen-card{width:100%;max-width:860px;padding:26px}
.sbk-gen-head{display:flex;align-items:center;gap:16px;margin-bottom:18px}
.sbk-gen-orb{width:56px;height:56px;border-radius:18px;display:grid;place-items:center;font-size:27px;color:var(--sbk-accent);background:linear-gradient(135deg,rgba(53,89,246,.15),rgba(124,92,255,.2));border:1px solid rgba(53,89,246,.25);animation:sbkFloat 2.4s ease-in-out infinite}
.sbk-gen-head h2{margin:0 0 3px;font-size:19px}
.sbk-gen-head p{margin:0;color:var(--sbk-muted);font-size:12.5px}
.sbk-progress{height:10px;border-radius:999px;background:rgba(120,135,165,.18);overflow:hidden}
.sbk-progress > div{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--sbk-accent),#7c5cff);transition:width .5s ease}
.sbk-progress-meta{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;color:var(--sbk-muted);margin-top:8px}
.sbk-gen-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}
.sbk-gen-thumb{position:relative;aspect-ratio:3/2;border-radius:11px;overflow:hidden;background:var(--sbk-soft);border:1px solid var(--sbk-border)}
.sbk-gen-thumb img{width:100%;height:100%;object-fit:cover;display:block;animation:sbkFade .45s ease}
.sbk-gen-thumb.fail{outline:2px solid rgba(245,158,11,.55);outline-offset:-2px}
.sbk-gen-no{position:absolute;left:6px;top:6px;background:rgba(12,18,40,.6);color:#fff;font-size:10px;font-weight:700;border-radius:6px;padding:2px 6px}
.sbk-gen-fail{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(255,251,235,.94);color:#b45309;font-size:11px;font-weight:700;padding:5px 9px;border-radius:8px;white-space:nowrap;display:inline-flex;align-items:center;gap:4px}
.sbk-skeleton{position:absolute;inset:0;background:linear-gradient(100deg,rgba(148,163,184,.1) 30%,rgba(148,163,184,.26) 50%,rgba(148,163,184,.1) 70%);background-size:200% 100%;animation:sbkShimmer 1.4s linear infinite}
.sbk-review{display:grid;grid-template-columns:minmax(0,1fr) 350px;gap:18px;align-items:start}
.sbk-stage-card{background:var(--sbk-card);border:1px solid var(--sbk-border);border-radius:20px;padding:16px;box-shadow:0 10px 34px -24px rgba(18,30,60,.35);min-width:0}
.sbk-stage-toolbar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.sbk-seg{display:inline-flex;background:var(--sbk-soft);border:1px solid var(--sbk-border);border-radius:999px;padding:3px}
.sbk-seg button{border:none;background:transparent;color:var(--sbk-muted);font-size:12px;font-weight:700;padding:8px 14px;min-height:36px;border-radius:999px;cursor:pointer;transition:.16s;display:inline-flex;align-items:center;gap:6px}
.sbk-seg button.on{background:var(--sbk-card);color:var(--sbk-accent);box-shadow:0 2px 8px rgba(20,30,60,.12)}
.sbk-stage-actions{display:flex;gap:8px;flex-wrap:wrap}
.sbk-step-wrap{display:flex;flex-direction:column;gap:10px}
.sbk-step-label{text-align:center;font-size:11.5px;font-weight:700;color:var(--sbk-muted);letter-spacing:.08em}
.sbk-spread-frame{padding:6px}
.sbk-spread{display:grid;grid-template-columns:1fr 1fr;background:#e9e4d8;border-radius:12px;overflow:hidden;position:relative;box-shadow:0 26px 60px -30px rgba(15,23,42,.55),0 1px 0 rgba(255,255,255,.6) inset}
.sbk-spread::after{content:"";position:absolute;left:50%;top:0;bottom:0;width:28px;transform:translateX(-50%);background:linear-gradient(90deg,transparent,rgba(60,45,20,.16) 45%,rgba(255,255,255,.35) 52%,transparent);pointer-events:none}
.sbk-spread-single{display:block}
.sbk-spread-single::after{display:none}
.sbk-pageface{margin:0;display:flex;flex-direction:column;background:#fdfbf6;color:#243044;min-width:0;position:relative}
.sbk-page-media{position:relative;background:#eef0f4;overflow:hidden}
.sbk-page-media img{width:100%;aspect-ratio:3/2;object-fit:cover;display:block}
.sbk-page-media.is-missing{min-height:180px;display:flex;align-items:center;justify-content:center}
.sbk-page-missing{display:flex;flex-direction:column;align-items:center;gap:7px;padding:18px;text-align:center;color:#334155}
.sbk-page-missing b{font-size:12.5px}
.sbk-page-emo{font-size:34px;line-height:1;filter:drop-shadow(0 2px 3px rgba(0,0,0,.15))}
.sbk-page-no{position:absolute;top:9px;left:9px;background:rgba(12,18,40,.62);color:#fff;font-size:10px;font-weight:700;border-radius:6px;padding:2px 6px}
.sbk-page-stale{position:absolute;top:9px;right:9px;background:#f59e0b;color:#fff;font-size:10px;font-weight:700;border-radius:6px;padding:2px 7px}
.sbk-page-cap{padding:12px 14px 16px;display:flex;flex-direction:column;gap:7px;flex:1}
.sbk-page-sentence{margin:0;font-size:13.5px;line-height:1.7;font-weight:500;color:#2a3652}
.sbk-page-status{font-size:10.5px;font-weight:700}
.sbk-page-status.ok{color:#15803d}
.sbk-page-status.warn{color:#b45309}
.sbk-page-status.miss{color:#64748b}
.sbk-page-cap .sbk-btn{align-self:flex-start}
.sbk-page-blank{justify-content:center;align-items:center}
.sbk-page-blank span{width:46px;height:2px;background:rgba(120,100,70,.25);border-radius:2px}
.sbk-cover-page{position:relative;aspect-ratio:16/10;min-height:300px;overflow:hidden;border-radius:12px;background:linear-gradient(140deg,#1d2b64,#4c2b8f 55%,#8b3fa8)}
.sbk-cover-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.8}
.sbk-cover-fallback{background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.22),transparent 55%),radial-gradient(circle at 75% 70%,rgba(255,210,120,.22),transparent 50%)}
.sbk-cover-scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(9,13,38,.86),rgba(9,13,38,.28) 62%,rgba(9,13,38,.55))}
.sbk-cover-content{position:relative;z-index:1;height:100%;display:flex;flex-direction:column;justify-content:center;padding:clamp(22px,5vw,52px);color:#fff}
.sbk-cover-kicker{font-size:11px;font-weight:800;letter-spacing:.3em;opacity:.82;text-transform:uppercase}
.sbk-cover-content h2{margin:10px 0 8px;font-size:clamp(28px,4.4vw,48px);letter-spacing:.05em;line-height:1.2;text-shadow:0 3px 18px rgba(0,0,0,.35)}
.sbk-cover-content p{margin:0;font-size:13px;opacity:.85}
.sbk-cover-author{margin-top:22px;font-size:11.5px;opacity:.75;letter-spacing:.06em}
.sbk-cover-orn{position:absolute;right:26px;bottom:20px;color:rgba(255,255,255,.55);font-size:20px}
.sbk-end-page{background:#fdfbf6;color:#243044;min-height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 24px;border-radius:12px}
.sbk-end-mark{font-size:36px;margin-bottom:8px;color:#8a7a56}
.sbk-end-page h2{margin:0 0 6px;font-size:24px;letter-spacing:.08em}
.sbk-end-page > p{margin:0;font-size:12.5px;color:#64748b}
.sbk-end-rule{width:54px;height:1px;background:#d6cbb4;margin:20px 0}
.sbk-end-credit{line-height:1.8;color:#475569;font-size:12px}
.sbk-end-brand{margin-top:22px;font-size:10.5px;letter-spacing:.18em;color:#94a3b8}
.sbk-book-nav{display:flex;align-items:center;justify-content:center;gap:14px}
.sbk-nav-btn{width:40px;height:40px;border-radius:50%;border:1px solid var(--sbk-border);background:var(--sbk-card);color:var(--aiq-text);font-size:18px;cursor:pointer;transition:.15s;display:grid;place-items:center}
.sbk-nav-btn:hover:not(:disabled){border-color:rgba(53,89,246,.4);color:var(--sbk-accent)}
.sbk-nav-btn:disabled{opacity:.35;cursor:not-allowed}
.sbk-nav-label{font-size:12px;font-weight:700;color:var(--sbk-muted);min-width:120px;text-align:center}
.sbk-keyhint{text-align:center;margin:0;color:var(--sbk-muted);font-size:11px}
.sbk-filmstrip{display:flex;gap:8px;overflow-x:auto;padding:14px 2px 4px;margin-top:12px;border-top:1px solid var(--sbk-border)}
.sbk-filmstrip::-webkit-scrollbar{height:6px}
.sbk-filmstrip::-webkit-scrollbar-thumb{background:rgba(120,135,165,.35);border-radius:5px}
.sbk-film{flex:0 0 76px;width:76px;border:none;background:transparent;padding:0;cursor:pointer;display:flex;flex-direction:column;gap:4px;align-items:stretch}
.sbk-film-thumb{position:relative;aspect-ratio:3/2;border-radius:8px;overflow:hidden;border:2px solid transparent;background:var(--sbk-soft);display:grid;place-items:center;font-size:18px;transition:.15s}
.sbk-film-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.sbk-film.on .sbk-film-thumb{border-color:var(--sbk-accent);box-shadow:0 0 0 3px rgba(53,89,246,.14)}
.sbk-film-cap{font-size:11px;color:var(--sbk-muted);font-weight:600}
.sbk-film.on .sbk-film-cap{color:var(--sbk-accent)}
.sbk-film-warn{position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;background:#f59e0b;border:1px solid #fff}
.sbk-film-cover .sbk-film-thumb{background:linear-gradient(145deg,#1d2b64,#5b3fd1);color:#fff}
.sbk-film-end .sbk-film-thumb{background:linear-gradient(145deg,#3b2f63,#17203f);color:#fff}
.sbk-strip-block{display:flex;flex-direction:column;gap:8px}
.sbk-strip-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-size:12.5px;font-weight:800}
.sbk-strip-wrap{overflow-x:auto;padding:6px 2px 14px;border-radius:12px}
.sbk-strip-wrap::-webkit-scrollbar{height:8px}
.sbk-strip-wrap::-webkit-scrollbar-thumb{background:rgba(120,135,165,.35);border-radius:5px}
.sbk-strip{display:flex;align-items:stretch;min-width:max-content;background:#e9e4d8;border-radius:12px;padding:10px;box-shadow:0 26px 60px -34px rgba(15,23,42,.55)}
.sbk-strip-item{display:flex;border-right:1px dashed rgba(120,100,70,.4);flex:none}
.sbk-strip-item:last-child{border-right:none}
.sbk-strip-page{width:248px;flex:none;background:#fdfbf6;display:flex;flex-direction:column}
.sbk-strip-media{position:relative;aspect-ratio:3/2;overflow:hidden;display:grid;place-items:center}
.sbk-strip-media img{width:100%;height:100%;object-fit:cover;display:block}
.sbk-strip-emo{font-size:44px;filter:drop-shadow(0 3px 4px rgba(0,0,0,.16))}
.sbk-strip-no{position:absolute;top:7px;left:7px;background:rgba(12,18,40,.6);color:#fff;font-size:10px;font-weight:700;border-radius:6px;padding:2px 6px}
.sbk-strip-warn{position:absolute;top:7px;right:7px;background:#f59e0b;color:#fff;font-size:9.5px;font-weight:700;border-radius:6px;padding:2px 6px}
.sbk-strip-cap{padding:10px 12px 14px;display:flex;flex-direction:column;gap:4px;color:#243044}
.sbk-strip-cap b{font-size:10px;color:#8a7a56;letter-spacing:.06em}
.sbk-strip-cap span{font-size:12px;line-height:1.6;color:#2a3652;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.sbk-strip-cover{position:relative;width:248px;flex:none;overflow:hidden;background:linear-gradient(145deg,#1d2b64,#4c2b8f 60%,#8b3fa8);display:flex;align-items:center;justify-content:center;color:#fff}
.sbk-strip-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.72}
.sbk-strip-cover-shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(9,13,38,.15),rgba(9,13,38,.8))}
.sbk-strip-cover-text{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:8px;text-align:center;padding:20px}
.sbk-strip-cover-text small{font-size:10px;letter-spacing:.3em;opacity:.8}
.sbk-strip-cover-text b{font-size:24px;letter-spacing:.08em}
.sbk-strip-cover-text span{font-size:11px;opacity:.8}
.sbk-strip-end{width:200px;flex:none;background:#fdfbf6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;color:#475569;padding:20px;text-align:center}
.sbk-strip-end > span{font-size:28px;color:#8a7a56}
.sbk-strip-end b{font-size:15px;color:#243044}
.sbk-strip-end small{font-size:10.5px;color:#94a3b8}
.sbk-check{position:sticky;top:84px}
.sbk-check-badge{font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px}
.sbk-check-badge.ok{color:#15803d;background:rgba(22,163,74,.1)}
.sbk-check-badge.warn{color:#b45309;background:rgba(245,158,11,.12)}
.sbk-checklist{list-style:none;margin:0 0 14px;padding:0;display:flex;flex-direction:column;gap:9px}
.sbk-checklist li{display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border-radius:11px;background:var(--sbk-soft);border:1px solid var(--sbk-border)}
.sbk-checklist li div{display:flex;flex-direction:column;gap:1px;min-width:0}
.sbk-checklist li b{font-size:12.5px}
.sbk-checklist li span{font-size:11.5px;color:var(--sbk-muted);line-height:1.5}
.sbk-check-ico{width:19px;height:19px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;flex:none;margin-top:1px}
.sbk-checklist li.ok .sbk-check-ico{background:rgba(22,163,74,.14);color:#15803d}
.sbk-checklist li.warn .sbk-check-ico{background:rgba(245,158,11,.16);color:#b45309}
.sbk-issues{display:flex;flex-direction:column;gap:7px;margin:0 0 14px}
.sbk-issue{display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:7px 10px;font-size:11.5px;color:#8a5200}
.sbk-confirm{display:flex;gap:9px;align-items:flex-start;font-size:12px;line-height:1.6;padding:11px 12px;border-radius:11px;border:1px dashed rgba(53,89,246,.4);background:rgba(53,89,246,.05);cursor:pointer;margin-bottom:13px}
.sbk-confirm.disabled{opacity:.5;cursor:not-allowed}
.sbk-confirm input{margin-top:2px;accent-color:var(--sbk-accent);width:15px;height:15px;flex:none}
.sbk-submit{width:100%}
.sbk-spinner{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;display:inline-block;animation:sbkSpin .8s linear infinite}
.sbk-alert{margin:9px 0 0;font-size:11.5px;color:#b91c1c;background:rgba(220,38,38,.08);border:1px solid rgba(220,38,38,.22);border-radius:9px;padding:8px 10px}
.sbk-desc-preview{margin-top:16px;border-top:1px solid var(--sbk-border);padding-top:13px}
.sbk-desc-preview h3{margin:0 0 6px;font-size:11.5px;color:var(--sbk-muted);font-weight:700}
.sbk-desc-preview p{margin:0;font-size:11.5px;line-height:1.75;color:var(--sbk-muted);max-height:120px;overflow:auto}
.sbk-submitted{display:flex;justify-content:center}
.sbk-success-card{max-width:720px;width:100%;text-align:center;padding:36px 28px}
.sbk-success-icon{width:64px;height:64px;border-radius:22px;margin:0 auto 14px;display:grid;place-items:center;font-size:32px;color:#fff;background:linear-gradient(135deg,#16a34a,#22c55e);box-shadow:0 16px 30px -14px rgba(22,163,74,.7);animation:sbkPop .5s ease}
.sbk-success-card h2{margin:0 0 6px;font-size:24px}
.sbk-success-sub{margin:0 0 10px;font-size:15px;font-weight:700;color:var(--sbk-accent)}
.sbk-success-meta{display:flex;justify-content:center;gap:14px;flex-wrap:wrap;font-size:11.5px;color:var(--sbk-muted);margin-bottom:18px}
.sbk-success-card .sbk-mini-book{justify-content:center;margin-bottom:20px}
.sbk-success-actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}
.sbk-modal-backdrop{--sbk-accent:var(--aiq-accent,#3559f6);--sbk-border:var(--aiq-border,#e4e8f2);--sbk-card:var(--aiq-panel-solid,#fff);--sbk-muted:var(--aiq-text-mute,#67718a);--sbk-soft:var(--aiq-bg-soft,#f2f5fc);position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.48);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:sbkFadeIn .18s ease}
.sbk-modal{width:min(430px,100%);background:var(--aiq-panel-solid,#fff);color:var(--aiq-text,#182033);border:1px solid var(--aiq-border,#e4e8f2);border-radius:20px;padding:24px;box-shadow:0 30px 80px -20px rgba(15,23,42,.45);text-align:left}
.sbk-modal-icon{width:46px;height:46px;border-radius:13px;display:grid;place-items:center;font-size:23px;color:var(--sbk-accent,#3559f6);background:rgba(53,89,246,.1);margin-bottom:14px}
.sbk-modal-icon.danger{color:#dc2626;background:rgba(220,38,38,.09)}
.sbk-modal h2{margin:0 0 7px;font-size:18px;font-weight:800;line-height:1.4}
.sbk-modal p{margin:0 0 22px;font-size:13px;line-height:1.7;color:var(--aiq-text-mute,#67718a)}
.sbk-modal-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}
.sbk-modal .sbk-btn,.sbk-modal .sbk-primary{min-height:40px;padding:10px 20px;font-size:13.5px}
.sbk-modal .sbk-primary.danger{background:linear-gradient(135deg,#dc2626,#ef4444);box-shadow:0 14px 26px -12px rgba(220,38,38,.62)}
.sbk-toast{position:fixed;left:50%;bottom:32px;transform:translate(-50%,16px);max-width:min(90vw,460px);padding:11px 18px;border-radius:12px;font-size:13px;font-weight:600;color:#fff;background:#334155;box-shadow:0 16px 40px -12px rgba(15,23,42,.5);opacity:0;pointer-events:none;transition:.25s;z-index:9999;text-align:center}
.sbk-toast.show{opacity:1;transform:translate(-50%,0)}
.sbk-toast.success{background:#15803d}
.sbk-toast.error{background:#b91c1c}
.sbk-toast.warn{background:#b45309}
.sbk-toast.info{background:#334155}
/* 学生作业入口：独立于创作台步骤头的简洁卡片 */
.sbk-crumb-right{margin-left:auto}
.sbk-meta-pill.warn{color:#b45309;border-color:rgba(245,158,11,.4);background:rgba(245,158,11,.1)}
.sbk-assign-notice{display:flex;gap:11px;align-items:flex-start;margin:-8px 0 20px;padding:13px 16px;border-radius:14px;border:1px dashed rgba(53,89,246,.35);background:rgba(53,89,246,.05);font-size:12.5px;color:var(--aiq-text-soft,#475569)}
.sbk-assign-notice > .sbk-i{margin-top:1px;font-size:17px;color:var(--sbk-accent)}
.sbk-assign-notice b{display:block;margin-bottom:2px;color:var(--aiq-text,#182033)}
.sbk-assign-notice p{margin:0;line-height:1.65;white-space:pre-wrap}
.sbk-assign-page{min-height:60vh;display:flex;flex-direction:column;justify-content:center}
.sbk-assign-shell{display:flex;justify-content:center;padding:24px 0 56px}
.sbk-assign-card{max-width:520px;width:100%;text-align:center;padding:40px 32px;border-radius:22px}
.sbk-assign-card h1{margin:10px 0 8px;font-size:25px;line-height:1.3;letter-spacing:-.01em}
.sbk-assign-card > p{margin:0 auto 18px;max-width:34em;font-size:13.5px;line-height:1.75;color:var(--aiq-text-mute,#67718a)}
.sbk-assign-badge{width:60px;height:60px;border-radius:20px;margin:0 auto 6px;display:grid;place-items:center;font-size:29px;color:#fff;background:linear-gradient(135deg,#7c3aed,#ec4899);box-shadow:0 16px 30px -14px rgba(124,58,237,.65)}
.sbk-assign-badge.is-error{background:linear-gradient(135deg,#dc2626,#f97316)}
.sbk-assign-class{display:inline-block;font-size:12px;font-weight:700;color:var(--sbk-accent);background:rgba(53,89,246,.09);border-radius:999px;padding:3px 11px}
.sbk-assign-teacher{font-size:12.5px !important;color:var(--sbk-muted) !important;margin-bottom:14px !important}
.sbk-assign-instructions{text-align:left;margin:0 0 20px;padding:13px 15px;border-radius:12px;border:1px solid var(--sbk-border);background:var(--sbk-soft)}
.sbk-assign-instructions b{display:block;font-size:12px;margin-bottom:4px}
.sbk-assign-instructions p{margin:0;font-size:12.5px;line-height:1.7;color:var(--aiq-text-soft,#475569);white-space:pre-wrap}
.sbk-assign-form{text-align:left;margin:0 0 4px}
.sbk-assign-form label{display:block;margin-bottom:6px;font-size:12.5px;font-weight:700}
.sbk-assign-input{width:100%;min-height:46px;padding:0 14px;border-radius:12px;border:1px solid var(--sbk-border);background:var(--aiq-panel-solid,#fff);color:inherit;font:inherit;font-size:15px;transition:border-color .15s,box-shadow .15s}
.sbk-assign-input:focus{outline:none;border-color:var(--sbk-accent);box-shadow:0 0 0 3px rgba(53,89,246,.16)}
.sbk-assign-btn{width:100%;margin-top:12px;min-height:46px;justify-content:center;display:inline-flex;align-items:center;gap:8px}
.sbk-assign-error{margin:10px 0 0 !important;font-size:12.5px !important;color:#b91c1c !important;min-height:1.2em}
.sbk-assign-error:empty{display:none}
.sbk-assign-hint{margin:14px 0 0 !important;font-size:11.5px !important;line-height:1.65 !important;color:var(--sbk-muted) !important}
.sbk-assign-loading{display:flex;flex-direction:column;align-items:center;gap:14px;padding:56px 32px}
.sbk-assign-loading .sbk-spinner{border-color:rgba(53,89,246,.25);border-top-color:var(--sbk-accent);width:24px;height:24px}
.sbk-assign-loading p{margin:0;color:var(--sbk-muted);font-size:13px}
.sbk-center{display:flex;flex-direction:column;align-items:center}
.sbk-center .sbk-primary,.sbk-center .sbk-btn{margin-top:4px}
/* 学生作业：互动练习 / 课程任务工作台 */
.sbk-assign-card.is-wide{max-width:820px;text-align:left;padding:28px 32px}
.sbk-assign-context{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:18px;padding-bottom:14px;border-bottom:1px solid var(--sbk-border)}
.sbk-assign-member{font-size:12px;font-weight:700;color:var(--sbk-muted)}
.sbk-assign-workbench{display:flex;flex-direction:column;gap:16px}
.sbk-assign-workbench-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sbk-assign-workbench-icon{width:48px;height:48px;flex:none;border-radius:14px;display:grid;place-items:center;font-size:23px;color:#fff;background:linear-gradient(135deg,#7c3aed,#ec4899);box-shadow:0 12px 24px -12px rgba(124,58,237,.65)}
.sbk-assign-workbench-icon.is-task{background:linear-gradient(135deg,#3559f6,#7c5cff);box-shadow:0 12px 24px -12px rgba(53,89,246,.65)}
.sbk-assign-workbench-title{min-width:0;flex:1}
.sbk-assign-workbench-title h1{margin:0;font-size:22px;line-height:1.3;letter-spacing:-.01em}
.sbk-assign-workbench-title p{margin:2px 0 0;font-size:12.5px;color:var(--sbk-muted)}
.sbk-assign-result{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:800;color:#15803d;background:rgba(22,163,74,.1);border:1px solid rgba(22,163,74,.22);border-radius:999px;padding:6px 12px;white-space:nowrap}
.sbk-assign-tag-row{display:flex;flex-wrap:wrap;gap:6px}
.sbk-assign-tag-row.is-center{justify-content:center;margin:0 0 14px}
.sbk-assign-tag{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:var(--sbk-muted);background:var(--sbk-soft);border:1px solid var(--sbk-border);border-radius:999px;padding:3px 9px}
.sbk-assign-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.sbk-assign-step{display:flex;gap:8px;align-items:flex-start;padding:11px 12px;border-radius:12px;background:var(--sbk-soft);border:1px solid var(--sbk-border)}
.sbk-assign-step > span{width:20px;height:20px;flex:none;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:800;color:#fff;background:var(--sbk-accent);margin-top:1px}
.sbk-assign-step p{margin:0;font-size:11.5px;line-height:1.6;color:var(--aiq-text-soft,#475569)}
.sbk-assign-field label{display:block;font-size:12.5px;font-weight:700;margin-bottom:6px}
.sbk-assign-field label span{font-weight:500;color:var(--sbk-muted)}
.sbk-assign-field-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;margin-bottom:6px}
.sbk-assign-field-head label{margin-bottom:0}
.sbk-assign-textarea{width:100%;min-height:150px;resize:vertical;border:1px solid var(--sbk-border);border-radius:12px;padding:12px 14px;font:inherit;font-size:14px;line-height:1.7;outline:none;background:var(--aiq-panel-solid,#fff);color:inherit;transition:border-color .15s,box-shadow .15s}
.sbk-assign-textarea::placeholder{color:var(--sbk-muted);opacity:.72}
.sbk-assign-textarea:focus{border-color:var(--sbk-accent);box-shadow:0 0 0 3px rgba(53,89,246,.16)}
.sbk-assign-textarea.is-short{min-height:84px}
.sbk-assign-counter{display:block;text-align:right;font-size:11px;color:var(--sbk-muted);margin-top:4px}
.sbk-task-photos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.sbk-task-thumb{position:relative;margin:0;aspect-ratio:1;border-radius:12px;overflow:hidden;border:1px solid var(--sbk-border);background:var(--sbk-soft)}
.sbk-task-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.sbk-task-thumb button{position:absolute;top:5px;right:5px;width:24px;height:24px;border:none;border-radius:50%;background:rgba(12,18,40,.66);color:#fff;display:grid;place-items:center;font-size:12px;cursor:pointer;padding:0}
.sbk-task-thumb button:hover{background:rgba(185,28,28,.85)}
.sbk-task-add{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;aspect-ratio:1;border-radius:12px;border:1px dashed rgba(53,89,246,.4);background:rgba(53,89,246,.05);color:var(--sbk-accent);font-size:12px;font-weight:700;cursor:pointer;text-align:center;padding:8px}
.sbk-task-add:hover{background:rgba(53,89,246,.09)}
.sbk-task-add:focus-within{outline:2px solid var(--sbk-accent);outline-offset:2px}
.sbk-task-add .sbk-i{font-size:20px}
.sbk-task-add input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}
.sbk-task-photos.is-readonly{grid-template-columns:repeat(auto-fill,minmax(110px,1fr));margin-top:4px}
.sbk-task-photos.is-readonly .sbk-task-thumb{aspect-ratio:4/3}
.sbk-assign-photo-hint{margin:7px 0 0;font-size:11px;line-height:1.6;color:var(--sbk-muted)}
.sbk-assign-tool{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 14px;border-radius:12px;border:1px solid var(--sbk-border);background:var(--sbk-soft)}
.sbk-assign-tool > div{display:flex;flex-direction:column;gap:2px;min-width:0}
.sbk-assign-tool b{display:inline-flex;align-items:center;gap:6px;font-size:12.5px}
.sbk-assign-tool span{font-size:11.5px;color:var(--sbk-muted)}
.sbk-assign-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding-top:2px}
.sbk-assign-actions .sbk-primary{min-height:46px;padding:12px 22px}
.sbk-assign-submit{min-height:46px;padding:11px 22px;font-size:13px}
.sbk-assign-hint.is-left{text-align:left;margin-top:0 !important}
.sbk-spinner-dark{border-color:rgba(53,89,246,.25);border-top-color:var(--sbk-accent,#3559f6)}
.sbk-assign-scorebox{display:flex;flex-direction:column;align-items:center;gap:2px;width:min(260px,100%);margin:2px auto 18px;padding:14px 16px;border-radius:16px;background:rgba(22,163,74,.08);border:1px solid rgba(22,163,74,.22)}
.sbk-assign-scorebox span{font-size:12px;font-weight:700;color:#15803d}
.sbk-assign-scorebox strong{font-size:42px;line-height:1.1;color:#15803d;font-variant-numeric:tabular-nums}
.sbk-assign-scorebox small{font-size:14px;margin-left:4px;font-weight:700}
.sbk-assign-work{text-align:left;margin:0 0 14px;padding:13px 15px;border-radius:12px;border:1px solid var(--sbk-border);background:var(--sbk-soft)}
.sbk-assign-work b{display:block;font-size:12.5px;margin-bottom:3px}
.sbk-assign-work p{margin:0;font-size:12px;line-height:1.65;color:var(--aiq-text-soft,#475569)}
.sbk-submit-note{text-align:left;margin:0 0 18px;padding:13px 15px;border-radius:12px;border:1px dashed rgba(53,89,246,.35);background:rgba(53,89,246,.05)}
.sbk-submit-note b{display:block;font-size:12px;margin-bottom:4px;color:var(--sbk-accent)}
.sbk-submit-note p{margin:0;font-size:13px;line-height:1.7;white-space:pre-wrap;color:var(--aiq-text-soft,#475569)}
.sbk-submit-preview{text-align:left;margin:0 0 18px}
.sbk-submit-text{margin:0 0 12px;padding:13px 15px;border-radius:12px;border:1px solid var(--sbk-border);background:var(--sbk-soft);font-size:13.5px;line-height:1.75;white-space:pre-wrap;color:var(--aiq-text,#182033);max-height:320px;overflow:auto}
.sbk-success-card.is-work{text-align:left}
.sbk-success-card.is-work .sbk-success-icon{margin-left:auto;margin-right:auto}
.sbk-success-card.is-work h2,.sbk-success-card.is-work .sbk-success-sub{text-align:center}
.sbk-success-card.is-work .sbk-success-meta{justify-content:center}
.sbk-success-card.is-work .sbk-success-actions{justify-content:center;margin-top:18px}
.sbk-success-card.is-work .sbk-note{text-align:center}
.sbk-success-card.is-work .sbk-submit-preview .sbk-note{text-align:left;margin:0}
/* 学生作业：互动练习页悬浮条 */
body.sbk-supervisor-on{padding-bottom:calc(96px + env(safe-area-inset-bottom,0px)) !important}
.sbk-supervisor{position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:9900;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px 14px;box-sizing:border-box;width:min(760px,calc(100% - 24px));padding:10px 12px 10px 14px;border-radius:16px;border:1px solid var(--aiq-border,#e4e8f2);background:var(--aiq-panel-solid,#fff);color:var(--aiq-text,#182033);box-shadow:0 18px 46px -18px rgba(18,30,60,.5)}
.sbk-supervisor-main{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.sbk-supervisor-badge{width:36px;height:36px;flex:none;border-radius:11px;display:grid;place-items:center;font-size:18px;color:#fff;background:linear-gradient(135deg,#3559f6,#7c5cff);box-shadow:0 8px 18px -10px rgba(53,89,246,.7)}
.sbk-supervisor-text{display:flex;flex-direction:column;min-width:0;line-height:1.35}
.sbk-supervisor-text b{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbk-supervisor-text span{font-size:11px;color:var(--aiq-text-mute,#67718a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sbk-supervisor-actions{display:flex;align-items:center;gap:8px;flex:none}
.sbk-supervisor-submit,.sbk-supervisor-back{border-radius:999px;font:inherit;font-size:12.5px;font-weight:700;min-height:44px;padding:10px 16px;cursor:pointer;white-space:nowrap}
.sbk-supervisor-submit{border:none;color:#fff;background:linear-gradient(135deg,#3559f6,#7c5cff);box-shadow:0 10px 20px -10px rgba(53,89,246,.7)}
.sbk-supervisor-back{border:1px solid rgba(53,89,246,.3);background:var(--aiq-panel-solid,#fff);color:var(--sbk-accent,#3559f6)}
.sbk-supervisor-submit:hover:not(:disabled){filter:brightness(1.05)}
.sbk-supervisor-back:hover{background:rgba(53,89,246,.07)}
.sbk-supervisor-submit:disabled{opacity:.55;cursor:default}
.sbk-supervisor-error{flex-basis:100%;margin:0;font-size:11.5px;line-height:1.5;color:#b91c1c}
.sbk-print-sheet{display:none}
@keyframes sbkShimmer{to{background-position:-200% 0}}
@keyframes sbkFade{from{opacity:0;transform:scale(1.02)}to{opacity:1;transform:none}}
@keyframes sbkSpin{to{transform:rotate(360deg)}}
@keyframes sbkFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
@keyframes sbkPop{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
@keyframes sbkFadeIn{from{opacity:0}to{opacity:1}}
@media(max-width:1020px){
  .sbk-review{grid-template-columns:1fr}
  .sbk-check{position:static}
  .sbk-preview-col{position:static}
}
@media(max-width:960px){
  .sbk-compose-grid{grid-template-columns:1fr}
  .sbk-hero{grid-template-columns:1fr;align-items:start}
  .sbk-step-text > span{display:none}
  .sbk-gen-grid{grid-template-columns:repeat(2,1fr)}
}
@media(max-width:720px){
  .sbk-container{padding:6px 0 48px}
  .sbk-hero{padding:16px;gap:12px}
  .sbk-hero-main{gap:12px}
  .sbk-hero-icon{width:44px;height:44px;font-size:21px;border-radius:11px}
  .sbk-hero h1{font-size:19px}
  .sbk-hero-text p{font-size:12.5px}
  .sbk-card{padding:16px;border-radius:16px}
  .sbk-field-pair{grid-template-columns:1fr}
  .sbk-spread{grid-template-columns:1fr}
  .sbk-spread::after{display:none}
  .sbk-pageface + .sbk-pageface{border-top:1px dashed rgba(120,100,70,.4)}
  .sbk-cover-page{aspect-ratio:4/3;min-height:240px}
  .sbk-success-card{padding:28px 18px}
  .sbk-stage-card{padding:13px}
  .sbk-step-btn{padding:4px 8px 4px 5px;gap:6px;min-height:36px}
  .sbk-step + .sbk-step::before{left:-4px;width:5px}
  .sbk-steps{gap:4px}
  .sbk-steps-hint{display:none}
  .sbk-step-num{width:24px;height:24px;font-size:12px}
  .sbk-chip{min-height:34px}
  .sbk-tab{min-height:38px}
  .sbk-assign-card.is-wide{padding:20px 16px}
  .sbk-assign-workbench-head h1{font-size:19px}
  .sbk-assign-workbench-icon{width:42px;height:42px;font-size:20px;border-radius:12px}
  .sbk-assign-result{margin-left:0}
  .sbk-assign-steps{grid-template-columns:1fr}
  .sbk-task-photos{grid-template-columns:repeat(3,minmax(0,1fr))}
  .sbk-assign-actions .sbk-primary,.sbk-assign-submit{width:100%}
  .sbk-success-card.is-work{padding:26px 16px}
  body.sbk-supervisor-on{padding-bottom:calc(136px + env(safe-area-inset-bottom,0px)) !important}
  .sbk-supervisor{bottom:max(10px,env(safe-area-inset-bottom,0px));border-radius:14px;padding:9px 10px;gap:8px}
  .sbk-supervisor-actions{width:100%;justify-content:flex-end}
  .sbk-supervisor-text span{max-width:60vw}
}
@media print{
  @page{margin:12mm}
  body *{visibility:hidden!important}
  .sbk-print-sheet,.sbk-print-sheet *{visibility:visible!important}
  .sbk-print-sheet{display:block!important;position:absolute;left:0;top:0;width:100%;background:#fff;color:#16213b}
  .sbk-print-cover{text-align:center;padding:40mm 10mm 30mm;page-break-after:always}
  .sbk-print-cover span{font-size:12px;letter-spacing:.3em;color:#64748b}
  .sbk-print-cover h1{font-size:40px;margin:14px 0}
  .sbk-print-cover p{font-size:14px;color:#475569}
  .sbk-print-page{page-break-after:always;padding:8mm 4mm}
  .sbk-print-page img{display:block;width:100%;max-height:150mm;object-fit:contain;margin:0 auto;border-radius:6px}
  .sbk-print-missing{padding:40mm 0;text-align:center;color:#94a3b8;border:1px dashed #cbd5e1}
  .sbk-print-cap{padding:8px 4px;font-size:13px;line-height:1.7;color:#243044}
  .sbk-print-cap b{margin-right:8px;color:#64748b}
  .sbk-print-end{text-align:center;padding:60mm 0}
  .sbk-print-end p{font-size:18px;letter-spacing:.2em}
  .sbk-print-end small{font-size:11px;color:#94a3b8}
}
@media (prefers-reduced-motion: reduce){
  .sbk-page *{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
`
    document.head.appendChild(style)
  }

  // ── 挂载 / 卸载 ────────────────────────────────────────────
  function attachRoot(vm) {
    const host = (vm.$el && vm.$el.parentNode) || document.querySelector('main')
    if (!host) return false
    root = document.createElement('div')
    root.className = 'sbk-page'
    root.setAttribute('data-sbk-root', '')
    if (vm.$el && vm.$el.parentNode === host) host.insertBefore(root, vm.$el)
    else host.appendChild(root)
    return true
  }

  function detachRoot() {
    unmountStudio()
    if (root) root.remove()
    root = null
  }

  function mountStudio() {
    ensureStyle()
    bindEvents()
    render()
  }

  function unmountStudio() {
    state.seq++ // 丢弃仍在飞行中的生成结果
    if (state.phase === 'generating') {
      state.phase = state.images.some((x) => safeImg(x)) ? 'review' : 'compose'
    }
    clearTimeout(toastTimer)
    closeConfirm(false)
    if (keyHandler) document.removeEventListener('keydown', keyHandler)
    keyHandler = null
  }

  const StudioComponent = {
    name: 'StorybookStudio',
    mounted() {
      // 上一次可能是学生作业会话；老师回到创作台时恢复干净的个人工作区
      if (state.mode !== 'teacher') state = freshState()
      if (!attachRoot(this)) return
      mountStudio()
    },
    beforeUnmount() {
      detachRoot()
    },
    render() {
      return null
    },
  }

  const AssignComponent = {
    name: 'StorybookAssign',
    mounted() {
      enterAssign(this, (this.$route && this.$route.params && this.$route.params.token) || '')
    },
    watch: {
      '$route.params.token'(token) {
        if (token) enterAssign(this, token)
      },
    },
    beforeUnmount() {
      detachRoot()
    },
    render() {
      return null
    },
  }

  function enterAssign(vm, token) {
    if (state.mode !== 'assign' || state.assignToken !== token) {
      stopSupervisor()
      if (root) detachRoot()
      state = freshState()
      state.mode = 'assign'
      state.assignToken = token
    }
    if (!root && !attachRoot(vm)) return
    mountStudio()
    updateSupervisorBar()
    loadAssign()
  }

  // ── 启动：注册更高优先级的路由 ─────────────────────────────
  function waitFor(fn, timeoutMs) {
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
        if (Date.now() - started > (timeoutMs || 15000)) return resolve(null)
        setTimeout(tick, 100)
      }
      tick()
    })
  }

  async function safeReplace(location) {
    try {
      await ctx.router.replace(location)
    } catch {
      /* 守卫重定向属于正常结果 */
    }
  }

  /**
   * 在互动练习页刷新后恢复学生身份：校验收到的作业与 URL 里的练习一致，
   * 重新顶替 store，再从守卫已经改写过的当前路由跳回练习页。
   */
  async function resumeAssignLab(labId, token) {
    state = freshState()
    state.mode = 'assign'
    state.assignToken = token
    try {
      const metaRes = await assignApi(`/api/assign/${encodeURIComponent(token)}`)
      state.assignMeta = (metaRes && metaRes.assignment) || null
      if (!state.assignMeta || state.assignMeta.status !== 'open') {
        await safeReplace('/assign/' + token)
        return
      }
      const meRes = await assignApi(`/api/assign/${encodeURIComponent(token)}/me`)
      state.assignMember = (meRes && meRes.member) || null
      state.assignSubmission = (meRes && meRes.submission) || null
      if (!state.assignMember || (state.assignSubmission && state.assignSubmission.status === 'submitted')) {
        await safeReplace('/assign/' + token)
        return
      }
      const kind = assignKind()
      const expected =
        kind === 'lab' ? state.assignMeta.labId : kind === 'task' ? state.assignMeta.toolLabId : null
      if (!expected || expected !== labId) {
        await safeReplace('/assign/' + token)
        return
      }
      if (!(await startSupervisor())) {
        await safeReplace('/assign/' + token)
        return
      }
      const cur = ctx.router.currentRoute.value
      if (cur.path !== `/lab/${labId}` || String(cur.query.assign || '') !== token) {
        await safeReplace({ path: `/lab/${labId}`, query: { assign: token } })
      }
    } catch {
      await safeReplace('/assign/' + token)
    }
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

    if (!router.hasRoute('storybook-studio')) {
      router.addRoute({
        path: '/lab/storybook',
        name: 'storybook-studio',
        component: StudioComponent,
        meta: { title: 'AI 课文绘本创作台', requiresAuth: true },
      })
    }
    if (!router.hasRoute('assign-studio')) {
      // 学生不需要账号：这里刻意不加 requiresAuth
      router.addRoute({
        path: '/assign/:token',
        name: 'assign-studio',
        component: AssignComponent,
        meta: { title: '班级作业' },
      })
    }

    // 监考只在「这份作业页 + 它对应的互动练习页」之间有效，去别处立即恢复账号状态
    router.afterEach((to) => {
      if (!supervisor.active) return
      const sameAssign = to.name === 'assign-studio' && to.params && to.params.token === supervisor.token
      const inTool = to.name === 'lab-play' && to.query && String(to.query.assign || '') === supervisor.token
      if (sameAssign || inTool) {
        updateSupervisorBar()
        return
      }
      stopSupervisor()
    })

    try {
      await router.isReady()
    } catch {
      /* isReady 只在启动错误时 reject */
    }

    const cur = router.currentRoute.value
    const mine = cur.matched.some((r) => r.name === 'storybook-studio')

    // 学生深链接：初始导航发生在路由注册之前，地址栏 hash 才是准的
    const raw = INITIAL_HASH.replace(/^#/, '')
    const qAt = raw.indexOf('?')
    const rawPath = qAt >= 0 ? raw.slice(0, qAt) : raw
    const rawQuery = qAt >= 0 ? raw.slice(qAt + 1) : ''

    // 互动练习刷新恢复：/lab/:id?assign=TOKEN
    const labMatch = rawPath.match(/^\/lab\/([^/]+)\/?$/)
    if (labMatch && labMatch[1] !== 'storybook') {
      const rawAssign = new URLSearchParams(rawQuery).get('assign') || ''
      let labId = ''
      try {
        labId = decodeURIComponent(labMatch[1])
      } catch {
        labId = ''
      }
      if (rawAssign && labId) {
        await resumeAssignLab(labId, rawAssign)
        return
      }
    }

    if (/^\/assign\/[^/]+\/?$/.test(rawPath)) {
      const target = rawPath.replace(/\/$/, '')
      const ours = cur.matched.some((r) => r.name === 'assign-studio')
      if (!ours || cur.path !== target) {
        try {
          await router.replace({ path: target, force: true })
        } catch {
          /* 守卫重定向属于正常结果 */
        }
      }
      return
    }

    // 首屏直接打开 /lab/storybook 时，初始导航可能已经用 /lab/:id 渲染过了。
    // 先离开再回来，让静态路由重新匹配（Vue Router 不会因同路径自动重解析）。
    if (cur.path === '/lab/storybook' && !mine) {
      try {
        await router.replace('/lab')
        await router.replace('/lab/storybook')
      } catch {
        /* 守卫重定向（未登录去登录页）属于正常结果 */
      }
    }
  }

  boot().catch((err) => {
    // 失败时保留原页面，不要白屏
    console.warn('[storybook-studio] 启动失败，继续使用原页面', err)
  })
})()
