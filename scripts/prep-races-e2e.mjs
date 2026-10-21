/** Isolated race regression, with its own loopback fake worker (no model/SMTP).
 * DOTENV_CONFIG_PATH=.env.race SMOKE_BASE=http://127.0.0.1:3022 node --import tsx scripts/prep-races-e2e.mjs
 * Both API and script need the same .env.race; PREP_WORKER_URL=http://127.0.0.1:3334.
 * Only this suite's synthetic user, sessions and runs are changed or deleted.
 */
import 'dotenv/config'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { prisma } from '../src/lib/db.ts'
import { signSession } from '../src/lib/auth.ts'
import { env } from '../src/env.ts'

const api = new URL(process.env.SMOKE_BASE || 'http://127.0.0.1:3022')
if (api.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(api.hostname) || api.port !== '3022' || api.pathname !== '/') throw new Error('竞态套件仅允许本机隔离 API 3022，不能连接模型验收服务')
if (new URL(env.DATABASE_URL).pathname !== '/aiq_prep_migration_test_20261021') throw new Error('竞态套件仅允许 aiq_prep_migration_test_20261021 隔离数据库')
if (!env.PREP_ENABLED || !env.PREP_WORKER_SECRET || new URL(env.PREP_WORKER_URL).origin !== 'http://127.0.0.1:3334') throw new Error('请配置隔离 API 的 PREP_ENABLED 和共享 secret，worker URL 必须是 http://127.0.0.1:3334')
if (env.PREP_DAILY_RUNS < 4) throw new Error('竞态套件需要至少4次每日任务额度')
const base = api.origin, marker = 'prep-race-' + randomBytes(6).toString('hex')
const sessions = new Set(), runIds = new Set(), jobs = new Map(), cancels = new Map(), deleted = new Set()
const activeStates = ['queued', 'running', 'waiting', 'cancelling']
let userId, cookie, started = false, passed = 0
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
function check(name, condition) { assert.ok(condition, name); passed++; console.log('PASS ' + name) }
async function until(name, predicate, timeout = 20000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await sleep(100) }
  throw new Error('等待超时：' + name)
}
async function call(path, method = 'GET', body, internal = false) {
  const response = await fetch(base + '/api/prep' + (internal ? '/internal' : '') + path, {
    method,
    headers: { ...(internal ? { authorization: 'Bearer ' + env.PREP_WORKER_SECRET } : cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
  })
  return { status: response.status, json: await response.json() }
}
const run = id => prisma.prepRun.findFirst({ where: { id, ownerId: userId } })
const classCount = () => prisma.classroom.count({ where: { ownerId: userId } })
async function newSession(label) {
  const r = await call('/sessions', 'POST', { title: marker + '-' + label })
  check('创建竞态隔离对话 ' + label, r.status === 200 && !!r.json.session?.id)
  sessions.add(r.json.session.id); return r.json.session.id
}
async function startJob(sessionId, mode) {
  const r = await call(`/sessions/${sessionId}/messages`, 'POST', { content: marker + ' [' + mode + ']', attachmentIds: [] })
  check('创建后台任务 ' + mode, r.status === 200 && !!r.json.runId)
  runIds.add(r.json.runId)
  const job = await until('fake worker 启动 ' + mode, () => jobs.get(r.json.runId))
  return job
}
async function propose(job, callId) {
  const r = await call(`/runs/${job.id}/tool`, 'POST', { tool: 'create_classroom', payload: { name: marker + '-' + callId, members: [{ name: '竞态学生', studentNo: '001' }] }, callId }, true)
  check('生成受确认边界保护的预览 ' + callId, r.status === 200 && r.json.proposal?.status === 'pending')
  return r.json.proposal
}
async function readBody(request) {
  const chunks = []; let size = 0
  for await (const chunk of request) { size += chunk.length; if (size > 1048576) throw new Error('fake request too large'); chunks.push(chunk) }
  const text = Buffer.concat(chunks).toString('utf8'); return text ? JSON.parse(text) : {}
}
const send = (response, status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
const server = createServer(async (request, response) => {
  try {
    if (request.headers.authorization !== 'Bearer ' + env.PREP_WORKER_SECRET) return send(response, 403, { error: 'forbidden' })
    const url = new URL(request.url, 'http://127.0.0.1:3334')
    if (url.pathname === '/health') return send(response, 200, { ready: true })
    if (url.pathname === '/jobs' && request.method === 'POST') {
      const body = await readBody(request)
      if (!sessions.has(body.sessionId) || body.ownerId !== userId) return send(response, 403, { error: 'unknown fixture' })
      let job = jobs.get(body.id)
      if (!job) {
        const mode = body.content.includes('[transient]') ? 'transient' : body.content.includes('[persistent]') ? 'persistent' : 'hold'
        job = { ...body, mode, status: 'running', polls: 0, pollErrors: 0, failEvents: false, cancelOffline: mode === 'persistent', cancelGate: null }
        jobs.set(body.id, job); runIds.add(body.id)
      }
      return send(response, 200, { id: body.id, status: job.status })
    }
    const eventMatch = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)\/events$/)
    if (eventMatch && request.method === 'GET') {
      const job = jobs.get(eventMatch[1]); if (!job) return send(response, 404, { error: 'unknown fixture' })
      job.polls++
      if (job.mode === 'transient' && job.pollErrors < 2 || job.failEvents) {
        job.pollErrors++; return send(response, 503, { error: 'injected poll failure' })
      }
      if (job.mode === 'transient') job.status = 'completed'
      const events = job.status === 'completed' && Number(url.searchParams.get('after') || 0) < 1 ? [{ id: 1, type: 'text', data: { text: '临时连接恢复后完成' } }] : []
      return send(response, 200, { status: job.status, events, hasMore: false, ...(job.status === 'completed' ? { response: '隔离恢复成功' } : {}) })
    }
    const cancelMatch = url.pathname.match(/^\/jobs\/([A-Za-z0-9_-]+)\/cancel$/)
    if (cancelMatch && request.method === 'POST') {
      const id = cancelMatch[1]
      if (!runIds.has(id)) return send(response, 404, { error: 'unknown fixture' })
      const record = cancels.get(id) || { attempts: 0, acknowledged: false }
      record.attempts++; cancels.set(id, record)
      const job = jobs.get(id)
      if (job?.cancelOffline) return send(response, 503, { error: 'injected cancel offline' })
      if (job?.cancelGate) await job.cancelGate.promise
      if (job) job.status = 'cancelled'
      record.acknowledged = true; record.acknowledgedAt = Date.now()
      return send(response, 200, { ok: true })
    }
    const sessionMatch = url.pathname.match(/^\/sessions\/([A-Za-z0-9_-]+)$/)
    if (sessionMatch && request.method === 'DELETE') {
      const body = await readBody(request)
      if (!sessions.has(sessionMatch[1]) || body.ownerId !== userId) return send(response, 403, { error: 'unknown fixture' })
      deleted.add(sessionMatch[1]); return send(response, 200, { ok: true })
    }
    return send(response, 404, { error: 'unknown endpoint' })
  } catch {
    if (!response.headersSent) send(response, 500, { error: 'fake worker failure' }); else response.end()
  }
})

try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3334, '127.0.0.1', resolve) }); started = true
  const user = await prisma.user.create({ data: { email: marker + '@example.invalid', nickname: marker, passwordHash: 'not-a-login-hash' } })
  userId = user.id; cookie = `${env.COOKIE_NAME}=${await signSession(user.id, user.sessionVersion)}`
  check('隔离 API 使用本套件 fake worker', (await call('/status')).json.enabled === true)

  const transientSession = await newSession('transient'), transient = await startJob(transientSession, 'transient')
  await until('第一次事件请求失败', () => transient.pollErrors >= 1)
  let current = await run(transient.id)
  check('第一次 poll 失败后任务保持活动且未假称结束', activeStates.includes(current.status) && !current.finishedAt)
  await until('第二次事件请求失败', () => transient.pollErrors >= 2)
  current = await run(transient.id)
  check('连续两次短暂 poll 失败仍保留运行器任务', ['running', 'waiting'].includes(current.status) && !current.finishedAt && !cancels.has(transient.id))
  current = await until('短暂故障恢复并完成', async () => { const row = await run(transient.id); return row?.status === 'completed' ? row : null })
  check('恢复后原任务完成且没有启动第二个 job 或误取消', transient.polls >= 3 && transient.status === 'completed' && !cancels.has(transient.id) && current.error === null)
  check('恢复后的助手结果仅持久化一次', await prisma.prepMessage.count({ where: { sessionId: transientSession, runId: transient.id, role: 'assistant', content: '隔离恢复成功' } }) === 1)

  const persistentSession = await newSession('persistent'), spareSession = await newSession('spare')
  const persistent = await startJob(persistentSession, 'persistent')
  const pending = await propose(persistent, 'stop-on-error')
  persistent.failEvents = true
  current = await until('持续故障进入待停止且远端不可达', async () => {
    const row = await run(persistent.id); return row?.status === 'cancelling' && cancels.get(persistent.id)?.attempts ? row : null
  })
  check('三次连续 poll 失败后保留 cancelling 而非提前 failed', persistent.pollErrors === 3 && current.status === 'cancelling' && !current.finishedAt && !!current.error && !cancels.get(persistent.id).acknowledged && persistent.status === 'running')
  const preservedError = current.error
  const expiredPending = await prisma.prepProposal.findUnique({ where: { id: pending.id } })
  check('执行故障使未确认提案失效', expiredPending.status === 'expired' && !!JSON.parse(expiredPending.result).error)
  let r = await call('/sessions/' + persistentSession, 'DELETE')
  check('远端尚未确认停止时禁止删除对话', r.status === 409 && !deleted.has(persistentSession))
  const beforeMessages = await prisma.prepMessage.count({ where: { sessionId: spareSession } })
  r = await call(`/sessions/${spareSession}/messages`, 'POST', { content: '不应开始新任务', attachmentIds: [] })
  check('待停止任务阻止同教师创建新 run 且不写半条消息', r.status === 409 && await prisma.prepMessage.count({ where: { sessionId: spareSession } }) === beforeMessages)
  const pollCount = persistent.polls, cancelAttempts = cancels.get(persistent.id).attempts
  await sleep(1800)
  current = await run(persistent.id)
  check('后台继续补停而不是重新启动或继续 poll 孤立任务', current.status === 'cancelling' && persistent.polls === pollCount && cancels.get(persistent.id).attempts > cancelAttempts)
  persistent.cancelOffline = false
  current = await until('远端恢复后补停并最终失败', async () => { const row = await run(persistent.id); return row?.status === 'failed' ? row : null })
  check('远端确认取消后才终结 failed 并保留原错误', cancels.get(persistent.id).acknowledged && persistent.status === 'cancelled' && !!current.finishedAt && current.error === preservedError && current.finishedAt.getTime() >= cancels.get(persistent.id).acknowledgedAt - 1000)
  check('失败任务不产生伪造的完成回复', await prisma.prepMessage.count({ where: { sessionId: persistentSession, role: 'assistant' } }) === 0)

  const executingSession = await newSession('executing'), executingJob = await startJob(executingSession, 'hold')
  const executingProposal = await propose(executingJob, 'already-claimed')
  // A deterministic fixture at the exact durable boundary after confirm's claim.
  await prisma.prepProposal.updateMany({ where: { id: executingProposal.id, ownerId: userId, runId: executingJob.id, status: 'pending' }, data: { status: 'executing' } })
  const executingStatus = (await run(executingJob.id)).status
  r = await call(`/sessions/${executingSession}/cancel`, 'POST', { runId: executingJob.id })
  check('已 claim 的业务操作执行时 cancel 明确409', r.status === 409 && (await run(executingJob.id)).status === executingStatus && !cancels.has(executingJob.id))
  r = await call('/sessions/' + executingSession, 'DELETE')
  check('executing 期间删除对话被拒绝', r.status === 409 && !deleted.has(executingSession))
  check('executing fixture 不伪造任何业务写入', await classCount() === 0)
  // Exercise the explicit guard independently of the ordinary active-run guard.
  executingJob.status = 'completed'
  await prisma.prepRun.updateMany({ where: { id: executingJob.id, ownerId: userId }, data: { status: 'completed', finishedAt: new Date() } })
  r = await call('/sessions/' + executingSession, 'DELETE')
  check('run 已终结但仍有 executing 提案时删除仍409', r.status === 409 && !deleted.has(executingSession))
  r = await call(`/sessions/${executingSession}/cancel`, 'POST', { runId: executingJob.id })
  check('run 已终结也不能把 executing 操作报告为已停止', r.status === 409 && (await run(executingJob.id)).status === 'completed')
  await prisma.prepProposal.updateMany({ where: { id: executingProposal.id, ownerId: userId, status: 'executing' }, data: { status: 'rejected', result: JSON.stringify({ fixtureReleased: true }) } })
  r = await call('/sessions/' + executingSession, 'DELETE')
  check('executing 边界释放后才允许清理终态对话', r.status === 200 && deleted.has(executingSession))

  const cancelSession = await newSession('cancel-wins'), cancelJob = await startJob(cancelSession, 'hold')
  const cancelProposal = await propose(cancelJob, 'cancel-wins')
  cancelJob.cancelGate = deferred()
  const cancellation = call(`/sessions/${cancelSession}/cancel`, 'POST', { runId: cancelJob.id })
  await until('取消先取得 run 锁并等待远端确认', async () => (await run(cancelJob.id))?.status === 'cancelling' && !!cancels.get(cancelJob.id)?.attempts)
  check('远端确认前取消保持中间态并未假称停止', !(await run(cancelJob.id)).finishedAt && !cancels.get(cancelJob.id).acknowledged)
  r = await call('/proposals/' + cancelProposal.id + '/confirm', 'POST', { version: cancelProposal.version })
  check('取消先取得 run 锁后 confirm 返回409且无业务写入', r.status === 409 && await classCount() === 0 && (await prisma.prepProposal.findUnique({ where: { id: cancelProposal.id } })).status === 'rejected')
  r = await call('/sessions/' + cancelSession, 'DELETE')
  check('取消等待远端 ack 时仍禁止删除', r.status === 409 && !deleted.has(cancelSession))
  cancelJob.cancelGate.resolve()
  r = await cancellation
  check('收到远端 ack 后取消完成且没有应用已失效提案', r.status === 200 && r.json.status === 'cancelled' && (await run(cancelJob.id)).status === 'cancelled' && cancels.get(cancelJob.id).acknowledged && await classCount() === 0)
  r = await call(`/runs/${cancelJob.id}/tool`, 'POST', { tool: 'create_classroom', payload: { name: marker + '-late' }, callId: 'late' }, true)
  check('取消后的迟到工具回调不能重新建立 waiting 状态', r.status === 404 && (await run(cancelJob.id)).status === 'cancelled')

  const deadlineSession = await newSession('old-deadline')
  const originalStart = new Date(Date.now() - env.PREP_RUN_TIMEOUT_MINUTES * 60000 - 5000)
  const overdue = await prisma.$transaction(async tx => {
    const message = await tx.prepMessage.create({ data: { sessionId: deadlineSession, role: 'user', content: marker + ' [hold] restored-old-run', attachmentIds: '[]' } })
    const row = await tx.prepRun.create({ data: { sessionId: deadlineSession, ownerId: userId, messageId: message.id, status: 'queued', startedAt: originalStart } })
    runIds.add(row.id)
    await tx.prepMessage.update({ where: { id: message.id }, data: { runId: row.id } }); return row
  })
  current = await until('已超时持久任务恢复后立即补停', async () => { const row = await run(overdue.id); return row?.status === 'failed' ? row : null })
  check('恢复不会重置 startedAt 延长原有时限', current.startedAt.getTime() === originalStart.getTime() && current.error?.includes('运行时限') && !jobs.has(overdue.id))
  check('超时恢复也先确认远端停止再暴露终态', !!cancels.get(overdue.id)?.acknowledged && !!current.finishedAt)
  console.log(`备课竞态 API 验收 ${passed}/${passed} 通过`)
} finally {
  let cleanupError
  try {
    for (const job of jobs.values()) { job.cancelOffline = false; job.failEvents = false; job.cancelGate?.resolve() }
    const fixture = userId ? await prisma.user.findFirst({ where: { id: userId, nickname: marker, email: marker + '@example.invalid' }, select: { id: true } }) : null
    if (fixture) {
      // Release only this suite's artificial executing fixture if an assertion aborted.
      await prisma.prepProposal.updateMany({ where: { ownerId: fixture.id, sessionId: { in: [...sessions] }, status: 'executing' }, data: { status: 'rejected', result: JSON.stringify({ fixtureCleanup: true }) } })
      for (const sessionId of sessions) {
        const active = await prisma.prepRun.findMany({ where: { sessionId, ownerId: fixture.id, status: { in: activeStates } }, select: { id: true } })
        for (const row of active) await call(`/sessions/${sessionId}/cancel`, 'POST', { runId: row.id }).catch(() => {})
        await call('/sessions/' + sessionId, 'DELETE').catch(() => {})
      }
      for (const id of runIds) if (started) await fetch('http://127.0.0.1:3334/jobs/' + id + '/cancel', { method: 'POST', headers: { authorization: 'Bearer ' + env.PREP_WORKER_SECRET }, signal: AbortSignal.timeout(3000) }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: fixture.id, nickname: marker, email: marker + '@example.invalid' } })
      check('仅清理本套件临时账号及关联数据', await prisma.user.count({ where: { id: fixture.id } }) === 0 && await prisma.prepRun.count({ where: { id: { in: [...runIds] } } }) === 0)
      console.log('TEST_FIXTURES_CLEANED')
    }
  } catch (error) { cleanupError = error }
  if (started) await new Promise(resolve => { server.close(resolve); server.closeAllConnections() })
  await prisma.$disconnect()
  if (cleanupError) throw cleanupError
}
