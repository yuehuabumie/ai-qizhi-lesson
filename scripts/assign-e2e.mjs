#!/usr/bin/env node
/**
 * 班级作业端到端验收：绘本 / 互动练习 / 课程任务 三类内容。
 *
 *   node scripts/assign-e2e.mjs
 *
 * 在服务器上直连 127.0.0.1:3020，需要 sudo mysql / redis-cli（注册取证码）。
 * 会真的发一封验证码邮件；脚本结束自动删掉测试班级、作品与账号。
 * 测试账号昵称固定为 NICKNAME，删除前有 vs. cleanupUser 的昵称护栏。
 */
import { randomBytes } from 'node:crypto'
import { makeChecker, makeClient, registerUser, cleanupUser } from './lib/kit.mjs'

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:3020'
const EMAIL = process.env.ASSIGN_E2E_EMAIL || '301@301.group'
const NICKNAME = '作业冒烟测试'
const PASSWORD = 'Assign-' + randomBytes(6).toString('hex')

const { check, summary } = makeChecker()
const teacher = makeClient(BASE)
const tcall = teacher.call

// 学生端用作业 cookie（aiq_assign），kit 的客户端只认 aiq_session，这里单独做。
function makeStudent() {
  const jar = new Map()
  async function call(path, { method = 'GET', body } = {}) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';')
      const i = pair.indexOf('=')
      const name = pair.slice(0, i)
      const value = pair.slice(i + 1)
      if (!value || /expires=thu, 01 jan 1970/i.test(line)) jar.delete(name)
      else jar.set(name, value)
    }
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      /* 非 JSON 响应原样保留在 text */
    }
    return { status: res.status, json, text }
  }
  return { call, hasAssignCookie: () => jar.has('aiq_assign') }
}

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let classId = ''

async function bestEffortCleanup() {
  try {
    if (classId) {
      const detail = await tcall(`/api/classes/${classId}`)
      const assignments = detail.json?.class?.assignments ?? []
      for (const a of assignments) {
        const full = await tcall(`/api/classes/${classId}/assignments/${a.id}`)
        for (const m of full.json?.members ?? []) {
          if (!m.submissionId) continue
          if (m.work?.published) {
            await tcall(
              `/api/classes/${classId}/assignments/${a.id}/submissions/${m.submissionId}/publish`,
              { method: 'DELETE' },
            )
          }
          await tcall(`/api/classes/${classId}/assignments/${a.id}/submissions/${m.submissionId}/reset`, {
            method: 'POST',
          })
        }
      }
      await tcall(`/api/classes/${classId}`, { method: 'DELETE' })
    }
  } catch (err) {
    console.error('  ⚠️  清理班级失败:', err.message)
  }
  cleanupUser(BASE, EMAIL, NICKNAME)
}

console.log(`\n班级作业验收 @ ${BASE}   测试账号=${EMAIL}\n`)
cleanupUser(BASE, EMAIL, NICKNAME)

