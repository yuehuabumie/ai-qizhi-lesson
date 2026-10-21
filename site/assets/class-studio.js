/**
 * 「班级管理」运行时页面：
 *   /me/classes                                    班级列表
 *   /me/classes/:id                                名单 + 作业列表
 *   /me/classes/:id/assignments/:assignmentId      完成情况 + 发布到展厅
 *
 * 服务器上只有 Vite 构建产物。沿用「我的」与成果展厅的做法：
 *   1. 在入口 bundle 之前加载，先记住原始 hash（深链接）；
 *   2. app 挂载后用 $router 新增路由（requiresAuth 交给站点原有守卫）；
 *   3. 组件 render() 返回 null，在 $el 前插入自己的 DOM；
 *   4. 交互全部原生 DOM，样式走站点 CSS 变量，自动跟随明暗主题。
 *
 * 老师的核心动线：建班 → 导入名单 → 生成作业链接 → 发到班级群 →
 * 在完成情况里看谁交了 → 挑优秀作品发布到成果展厅。
 */
;(() => {
  'use strict'

  if (window.__AIQ_CLASS_STUDIO__) return
  window.__AIQ_CLASS_STUDIO__ = true

  // 本模块在入口 bundle 之前加载：此时地址栏还是用户原始深链接。
  // 入口的 catch-all 会把未知的 /me/classes 重定向到 /，晚一步就读不到了。
  const INITIAL_HASH = window.location.hash
  const MAX_MEMBERS = 100

  // ── 图标 ───────────────────────────────────────────────────
  const ICONS = {
    users:
      '<path d="M16 20.5v-1.6a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1.6"/><circle cx="9" cy="7.5" r="3.5"/><path d="M22 20.5v-1.6a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
    book: '<path d="M12 5.5C10 4.2 7.6 3.5 5 3.5v15c2.6 0 5 .7 7 2 2-1.3 4.4-2 7-2v-15c-2.6 0-5 .7-7 2z"/><path d="M12 5.5v15"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1"/>',
    link:
      '<path d="M10 13.5a4 4 0 0 0 5.7 0l2.8-2.8a4 4 0 0 0-5.7-5.7L11.5 6.3"/><path d="M14 10.5a4 4 0 0 0-5.7 0l-2.8 2.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
    trash:
      '<path d="M4 6.5h16M9 6.5V4h6v2.5M6.5 6.5l.8 13a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-13"/><path d="M10 10.5v6M14 10.5v6"/>',
    edit: '<path d="M4 20h4.3L19.6 8.7a2.1 2.1 0 0 0 0-3l-1.3-1.3a2.1 2.1 0 0 0-3 0L4 15.7V20z"/><path d="M13.5 6.5l4 4"/>',
    check: '<path d="M5 12.5l4.3 4.3L19 7"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    eye: '<path d="M3 12s3.4-6 9-6 9 6 9 6-3.4 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="2.8"/>',
    refresh:
      '<path d="M20 11a8 8 0 0 0-14.7-4M4 5v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4M20 19v-5h-5"/>',
    rotate: '<path d="M20 11a8 8 0 0 0-14.7-4M4 5v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4M20 19v-5h-5"/>',
    alert: '<path d="M12 4l9 16H3L12 4z"/><path d="M12 10v4M12 17h.01"/>',
    sparkles:
      '<path d="M12 3.5l1.7 4.3 4.3 1.7-4.3 1.7L12 15.5l-1.7-4.3L6 9.5l4.3-1.7L12 3.5z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
    star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.7l5.8-.8L12 3.6z"/>',
    image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 19"/>',
    file: '<path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5L14 3.5z"/><path d="M14 3.5v5h5M9 13h6M9 16.5h6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4.5 16v3.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V16"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><path d="M12 14.5v2"/>',
  }

  const svgIcon = (name, cls) =>
    `<svg class="cls-i${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.sparkles}</svg>`

  // ── 作业目录 ───────────────────────────────────────────────
  // 互动练习清单与后端 src/lib/assign-catalog.ts 同步；课程活动来自首页课程页。
  // 这里只用于创建作业时选择内容，发布所需的元数据仍以后端目录为准。
  const LABS = [
    { id: 'device-detection', title: 'AI 设备辨别大挑战', module: 'm1', grade: 'low', type: '互动练习', hue: 210 },
    { id: 'ai-senses', title: 'AI 的五官配对', module: 'm1', grade: 'low', type: '互动练习', hue: 200 },
    { id: 'input-output', title: '输入 → 分析 → 输出', module: 'm1', grade: 'mid', type: '流程图', hue: 265 },
    { id: 'ai-mistakes', title: 'AI 也会犯错', module: 'm1', grade: 'mid', type: '案例分析', hue: 20 },
    { id: 'fruit-trainer', title: '教机器分水果', module: 'm1', grade: 'high', type: 'AI 实验', hue: 120 },
    { id: 'ethics-court', title: 'AI 伦理小法庭', module: 'm1', grade: 'high', type: 'AI 伦理守则', hue: 220 },
    { id: 'prompt-builder', title: '提示词魔法工坊', module: 'm2', grade: 'mid', type: '提示词设计', hue: 265 },
    { id: 'virtual-museum', title: 'MR 虚拟博物馆搭建', module: 'm3', grade: 'mid', type: 'MR 空间方案', hue: 175 },
    { id: 'mr-designer', title: '未来智慧博物馆设计', module: 'm3', grade: 'high', type: 'MR 设计方案', hue: 190 },
    { id: 'inventor', title: 'AI 发明家工作台', module: 'm4', grade: 'mid', type: 'AI 发明作品', hue: 35 },
    { id: 'plant-butler', title: '智能植物管家模拟器', module: 'm4', grade: 'mid', type: '仿真实验', hue: 140 },
    { id: 'quiz-arena', title: 'AI 知识挑战赛', module: 'all', grade: 'mid', type: '闯关答题', hue: 45 },
  ]

  const CURRICULUM = [
    { id: "m1", code: "AI·认知", name: "探索智能", stages: {
      low: { theme: "身边的 AI 小伙伴", activities: [
        ["情境导入", "播放“小智的一天”动画，观察主角用到的智能设备"],
        ["AI 大搜寻", "小组抢答：教室里、家里、路上哪些东西会“思考”"],
        ["五官配对游戏", "把摄像头、麦克风、芯片、机械臂贴到 AI 的“眼耳鼻脑手”"],
        ["语音助手对话", "全班一起向智能音箱提问，观察它听懂了吗"],
        ["绘制发现地图", "手绘《我的 AI 发现地图》并上台分享"],
      ], labs: ["device-detection","ai-senses"] },
      mid: { theme: "AI 是怎样认识世界的", activities: [
        ["拆解一台设备", "以人脸识别门禁为例，找出它的“输入器官”"],
        ["流程拼图", "把打乱的“输入→分析→输出”卡片按顺序拼好"],
        ["识别实验", "上传 5 张图片，记录 AI 认对 / 认错的情况"],
        ["为什么会错", "讨论：模糊、遮挡、少见的角度会让 AI 犯错"],
        ["流程图绘制", "自选一个 AI 应用，画出完整工作流程图"],
      ], labs: ["input-output","ai-mistakes"] },
      high: { theme: "AI 为什么会“聪明”", activities: [
        ["规则 VS 学习", "对比“固定规则程序”和“会学习的 AI”有什么不同"],
        ["教机器分水果", "给水果标注特征、投喂数据，训练并测试模型准确率"],
        ["数据偏差实验", "只喂红苹果，看看模型遇到青苹果会怎样"],
        ["伦理小法庭", "辩论：AI 能不能随便采集我们的脸和数据"],
        ["设计师提案", "完成《我是 AI 设计师》应用设计方案"],
      ], labs: ["fruit-trainer","ethics-court","quiz-arena"] },
    } },
    { id: "m2", code: "AI·生成", name: "创作智能", stages: {
      low: { theme: "AI 把故事画出来", activities: [
        ["读诗想画面", "朗读《咏鹅》，说说脑海里出现了什么"],
        ["五要素描述", "用“谁 + 在哪 + 做什么 + 什么颜色 + 什么心情”说清画面"],
        ["AI 作画", "把描述交给 AI，生成图片并投屏对比"],
        ["找不同", "对比自己想的画和 AI 的画，讨论为什么不一样"],
        ["装订绘本", "把 3-4 张图做成一页页《AI 课文绘本》"],
      ], labs: ["prompt-builder"] },
      mid: { theme: "AI 让课本动起来", activities: [
        ["提示词拆解", "给出一句提示词，找出“主体/场景/动作/风格/镜头”"],
        ["分组选题", "选定《草船借箭》《司马光》《观潮》等课文场景"],
        ["角色与场景", "用提示词工作台生成人物与场景图"],
        ["配音与对白", "写人物对白，生成配音并试听"],
        ["合成与展映", "拼接成 AI 故事短片，小组放映互评"],
      ], labs: ["prompt-builder"] },
      high: { theme: "用 AI 重新表达知识", activities: [
        ["知识点拆解", "选择水循环/历史事件等知识点，写成 60 秒脚本"],
        ["提示词进阶", "加入限制条件（比例、光线、构图、禁止元素）"],
        ["多模态生产", "文生图 → 图生视频 → 文生语音，串成素材链"],
        ["事实核验", "交叉查证 AI 内容中的事实错误并修改"],
        ["版权与标注", "为作品加上“AI 辅助创作”标注与素材来源"],
      ], labs: ["prompt-builder","quiz-arena"] },
    } },
    { id: "m3", code: "AI·交互", name: "体验智能", stages: {
      low: { theme: "把数字世界带到身边", activities: [
        ["戴上设备", "认识 MR 头显，学习安全佩戴与手势"],
        ["虚实初体验", "在教室中看见悬浮的数字恐龙/星球"],
        ["寻找太阳系", "分组在教室各处找到 8 颗虚拟行星"],
        ["任务卡记录", "画出找到的星球，写下“真+假=混合现实”"],
        ["分享感受", "说说数字东西“站在”教室里的感觉"],
      ], labs: ["virtual-museum"] },
      mid: { theme: "虚拟世界怎样认识真实空间", activities: [
        ["技术拆解", "拆开讲：摄像头感知环境、空间定位、手势识别"],
        ["位置匹配挑战", "把虚拟展品拖到教室平面图的正确坐标上"],
        ["搭建博物馆", "小组在真实空间中布置 4 个展区"],
        ["技术小结", "写下“虚拟世界是怎么认识真实空间的”"],
      ], labs: ["virtual-museum","ai-senses"] },
      high: { theme: "设计虚实融合的智能空间", activities: [
        ["场景扫描", "调研 MR 在博物馆/医院/城市中的应用案例"],
        ["用户画像", "为未来智慧博物馆定义 3 类参观者需求"],
        ["功能拼装", "组合 AI 讲解、手势控制、个性化推荐等模块"],
        ["方案输出", "生成完整 MR 智能应用设计方案并导出"],
        ["路演答辩", "小组路演，互相提问优化点"],
      ], labs: ["mr-designer","inventor"] },
    } },
    { id: "m4", code: "AI·实践", name: "创造智能", stages: {
      low: { theme: "AI 小小发明家", activities: [
        ["烦恼收集站", "说说校园和家里最不方便的三件事"],
        ["发明畅想", "给烦恼配一个“会思考”的机器伙伴"],
        ["动手搭建", "用积木/纸盒/彩泥做出发明模型"],
        ["发明发布会", "给发明起名字，说出它解决什么问题"],
      ], labs: ["inventor"] },
      mid: { theme: "让 AI 帮助我们解决问题", activities: [
        ["项目立项", "选定“智能植物管家”，明确要解决的问题"],
        ["知识地图", "找出项目里的科学/技术/工程/数学/艺术/AI 要素"],
        ["阈值设定", "设定土壤湿度、光照的浇水判断规则"],
        ["仿真调试", "在模拟器中跑一周数据，观察判断是否正确"],
        ["优化迭代", "根据测试结果调整阈值并写小结"],
      ], labs: ["plant-butler","inventor"] },
      high: { theme: "AI 创新项目挑战", activities: [
        ["选题与调研", "智慧校园选题，做 5 人以上的需求访谈"],
        ["数据设计", "列出项目需要采集哪些数据、怎么采集"],
        ["方案与分工", "完成 AI 方案设计与小组角色分工"],
        ["原型制作", "制作可演示的项目原型（模型/界面/流程）"],
        ["测试与优化", "记录误差，提出优化方案"],
        ["成果路演", "项目报告 + 原型展示 + 答辩"],
      ], labs: ["inventor","fruit-trainer","quiz-arena"] },
    } },
  ]

  const MODULES = CURRICULUM.map((m) => ({
    id: m.id,
    code: m.code,
    name: m.name,
    stages: Object.fromEntries(
      Object.entries(m.stages).map(([key, st]) => [
        key,
        {
          theme: st.theme,
          labs: st.labs,
          activities: st.activities.map(([title, desc]) => ({ title, desc })),
        },
      ]),
    ),
  }))

  const STAGE_KEYS = ['low', 'mid', 'high']
  const STAGE_TEXT = { low: '低段 1–2 年级', mid: '中段 3–4 年级', high: '高段 5–6 年级' }
  const TYPE_TEXT = { storybook: 'AI 绘本创作', lab: '互动练习', task: '课程任务', quiz: '试卷' }
  const TYPE_ICON = { storybook: 'book', lab: 'sparkles', task: 'file', quiz: 'file' }

  const moduleById = (id) => MODULES.find((m) => m.id === id) || null
  const labById = (id) => LABS.find((l) => l.id === id) || null
  const stageOf = (moduleId, stage) => {
    const mod = moduleById(moduleId)
    return (mod && mod.stages[stage]) || null
  }

  function labSelectOptions() {
    const groups = MODULES.map((m) => {
      const labs = LABS.filter((l) => l.module === m.id)
      if (!labs.length) return ''
      return `<optgroup label="${esc(`${m.code} · ${m.name}`)}">${labs
        .map((l) => `<option value="${esc(l.id)}">${esc(l.title)} · ${STAGE_TEXT[l.grade] || ''}</option>`)
        .join('')}</optgroup>`
    }).join('')
    const others = LABS.filter((l) => !moduleById(l.module))
    return (
      groups +
      (others.length
        ? `<optgroup label="综合">${others
            .map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`)
            .join('')}</optgroup>`
        : '')
    )
  }

  function moduleOptionsHtml() {
    return MODULES.map((m) => `<option value="${esc(m.id)}">${esc(`${m.code} · ${m.name}`)}</option>`).join('')
  }

  function stageOptionsHtml() {
    return STAGE_KEYS.map((k) => `<option value="${k}">${esc(STAGE_TEXT[k])}</option>`).join('')
  }

  // ── 小工具 ─────────────────────────────────────────────────
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    })

  function dateText(iso) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`
  }

  function timeText(iso) {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  function safeImage(src) {
    return typeof src === 'string' && /^\/uploads\/works\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(src)
      ? src
      : ''
  }

  function shareLink(token) {
    const base = window.location.href.split('#')[0]
    return `${base}#/assign/${encodeURIComponent(token)}`
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* 非安全上下文 / 浏览器拒绝，退回 execCommand */
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.setAttribute('readonly', '')
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        return ok
      } catch {
        return false
      }
    }
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
      err.code = (e && e.code) || ''
      throw err
    }
    return json
  }

  // ── 状态 ───────────────────────────────────────────────────
  const S = {
    mode: 'list',
    classId: '',
    assignmentId: '',
    me: null,
    classes: [],
    cls: null,
    groups: [],
    assignment: null,
    loading: false,
    error: '',
    filter: '',
    statusFilter: 'all',
    busy: new Set(),
  }
  let seq = 0
  let root = null
  let toastEl = null
  let rootListeners = null

  function resetState(mode, params) {
    S.mode = mode
    S.classId = (params && params.id) || ''
    S.assignmentId = (params && params.assignmentId) || ''
    S.classes = []
    S.cls = null
    S.groups = []
    S.assignment = null
    S.loading = true
    S.error = ''
    S.filter = ''
    S.statusFilter = 'all'
    S.busy = new Set()
  }

  const STATUS_TEXT = {
    submitted: '已提交',
    started: '进行中',
    not_started: '未开始',
  }

  const statusChip = (status) => {
    const cls = status === 'submitted' ? 'is-done' : status === 'started' ? 'is-doing' : 'is-idle'
    return `<span class="cls-chip ${cls}">${STATUS_TEXT[status] || esc(status)}</span>`
  }

  function classLink(id) {
    return `#/me/classes/${encodeURIComponent(id)}`
  }

  function assignmentLink(classId, assignmentId) {
    return `#/me/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(assignmentId)}`
  }

  // ── 通用壳 ─────────────────────────────────────────────────
  function skeleton() {
    return `<div class="cls-container">
      <header class="cls-head">
        <span class="cls-tag">${svgIcon('users')}班级管理</span>
        <div class="cls-skel cls-skel-title"></div>
        <div class="cls-skel cls-skel-line"></div>
      </header>
      <div class="cls-skel cls-skel-card"></div>
      <div class="cls-skel cls-skel-card"></div>
    </div>`
  }

  function loginPrompt() {
    const redirect = encodeURIComponent(window.location.hash || '#/me/classes')
    return `<div class="cls-container">
      <section class="cls-card cls-center">
        <span class="cls-empty-icon">${svgIcon('lock')}</span>
        <h2>请先登录</h2>
        <p>班级与作业链接只对登录老师开放。</p>
        <a class="cls-btn cls-primary" href="#/login?redirect=${redirect}">去登录</a>
      </section>
    </div>`
  }

  function errorShell(message, retryAct) {
    return `<div class="cls-container">
      <section class="cls-card cls-center">
        <span class="cls-empty-icon is-danger">${svgIcon('alert')}</span>
        <h2>没有加载出来</h2>
        <p>${esc(message || '请稍后再试')}</p>
        <button type="button" class="cls-btn cls-primary" data-act="${retryAct}">${svgIcon('refresh')}重试</button>
      </section>
    </div>`
  }

  // ── 班级列表 ───────────────────────────────────────────────
  function listShell() {
    const cards = S.classes.length
      ? S.classes
          .map((c) => {
            const hue = (Number(c.id.charCodeAt(0)) * 37 + c.name.length * 23) % 360
            return `<a class="cls-class-card" href="${classLink(c.id)}" style="--cls-hue:${hue}">
              <span class="cls-class-glow" aria-hidden="true"></span>
              <span class="cls-class-top">
                <span class="cls-class-icon">${svgIcon('users')}</span>
                <span class="cls-class-arrow">${svgIcon('arrowRight')}</span>
              </span>
              <b class="cls-class-name">${esc(c.name)}</b>
              <span class="cls-class-meta">
                <span>${svgIcon('user')}${Number(c.members) || 0} 名学生</span>
                <span>${svgIcon('book')}${Number(c.assignments) || 0} 份作业</span>
              </span>
              <span class="cls-class-date">建于 ${esc(dateText(c.createdAt))}</span>
            </a>`
          })
          .join('')
      : `<div class="cls-empty cls-grid-full">
          <span class="cls-empty-icon">${svgIcon('users')}</span>
          <h3>还没有班级</h3>
          <p>先建一个班级、导入学生名单，再生成作业链接。</p>
        </div>`

    return `<div class="cls-container">
      <header class="cls-head">
        <span class="cls-tag">${svgIcon('users')}班级管理</span>
        <h1 class="cls-title">班级与作业</h1>
        <p class="cls-sub">学生不用注册账号：把作业链接发到班级群，学生输入姓名、匹配名单后就能开始创作。完成后在这里查看进度，挑选优秀作品发布到成果展厅。</p>
      </header>

      <section class="cls-card cls-new-class">
        <form class="cls-new-form" data-form="create-class" novalidate>
          <div class="cls-new-field">
            <label for="cls-class-name">新建班级</label>
            <input class="cls-input" id="cls-class-name" name="name" maxlength="60" placeholder="例如：三年级 2 班" autocomplete="off">
          </div>
          <button type="submit" class="cls-btn cls-primary" data-busy="create-class">${svgIcon('plus')}创建班级</button>
        </form>
        <p class="cls-hint">班级上限 20 个，每个班最多 100 名学生；同名学生请填写不同学号。</p>
      </section>

      <div class="cls-section-head">
        <h2>我的班级</h2>
        <span class="cls-count">${S.classes.length} 个</span>
      </div>
      <section class="cls-grid">${cards}</section>
    </div>`
  }

  function rememberFocus() {
    const active = document.activeElement
    return root?.contains(active) ? { id: active.id, act: active.dataset.act, dataId: active.dataset.id } : null
  }

  function restoreViewFocus(key) {
    if (!key || !root) return
    const target = key.id ? document.getElementById(key.id) : [...root.querySelectorAll('[data-act]')]
      .find((el) => el.dataset.act === key.act && el.dataset.id === key.dataId)
    if (target && !target.disabled) target.focus({ preventScroll: true })
  }

  async function loadClasses() {
    const focus = rememberFocus()
    const my = ++seq
    S.loading = true
    S.error = ''
    if (root) root.innerHTML = skeleton()
    try {
      const data = await api('/api/classes')
      if (my !== seq) return
      S.classes = data && Array.isArray(data.classes) ? data.classes : []
      if (!root) return
      root.innerHTML = listShell()
      restoreViewFocus(focus)
      document.title = '班级管理'
    } catch (err) {
      if (my !== seq || !root) return
      if (err.status === 401) {
        root.innerHTML = loginPrompt()
        return
      }
      S.error = err.message || '加载失败'
      root.innerHTML = errorShell(S.error, 'retry-classes')
    } finally {
      if (my === seq) S.loading = false
    }
  }

  // ── 班级详情 ───────────────────────────────────────────────
  function memberRows() {
    if (!S.cls.members.length) {
      return `<li class="cls-roster-empty">名单还是空的，先在下面导入学生姓名。</li>`
    }
    return S.cls.members
      .map(
        (m, i) => `<li class="cls-member" data-member-id="${esc(m.id)}">
          <span class="cls-member-index">${i + 1}</span>
          <span class="cls-member-info"><span class="cls-member-name">${esc(m.name)}</span><small>${esc([m.studentNo && `学号 ${m.studentNo}`, m.gender, m.score != null && `成绩 ${m.score}`].filter(Boolean).join(' · '))}</small></span>
          <span class="cls-member-actions">
            <button type="button" class="cls-icon-btn" data-act="rename-member" data-id="${esc(m.id)}" title="编辑学生资料" aria-label="编辑 ${esc(m.name)}${m.studentNo ? `（学号 ${esc(m.studentNo)}）` : ''} 的资料">${svgIcon('edit')}</button>
            <button type="button" class="cls-icon-btn is-danger" data-act="delete-member" data-id="${esc(m.id)}" title="移出名单" aria-label="移出 ${esc(m.name)}">${svgIcon('trash')}</button>
          </span>
        </li>`,
      )
      .join('')
  }

  function assignmentMetaText(a) {
    const bits = [TYPE_TEXT[a.type] || '作业']
    if (a.type === 'lab' && a.labTitle) bits.push(a.labTitle)
    if (a.type === 'task') {
      const mod = moduleById(a.moduleId)
      if (mod) bits.push(mod.name)
      if (a.activity) bits.push(a.activity)
      if (a.toolLabTitle) bits.push(`工具台：${a.toolLabTitle}`)
    }
    return bits.join(' · ')
  }

  function assignmentRows() {
    if (!S.cls.assignments.length) {
      return `<div class="cls-empty cls-assign-empty">
        <span class="cls-empty-icon">${svgIcon('book')}</span>
        <h3>还没有作业</h3>
        <p>创建一份作业，把生成的链接发到班级群。</p>
      </div>`
    }
    return `<ul class="cls-assign-list">${S.cls.assignments
      .map((a) => {
        const total = Number(a.total) || 0
        const done = Number(a.submitted) || 0
        const pct = total ? Math.round((done / total) * 100) : 0
        const closed = a.status !== 'open'
        return `<li class="cls-assign-item">
          <a class="cls-assign-main" href="${assignmentLink(S.cls.id, a.id)}">
            <span class="cls-assign-icon${closed ? ' is-closed' : ''}">${svgIcon(TYPE_ICON[a.type] || 'book')}</span>
            <span class="cls-assign-info">
              <b>${esc(a.title)}</b>
              <small class="cls-assign-kind">${esc(assignmentMetaText(a))}</small>
              <small>${done} / ${total} 人已提交 · 建于 ${esc(dateText(a.createdAt))}</small>
              <span class="cls-progress" aria-hidden="true"><i style="width:${pct}%"></i></span>
            </span>
            <span class="cls-chip ${closed ? 'is-idle' : 'is-open'}">${a.status === 'draft' ? '草稿' : closed ? '已关闭' : '进行中'}</span>
            ${svgIcon('arrowRight', 'cls-assign-go')}
          </a>
        </li>`
      })
      .join('')}</ul>`
  }

  function groupsCardHtml() {
    const groups = S.groups || []
    return `<section class="cls-card cls-groups-card">
      <div class="cls-card-head cls-groups-head"><div><h2>班级分组 <span class="cls-count">${groups.length} 组</span></h2><p>分组会保存在班级中；每名学生仍单独完成、提交作业。</p></div>
        <button type="button" class="cls-btn cls-primary" data-act="edit-groups" ${S.cls && S.cls.members.length ? '' : 'disabled'}>${svgIcon('users')}${groups.length ? '调整分组' : '创建分组'}</button></div>
      ${groups.length ? `<div class="cls-group-grid">${groups.map((g) => `<article class="cls-group-card"><h3>${esc(g.name)}</h3><p>${(g.members || []).map((m) => `<span class="cls-group-chip">${esc(m.name)}${m.studentNo ? ` <small>${esc(m.studentNo)}</small>` : ''}</span>`).join('') || '暂无成员'}</p></article>`).join('')}</div>` : '<p class="cls-hint">可以按组数随机分配，也可参考已提供的性别或成绩进行均衡，然后逐人调整。</p>'}
    </section>`
  }

  function shuffled(items) {
    const result = items.slice()
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }

  function distributeGroups(members, count, mode) {
    const n = Math.max(1, Math.min(members.length, Math.trunc(count) || 1))
    const groups = Array.from({ length: n }, (_, i) => ({ name: `第 ${i + 1} 组`, memberIds: [], total: 0, genders: {} }))
    let people = shuffled(members)
    if (mode === 'score') people.sort((a, b) => (b.score == null ? -1 : Number(b.score)) - (a.score == null ? -1 : Number(a.score)))
    people.forEach((member) => {
      const shortest = Math.min(...groups.map((g) => g.memberIds.length))
      const candidates = groups.filter((g) => g.memberIds.length === shortest)
      if (mode === 'score') candidates.sort((a, b) => a.total - b.total)
      if (mode === 'gender') candidates.sort((a, b) => (a.genders[member.gender || '未提供'] || 0) - (b.genders[member.gender || '未提供'] || 0))
      const group = candidates[0]
      group.memberIds.push(member.id)
      group.total += Number(member.score) || 0
      const gender = member.gender || '未提供'
      group.genders[gender] = (group.genders[gender] || 0) + 1
    })
    return groups.map(({ name, memberIds }) => ({ name, memberIds }))
  }

  function editGroupsModal() {
    if (!S.cls || !S.cls.members.length) return
    const cls = S.cls
    let draft = (S.groups || []).map((g) => ({ name: g.name, memberIds: (g.members || []).map((m) => m.id) }))
    if (!draft.length) draft = distributeGroups(cls.members, Math.ceil(cls.members.length / 4), 'random')
    const editor = () => `<div class="cls-group-names">${draft.map((g, i) => `<label>第 ${i + 1} 组名称<input class="cls-input" data-group-name="${i}" maxlength="60" value="${esc(g.name)}"></label>`).join('')}</div>
      <div class="cls-group-members">${cls.members.map((m, i) => {
        const found = draft.findIndex((g) => g.memberIds.includes(m.id))
        return `<label class="cls-group-member"><span>${esc(m.name)}${m.studentNo ? `<small>学号 ${esc(m.studentNo)}</small>` : ''}</span><select class="cls-input" data-group-member="${esc(m.id)}" aria-label="${esc(m.name)}${m.studentNo ? `（学号 ${esc(m.studentNo)}）` : ''} 的分组">${draft.map((g, j) => `<option value="${j}"${j === Math.max(0, found) ? ' selected' : ''}>${esc(g.name || `第 ${j + 1} 组`)}</option>`).join('')}</select></label>`
      }).join('')}</div>`
    openModal(`<form class="cls-modal-form" data-form="save-groups"><div class="cls-modal-head"><div><h2>调整班级分组</h2><p class="cls-modal-sub">${cls.members.length} 名学生，每人只属于一个小组。</p></div><button type="button" class="cls-icon-btn" data-act="close-modal" aria-label="关闭">${svgIcon('close')}</button></div>
      <div class="cls-group-controls"><label>小组数量<input class="cls-input" data-group-count type="number" min="1" max="${cls.members.length}" value="${draft.length}"></label><label>分配方式<select class="cls-input" data-group-mode><option value="random">随机分配</option><option value="gender">参考性别均衡</option><option value="score">参考成绩均衡</option></select></label><button type="button" class="cls-btn" data-group-generate>生成分组预览</button></div>
      <p class="cls-hint">未提供的性别或成绩不会补造；生成后还可以逐人调整。保存只更新分组，不改变作业和学生提交。</p><div data-group-editor>${editor()}</div><p class="cls-inline-error" data-group-error role="alert"></p><div class="cls-modal-actions"><button type="button" class="cls-btn cls-ghost" data-act="close-modal">取消</button><button type="submit" class="cls-btn cls-primary" data-busy="save-groups">确认保存分组</button></div></form>`, (el) => {
      const form = el.querySelector('form')
      const errors = el.querySelector('[data-group-error]')
      const read = () => {
        const result = draft.map((g, i) => ({ name: el.querySelector(`[data-group-name="${i}"]`).value.trim(), memberIds: [] }))
        el.querySelectorAll('[data-group-member]').forEach((select) => result[Number(select.value)].memberIds.push(select.dataset.groupMember))
        return result
      }
      el.querySelector('[data-group-generate]').addEventListener('click', () => {
        const count = Number(el.querySelector('[data-group-count]').value)
        const mode = el.querySelector('[data-group-mode]').value
        if (!Number.isInteger(count) || count < 1 || count > cls.members.length) { errors.textContent = '组数需在 1 与班级人数之间'; return }
        if (mode === 'score' && !cls.members.some((m) => m.score != null)) { errors.textContent = '名单尚未提供成绩，请先补充或选择随机分配'; return }
        if (mode === 'gender' && !cls.members.some((m) => m.gender)) { errors.textContent = '名单尚未提供性别，请先补充或选择随机分配'; return }
        draft = distributeGroups(cls.members, count, mode)
        el.querySelector('[data-group-editor]').innerHTML = editor()
        errors.textContent = ''
      })
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const groups = read()
        if (groups.some((g) => !g.name || !g.memberIds.length)) { errors.textContent = '每组都需要名称和至少一名学生'; return }
        if (new Set(groups.map((g) => g.name)).size !== groups.length) { errors.textContent = '小组名称不能重复'; return }
        withBusy('save-groups', async () => {
          try {
            await api(`/api/classes/${encodeURIComponent(cls.id)}/groups`, { method: 'PUT', body: { groups } })
            if (modalEl !== el) return
            closeModal()
            showToast('分组已保存，学生仍各自提交作业')
            if (S.classId === cls.id) await loadClass()
          } catch (err) { if (modalEl === el) errors.textContent = err.message || '分组保存失败' }
        })
      })
    })
  }

  function classShell() {
    const c = S.cls
    const canAdd = c.memberCount < MAX_MEMBERS
    return `<div class="cls-container">
      <a class="cls-back" href="#/me/classes">${svgIcon('arrowLeft')}返回班级列表</a>
      <header class="cls-head cls-class-head">
        <div>
          <span class="cls-tag">${svgIcon('users')}班级管理</span>
          <h1 class="cls-title">${esc(c.name)}</h1>
          <p class="cls-sub">${c.memberCount} 名学生 · ${c.assignments.length} 份作业 · 建于 ${esc(dateText(c.createdAt))}</p>
        </div>
        <div class="cls-head-actions">
          <button type="button" class="cls-btn cls-ghost" data-act="rename-class">${svgIcon('edit')}重命名</button>
          <button type="button" class="cls-btn cls-danger-ghost" data-act="delete-class">${svgIcon('trash')}删除班级</button>
        </div>
      </header>

      <div class="cls-detail-grid">
        <section class="cls-card cls-roster">
          <div class="cls-card-head">
            <h2>学生名单 <span class="cls-count">${c.memberCount} / ${MAX_MEMBERS}</span></h2>
            <p>姓名必填；学号、性别和成绩可留空。同名学生请补充不同学号，进入作业时再核对学号。</p>
          </div>
          <form class="cls-roster-form" data-form="add-members" novalidate>
            <label class="cls-sr" for="cls-roster-paste">粘贴学生名单</label>
            <textarea class="cls-textarea" id="cls-roster-paste" name="names" rows="3" placeholder="每行一个姓名，或从表格粘贴四列：姓名、学号、性别、成绩&#10;李明&#9;001&#9;男&#9;85&#10;王小雨&#9;002&#9;女" ${canAdd ? '' : 'disabled'}></textarea>
            <div class="cls-roster-form-foot">
              <span class="cls-hint">${canAdd ? '支持姓名列表和带表头的表格；图片和文件名单可交给「智能备课」整理。' : '名单已满 100 人。'}</span>
              <button type="submit" class="cls-btn cls-primary" data-busy="add-members" ${canAdd ? '' : 'disabled'}>${svgIcon('plus')}导入名单</button>
            </div>
          </form>
          <ul class="cls-roster-list">${memberRows()}</ul>
        </section>

        <section class="cls-card cls-assignments">
          <div class="cls-card-head">
            <h2>作业 <span class="cls-count">${c.assignments.length}</span></h2>
            <p>选择 AI 绘本、互动练习、课程任务或试卷；试卷可以先保存草稿，检查后再发布。</p>
          </div>
          <form class="cls-assign-form" data-form="create-assignment" novalidate>
            <div class="cls-field">
              <label for="cls-assign-type">作业内容</label>
              <select class="cls-input cls-select" id="cls-assign-type" name="type">
                <option value="storybook">AI 绘本创作 · 学生用创作台生成绘本</option>
                <option value="lab">互动练习 · 学生完成指定训练并提交成绩</option>
                <option value="task">课程任务 · 学生写文字、传照片，可搭配工具台</option>
                <option value="quiz">试卷 · 单选和判断，学生只提交一次</option>
              </select>
            </div>
            <div class="cls-field" data-assign-kind="lab" hidden>
              <label for="cls-assign-lab">选择互动练习</label>
              <select class="cls-input cls-select" id="cls-assign-lab" name="labId">${labSelectOptions()}</select>
              <span class="cls-hint" data-assign-lab-hint></span>
            </div>
            <div class="cls-kind-fields" data-assign-kind="task" hidden>
              <div class="cls-field">
                <label for="cls-assign-module">课程模块</label>
                <select class="cls-input cls-select" id="cls-assign-module" name="moduleId">${moduleOptionsHtml()}</select>
              </div>
              <div class="cls-field">
                <label for="cls-assign-stage">学段</label>
                <select class="cls-input cls-select" id="cls-assign-stage" name="stage">${stageOptionsHtml()}</select>
              </div>
              <div class="cls-field cls-kind-wide">
                <label for="cls-assign-activity">课程任务</label>
                <select class="cls-input cls-select" id="cls-assign-activity" name="activity"></select>
                <span class="cls-hint" data-assign-activity-hint></span>
              </div>
              <div class="cls-field cls-kind-wide">
                <label for="cls-assign-tool">配套工具台 <span class="cls-muted">选填</span></label>
                <select class="cls-input cls-select" id="cls-assign-tool" name="toolLabId"></select>
                <span class="cls-hint">学生可以直接从作业页打开这个互动训练，完成后再回来提交。</span>
              </div>
            </div>
            <div class="cls-field" data-assign-kind="quiz" hidden>
              <p class="cls-hint">学生提交后只显示「已提交」；成绩和答案均由你主动公布。</p>
              ${quizBuilderHtml([])}
              <label for="cls-quiz-publish">保存方式</label>
              <select class="cls-input" id="cls-quiz-publish" name="quizStatus"><option value="draft">保存为草稿，稍后发布</option><option value="open">确认后发布给学生</option></select>
            </div>
            <div class="cls-field">
              <label for="cls-assign-title">作业名称</label>
              <input class="cls-input" id="cls-assign-title" name="title" maxlength="120" placeholder="例如：古诗《静夜思》绘本创作" autocomplete="off">
            </div>
            <div class="cls-field">
              <label for="cls-assign-instructions">作业说明 <span class="cls-muted">选填</span></label>
              <textarea class="cls-textarea" id="cls-assign-instructions" name="instructions" rows="2" maxlength="1000" placeholder="例如：选一首学过的古诗，为它画 4 页绘本。"></textarea>
            </div>
            <button type="submit" class="cls-btn cls-primary" data-create-label data-busy="create-assignment" ${c.memberCount ? '' : 'disabled'}>${svgIcon('link')}生成作业链接</button>
            ${c.memberCount ? '' : '<p class="cls-hint">先导入至少一名学生，才能生成作业链接。</p>'}
          </form>
          <div class="cls-assign-wrap">${assignmentRows()}</div>
        </section>
      </div>
      ${groupsCardHtml()}
    </div>`
  }

  async function loadClass() {
    const focus = rememberFocus()
    const my = ++seq
    S.loading = true
    S.error = ''
    if (root) root.innerHTML = skeleton()
    try {
      const [data, groupData] = await Promise.all([
        api(`/api/classes/${encodeURIComponent(S.classId)}`),
        api(`/api/classes/${encodeURIComponent(S.classId)}/groups`),
      ])
      if (my !== seq) return
      S.cls = data && data.class ? data.class : null
      S.groups = Array.isArray(groupData && groupData.groups) ? groupData.groups : []
      if (!S.cls) throw new Error('班级不存在或已被删除')
      if (!root) return
      root.innerHTML = classShell()
      restoreViewFocus(focus)
      document.title = `${S.cls.name} · 班级管理`
    } catch (err) {
      if (my !== seq || !root) return
      if (err.status === 401) {
        root.innerHTML = loginPrompt()
        return
      }
      S.error = err.message || '加载失败'
      root.innerHTML = errorShell(S.error, 'retry-class')
    } finally {
      if (my === seq) S.loading = false
    }
  }

  // ── 作业完成情况 ───────────────────────────────────────────
  function filteredMembers() {
    if (!S.assignment) return []
    const kw = S.filter.trim().toLowerCase()
    return S.assignment.members.filter((m) => {
      if (S.statusFilter !== 'all' && m.status !== S.statusFilter) return false
      if (kw && !String(m.name).toLowerCase().includes(kw)) return false
      return true
    })
  }

  function metricCell(m) {
    const type = (S.assignment && S.assignment.type) || 'storybook'
    if (type === 'lab' || type === 'quiz') {
      return `<span class="cls-score${m.score == null ? ' is-empty' : ''}">${m.score == null ? '—' : `${Number(m.score)} 分`}</span>`
    }
    if (type === 'task') {
      const bits = []
      if (Number(m.imageCount)) bits.push(`${Number(m.imageCount)} 张图`)
      if (m.hasText) bits.push('文字')
      return `<span class="cls-muted">${bits.length ? esc(bits.join(' + ')) : '—'}</span>`
    }
    return `<span class="cls-mono">${Number(m.aiCalls) || 0}</span>`
  }

  function memberTableRows() {
    const rows = filteredMembers()
    if (!S.assignment.members.length) {
      return `<tr><td colspan="6"><div class="cls-empty cls-table-empty"><span class="cls-empty-icon">${svgIcon('users')}</span><h3>班里还没有学生</h3><p>先回到班级页面导入名单，再把作业链接发出去。</p></div></td></tr>`
    }
    if (!rows.length) {
      return `<tr><td colspan="6"><div class="cls-empty cls-table-empty"><span class="cls-empty-icon">${svgIcon('eye')}</span><h3>没有匹配的学生</h3><p>换个姓名关键词或状态筛选看看。</p></div></td></tr>`
    }
    return rows
      .map((m) => {
        const work = m.work
        const published = !!(work && work.published)
        const canPreview = m.status === 'submitted'
        const isQuiz = S.assignment.type === 'quiz'
        const resetDisabled = isQuiz || published || !canPreview
        return `<tr>
          <td data-label="学生"><span class="cls-student">${esc(m.name)}</span>${m.studentNo ? `<small class="cls-student-no">${esc(m.studentNo)}</small>` : ''}</td>
          <td data-label="状态">${statusChip(m.status)}</td>
          <td data-label="${esc(metricLabel())}">${metricCell(m)}</td>
          <td data-label="提交时间"><span class="cls-muted">${m.submittedAt ? esc(timeText(m.submittedAt)) : '—'}</span></td>
          <td data-label="展厅">
            ${published ? '<span class="cls-chip is-published">已发布</span>' : work ? '<span class="cls-chip is-idle">未发布</span>' : '<span class="cls-muted">—</span>'}
          </td>
          <td data-label="操作">
            <div class="cls-row-actions">
              <button type="button" class="cls-btn cls-sm ${canPreview ? '' : 'is-disabled'}" data-act="open-submission" data-id="${esc(m.submissionId || '')}" ${canPreview ? '' : 'disabled'}>${svgIcon('eye')}查看</button>
              ${isQuiz ? '<span class="cls-hint">试卷仅提交一次</span>' : `<button type="button" class="cls-btn cls-sm cls-ghost" data-act="publish-submission" data-id="${esc(m.submissionId || '')}" ${canPreview && !published ? '' : 'disabled'}>${svgIcon('upload')}${published ? '已发布' : '发布'}</button>
              <button type="button" class="cls-btn cls-sm cls-danger-ghost" data-act="reset-submission" data-id="${esc(m.submissionId || '')}" title="${published ? '请先撤下展厅作品' : '清空这次提交，学生可以重做'}" ${resetDisabled ? 'disabled' : ''}>${svgIcon('refresh')}重置</button>`}
            </div>
          </td>
        </tr>`
      })
      .join('')
  }

  function metricLabel() {
    const type = (S.assignment && S.assignment.type) || 'storybook'
    return type === 'lab' || type === 'quiz' ? '得分' : type === 'task' ? '提交内容' : 'AI 次数'
  }

  function assignmentContentCard(a) {
    if (a.type === 'quiz') {
      const questions = a.quiz && Array.isArray(a.quiz.questions) ? a.quiz.questions : []
      return `<section class="cls-card cls-quiz-summary"><div class="cls-card-head"><h2>试卷内容 <span class="cls-count">${questions.length} 题 · ${questions.reduce((n, q) => n + Number(q.points || 0), 0)} 分</span></h2><p>学生只能提交一次，成绩与答案默认不公开。下方答案仅供教师查看。</p></div>
        <div class="cls-quiz-release"><button type="button" class="cls-btn" data-act="publish-quiz-scores" ${a.scoresPublished ? 'disabled' : 'data-busy="quiz-release"'}>${a.scoresPublished ? '成绩已公布' : '公布成绩'}</button><button type="button" class="cls-btn" data-act="publish-quiz-answers" ${a.answersPublished ? 'disabled' : 'data-busy="quiz-release"'}>${a.answersPublished ? '答案解析已公布' : '公布答案解析'}</button>${a.status === 'draft' ? '<button type="button" class="cls-btn cls-ghost" data-act="edit-quiz">编辑草稿</button>' : ''}</div>
        <details class="cls-quiz-details"><summary>查看题目和标准答案</summary>${quizPreviewHtml(questions)}</details></section>`
    }
    if (a.type === 'lab') {
      const lab = labById(a.labId)
      return `<section class="cls-card cls-instructions">
        ${svgIcon('sparkles')}
        <div>
          <b>互动练习</b>
          <p>${lab ? `<a class="cls-inline-link" href="#/lab/${encodeURIComponent(lab.id)}" target="_blank" rel="noopener">${esc(lab.title)}</a> · ${esc(STAGE_TEXT[lab.grade] || '')}` : '互动练习已下线'}</p>
        </div>
      </section>`
    }
    if (a.type === 'task') {
      const mod = moduleById(a.moduleId)
      const st = stageOf(a.moduleId, a.stage)
      const tool = a.toolLabId ? labById(a.toolLabId) : null
      return `<section class="cls-card cls-instructions">
        ${svgIcon('file')}
        <div>
          <b>课程任务</b>
          <p>${esc([mod && `${mod.code} · ${mod.name}`, STAGE_TEXT[a.stage], st && st.theme, a.activity].filter(Boolean).join(' · '))}${
            tool
              ? `<br>配套工具台：<a class="cls-inline-link" href="#/lab/${encodeURIComponent(tool.id)}" target="_blank" rel="noopener">${esc(tool.title)}</a>`
              : ''
          }</p>
        </div>
      </section>`
    }
    return ''
  }

  function assignmentShell() {
    const a = S.assignment
    const cls = a.className
    const st = a.stats
    const url = shareLink(a.token)
    const closed = a.status !== 'open'
    const meta = [cls, assignmentMetaText(a), `建于 ${dateText(a.createdAt)}`].join(' · ')
    return `<div class="cls-container">
      <a class="cls-back" href="${classLink(S.classId)}">${svgIcon('arrowLeft')}返回 ${esc(cls)}</a>
      <header class="cls-head cls-class-head">
        <div>
          <span class="cls-tag">${svgIcon(TYPE_ICON[a.type] || 'book')}作业完成情况</span>
          <h1 class="cls-title">${esc(a.title)}</h1>
          <p class="cls-sub">${esc(meta)}</p>
        </div>
        <div class="cls-head-actions">
          <span class="cls-chip ${closed ? 'is-idle' : 'is-open'}">${a.status === 'draft' ? '草稿' : closed ? '已关闭' : '接收提交中'}</span>
          <button type="button" class="cls-btn cls-ghost" data-act="toggle-assignment">${a.status === 'draft' ? '发布试卷' : closed ? '重新开放' : '关闭作业'}</button>
          <button type="button" class="cls-btn cls-danger-ghost" data-act="delete-assignment">${svgIcon('trash')}删除</button>
        </div>
      </header>

      ${assignmentContentCard(a)}
      ${a.instructions ? `<section class="cls-card cls-instructions">${svgIcon('file')}<div><b>作业说明</b><p>${esc(a.instructions)}</p></div></section>` : ''}

      <section class="cls-card cls-share">
        <div class="cls-share-head">
          <span class="cls-share-icon">${svgIcon('link')}</span>
          <div>
            <h2>发给学生的作业链接</h2>
            <p>学生输入姓名，同名时补充学号；不需要注册账号。${a.status === 'draft' ? '当前为草稿，发布前学生不能作答。' : ''}</p>
          </div>
        </div>
        <div class="cls-share-row">
          <input class="cls-input cls-share-input" id="cls-share-url" readonly value="${esc(url)}" aria-label="作业链接">
          <button type="button" class="cls-btn cls-primary" data-act="copy-link">${svgIcon('copy')}复制链接</button>
          <button type="button" class="cls-btn cls-ghost" data-act="rotate-link" title="换新链接后，旧链接和已进入的会话立即失效">${svgIcon('rotate')}换新链接</button>
        </div>
        <p class="cls-hint">${closed ? '作业已关闭：链接仍可打开，但学生不能进入或提交。' : '链接本身就是入场凭证，请只发给本班学生。'}</p>
      </section>

      <section class="cls-stats">
        <div class="cls-stat"><span class="cls-stat-icon is-total">${svgIcon('users')}</span><b>${st.total}</b><small>班级人数</small></div>
        <div class="cls-stat"><span class="cls-stat-icon is-done">${svgIcon('check')}</span><b>${st.submitted}</b><small>已提交</small></div>
        <div class="cls-stat"><span class="cls-stat-icon is-doing">${svgIcon('clock')}</span><b>${st.started}</b><small>进行中</small></div>
        <div class="cls-stat"><span class="cls-stat-icon is-idle">${svgIcon('user')}</span><b>${st.notStarted}</b><small>未开始</small></div>
      </section>

      <section class="cls-card cls-table-card">
        <div class="cls-table-head">
          <h2>完成情况</h2>
          <div class="cls-table-tools">
            <input class="cls-input cls-search" id="cls-member-search" type="search" placeholder="搜索学生姓名" value="${esc(S.filter)}" autocomplete="off">
            <select class="cls-input cls-select" id="cls-status-filter" aria-label="按状态筛选">
              <option value="all"${S.statusFilter === 'all' ? ' selected' : ''}>全部状态</option>
              <option value="submitted"${S.statusFilter === 'submitted' ? ' selected' : ''}>已提交</option>
              <option value="started"${S.statusFilter === 'started' ? ' selected' : ''}>进行中</option>
              <option value="not_started"${S.statusFilter === 'not_started' ? ' selected' : ''}>未开始</option>
            </select>
          </div>
        </div>
        <div class="cls-table-scroll">
          <table class="cls-table">
            <thead><tr><th>学生</th><th>状态</th><th>${esc(metricLabel())}</th><th>提交时间</th><th>展厅</th><th>操作</th></tr></thead>
            <tbody>${memberTableRows()}</tbody>
          </table>
        </div>
      </section>
    </div>`
  }

  async function loadAssignment() {
    const focus = rememberFocus()
    const my = ++seq
    S.loading = true
    S.error = ''
    if (root) root.innerHTML = skeleton()
    try {
      const data = await api(
        `/api/classes/${encodeURIComponent(S.classId)}/assignments/${encodeURIComponent(S.assignmentId)}`,
      )
      if (my !== seq) return
      S.assignment = data && data.assignment ? { ...data.assignment, members: data.members || [], stats: data.stats } : null
      if (!S.assignment) throw new Error('作业不存在或已被删除')
      if (!root) return
      root.innerHTML = assignmentShell()
      restoreViewFocus(focus)
      document.title = `${S.assignment.title} · 作业完成情况`
    } catch (err) {
      if (my !== seq || !root) return
      if (err.status === 401) {
        root.innerHTML = loginPrompt()
        return
      }
      S.error = err.message || '加载失败'
      root.innerHTML = errorShell(S.error, 'retry-assignment')
    } finally {
      if (my === seq) S.loading = false
    }
  }

  // 更新完成情况表格与统计，不整页重绘（保留搜索框焦点）
  function refreshAssignmentView() {
    if (!root || S.mode !== 'assignment' || !S.assignment) return
    const a = S.assignment
    const st = a.stats || { total: 0, submitted: 0, started: 0, notStarted: 0 }
    a.stats = {
      total: st.total,
      submitted: a.members.filter((m) => m.status === 'submitted').length,
      started: a.members.filter((m) => m.status === 'started').length,
      notStarted: a.members.filter((m) => m.status === 'not_started').length,
    }
    const stats = root.querySelector('.cls-stats')
    if (stats) {
      const nums = stats.querySelectorAll('.cls-stat b')
      if (nums.length === 4) {
        nums[0].textContent = a.stats.total
        nums[1].textContent = a.stats.submitted
        nums[2].textContent = a.stats.started
        nums[3].textContent = a.stats.notStarted
      }
    }
    const tbody = root.querySelector('.cls-table tbody')
    if (tbody) tbody.innerHTML = memberTableRows()
  }

  // ── 弹层 ───────────────────────────────────────────────────
  let modalEl = null
  let modalCleanup = null
  let modalReturnFocus = null

  function closeModal({ restoreFocus = true } = {}) {
    if (modalCleanup) {
      try {
        modalCleanup()
      } catch {
        /* 忽略 */
      }
      modalCleanup = null
    }
    if (modalEl) {
      modalEl.remove()
      modalEl = null
    }
    if (restoreFocus) {
      if (modalReturnFocus && modalReturnFocus.isConnected) modalReturnFocus.focus({ preventScroll: true })
      modalReturnFocus = null
    }
  }

  function openModal(html, onReady) {
    const returnFocus = modalReturnFocus || document.activeElement
    closeModal({ restoreFocus: false })
    modalReturnFocus = returnFocus
    modalEl = document.createElement('div')
    modalEl.className = 'cls-modal-backdrop'
    modalEl.innerHTML = `<div class="cls-modal" role="dialog" aria-modal="true">${html}</div>`
    document.body.appendChild(modalEl)
    const backdrop = modalEl
    const dialog = backdrop.querySelector('.cls-modal')
    dialog.tabIndex = -1
    const title = dialog.querySelector('h2')
    if (title) {
      title.id = 'cls-modal-title'
      dialog.setAttribute('aria-labelledby', title.id)
    } else dialog.setAttribute('aria-label', '正在加载作品')
    const background = [...document.body.children].filter((el) => el !== backdrop && el instanceof HTMLElement)
      .map((el) => [el, el.inert])
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusables = () => [...dialog.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')]
      .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
    ;(dialog.querySelector('input:not([disabled]),textarea:not([disabled])') || focusables()[0] || dialog).focus({ preventScroll: true })
    background.forEach(([el]) => { el.inert = true })
    // 弹层挂在 body 上，不在页面 root 里，事件要单独委托
    const onModalClick = (e) => {
      if (e.target === modalEl) return closeModal()
      onClick(e)
    }
    const onModalSubmit = (e) => onSubmit(e)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeModal()
      } else if (e.key === 'Tab') {
        const items = focusables(), first = items[0], last = items[items.length - 1]
        if (!first) { e.preventDefault(); dialog.focus(); return }
        if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          e.preventDefault(); last.focus()
        } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          e.preventDefault(); first.focus()
        }
      }
    }
    modalEl.addEventListener('click', onModalClick)
    modalEl.addEventListener('submit', onModalSubmit)
    modalEl.addEventListener('input', onInput)
    modalEl.addEventListener('change', onChange)
    document.addEventListener('keydown', onKey, true)
    modalCleanup = () => {
      if (modalEl) {
        modalEl.removeEventListener('click', onModalClick)
        modalEl.removeEventListener('submit', onModalSubmit)
        modalEl.removeEventListener('input', onInput)
        modalEl.removeEventListener('change', onChange)
      }
      document.removeEventListener('keydown', onKey, true)
      background.forEach(([el, inert]) => { el.inert = inert })
      document.body.style.overflow = previousOverflow
    }
    if (onReady) onReady(modalEl)
  }

  function classModal(cls) {
    const editing = !!cls
    openModal(
      `<form class="cls-modal-form" data-form="${editing ? 'edit-class' : 'create-class'}" novalidate>
        <div class="cls-modal-head">
          <h2>${editing ? '重命名班级' : '新建班级'}</h2>
          <button type="button" class="cls-icon-btn" data-act="close-modal" aria-label="关闭">${svgIcon('close')}</button>
        </div>
        <div class="cls-field">
          <label for="cls-modal-name">班级名称</label>
          <input class="cls-input" id="cls-modal-name" name="name" maxlength="60" value="${editing ? esc(cls.name) : ''}" placeholder="例如：三年级 2 班" autocomplete="off">
        </div>
        <div class="cls-modal-actions">
          <button type="button" class="cls-btn cls-ghost" data-act="close-modal">取消</button>
          <button type="submit" class="cls-btn cls-primary" data-busy="save-class">${editing ? '保存' : '创建'}</button>
        </div>
      </form>`,
    )
  }

  function memberModal(member) {
    openModal(
      `<form class="cls-modal-form" data-form="rename-member" data-id="${esc(member.id)}" novalidate>
        <div class="cls-modal-head">
          <h2>编辑学生资料</h2>
          <button type="button" class="cls-icon-btn" data-act="close-modal" aria-label="关闭">${svgIcon('close')}</button>
        </div>
        <div class="cls-field">
          <label for="cls-modal-member">学生姓名</label>
          <input class="cls-input" id="cls-modal-member" name="name" maxlength="120" value="${esc(member.name)}" autocomplete="off">
          <span class="cls-hint">改完后学生使用新姓名进入；同名学生需填写不同学号。</span>
        </div>
        <div class="cls-member-fields"><div class="cls-field"><label for="cls-member-no">学号 <span class="cls-muted">选填</span></label><input class="cls-input" id="cls-member-no" name="studentNo" maxlength="40" value="${esc(member.studentNo || '')}" autocomplete="off"></div>
          <div class="cls-field"><label for="cls-member-gender">性别 <span class="cls-muted">选填</span></label><input class="cls-input" id="cls-member-gender" name="gender" maxlength="20" value="${esc(member.gender || '')}" autocomplete="off"></div>
          <div class="cls-field"><label for="cls-member-score">成绩 <span class="cls-muted">选填</span></label><input class="cls-input" id="cls-member-score" name="score" type="number" min="0" max="1000000" step="any" value="${member.score == null ? '' : esc(member.score)}"></div></div>
        <div class="cls-modal-actions">
          <button type="button" class="cls-btn cls-ghost" data-act="close-modal">取消</button>
          <button type="submit" class="cls-btn cls-primary" data-busy="rename-member">保存</button>
        </div>
      </form>`,
    )
  }

  function storybookPreview(sub) {
    const pages = Array.isArray(sub.pages) ? sub.pages : []
    if (!pages.length) {
      return `<div class="cls-empty"><span class="cls-empty-icon">${svgIcon('file')}</span><h3>没有可预览的内容</h3><p>这份提交可能已被重置。</p></div>`
    }
    return `<div class="cls-pages">${pages
      .map((p, i) => {
        const img = safeImage(p.image)
        return `<article class="cls-page">
          <div class="cls-page-art">${img ? `<img src="${esc(img)}" alt="第 ${i + 1} 页插画" loading="lazy">` : `<span>${svgIcon('image')}第 ${i + 1} 页暂无插画</span>`}</div>
          <div class="cls-page-text">
            <span class="cls-page-no">第 ${i + 1} 页</span>
            <p>${esc(p.who)}在${esc(p.where)}，${esc(p.doing)}。</p>
            ${p.mood || p.color ? `<span class="cls-page-mood">${esc([p.color, p.mood].filter(Boolean).join(' · '))}</span>` : ''}
          </div>
        </article>`
      })
      .join('')}</div>`
  }

  function labPreview(sub) {
    const lab = sub.lab || {}
    const score = Number.isFinite(Number(sub.score)) ? Number(sub.score) : Number(lab.score) || 0
    const work = lab.work
    return `<div class="cls-lab-summary">
        <div class="cls-lab-score"><b>${score}</b><span>分</span></div>
        <div class="cls-lab-main">
          <small>${esc(sub.labTitle || '互动练习')}</small>
          <b>${score >= 80 ? '完成得很棒' : score >= 60 ? '顺利完成了练习' : '完成了练习'}</b>
          <p>${lab.note ? esc(lab.note) : '学生没有填写补充说明。'}</p>
        </div>
      </div>
      ${
        work
          ? `<div class="cls-lab-work">
              <span class="cls-chip is-type">${esc(work.type || '互动作品')}</span>
              <b>${esc(work.title || '')}</b>
              ${work.desc ? `<p>${esc(work.desc)}</p>` : ''}
            </div>`
          : ''
      }`
  }

  function taskPreview(sub) {
    const task = sub.task || {}
    const text = typeof task.text === 'string' ? task.text : ''
    const images = Array.isArray(task.images) ? task.images.map(safeImage).filter(Boolean) : []
    return `<div class="cls-task-text">${text ? `<p>${esc(text)}</p>` : '<p class="cls-muted">没有文字说明，只有照片。</p>'}</div>
      ${
        images.length
          ? `<div class="cls-task-gallery">${images
              .map(
                (src, i) =>
                  `<a href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="作业照片 ${i + 1}" loading="lazy"></a>`,
              )
              .join('')}</div>`
          : ''
      }`
  }

  function quizPreviewHtml(questions, responses) {
    const submitted = Array.isArray(responses) ? new Map(responses.map((a) => [a.questionId, a.answer])) : null
    return `<ol class="cls-quiz-preview">${questions.map((q, i) => {
      const options = Array.isArray(q.options) ? q.options : []
      const chosen = submitted && submitted.get(q.id)
      return `<li><div class="cls-quiz-question-head"><span>${i + 1}. ${q.type === 'boolean' ? '判断题' : '单选题'}</span><span>${Number(q.points) || 0} 分</span></div><p class="cls-quiz-stem">${esc(q.stem)}</p><ul>${options.map((option, j) => `<li>${String.fromCharCode(65 + j)}. ${esc(option)}</li>`).join('')}</ul>${submitted ? `<p>学生作答：${chosen == null ? '未作答' : esc(options[chosen] || '未作答')}</p>` : ''}${Number.isInteger(q.answer) ? `<p class="cls-quiz-answer">标准答案：${esc(options[q.answer] || '')}</p>${q.explanation ? `<p class="cls-hint">解析：${esc(q.explanation)}</p>` : ''}` : ''}</li>`
    }).join('')}</ol>`
  }

  function quizSubmissionPreview(sub) {
    const quiz = sub.quiz || {}
    return `<p class="cls-quiz-result">${sub.score == null && quiz.score == null ? '暂无评分' : `得分 ${Number(sub.score == null ? quiz.score : sub.score)} / ${Number(quiz.totalPoints) || 0}`}</p>${quizPreviewHtml(quiz.questions || [], quiz.answers || [])}`
  }

  function submissionModalHtml(sub) {
    const type = sub.type || 'storybook'
    const published = !!(sub.work && sub.work.published)
    const title =
      type === 'lab'
        ? sub.labTitle || sub.assignmentTitle
        : type === 'task' || type === 'quiz'
          ? sub.assignmentTitle
          : sub.poemName || '未命名故事'
    const body = type === 'quiz' ? quizSubmissionPreview(sub) : type === 'lab' ? labPreview(sub) : type === 'task' ? taskPreview(sub) : storybookPreview(sub)
    const scoreText =
      type === 'lab' && sub.score != null ? ` · 得分 ${Number(sub.score)} 分` : ''

    return `<div class="cls-modal-head">
        <div>
          <h2>${esc(title)}</h2>
          <p class="cls-modal-sub">${esc(sub.memberName)} · ${esc(sub.assignmentTitle)} · ${esc(TYPE_TEXT[type] || '作业')}${esc(scoreText)}</p>
        </div>
        <button type="button" class="cls-icon-btn" data-act="close-modal" aria-label="关闭">${svgIcon('close')}</button>
      </div>
      <div class="cls-modal-body">
        ${published ? `<div class="cls-published-note">${svgIcon('star')}已发布到成果展厅，署名「${esc(sub.work.author)}」</div>` : ''}
        ${body}
      </div>
      <div class="cls-modal-foot">
        ${
          type === 'quiz'
            ? '<p class="cls-hint">试卷记录仅用于教学反馈，不发布到成果展厅。</p><button type="button" class="cls-btn cls-ghost" data-act="close-modal">关闭</button>'
            : published
            ? `<button type="button" class="cls-btn cls-danger-ghost" data-act="unpublish-submission" data-id="${esc(sub.id)}">${svgIcon('close')}从展厅撤下</button>
               <button type="button" class="cls-btn cls-ghost" data-act="close-modal">关闭</button>`
            : `<div class="cls-author-field">
                 <label for="cls-modal-author">展厅署名</label>
                 <input class="cls-input" id="cls-modal-author" name="author" maxlength="60" value="${esc(sub.defaultAuthor || sub.memberName)}">
                 <span class="cls-hint">学生没有账号，作品由老师账号代为发布；署名会显示在展厅里。</span>
               </div>
               <div class="cls-modal-foot-actions">
                 <button type="button" class="cls-btn cls-ghost" data-act="close-modal">取消</button>
                 <button type="button" class="cls-btn cls-primary" data-busy="publish:${esc(sub.id)}" data-act="publish-submission-confirm" data-id="${esc(sub.id)}">${svgIcon('upload')}发布到成果展厅</button>
               </div>`
        }
      </div>`
  }

  async function openSubmission(submissionId) {
    if (!submissionId) return
    openModal(`<div class="cls-modal-loading"><span class="cls-spinner"></span>正在加载作品…</div>`)
    const loadingModal = modalEl
    const requestSeq = seq
    try {
      const data = await api(
        `/api/classes/${encodeURIComponent(S.classId)}/assignments/${encodeURIComponent(S.assignmentId)}/submissions/${encodeURIComponent(submissionId)}`,
      )
      if (modalEl !== loadingModal || requestSeq !== seq || !root) return
      const sub = data && data.submission
      if (!sub) throw new Error('提交记录不存在或已被删除')
      openModal(submissionModalHtml(sub))
    } catch (err) {
      if (modalEl !== loadingModal || requestSeq !== seq || !root) return
      closeModal()
      showToast(err.message || '作品加载失败')
    }
  }

  // ── 数据操作 ───────────────────────────────────────────────
  async function withBusy(key, fn) {
    if (S.busy.has(key)) return
    S.busy.add(key)
    syncBusy()
    try {
      await fn()
    } finally {
      S.busy.delete(key)
      syncBusy()
    }
  }

  function syncBusy() {
    if (!root) return
    const controls = [...root.querySelectorAll('[data-busy]'), ...(modalEl ? modalEl.querySelectorAll('[data-busy]') : [])]
    controls.forEach((el) => {
      const key = el.getAttribute('data-busy')
      el.disabled = S.busy.has(key)
      el.classList.toggle('is-busy', S.busy.has(key))
      el.setAttribute('aria-busy', String(S.busy.has(key)))
    })
  }

  function readForm(form) {
    const out = {}
    form.querySelectorAll('input, textarea, select').forEach((el) => {
      if (el.name) out[el.name] = el.value
    })
    return out
  }

  function classCardById(id) {
    return S.classes.find((c) => c.id === id) || null
  }

  function memberById(id) {
    return S.cls && S.cls.members.find((m) => m.id === id)
  }

  function parseRosterText(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter((s) => s.trim())
    if (!lines.length) return []
    const splitRow = (line) => {
      if (line.includes('\t')) return line.split('\t').map((s) => s.trim())
      const cells = []; let cell = '', quoted = false
      for (let i = 0; i < line.length; i++) {
        const char = line[i]
        if (char === '"' && line[i + 1] === '"' && quoted) { cell += '"'; i++; continue }
        if (char === '"') { quoted = !quoted; continue }
        if ((char === ',' || char === '，') && !quoted) { cells.push(cell.trim()); cell = '' } else cell += char
      }
      if (quoted) throw new Error('名单中有未闭合的引号，请检查表格内容')
      cells.push(cell.trim())
      return cells
    }
    const first = splitRow(lines[0])
    const nameIndex = first.findIndex((s) => /^(姓名|学生姓名|名字)$/i.test(s))
    const tabular = nameIndex >= 0 || lines.some((line) => line.includes('\t')) || (first.length > 1 && /^\d+$/.test(first[1]))
    if (!tabular) return [...new Set(String(text || '').split(/[\n\r,，、;；]+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean))].map((name) => ({ name }))
    const index = (pattern, fallback) => nameIndex >= 0 ? first.findIndex((s) => pattern.test(s)) : fallback
    const positions = { name: nameIndex >= 0 ? nameIndex : 0, studentNo: index(/^(学号|学生编号|student\s*(no|id))$/i, 1), gender: index(/^(性别|gender)$/i, 2), score: index(/^(成绩|分数|总分|score)$/i, 3) }
    return lines.slice(nameIndex >= 0 ? 1 : 0).map((line, i) => {
      const cells = splitRow(line)
      const take = (key) => positions[key] < 0 ? '' : String(cells[positions[key]] || '').trim()
      const name = take('name')
      if (!name) throw new Error(`第 ${i + (nameIndex >= 0 ? 2 : 1)} 行缺少姓名，请补充后导入`)
      const rawScore = take('score')
      const score = rawScore === '' ? null : Number(rawScore)
      if (score != null && (!Number.isFinite(score) || score < 0 || score > 1000000)) throw new Error(`「${name}」的成绩不是有效数字，请留空或填写非负数字`)
      return { name, studentNo: take('studentNo') || null, gender: take('gender') || null, score }
    })
  }

  async function addMembers(form) {
    const values = readForm(form)
    let members
    try { members = parseRosterText(values.names) } catch (err) { return showToast(err.message) }
    if (!members.length) return showToast('请先填写学生姓名')
    if (members.length > MAX_MEMBERS) return showToast(`一次最多导入 ${MAX_MEMBERS} 人`)
    await withBusy('add-members', async () => {
      try {
        const res = await api(`/api/classes/${encodeURIComponent(S.classId)}/members`, {
          method: 'POST',
          body: { members },
        })
        showToast(
          res.skipped ? `已导入 ${res.added} 人，跳过 ${res.skipped} 条重复记录` : `已导入 ${res.added} 人`,
        )
        form.reset()
        await loadClass()
      } catch (err) {
        showToast(err.message || '导入失败')
      }
    })
  }

  let questionSequence = 0
  function newQuizQuestion() {
    return { id: `q-${Date.now().toString(36)}-${++questionSequence}`, type: 'single', stem: '', options: ['', '', '', ''], answer: 0, points: 10, explanation: '' }
  }

  function quizQuestionHtml(question, index) {
    const q = question || newQuizQuestion()
    const options = q.type === 'boolean' ? ['正确', '错误'] : q.options || []
    const prefix = `cls-quiz-${q.id}`
    return `<article class="cls-quiz-question" data-quiz-question="${esc(q.id)}"><div class="cls-quiz-question-head"><b>第 ${index + 1} 题</b><button type="button" class="cls-btn cls-ghost cls-sm" data-act="quiz-remove-question" aria-label="删除第 ${index + 1} 题">${svgIcon('trash')}删除</button></div>
      <div class="cls-member-fields"><div class="cls-field"><label for="${prefix}-type">题型</label><select class="cls-input" id="${prefix}-type" data-q-field="type"><option value="single"${q.type === 'single' ? ' selected' : ''}>单选题</option><option value="boolean"${q.type === 'boolean' ? ' selected' : ''}>判断题</option></select></div><div class="cls-field"><label for="${prefix}-points">分值</label><input class="cls-input" id="${prefix}-points" type="number" min="1" max="100" data-q-field="points" value="${Number(q.points) || 10}"></div></div>
      <div class="cls-field"><label for="${prefix}-stem">题目</label><textarea class="cls-textarea" id="${prefix}-stem" data-q-field="stem" rows="2" maxlength="2000" placeholder="请输入题目">${esc(q.stem || '')}</textarea></div>
      <div class="cls-field" data-q-options${q.type === 'boolean' ? ' hidden' : ''}><label for="${prefix}-options">选项（每行一个，2–6 个）</label><textarea class="cls-textarea" id="${prefix}-options" data-q-field="options" rows="4" maxlength="6000" placeholder="选项 A&#10;选项 B">${esc((q.options || []).join('\n'))}</textarea></div>
      <div class="cls-member-fields"><div class="cls-field"><label for="${prefix}-answer">标准答案</label><select class="cls-input" id="${prefix}-answer" data-q-field="answer">${options.map((o, i) => `<option value="${i}"${Number(q.answer) === i ? ' selected' : ''}>${String.fromCharCode(65 + i)}. ${esc(o || `选项 ${String.fromCharCode(65 + i)}`)}</option>`).join('')}</select></div></div>
      <div class="cls-field"><label for="${prefix}-explanation">答案解析 <span class="cls-muted">选填</span></label><textarea class="cls-textarea" id="${prefix}-explanation" data-q-field="explanation" rows="2" maxlength="2000">${esc(q.explanation || '')}</textarea></div></article>`
  }

  function quizBuilderHtml(questions) {
    const list = questions.length ? questions : [newQuizQuestion()]
    return `<div class="cls-quiz-builder" data-quiz-builder><div data-quiz-questions>${list.map(quizQuestionHtml).join('')}</div><button type="button" class="cls-btn cls-ghost" data-act="quiz-add-question">${svgIcon('plus')}添加题目</button></div>`
  }

  function readQuizQuestions(builder, validate = true) {
    const rows = Array.from(builder.querySelectorAll('[data-quiz-question]'))
    if (validate && (!rows.length || rows.length > 50)) throw new Error('试卷需要 1–50 道题')
    return rows.map((row, i) => {
      const field = (key) => row.querySelector(`[data-q-field="${key}"]`).value
      const type = field('type')
      const options = type === 'boolean' ? ['正确', '错误'] : field('options').split('\n').map((s) => s.trim()).filter(Boolean)
      const question = { id: row.dataset.quizQuestion, type, stem: field('stem').trim(), options, answer: Number(field('answer')), points: Number(field('points')), explanation: field('explanation').trim() }
      if (validate) {
        if (!question.stem) throw new Error(`请填写第 ${i + 1} 题的题目`)
        if (options.length < 2 || options.length > 6) throw new Error(`第 ${i + 1} 题需要 2–6 个选项`)
        if (options.some((o) => o.length > 1000)) throw new Error(`第 ${i + 1} 题的选项最多 1000 字`)
        if (new Set(options).size !== options.length) throw new Error(`第 ${i + 1} 题的选项不能重复`)
        if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= options.length) throw new Error(`请设置第 ${i + 1} 题的标准答案`)
        if (!Number.isInteger(question.points) || question.points < 1 || question.points > 100) throw new Error(`第 ${i + 1} 题分值需为 1–100 的整数`)
      }
      return question
    })
  }

  function updateQuizAnswer(row) {
    const type = row.querySelector('[data-q-field="type"]').value
    const field = row.querySelector('[data-q-field="options"]')
    row.querySelector('[data-q-options]').hidden = type === 'boolean'
    const options = type === 'boolean' ? ['正确', '错误'] : field.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 6)
    const answer = row.querySelector('[data-q-field="answer"]')
    const previous = Number(answer.value)
    answer.innerHTML = options.map((o, i) => `<option value="${i}">${String.fromCharCode(65 + i)}. ${esc(o)}</option>`).join('')
    if (previous < options.length) answer.value = String(previous)
  }

  function changeQuizQuestions(button, remove) {
    const builder = button.closest('[data-quiz-builder]')
    if (!builder) return
    const questions = readQuizQuestions(builder, false)
    if (remove) {
      const id = button.closest('[data-quiz-question]').dataset.quizQuestion
      if (questions.length <= 1) return showToast('试卷至少保留一道题')
      questions.splice(questions.findIndex((q) => q.id === id), 1)
    } else {
      if (questions.length >= 50) return showToast('每份试卷最多 50 道题')
      questions.push(newQuizQuestion())
    }
    builder.querySelector('[data-quiz-questions]').innerHTML = questions.map(quizQuestionHtml).join('')
    const next = remove ? builder.querySelector('[data-act="quiz-add-question"]') : builder.querySelector('[data-quiz-question]:last-child textarea')
    next?.focus({ preventScroll: true })
  }

  // ── 创建表单的联动 ─────────────────────────────────────────
  function fillLabHint(form) {
    const hint = form.querySelector('[data-assign-lab-hint]')
    if (!hint) return
    const lab = labById(form.querySelector('[name="labId"]').value)
    hint.textContent = lab
      ? `${STAGE_TEXT[lab.grade] || ''} · ${lab.type}。学生完成后会提交本次练习的得分。`
      : '学生完成后会提交本次练习的得分。'
  }

  function currentActivity(form) {
    const moduleId = form.querySelector('[name="moduleId"]').value
    const stage = form.querySelector('[name="stage"]').value
    const title = form.querySelector('[name="activity"]').value
    const st = stageOf(moduleId, stage)
    return (st && st.activities.find((a) => a.title === title)) || null
  }

  function fillActivityHint(form) {
    const hint = form.querySelector('[data-assign-activity-hint]')
    if (!hint) return
    const act = currentActivity(form)
    hint.textContent = act ? act.desc : ''
  }

  // 模块/学段变化后，同步活动与配套工具台选项；尽量保留仍有效的旧选择。
  function fillTaskOptions(form) {
    const moduleId = form.querySelector('[name="moduleId"]').value || 'm1'
    const stage = form.querySelector('[name="stage"]').value || 'low'
    const st = stageOf(moduleId, stage)
    const actSel = form.querySelector('[name="activity"]')
    const toolSel = form.querySelector('[name="toolLabId"]')
    if (!actSel || !toolSel) return

    const prevAct = actSel.value
    const prevTool = toolSel.value
    const activities = (st && st.activities) || []
    actSel.innerHTML = activities
      .map((a) => `<option value="${esc(a.title)}">${esc(a.title)}</option>`)
      .join('')
    if (activities.some((a) => a.title === prevAct)) actSel.value = prevAct

    const tools = ((st && st.labs) || []).map(labById).filter(Boolean)
    toolSel.innerHTML =
      '<option value="">不搭配工具台</option>' +
      tools.map((l) => `<option value="${esc(l.id)}">${esc(l.title)}</option>`).join('')
    if (tools.some((l) => l.id === prevTool)) toolSel.value = prevTool

    fillActivityHint(form)
  }

  // 只在老师还没改过「自动填入」的标题/说明时才替换，避免覆盖手写内容。
  function suggestFields(form) {
    const type = form.querySelector('[name="type"]').value
    let title = ''
    let instructions = ''
    if (type === 'lab') {
      const lab = labById(form.querySelector('[name="labId"]').value)
      if (lab) {
        title = lab.title
        instructions = `完成「${lab.title}」互动练习，尽量拿到最高分，完成后提交。`
      }
    } else if (type === 'task') {
      const act = currentActivity(form)
      if (act) {
        title = act.title
        instructions = act.desc ? `${act.title}：${act.desc}。完成后写下过程和收获，可以附上照片。` : ''
      }
    }

    const apply = (el, value, key) => {
      if (!el) return
      const auto = form.dataset[key] || ''
      if (!el.value.trim() || el.value.trim() === auto) {
        el.value = value
        form.dataset[key] = value
      }
    }
    apply(form.querySelector('[name="title"]'), title, 'autoTitle')
    apply(form.querySelector('[name="instructions"]'), instructions, 'autoInstructions')
  }

  function syncAssignKind(form) {
    const type = form.querySelector('[name="type"]').value
    form.querySelectorAll('[data-assign-kind]').forEach((el) => {
      el.hidden = el.getAttribute('data-assign-kind') !== type
    })
    if (type === 'lab') fillLabHint(form)
    if (type === 'task') fillTaskOptions(form)
    const label = form.querySelector('[data-create-label]')
    if (label) label.textContent = type === 'quiz' ? '预览试卷' : '生成作业链接'
    suggestFields(form)
  }

  function editQuizModal(seed) {
    const a = seed || S.assignment
    if (!a || a.type !== 'quiz' || a.status !== 'draft') return
    openModal(`<form class="cls-modal-form" data-form="edit-quiz" data-id="${esc(a.id)}" novalidate><input type="hidden" name="type" value="quiz"><div class="cls-modal-head"><h2>编辑试卷草稿</h2><button type="button" class="cls-icon-btn" data-act="close-modal" aria-label="关闭">${svgIcon('close')}</button></div><div class="cls-field"><label for="cls-edit-quiz-title">试卷名称</label><input class="cls-input" id="cls-edit-quiz-title" name="title" maxlength="120" value="${esc(a.title)}"></div><div class="cls-field"><label for="cls-edit-quiz-instructions">作业说明</label><textarea class="cls-textarea" id="cls-edit-quiz-instructions" name="instructions" maxlength="1000">${esc(a.instructions || '')}</textarea></div>${quizBuilderHtml(a.quiz?.questions || [])}<div class="cls-modal-actions"><button type="button" class="cls-btn cls-ghost" data-act="close-modal">取消</button><button type="submit" class="cls-btn cls-primary">预览修改</button></div></form>`)
  }

  function previewQuizSave(payload, assignmentId) {
    const classId = S.classId
    openModal(`<div class="cls-modal-head"><div><h2>${esc(payload.title)}</h2><p class="cls-modal-sub">${assignmentId ? '确认更新草稿' : payload.status === 'draft' ? '确认保存草稿，暂不开放给学生' : '确认发布，学生只能提交一次'}</p></div><button type="button" class="cls-icon-btn" data-act="close-modal" aria-label="关闭">${svgIcon('close')}</button></div><div class="cls-modal-body">${payload.instructions ? `<p>${esc(payload.instructions)}</p>` : ''}${quizPreviewHtml(payload.quiz.questions)}</div><p class="cls-inline-error" data-quiz-save-error role="alert"></p><div class="cls-modal-actions"><button type="button" class="cls-btn cls-ghost" data-quiz-back>返回编辑</button><button type="button" class="cls-btn cls-primary" data-quiz-save data-busy="create-assignment">${assignmentId ? '确认更新草稿' : payload.status === 'draft' ? '确认保存草稿' : '确认发布试卷'}</button></div>`, (el) => {
      el.querySelector('[data-quiz-back]').addEventListener('click', () => {
        if (assignmentId) editQuizModal({ ...payload, id: assignmentId, type: 'quiz', status: 'draft' })
        else closeModal()
      })
      el.querySelector('[data-quiz-save]').addEventListener('click', () => withBusy('create-assignment', async () => {
        try {
          const path = `/api/classes/${encodeURIComponent(classId)}/assignments${assignmentId ? '/' + encodeURIComponent(assignmentId) : ''}`
          const res = await api(path, { method: assignmentId ? 'PATCH' : 'POST', body: assignmentId ? { title: payload.title, instructions: payload.instructions, quiz: payload.quiz } : payload })
          if (modalEl !== el) return
          const id = assignmentId || res.assignment?.id
          if (!id) throw new Error('试卷保存失败')
          closeModal()
          showToast(payload.status === 'open' ? '试卷已发布' : '试卷草稿已保存')
          if (S.classId !== classId) return
          const url = assignmentLink(classId, id)
          if (window.location.hash !== url) window.location.hash = url
          else await loadAssignment()
        } catch (err) { if (modalEl === el) el.querySelector('[data-quiz-save-error]').textContent = err.message || '保存失败，请重试' }
      }))
    })
  }

  async function publishQuizFeedback(field) {
    const a = S.assignment
    if (!a || a.type !== 'quiz' || a[field]) return
    const label = field === 'scoresPublished' ? '成绩' : '答案与解析'
    if (!window.confirm(`向已提交这份试卷的学生公布${label}？公布后学生可在原作业链接查看。`)) return
    const classId = S.classId
    await withBusy('quiz-release', async () => {
      try {
        await api(`/api/classes/${encodeURIComponent(classId)}/assignments/${encodeURIComponent(a.id)}`, { method: 'PATCH', body: { [field]: true } })
        showToast(`${label}已公布`)
        if (S.assignment?.id === a.id && S.classId === classId) await loadAssignment()
      } catch (err) { showToast(err.message || '公布失败') }
    })
  }

  async function createAssignment(form) {
    const values = readForm(form)
    const type = String(values.type || 'storybook')
    const title = String(values.title || '').trim()
    if (!title) return showToast('请填写作业名称')

    const payload = { title, type, instructions: String(values.instructions || '').trim() }
    if (type === 'quiz') {
      try {
        payload.quiz = { questions: readQuizQuestions(form.querySelector('[data-quiz-builder]')) }
        payload.status = String(values.quizStatus || 'draft')
        return previewQuizSave(payload, form.dataset.form === 'edit-quiz' ? form.dataset.id : '')
      } catch (err) { return showToast(err.message) }
    }
    if (type === 'lab') {
      const lab = labById(values.labId)
      if (!lab) return showToast('请选择互动练习')
      payload.labId = lab.id
    } else if (type === 'task') {
      const mod = moduleById(values.moduleId)
      const st = stageOf(values.moduleId, values.stage)
      const activity = String(values.activity || '').trim()
      if (!mod || !st || !activity) return showToast('请选择课程任务')
      payload.moduleId = mod.id
      payload.stage = values.stage
      payload.activity = activity
      if (values.toolLabId) payload.toolLabId = String(values.toolLabId)
    }

    await withBusy('create-assignment', async () => {
      try {
        const res = await api(`/api/classes/${encodeURIComponent(S.classId)}/assignments`, {
          method: 'POST',
          body: payload,
        })
        const a = res && res.assignment
        if (!a) throw new Error('创建失败')
        showToast('作业已创建，把链接发到班级群吧')
        const url = assignmentLink(S.classId, a.id)
        if (window.location.hash !== url) window.location.hash = url
        else await loadAssignment()
      } catch (err) {
        showToast(err.message || '创建失败')
      }
    })
  }

  async function publishSubmission(submissionId, author) {
    if (!submissionId) return
    await withBusy(`publish:${submissionId}`, async () => {
      try {
        const res = await api(
          `/api/classes/${encodeURIComponent(S.classId)}/assignments/${encodeURIComponent(S.assignmentId)}/submissions/${encodeURIComponent(submissionId)}/publish`,
          { method: 'POST', body: { author: String(author || '').trim() } },
        )
        showToast(res && res.alreadyPublished ? '这份作品已经在展厅里了' : '已发布到成果展厅')
        closeModal()
        await loadAssignment()
      } catch (err) {
        showToast(err.message || '发布失败')
      }
    })
  }

  async function unpublishSubmission(submissionId) {
    if (!submissionId) return
    if (!window.confirm('从成果展厅撤下这份作品？学生提交的内容仍会保留。')) return
    await withBusy(`unpublish:${submissionId}`, async () => {
      try {
        await api(
          `/api/classes/${encodeURIComponent(S.classId)}/assignments/${encodeURIComponent(S.assignmentId)}/submissions/${encodeURIComponent(submissionId)}/publish`,
          { method: 'DELETE' },
        )
        showToast('已从展厅撤下')
        closeModal()
        await loadAssignment()
      } catch (err) {
        showToast(err.message || '撤下失败')
      }
    })
  }

  async function resetSubmission(submissionId, name) {
    if (!submissionId) return
    if (
      !window.confirm(
        `重置「${name || '这名学生'}」的提交？\n\n学生这次写的文字和插画会被清空，学生需要重新创作并提交。AI 生成次数不会退还。`,
      )
    ) {
      return
    }
    await withBusy(`reset:${submissionId}`, async () => {
      try {
        await api(
          `/api/classes/${encodeURIComponent(S.classId)}/assignments/${encodeURIComponent(S.assignmentId)}/submissions/${encodeURIComponent(submissionId)}/reset`,
          { method: 'POST', body: {} },
        )
        showToast('已重置，学生可以重新提交')
        closeModal()
        await loadAssignment()
      } catch (err) {
        showToast(err.message || '重置失败')
      }
    })
  }

  async function deleteClass() {
    if (!S.cls) return
    if (
      !window.confirm(
        `删除班级「${S.cls.name}」？\n\n名单和作业会一起删除。已经发布到成果展厅的作品必须先撤下。`,
      )
    ) {
      return
    }
    await withBusy('delete-class', async () => {
      try {
        await api(`/api/classes/${encodeURIComponent(S.cls.id)}`, { method: 'DELETE' })
        showToast('班级已删除')
        window.location.hash = '#/me/classes'
      } catch (err) {
        showToast(err.message || '删除失败')
      }
    })
  }

  async function deleteAssignment() {
    if (!S.assignment) return
    if (
      !window.confirm(
        `删除作业「${S.assignment.title}」？\n\n学生提交记录会一起删除；已发布到展厅的作品必须先撤下。`,
      )
    ) {
      return
    }
    await withBusy('delete-assignment', async () => {
      try {
        await api(
          `/api/classes/${encodeURIComponent(S.classId)}/assignments/${encodeURIComponent(S.assignmentId)}`,
          { method: 'DELETE' },
        )
        showToast('作业已删除')
        window.location.hash = classLink(S.classId)
      } catch (err) {
        showToast(err.message || '删除失败')
      }
    })
  }

  // ── Toast ──────────────────────────────────────────────────
  function showToast(message) {
    if (!toastEl) {
      toastEl = document.createElement('div')
      toastEl.className = 'cls-toast'
      toastEl.setAttribute('role', 'status')
      document.body.appendChild(toastEl)
    }
    toastEl.textContent = message
    toastEl.classList.add('is-show')
    clearTimeout(showToast._timer)
    showToast._timer = setTimeout(() => toastEl && toastEl.classList.remove('is-show'), 2800)
  }

  // ── 事件 ───────────────────────────────────────────────────
  function onClick(e) {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.getAttribute('data-act')
    const id = btn.getAttribute('data-id') || ''

    if (act === 'close-modal') return closeModal()
    if (act === 'edit-groups') return editGroupsModal()
    if (act === 'quiz-add-question') return changeQuizQuestions(btn, false)
    if (act === 'quiz-remove-question') return changeQuizQuestions(btn, true)
    if (act === 'edit-quiz') return editQuizModal()
    if (act === 'publish-quiz-scores') return publishQuizFeedback('scoresPublished')
    if (act === 'publish-quiz-answers') return publishQuizFeedback('answersPublished')
    if (act === 'retry-classes') return loadClasses()
    if (act === 'retry-class') return loadClass()
    if (act === 'retry-assignment') return loadAssignment()
    if (act === 'rename-class') {
      const cls = S.cls || classCardById(S.classId)
      if (cls) classModal(cls)
      return
    }
    if (act === 'delete-class') return deleteClass()
    if (act === 'rename-member') {
      const m = memberById(id)
      if (m) memberModal(m)
      return
    }
    if (act === 'delete-member') {
      const m = memberById(id)
      if (!m) return
      if (!window.confirm(`把「${m.name}」移出名单？\n\n该学生的作业提交记录也会被删除。`)) return
      withBusy(`member:${id}`, async () => {
        try {
          await api(`/api/classes/${encodeURIComponent(S.classId)}/members/${encodeURIComponent(id)}`, {
            method: 'DELETE',
          })
          showToast('已移出名单')
          await loadClass()
        } catch (err) {
          showToast(err.message || '移出失败')
        }
      })
      return
    }
    if (act === 'toggle-assignment') {
      if (!S.assignment) return
      const next = S.assignment.status === 'open' ? 'closed' : 'open'
      if (S.assignment.status === 'draft' && !window.confirm('发布这份试卷？发布后题目和答案不能再修改，学生只能提交一次。')) return
      withBusy('toggle-assignment', async () => {
        try {
          await api(
            `/api/classes/${encodeURIComponent(S.classId)}/assignments/${encodeURIComponent(S.assignmentId)}`,
            { method: 'PATCH', body: { status: next } },
          )
          showToast(next === 'open' ? '作业已重新开放' : '作业已关闭，学生不能再进入或提交')
          await loadAssignment()
        } catch (err) {
          showToast(err.message || '操作失败')
        }
      })
      return
    }
    if (act === 'delete-assignment') return deleteAssignment()
    if (act === 'copy-link') {
      if (!S.assignment) return
      copyText(shareLink(S.assignment.token)).then((ok) => {
        showToast(ok ? '作业链接已复制，发到班级群即可' : '复制失败，请手动选中链接复制')
        if (!ok) {
          const input = document.getElementById('cls-share-url')
          if (input) input.select()
        }
      })
      return
    }
    if (act === 'rotate-link') {
      if (!S.assignment) return
      if (
        !window.confirm(
          '换新链接？\n\n旧链接和已经进入作业的学生会话会立即失效，需要重新把新链接发给学生。已经提交的内容不受影响。',
        )
      ) {
        return
      }
      withBusy('rotate-link', async () => {
        try {
          const res = await api(
            `/api/classes/${encodeURIComponent(S.classId)}/assignments/${encodeURIComponent(S.assignmentId)}/rotate-link`,
            { method: 'POST', body: {} },
          )
          if (S.assignment && res.token) S.assignment.token = res.token
          const input = document.getElementById('cls-share-url')
          if (input) input.value = shareLink(res.token)
          showToast('已换新链接，旧链接立即失效')
        } catch (err) {
          showToast(err.message || '换链接失败')
        }
      })
      return
    }
    if (act === 'open-submission') return openSubmission(id)
    if (act === 'publish-submission') {
      // 表格里的快捷发布：先打开预览，让老师确认内容与署名
      return openSubmission(id)
    }
    if (act === 'publish-submission-confirm') {
      const input = document.getElementById('cls-modal-author')
      return publishSubmission(id, input ? input.value : '')
    }
    if (act === 'unpublish-submission') return unpublishSubmission(id)
    if (act === 'reset-submission') {
      const m = S.assignment && S.assignment.members.find((x) => x.submissionId === id)
      return resetSubmission(id, m && m.name)
    }
  }

  function onSubmit(e) {
    const form = e.target.closest('form[data-form]')
    if (!form) return
    e.preventDefault()
    const kind = form.getAttribute('data-form')

    if (kind === 'create-class' || kind === 'edit-class') {
      const name = String(readForm(form).name || '').trim()
      if (!name) return showToast('请填写班级名称')
      const editing = kind === 'edit-class'
      withBusy('save-class', async () => {
        try {
          if (editing && S.cls) {
            await api(`/api/classes/${encodeURIComponent(S.cls.id)}`, { method: 'PATCH', body: { name } })
            showToast('班级名称已更新')
            closeModal()
            await loadClass()
          } else {
            const res = await api('/api/classes', { method: 'POST', body: { name } })
            showToast('班级已创建，接着导入学生名单')
            closeModal()
            await loadClasses()
            const created = res && res.class
            if (created && created.id) window.location.hash = classLink(created.id)
          }
        } catch (err) {
          showToast(err.message || '保存失败')
        }
      })
      return
    }

    if (kind === 'add-members') return addMembers(form)
    if (kind === 'create-assignment' || kind === 'edit-quiz') return createAssignment(form)
    if (kind === 'rename-member') {
      const id = form.getAttribute('data-id') || ''
      const values = readForm(form)
      const name = String(values.name || '').trim()
      if (!name) return showToast('请填写学生姓名')
      const rawScore = String(values.score || '').trim()
      const score = rawScore === '' ? null : Number(rawScore)
      if (score != null && (!Number.isFinite(score) || score < 0 || score > 1000000)) return showToast('成绩需为有效的非负数字，或留空')
      withBusy('rename-member', async () => {
        try {
          await api(`/api/classes/${encodeURIComponent(S.classId)}/members/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: { name, studentNo: String(values.studentNo || '').trim() || null, gender: String(values.gender || '').trim() || null, score },
          })
          showToast('学生资料已更新')
          closeModal()
          await loadClass()
        } catch (err) {
          showToast(err.message || '保存失败')
        }
      })
    }
  }

  function onInput(e) {
    if (e.target && e.target.dataset.qField === 'options') return updateQuizAnswer(e.target.closest('[data-quiz-question]'))
    if (e.target && e.target.id === 'cls-member-search') {
      S.filter = e.target.value
      refreshAssignmentView()
    }
  }

  function onChange(e) {
    const target = e.target
    if (!target) return
    if (target.dataset.qField === 'type') return updateQuizAnswer(target.closest('[data-quiz-question]'))
    if (target.id === 'cls-status-filter') {
      S.statusFilter = target.value
      refreshAssignmentView()
      return
    }
    const form = target.closest && target.closest('form[data-form="create-assignment"]')
    if (!form) return
    if (target.name === 'type') return syncAssignKind(form)
    if (target.name === 'moduleId' || target.name === 'stage') {
      fillTaskOptions(form)
      return suggestFields(form)
    }
    if (target.name === 'labId' || target.name === 'activity' || target.name === 'toolLabId') {
      if (target.name === 'labId') fillLabHint(form)
      if (target.name === 'activity') fillActivityHint(form)
      suggestFields(form)
    }
  }

  // ── 挂载 / 卸载 ────────────────────────────────────────────
  let styleEl = null
  function ensureStyle() {
    if (styleEl && document.head.contains(styleEl)) return
    styleEl = document.getElementById('cls-studio-style')
    if (styleEl) return
    styleEl = document.createElement('style')
    styleEl.id = 'cls-studio-style'
    styleEl.textContent = CSS_TEXT
    document.head.appendChild(styleEl)
  }

  function mountPage(vm, mode, params) {
    ensureStyle()
    const host = (vm.$el && vm.$el.parentNode) || document.querySelector('main') || document.body
    root = document.createElement('div')
    root.className = 'cls-studio-root'
    root.setAttribute('data-cls-root', '')
    if (vm.$el && vm.$el.parentNode === host) host.insertBefore(root, vm.$el)
    else host.appendChild(root)
    rootListeners = { click: onClick, submit: onSubmit, input: onInput, change: onChange }
    Object.keys(rootListeners).forEach((k) => root.addEventListener(k, rootListeners[k]))
    resetState(mode, params)
    window.scrollTo(0, 0)
    if (mode === 'list') loadClasses()
    else if (mode === 'class') loadClass()
    else loadAssignment()
  }

  function unmountPage() {
    seq++
    closeModal()
    if (toastEl) {
      toastEl.remove()
      toastEl = null
    }
    if (root && rootListeners) {
      Object.keys(rootListeners).forEach((k) => root.removeEventListener(k, rootListeners[k]))
      root.remove()
      root = null
    }
    rootListeners = null
  }

  function makeComponent(name, mode) {
    return {
      name,
      mounted() {
        const params = (this.$route && this.$route.params) || {}
        mountPage(this, mode, params)
      },
      beforeUnmount() {
        unmountPage()
      },
      render() {
        return null
      },
    }
  }

  const ListComponent = makeComponent('ClassStudioList', 'list')
  const ClassComponent = makeComponent('ClassStudioClass', 'class')
  const AssignmentComponent = makeComponent('ClassStudioAssignment', 'assignment')

  // 班级管理入口由「课堂教学」的页内导航统一提供。

  // ── 启动 ───────────────────────────────────────────────────
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

    for (const name of ['me-classes', 'me-class', 'me-class-assignment']) {
      if (router.hasRoute(name)) router.removeRoute(name)
    }
    router.addRoute({
      path: '/me/classes',
      name: 'me-classes',
      component: ListComponent,
      meta: { title: '班级管理', requiresAuth: true },
    })
    router.addRoute({
      path: '/me/classes/:id',
      name: 'me-class',
      component: ClassComponent,
      meta: { title: '班级管理', requiresAuth: true },
    })
    router.addRoute({
      path: '/me/classes/:id/assignments/:assignmentId',
      name: 'me-class-assignment',
      component: AssignmentComponent,
      meta: { title: '作业完成情况', requiresAuth: true },
    })

    try {
      await router.isReady()
    } catch {
      /* isReady 只在启动错误时 reject */
    }

    // 深链接：以地址栏 hash 为准（初始导航发生在路由注册之前）
    const raw = INITIAL_HASH.replace(/^#/, '')
    const qAt = raw.indexOf('?')
    const rawPath = qAt >= 0 ? raw.slice(0, qAt) : raw
    if (!rawPath.startsWith('/me/classes')) return
    const query = Object.fromEntries(new URLSearchParams(qAt >= 0 ? raw.slice(qAt + 1) : ''))
    const cur = router.currentRoute.value
    const ours = cur.matched.some(
      (r) =>
        r.components &&
        (r.components.default === ListComponent ||
          r.components.default === ClassComponent ||
          r.components.default === AssignmentComponent),
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
    console.warn('[class-studio] 启动失败，继续使用原页面', err)
  })

  // ── 样式 ───────────────────────────────────────────────────
  const CSS_TEXT = `
.cls-studio-root,.cls-modal-backdrop,.cls-toast{
  --cls-accent:var(--aiq-accent,#3559f6);
  --cls-action:#3559f6;
  --cls-border:var(--aiq-border,#e4e8f2);
  --cls-card:var(--aiq-panel-solid,#fff);
  --cls-soft:var(--aiq-bg-soft,#f2f5fc);
  --cls-text:var(--aiq-text,#1f2937);
  --cls-soft-text:var(--aiq-text-soft,#475569);
  --cls-mute:var(--aiq-text-mute,#64748b);
  --cls-danger:#dc2626;
  --cls-ok:#059669;
  --cls-warn:#d97706;
}
.cls-studio-root,.cls-studio-root *,.cls-studio-root *::before,.cls-studio-root *::after,.cls-modal-backdrop,.cls-modal-backdrop *,.cls-toast,.cls-toast *{box-sizing:border-box}
.cls-studio-root{color:var(--cls-text);padding-bottom:72px}
.cls-container{width:min(1180px,calc(100% - 48px));margin:0 auto;padding:40px 0 24px}
.cls-i{width:18px;height:18px;flex:none}
.cls-head{margin-bottom:24px}
.cls-tag{display:inline-flex;align-items:center;gap:7px;padding:6px 12px;border-radius:999px;background:color-mix(in srgb,var(--cls-accent) 10%,transparent);color:var(--cls-accent);font-size:13px;font-weight:700;letter-spacing:.02em;margin-bottom:12px}
.cls-tag .cls-i{width:15px;height:15px}
.cls-title{margin:0 0 10px;font-size:clamp(24px,3vw,32px);line-height:1.25;letter-spacing:-.01em}
.cls-sub{margin:0;max-width:760px;color:var(--cls-soft-text);font-size:15px;line-height:1.75}
.cls-class-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.cls-head-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cls-back{display:inline-flex;align-items:center;gap:6px;min-height:32px;margin-bottom:18px;color:var(--cls-mute);font-size:14px;text-decoration:none}
.cls-back:hover{color:var(--cls-accent)}
.cls-back .cls-i{width:16px;height:16px}

.cls-card{background:var(--cls-card);border:1px solid var(--cls-border);border-radius:18px;padding:22px;box-shadow:0 10px 30px rgba(15,23,42,.04)}
.cls-center{text-align:center;padding:56px 24px;display:flex;flex-direction:column;align-items:center;gap:10px}
.cls-center h2{margin:6px 0 0;font-size:20px}
.cls-center p{margin:0;color:var(--cls-mute)}
.cls-empty-icon{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:18px;background:var(--cls-soft);color:var(--cls-mute)}
.cls-empty-icon .cls-i{width:26px;height:26px}
.cls-empty-icon.is-danger{background:#fef2f2;color:var(--cls-danger)}
.cls-empty{text-align:center;padding:34px 16px;color:var(--cls-mute)}
.cls-empty h3{margin:12px 0 6px;color:var(--cls-text);font-size:17px}
.cls-empty p{margin:0;font-size:14px}

.cls-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:0 16px;border-radius:11px;border:1px solid var(--cls-border);background:var(--cls-card);color:var(--cls-text);font:inherit;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;transition:.16s ease;white-space:nowrap}
.cls-btn:hover{border-color:color-mix(in srgb,var(--cls-accent) 40%,var(--cls-border));color:var(--cls-accent)}
.cls-btn:disabled,.cls-btn.is-disabled{opacity:.45;cursor:not-allowed;pointer-events:none}
.cls-btn .cls-i{width:16px;height:16px}
.cls-primary{background:var(--cls-action);border-color:var(--cls-action);color:#fff;box-shadow:0 8px 20px color-mix(in srgb,var(--cls-accent) 28%,transparent)}
.cls-primary:hover{color:#fff;filter:brightness(1.05)}
.cls-ghost{background:transparent}
.cls-danger-ghost{background:transparent;border-color:#fecaca;color:var(--cls-danger)}
.cls-danger-ghost:hover{border-color:var(--cls-danger);color:var(--cls-danger)}
.cls-sm{min-height:34px;padding:0 11px;font-size:13px;border-radius:9px}
.cls-sm .cls-i{width:14px;height:14px}
.cls-btn.is-busy{position:relative;color:transparent}
.cls-btn.is-busy::after{content:"";position:absolute;width:15px;height:15px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:cls-spin .7s linear infinite;color:#fff}
.cls-ghost.is-busy::after{color:var(--cls-accent)}
@keyframes cls-spin{to{transform:rotate(360deg)}}

.cls-input,.cls-textarea,.cls-select{width:100%;border:1px solid var(--cls-border);border-radius:11px;background:var(--cls-card);color:var(--cls-text);font:inherit;font-size:14px;padding:10px 13px;min-height:42px;outline:none;transition:.16s ease}
.cls-input:focus,.cls-textarea:focus,.cls-select:focus{border-color:var(--cls-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--cls-accent) 14%,transparent)}
.cls-textarea{resize:vertical;line-height:1.6;min-height:74px}
.cls-field{display:flex;flex-direction:column;gap:7px}
.cls-field label{font-size:13px;font-weight:600;color:var(--cls-soft-text)}
.cls-hint{margin:0;font-size:12.5px;color:var(--cls-mute);line-height:1.6}
.cls-muted{color:var(--cls-mute)}
.cls-count{font-size:13px;font-weight:600;color:var(--cls-mute);margin-left:6px}
.cls-mono{font-variant-numeric:tabular-nums;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--cls-soft-text)}

.cls-new-class{margin-bottom:26px}
.cls-new-form{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
.cls-new-field{flex:1 1 280px;display:flex;flex-direction:column;gap:7px}
.cls-new-field label{font-weight:700;font-size:15px}
.cls-new-class .cls-hint{margin-top:12px}
.cls-section-head{display:flex;align-items:baseline;justify-content:space-between;margin:0 2px 14px}
.cls-section-head h2{margin:0;font-size:18px}
.cls-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px}
.cls-grid-full{grid-column:1/-1}
.cls-class-card{position:relative;display:flex;flex-direction:column;gap:10px;padding:20px;border-radius:18px;border:1px solid var(--cls-border);background:var(--cls-card);color:inherit;text-decoration:none;overflow:hidden;transition:.18s ease;box-shadow:0 8px 24px rgba(15,23,42,.04)}
.cls-class-card:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--cls-accent) 38%,var(--cls-border));box-shadow:0 16px 34px rgba(15,23,42,.09)}
.cls-class-glow{position:absolute;inset:auto -30px -60px auto;width:150px;height:150px;border-radius:50%;background:hsl(var(--cls-hue) 82% 64% / .16);filter:blur(6px);pointer-events:none}
.cls-class-top{display:flex;align-items:center;justify-content:space-between}
.cls-class-icon{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:13px;background:hsl(var(--cls-hue) 78% 94%);color:hsl(var(--cls-hue) 55% 42%)}
.cls-class-arrow{color:var(--cls-mute);transition:.18s ease}
.cls-class-card:hover .cls-class-arrow{color:var(--cls-accent);transform:translateX(2px)}
.cls-class-name{font-size:18px;line-height:1.35;position:relative;z-index:1}
.cls-class-meta{display:flex;gap:14px;flex-wrap:wrap;color:var(--cls-mute);font-size:13px}
.cls-class-meta span{display:inline-flex;align-items:center;gap:5px}
.cls-class-meta .cls-i{width:14px;height:14px}
.cls-class-date{font-size:12px;color:var(--cls-mute);opacity:.8}

.cls-detail-grid{display:grid;grid-template-columns:minmax(300px,.85fr) minmax(380px,1.15fr);gap:18px;align-items:start}
.cls-card-head{margin-bottom:16px}
.cls-card-head h2{margin:0 0 5px;font-size:17px}
.cls-card-head p{margin:0;font-size:13px;color:var(--cls-mute);line-height:1.65}
.cls-roster-form{margin-bottom:16px}
.cls-roster-form-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;flex-wrap:wrap}
.cls-roster-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;border-top:1px solid var(--cls-border)}
.cls-roster-list:empty{border:0}
.cls-member{display:flex;align-items:center;gap:10px;padding:9px 2px;border-bottom:1px solid var(--cls-border);min-height:44px}
.cls-member-index{width:24px;font-size:12px;color:var(--cls-mute);font-variant-numeric:tabular-nums;text-align:right}
.cls-member-name{flex:1;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cls-member-actions{display:flex;gap:4px;opacity:1;transition:.15s}
.cls-member:hover .cls-member-actions{opacity:1}
.cls-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:8px;background:transparent;color:var(--cls-mute);cursor:pointer;transition:.15s}
.cls-icon-btn:hover{background:var(--cls-soft);color:var(--cls-accent)}
.cls-icon-btn.is-danger:hover{background:#fef2f2;color:var(--cls-danger)}
.cls-icon-btn .cls-i{width:16px;height:16px}
.cls-roster-empty{padding:22px 4px;text-align:center;color:var(--cls-mute);font-size:13.5px;border-bottom:1px solid var(--cls-border)}
.cls-roster-list{max-height:480px;overflow:auto}

.cls-assign-form{display:flex;flex-direction:column;gap:12px;padding-bottom:18px;border-bottom:1px solid var(--cls-border)}
.cls-assign-form .cls-btn{align-self:flex-start}
.cls-assign-form [hidden]{display:none!important}
.cls-kind-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.cls-kind-wide{grid-column:1/-1}
.cls-assign-kind{color:color-mix(in srgb,var(--cls-accent) 72%,var(--cls-mute));font-weight:650}
.cls-inline-link{color:var(--cls-accent);text-decoration:none;font-weight:650}
.cls-inline-link:hover{text-decoration:underline}
.cls-score{font-weight:700;color:var(--cls-ok);font-variant-numeric:tabular-nums}
.cls-score.is-empty{color:var(--cls-mute);font-weight:400}
.cls-assign-wrap{margin-top:14px}
.cls-assign-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.cls-assign-item{border:1px solid var(--cls-border);border-radius:13px;overflow:hidden;transition:.15s}
.cls-assign-item:hover{border-color:color-mix(in srgb,var(--cls-accent) 32%,var(--cls-border));background:color-mix(in srgb,var(--cls-accent) 3%,transparent)}
.cls-assign-main{display:flex;align-items:center;gap:12px;padding:13px 14px;color:inherit;text-decoration:none}
.cls-assign-icon{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:11px;background:color-mix(in srgb,#a855f7 12%,transparent);color:#a855f7;flex:none}
.cls-assign-icon.is-closed{background:var(--cls-soft);color:var(--cls-mute)}
.cls-assign-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.cls-assign-info b{font-size:14.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cls-assign-info small{font-size:12.5px;color:var(--cls-mute)}
.cls-assign-go{width:16px;height:16px;color:var(--cls-mute)}
.cls-progress{display:block;height:4px;border-radius:99px;background:var(--cls-soft);overflow:hidden;margin-top:4px}
.cls-progress i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,var(--cls-accent),#8b5cf6)}
.cls-assign-empty{padding:30px 12px}

.cls-chip{display:inline-flex;align-items:center;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:650;white-space:nowrap;line-height:1.6}
.cls-chip.is-done,.cls-chip.is-open,.cls-chip.is-published{background:#ecfdf5;color:#047857}
.cls-chip.is-doing{background:#fffbeb;color:#b45309}
.cls-chip.is-idle{background:var(--cls-soft);color:var(--cls-mute)}
.dark .cls-chip.is-done,.dark .cls-chip.is-open,.dark .cls-chip.is-published{background:rgba(16,185,129,.15);color:#6ee7b7}
.dark .cls-chip.is-doing{background:rgba(245,158,11,.16);color:#fcd34d}

.cls-instructions{display:flex;gap:14px;margin-bottom:16px;align-items:flex-start}
.cls-instructions > .cls-i{width:22px;height:22px;color:var(--cls-accent);margin-top:2px}
.cls-instructions b{display:block;margin-bottom:4px;font-size:14px}
.cls-instructions p{margin:0;color:var(--cls-soft-text);font-size:14px;line-height:1.7;white-space:pre-wrap}
.cls-share{margin-bottom:16px;border-color:color-mix(in srgb,var(--cls-accent) 26%,var(--cls-border));background:linear-gradient(135deg,color-mix(in srgb,var(--cls-accent) 6%,var(--cls-card)),var(--cls-card))}
.cls-share-head{display:flex;gap:13px;align-items:flex-start;margin-bottom:14px}
.cls-share-icon{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:13px;background:color-mix(in srgb,var(--cls-accent) 12%,transparent);color:var(--cls-accent);flex:none}
.cls-share-head h2{margin:0 0 4px;font-size:16px}
.cls-share-head p{margin:0;font-size:13px;color:var(--cls-mute)}
.cls-share-row{display:flex;gap:10px;flex-wrap:wrap}
.cls-share-input{flex:1 1 320px;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.cls-share .cls-hint{margin-top:10px}
.dark .cls-share-input{background:rgba(255,255,255,.04)}

.cls-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.cls-stat{display:flex;flex-direction:column;align-items:flex-start;gap:4px;padding:16px 18px;border:1px solid var(--cls-border);border-radius:15px;background:var(--cls-card)}
.cls-stat-icon{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:10px;margin-bottom:4px;background:var(--cls-soft);color:var(--cls-mute)}
.cls-stat-icon .cls-i{width:17px;height:17px}
.cls-stat-icon.is-done{background:#ecfdf5;color:#059669}
.cls-stat-icon.is-doing{background:#fffbeb;color:#d97706}
.cls-stat b{font-size:24px;line-height:1.1;font-variant-numeric:tabular-nums}
.cls-stat small{font-size:12.5px;color:var(--cls-mute)}

.cls-table-card{padding:0;overflow:hidden}
.cls-table-head{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:18px 22px;flex-wrap:wrap}
.cls-table-head h2{margin:0;font-size:16px}
.cls-table-tools{display:flex;gap:10px;flex-wrap:wrap}
.cls-search{width:210px;min-height:38px;padding:8px 12px}
.cls-select{width:auto;min-width:118px;min-height:38px;padding:8px 34px 8px 12px;appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--cls-mute) 50%),linear-gradient(135deg,var(--cls-mute) 50%,transparent 50%);background-position:calc(100% - 17px) 16px,calc(100% - 12px) 16px;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
.cls-table-scroll{overflow-x:auto}
.cls-table{width:100%;border-collapse:collapse;font-size:13.5px}
.cls-table th{text-align:left;padding:11px 14px;background:var(--cls-soft);color:var(--cls-mute);font-size:12px;font-weight:650;letter-spacing:.02em;white-space:nowrap}
.cls-table th:first-child{padding-left:22px}
.cls-table th:last-child{padding-right:22px}
.cls-table td{padding:12px 14px;border-top:1px solid var(--cls-border);vertical-align:middle}
.cls-table td:first-child{padding-left:22px}
.cls-table td:last-child{padding-right:22px}
.cls-table tbody tr:hover{background:color-mix(in srgb,var(--cls-accent) 3%,transparent)}
.cls-student{font-weight:600}
.cls-row-actions{display:flex;gap:6px;flex-wrap:wrap}
.cls-table-empty{padding:30px 8px}
.cls-table-empty .cls-empty-icon{width:46px;height:46px}
.cls-table-empty h3{font-size:15px}

.cls-modal-backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.46);backdrop-filter:blur(3px);animation:cls-fade .16s ease}
.cls-modal{width:min(760px,100%);max-height:min(88vh,860px);display:flex;flex-direction:column;background:var(--cls-card);color:var(--cls-text);border-radius:20px;box-shadow:0 28px 80px rgba(15,23,42,.32);overflow:hidden;animation:cls-pop .18s ease}
.cls-modal-form{min-height:0;overflow:auto;overscroll-behavior:contain;padding:24px;display:flex;flex-direction:column;gap:16px}
.cls-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:22px 24px 0}
.cls-modal-form .cls-modal-head{padding:0}
.cls-modal-head h2{margin:0;font-size:19px;line-height:1.35}
.cls-modal-sub{margin:4px 0 0;font-size:13px;color:var(--cls-mute)}
.cls-modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:4px}
.cls-modal-body{min-height:0;overscroll-behavior:contain;padding:18px 24px;overflow:auto;flex:1}
.cls-modal-foot{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:16px 24px 20px;border-top:1px solid var(--cls-border);flex-wrap:wrap}
.cls-modal-foot-actions{display:flex;gap:10px}
.cls-author-field{flex:1 1 300px;display:flex;flex-direction:column;gap:6px;min-width:0}
.cls-author-field label{font-size:13px;font-weight:650;color:var(--cls-soft-text)}
.cls-modal-loading{display:flex;align-items:center;justify-content:center;gap:12px;padding:70px 24px;color:var(--cls-mute)}
.cls-spinner{width:20px;height:20px;border:2.5px solid var(--cls-border);border-top-color:var(--cls-accent);border-radius:50%;animation:cls-spin .7s linear infinite;display:inline-block}
.cls-published-note{display:flex;align-items:center;gap:8px;padding:10px 14px;margin-bottom:14px;border-radius:11px;background:#ecfdf5;color:#047857;font-size:13px;font-weight:600}
.cls-published-note .cls-i{width:16px;height:16px}
.dark .cls-published-note{background:rgba(16,185,129,.15);color:#6ee7b7}
.cls-pages{display:flex;flex-direction:column;gap:14px}
.cls-page{display:grid;grid-template-columns:minmax(160px,42%) 1fr;gap:16px;align-items:stretch;border:1px solid var(--cls-border);border-radius:14px;overflow:hidden}
.cls-page-art{background:var(--cls-soft);min-height:150px;display:flex;align-items:center;justify-content:center;color:var(--cls-mute);font-size:12.5px;text-align:center}
.cls-page-art img{width:100%;height:100%;max-height:260px;object-fit:cover;display:block}
.cls-page-art span{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px}
.cls-page-art .cls-i{width:24px;height:24px}
.cls-page-text{padding:14px 16px 14px 0;display:flex;flex-direction:column;gap:6px;justify-content:center}
.cls-page-no{font-size:11.5px;font-weight:700;letter-spacing:.08em;color:var(--cls-accent);text-transform:uppercase}
.cls-page-text p{margin:0;font-size:14.5px;line-height:1.75}
.cls-page-mood{font-size:12px;color:var(--cls-mute)}
.cls-pages-empty{padding:40px}
.cls-chip.is-type{background:color-mix(in srgb,var(--cls-accent) 10%,transparent);color:var(--cls-accent)}
.cls-lab-summary{display:flex;align-items:center;gap:18px;padding:20px;border:1px solid var(--cls-border);border-radius:16px;background:linear-gradient(135deg,color-mix(in srgb,var(--cls-accent) 7%,var(--cls-card)),var(--cls-card))}
.cls-lab-score{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;width:96px;height:96px;border-radius:50%;border:6px solid color-mix(in srgb,var(--cls-ok) 26%,var(--cls-border));background:var(--cls-soft);flex:none}
.cls-lab-score b{font-size:30px;line-height:1;font-variant-numeric:tabular-nums}
.cls-lab-score span{font-size:12px;color:var(--cls-mute)}
.cls-lab-main{min-width:0}
.cls-lab-main small{display:block;font-size:12px;color:var(--cls-mute);margin-bottom:4px}
.cls-lab-main b{display:block;font-size:17px}
.cls-lab-main p{margin:6px 0 0;color:var(--cls-soft-text);font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.cls-lab-work{display:flex;flex-direction:column;gap:6px;margin-top:14px;padding:16px;border:1px solid var(--cls-border);border-radius:14px}
.cls-lab-work b{font-size:15px}
.cls-lab-work p{margin:0;color:var(--cls-soft-text);font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.cls-task-text{padding:16px;border:1px solid var(--cls-border);border-radius:14px;background:var(--cls-soft)}
.cls-task-text p{margin:0;font-size:14.5px;line-height:1.8;white-space:pre-wrap;word-break:break-word}
.cls-task-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:14px}
.cls-task-gallery a{display:block;aspect-ratio:4/3;border:1px solid var(--cls-border);border-radius:12px;overflow:hidden;background:var(--cls-soft)}
.cls-task-gallery img{width:100%;height:100%;object-fit:cover;display:block}

.cls-toast{position:fixed;left:50%;bottom:34px;z-index:1100;transform:translate(-50%,16px);max-width:min(520px,calc(100vw - 48px));padding:12px 18px;border-radius:12px;background:rgba(17,24,39,.92);color:#fff;font-size:14px;line-height:1.5;box-shadow:0 14px 40px rgba(15,23,42,.3);opacity:0;pointer-events:none;transition:.22s ease}
.cls-toast.is-show{opacity:1;transform:translate(-50%,0)}

.cls-skel{background:linear-gradient(90deg,var(--cls-soft) 25%,color-mix(in srgb,var(--cls-soft) 55%,var(--cls-card)) 37%,var(--cls-soft) 63%);background-size:400% 100%;animation:cls-shimmer 1.3s ease infinite;border-radius:12px}
.cls-skel-title{height:34px;width:min(420px,70%);margin-bottom:14px}
.cls-skel-line{height:16px;width:min(620px,90%);margin-bottom:28px}
.cls-skel-card{height:120px;margin-bottom:16px;border-radius:18px}
@keyframes cls-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
@keyframes cls-fade{from{opacity:0}to{opacity:1}}
@keyframes cls-pop{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}

@media (max-width:900px){
  .cls-detail-grid{grid-template-columns:minmax(0,1fr)}
  .cls-detail-grid>*{min-width:0}
  .cls-stats{grid-template-columns:repeat(2,1fr)}
  .cls-class-head{align-items:flex-start}
  .cls-share-row .cls-btn{flex:1}
}
@media (max-width:620px){
  .cls-container{width:calc(100% - 32px);padding-top:28px}
  .cls-card{padding:18px;border-radius:16px}
  .cls-page{grid-template-columns:1fr}
  .cls-page-text{padding:0 14px 14px}
  .cls-page-art img{max-height:220px}
  .cls-table-tools{width:100%}
  .cls-table-tools .cls-select{flex:1;min-width:0}
  .cls-search{width:100%}
  .cls-table,.cls-table tbody,.cls-table tr,.cls-table td{display:block}
  .cls-table thead{display:none}
  .cls-table tr{border-top:1px solid var(--cls-border);padding:8px 0}
  .cls-table td{border:0;padding:6px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px}
  .cls-table td:first-child{padding-left:18px}
  .cls-table td:last-child{padding-right:18px}
  .cls-table td::before{content:attr(data-label);font-size:12px;color:var(--cls-mute);font-weight:650}
  .cls-row-actions{justify-content:flex-end}
  .cls-modal-backdrop{padding:12px}
  .cls-modal{max-height:92vh;border-radius:16px}
  .cls-modal-foot{align-items:stretch}
  .cls-modal-foot-actions{width:100%}
  .cls-modal-foot-actions .cls-btn{flex:1}
  .cls-stat{padding:14px}
  .cls-class-meta{gap:10px}
  .cls-kind-fields{grid-template-columns:1fr}
  .cls-lab-summary{flex-direction:column;align-items:flex-start}
  .cls-task-gallery{grid-template-columns:repeat(2,1fr)}
}


/* Theme tokens follow the same html.dark class as the Vue application. */
.dark .cls-studio-root,.dark .cls-modal-backdrop,.dark .cls-toast{
  --cls-accent:#9baaff;--cls-danger:#fca5a5;--cls-ok:#6ee7b7;--cls-warn:#fcd34d;
}
.dark .cls-stat-icon.is-done{background:rgba(16,185,129,.15);color:var(--cls-ok)}
.dark .cls-stat-icon.is-doing{background:rgba(245,158,11,.16);color:var(--cls-warn)}
.dark .cls-empty-icon.is-danger,.dark .cls-icon-btn.is-danger:hover{background:rgba(239,68,68,.12)}
.cls-studio-root :is(a,button,input,select,textarea):focus-visible,
.cls-modal :is(a,button,input,select,textarea):focus-visible{outline:2px solid var(--cls-accent);outline-offset:3px}
.cls-title,.cls-sub,.cls-class-name,.cls-instructions p,.cls-modal-head h2,.cls-page-text p{overflow-wrap:anywhere}
.cls-modal-head,.cls-modal-foot{flex-shrink:0}
.cls-member-actions{flex-shrink:0}
@media (max-width:1023px), (pointer:coarse){
  .cls-btn,.cls-sm,.cls-back{min-height:44px}
  .cls-icon-btn{width:44px;height:44px;flex-shrink:0}
  .cls-input,.cls-textarea,.cls-select{min-height:44px;font-size:16px}
  .cls-select{background-position:calc(100% - 17px) 19px,calc(100% - 12px) 19px}
}
@media (max-height:500px){
  .cls-modal-backdrop{padding:12px}
  .cls-modal{max-height:calc(100dvh - 24px)}
}
@media (prefers-reduced-motion:reduce){
  .cls-studio-root *,.cls-modal-backdrop *,.cls-toast{animation:none!important;transition:none!important}
}

.cls-member-info{min-width:0;flex:1;display:flex;flex-direction:column;gap:3px}
.cls-member-info small,.cls-student-no{display:block;color:var(--cls-mute);font-size:12px;overflow-wrap:anywhere}
.cls-member-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cls-member-fields>*{min-width:0}
.cls-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.cls-groups-card{margin-top:18px}
.cls-groups-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;flex-wrap:wrap}
.cls-group-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
.cls-group-card{min-width:0;border:1px solid var(--cls-border);background:var(--cls-soft);border-radius:14px;padding:16px}
.cls-group-card h3{margin:0 0 12px;font-size:15px;overflow-wrap:anywhere}
.cls-group-card p{display:flex;gap:6px;flex-wrap:wrap;margin:0}
.cls-group-chip{display:inline-flex;align-items:baseline;gap:5px;padding:5px 9px;border-radius:8px;background:var(--cls-card);font-size:13px;overflow-wrap:anywhere}
.cls-group-chip small{color:var(--cls-mute)}
.cls-group-controls{display:grid;grid-template-columns:minmax(0,.7fr) minmax(0,1fr);gap:12px;align-items:end}
.cls-group-controls label,.cls-group-names label{display:flex;flex-direction:column;gap:6px;font-size:13px;min-width:0}
.cls-group-controls button{grid-column:1/-1;justify-self:start}
.cls-group-names{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:16px 0}
.cls-group-members{display:grid;gap:7px;margin:12px 0}
.cls-group-member{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:center;padding:8px;border-bottom:1px solid var(--cls-border)}
.cls-group-member>span{min-width:0;overflow-wrap:anywhere}
.cls-group-member small{display:block;color:var(--cls-mute);font-size:12px}
.cls-inline-error{color:var(--cls-danger);font-size:13px;line-height:1.6;margin:12px 0;white-space:pre-wrap}
.cls-inline-error:empty{display:none}
.cls-quiz-builder{min-width:0}
.cls-quiz-question{display:grid;gap:12px;min-width:0;padding:16px;margin-bottom:12px;border:1px solid var(--cls-border);border-radius:14px;background:var(--cls-soft)}
.cls-quiz-question [hidden]{display:none!important}
.cls-quiz-question-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:13px;color:var(--cls-mute)}
.cls-quiz-question .cls-field{min-width:0}
.cls-quiz-release{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.cls-quiz-details summary{cursor:pointer;padding:10px 0;color:var(--cls-accent);font-weight:600}
.cls-quiz-preview{margin:12px 0;padding:0;list-style:none;display:grid;gap:14px}
.cls-quiz-preview>li{min-width:0;padding:16px;border:1px solid var(--cls-border);background:var(--cls-soft);border-radius:12px;overflow-wrap:anywhere}
.cls-quiz-preview ul{list-style:none;padding:0;display:grid;gap:5px;font-size:14px}
.cls-quiz-preview p{white-space:pre-wrap;line-height:1.65}
.cls-quiz-stem{font-weight:600;color:var(--cls-text)}
.cls-quiz-answer{font-weight:600;color:var(--cls-accent)}
.cls-quiz-result{font-size:18px;font-weight:700;color:var(--cls-accent)}
@media(max-width:600px){
  .cls-member-fields,.cls-group-names{grid-template-columns:minmax(0,1fr)}
  .cls-group-grid{grid-template-columns:minmax(0,1fr)}
  .cls-quiz-question,.cls-quiz-preview>li{padding:12px}
  .cls-groups-head>.cls-btn{width:100%}
  .cls-group-controls{grid-template-columns:minmax(0,1fr)}
  .cls-group-controls button{width:100%}
}

/* 头部的 backdrop-filter 会成为 Element Plus 抽屉 fixed 层的包含块，
   把抽屉压成 74px 高；模糊改到伪元素上，定位恢复正常 */
header.aiq-navbar{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;isolation:isolate}
header.aiq-navbar::after{content:"";position:absolute;inset:0;z-index:-1;pointer-events:none;
  backdrop-filter:saturate(140%) blur(14px);-webkit-backdrop-filter:saturate(140%) blur(14px)}
`
})()
