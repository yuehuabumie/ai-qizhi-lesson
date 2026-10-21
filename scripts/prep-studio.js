/** Teacher lesson preparation UI for the shipped Vue build. No provider keys or
 * model execution live in the browser. Events and approval versions come from API. */
;(() => {
  'use strict'
  if (window.__AIQ_PREP_STUDIO__) return
  window.__AIQ_PREP_STUDIO__ = true
  const INITIAL_HASH = location.hash
  const API = '/api/prep'
  const HTML_PREVIEW_LIMIT = 2 * 1024 * 1024
  const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"
  const ACTIVE = new Set(['queued', 'running', 'waiting', 'cancelling'])
  const STATUS = { queued: '排队中', running: '正在备课', waiting: '等待确认', cancelling: '正在停止', completed: '已完成', cancelled: '已停止', failed: '未完成' }
  const ICONS = {
    spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chat: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    paperclip: '<path d="m21 11-8.5 8.5a6 6 0 0 1-8.5-8.5L13 2a4 4 0 0 1 5.7 5.7l-9 9a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3ZM14 5l5 5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    tool: '<path d="m14.7 6.3 3 3-9.4 9.4-3-3 9.4-9.4ZM14 3a5 5 0 0 0-5.7 6.8L3 15.1a3 3 0 0 0 4.2 4.2l5.3-5.3A5 5 0 0 0 20 8l-4 1-1-1 1-4-2-1Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17"/>',
    brain: '<path d="M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 3 10a4 4 0 0 0 2 7 4 4 0 0 0 7 1Zm0 0V5a3 3 0 0 1 5.8-1A4 4 0 0 1 21 10a4 4 0 0 1-2 7 4 4 0 0 1-7 1Z"/>',
    expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
    collapse: '<path d="M3 8h5V3M21 8h-5V3M8 21v-5H3M16 21v-5h5"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  }
  const icon = (name) => `<svg class="prep-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  const json = (v) => { try { return JSON.stringify(v, null, 2) } catch { return String(v ?? '') } }
  const bytes = (n) => n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil((n || 0) / 1024))} KB`
  const label = (key) => ({ name: '姓名 / 名称', className: '班级名称', title: '标题', description: '说明', instructions: '作业说明', studentNo: '学号', gender: '性别', score: '成绩', members: '学生名单', operations: '名单变更', groups: '小组', memberIds: '组员编号', questions: '题目', quiz: '试卷', stem: '题干', options: '选项', answer: '正确选项编号（从 0 开始）', explanation: '解析', points: '分值', type: '类型', action: '操作', status: '状态', classId: '班级编号', assignmentId: '作业编号', id: '编号', scoresPublished: '公布成绩', answersPublished: '公布答案', summary: '摘要', count: '数量', total: '总计', added: '新增', updated: '修改', removed: '删除', warnings: '待核对事项', students: '学生名单', payload: '操作内容' })[key] || key
  const toolLabel = (name) => ({ create_class: '创建班级', create_classroom: '创建班级', edit_class_roster: '编辑班级名单', edit_roster: '编辑班级名单', update_roster: '编辑班级名单', save_groups: '保存小组', group_students: '分组', create_assignment: '创建作业', publish_assignment: '发布作业', publish_quiz_results: '公布试卷反馈', create_quiz: '创建试卷', list_classrooms: '查看班级', get_classroom: '读取班级名单', get_assignment: '读取作业', web_search: '联网检索', web_fetch: '阅读网页', read: '读取文件', read_file: '读取文件', read_image: '查看图片', write: '写入文件', edit: '编辑文件', bash: '运行沙箱命令', shell: '运行沙箱命令', subagent: '启动子任务', send_message: '协调子任务', todo_write: '更新任务计划', create_goal: '设置任务目标', skill: '使用技能', export_file: '交付生成文件', generate_lesson_image: '生成教学配图', job_output: '查看命令结果', job_kill: '停止沙箱命令' })[name] || String(name || '执行工具').replace(/_/g, ' ')
  let root = null, epoch = 0, timer = 0, polling = false, creation = null, modal = null, returnFocus = null, navObserver = null, draftOwner = null, editorSerial = 0, fullscreenSlot = null, fullscreenOverflow = '', fullscreenBackground = []
  const modalStack = []
  const ctx = { router: null }
  const drafts = new Map()
  const transfers = new Map()
  let S = blank()
  function blank() { return { id: '', session: null, sessions: [], messages: [], events: [], attachments: [], proposals: [], activeRun: null, after: 0, hasMore: false, ready: false, identityReady: false, pendingDraft: { content: '', files: [] }, status: null, loading: false, error: '', pollError: '', panel: 'chat', busy: new Set(), skills: [], skillsLoaded: false } }
  const current = (page, id) => root && epoch === page && S.id === id
  function draft() { if (!S.identityReady) return S.pendingDraft; const key = S.id || 'new'; if (!drafts.has(key)) drafts.set(key, { content: '', files: [] }); return drafts.get(key) }
  function clearDrafts() { for (const d of drafts.values()) d.files.forEach((f) => { transfers.get(f.key)?.abort(); if (f.preview) URL.revokeObjectURL(f.preview) }); drafts.clear() }
  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {})
    let body = options.body
    if (body !== undefined && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) { headers.set('content-type', 'application/json'); body = JSON.stringify(body) }
    const r = await fetch(API + path, { ...options, headers, body, credentials: 'same-origin' })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(data?.error?.message || (r.status === 401 ? '请先登录后使用智能备课' : `请求未完成（${r.status}）`)); e.status = r.status; throw e }
    return data
  }
  function error(message) { if (!root) return; S.error = message || ''; const box = root.querySelector('[data-prep-error]'); box.hidden = !message; box.querySelector('span').textContent = message || '' }
  function toast(message) { if (!root) return; const box = root.querySelector('[data-prep-notice]'); box.textContent = message; box.hidden = false; clearTimeout(box._timer); box._timer = setTimeout(() => { box.hidden = true }, 4500) }
  function shell() {
    return `<div class="prep-wrap"><header class="prep-heading"><div><span class="prep-eyebrow">${icon('spark')}教师工作台</span><h1>智能备课<span class="prep-model" data-prep-model>DeepSeek</span></h1><p>从一份材料开始，把想法变成可用的课堂。</p></div><div class="prep-heading-actions"><button type="button" class="prep-btn" data-prep-action="fullscreen" aria-label="全屏工作台" title="全屏工作台" aria-pressed="false">${icon('expand')}<span>全屏工作台</span></button><a class="prep-btn" href="#/me/classes">${icon('chat')}我的班级</a></div></header>
      <div class="prep-alert" data-prep-disabled hidden role="status"></div><div class="prep-alert is-error" data-prep-error hidden role="alert"><span></span><button type="button" class="prep-icon-btn" data-prep-action="dismiss-error" aria-label="关闭错误提示">${icon('close')}</button></div>
      <div class="prep-mobile-tabs" role="tablist" aria-label="备课工作区"><button role="tab" type="button" data-prep-panel="sessions" aria-controls="prep-sessions">${icon('menu')}对话</button><button role="tab" type="button" data-prep-panel="chat" aria-controls="prep-chat">${icon('chat')}备课</button></div>
      <div class="prep-layout"><aside class="prep-sidebar" id="prep-sessions" aria-label="备课对话"><button type="button" class="prep-btn prep-primary prep-new" data-prep-action="new">${icon('plus')}新建对话</button><button type="button" class="prep-btn prep-files-button" data-prep-action="files">${icon('file')}查看已生成文件<span class="prep-file-count" data-prep-file-count hidden></span></button><p class="prep-section-label">我的备课对话</p><nav data-prep-sessions aria-label="历史对话"></nav><div class="prep-sidebar-foot"><button type="button" class="prep-btn" data-prep-action="skills">${icon('spark')}我的 Skills</button><p>新对话独立开始，只有当前对话的资料会进入上下文。</p></div></aside>
      <section class="prep-chat" id="prep-chat" aria-label="备课对话内容"><header class="prep-chat-head"><div><h2 data-prep-title>开始一次新的备课</h2><span class="prep-subtle" data-prep-run-status>资料与对话仅对你可见</span></div><div class="prep-chat-actions"><button type="button" class="prep-icon-btn" data-prep-action="refresh" aria-label="刷新执行状态">${icon('refresh')}</button><div data-prep-chat-actions></div></div></header><p class="prep-poll-error" data-prep-poll-error hidden role="status"></p><div class="prep-thread" data-prep-thread aria-busy="false"></div><button type="button" class="prep-jump" data-prep-action="jump" hidden>查看最新内容 ↓</button>
      <form class="prep-composer" data-prep-form><div class="prep-file-queue" data-prep-queue></div><label class="prep-compose-label" for="prep-message">备课需求</label><textarea id="prep-message" rows="3" maxlength="30000" placeholder="告诉我学科、年级和课题，或上传教材、班级名单…" aria-describedby="prep-input-help"></textarea><div class="prep-compose-actions"><div><button type="button" class="prep-icon-btn" data-prep-action="attach" aria-label="上传图片或文件" title="上传图片或文件">${icon('paperclip')}</button><span class="prep-input-hint" id="prep-input-help">可上传、粘贴或拖放图片与文件</span><input type="file" data-prep-files multiple hidden></div><button class="prep-btn prep-primary" type="submit" data-prep-send>${icon('send')}发送</button><button class="prep-btn" type="button" data-prep-action="cancel" hidden>${icon('stop')}停止</button></div><p class="prep-composer-note">AI 可能识别有误。班级、名单和作业变更会先请你核对。</p></form></section>
</div><div class="prep-drop-hint" aria-hidden="true">${icon('paperclip')}松开以上传到当前对话</div><div class="prep-toast" data-prep-notice role="status" hidden></div></div>`
  }
  function emptyThread() {
    return `<div class="prep-welcome"><div class="prep-welcome-icon">${icon('spark')}</div><h2>今天，准备怎样的一堂课？</h2><p>可以先聊教学目标，也可以上传教材、试卷或班级名单。我会在执行教学变更前，与你核对结果。</p><div class="prep-starters"><button type="button" data-prep-prompt="我想准备一节课，请先向我确认学科、年级、课题和课时。">${icon('chat')}一起设计一堂课<span>从目标、活动到课堂评价</span></button><button type="button" data-prep-prompt="我会上传一份班级名单，请提取姓名、学号、性别和成绩，标出缺失或不确定项，先给我预览。">${icon('file')}整理一份班级名单<span>识别材料，核对后再创建</span></button><button type="button" data-prep-prompt="请帮我创建一份单选题和判断题试卷，先向我确认知识点、题量和难度。">${icon('edit')}编一份课堂练习<span>单选与判断，在线提交</span></button></div><div class="prep-capabilities"><span>教案 / 课件</span><span>试卷 / 讲义</span><span>图片 / 互动网页</span></div></div>`
  }
  function attachmentLink(id, name, cls = '') { return `<a class="prep-attachment ${cls}" href="${API}/attachments/${encodeURIComponent(id)}" download>${icon('file')}<span>${esc(name || '附件')}</span>${icon('download')}</a>` }
  function renderSessions() {
    if (!root) return
    root.querySelector('[data-prep-sessions]').innerHTML = S.sessions.length ? S.sessions.map((s) => `<a href="#/prep/${encodeURIComponent(s.id)}" data-prep-session="${esc(s.id)}" class="prep-session ${S.id === s.id ? 'is-current' : ''}" ${S.id === s.id ? 'aria-current="page"' : ''}>${icon('chat')}<span>${esc(s.title || '未命名对话')}</span>${ACTIVE.has(s.status) ? '<i class="prep-session-live" aria-label="任务进行中"></i>' : ''}</a>`).join('') : '<p class="prep-empty-small">还没有备课对话。<br>从一条需求或一份资料开始。</p>'
  }
  function markdown(text) {
    return window.__AIQ_PREP_MARKDOWN__ ? window.__AIQ_PREP_MARKDOWN__(text, { attachments: S.attachments }) : esc(text)
  }
  function artifactCard(a) {
    const html = String(a.mime).split(';')[0].trim().toLowerCase() === 'text/html'
    const format = String(a.name || '').split('.').pop().toUpperCase()
    return `<section class="prep-artifact-card" data-prep-artifact="${esc(a.id)}"><div class="prep-artifact-icon">${icon('file')}</div><div class="prep-artifact-info"><h4>${esc(a.name || '生成文件')}</h4><p>${esc(format.length < 12 ? format : '文件')} · ${bytes(a.size)} · 已生成</p><div class="prep-artifact-actions"><a class="prep-btn is-artifact" href="${API}/attachments/${encodeURIComponent(a.id)}" download aria-label="下载 ${esc(a.name)}">${icon('download')}下载<span class="prep-sr"> ${esc(a.name)}</span></a>${html ? `<button type="button" class="prep-btn" data-prep-preview="${esc(a.id)}">预览</button>` : ''}</div></div></section>`
  }
  // Both messages and events carry runId. Keep each run with its teacher prompt,
  // including cancelled/older runs; do not append all activity to the latest reply.
  function conversationRuns() {
    const runs = [], byId = new Map(), messageKeys = new Map()
    const get = (id) => { if (!byId.has(id)) { const run = { id, messages: [], events: [], artifacts: [], proposals: [] }; runs.push(run); byId.set(id, run) } return byId.get(id) }
    let last = null
    for (let i = 0; i < S.messages.length; i++) {
      const m = S.messages[i]
      const following = S.messages.slice(i + 1).find((next) => next.role === 'user' || next.runId)
      const id = m.runId || (S.activeRun?.messageId === m.id ? S.activeRun.id : '') || (m.role === 'user' ? following?.role === 'assistant' && following.runId || (i === S.messages.findLastIndex((row) => row.role === 'user') && S.activeRun?.id) || `message-${m.id}` : last?.id) || `message-${m.id}`
      last = get(id); last.messages.push(m); messageKeys.set(m.id, id)
    }
    if (S.activeRun && !byId.has(S.activeRun.id)) get(S.activeRun.id)
    for (const e of S.events) {
      const datedPrompt = e.createdAt && S.messages.findLast((m) => m.role === 'user' && m.createdAt && new Date(m.createdAt) <= new Date(e.createdAt))
      const id = e.runId || e.data?.runId || (datedPrompt && messageKeys.get(datedPrompt.id)) || runs[0]?.id || 'history'
      get(id).events.push(e)
    }
    const files = new Map(S.attachments.filter((a) => a.kind === 'artifact').map((a) => [a.id, a]))
    for (const run of runs) for (const e of run.events) if (e.type === 'artifact' && files.has(e.data?.id)) { run.artifacts.push(files.get(e.data.id)); files.delete(e.data.id) }
    for (const a of files.values()) {
      const prompt = a.createdAt && S.messages.findLast((m) => m.role === 'user' && m.createdAt && new Date(m.createdAt) <= new Date(a.createdAt))
      get((prompt && messageKeys.get(prompt.id)) || runs.at(-1)?.id || 'history').artifacts.push(a)
    }
    for (const proposal of S.proposals) {
      const eventRun = runs.find((run) => run.events.some((e) => e.type === 'proposal' && e.data?.id === proposal.id))
      get(proposal.runId || eventRun?.id || runs.at(-1)?.id || 'history').proposals.push(proposal)
    }
    return runs
  }
  function proposalCard(p, existingOpen) {
    return `<section class="prep-proposal ${p.status === 'pending' ? 'is-pending' : ''}" data-prep-proposal="${esc(p.id)}"><div class="prep-proposal-tag">${icon(p.status === 'applied' ? 'check' : 'edit')}${({ pending: '请你核对', applied: '已执行', rejected: '未执行', expired: '预览已失效' })[p.status] || esc(p.status)}</div><h3 tabindex="-1" data-prep-proposal-title="${esc(p.id)}">${esc(p.description || toolLabel(p.tool))}</h3><details data-prep-detail="proposal-${esc(p.id)}" ${existingOpen.has(`proposal-${p.id}`) ? 'open' : ''}><summary>查看完整预览</summary><div class="prep-preview">${previewHTML(p.preview ?? p.payload)}</div></details>${p.status === 'pending' ? `<p class="prep-subtle">确认后才会修改班级、名单或作业。</p><div class="prep-proposal-actions"><button type="button" class="prep-btn prep-primary" data-prep-confirm="${esc(p.id)}" ${S.busy.has(`proposal:${p.id}`) ? 'disabled aria-busy="true"' : ''}>${S.busy.has(`proposal:${p.id}`) ? '处理中…' : '确认执行'}</button><button type="button" class="prep-btn" data-prep-edit="${esc(p.id)}">编辑</button><button type="button" class="prep-btn" data-prep-reject="${esc(p.id)}">暂不执行</button></div>` : ''}</section>`
  }
  function renderRunEvents(run, existingOpen) {
    const groups = []
    for (const e of run.events) {
      const previous = groups.at(-1)
      if (['text', 'reasoning'].includes(e.type) && previous?.type === e.type) previous.text += e.data?.text || ''
      else groups.push({ ...e, text: e.data?.text || '' })
    }
    const results = new Map(run.events.filter((e) => e.type === 'tool-result' && e.data?.callId).map((e) => [e.data.callId, e]))
    const started = new Set(run.events.filter((e) => e.type === 'tool-start').map((e) => e.data?.callId))
    const final = run.messages.filter((m) => m.role === 'assistant').at(-1)
    // The stored final response also arrives as deltas. Render it once, while
    // retaining earlier progress replies and their original paragraph breaks.
    const lastText = groups.findLast((e) => e.type === 'text')
    const duplicate = final && lastText?.text.trim() === final.content?.trim() ? lastText : null
    const running = ACTIVE.has(S.activeRun?.status) && run.id === S.activeRun?.id
    return groups.map((e) => {
      const d = e.data || {}, id = `event-${e.id}`, open = existingOpen.has(id) ? 'open' : ''
      if (e.type === 'text') return e === duplicate || !e.text ? '' : `<div class="prep-progress prep-markdown" data-prep-progress="${esc(e.id)}">${markdown(e.text)}</div>`
      if (e.type === 'reasoning') return `<details class="prep-event prep-reasoning" data-prep-detail="${esc(id)}" ${open}><summary>${icon('brain')}<span>思考过程</span><span class="prep-disclosure-hint">展开</span></summary><div class="prep-event-text">${esc(e.text)}</div></details>`
      if (e.type === 'tool-start') { const result = results.get(d.callId), failed = result?.data?.isError; return `<details class="prep-event prep-tool-event ${failed ? 'is-error' : ''}" data-prep-detail="${esc(id)}" ${open}><summary>${icon(result ? failed ? 'close' : 'check' : 'tool')}<span>${esc(toolLabel(d.name))}</span><small>${result ? failed ? '未完成' : '已返回' : running ? S.activeRun.status === 'cancelling' ? '停止中' : '执行中' : '已记录'}</small></summary>${d.input !== undefined ? `<h4>调用内容</h4><pre>${esc(json(d.input))}</pre>` : ''}${result ? `<h4>工具返回</h4><pre>${esc(json(result.data?.output ?? result.data?.result ?? result.data))}</pre>` : ''}</details>` }
      if (e.type === 'tool-result') return d.callId && started.has(d.callId) ? '' : `<details class="prep-event prep-tool-event" data-prep-detail="${esc(id)}" ${open}><summary>${icon('check')}<span>${esc(toolLabel(d.name))}已返回</span></summary><pre>${esc(json(d.output ?? d))}</pre></details>`
      if (e.type === 'artifact') { const a = run.artifacts.find((a) => a.id === d.id); return a ? artifactCard(a) : '' }
      if (e.type === 'proposal') return ''
      if (e.type === 'error') return `<div class="prep-event is-error">${esc(d.message || d.text || '任务未能完成，请稍后重试。')}</div>`
      return `<div class="prep-event prep-status-event">${icon(d.status === 'completed' ? 'check' : 'spark')}<span>${esc(d.message || STATUS[d.status] || '状态已更新')}</span></div>`
    }).join('')
  }
  function renderMessages() {
    if (!root) return
    const thread = root.querySelector('[data-prep-thread]')
    const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 100
    const existingOpen = new Set([...thread.querySelectorAll('details[data-prep-detail][open]')].map((el) => el.dataset.prepDetail))
    const focusedDetail = thread.contains(document.activeElement) ? document.activeElement.closest('[data-prep-detail]')?.dataset.prepDetail : null
    const rows = conversationRuns().map((run) => {
      const teachers = run.messages.filter((m) => m.role === 'user').map((m) => `<article class="prep-message is-user" data-prep-message="${esc(m.id)}"><div class="prep-message-avatar" aria-hidden="true">我</div><div class="prep-message-body"><span class="prep-message-by">你</span><div class="prep-message-text">${esc(m.content || '')}</div>${(m.attachmentIds || []).length ? `<div class="prep-message-files">${m.attachmentIds.map((id) => attachmentLink(id, S.attachments.find((a) => a.id === id)?.name)).join('')}</div>` : ''}</div></article>`).join('')
      const assistants = run.messages.filter((m) => m.role === 'assistant')
      const active = run.id === S.activeRun?.id && ACTIVE.has(S.activeRun.status)
      const events = renderRunEvents(run, existingOpen)
      const files = run.artifacts.filter((a) => !run.events.some((e) => e.type === 'artifact' && e.data?.id === a.id)).map(artifactCard).join('')
      const final = assistants.map((m) => `<div class="prep-final-response" data-prep-final="${esc(m.id)}"><div class="prep-message-text prep-markdown">${markdown(m.content || '')}</div>${(m.attachmentIds || []).map((id) => attachmentLink(id, S.attachments.find((a) => a.id === id)?.name)).join('')}</div>`).join('')
      const proposals = run.proposals.length ? `<div class="prep-run-proposals" data-prep-proposals>${run.proposals.map((p) => proposalCard(p, existingOpen)).join('')}</div>` : ''
      const assistant = events || files || final || proposals || active ? `<article class="prep-message is-assistant" data-prep-run="${esc(run.id)}" ${assistants.length ? `data-prep-message="${esc(assistants[0].id)}"` : active ? 'data-prep-stream' : ''}><div class="prep-message-avatar" aria-hidden="true">${icon('spark')}</div><div class="prep-message-body"><span class="prep-message-by">智能备课</span><div class="prep-run-events" data-prep-events>${events}</div>${proposals}${final}${files}${active ? `<div class="prep-live-status" role="status"><span class="prep-run-dot is-active"></span>${esc(STATUS[S.activeRun.status] || '正在备课')}<span class="prep-subtle">进展会在这里持续更新</span></div>` : ''}</div></article>` : ''
      return teachers + assistant
    }).join('')
    const html = S.loading ? '<div class="prep-loading" role="status">正在打开对话…</div>' : rows || emptyThread()
    if (thread._html !== html) {
      thread._html = html; thread.innerHTML = html
      if (focusedDetail) [...thread.querySelectorAll('[data-prep-detail]')].find((el) => el.dataset.prepDetail === focusedDetail)?.querySelector('summary')?.focus({ preventScroll: true })
      if (nearBottom) thread.scrollTop = thread.scrollHeight; else root.querySelector('[data-prep-action="jump"]').hidden = false
    }
    thread.setAttribute('aria-busy', String(S.loading))
  }
  function renderControls() {
    if (!root) return
    const run = S.activeRun, active = ACTIVE.has(run?.status), d = draft()
    const title = root.querySelector('[data-prep-title]'); title.textContent = S.session?.title || '开始一次新的备课'
    const status = root.querySelector('[data-prep-run-status]'); status.textContent = run ? STATUS[run.status] || '任务状态更新中' : '资料与对话仅对你可见'
    status.setAttribute('role', 'status')
    root.querySelector('[data-prep-chat-actions]').innerHTML = S.id ? `<button type="button" class="prep-icon-btn" data-prep-action="rename" aria-label="重命名当前对话">${icon('edit')}</button><button type="button" class="prep-icon-btn" data-prep-action="delete" aria-label="删除当前对话">${icon('trash')}</button>` : ''
    const send = root.querySelector('[data-prep-send]')
    send.disabled = !S.ready || S.status?.enabled !== true || S.loading || active || S.busy.has('send') || d.files.some((f) => f.status !== 'done') || !d.content.trim() && !d.files.length
    send.setAttribute('aria-busy', String(S.busy.has('send')))
    const cancelling = S.busy.has('cancel') || run?.status === 'cancelling'
    const cancel = root.querySelector('[data-prep-action="cancel"]'); cancel.hidden = !active; cancel.disabled = cancelling; cancel.setAttribute('aria-busy', String(cancelling)); cancel.innerHTML = `${icon('stop')}${cancelling ? '正在停止' : '停止'}`
    root.querySelector('#prep-message').disabled = !S.identityReady
    root.querySelector('[data-prep-action="attach"]').disabled = !S.ready || S.status?.enabled !== true || S.loading
    const create = root.querySelector('[data-prep-action="new"]'); create.disabled = !S.ready || S.busy.has('new'); create.setAttribute('aria-busy', String(S.busy.has('new')))
    const model = root.querySelector('[data-prep-model]'); model.textContent = S.status?.model || 'DeepSeek'
    const disabled = root.querySelector('[data-prep-disabled]'); disabled.hidden = !S.ready || S.status?.enabled === true; disabled.textContent = S.status?.message || '智能备课尚未启用，管理员配置模型与执行环境后即可使用。'
    root.querySelectorAll('[data-prep-panel]').forEach((b) => { const on = b.dataset.prepPanel === S.panel; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1 })
    root.dataset.panel = S.panel
    const count = S.attachments.filter((a) => a.kind === 'artifact').length
    const files = root.querySelector('[data-prep-action="files"]'); files.disabled = !S.identityReady || S.loading; files.setAttribute('aria-label', `查看已生成文件，当前对话 ${count} 个文件`)
    const badge = root.querySelector('[data-prep-file-count]'); badge.hidden = !count; badge.textContent = String(count)
    const fullscreen = root.classList.contains('is-fullscreen'), toggle = root.querySelector('[data-prep-action="fullscreen"]')
    toggle.setAttribute('aria-pressed', String(fullscreen)); toggle.setAttribute('aria-label', fullscreen ? '退出全屏' : '全屏工作台'); toggle.title = fullscreen ? '退出全屏（Esc）' : '全屏工作台'; toggle.innerHTML = icon(fullscreen ? 'collapse' : 'expand') + `<span>${fullscreen ? '退出全屏' : '全屏工作台'}</span>`
  }
  function renderQueue() {
    if (!root) return
    root.querySelector('[data-prep-queue]').innerHTML = draft().files.map((f) => `<div class="prep-upload ${f.status === 'failed' ? 'is-failed' : ''}" data-prep-upload="${esc(f.key)}">${f.preview ? `<img src="${esc(f.preview)}" alt="" loading="lazy">` : icon('file')}<div><strong>${esc(f.file.name || '图片')}</strong><span>${f.status === 'done' ? bytes(f.file.size) : f.status === 'failed' ? esc(f.error || '上传失败') : '正在上传…'}</span></div>${f.status === 'failed' ? `<button type="button" class="prep-icon-btn" data-prep-retry="${esc(f.key)}" aria-label="重新上传 ${esc(f.file.name)}">${icon('refresh')}</button>` : ''}<button type="button" class="prep-icon-btn" data-prep-remove="${esc(f.key)}" aria-label="移除 ${esc(f.file.name)}">${icon('close')}</button></div>`).join('')
    renderControls()
  }
  function previewHTML(value, depth = 0) {
    if (value == null || value === '') return '<span class="prep-subtle">未填写</span>'
    if (typeof value !== 'object') return `<span>${esc(value === true ? '是' : value === false ? '否' : value)}</span>`
    if (depth > 5) return `<pre>${esc(json(value))}</pre>`
    if (Array.isArray(value)) return `<ol class="prep-preview-list">${value.slice(0, 120).map((v) => `<li>${previewHTML(v, depth + 1)}</li>`).join('')}${value.length > 120 ? `<li>另有 ${value.length - 120} 项</li>` : ''}</ol>`
    return `<dl class="prep-preview-data">${Object.entries(value).filter(([k]) => !['id', 'classId', 'ownerId', 'memberId', 'assignmentId'].includes(k)).map(([k, v]) => `<div><dt>${esc(label(k))}</dt><dd>${previewHTML(v, depth + 1)}</dd></div>`).join('')}</dl>`
  }
  function filesDialog() { return modal?.classList.contains('prep-files-modal') ? modal : modalStack.find((entry) => entry.el.classList.contains('prep-files-modal'))?.el }
  function renderFilesDialog() {
    const el = filesDialog()
    if (!el) return
    const box = el.querySelector('[data-prep-artifacts]'), artifacts = S.attachments.filter((a) => a.kind === 'artifact')
    const html = artifacts.length ? `<p class="prep-file-help">当前对话共生成 ${artifacts.length} 个文件，点击下载保存到手机或电脑。</p>${artifacts.map(artifactCard).join('')}` : '<div class="prep-files-empty">' + icon('file') + '<h3>当前对话还没有生成文件</h3><p>生成完成后，文件会显示在这里，也会出现在备课对话中。</p></div>'
    if (box._html !== html) {
      const focus = box.contains(document.activeElement) ? { id: document.activeElement.closest('[data-prep-artifact]')?.dataset.prepArtifact, preview: document.activeElement.hasAttribute('data-prep-preview') } : null
      box._html = html; box.innerHTML = html
      if (focus) [...box.querySelectorAll('[data-prep-artifact]')].find((card) => card.dataset.prepArtifact === focus.id)?.querySelector(focus.preview ? '[data-prep-preview]' : 'a[download]')?.focus({ preventScroll: true })
    }
  }
  function showFiles() {
    if (!root || !S.identityReady || S.loading) return
    const el = showModal('已生成文件', `<p class="prep-subtle">当前对话：${esc(S.session?.title || '新的备课对话')}</p><div data-prep-artifacts></div>`, '<button type="button" class="prep-btn" data-dialog-cancel>关闭</button>')
    el.classList.add('prep-files-modal'); el.addEventListener('click', (e) => { const preview = e.target.closest('[data-prep-preview]'); if (preview) previewArtifact(preview.dataset.prepPreview) })
    el.querySelector('[data-dialog-cancel]').onclick = closeModal; renderFilesDialog()
  }
  function renderActivity() {
    if (!root) return
    renderMessages(); renderFilesDialog()
    const pollError = root.querySelector('[data-prep-poll-error]'); pollError.hidden = !S.pollError; pollError.textContent = S.pollError
  }
  function renderAll() { renderSessions(); renderActivity(); renderQueue(); renderControls() }
  function applyDetail(data) {
    S.hasMore = !!data.hasMore
    if (data.session) S.session = data.session
    for (const key of ['messages', 'attachments', 'proposals']) if (Array.isArray(data[key])) S[key] = data[key]
    if (Object.hasOwn(data, 'activeRun')) S.activeRun = data.activeRun
    if (Array.isArray(data.events)) {
      const map = new Map(S.events.map((e) => [String(e.id), e]))
      for (const event of data.events) { const e = { ...event, data: typeof event.data === 'string' ? (() => { try { return JSON.parse(event.data) } catch { return { text: event.data } } })() : event.data || {} }; map.set(String(e.id), e); S.after = Math.max(S.after, Number(e.id) || 0) }
      S.events = [...map.values()].sort((a, b) => Number(a.id) - Number(b.id))
    }
  }
  async function loadSessions() { const page = epoch; try { const data = await api('/sessions'); if (root && epoch === page) { S.sessions = data.sessions || []; renderSessions() } } catch (e) { if (root && epoch === page) error(e.message) } }
  async function openSession(id = '') {
    const page = ++epoch
    clearTimeout(timer); timer = 0; polling = false; closeModals()
    S.id = id; S.session = null; S.messages = []; S.events = []; S.attachments = []; S.proposals = []; S.activeRun = null; S.after = 0; S.hasMore = false; S.error = ''; S.pollError = ''; S.loading = !!id; S.panel = 'chat'; creation = null
    root.querySelector('#prep-message').value = draft().content
    error(''); renderAll()
    if (!id) return
    try { const data = await api(`/sessions/${encodeURIComponent(id)}`); if (!current(page, id)) return; applyDetail(data) }
    catch (e) { if (current(page, id)) error(e.message) }
    finally { if (current(page, id)) { S.loading = false; renderAll(); schedulePoll() } }
  }
  async function refreshDetail() { const page = epoch, id = S.id; if (!id) return; const data = await api(`/sessions/${encodeURIComponent(id)}`); if (current(page, id)) { applyDetail(data); S.pollError = ''; renderAll(); schedulePoll() } }
  function schedulePoll(delay = 1000) { clearTimeout(timer); if (root && S.id && (S.hasMore || ACTIVE.has(S.activeRun?.status))) timer = setTimeout(poll, S.hasMore ? 50 : document.hidden ? Math.max(4000, delay) : delay) }
  async function poll() {
    if (polling || !root || !S.id) return
    const page = epoch, id = S.id
    polling = true
    let retry = 1000
    try { const data = await api(`/sessions/${encodeURIComponent(id)}/events?after=${S.after}`); if (!current(page, id)) return; const oldStatus = S.activeRun?.status; applyDetail(data); S.pollError = ''; renderActivity(); renderControls(); if (oldStatus !== S.activeRun?.status) loadSessions() }
    catch (e) { if (current(page, id)) { S.pollError = `状态暂未同步：${e.message}。正在重试，任务会在后台继续。`; renderActivity(); retry = 4000 } }
    finally { if (current(page, id)) { polling = false; schedulePoll(retry) } }
  }
  async function navigate(id) { if (ctx.router) await ctx.router.push(id ? `/prep/${encodeURIComponent(id)}` : '/prep'); else await openSession(id) }
  async function ensureSession() {
    if (S.id) return S.id
    if (creation) return creation
    const page = epoch
    creation = (async () => {
      const data = await api('/sessions', { method: 'POST', body: {} })
      if (!root || epoch !== page) throw new Error('页面已切换，请重新选择对话')
      const previousDraft = draft()
      drafts.set(data.session.id, previousDraft); drafts.delete('new')
      S.id = data.session.id; S.session = data.session
      S.sessions = [data.session, ...S.sessions.filter((s) => s.id !== data.session.id)]
      // Replace the URL without remounting: pending uploads belong to this page.
      if (ctx.router) await ctx.router.replace({ path: `/prep/${encodeURIComponent(S.id)}`, state: { prepCreated: true } })
      renderSessions(); renderControls()
      return S.id
    })().finally(() => { creation = null })
    return creation
  }
  async function newSession() {
    if (S.busy.has('new')) return
    const page = epoch
    S.busy.add('new'); renderControls()
    try { const data = await api('/sessions', { method: 'POST', body: {} }); if (!root || page !== epoch) return; S.sessions = [data.session, ...S.sessions]; await navigate(data.session.id); root?.querySelector('#prep-message')?.focus() }
    catch (e) { if (page === epoch) error(e.message) } finally { S.busy.delete('new'); renderControls() }
  }
  async function addFiles(files) {
    if (!root || !S.ready || S.status?.enabled !== true) return
    const d = draft(), limit = Number(S.status?.limits?.maxFileBytes || S.status?.limits?.fileBytes || 25 * 1024 * 1024)
    const maxFiles = Number(S.status?.limits?.maxAttachments || 10)
    for (const file of [...files]) {
      if (!file || !file.name && !file.type) continue
      if (d.files.length >= maxFiles) { error(`每次最多添加 ${maxFiles} 个附件`); break }
      if (file.size > limit) { error(`${file.name || '文件'}超过单文件 ${bytes(limit)} 的上限`); continue }
      if (/\.(zip|rar|7z|tar|gz)$/i.test(file.name)) { error('暂不支持压缩包，请直接上传其中的文档或图片'); continue }
      const item = { key: crypto.randomUUID(), file, status: 'pending', error: '', id: null, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '' }
      d.files.push(item); upload(item, d)
    }
    renderQueue()
  }
  async function upload(item, ownerDraft) {
    if (!ownerDraft.files.includes(item) || item.status === 'uploading') return
    item.status = 'uploading'; item.error = ''; renderQueue()
    const controller = new AbortController(); transfers.set(item.key, controller)
    try {
      const id = await ensureSession()
      if (!ownerDraft.files.includes(item)) return
      const data = await api(`/sessions/${encodeURIComponent(id)}/attachments?filename=${encodeURIComponent(item.file.name || '粘贴图片.png')}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: item.file, signal: controller.signal })
      item.id = data.attachment.id; item.status = 'done'
      if (S.id === id) S.attachments = [...S.attachments.filter((a) => a.id !== item.id), data.attachment]
    } catch (e) { if (ownerDraft.files.includes(item)) { item.status = 'failed'; item.error = e.name === 'AbortError' ? '上传已停止，可重新上传' : e.message } }
    finally { transfers.delete(item.key); if (root && draft() === ownerDraft) renderQueue() }
  }
  async function send() {
    if (root.querySelector('[data-prep-send]').disabled) return
    const d = draft(), text = d.content.trim(), ids = d.files.map((f) => f.id)
    S.busy.add('send'); error(''); renderControls()
    try {
      const id = await ensureSession(), page = epoch
      await api(`/sessions/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { content: text, attachmentIds: ids } })
      d.content = ''; d.files.forEach((f) => { if (f.preview) URL.revokeObjectURL(f.preview) }); d.files = []
      if (!current(page, id)) return
      root.querySelector('#prep-message').value = ''; await refreshDetail(); await loadSessions(); root.querySelector('#prep-message').focus()
    } catch (e) { error(e.message) }
    finally { S.busy.delete('send'); if (root) renderQueue() }
  }
  async function cancelRun() {
    const run = S.activeRun, id = S.id, page = epoch
    if (!run || run.status === 'cancelling' || S.busy.has('cancel')) return
    S.busy.add('cancel'); renderControls()
    try { await api(`/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: { runId: run.id } }); if (S.id === id) await refreshDetail() }
    catch (e) { if (epoch === page) error(e.message) } finally { S.busy.delete('cancel'); renderControls() }
  }
  async function proposalAction(id, action) {
    const p = S.proposals.find((v) => v.id === id), page = epoch
    if (!p || p.status !== 'pending' || S.busy.has(`proposal:${id}`)) return
    S.busy.add(`proposal:${id}`); renderActivity()
    try { await api(`/proposals/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: action === 'confirm' ? { version: p.version } : {} }); if (root && page === epoch) { await refreshDetail(); root.querySelector(`[data-prep-proposal-title="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }) } }
    catch (e) { if (page !== epoch) return; if (e.status === 409) { await refreshDetail().catch(() => {}); error('预览已更新，请重新核对最新内容后确认') } else error(e.message) }
    finally { S.busy.delete(`proposal:${id}`); if (page === epoch) renderActivity() }
  }
  function closeModal() {
    if (!modal) return
    const old = modal, focus = returnFocus; modal = null; old.close?.(); old.remove()
    const previous = modalStack.pop()
    if (previous) { modal = previous.el; returnFocus = previous.returnFocus }
    else returnFocus = null
    if (focus?.isConnected) focus.focus({ preventScroll: true })
    else if (previous?.focusedFile) [...modal.querySelectorAll('[data-prep-preview]')].find((button) => button.dataset.prepPreview === previous.focusedFile)?.focus({ preventScroll: true })
  }
  function closeModals() { while (modal) closeModal() }
  function showModal(title, body, footer = '', stack = false) {
    if (stack && modal) { modalStack.push({ el: modal, returnFocus, focusedFile: document.activeElement?.dataset.prepPreview }); modal = null }
    else closeModals()
    returnFocus = document.activeElement
    const titleId = `prep-modal-title-${++editorSerial}`
    const el = document.createElement('dialog'); el.className = 'prep-modal'; el.setAttribute('aria-labelledby', titleId)
    el.innerHTML = `<form method="dialog" class="prep-modal-head"><h2 id="${titleId}">${esc(title)}</h2><button class="prep-icon-btn" aria-label="关闭" value="cancel">${icon('close')}</button></form><div class="prep-modal-body">${body}</div><div class="prep-modal-error" role="alert" hidden></div>${footer ? `<footer class="prep-modal-foot">${footer}</footer>` : ''}`
    document.body.append(el); modal = el
    el.addEventListener('close', () => { if (modal === el) closeModal() }); el.addEventListener('click', (e) => { if (e.target === el) { const r = el.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal() } })
    el.showModal(); (el.querySelector('[data-autofocus]') || el.querySelector('button'))?.focus()
    return el
  }
  const modalError = (el, text) => { const box = el.querySelector('.prep-modal-error'); box.hidden = !text; box.textContent = text }
  function sandboxHTML(text) {
    const doc = new DOMParser().parseFromString(text, 'text/html')
    // Resource hints can initiate speculative requests outside normal fetch
    // directives. A self-contained preview does not need links, bases or refresh.
    doc.querySelectorAll('link,base,meta[http-equiv],meta[name]').forEach((el) => {
      const equiv = (el.getAttribute('http-equiv') || '').trim().toLowerCase(), name = (el.getAttribute('name') || '').trim().toLowerCase()
      if (el.matches('link,base') || ['content-security-policy', 'content-security-policy-report-only', 'refresh'].includes(equiv) || name === 'referrer') el.remove()
    })
    const policy = doc.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy'; policy.content = HTML_PREVIEW_CSP; doc.head.prepend(policy)
    const referrer = doc.createElement('meta'); referrer.name = 'referrer'; referrer.content = 'no-referrer'; policy.after(referrer)
    const safe = '<!doctype html>\n' + doc.documentElement.outerHTML
    // A second opaque frame gives the untrusted document an immutable parent
    // frame-src policy. Its own location/refresh navigations are then blocked,
    // whereas connect-src alone would only constrain fetch and subresources.
    const wrapper = new DOMParser().parseFromString('<!doctype html><html><head></head><body></body></html>', 'text/html')
    const wrapperPolicy = wrapper.createElement('meta'); wrapperPolicy.httpEquiv = 'Content-Security-Policy'; wrapperPolicy.content = HTML_PREVIEW_CSP + '; frame-src about:'; wrapper.head.append(wrapperPolicy)
    const style = wrapper.createElement('style'); style.textContent = 'html,body{height:100%;margin:0;background:#fff}iframe{display:block;width:100%;height:100%;border:0}'; wrapper.head.append(style)
    const code = wrapper.createElement('script')
    // Escape < in the JSON literal so a model-provided </script> never closes
    // this trusted wrapper's script. Assign srcdoc as a property, not markup.
    code.textContent = `const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.referrerPolicy='no-referrer';frame.title='互动网页内容';frame.srcdoc=${JSON.stringify(safe).replace(/</g, '\\u003c')};document.body.append(frame);`
    wrapper.body.append(code)
    return '<!doctype html>\n' + wrapper.documentElement.outerHTML
  }
  async function previewArtifact(id) {
    const file = S.attachments.find((a) => a.id === id && a.kind === 'artifact' && String(a.mime).split(';')[0].trim().toLowerCase() === 'text/html')
    if (!file) return
    const page = epoch, controller = new AbortController()
    const el = showModal(file.name || '互动网页预览', '<p class="prep-subtle">预览仅运行自包含 HTML，外部资源和联网访问已禁止。需要完整文件时仍可下载。</p><p class="prep-subtle" data-prep-preview-loading role="status">正在加载预览…</p><div class="prep-preview-frame-host" data-prep-preview-host hidden></div>', `<a class="prep-btn" href="${API}/attachments/${encodeURIComponent(file.id)}" download>${icon('download')}下载文件</a><button type="button" class="prep-btn" data-dialog-cancel>关闭预览</button>`, modal?.classList.contains('prep-files-modal'))
    el.classList.add('prep-preview-modal')
    el.addEventListener('close', () => controller.abort(), { once: true }); el.addEventListener('cancel', () => controller.abort(), { once: true })
    el.querySelector('[data-dialog-cancel]').onclick = closeModal
    try {
      if (file.size > HTML_PREVIEW_LIMIT) throw new Error('网页超过 2 MB，无法在线预览，请下载后查看')
      const response = await fetch(`${API}/attachments/${encodeURIComponent(file.id)}`, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      if (!response.ok) throw new Error('预览加载失败，请关闭后重试；也可直接下载文件')
      if (Number(response.headers.get('content-length')) > HTML_PREVIEW_LIMIT) { await response.body?.cancel(); throw new Error('网页超过 2 MB，请下载后查看') }
      const parts = []; let total = 0
      if (!response.body) throw new Error('文件内容不可用，请下载后查看')
      const reader = response.body.getReader()
      try { while (true) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > HTML_PREVIEW_LIMIT) { await reader.cancel(); throw new Error('网页超过 2 MB，请下载后查看') } parts.push(value) } }
      finally { reader.releaseLock() }
      if (modal !== el || page !== epoch || controller.signal.aborted) return
      const content = new Uint8Array(total); let offset = 0; for (const part of parts) { content.set(part, offset); offset += part.byteLength }
      const frame = document.createElement('iframe'); frame.className = 'prep-preview-frame'; frame.title = file.name || '互动网页预览'; frame.setAttribute('sandbox', 'allow-scripts'); frame.referrerPolicy = 'no-referrer'; frame.srcdoc = sandboxHTML(new TextDecoder().decode(content))
      const host = el.querySelector('[data-prep-preview-host]'); host.append(frame); host.hidden = false
    } catch (e) { if (modal === el && page === epoch && !controller.signal.aborted) modalError(el, e.message || '预览加载失败，请下载后查看') }
    finally { if (modal === el) el.querySelector('[data-prep-preview-loading]').hidden = true }
  }
  function manageSession(remove = false) {
    if (!S.session) return
    const session = S.session, page = epoch
    const el = showModal(remove ? '删除这段对话？' : '重命名对话', remove ? '<p>对话历史、上传的附件和生成文件将一起删除。请先停止进行中的任务，等待停止完成后再删除。</p>' : `<label class="prep-label" for="prep-session-name">对话名称</label><input class="prep-field" id="prep-session-name" maxlength="100" value="${esc(session.title)}" data-autofocus>`, `<button type="button" class="prep-btn" data-dialog-cancel>取消</button><button type="button" class="prep-btn ${remove ? 'prep-danger' : 'prep-primary'}" data-dialog-submit>${remove ? '删除对话' : '保存名称'}</button>`)
    el.querySelector('[data-dialog-cancel]').onclick = closeModal
    el.querySelector('[data-dialog-submit]').onclick = async (e) => {
      const button = e.currentTarget; button.disabled = true; button.setAttribute('aria-busy', 'true')
      try {
        const title = el.querySelector('input')?.value.trim()
        if (!remove && !title) throw new Error('请填写对话名称')
        await api(`/sessions/${encodeURIComponent(session.id)}`, { method: remove ? 'DELETE' : 'PATCH', body: remove ? undefined : { title } })
        if (modal !== el || page !== epoch) return
        closeModal(); if (remove) { const d = drafts.get(session.id); d?.files.forEach((f) => { transfers.get(f.key)?.abort(); if (f.preview) URL.revokeObjectURL(f.preview) }); drafts.delete(session.id); await navigate('') } else await refreshDetail()
        await loadSessions()
      } catch (err) { if (modal === el) { modalError(el, err.message); button.disabled = false; button.removeAttribute('aria-busy') } }
    }
  }
  function editorHTML(value, path = [], depth = 0) {
    const key = String(path[path.length - 1] || ''), attr = esc(JSON.stringify(path)), name = esc(label(key))
    if (depth > 6) return `<p class="prep-subtle">此部分结构较深，请在对话中说明修改要求。</p>`
    if (Array.isArray(value)) return `<fieldset class="prep-edit-group"><legend>${name || '条目'}</legend>${value.map((v, i) => `<div class="prep-edit-row"><div>${editorHTML(v, [...path, i], depth + 1)}</div><button type="button" class="prep-icon-btn" data-editor-remove="${attr}" data-editor-index="${i}" aria-label="删除第 ${i + 1} 项">${icon('trash')}</button></div>`).join('')}<button type="button" class="prep-btn" data-editor-add="${attr}">${icon('plus')}添加一项</button></fieldset>`
    if (value && typeof value === 'object') return `<div class="prep-edit-object">${Object.entries(value).map(([k, v]) => editorHTML(v, [...path, k], depth + 1)).join('')}</div>`
    const fieldId = `prep-edit-${++editorSerial}`
    if (typeof value === 'boolean') return `<label class="prep-checkbox" for="${fieldId}"><input id="${fieldId}" type="checkbox" data-editor-path="${attr}" data-editor-type="boolean" ${value ? 'checked' : ''}>${name}</label>`
    const isNumber = typeof value === 'number' || value === null && ['score', 'points', 'answer'].includes(key)
    const readonly = ['id', 'classId', 'assignmentId', 'memberId', 'ownerId'].includes(key)
    return `<label class="prep-label" for="${fieldId}">${typeof path[path.length - 1] === 'number' ? `第 ${Number(key) + 1} 项` : name}</label>${['stem', 'description', 'instructions', 'explanation', 'text'].includes(key) ? `<textarea class="prep-field" id="${fieldId}" rows="3" data-editor-path="${attr}" data-editor-type="text">${esc(value ?? '')}</textarea>` : `<input class="prep-field" id="${fieldId}" type="${isNumber ? 'number' : 'text'}" ${readonly ? 'readonly' : ''} value="${esc(value ?? '')}" data-editor-path="${attr}" data-editor-type="${isNumber ? 'number' : value === null ? 'nullable' : 'text'}">`}`
  }
  function editProposal(id) {
    const proposal = S.proposals.find((p) => p.id === id)
    if (!proposal || proposal.status !== 'pending') return
    const payload = JSON.parse(JSON.stringify(proposal.payload)), version = proposal.version
    const el = showModal('编辑待确认内容', `<p class="prep-subtle">保存后会重新校验并生成预览，核对后再确认执行。识别不清的信息请留空或在对话中补充。</p><div data-prep-editor>${editorHTML(payload)}</div>`, '<button type="button" class="prep-btn" data-dialog-cancel>取消</button><button type="button" class="prep-btn prep-primary" data-dialog-submit>保存并重新预览</button>')
    const at = (path) => path.reduce((v, k) => v[k], payload)
    const bind = () => {
      el.querySelectorAll('[data-editor-path]').forEach((field) => { field.oninput = () => { const path = JSON.parse(field.dataset.editorPath), key = path.pop(), parent = at(path); parent[key] = field.dataset.editorType === 'boolean' ? field.checked : field.dataset.editorType === 'number' ? field.value === '' ? null : Number(field.value) : field.dataset.editorType === 'nullable' && field.value === '' ? null : field.value } })
      el.querySelectorAll('[data-editor-remove]').forEach((b) => { b.onclick = () => { at(JSON.parse(b.dataset.editorRemove)).splice(Number(b.dataset.editorIndex), 1); repaint() } })
      el.querySelectorAll('[data-editor-add]').forEach((b) => { b.onclick = () => { const path = JSON.parse(b.dataset.editorAdd), arr = at(path), key = path[path.length - 1]; const templates = { members: { name: '', studentNo: null, gender: null, score: null }, operations: { action: 'add', name: '', studentNo: null, gender: null, score: null }, groups: { name: `第 ${arr.length + 1} 组`, memberIds: [] }, questions: { id: crypto.randomUUID(), type: 'single', stem: '', options: ['', ''], answer: 0, points: 1, explanation: '' } }; arr.push(templates[key] || (typeof arr[0] === 'object' && arr[0] ? JSON.parse(JSON.stringify(arr[0])) : '')); repaint() } })
    }
    const repaint = () => { el.querySelector('[data-prep-editor]').innerHTML = editorHTML(payload); bind() }
    bind(); el.querySelector('[data-dialog-cancel]').onclick = closeModal
    el.querySelector('[data-dialog-submit]').onclick = async (event) => {
      const button = event.currentTarget; button.disabled = true; button.setAttribute('aria-busy', 'true')
      try { await api(`/proposals/${encodeURIComponent(id)}`, { method: 'PATCH', body: { payload, version } }); if (modal !== el) return; closeModal(); await refreshDetail(); toast('已更新预览，请核对后确认执行') }
      catch (e) { if (modal === el) { modalError(el, e.status === 409 ? '提案已在其他页面更新。请关闭后重新打开，核对最新内容。' : e.message); button.disabled = false; button.removeAttribute('aria-busy') } }
    }
  }
  async function manageSkills() {
    const page = epoch
    try { const data = await api('/skills'); if (!root || page !== epoch) return; S.skills = data.skills || []; S.skillsLoaded = true }
    catch (e) { error(e.message); return }
    const el = showModal('我的 Skills', `<p class="prep-subtle">为自己的备课 Agent 添加技能说明。技能仅属于你的账号；MCP 由管理员配置。</p><div data-prep-skills></div><hr><h3>添加技能</h3><label class="prep-label" for="prep-skill-name">技能名称</label><input class="prep-field" id="prep-skill-name" maxlength="80" placeholder="例如：项目式学习教案"><label class="prep-label" for="prep-skill-content">SKILL.md 内容</label><textarea class="prep-field prep-skill-content" id="prep-skill-content" rows="8" placeholder="粘贴技能说明，或选择一份 SKILL.md 文件"></textarea><label class="prep-btn prep-skill-pick">${icon('paperclip')}选择 SKILL.md<input type="file" accept=".md,.txt,text/markdown,text/plain" data-prep-skill-file hidden></label>`, '<button type="button" class="prep-btn" data-dialog-cancel>关闭</button><button type="button" class="prep-btn prep-primary" data-dialog-submit>保存技能</button>')
    const paint = () => {
      el.querySelector('[data-prep-skills]').innerHTML = S.skills.length ? S.skills.map((skill) => `<div class="prep-skill-row"><div><strong>${esc(skill.name)}</strong><span>${esc((skill.content || '').slice(0, 100))}</span></div><button type="button" class="prep-icon-btn" data-skill-delete="${esc(skill.id)}" aria-label="删除技能 ${esc(skill.name)}">${icon('trash')}</button></div>`).join('') : '<p class="prep-empty-small">还没有个人技能。</p>'
      el.querySelectorAll('[data-skill-delete]').forEach((b) => { b.onclick = async () => { b.disabled = true; try { await api(`/skills/${encodeURIComponent(b.dataset.skillDelete)}`, { method: 'DELETE' }); if (modal !== el) return; S.skills = S.skills.filter((s) => s.id !== b.dataset.skillDelete); paint() } catch (e) { if (modal === el) { modalError(el, e.message); b.disabled = false } } } })
    }
    paint(); el.querySelector('[data-dialog-cancel]').onclick = closeModal
    el.querySelector('[data-prep-skill-file]').onchange = async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; if (file.size > 128 * 1024) return modalError(el, '技能说明最多 128 KB'); try { const text = await file.text(); if (modal !== el) return; el.querySelector('#prep-skill-content').value = text; if (!el.querySelector('#prep-skill-name').value) el.querySelector('#prep-skill-name').value = file.name.replace(/\.(md|txt)$/i, '') } catch { modalError(el, '文件读取失败，请重新选择') } }
    el.querySelector('[data-dialog-submit]').onclick = async (e) => { const button = e.currentTarget, name = el.querySelector('#prep-skill-name').value.trim(), content = el.querySelector('#prep-skill-content').value; if (!name || !content.trim()) return modalError(el, '请填写技能名称和说明内容'); button.disabled = true; button.setAttribute('aria-busy', 'true'); try { const data = await api('/skills', { method: 'POST', body: { name, content } }); if (modal !== el) return; S.skills = [data.skill || { id: data.id, name, content }, ...S.skills]; paint(); el.querySelector('#prep-skill-name').value = ''; el.querySelector('#prep-skill-content').value = ''; modalError(el, '') } catch (err) { if (modal === el) modalError(el, err.message) } finally { if (modal === el) { button.disabled = false; button.removeAttribute('aria-busy') } } }
  }
  function onClick(e) {
    const target = e.target instanceof Element ? e.target : null
    if (!target) return
    const action = target.closest('[data-prep-action]')?.dataset.prepAction
    if (action === 'new') newSession()
    else if (action === 'attach') root.querySelector('[data-prep-files]').click()
    else if (action === 'cancel') cancelRun()
    else if (action === 'rename') manageSession()
    else if (action === 'delete') manageSession(true)
    else if (action === 'skills') manageSkills()
    else if (action === 'files') showFiles()
    else if (action === 'fullscreen') toggleFullscreen()
    else if (action === 'dismiss-error') error('')
    else if (action === 'refresh') refreshDetail().catch((err) => error(err.message))
    else if (action === 'jump') { const thread = root.querySelector('[data-prep-thread]'); thread.scrollTop = thread.scrollHeight; root.querySelector('[data-prep-action="jump"]').hidden = true }
    const panel = target.closest('[data-prep-panel]')
    if (panel) { S.panel = panel.dataset.prepPanel; renderControls() }
    const prompt = target.closest('[data-prep-prompt]')
    if (prompt) { draft().content = prompt.dataset.prepPrompt; root.querySelector('#prep-message').value = draft().content; root.querySelector('#prep-message').focus(); renderControls() }
    const remove = target.closest('[data-prep-remove]')
    if (remove) { const d = draft(), item = d.files.find((f) => f.key === remove.dataset.prepRemove); if (item) { transfers.get(item.key)?.abort(); if (item.preview) URL.revokeObjectURL(item.preview); d.files = d.files.filter((f) => f !== item); renderQueue() } }
    const retry = target.closest('[data-prep-retry]')
    if (retry) { const d = draft(), item = d.files.find((f) => f.key === retry.dataset.prepRetry); if (item) upload(item, d) }
    const confirm = target.closest('[data-prep-confirm]'); if (confirm) proposalAction(confirm.dataset.prepConfirm, 'confirm')
    const reject = target.closest('[data-prep-reject]'); if (reject) proposalAction(reject.dataset.prepReject, 'reject')
    const edit = target.closest('[data-prep-edit]'); if (edit) editProposal(edit.dataset.prepEdit)
    const preview = target.closest('[data-prep-preview]'); if (preview) previewArtifact(preview.dataset.prepPreview)
  }
  function toggleFullscreen(force, update = true) {
    if (!root) return
    const on = force ?? !root.classList.contains('is-fullscreen')
    if (on === root.classList.contains('is-fullscreen')) return
    if (on) {
      fullscreenSlot = document.createComment('prep-workspace'); root.before(fullscreenSlot); document.body.append(root)
      fullscreenOverflow = document.documentElement.style.overflow; document.documentElement.style.overflow = 'hidden'
      fullscreenBackground = [...document.body.children].filter((el) => el !== root && !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName)).map((el) => ({ el, inert: el.inert }))
      fullscreenBackground.forEach(({ el }) => { el.inert = true }); root.classList.add('is-fullscreen')
    } else {
      root.classList.remove('is-fullscreen'); if (fullscreenSlot?.isConnected) fullscreenSlot.replaceWith(root); fullscreenSlot?.remove(); fullscreenSlot = null
      document.documentElement.style.overflow = fullscreenOverflow; fullscreenBackground.forEach(({ el, inert }) => { el.inert = inert }); fullscreenBackground = []
    }
    if (update) { renderControls(); root.querySelector('[data-prep-action="fullscreen"]')?.focus({ preventScroll: true }) }
  }
  function onWorkspaceKey(e) { if (e.key === 'Escape' && !e.defaultPrevented && !modal && root?.classList.contains('is-fullscreen')) { e.preventDefault(); toggleFullscreen(false) } }
  function onKey(e) {
    if (e.target.id === 'prep-message' && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); send() }
    if (e.target.matches('[data-prep-panel]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const buttons = [...root.querySelectorAll('[data-prep-panel]')], i = buttons.indexOf(e.target); const n = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length; buttons[n].click(); buttons[n].focus() }
  }
  function mountPage(vm, id = '') {
    unmountPage(); ensureStyle(); S = blank()
    const host = vm.$el?.parentNode || document.querySelector('main') || document.body
    root = document.createElement('div'); root.className = 'prep-page'; root.dataset.prepRoot = ''; root.innerHTML = shell()
    if (vm.$el?.parentNode === host) host.insertBefore(root, vm.$el); else host.append(root)
    root.addEventListener('click', onClick); root.addEventListener('keydown', onKey); document.addEventListener('keydown', onWorkspaceKey)
    root.addEventListener('input', (e) => { if (e.target.id === 'prep-message') { draft().content = e.target.value; renderControls() } })
    root.querySelector('[data-prep-form]').onsubmit = (e) => { e.preventDefault(); send() }
    root.querySelector('[data-prep-files]').onchange = (e) => { addFiles(e.target.files || []); e.target.value = '' }
    root.addEventListener('paste', (e) => { const files = e.clipboardData?.files; if (files?.length) { e.preventDefault(); addFiles(files) } })
    let drag = 0
    root.addEventListener('dragenter', (e) => { if ([...e.dataTransfer?.types || []].includes('Files')) { e.preventDefault(); drag++; root.classList.add('is-dragging') } })
    root.addEventListener('dragover', (e) => { if ([...e.dataTransfer?.types || []].includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } })
    root.addEventListener('dragleave', () => { drag = Math.max(0, drag - 1); if (!drag) root.classList.remove('is-dragging') })
    root.addEventListener('drop', (e) => { if (!e.dataTransfer?.files.length) return; e.preventDefault(); drag = 0; root.classList.remove('is-dragging'); addFiles(e.dataTransfer.files) })
    openSession(id)
    const mountedRoot = root
    Promise.all([api('/status'), api('/sessions')]).then(([status, data]) => {
      if (root !== mountedRoot) return
      if (draftOwner && (!status.userId || draftOwner !== status.userId)) clearDrafts()
      draftOwner = status.userId || null
      S.identityReady = true
      S.status = status; S.sessions = data.sessions || []; S.ready = true; root.querySelector('#prep-message').value = draft().content; renderAll()
    }).catch((e) => { if (root !== mountedRoot) return; clearDrafts(); draftOwner = null; root.querySelector('#prep-message').value = ''; S.ready = true; S.status = { enabled: false, message: e.message }; error(e.message); renderAll() })
  }
  function unmountPage() { epoch++; clearTimeout(timer); timer = 0; polling = false; creation = null; closeModals(); toggleFullscreen(false, false); document.removeEventListener('keydown', onWorkspaceKey); for (const controller of transfers.values()) controller.abort(); transfers.clear(); root?.remove(); root = null }
  const Component = { name: 'LessonPrepStudio', mounted() { mountPage(this, String(this.$route.params.sessionId || '')) }, beforeRouteUpdate(to) { const id = String(to.params.sessionId || ''); if (id !== S.id) openSession(id) }, beforeUnmount: unmountPage, render() { return null } }
  function ensureStyle() { if (document.getElementById('prep-studio-style')) return; const style = document.createElement('style'); style.id = 'prep-studio-style'; style.textContent = CSS_TEXT; document.head.append(style) }
  function navActive() { document.querySelectorAll('[data-prep-nav]').forEach((a) => { const active = /^#\/prep(?:\/|$|\?)/.test(location.hash); a.classList.toggle('is-active', active); if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current') }) }
  function injectNav() {
    const nav = document.querySelector('header.aiq-navbar nav')
    if (nav && !nav.querySelector('[data-prep-nav]')) { const a = document.createElement('a'); a.href = '#/prep'; a.className = 'nav-item rounded-xl px-3.5 py-2 text-[14px] font-medium prep-nav'; a.dataset.prepNav = ''; a.textContent = '智能备课'; const before = nav.querySelector('a[href="#/teach"]'); nav.insertBefore(a, before || null) }
    const drawer = document.querySelector('header.aiq-navbar .el-drawer__body')
    if (drawer && !drawer.querySelector('[data-prep-nav]')) { const a = document.createElement('a'); a.href = '#/prep'; a.className = 'prep-drawer-nav'; a.dataset.prepNav = ''; a.innerHTML = `${icon('spark')}智能备课`; a.onclick = () => { const close = document.querySelector('header.aiq-navbar .el-drawer__close-btn'); close?.click() }; const list = drawer.querySelector('a')?.parentElement || drawer; list.append(a) }
    navActive()
  }
  async function boot() {
    await Promise.resolve()
    const start = Date.now()
    let app
    while (!(app = document.querySelector('#app')?.__vue_app__) && Date.now() - start < 20000) await new Promise((resolve) => setTimeout(resolve, 100))
    const router = app?.config?.globalProperties?.$router
    if (!router) return
    ctx.router = router; ensureStyle()
    for (const name of ['prep', 'prep-session']) if (router.hasRoute(name)) router.removeRoute(name)
    router.addRoute({ path: '/prep', name: 'prep', component: Component, meta: { title: '智能备课', requiresAuth: true } })
    router.addRoute({ path: '/prep/:sessionId', name: 'prep-session', component: Component, meta: { title: '智能备课', requiresAuth: true } })
    injectNav()
    let frame = 0
    navObserver = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; injectNav() }) })
    const header = document.querySelector('header.aiq-navbar'); if (header) navObserver.observe(header, { childList: true, subtree: true })
    window.addEventListener('hashchange', navActive)
    await router.isReady().catch(() => {})
    const raw = INITIAL_HASH.replace(/^#/, ''), [path, query] = raw.split('?')
    if (/^\/prep(?:\/[^/]+)?$/.test(path)) { const cur = router.currentRoute.value; if (cur.path !== path || !cur.matched.some((r) => r.components?.default === Component)) await router.replace({ path, query: Object.fromEntries(new URLSearchParams(query || '')), force: true }).catch(() => {}) }
  }
  boot().catch((e) => console.warn('[prep-studio] 页面初始化失败', e))
  const CSS_TEXT = `
.prep-page,.prep-modal{--prep-text:var(--aiq-text,#1f2937);--prep-muted:var(--aiq-text-mute,#64748b);--prep-soft-text:var(--aiq-text-soft,#475569);--prep-card:var(--aiq-panel-solid,#fff);--prep-soft:var(--aiq-bg-soft,#f3f5fc);--prep-border:var(--aiq-border,#e4e8f2);--prep-accent:var(--aiq-accent,#3559f6);--prep-error:#b91c1c;color:var(--prep-text);font-family:inherit}
.prep-page *,.prep-modal *,.prep-modal{box-sizing:border-box}.prep-page{min-width:0;padding:28px 20px 48px}.prep-wrap{max-width:1600px;margin:auto;position:relative}.prep-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.prep-eyebrow{display:flex;align-items:center;gap:6px;color:var(--prep-accent);font-size:12px;font-weight:650;margin-bottom:9px}.prep-heading h1{margin:0;font-size:27px;line-height:1.3;letter-spacing:-.02em;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.prep-heading p{margin:8px 0 0;font-size:14px;color:var(--prep-muted);line-height:1.65}.prep-model{font-size:11px;font-weight:500;letter-spacing:0;border:1px solid var(--prep-border);border-radius:20px;padding:4px 9px;color:var(--prep-muted);background:var(--prep-card)}.prep-icon{display:inline-block;width:18px;height:18px;flex:none;vertical-align:middle}.prep-btn,.prep-icon-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;font:inherit;font-size:13px;font-weight:600;line-height:1.5;color:var(--prep-soft-text);background:var(--prep-card);border:1px solid var(--prep-border);border-radius:11px;min-height:40px;padding:8px 13px;text-decoration:none;cursor:pointer;transition:background .16s,border-color .16s,box-shadow .16s;white-space:normal}.prep-btn:hover:not(:disabled),.prep-icon-btn:hover:not(:disabled){border-color:var(--prep-accent);background:var(--prep-soft)}.prep-primary{background:linear-gradient(125deg,#4f7cff,#7c4dff);color:#fff;border-color:transparent;box-shadow:0 7px 18px -12px #5a57ef}.prep-primary:hover:not(:disabled){background:linear-gradient(125deg,#416ceb,#7040ee);color:#fff;border-color:transparent}.prep-danger{color:var(--prep-error);border-color:#fecaca}.prep-icon-btn{padding:8px;min-width:36px;background:transparent;border-color:transparent}.prep-btn:disabled,.prep-icon-btn:disabled{opacity:.5;cursor:not-allowed;box-shadow:none}.prep-page :is(button,a,input,textarea,summary):focus-visible,.prep-modal :is(button,a,input,textarea,summary):focus-visible{outline:2px solid var(--prep-accent);outline-offset:3px}.prep-layout{display:grid;grid-template-columns:224px minmax(0,1fr);align-items:stretch;min-height:620px;height:calc(100dvh - 232px);max-height:1100px;border:1px solid var(--prep-border);border-radius:22px;background:var(--prep-card);overflow:hidden;box-shadow:0 16px 48px -35px #30416845}.prep-sidebar{padding:18px 12px;background:var(--prep-soft);display:flex;flex-direction:column;min-width:0;overflow:auto;border-right:1px solid var(--prep-border)}.prep-new{width:100%;flex:none}.prep-section-label{margin:24px 9px 10px;font-size:11px;font-weight:650;color:var(--prep-muted);letter-spacing:.04em}.prep-sidebar nav{display:flex;flex-direction:column;gap:5px}.prep-session{display:flex;align-items:center;gap:8px;padding:11px 9px;min-height:44px;border-radius:10px;text-decoration:none;color:var(--prep-soft-text);font-size:12.5px;min-width:0;line-height:1.5}.prep-session>span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.prep-session .prep-icon{width:15px;height:15px;color:var(--prep-muted)}.prep-session:hover{background:var(--prep-card)}.prep-session.is-current{color:var(--prep-accent);background:var(--prep-card);font-weight:650;box-shadow:0 4px 12px -10px #16234f66}.prep-session-live{width:6px;height:6px;border-radius:50%;background:#059669;flex:none;margin-left:auto}.prep-sidebar-foot{margin-top:auto;padding:24px 8px 0}.prep-sidebar-foot>.prep-btn{width:100%}.prep-sidebar-foot>p,.prep-background-note{font-size:11px;line-height:1.8;color:var(--prep-muted)}.prep-chat{position:relative;display:flex;flex-direction:column;min-width:0;min-height:0}.prep-chat-head{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--prep-border);padding:16px 22px;min-height:78px;flex:none}.prep-chat-head h2{font-size:15px;line-height:1.5;margin:0 0 3px;font-weight:650;overflow-wrap:anywhere}.prep-subtle{font-size:12px;line-height:1.7;color:var(--prep-muted)}.prep-chat-actions{display:flex;flex:none}.prep-thread{padding:22px;overflow:auto;flex:1;min-height:160px;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--prep-border) transparent}.prep-welcome{max-width:620px;margin:clamp(8px,4vh,58px) auto 16px;text-align:center}.prep-welcome-icon{width:52px;height:52px;margin:auto auto 17px;display:grid;place-items:center;color:#fff;background:linear-gradient(135deg,#4f7cff,#9d62fa);border-radius:17px;box-shadow:0 10px 24px -14px #7d61fb}.prep-welcome-icon .prep-icon{width:29px;height:29px}.prep-welcome h2{font-size:22px;line-height:1.4;letter-spacing:-.02em;margin:0}.prep-welcome>p{font-size:13px;line-height:1.9;color:var(--prep-muted);max-width:420px;margin:13px auto 22px}.prep-starters{display:grid;gap:10px;grid-template-columns:repeat(3,minmax(0,1fr));text-align:left}.prep-starters button{background:var(--prep-card);border:1px solid var(--prep-border);border-radius:14px;padding:15px 12px;font:inherit;font-size:12px;line-height:1.6;color:var(--prep-text);cursor:pointer;text-align:left;min-width:0;transition:background .16s,border-color .16s}.prep-starters button>.prep-icon{display:block;margin-bottom:10px;color:var(--prep-accent)}.prep-starters button>span{display:block;font-size:11px;color:var(--prep-muted);margin-top:4px;line-height:1.6}.prep-starters button:hover{background:var(--prep-soft);border-color:var(--prep-accent)}.prep-capabilities{margin-top:22px;display:flex;justify-content:center;flex-wrap:wrap;gap:8px 16px;font-size:10.5px;color:var(--prep-muted)}.prep-message{display:flex;gap:11px;margin-bottom:25px;min-width:0}.prep-message-avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:10px;background:linear-gradient(130deg,#597fff,#9470ee);color:#fff;font-size:11px;font-weight:600;flex:none}.prep-message.is-user .prep-message-avatar{background:var(--prep-soft);color:var(--prep-accent)}.prep-message-body{flex:1;min-width:0}.prep-message-by{font-size:11px;font-weight:600;color:var(--prep-muted);display:block;margin:3px 0 7px}.prep-message-text{font-size:14px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;tab-size:2}.prep-message.is-user .prep-message-text{border-radius:0 14px 14px 14px;background:var(--prep-soft);padding:12px 15px}.prep-message-files{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.prep-attachment{display:flex;align-items:center;gap:9px;border:1px solid var(--prep-border);border-radius:10px;padding:10px;max-width:100%;min-width:0;text-decoration:none;color:var(--prep-soft-text);font-size:12px;line-height:1.5;background:var(--prep-card)}.prep-attachment>span{min-width:0;overflow-wrap:anywhere;flex:1}.prep-attachment>.prep-icon{width:15px;height:15px;color:var(--prep-accent)}.prep-attachment:hover{border-color:var(--prep-accent)}.prep-composer{padding:12px 20px 14px;flex:none;border-top:1px solid var(--prep-border);background:var(--prep-card)}.prep-composer>textarea{display:block;width:100%;border:1.5px solid var(--prep-input-border,#8795ad);background:var(--prep-card);resize:vertical;min-height:88px;max-height:190px;color:var(--prep-text);font:inherit;font-size:14px;line-height:1.7;padding:12px 14px;border-radius:12px;outline-offset:3px;box-shadow:inset 0 1px 3px #17233806;transition:border-color .16s,box-shadow .16s}.prep-compose-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:4px}.prep-compose-actions>div{display:flex;align-items:center;gap:6px;min-width:0}.prep-input-hint{font-size:10.5px;line-height:1.5;color:var(--prep-muted)}.prep-composer-note{font-size:10px;line-height:1.5;margin:9px 0 0;color:var(--prep-muted);text-align:center}.prep-file-queue{display:flex;gap:8px;overflow:auto;overscroll-behavior-x:contain;scrollbar-width:thin}.prep-upload{display:flex;align-items:center;gap:7px;min-width:200px;max-width:300px;border:1px solid var(--prep-border);border-radius:10px;padding:7px 5px 7px 9px;margin-bottom:8px;font-size:11px;line-height:1.5;background:var(--prep-soft)}.prep-upload>img{width:38px;height:38px;object-fit:contain;border-radius:6px;flex:none}.prep-upload>div{min-width:0;flex:1}.prep-upload strong{font-size:11px;display:block;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:550}.prep-upload span{display:block;color:var(--prep-muted);font-size:10px}.prep-upload.is-failed{border-color:#fca5a5}.prep-upload.is-failed span{color:var(--prep-error)}.prep-upload .prep-icon-btn{min-width:28px;padding:5px}.prep-run-dot{width:7px;height:7px;border-radius:50%;background:var(--prep-border)}.prep-run-dot.is-active{background:#059669;box-shadow:0 0 0 4px #10b98116}.prep-process-head{display:flex;align-items:center;justify-content:space-between;margin-top:18px}.prep-process-head h3,.prep-artifacts h3{font-size:12px;font-weight:600;margin:0;color:var(--prep-soft-text)}.prep-artifacts{display:grid;gap:7px;margin:0 0 22px}.prep-artifacts h3{margin-bottom:5px}.prep-artifacts h3 span{font-size:10px;color:var(--prep-muted);margin-left:4px}.prep-event{font-size:11.5px;line-height:1.7;border-bottom:1px solid var(--prep-border);padding:11px 0;overflow-wrap:anywhere;min-width:0}.prep-event summary{display:flex;align-items:center;gap:7px;cursor:pointer;list-style:none;color:var(--prep-soft-text);min-height:24px}.prep-event summary::-webkit-details-marker{display:none}.prep-event summary>span{flex:1;min-width:0}.prep-event summary>small{font-size:10px;color:var(--prep-muted);margin-left:auto;flex:none}.prep-event summary>.prep-icon{width:14px;height:14px;color:var(--prep-accent)}.prep-event h4{font-size:10px;font-weight:550;color:var(--prep-muted);margin:11px 0 4px}.prep-event pre,.prep-preview pre{font-size:10.5px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere;max-height:350px;overflow:auto;background:var(--prep-soft);border-radius:8px;padding:9px;margin:8px 0 0}.prep-event-text{font-size:11px;line-height:1.8;white-space:pre-wrap;margin-top:10px;color:var(--prep-muted)}.prep-status-event{display:flex;gap:7px;align-items:start;color:var(--prep-muted)}.prep-status-event>.prep-icon{width:13px;height:13px;margin-top:3px}.prep-event.is-error,.prep-poll-error{color:var(--prep-error)}.prep-poll-error{font-size:11px;line-height:1.7;padding:9px;background:var(--prep-soft);border-radius:9px}.prep-background-note{margin:22px 0 0}.prep-proposal{padding:14px;border:1px solid var(--prep-border);border-radius:13px;margin-bottom:14px;min-width:0;background:var(--prep-soft)}.prep-proposal.is-pending{border-color:#a5b6ff;background:linear-gradient(140deg,#4f7cff09,#a855f706)}.prep-proposal-tag{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:650;color:var(--prep-accent);margin-bottom:7px}.prep-proposal-tag>.prep-icon{width:13px;height:13px}.prep-proposal h3{font-size:12.5px;line-height:1.65;margin:0 0 9px;overflow-wrap:anywhere}.prep-proposal details>summary{font-size:11px;color:var(--prep-accent);cursor:pointer;padding:4px 0;line-height:1.7;min-height:28px}.prep-preview{font-size:11px;line-height:1.7;max-height:400px;overflow:auto;overflow-wrap:anywhere;margin-top:8px}.prep-preview-data{margin:0}.prep-preview-data>div{padding:4px 0}.prep-preview-data dt{font-size:10px;color:var(--prep-muted)}.prep-preview-data dd{margin:1px 0 0}.prep-preview-list{padding-left:19px;margin:4px 0}.prep-preview-list>li{padding:4px 0}.prep-proposal-actions{display:flex;flex-wrap:wrap;gap:5px;margin-top:10px}.prep-proposal-actions .prep-btn{min-height:34px;font-size:10.5px;padding:7px 9px}.prep-empty-small{font-size:11px;line-height:1.8;color:var(--prep-muted);margin:10px 8px}.prep-loading{display:grid;place-items:center;min-height:180px;font-size:13px;color:var(--prep-muted)}.prep-alert{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 16px;border:1px solid var(--prep-border);border-radius:12px;background:var(--prep-soft);font-size:13px;line-height:1.7;margin-bottom:14px;color:var(--prep-soft-text)}.prep-alert.is-error{color:var(--prep-error);border-color:#fecaca;background:#fef2f2}.prep-alert[hidden],.prep-page [hidden],.prep-modal [hidden]{display:none!important}.prep-mobile-tabs{display:none}.prep-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.prep-drop-hint{display:none}.prep-page.is-dragging .prep-drop-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:16px;border:2px dashed var(--prep-accent);border-radius:22px;background:var(--prep-card);opacity:.96;color:var(--prep-accent);font-size:20px;z-index:9;pointer-events:none}.prep-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:12px 20px;max-width:calc(100vw - 32px);border-radius:12px;color:#fff;background:#172338f2;box-shadow:0 8px 30px #11182722;font-size:13px;line-height:1.65;z-index:2100}.prep-jump{position:absolute;bottom:195px;left:50%;transform:translateX(-50%);background:var(--prep-card);border:1px solid var(--prep-border);border-radius:30px;padding:8px 13px;color:var(--prep-accent);font:inherit;font-size:11px;cursor:pointer;box-shadow:0 3px 12px #17233815}.prep-modal{border:1px solid var(--prep-border);padding:0;border-radius:20px;background:var(--prep-card);max-width:min(620px,calc(100vw - 32px));width:620px;max-height:calc(100dvh - 32px);color:var(--prep-text);box-shadow:0 24px 80px #0f172a30;overflow:auto}.prep-modal::backdrop{background:#0f172a77;backdrop-filter:blur(4px)}.prep-modal-head{padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--prep-border);margin:0}.prep-modal-head h2{font-size:17px;line-height:1.5;margin:0}.prep-modal-body{padding:20px 22px;overflow-wrap:anywhere}.prep-modal-body>p{margin:0 0 16px;font-size:13px;line-height:1.8}.prep-modal-foot{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;padding:16px 22px;border-top:1px solid var(--prep-border)}.prep-modal-error{font-size:12px;color:var(--prep-error);line-height:1.7;padding:0 22px 18px}.prep-label{display:block;margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--prep-soft-text)}.prep-field{box-sizing:border-box;display:block;width:100%;padding:10px 12px;border:1px solid var(--prep-border);border-radius:10px;color:var(--prep-text);background:var(--prep-card);font:inherit;font-size:14px;line-height:1.7;min-width:0}.prep-field[readonly]{background:var(--prep-soft);color:var(--prep-muted)}textarea.prep-field{resize:vertical;min-height:90px}.prep-modal hr{height:1px;background:var(--prep-border);border:0;margin:22px 0}.prep-modal h3{font-size:14px;margin:0 0 10px}.prep-skill-content{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px}.prep-skill-pick{margin-top:12px}.prep-skill-row{display:flex;gap:12px;align-items:center;justify-content:space-between;border:1px solid var(--prep-border);border-radius:11px;padding:11px;margin:9px 0}.prep-skill-row>div{min-width:0}.prep-skill-row strong{display:block;font-size:13px;overflow-wrap:anywhere}.prep-skill-row span{display:block;font-size:11px;line-height:1.65;color:var(--prep-muted);white-space:pre-wrap;overflow-wrap:anywhere;margin-top:4px}.prep-edit-group{border:1px solid var(--prep-border);border-radius:11px;padding:6px 12px 12px;margin:15px 0;min-width:0}.prep-edit-group legend{font-size:12px;color:var(--prep-muted);padding:0 6px}.prep-edit-row{display:flex;gap:5px;border-bottom:1px solid var(--prep-border);padding-bottom:12px;margin-bottom:12px}.prep-edit-row>div{min-width:0;flex:1}.prep-edit-row>.prep-icon-btn{align-self:start;margin-top:12px}.prep-checkbox{display:flex;align-items:center;gap:9px;min-height:44px;font-size:13px;color:var(--prep-soft-text)}.prep-nav{color:var(--aiq-text-soft,#475569);text-decoration:none!important;background:transparent}.prep-nav:hover{color:var(--aiq-accent,#3559f6);background:var(--aiq-nav-hover,#f1f3fd)}.prep-nav.is-active{background:linear-gradient(135deg,#4f7cff,#7c4dff);color:#fff;font-weight:600;box-shadow:0 10px 22px -12px #4f7cffe6}.prep-drawer-nav{display:flex;align-items:center;gap:10px;min-height:44px;border-radius:12px;padding:12px 16px;text-decoration:none;color:var(--aiq-text-soft,#475569);font-weight:600}.prep-drawer-nav.is-active{background:linear-gradient(135deg,#4f7cff,#7c4dff);color:#fff}
.prep-artifact-row{display:flex;gap:6px;align-items:center;min-width:0}.prep-artifact-row>.prep-attachment{flex:1}.prep-artifact-preview{flex:none;padding:8px 10px;min-height:40px;font-size:11px}.prep-preview-modal{width:1060px;max-width:min(1060px,calc(100vw - 24px))}.prep-preview-modal .prep-modal-head{position:sticky;top:0;z-index:1;background:var(--prep-card)}.prep-preview-modal .prep-modal-head h2{min-width:0;overflow-wrap:anywhere}.prep-preview-modal .prep-modal-head>.prep-icon-btn{flex:none;min-height:44px;min-width:44px}.prep-preview-frame-host{height:min(65dvh,700px);min-height:240px;border:1px solid var(--prep-border);border-radius:10px;overflow:hidden;background:#fff}.prep-preview-frame{display:block;width:100%;height:100%;border:0}.prep-preview-modal .prep-modal-foot{position:sticky;bottom:0;background:var(--prep-card)}

.prep-compose-label{display:block;font-size:12px;line-height:1.5;font-weight:650;color:var(--prep-soft-text);margin:0 0 8px}.prep-composer>textarea:focus{border-color:var(--prep-accent);outline:2px solid var(--prep-accent);outline-offset:2px;box-shadow:0 0 0 5px #4f7cff0c}.prep-composer>textarea::placeholder{color:var(--prep-muted);opacity:1}.prep-compose-actions{margin-top:8px}.prep-chat-actions>[data-prep-chat-actions]{display:flex}.prep-chat>.prep-poll-error{margin:8px 16px 0;flex:none}.prep-message.is-user{flex-direction:row-reverse;width:fit-content;max-width:88%;margin-left:auto}.prep-message.is-user .prep-message-body{flex:initial;min-width:0}.prep-message.is-user .prep-message-by{text-align:right}.prep-message.is-user .prep-message-text{border-radius:14px 0 14px 14px;background:var(--prep-soft);border:1px solid var(--prep-border);text-align:left}.prep-message.is-user .prep-message-files{justify-content:flex-end}.prep-message.is-assistant{margin-right:6px}.prep-message-text.prep-markdown,.prep-progress.prep-markdown{white-space:normal}.prep-markdown{font-size:14px;line-height:1.85;overflow-wrap:anywhere;min-width:0}.prep-markdown>:first-child{margin-top:0}.prep-markdown>:last-child{margin-bottom:0}.prep-markdown p{margin:0 0 14px}.prep-markdown :is(h1,h2,h3,h4,h5,h6){font-weight:650;line-height:1.5;margin:24px 0 12px;color:var(--prep-text)}.prep-markdown h1{font-size:22px}.prep-markdown h2{font-size:20px}.prep-markdown h3{font-size:17px}.prep-markdown :is(h4,h5,h6){font-size:15px}.prep-markdown :is(ul,ol){padding-left:24px;margin:10px 0 16px;list-style-position:outside}.prep-markdown ul{list-style-type:disc}.prep-markdown ol{list-style-type:decimal}.prep-markdown li{padding-left:2px;margin:6px 0}.prep-markdown li>p{margin:6px 0}.prep-markdown :is(ul,ol) :is(ul,ol){margin:6px 0}.prep-markdown blockquote{border-left:3px solid var(--prep-accent);padding:9px 14px;margin:16px 0;background:var(--prep-soft);border-radius:0 9px 9px 0;color:var(--prep-soft-text)}.prep-markdown blockquote>:last-child{margin-bottom:0}.prep-markdown a{color:var(--prep-accent);text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere}.prep-markdown code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:.88em;background:var(--prep-soft);border:1px solid var(--prep-border);padding:2px 5px;border-radius:5px;white-space:break-spaces}.prep-markdown pre{max-width:100%;overflow:auto;border:1px solid var(--prep-border);border-radius:12px;background:var(--prep-soft);padding:14px;margin:16px 0;white-space:pre;tab-size:2}.prep-markdown pre code{display:block;width:max-content;min-width:100%;font-size:12px;line-height:1.8;background:none;border:0;border-radius:0;padding:0;white-space:pre;overflow-wrap:normal}.prep-markdown-table{max-width:100%;min-width:0;overflow-x:auto;margin:16px 0}.prep-markdown-table table{margin:0}.prep-link-unavailable{overflow-wrap:anywhere}.prep-markdown table{display:block;max-width:100%;width:100%;overflow:auto;border-collapse:collapse;margin:16px 0;font-size:12px;line-height:1.7}.prep-markdown :is(th,td){border:1px solid var(--prep-border);padding:9px 12px;text-align:left;min-width:100px;max-width:360px;vertical-align:top}.prep-markdown th{font-weight:650;background:var(--prep-soft)}.prep-markdown hr{border:0;border-top:1px solid var(--prep-border);margin:22px 0}.prep-markdown del{color:var(--prep-muted)}.prep-progress{margin:12px 0 20px;padding-bottom:2px}.prep-run-events:empty{display:none}.prep-run-events:not(:empty)+.prep-final-response{border-top:1px solid var(--prep-border);padding-top:18px;margin-top:18px}.prep-final-response+.prep-final-response{margin-top:20px}.prep-run-events .prep-event{font-size:12px;border-bottom:0;margin:10px 0;padding:0}.prep-run-events details.prep-event{border:1px solid var(--prep-border);border-radius:11px;padding:0 12px;background:var(--prep-soft)}.prep-run-events .prep-event summary{min-height:44px;font-size:12px}.prep-run-events .prep-event[open]{padding-bottom:12px}.prep-run-events .prep-event pre{border:1px solid var(--prep-border);background:var(--prep-card);margin-top:7px;font-size:11px}.prep-run-events .prep-event-text{font-size:12px;padding:0 0 2px;margin-top:0;color:var(--prep-soft-text)}.prep-run-events .prep-status-event{font-size:11px;color:var(--prep-muted);gap:7px;margin:12px 0;line-height:1.7}.prep-run-events summary::after{content:'›';font-size:18px;margin-left:4px;color:var(--prep-muted);transition:transform .16s}.prep-run-events details[open]>summary::after{transform:rotate(90deg)}.prep-disclosure-hint{font-size:10px;color:var(--prep-muted);flex:initial!important}.prep-live-status{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--prep-soft-text);margin-top:16px;min-height:28px}.prep-live-status .prep-subtle{font-size:11px}.prep-artifact-card{display:flex;align-items:flex-start;gap:12px;min-width:0;border:1px solid var(--prep-border);border-radius:13px;background:var(--prep-card);padding:14px;margin:12px 0}.prep-artifact-icon{display:grid;place-items:center;width:36px;height:42px;border-radius:9px;background:var(--prep-soft);color:var(--prep-accent);flex:none}.prep-artifact-icon>.prep-icon{width:21px;height:21px}.prep-artifact-info{min-width:0;flex:1}.prep-artifact-info h4{font-size:13px;line-height:1.7;font-weight:650;margin:0;overflow-wrap:anywhere;color:var(--prep-text)}.prep-artifact-info p{font-size:10px;line-height:1.7;color:var(--prep-muted);margin:3px 0 10px}.prep-artifact-actions{display:flex;gap:8px;flex-wrap:wrap}.prep-artifact-actions>.prep-btn{font-size:12px;min-height:44px;padding:8px 12px}.prep-artifact-actions .is-artifact{color:var(--prep-accent);border-color:var(--prep-accent)}.prep-artifacts{gap:0}.prep-artifacts .prep-artifact-card{gap:9px;padding:12px;margin:8px 0}.prep-artifacts .prep-artifact-icon{width:30px;height:36px}.prep-file-help{font-size:11px;line-height:1.8;color:var(--prep-muted);margin:7px 0}.prep-message-body>.prep-artifact-card{margin-top:18px}html.dark .prep-composer>textarea{--prep-input-border:#63718e}

html.dark .prep-page,html.dark .prep-modal{--prep-error:#fca5a5;--prep-accent:#93b4ff}html.dark .prep-alert.is-error{background:#7f1d1d22;border-color:#7f1d1d}html.dark .prep-proposal.is-pending{border-color:#5263a6}html.dark .prep-message-avatar{color:#fff}
header.aiq-navbar nav a.nav-item{white-space:nowrap}
@media(min-width:1024px) and (max-width:1279px){header.aiq-navbar nav{display:none}header.aiq-navbar button[class~="lg:hidden"]{display:inline-flex;min-width:44px;min-height:44px}}
@media(min-width:1280px) and (max-width:1499px){header.aiq-navbar nav a.nav-item{padding-left:7px;padding-right:7px;font-size:12.5px}}
@media(min-width:1500px){.prep-layout{grid-template-columns:240px minmax(0,1fr)}}
@media(max-width:1199px){.prep-page{padding:24px 16px 36px}.prep-layout{grid-template-columns:185px minmax(0,1fr)}.prep-chat-head{padding:14px 16px}.prep-thread{padding:18px 16px}.prep-starters{grid-template-columns:1fr}.prep-starters button{position:relative;padding:11px 12px 11px 40px}.prep-starters button>.prep-icon{position:absolute;left:12px;top:14px}.prep-starters button>span{margin-top:2px}}
@media(max-width:1023px){.prep-layout{grid-template-columns:190px minmax(0,1fr);height:auto;min-height:650px;max-height:none}.prep-chat{min-height:650px;height:calc(100dvh - 250px)}.prep-sidebar{grid-row:1}.prep-btn,.prep-icon-btn{min-height:44px;min-width:44px}.prep-composer>textarea,.prep-field,.prep-skill-content{font-size:16px}.prep-proposal-actions .prep-btn{min-height:44px;font-size:12px}.prep-upload .prep-icon-btn{min-width:44px;min-height:44px}.prep-event summary,.prep-proposal details>summary{min-height:44px}.prep-input-hint{font-size:11px}.prep-modal{max-height:calc(100dvh - 24px);max-width:calc(100vw - 24px)}.prep-heading h1{font-size:25px}.prep-heading p{font-size:13px}.prep-thread{min-height:180px}.prep-mobile-tabs button{min-height:44px}}
@media(max-width:639px){.prep-page{padding:18px 12px 24px}.prep-heading{margin-bottom:17px;align-items:flex-start}.prep-heading h1{font-size:23px;gap:8px}.prep-heading>.prep-btn{font-size:0;padding:9px;min-width:44px}.prep-heading>.prep-btn>.prep-icon{width:19px;height:19px}.prep-heading p{font-size:12px;max-width:240px}.prep-model{font-size:9px;padding:3px 7px}.prep-eyebrow{font-size:11px;margin-bottom:7px}.prep-mobile-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:0 0 10px;padding:4px;border-radius:13px;background:var(--prep-soft);border:1px solid var(--prep-border)}.prep-mobile-tabs button{display:flex;align-items:center;justify-content:center;gap:5px;border:0;border-radius:9px;background:transparent;color:var(--prep-muted);font:inherit;font-size:11px;cursor:pointer;padding:8px 4px;white-space:nowrap}.prep-mobile-tabs button .prep-icon{width:15px;height:15px}.prep-mobile-tabs button[aria-selected=true]{background:var(--prep-card);color:var(--prep-accent);font-weight:600;box-shadow:0 3px 8px #0f172a09}.prep-layout{display:block;min-height:520px;border-radius:16px;overflow:hidden}.prep-sidebar{display:none;max-height:none;min-height:520px;border:0;padding:16px}.prep-chat{display:flex;min-height:540px;height:calc(100dvh - 247px);max-height:1000px}.prep-page[data-panel=sessions] .prep-sidebar{display:flex}.prep-page[data-panel=sessions] .prep-chat{display:none}.prep-sidebar nav{max-height:none}.prep-sidebar-foot{padding-top:30px}.prep-session{font-size:13px;padding:12px}.prep-chat-head{padding:12px 13px;min-height:68px}.prep-chat-head h2{font-size:13px}.prep-chat-head .prep-subtle{font-size:10px}.prep-chat-actions{gap:0}.prep-thread{padding:20px 13px 8px;min-height:150px}.prep-welcome{margin:13px auto 10px}.prep-welcome-icon{width:44px;height:44px;border-radius:14px;margin-bottom:13px}.prep-welcome h2{font-size:19px}.prep-welcome>p{font-size:12px;line-height:1.8;margin:12px auto 16px}.prep-starters{gap:8px}.prep-starters button{font-size:12px;min-height:62px;padding-top:10px;padding-bottom:10px}.prep-starters button>span{font-size:10.5px}.prep-capabilities{font-size:9.5px;gap:5px 12px;margin-top:16px}.prep-message{gap:8px;margin-bottom:22px}.prep-message-avatar{width:25px;height:25px;border-radius:8px;font-size:10px}.prep-message-avatar>.prep-icon{width:15px;height:15px}.prep-message-by{font-size:10px;margin:2px 0 7px}.prep-message-text{font-size:14px;line-height:1.9}.prep-message.is-user .prep-message-text{padding:10px 12px}.prep-message.is-user{max-width:94%}.prep-thread .prep-artifact-card{padding:12px;gap:9px}.prep-thread .prep-artifact-icon{width:28px;height:34px}.prep-markdown :is(th,td){padding:8px 10px}.prep-markdown h1{font-size:20px}.prep-markdown h2{font-size:18px}.prep-compose-label{font-size:11px}.prep-composer{padding:10px 12px 12px;padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}.prep-composer>textarea{font-size:16px;min-height:62px;max-height:140px;line-height:1.65}.prep-input-hint{font-size:9px;max-width:135px}.prep-composer-note{font-size:9px;margin-top:8px;text-align:left}.prep-compose-actions>.prep-btn{min-width:76px;padding:9px 12px}.prep-alert{font-size:12px;padding:10px 12px;gap:5px}.prep-upload{min-width:220px}.prep-modal-head{padding:13px 16px}.prep-modal-body{padding:16px}.prep-modal-foot{padding:13px 16px}.prep-modal-error{padding:0 16px 16px}.prep-modal-head h2{font-size:16px}.prep-jump{bottom:190px}.prep-proposal h3{font-size:14px}.prep-event,.prep-event-text{font-size:12px}.prep-preview{font-size:12px}.prep-modal .prep-btn{font-size:13px}.prep-background-note{font-size:11px}}
@media(max-width:360px){.prep-page{padding-left:8px;padding-right:8px}.prep-heading h1{font-size:21px}.prep-input-hint{max-width:105px}.prep-mobile-tabs button{font-size:10.5px;gap:4px}.prep-composer{padding-left:10px;padding-right:10px}.prep-capabilities{gap:6px}.prep-welcome h2{font-size:18px}}
@media(max-height:500px) and (max-width:1023px){.prep-chat{height:600px}.prep-modal{max-height:calc(100dvh - 16px)}}

.prep-heading-actions{display:flex;align-items:center;gap:8px;flex:none}.prep-heading-actions>.prep-btn{min-height:44px}.prep-files-button{width:100%;justify-content:flex-start;margin-top:10px;font-size:12px;padding:9px;gap:6px;min-height:44px}.prep-file-count{font-size:10px;min-width:19px;min-height:19px;line-height:19px;text-align:center;border-radius:12px;background:var(--prep-soft);color:var(--prep-accent);margin-left:auto;padding:0 5px}.prep-files-modal{width:700px}.prep-files-modal .prep-modal-head,.prep-files-modal .prep-modal-foot{position:sticky;background:var(--prep-card);z-index:1}.prep-files-modal .prep-modal-head{top:0}.prep-files-modal .prep-modal-foot{bottom:0}.prep-files-empty{text-align:center;padding:30px 10px 35px;color:var(--prep-muted)}.prep-files-empty>.prep-icon{width:34px;height:34px;color:var(--prep-accent)}.prep-files-empty h3{color:var(--prep-text);font-size:15px;margin:16px 0 8px}.prep-files-empty p{font-size:12px;line-height:1.8;margin:0}.prep-run-proposals{margin:16px 0}.prep-run-proposals .prep-proposal{padding:16px;margin:12px 0}.prep-run-proposals .prep-proposal h3{font-size:15px}.prep-run-proposals .prep-proposal-tag{font-size:11px}.prep-run-proposals .prep-proposal-actions{gap:8px}.prep-run-proposals .prep-proposal-actions .prep-btn{font-size:12px;min-height:44px;padding:9px 13px}.prep-chat-head>div:first-child{min-width:0;flex:1}.prep-chat-head h2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.prep-chat-actions>.prep-icon-btn{min-width:40px;min-height:44px}.prep-page.is-fullscreen{box-sizing:border-box;position:fixed;inset:0;width:100%;height:100dvh;z-index:1900;overflow:hidden;padding:16px;background:var(--aiq-bg,#f6f8ff)}.prep-page.is-fullscreen .prep-wrap{height:100%;max-width:none;display:flex;flex-direction:column;min-height:0}.prep-page.is-fullscreen .prep-heading{flex:none;margin-bottom:12px}.prep-page.is-fullscreen .prep-heading h1{font-size:22px}.prep-page.is-fullscreen .prep-heading :is(p,.prep-eyebrow){display:none}.prep-page.is-fullscreen .prep-mobile-tabs,.prep-page.is-fullscreen .prep-alert{flex:none}.prep-page.is-fullscreen .prep-layout{flex:1;height:auto;min-height:0;max-height:none}.prep-page.is-fullscreen .prep-chat{height:100%;min-height:0;max-height:none}.prep-page.is-fullscreen .prep-thread{min-height:0}.prep-page.is-fullscreen .prep-sidebar{min-height:0;height:100%;max-height:none}html.dark .prep-page.is-fullscreen{background:var(--aiq-bg,#0a1120)}

@media(max-width:639px){.prep-heading-actions{gap:5px}.prep-heading-actions>.prep-btn{font-size:0;padding:9px;min-width:44px}.prep-heading-actions>.prep-btn .prep-icon{width:18px;height:18px}.prep-page.is-fullscreen{padding:10px}.prep-page.is-fullscreen .prep-heading h1{font-size:20px}.prep-page.is-fullscreen .prep-model{display:none}}
@media(max-height:560px) and (max-width:639px){.prep-page.is-fullscreen .prep-composer>textarea{height:62px;min-height:62px;max-height:90px}.prep-page.is-fullscreen .prep-chat-head{min-height:56px;padding-top:8px;padding-bottom:8px}.prep-page.is-fullscreen .prep-composer{padding-top:8px;padding-bottom:8px}}
@media(prefers-reduced-motion:reduce){.prep-page *,.prep-modal *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
`
})()
