/** Run against the isolated local API, never a public site:
 * SMOKE_BASE=http://127.0.0.1:3021 node --import tsx scripts/prep-api-e2e.mjs
 * API and script must share DB, AUTH_SECRET, PREP_STORAGE_DIR and PREP_WORKER_SECRET.
 * API PREP_WORKER_URL must be http://127.0.0.1:3334; this script owns that fake worker.
 * No model, real execution container, SMTP or existing user data is used.
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { access, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/lib/db.ts'
import { signSession } from '../src/lib/auth.ts'
import { env } from '../src/env.ts'

const api = new URL(process.env.SMOKE_BASE || 'http://127.0.0.1:3021')
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) || api.pathname !== '/') throw new Error('本套件只能对本机隔离 API 运行')
const base = api.origin
const workerUrl = new URL(env.PREP_WORKER_URL)
if (!env.PREP_ENABLED || !env.PREP_WORKER_SECRET || workerUrl.origin !== 'http://127.0.0.1:3334' || workerUrl.pathname !== '/') throw new Error('请为隔离 API 和本测试配置 PREP_ENABLED=true、共享 worker secret、PREP_WORKER_URL=http://127.0.0.1:3334')
if (env.PREP_DAILY_RUNS < 3) throw new Error('本套件每个临时账号需要至少3次每日任务额度')

const marker = 'prep-e2e-' + randomBytes(6).toString('hex')
const users = [], sessions = new Map(), fileKeys = new Set(), jobs = new Map(), deletedSessions = new Map()
let passed = 0, serverStarted = false
const activeStates = ['queued', 'running', 'waiting', 'cancelling']
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function until(name, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await wait(150) }
  throw new Error('等待超时：' + name)
}
function client(cookie = '') {
  return {
    async call(path, method = 'GET', body, headers = {}) {
      const raw = Buffer.isBuffer(body)
      const response = await fetch(base + '/api' + path, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': raw ? 'application/octet-stream' : 'application/json' }), ...headers },
        body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      const json = response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : null
      return { status: response.status, json, bytes, headers: response.headers }
    },
  }
}
const anonymous = client()
const broker = client()
const brokerHeaders = { authorization: 'Bearer ' + env.PREP_WORKER_SECRET }
const internal = (path, method = 'GET', body, headers = {}) => broker.call('/prep/internal' + path, method, body, { ...brokerHeaders, ...headers })
async function teacher(suffix) {
  const user = await prisma.user.create({ data: { email: `${marker}-${suffix}@example.invalid`, nickname: marker, passwordHash: 'not-a-login-hash' } })
  const cookie = `${env.COOKIE_NAME}=${await signSession(user.id, user.sessionVersion)}`
  const result = { id: user.id, client: client(cookie) }
  users.push(result)
  return result
}
async function newSession(user, suffix) {
  const response = await user.client.call('/prep/sessions', 'POST', { title: marker + '-' + suffix })
  check('创建独立对话 ' + suffix, response.status === 200 && !!response.json.session?.id)
  const id = response.json.session.id
  sessions.set(id, user)
  return id
}
async function rememberFiles(ownerIds = users.map(u => u.id)) {
  if (!ownerIds.length) return
  const rows = await prisma.prepAttachment.findMany({ where: { ownerId: { in: ownerIds }, sessionId: { in: [...sessions.keys()] } }, select: { storageKey: true } })
  for (const row of rows) {
    if (!/^[a-f0-9]{48}$/.test(row.storageKey)) throw new Error('临时附件存储键格式不正确')
    fileKeys.add(row.storageKey)
  }
}
const pathFor = key => resolve(env.PREP_STORAGE_DIR, 'files', key)
async function exists(path) { try { await access(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
async function readBody(request) {
  const chunks = []; let size = 0
  for await (const chunk of request) { size += chunk.length; if (size > 1048576) throw new Error('Fake worker request too large'); chunks.push(chunk) }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}
function send(response, status, value) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)) }

// Only the trusted broker has this credential. It calls the primary API over loopback.
const server = createServer(async (request, response) => {
  try {
    if (request.headers.authorization !== 'Bearer ' + env.PREP_WORKER_SECRET) return send(response, 403, { error: 'forbidden' })
    const url = new URL(request.url, 'http://127.0.0.1:3334')
    if (url.pathname === '/health' && request.method === 'GET') return send(response, 200, { ready: true, message: 'isolated fake worker' })
    if (url.pathname === '/jobs' && request.method === 'POST') {
      const input = await readBody(request)
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(input.id || '') || !sessions.has(input.sessionId)) return send(response, 400, { error: 'unknown fixture' })
      let job = jobs.get(input.id)
      if (!job) {
        const snapshot = await internal(`/runs/${input.id}/input`)
        if (snapshot.status !== 200) return send(response, 500, { error: 'input callback failed' })
        job = { ...input, input: snapshot.json, status: 'running', polls: 0, cancelled: false, createdAt: Date.now(), hold: input.content.includes('[hold]'), events: [
          { id: 1, type: 'status', data: { status: 'running', message: '隔离运行器开始' } },
          { id: 2, type: 'reasoning', data: { text: '验收用进度摘要。' } },
          { id: 3, type: 'tool-start', data: { name: 'fixture_read', callId: 'fixture-read' } },
          { id: 4, type: 'tool-result', data: { name: 'fixture_read', callId: 'fixture-read', output: '完成' } },
          { id: 5, type: 'text', data: { text: '模拟备课结果。' } },
        ] }
        jobs.set(input.id, job)
      }
      return send(response, 200, { id: input.id, status: job.status })
    }
    const events = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)\/events$/)
    if (events && request.method === 'GET') {
      const job = jobs.get(events[1]); if (!job) return send(response, 404, { error: 'job not found' })
      job.polls++
      if (job.status === 'running' && !job.hold && Date.now() - job.createdAt > 1800) job.status = 'completed'
      const after = Number(url.searchParams.get('after') || 0)
      return send(response, 200, { status: job.status, events: job.events.filter(e => e.id > after), hasMore: false, ...(job.status === 'completed' ? { response: '隔离备课完成：' + job.content } : {}) })
    }
    const cancel = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)\/cancel$/)
    if (cancel && request.method === 'POST') {
      const job = jobs.get(cancel[1]); if (job) { job.status = 'cancelled'; job.cancelled = true }
      return send(response, 200, { ok: true })
    }
    const deletion = url.pathname.match(/^\/sessions\/([A-Za-z0-9_-]+)$/)
    if (deletion && request.method === 'DELETE') {
      const body = await readBody(request)
      if (sessions.get(deletion[1])?.id !== body.ownerId) return send(response, 403, { error: 'unknown fixture' })
      deletedSessions.set(deletion[1], body.ownerId)
      return send(response, 200, { ok: true })
    }
    return send(response, 404, { error: 'unknown fake worker endpoint' })
  } catch {
    if (!response.headersSent) send(response, 500, { error: 'fake worker callback failed' })
    else response.end()
  }
})

try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3334, '127.0.0.1', resolve) })
  serverStarted = true
  const a = await teacher('a'), b = await teacher('b')
  const s1 = await newSession(a, 'a1'), s2 = await newSession(a, 'a2'), sb = await newSession(b, 'b1')
  let r = await anonymous.call('/prep/status')
  check('备课入口要求已有账号登录', r.status === 401)
  r = await a.client.call('/prep/status')
  check('真实 API 能连接隔离运行器且公开限额不含凭证', r.status === 200 && r.json.enabled === true && r.json.model === 'deepseek-flash' && !JSON.stringify(r.json).includes(env.PREP_WORKER_SECRET))
  r = await a.client.call('/prep/sessions', 'POST', { title: '不应创建' }, { origin: 'https://prep-e2e-invalid.example' })
  check('跨站 Origin 写请求被拒绝', r.status === 403 && await prisma.prepSession.count({ where: { ownerId: a.id } }) === 2)
  r = await a.client.call('/prep/sessions/' + s2, 'PATCH', { title: marker + '-renamed' }, { origin: new URL(env.APP_ORIGIN).origin })
  check('站点合法 Origin 可以修改自己的标题', r.status === 200 && r.json.session.title === marker + '-renamed')
  const alist = await a.client.call('/prep/sessions'), blist = await b.client.call('/prep/sessions')
  check('两个账号的会话列表互相隔离', alist.json.sessions.length === 2 && blist.json.sessions.length === 1 && !blist.json.sessions.some(s => s.id === s1))
  for (const [path, method, body] of [[`/prep/sessions/${s1}`, 'GET'], [`/prep/sessions/${s1}/events?after=0`, 'GET'], [`/prep/sessions/${s1}`, 'PATCH', { title: '越权' }], [`/prep/sessions/${s1}`, 'DELETE'], [`/prep/sessions/${s1}/messages`, 'POST', { content: '越权', attachmentIds: [] }]]) {
    r = await b.client.call(path, method, body)
    check('其他账号不能访问对话 ' + method + ' ' + path.split('/').at(-1), r.status === 404)
  }

  const skillA = await a.client.call('/prep/skills', 'POST', { name: '名单识别', content: '# A Skill\n仅用于临时账号A。' })
  const skillB = await b.client.call('/prep/skills', 'POST', { name: '名单识别', content: '# B Skill\n仅用于临时账号B。' })
  check('同名 Skills 按账号独立保存', skillA.status === 200 && skillB.status === 200 && skillA.json.skill.id !== skillB.json.skill.id)
  await b.client.call('/prep/skills/' + skillA.json.skill.id, 'DELETE')
  const askills = await a.client.call('/prep/skills'), bskills = await b.client.call('/prep/skills')
  check('越权删除 Skill 不影响所有者且列表不泄漏', askills.json.skills.length === 1 && bskills.json.skills.length === 1 && askills.json.skills[0].id === skillA.json.skill.id && bskills.json.skills[0].id === skillB.json.skill.id)

  const bytesA = Buffer.from('姓名,学号\n张同学,001\n李同学,002\n', 'utf8'), bytesB = Buffer.from('B-private-fixture', 'utf8')
  r = await a.client.call(`/prep/sessions/${s1}/attachments?filename=${encodeURIComponent('../名单.txt')}`, 'POST', bytesA)
  check('手机与粘贴共用的 raw 上传保存字节并移除路径', r.status === 200 && r.json.attachment.name === '名单.txt' && r.json.attachment.size === bytesA.length && !('storageKey' in r.json.attachment))
  const attachmentA = r.json.attachment
  r = await b.client.call(`/prep/sessions/${sb}/attachments?filename=private.txt`, 'POST', bytesB)
  check('第二账号能上传自己的附件', r.status === 200)
  const attachmentB = r.json.attachment
  await rememberFiles()
  check('附件确实写入私有存储', fileKeys.size === 2 && (await Promise.all([...fileKeys].map(k => exists(pathFor(k))))).every(Boolean))
  r = await a.client.call('/prep/attachments/' + attachmentA.id)
  check('所有者下载字节完全一致且强制附件和禁止缓存', r.status === 200 && r.bytes.equals(bytesA) && r.headers.get('content-disposition')?.startsWith('attachment;') && r.headers.get('cache-control') === 'private, no-store' && r.headers.get('x-content-type-options') === 'nosniff')
  r = await b.client.call('/prep/attachments/' + attachmentA.id)
  check('其他账号不能下载附件', r.status === 404)
  r = await b.client.call(`/prep/sessions/${s1}/attachments?filename=forbidden.txt`, 'POST', bytesB)
  check('其他账号不能向对话上传附件', r.status === 404)
  r = await a.client.call(`/prep/sessions/${s1}/attachments?filename=empty.txt`, 'POST', Buffer.alloc(0))
  check('空文件被拒绝', r.status === 400)
  r = await a.client.call(`/prep/sessions/${s1}/attachments?filename=unsupported.zip`, 'POST', bytesA)
  check('暂不支持的压缩包被拒绝', r.status === 400)
  r = await a.client.call(`/prep/sessions/${s1}/attachments?filename=wrong.txt`, 'POST', { content: '非原始字节' })
  check('上传端点拒绝 JSON 伪装文件', r.status === 400)
  r = await a.client.call(`/prep/sessions/${s2}/messages`, 'POST', { content: '不能跨会话带附件', attachmentIds: [attachmentA.id] })
  check('同账号新会话也不能引用旧会话附件', r.status === 400)
  r = await b.client.call(`/prep/sessions/${sb}/messages`, 'POST', { content: '不能跨账号带附件', attachmentIds: [attachmentA.id] })
  check('其他账号消息不能引用私有附件', r.status === 400)

  r = await a.client.call(`/prep/sessions/${s1}/attachments?filename=discarded-before-send.txt`, 'POST', Buffer.from('PRIVATE_DRAFT_REMOVED_BEFORE_SEND'))
  check('误选后移除的附件仍可暂存为独立上传记录', r.status === 200)
  const discardedAttachment = r.json.attachment

  const firstText = marker + ' 第一对话原始资料'
  const simultaneousMessages = await Promise.all([a.client.call(`/prep/sessions/${s1}/messages`, 'POST', { content: firstText, attachmentIds: [attachmentA.id] }), a.client.call(`/prep/sessions/${s1}/messages`, 'POST', { content: firstText, attachmentIds: [attachmentA.id] })])
  check('同时发消息时只创建一个活动任务', simultaneousMessages.filter(v => v.status === 200).length === 1 && simultaneousMessages.filter(v => v.status === 409).length === 1)
  r = simultaneousMessages.find(v => v.status === 200)
  check('发送立即返回持久任务编号', r.status === 200 && typeof r.json.runId === 'string' && ['queued', 'running'].includes(r.json.status))
  const firstRun = r.json.runId
  const firstJob = await until('运行器接收到首个任务', () => jobs.get(firstRun))
  check('运行器只获当前会话文件和当前教师 Skills', firstJob.input.files.length === 1 && firstJob.input.files[0].id === attachmentA.id && firstJob.input.skills.length === 1 && firstJob.input.skills[0].id === skillA.json.skill.id && firstJob.input.history.length === 1 && firstJob.input.history[0].content === firstText)
  check('未在任何已发消息中引用的草稿上传不会送入模型', !firstJob.input.files.some(file => file.id === discardedAttachment.id))
  // No browser request is kept open or polled while the durable API job makes progress.
  await wait(2600)
  check('没有前端连接时运行器仍被后台轮询', firstJob.polls >= 2)
  const resumed = a.client
  const complete = await until('重新打开对话取得后台结果', async () => {
    const response = await resumed.call(`/prep/sessions/${s1}/events?after=0`)
    return response.status === 200 && response.json.activeRun?.status === 'completed' ? response.json : null
  })
  check('重新打开能恢复助手结果和进度事件', complete.messages.some(m => m.role === 'assistant' && m.content.includes(firstText)) && ['reasoning', 'tool-start', 'tool-result', 'text'].every(type => complete.events.some(e => e.type === type)))
  const refreshedList = (await a.client.call('/prep/sessions')).json.sessions
  check('会话列表提供最新任务状态且新对话没有旧任务状态', refreshedList.find(s => s.id === s1)?.status === 'completed' && refreshedList.find(s => s.id === s2)?.status === null && refreshedList.every(s => !('runs' in s)))
  const cursor = complete.events.at(-1).id
  r = await resumed.call(`/prep/sessions/${s1}/events?after=${cursor}`)
  check('事件游标支持断线续传且不重复旧事件', r.status === 200 && r.json.events.length === 0)
  r = await internal(`/runs/${firstRun}/input`, 'GET', undefined, { authorization: 'Bearer invalid-e2e-secret' })
  check('内部接口拒绝无效运行器凭证', r.status === 403)

  const isolatedText = marker + ' 第二对话仅有这条内容'
  r = await a.client.call(`/prep/sessions/${s2}/messages`, 'POST', { content: isolatedText, attachmentIds: [] })
  check('新对话可独立开始任务', r.status === 200)
  const secondRun = r.json.runId
  const secondJob = await until('新会话运行器输入', () => jobs.get(secondRun))
  check('新对话不会自动加载旧会话历史或附件', secondJob.input.history.length === 1 && secondJob.input.history[0].content === isolatedText && secondJob.input.files.length === 0)
  await until('新会话任务完成', async () => (await prisma.prepRun.findUnique({ where: { id: secondRun } }))?.status === 'completed')

  r = await a.client.call(`/prep/sessions/${s1}/messages`, 'POST', { content: marker + ' [hold] 检查预览工具', attachmentIds: [] })
  check('同一对话可接续上下文', r.status === 200)
  const holdRun = r.json.runId
  const heldJob = await until('等待预览任务启动', () => jobs.get(holdRun))
  check('接续会话包含先前用户和助手消息', heldJob.input.history.length === 3 && heldJob.input.history.some(m => m.role === 'assistant' && m.content.includes(firstText)))
  check('接续会话保留历史已发送的原件并继续排除移除的草稿', heldJob.input.files.length === 1 && heldJob.input.files[0].id === attachmentA.id && !heldJob.input.files.some(file => file.id === discardedAttachment.id))
  const future = await prisma.prepMessage.create({data:{sessionId:s1,role:'user',content:marker+' FUTURE_MESSAGE_MUST_NOT_REACH_THIS_RUN',attachmentIds:JSON.stringify([discardedAttachment.id]),createdAt:new Date(Date.now()+60000)}})
  r = await internal(`/runs/${holdRun}/input`)
  check('读取本任务输入时不会带上随后消息的文字或附件', r.status === 200 && r.json.history.length === 3 && !r.json.history.some(message => message.id === future.id) && r.json.files.length === 1 && r.json.files[0].id === attachmentA.id)
  await prisma.prepMessage.delete({where:{id:future.id}})
  r = await a.client.call(`/prep/sessions/${s2}/messages`, 'POST', { content: '不应并行', attachmentIds: [] })
  check('同一教师的并发请求被原子限制', r.status === 409)
  r = await a.client.call('/prep/sessions/' + s1, 'DELETE')
  check('活动任务存在时不能删除对话', r.status === 409)
  r = await internal(`/runs/${holdRun}/attachments/${attachmentA.id}`)
  check('可信运行器能读取本任务会话附件', r.status === 200 && r.bytes.equals(bytesA))
  r = await internal(`/runs/${holdRun}/attachments/${attachmentB.id}`)
  check('可信运行器不能混用其他会话的附件编号', r.status === 404)
  r = await internal(`/runs/${holdRun}/tool`, 'POST', { tool: 'unknown_tool', payload: {}, callId: 'invalid' })
  check('运行器不能调用未登记教学工具', r.status === 400)
  r = await internal(`/runs/${holdRun}/tool`, 'POST', { tool: 'list_classrooms', payload: {}, callId: 'list' })
  check('只读教学工具无需确认但仍使用任务教师身份', r.status === 200 && r.json.result.classes.length === 0 && !r.json.proposal)

  const originalPayload = { name: marker + '-preview', members: [{ name: '张同学', studentNo: '001', gender: '女', score: 92 }, { name: '李同学' }] }
  const toolPath = `/runs/${holdRun}/tool`
  r = await internal(toolPath, 'POST', { tool: 'create_classroom', payload: originalPayload, callId: 'create-once' })
  check('教学写入先返回待确认预览', r.status === 200 && r.json.proposal?.status === 'pending' && await prisma.classroom.count({ where: { ownerId: a.id } }) === 0)
  const proposal = r.json.proposal, proposalPath = '/prep/proposals/' + proposal.id
  r = await internal(toolPath, 'POST', { tool: 'create_classroom', payload: originalPayload, callId: 'create-once' })
  check('同一 callId 重试返回同一提案', r.status === 200 && r.json.proposal.id === proposal.id && r.json.proposal.version === proposal.version && await prisma.prepProposal.count({ where: { runId: holdRun, callId: 'create-once' } }) === 1)
  for (const [path, method, body] of [[proposalPath, 'PATCH', { payload: originalPayload, version: proposal.version }], [proposalPath + '/confirm', 'POST', { version: proposal.version }], [proposalPath + '/reject', 'POST', {}]]) {
    r = await b.client.call(path, method, body)
    check('其他账号不能处理提案 ' + method + ' ' + path.split('/').at(-1), r.status === 404)
  }
  r = await broker.call(proposalPath + '/confirm', 'POST', { version: proposal.version }, brokerHeaders)
  check('运行器凭证不能代替教师确认', r.status === 401)
  const editedPayload = { ...originalPayload, name: marker + '-confirmed' }
  r = await a.client.call(proposalPath, 'PATCH', { payload: editedPayload, version: proposal.version })
  check('教师编辑重新生成版本和预览', r.status === 200 && r.json.proposal.version !== proposal.version && r.json.proposal.payload.name === editedPayload.name && r.json.proposal.preview.changes.name === editedPayload.name)
  const edited = r.json.proposal
  r = await a.client.call(proposalPath, 'PATCH', { payload: originalPayload, version: proposal.version })
  check('旧版本编辑返回409且不覆盖新预览', r.status === 409 && (await prisma.prepProposal.findUnique({ where: { id: proposal.id } })).version === edited.version)
  r = await a.client.call(proposalPath + '/confirm', 'POST', { version: proposal.version })
  check('旧版本确认返回409且尚未执行业务', r.status === 409 && await prisma.classroom.count({ where: { ownerId: a.id } }) === 0)
  const confirms = await Promise.all([a.client.call(proposalPath + '/confirm', 'POST', { version: edited.version }), a.client.call(proposalPath + '/confirm', 'POST', { version: edited.version })])
  check('并发确认只有一份成功执行', confirms.filter(v => v.status === 200).length === 1 && confirms.filter(v => v.status === 409).length === 1)
  const applied = await prisma.prepProposal.findUnique({ where: { id: proposal.id } })
  const classes = await prisma.classroom.findMany({ where: { ownerId: a.id }, include: { members: true } })
  check('业务仅创建一个含完整名单的班级', applied.status === 'applied' && classes.length === 1 && classes[0].name === editedPayload.name && classes[0].members.length === 2 && classes[0].members.some(m => m.studentNo === '001' && m.score === 92) && await prisma.classroom.count({ where: { ownerId: b.id } }) === 0)
  r = await internal(`/runs/${holdRun}/proposals/${proposal.id}`)
  check('运行器可读取已确认的版本和执行结果', r.status === 200 && r.json.status === 'applied' && r.json.version === edited.version && r.json.payload.name === editedPayload.name && r.json.result.class.id === classes[0].id)
  r = await internal(`/runs/${firstRun}/proposals/${proposal.id}`)
  check('运行器不能把提案编号混入另一任务', r.status === 404)
  r = await a.client.call(proposalPath + '/confirm', 'POST', { version: edited.version })
  check('重复确认已处理提案不会重放业务', r.status === 409 && await prisma.classroom.count({ where: { ownerId: a.id } }) === 1)

  r = await internal(toolPath, 'POST', { tool: 'create_classroom', payload: { name: marker + '-rejected' }, callId: 'reject' })
  const rejectedId = r.json.proposal.id
  await a.client.call('/prep/proposals/' + rejectedId + '/reject', 'POST', {})
  r = await internal(`/runs/${holdRun}/proposals/${rejectedId}`)
  check('拒绝预览仅记录拒绝而不创建班级', r.status === 200 && r.json.status === 'rejected' && await prisma.classroom.count({ where: { ownerId: a.id } }) === 1)
  r = await internal(toolPath, 'POST', { tool: 'create_classroom', payload: { name: marker + '-expired' }, callId: 'expire' })
  const expired = r.json.proposal
  await prisma.prepProposal.updateMany({ where: { id: expired.id, ownerId: a.id, runId: holdRun }, data: { expiresAt: new Date(Date.now() - 1000) } })
  r = await a.client.call('/prep/proposals/' + expired.id + '/confirm', 'POST', { version: expired.version })
  check('过期提案不能确认', r.status === 409)
  r = await internal(`/runs/${holdRun}/proposals/${expired.id}`)
  check('运行器轮询能观察过期终态', r.status === 200 && r.json.status === 'expired')
  r = await internal(`/runs/${holdRun}/proposals/${proposal.id}x`)
  check('运行器不能按不存在编号读取提案', r.status === 404)

  const artifactBytes = Buffer.from('<!doctype html><meta charset="utf-8"><p>隔离备课成果</p>', 'utf8')
  r = await internal(`/runs/${holdRun}/artifacts?filename=${encodeURIComponent('教学成果.html')}`, 'POST', artifactBytes)
  check('运行器可回传生成文件并由服务端分配私有附件', r.status === 200 && r.json.attachment.kind === 'artifact' && !('storageKey' in r.json.attachment))
  const artifact = r.json.attachment
  r = await a.client.call('/prep/attachments/' + artifact.id)
  check('生成网页以附件下载且不在站点直接执行', r.status === 200 && r.bytes.equals(artifactBytes) && r.headers.get('content-disposition')?.startsWith('attachment;'))
  r = await b.client.call('/prep/attachments/' + artifact.id)
  check('生成成果同样按账号隔离', r.status === 404)
  await rememberFiles()
  const s1Files = await prisma.prepAttachment.findMany({ where: { sessionId: s1, ownerId: a.id }, select: { storageKey: true } })
  r = await internal(toolPath, 'POST', { tool: 'create_classroom', payload: { name: marker + '-cancelled' }, callId: 'cancel-pending' })
  const cancelProposal = r.json.proposal.id
  r = await b.client.call(`/prep/sessions/${s1}/cancel`, 'POST', { runId: holdRun })
  check('其他账号不能停止任务', r.status === 404 && heldJob.cancelled === false)
  r = await a.client.call(`/prep/sessions/${s2}/cancel`, 'POST', { runId: holdRun })
  check('其他会话不能混用任务编号停止', r.status === 404)
  r = await a.client.call(`/prep/sessions/${s1}/cancel`, 'POST', { runId: holdRun })
  check('停止先通知运行器再进入取消终态', r.status === 200 && heldJob.cancelled === true && (await prisma.prepRun.findUnique({ where: { id: holdRun } })).status === 'cancelled')
  const cancelledPreview = await prisma.prepProposal.findUnique({ where: { id: cancelProposal } })
  check('取消任务同时使待确认提案失效', cancelledPreview.status === 'rejected' && JSON.parse(cancelledPreview.result).cancelled === true)
  r = await internal(toolPath, 'POST', { tool: 'create_classroom', payload: { name: marker + '-after-cancel' }, callId: 'after-cancel' })
  check('取消后运行器不能继续申请教学写入', r.status === 404)
  r = await internal(`/runs/${holdRun}/input`)
  check('取消后运行器不能继续读取上下文', r.status === 404)
  r = await internal(`/runs/${holdRun}/artifacts?filename=late.txt`, 'POST', bytesA)
  check('取消后运行器不能继续回传文件', r.status === 404)
  r = await a.client.call('/prep/sessions/' + s1, 'DELETE')
  check('取消后删除同时通知远程清理', r.status === 200 && deletedSessions.get(s1) === a.id)
  const [messageCount, runCount, proposalCount, attachmentCount, eventCount] = await Promise.all([
    prisma.prepMessage.count({ where: { sessionId: s1 } }), prisma.prepRun.count({ where: { sessionId: s1 } }), prisma.prepProposal.count({ where: { sessionId: s1 } }), prisma.prepAttachment.count({ where: { sessionId: s1 } }), prisma.prepEvent.count({ where: { sessionId: s1 } }),
  ])
  check('删除对话级联清理其消息任务提案附件和事件', messageCount + runCount + proposalCount + attachmentCount + eventCount === 0)
  check('删除对话也删除上传与成果的实际字节', (await Promise.all(s1Files.map(f => exists(pathFor(f.storageKey))))).every(v => !v))
  r = await a.client.call('/prep/attachments/' + attachmentA.id)
  check('删除后旧附件地址不可读取', r.status === 404)
  r = await b.client.call('/prep/attachments/' + attachmentB.id)
  check('清理一个会话不影响另一账号的文件', r.status === 200 && r.bytes.equals(bytesB))
  r = await a.client.call('/prep/sessions/' + s2)
  check('清理旧会话不影响同账号的新会话', r.status === 200 && r.json.messages.some(m => m.content === isolatedText))
  await a.client.call('/prep/skills/' + skillA.json.skill.id, 'DELETE')
  check('教师可以移除自己的自定义 Skill', (await a.client.call('/prep/skills')).json.skills.length === 0 && (await b.client.call('/prep/skills')).json.skills.length === 1)
  console.log(`备课 API 验收 ${passed}/${passed} 通过`)
} finally {
  // Exact ID + synthetic email + nickname guard; never clear tables, Redis DBs or storage dirs.
  let cleanupError
  try {
    const fixtures = await prisma.user.findMany({ where: { id: { in: users.map(u => u.id) }, nickname: marker, email: { endsWith: '@example.invalid' } }, select: { id: true } })
    const fixtureIds = fixtures.map(u => u.id)
    await rememberFiles(fixtureIds)
    for (const [sessionId, owner] of sessions) {
      if (!fixtureIds.includes(owner.id)) continue
      const runs = await prisma.prepRun.findMany({ where: { sessionId, ownerId: owner.id, status: { in: activeStates } }, select: { id: true } })
      for (const run of runs) await owner.client.call(`/prep/sessions/${sessionId}/cancel`, 'POST', { runId: run.id }).catch(() => {})
      await owner.client.call('/prep/sessions/' + sessionId, 'DELETE').catch(() => {})
    }
    if (fixtureIds.length) await prisma.user.deleteMany({ where: { id: { in: fixtureIds }, nickname: marker, email: { endsWith: '@example.invalid' } } })
    for (const key of fileKeys) {
      if (!/^[a-f0-9]{48}$/.test(key)) throw new Error('拒绝清理非法文件键')
      await unlink(pathFor(key)).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
    check('测试临时账号和私有文件已清理', await prisma.user.count({ where: { id: { in: users.map(u => u.id) } } }) === 0 && (await Promise.all([...fileKeys].map(k => exists(pathFor(k))))).every(v => !v))
    console.log('TEST_FIXTURES_CLEANED')
  } catch (error) { cleanupError = error }
  if (serverStarted) {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  }
  await prisma.$disconnect()
  if (cleanupError) throw cleanupError
}