try {
  console.log('【教师注册与建班】')
  await registerUser(teacher, { email: EMAIL, password: PASSWORD, nickname: NICKNAME })
  check('注册测试教师成功', teacher.jar !== '', 'session cookie 缺失')

  const cls = await tcall('/api/classes', { method: 'POST', body: { name: '三类作业验收班' } })
  classId = cls.json?.class?.id || ''
  check('创建班级', cls.status === 200 && !!classId, `${cls.status} ${cls.text.slice(0, 120)}`)

  const mem = await tcall(`/api/classes/${classId}/members`, {
    method: 'POST',
    body: { names: ['小明', '小红', '小刚'] },
  })
  check('导入 3 名成员', mem.status === 200 && mem.json?.added === 3, mem.text.slice(0, 120))

  console.log('\n【创建三类作业】')
  const storyRes = await tcall(`/api/classes/${classId}/assignments`, {
    method: 'POST',
    body: { title: '静夜思绘本创作', type: 'storybook', instructions: '完成 1 页绘本' },
  })
  const storyA = storyRes.json?.assignment
  check(
    '创建绘本作业',
    storyRes.status === 200 && storyA?.type === 'storybook' && !!storyA?.token,
    storyRes.text.slice(0, 120),
  )

  const labRes = await tcall(`/api/classes/${classId}/assignments`, {
    method: 'POST',
    body: { title: '设备辨别挑战', type: 'lab', labId: 'device-detection', instructions: '尽量拿高分' },
  })
  const labA = labRes.json?.assignment
  check(
    '创建互动练习作业并保存 labId',
    labRes.status === 200 && labA?.type === 'lab' && labA?.labId === 'device-detection',
    labRes.text.slice(0, 120),
  )

  const taskRes = await tcall(`/api/classes/${classId}/assignments`, {
    method: 'POST',
    body: {
      title: 'AI 大搜寻记录',
      type: 'task',
      moduleId: 'm1',
      stage: 'low',
      activity: 'AI 大搜寻',
      toolLabId: 'ai-senses',
      instructions: '写下发现并拍一张照片',
    },
  })
  const taskA = taskRes.json?.assignment
  check(
    '创建课程任务作业并保存模块/学段/活动/工具台',
    taskRes.status === 200 &&
      taskA?.type === 'task' &&
      taskA?.moduleId === 'm1' &&
      taskA?.stage === 'low' &&
      taskA?.activity === 'AI 大搜寻' &&
      taskA?.toolLabId === 'ai-senses',
    taskRes.text.slice(0, 160),
  )

  const badLab = await tcall(`/api/classes/${classId}/assignments`, {
    method: 'POST',
    body: { title: '缺练习', type: 'lab' },
  })
  check('互动练习缺少 labId 被拒（400）', badLab.status === 400, String(badLab.status))

  const badTask = await tcall(`/api/classes/${classId}/assignments`, {
    method: 'POST',
    body: { title: '缺任务', type: 'task', moduleId: 'm1', stage: 'low' },
  })
  check('课程任务缺少活动被拒（400）', badTask.status === 400, String(badTask.status))

  const badLabId = await tcall(`/api/classes/${classId}/assignments`, {
    method: 'POST',
    body: { title: '假练习', type: 'lab', labId: 'not-a-lab' },
  })
  check('未知 labId 被拒（400）', badLabId.status === 400, String(badLabId.status))

  console.log('\n【作业列表与链接】')
  const detail = await tcall(`/api/classes/${classId}`)
  const listed = detail.json?.class?.assignments ?? []
  check('班级详情返回 3 份作业且类型正确', listed.length === 3, String(listed.length))
  check(
    '每份作业都带 submitted/total',
    listed.every((a) => a.submitted === 0 && a.total === 3),
    JSON.stringify(listed.map((a) => [a.type, a.submitted, a.total])),
  )

  const rotated = await tcall(`/api/classes/${classId}/assignments/${storyA.id}/rotate-link`, {
    method: 'POST',
  })
  const newToken = rotated.json?.token
  const oldLink = await fetch(`${BASE}/api/assign/${storyA.token}`)
  const newLink = await fetch(`${BASE}/api/assign/${newToken}`)
  check(
    '轮换链接后旧 token 失效、新 token 可用',
    oldLink.status === 404 && newLink.status === 200,
    `${oldLink.status}/${newLink.status}`,
  )
  const storyToken = newToken

  console.log('\n【学生身份校验】')
  const s1 = makeStudent()
  const wrong = await s1.call(`/api/assign/${storyToken}/verify`, {
    method: 'POST',
    body: { name: '查无此人' },
  })
  check('名单外姓名被拒（403）', wrong.status === 403, String(wrong.status))
  const okName = await s1.call(`/api/assign/${storyToken}/verify`, {
    method: 'POST',
    body: { name: '小明' },
  })
  check(
    '名单内姓名进入作业并拿到 aiq_assign cookie',
    okName.status === 200 && okName.json?.member?.name === '小明' && s1.hasAssignCookie(),
    okName.text.slice(0, 120),
  )

  const s2 = makeStudent()
  const ok2 = await s2.call(`/api/assign/${labA.token}/verify`, { method: 'POST', body: { name: '小红' } })
  check('小红进入互动练习作业', ok2.status === 200 && s2.hasAssignCookie(), ok2.text.slice(0, 120))

  const s3 = makeStudent()
  const ok3 = await s3.call(`/api/assign/${taskA.token}/verify`, { method: 'POST', body: { name: '小刚' } })
  check('小刚进入课程任务作业', ok3.status === 200 && s3.hasAssignCookie(), ok3.text.slice(0, 120))

  console.log('\n【提交校验】')
  const wrongKind = await s2.call(`/api/assign/${labA.token}/submit`, {
    method: 'POST',
    body: { kind: 'task', text: '错类型' },
  })
  check('互动练习作业拒绝 task 提交体（400）', wrongKind.status === 400, wrongKind.text.slice(0, 120))

  const mismatch = await s2.call(`/api/assign/${labA.token}/submit`, {
    method: 'POST',
    body: { kind: 'lab', labId: 'quiz-arena', score: 50 },
  })
  check('labId 与作业不符被拒（400）', mismatch.status === 400, mismatch.text.slice(0, 120))

  const aiBlocked = await s2.call('/api/ai/storybook', {
    method: 'POST',
    body: { prompt: '画一只猫' },
  })
  check('互动练习作业不能调用绘本 AI（403）', aiBlocked.status === 403, aiBlocked.text.slice(0, 120))

  const emptyTask = await s3.call(`/api/assign/${taskA.token}/submit`, {
    method: 'POST',
    body: { kind: 'task', text: '   ', images: [] },
  })
  check('空课程任务提交被拒（400）', emptyTask.status === 400, emptyTask.text.slice(0, 120))

  console.log('\n【三类提交】')
  const storySubmit = await s1.call(`/api/assign/${storyToken}/submit`, {
    method: 'POST',
    body: {
      kind: 'storybook',
      poemName: '静夜思',
      pages: [{ who: '李白', where: '窗前', doing: '望月', color: '冷蓝', mood: '思念', image: TINY_PNG }],
    },
  })
  check(
    '绘本作业提交成功',
    storySubmit.status === 200 && storySubmit.json?.submission?.pages === 1,
    storySubmit.text.slice(0, 160),
  )

  const meStory = await s1.call(`/api/assign/${storyToken}/me`)
  check(
    '绘本提交后 /me 返回已保存的页面',
    meStory.status === 200 &&
      meStory.json?.submission?.status === 'submitted' &&
      meStory.json?.submission?.content?.pages?.length === 1,
    meStory.text.slice(0, 160),
  )

  const labSubmit = await s2.call(`/api/assign/${labA.token}/submit`, {
    method: 'POST',
    body: {
      kind: 'lab',
      labId: 'device-detection',
      score: 87,
      note: '找到了 9 个设备',
      work: {
        title: '设备搜寻记录',
        type: '互动练习',
        module: 'm1',
        grade: 'low',
        desc: '在教室里找到 9 个智能设备',
        hue: 210,
      },
    },
  })
  check(
    '互动练习作业提交成功并记录得分',
    labSubmit.status === 200 && labSubmit.json?.submission?.score === 87,
    labSubmit.text.slice(0, 160),
  )

  const meLab = await s2.call(`/api/assign/${labA.token}/me`)
  check(
    '互动练习 /me 返回分数与作品信息',
    meLab.json?.submission?.score === 87 &&
      meLab.json?.submission?.content?.labId === 'device-detection' &&
      meLab.json?.submission?.content?.work?.title === '设备搜寻记录',
    meLab.text.slice(0, 200),
  )

  const taskSubmit = await s3.call(`/api/assign/${taskA.token}/submit`, {
    method: 'POST',
    body: { kind: 'task', text: '我找到智能音箱、扫地机器人。', images: [TINY_PNG] },
  })
  check(
    '课程任务提交文字 + 照片成功',
    taskSubmit.status === 200 && taskSubmit.json?.submission?.images === 1,
    taskSubmit.text.slice(0, 160),
  )

  const meTask = await s3.call(`/api/assign/${taskA.token}/me`)
  check(
    '课程任务 /me 返回文字与站内图片地址',
    meTask.json?.submission?.content?.text?.includes('智能音箱') &&
      meTask.json?.submission?.content?.images?.[0]?.startsWith('/uploads/works/'),
    meTask.text.slice(0, 200),
  )

  console.log('\n【教师查看完成情况】')
  const storyDetail = await tcall(`/api/classes/${classId}/assignments/${storyA.id}`)
  check(
    '教师端绘本作业统计 1/3',
    storyDetail.json?.stats?.submitted === 1 && storyDetail.json?.stats?.total === 3,
    JSON.stringify(storyDetail.json?.stats),
  )
  check(
    '教师端名单显示小明已提交',
    storyDetail.json?.members?.find((m) => m.name === '小明')?.status === 'submitted',
    JSON.stringify(storyDetail.json?.members?.map((m) => [m.name, m.status])),
  )

  const labDetail = await tcall(`/api/classes/${classId}/assignments/${labA.id}`)
  const labRow = labDetail.json?.members?.find((m) => m.name === '小红')
  check('教师端互动练习显示得分', labRow?.status === 'submitted' && labRow?.score === 87, JSON.stringify(labRow))

  const taskDetail = await tcall(`/api/classes/${classId}/assignments/${taskA.id}`)
  const taskRow = taskDetail.json?.members?.find((m) => m.name === '小刚')
  check(
    '教师端课程任务显示照片数与文字标记',
    taskRow?.status === 'submitted' && taskRow?.imageCount === 1 && taskRow?.hasText === true,
    JSON.stringify(taskRow),
  )

  const storySubId = storyDetail.json?.members?.find((m) => m.name === '小明')?.submissionId
  const labSubId = labDetail.json?.members?.find((m) => m.name === '小红')?.submissionId
  const taskSubId = taskDetail.json?.members?.find((m) => m.name === '小刚')?.submissionId

  const storySub = await tcall(`/api/classes/${classId}/assignments/${storyA.id}/submissions/${storySubId}`)
  check(
    '教师端绘本详情返回页面内容',
    storySub.json?.submission?.poemName === '静夜思' && storySub.json?.submission?.pages?.length === 1,
    storySub.text.slice(0, 160),
  )
  const labSub = await tcall(`/api/classes/${classId}/assignments/${labA.id}/submissions/${labSubId}`)
  check(
    '教师端互动练习详情返回得分与作品',
    labSub.json?.submission?.lab?.score === 87 && labSub.json?.submission?.lab?.work?.title === '设备搜寻记录',
    labSub.text.slice(0, 200),
  )
  const taskSub = await tcall(`/api/classes/${classId}/assignments/${taskA.id}/submissions/${taskSubId}`)
  check(
    '教师端课程任务详情返回文字与图片',
    taskSub.json?.submission?.task?.text?.includes('智能音箱') &&
      taskSub.json?.submission?.task?.images?.length === 1,
    taskSub.text.slice(0, 200),
  )

  console.log('\n【发布到成果展厅】')
  const publishStory = await tcall(
    `/api/classes/${classId}/assignments/${storyA.id}/submissions/${storySubId}/publish`,
    { method: 'POST', body: { author: '小明' } },
  )
  check('绘本发布成功', publishStory.status === 200 && !!publishStory.json?.work?.id, publishStory.text.slice(0, 160))

  const publishLab = await tcall(
    `/api/classes/${classId}/assignments/${labA.id}/submissions/${labSubId}/publish`,
    { method: 'POST', body: { author: '小红' } },
  )
  check(
    '互动练习发布成功并采用作品标题/类型',
    publishLab.status === 200 && publishLab.json?.work?.title === '设备搜寻记录',
    publishLab.text.slice(0, 160),
  )

  const publishTask = await tcall(
    `/api/classes/${classId}/assignments/${taskA.id}/submissions/${taskSubId}/publish`,
    { method: 'POST', body: { author: '小刚' } },
  )
  check(
    '课程任务发布成功',
    publishTask.status === 200 && publishTask.json?.work?.title === 'AI 大搜寻记录',
    publishTask.text.slice(0, 160),
  )

  const repeat = await tcall(
    `/api/classes/${classId}/assignments/${labA.id}/submissions/${labSubId}/publish`,
    { method: 'POST', body: { author: '小红' } },
  )
  check('重复发布保持幂等', repeat.status === 200 && repeat.json?.alreadyPublished === true, repeat.text.slice(0, 120))

  const gallery = await fetch(`${BASE}/api/works?page=1&pageSize=50`).then((r) => r.json())
  const galleryTitles = (gallery.works ?? []).map((w) => w.title)
  check(
    '展厅出现三件新作品',
    galleryTitles.some((t) => t.startsWith('《静夜思》')) &&
      galleryTitles.includes('设备搜寻记录') &&
      galleryTitles.includes('AI 大搜寻记录'),
    JSON.stringify(galleryTitles.slice(0, 6)),
  )

  console.log('\n【撤下、重置与重新提交】')
  const unpub = await tcall(
    `/api/classes/${classId}/assignments/${taskA.id}/submissions/${taskSubId}/publish`,
    { method: 'DELETE' },
  )
  check('撤下课程任务作品', unpub.status === 200 && unpub.json?.published === false, unpub.text.slice(0, 120))

  const reset = await tcall(
    `/api/classes/${classId}/assignments/${taskA.id}/submissions/${taskSubId}/reset`,
    { method: 'POST' },
  )
  check('撤销后重置课程任务提交', reset.status === 200, reset.text.slice(0, 120))

  const meAfterReset = await s3.call(`/api/assign/${taskA.token}/me`)
  check(
    '重置后学生 /me 回到未提交且内容清空',
    meAfterReset.json?.submission?.status === 'started' && meAfterReset.json?.submission?.content === null,
    meAfterReset.text.slice(0, 160),
  )

  const resubmit = await s3.call(`/api/assign/${taskA.token}/submit`, {
    method: 'POST',
    body: { kind: 'task', text: '重新提交：补充了语音助手。', images: [] },
  })
  check('重置后允许重新提交', resubmit.status === 200, resubmit.text.slice(0, 160))

  const blockedReset = await tcall(
    `/api/classes/${classId}/assignments/${storyA.id}/submissions/${storySubId}/reset`,
    { method: 'POST' },
  )
  check('已发布作品不能直接重置（403）', blockedReset.status === 403, String(blockedReset.status))

  console.log('\n【清理】')
  for (const [a, s] of [
    [storyA, storySubId],
    [labA, labSubId],
  ]) {
    await tcall(`/api/classes/${classId}/assignments/${a.id}/submissions/${s}/publish`, { method: 'DELETE' })
    await tcall(`/api/classes/${classId}/assignments/${a.id}/submissions/${s}/reset`, { method: 'POST' })
  }
  const del = await tcall(`/api/classes/${classId}`, { method: 'DELETE' })
  check('删除测试班级', del.status === 200, del.text.slice(0, 120))
  classId = ''
  cleanupUser(BASE, EMAIL, NICKNAME)
  check('测试账号已清理', true)
} catch (err) {
  console.error('\n验收脚本异常：', err)
  await bestEffortCleanup()
  process.exitCode = 1
}

const failed = summary()
if (failed) process.exitCode = 1
