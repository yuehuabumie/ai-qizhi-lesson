import { randomBytes } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/db.js'
import { requireUser } from '../lib/auth.js'
import { parseBody } from '../lib/validate.js'
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors.js'
import { clientIp, enforce } from '../lib/rate-limit.js'
import { memberInputSchema, memberPatchSchema, rosterOperationSchema, planRosterOperations, assertRoster, assertGroupPartition, rosterNameKey, type RosterMember, type RosterOperation } from '../lib/teaching-roster.js'
import { quizDefinitionSchema, quizSubmitSchema, parseQuizDefinition, projectQuiz, gradeQuiz, parseQuizSubmission, studentQuizResult } from '../lib/teaching-quiz.js'
import {
  ASSIGN_AI_LIMIT,
  assignTokenField,
  clearAssignmentCookie,
  normalizeMemberName,
  optionalAssignment,
  requireAssignment,
  setAssignmentCookie,
  signAssignmentSession,
} from '../lib/assignment.js'
import {
  copyWorkImages,
  isStoredWorkImage,
  parseStoredImages,
  persistWorkImages,
  removeWorkImages,
  serializeImages,
} from '../lib/work-images.js'
import {
  ASSIGN_LAB_IDS,
  ASSIGN_MODULE_IDS,
  ASSIGN_STAGES,
  labById,
} from '../lib/assign-catalog.js'

/**
 * 班级、名单与作业链接。
 *
 * 权限边界：
 *   · /classes*        登录 + 班级所有者；老师只能看到自己建的班。
 *   · /assign/:token  公开元信息与姓名校验；凭姓名签发一份只属于该作业的会话。
 *   · /assign/:token/submit  学生会话，只能提交自己那一条记录。
 *
 * 作业链接本身就是凭证，token 32 字节随机；轮换 token 会同时作废旧链接
 * 和已经签发的学生会话（会话里带着签发时的 token）。
 */

const MAX_CLASSES = 20
const MAX_MEMBERS = 100
const MAX_ASSIGNMENTS = 50
const MAX_PAGES = 8
const MAX_SUBMIT_BYTES = 12 * 1024 * 1024

const idField = z
  .string({ message: '编号不正确' })
  .trim()
  .min(1, '编号不正确')
  .max(40, '编号不正确')
  .regex(/^[A-Za-z0-9_-]+$/, '编号不正确')

const tokenField = z.string({ message: '作业链接不正确' }).trim().regex(assignTokenField, '作业链接不正确')

const classNameField = z
  .string({ message: '请填写班级名称' })
  .trim()
  .min(1, '请填写班级名称')
  .max(60, '班级名称最多 60 字')

const memberNameField = z
  .string({ message: '请填写姓名' })
  .max(120, '姓名太长')
  .transform(normalizeMemberName)
  .refine((v) => v.length >= 1 && v.length <= 30, '姓名需要 1–30 个字')

const assignmentTitleField = z
  .string({ message: '请填写作业名称' })
  .trim()
  .min(1, '请填写作业名称')
  .max(120, '作业名称最多 120 字')

const instructionsField = z.string().trim().max(1000, '作业说明最多 1000 字')

const assignTypeField = z.enum(['storybook', 'lab', 'task', 'quiz'], { message: '不支持的作业类型' }).default('storybook')

const labIdField = z
  .string({ message: '请选择互动练习' })
  .trim()
  .refine((v) => ASSIGN_LAB_IDS.includes(v), '不支持的互动练习')

const moduleIdField = z.enum(ASSIGN_MODULE_IDS, { message: '课程模块不正确' })
const stageField = z.enum(ASSIGN_STAGES, { message: '学段不正确' })
const activityField = z.string({ message: '请选择课程任务' }).trim().min(1, '请选择课程任务').max(120, '任务名称太长')

const assignmentBody = z
  .object({
    title: assignmentTitleField,
    type: assignTypeField,
    instructions: instructionsField.default(''),
    labId: labIdField.optional(),
    moduleId: moduleIdField.optional(),
    stage: stageField.optional(),
    activity: activityField.optional(),
    toolLabId: labIdField.optional(),
    status: z.enum(['draft', 'open', 'closed']).default('open'),
    quiz: quizDefinitionSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'lab' && !v.labId) {
      ctx.addIssue({ code: 'custom', path: ['labId'], message: '请选择互动练习' })
    }
    if (v.type === 'task' && (!v.moduleId || !v.stage || !v.activity)) {
      ctx.addIssue({ code: 'custom', path: ['activity'], message: '请选择课程任务' })
    }
    if (v.type === 'quiz' && !v.quiz) ctx.addIssue({ code: 'custom', path: ['quiz'], message: '请填写试卷题目' })
    if (v.type !== 'quiz' && v.quiz) ctx.addIssue({ code: 'custom', path: ['quiz'], message: '当前作业类型不支持试卷' })
  })

const dataImage = z
  .string({ message: '图片格式不正确' })
  .trim()
  .min(1, '图片格式不正确')
  .refine(
    (v) => /^https:\/\/\S+$/i.test(v) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(v),
    '图片格式不正确',
  )

const imageSrcField = dataImage.max(400_000, '单张图片太大')
// 课程任务允许学生直接传手机拍的作业照片，刻意不压缩（见 HANDOFF 的图片约定）
const taskImageSrcField = dataImage.max(2_000_000, '单张图片太大（最多约 1.5MB）')

const submitPageField = z.object({
  who: z.string().trim().min(1, '还有页面没写「谁」').max(40, '人物描述太长'),
  where: z.string().trim().min(1, '还有页面没写「在哪」').max(40, '场景描述太长'),
  doing: z.string().trim().min(1, '还有页面没写「做什么」').max(80, '动作描述太长'),
  color: z.string().trim().max(10).default(''),
  mood: z.string().trim().max(10).default(''),
  image: imageSrcField,
})

const storybookSubmitBody = z.object({
  kind: z.literal('storybook').optional(),
  poemName: z.string().trim().min(1, '故事标题缺失').max(40, '故事标题太长'),
  pages: z
    .array(submitPageField, { message: '页面数据不正确' })
    .min(1, '至少要有一页')
    .max(MAX_PAGES, `最多 ${MAX_PAGES} 页`),
})

const labWorkField = z.object({
  title: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(32),
  module: z.string().trim().min(1).max(8),
  grade: z.string().trim().min(1).max(8),
  desc: z.string().trim().max(1000).default(''),
  hue: z.number().int().min(0).max(360).optional(),
})

const labSubmitBody = z.object({
  kind: z.literal('lab'),
  labId: z.string().trim().min(1).max(40),
  score: z.number().int().min(0).max(100),
  note: z.string().trim().max(1000).default(''),
  work: labWorkField.nullish(),
})

const taskSubmitBody = z.object({
  kind: z.literal('task'),
  text: z.string().trim().max(5000, '作业内容最多 5000 字').default(''),
  images: z.array(taskImageSrcField, { message: '图片格式不正确' }).max(4, '最多上传 4 张图片').default([]),
})

const publishBody = z.object({
  author: z.string().trim().max(60, '署名最多 60 字').optional(),
})

interface StoredPage {
  who: string
  where: string
  doing: string
  color: string
  mood: string
  image: string
}

interface StoredContent {
  version: 1
  poemName: string
  pages: StoredPage[]
}

interface LabWork {
  title: string
  type: string
  module: string
  grade: string
  desc: string
  hue?: number
}

interface StoredLabContent {
  version: 1
  labId: string
  score: number
  note: string
  work: LabWork | null
}

interface StoredTaskContent {
  version: 1
  text: string
  images: string[]
}

function parseContent(raw: string | null | undefined): StoredContent | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as {
      version?: unknown
      poemName?: unknown
      pages?: unknown
    }
    if (value.version !== 1 || !Array.isArray(value.pages) || !value.pages.length) return null
    const pages: StoredPage[] = []
    for (const item of value.pages) {
      if (!item || typeof item !== 'object') return null
      const p = item as Record<string, unknown>
      if (
        typeof p.who !== 'string' ||
        typeof p.where !== 'string' ||
        typeof p.doing !== 'string' ||
        typeof p.color !== 'string' ||
        typeof p.mood !== 'string' ||
        !isStoredWorkImage(p.image)
      ) {
        return null
      }
      pages.push({
        who: p.who,
        where: p.where,
        doing: p.doing,
        color: p.color,
        mood: p.mood,
        image: p.image,
      })
    }
    return {
      version: 1,
      poemName: typeof value.poemName === 'string' ? value.poemName.slice(0, 40) : '',
      pages: pages.slice(0, MAX_PAGES),
    }
  } catch {
    return null
  }
}

function parseLabContent(raw: string | null | undefined): StoredLabContent | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (value.version !== 1 || typeof value.labId !== 'string' || !labById(value.labId)) return null
    const score = Number(value.score)
    if (!Number.isInteger(score) || score < 0 || score > 100) return null
    const workRaw = value.work
    let work: LabWork | null = null
    if (workRaw && typeof workRaw === 'object') {
      const w = workRaw as Record<string, unknown>
      if (
        typeof w.title === 'string' &&
        typeof w.type === 'string' &&
        typeof w.module === 'string' &&
        typeof w.grade === 'string'
      ) {
        work = {
          title: w.title.slice(0, 120),
          type: w.type.slice(0, 32),
          module: w.module.slice(0, 8),
          grade: w.grade.slice(0, 8),
          desc: typeof w.desc === 'string' ? w.desc.slice(0, 1000) : '',
          hue: Number.isInteger(w.hue) ? Number(w.hue) : undefined,
        }
      }
    }
    return {
      version: 1,
      labId: value.labId,
      score,
      note: typeof value.note === 'string' ? value.note.slice(0, 1000) : '',
      work,
    }
  } catch {
    return null
  }
}

function parseTaskContent(raw: string | null | undefined): StoredTaskContent | null {
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    if (value.version !== 1 || typeof value.text !== 'string') return null
    const images = Array.isArray(value.images) ? value.images : []
    if (!images.every((img) => typeof img === 'string' && isStoredWorkImage(img))) return null
    return {
      version: 1,
      text: value.text.slice(0, 5000),
      images: images.slice(0, 4),
    }
  } catch {
    return null
  }
}

const contentImages = (content: StoredContent | null): string[] =>
  content ? content.pages.map((p) => p.image) : []

function submissionImages(type: string, raw: string | null | undefined): string[] {
  if (type === 'storybook') return contentImages(parseContent(raw))
  if (type === 'task') return parseTaskContent(raw)?.images ?? []
  return []
}

function workDescription(content: StoredContent): string {
  return content.pages
    .map((p, i) => `第${i + 1}页：${p.who}在${p.where}，${p.doing}。`)
    .join('')
    .slice(0, 1000)
}

function workTitle(content: StoredContent): string {
  return `《${content.poemName || '我的故事'}》AI 课文绘本`.slice(0, 120)
}

function defaultAuthor(className: string, memberName: string): string {
  return `${className} · ${memberName}`.slice(0, 60)
}

function cleanAuthor(input: string): string {
  return input
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

async function ownedClass(ownerId: string, classId: string) {
  const cls = await prisma.classroom.findUnique({
    where: { id: classId },
    select: { id: true, ownerId: true, name: true },
  })
  if (!cls) throw notFound('班级不存在或已被删除')
  if (cls.ownerId !== ownerId) throw forbidden('只能管理自己的班级')
  return cls
}

interface DeletingSubmission {
  content: string | null
  assignment: { type: string }
  work: { id: string; images: string | null; published: boolean } | null
}

function collectFiles(submissions: DeletingSubmission[]): string[] {
  const files: string[] = []
  for (const s of submissions) {
    files.push(...submissionImages(s.assignment.type, s.content))
    if (s.work) files.push(...parseStoredImages(s.work.images))
  }
  return files
}

function assertNoPublished(submissions: DeletingSubmission[], message: string): void {
  if (submissions.some((s) => s.work?.published)) throw forbidden(message)
}

async function deleteSubmissionWorks(submissions: DeletingSubmission[], db: Pick<Prisma.TransactionClient, 'work'> = prisma): Promise<void> {
  const ids = submissions.map((s) => s.work?.id).filter((id): id is string => !!id)
  if (ids.length) await db.work.deleteMany({ where: { id: { in: ids } } })
}

const submissionSelect = {
  content: true,
  assignment: { select: { type: true } },
  work: { select: { id: true, images: true, published: true } },
} satisfies Prisma.SubmissionSelect

const memberSelect = { id: true, name: true, studentNo: true, gender: true, score: true } as const

async function lockRoster(tx: Prisma.TransactionClient, ownerId: string, classId: string) {
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM classrooms WHERE id = ${classId} AND ownerId = ${ownerId} FOR UPDATE`
  if (!locked.length) throw notFound('班级不存在或已被删除')
}

async function mutateRoster(ownerId: string, classId: string, build: (members: RosterMember[]) => RosterOperation[]) {
  try {
    const result = await prisma.$transaction(async tx => {
      await lockRoster(tx, ownerId, classId)
      const current = await tx.classMember.findMany({ where: { classId }, select: memberSelect })
      const operations = build(current)
      const planned = planRosterOperations(current, operations)
      const removedSubmissions = planned.removed.length ? await tx.submission.findMany({ where: { memberId: { in: planned.removed } }, select: submissionSelect }) : []
      assertNoPublished(removedSubmissions, '待删除学生还有已发布到展厅的作品，请先撤下')
      const files = collectFiles(removedSubmissions)
      await deleteSubmissionWorks(removedSubmissions, tx)
      if (planned.removed.length) await tx.classMember.deleteMany({ where: { classId, id: { in: planned.removed } } })
      const updates = operations.filter(op => op.action === 'update').map(op => op.id!)
      // Clear changed unique keys inside the same transaction to support valid student-number swaps.
      if (updates.length) await tx.classMember.updateMany({ where: { classId, id: { in: updates } }, data: { studentNo: null } })
      for (const member of planned.members) {
        const data = { name: member.name, studentNo: member.studentNo, gender: member.gender, score: member.score }
        if (member.id.startsWith('new:')) await tx.classMember.create({ data: { classId, ...data } })
        else if (updates.includes(member.id)) await tx.classMember.update({ where: { id: member.id }, data })
      }
      return {
        added: operations.filter(op => op.action === 'add').length,
        updated: updates.length, deleted: planned.removed.length, files,
        members: await tx.classMember.findMany({ where: { classId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: memberSelect }),
      }
    })
    await removeWorkImages(result.files)
    const { files: _files, ...response } = result
    return response
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw badRequest('名单中的学号重复，请检查后重试')
    throw err
  }
}

export async function classesRoutes(app: FastifyInstance) {
  // ── 班级 ───────────────────────────────────────────────────
  app.get('/classes', async (req) => {
    const me = await requireUser(req)
    const rooms = await prisma.classroom.findMany({
      where: { ownerId: me.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { members: true, assignments: true } },
      },
    })
    return {
      classes: rooms.map((r) => ({
        id: r.id,
        name: r.name,
        members: r._count.members,
        assignments: r._count.assignments,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    }
  })

  app.post('/classes', async (req) => {
    const me = await requireUser(req)
    await enforce([{ key: `classes:user:${me.id}`, limit: 60, windowMs: 60 * 60 * 1000 }], '班级操作太频繁')
    const body = parseBody(z.object({ name: classNameField, members: z.array(memberInputSchema).max(MAX_MEMBERS).optional() }), req.body)
    assertRoster(body.members ?? [])

    try {
      const cls = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${me.id} FOR UPDATE`
        const count = await tx.classroom.count({ where: { ownerId: me.id } })
        if (count >= MAX_CLASSES) throw badRequest(`最多创建 ${MAX_CLASSES} 个班级`)
        return tx.classroom.create({
          data: { ownerId: me.id, name: body.name, ...(body.members?.length ? { members: { create: body.members } } : {}) },
          select: { id: true, name: true, createdAt: true, members: { select: memberSelect } },
        })
      })
      return { class: { id: cls.id, name: cls.name, createdAt: cls.createdAt.toISOString(), members: cls.members } }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw badRequest('已经有同名班级了')
      }
      throw err
    }
  })

  app.get('/classes/:id', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const cls = await prisma.classroom.findFirst({
      where: { id, ownerId: me.id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        updatedAt: true,
        members: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: memberSelect },
        assignments: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            title: true,
            type: true,
            status: true,
            instructions: true,
            labId: true,
            moduleId: true,
            stage: true,
            activity: true,
            toolLabId: true,
            scoresPublished: true,
            answersPublished: true,
            createdAt: true,
            _count: { select: { submissions: { where: { status: 'submitted' } } } },
          },
        },
      },
    })
    if (!cls) throw notFound('班级不存在或已被删除')

    return {
      class: {
        id: cls.id,
        name: cls.name,
        createdAt: cls.createdAt.toISOString(),
        updatedAt: cls.updatedAt.toISOString(),
        memberCount: cls.members.length,
        members: cls.members,
        assignments: cls.assignments.map((a) => ({
          id: a.id,
          title: a.title,
          type: a.type,
          status: a.status,
          instructions: a.instructions,
          labId: a.labId,
          labTitle: labById(a.labId)?.title ?? null,
          moduleId: a.moduleId,
          stage: a.stage,
          activity: a.activity,
          toolLabId: a.toolLabId,
          scoresPublished: a.scoresPublished,
          answersPublished: a.answersPublished,
          toolLabTitle: labById(a.toolLabId)?.title ?? null,
          submitted: a._count.submissions,
          total: cls.members.length,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    }
  })

  app.patch('/classes/:id', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    await ownedClass(me.id, id)
    const body = parseBody(z.object({ name: classNameField }), req.body)
    try {
      const cls = await prisma.classroom.update({
        where: { id },
        data: { name: body.name },
        select: { id: true, name: true },
      })
      return { class: cls }
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw badRequest('已经有同名班级了')
      }
      throw err
    }
  })

  app.delete('/classes/:id', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    await ownedClass(me.id, id)

    const submissions = await prisma.submission.findMany({
      where: { assignment: { classId: id } },
      select: submissionSelect,
    })
    assertNoPublished(submissions, '班级里还有已发布到展厅的作品，请先撤下再删除')
    const files = collectFiles(submissions)

    await deleteSubmissionWorks(submissions)
    await prisma.classroom.delete({ where: { id } })
    await removeWorkImages(files)
    return { ok: true, id }
  })

  // ── 名单 ───────────────────────────────────────────────────
  app.post('/classes/:id/members', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    await ownedClass(me.id, id)
    const body = parseBody(
      z.object({
        names: z.array(memberNameField).min(1).max(MAX_MEMBERS).optional(),
        members: z.array(memberInputSchema).min(1).max(MAX_MEMBERS).optional(),
      }).refine(v => !!v.names !== !!v.members, '请填写 names 或 members 中的一项'),
      req.body,
    )

    const names = [...new Set(body.names ?? [])]
    const result = await mutateRoster(me.id, id, current => {
      if (body.members) return body.members.map(m => ({ action: 'add' as const, ...m }))
      const known = new Set(current.map(m => rosterNameKey(m.name)))
      return names.filter(name => !known.has(rosterNameKey(name))).map(name => ({ action: 'add' as const, name }))
    })
    return { ...result, skipped: (body.members?.length ?? names.length) - result.added }
  })

  app.patch('/classes/:id/members/:memberId', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const memberId = parseBody(idField, (req.params as { memberId?: string }).memberId)
    await ownedClass(me.id, id)
    const body = parseBody(memberPatchSchema, req.body)
    const result = await mutateRoster(me.id, id, () => [{ action: 'update', id: memberId, ...body }])
    return { member: result.members.find(m => m.id === memberId) }
  })

  app.delete('/classes/:id/members/:memberId', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const memberId = parseBody(idField, (req.params as { memberId?: string }).memberId)
    await ownedClass(me.id, id)
    await mutateRoster(me.id, id, () => [{ action: 'delete', id: memberId }])
    return { ok: true, id: memberId }
  })

  app.post('/classes/:id/members/batch', async req => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    await ownedClass(me.id, id)
    const body = parseBody(z.object({ operations: z.array(rosterOperationSchema).min(1).max(MAX_MEMBERS * 2) }), req.body)
    return mutateRoster(me.id, id, () => body.operations)
  })

  app.get('/classes/:id/groups', async req => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    await ownedClass(me.id, id)
    const groups = await prisma.classGroup.findMany({
      where: { classId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, members: { select: { member: { select: memberSelect } } } },
    })
    return { groups: groups.map(g => ({ id: g.id, name: g.name, members: g.members.map(m => m.member) })) }
  })

  app.put('/classes/:id/groups', async req => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    await ownedClass(me.id, id)
    const body = parseBody(z.object({ groups: z.array(z.object({ name: classNameField, memberIds: z.array(idField).min(1).max(MAX_MEMBERS) })).max(MAX_MEMBERS) }), req.body)
    try {
      await prisma.$transaction(async tx => {
        await lockRoster(tx, me.id, id)
        const members = await tx.classMember.findMany({ where: { classId: id }, select: { id: true } })
        assertGroupPartition(members.map(m => m.id), body.groups)
        await tx.classGroup.deleteMany({ where: { classId: id } })
        for (const group of body.groups) {
          await tx.classGroup.create({ data: { classId: id, name: group.name, members: { create: group.memberIds.map(memberId => ({ memberId })) } } })
        }
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw badRequest('小组名称重复，请检查后重试')
      throw err
    }
    const groups = await prisma.classGroup.findMany({ where: { classId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true, members: { select: { member: { select: memberSelect } } } } })
    return { groups: groups.map(g => ({ id: g.id, name: g.name, members: g.members.map(m => m.member) })) }
  })

  // ── 作业 ───────────────────────────────────────────────────
  app.post('/classes/:id/assignments', { bodyLimit: 1024 * 1024 }, async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    await ownedClass(me.id, id)
    await enforce([{ key: `assign:create:${me.id}`, limit: 120, windowMs: 60 * 60 * 1000 }], '创建作业太频繁')
    const body = parseBody(assignmentBody, req.body)

    const count = await prisma.assignment.count({ where: { classId: id } })
    if (count >= MAX_ASSIGNMENTS) throw badRequest(`一个班级最多 ${MAX_ASSIGNMENTS} 份作业`)

    const token = randomBytes(32).toString('base64url')
    const assignment = await prisma.assignment.create({
      data: {
        classId: id,
        title: body.title,
        type: body.type,
        instructions: body.instructions,
        labId: body.type === 'lab' ? body.labId! : null,
        moduleId: body.type === 'task' ? body.moduleId! : null,
        stage: body.type === 'task' ? body.stage! : null,
        activity: body.type === 'task' ? body.activity! : null,
        toolLabId: body.type === 'task' ? body.toolLabId ?? null : null,
        quizJson: body.type === 'quiz' ? JSON.stringify(body.quiz!) : null,
        status: body.status,
        token,
      },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        instructions: true,
        labId: true,
        moduleId: true,
        stage: true,
        activity: true,
        toolLabId: true,
        quizJson: true,
        scoresPublished: true,
        answersPublished: true,
        token: true,
        createdAt: true,
      },
    })
    return {
      assignment: {
        ...assignment,
        quizJson: undefined,
        ...(assignment.type === 'quiz' ? { quiz: projectQuiz(body.quiz!, true) } : {}),
        createdAt: assignment.createdAt.toISOString(),
        link: `/assign/${assignment.token}`,
      },
    }
  })

  app.get('/classes/:id/assignments/:assignmentId', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const assignmentId = parseBody(idField, (req.params as { assignmentId?: string }).assignmentId)
    await ownedClass(me.id, id)

    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, classId: id },
      select: {
        id: true,
        title: true,
        type: true,
        status: true,
        instructions: true,
        labId: true,
        moduleId: true,
        stage: true,
        activity: true,
        toolLabId: true,
        quizJson: true,
        scoresPublished: true,
        answersPublished: true,
        token: true,
        createdAt: true,
        updatedAt: true,
        classroom: { select: { id: true, name: true } },
        submissions: {
          select: {
            id: true,
            memberId: true,
            status: true,
            submittedAt: true,
            aiCalls: true,
            score: true,
            content: true,
            work: { select: { id: true, author: true, published: true, publishedAt: true } },
          },
        },
      },
    })
    if (!assignment) throw notFound('作业不存在或已被删除')

    const members = await prisma.classMember.findMany({
      where: { classId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: memberSelect,
    })
    const byMember = new Map(assignment.submissions.map((s) => [s.memberId, s]))

    const rows = members.map((m) => {
      const s = byMember.get(m.id)
      const task = s && assignment.type === 'task' ? parseTaskContent(s.content) : null
      return {
        id: m.id,
        name: m.name,
        studentNo: m.studentNo,
        gender: m.gender,
        submissionId: s?.id ?? null,
        status: s ? s.status : 'not_started',
        submittedAt: s?.submittedAt ? s.submittedAt.toISOString() : null,
        aiCalls: s?.aiCalls ?? 0,
        score: s?.score ?? null,
        imageCount: task?.images.length ?? 0,
        hasText: !!(task && task.text.trim()),
        work: s?.work
          ? {
              id: s.work.id,
              author: s.work.author,
              published: s.work.published,
              publishedAt: s.work.publishedAt ? s.work.publishedAt.toISOString() : null,
            }
          : null,
      }
    })
    const submitted = rows.filter((r) => r.status === 'submitted').length
    const started = rows.filter((r) => r.status === 'started').length

    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        type: assignment.type,
        status: assignment.status,
        instructions: assignment.instructions,
        labId: assignment.labId,
        labTitle: labById(assignment.labId)?.title ?? null,
        moduleId: assignment.moduleId,
        stage: assignment.stage,
        activity: assignment.activity,
        toolLabId: assignment.toolLabId,
        ...(assignment.type === 'quiz' && parseQuizDefinition(assignment.quizJson)
          ? { quiz: projectQuiz(parseQuizDefinition(assignment.quizJson)!, true) } : {}),
        scoresPublished: assignment.scoresPublished,
        answersPublished: assignment.answersPublished,
        toolLabTitle: labById(assignment.toolLabId)?.title ?? null,
        token: assignment.token,
        link: `/assign/${assignment.token}`,
        className: assignment.classroom.name,
        createdAt: assignment.createdAt.toISOString(),
        updatedAt: assignment.updatedAt.toISOString(),
      },
      members: rows,
      stats: { total: rows.length, submitted, started, notStarted: rows.length - submitted - started },
    }
  })

  app.patch('/classes/:id/assignments/:assignmentId', { bodyLimit: 1024 * 1024 }, async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const assignmentId = parseBody(idField, (req.params as { assignmentId?: string }).assignmentId)
    await ownedClass(me.id, id)
    const body = parseBody(
      z.object({
        title: assignmentTitleField.optional(),
        instructions: instructionsField.optional(),
        status: z.enum(['open', 'closed'], { message: '作业状态不正确' }).optional(),
        quiz: quizDefinitionSchema.optional(),
        scoresPublished: z.boolean().optional(),
        answersPublished: z.boolean().optional(),
      }),
      req.body,
    )
    const existing = await prisma.assignment.findFirst({
      where: { id: assignmentId, classId: id },
      select: { id: true, type: true, status: true },
    })
    if (!existing) throw notFound('作业不存在或已被删除')

    if (existing.type !== 'quiz' && (body.quiz !== undefined || body.scoresPublished !== undefined || body.answersPublished !== undefined)) throw badRequest('只有试卷作业支持题目与成绩公布设置')
    if (body.quiz && existing.status !== 'draft') throw forbidden('试卷发布后不能修改题目，请另建一份试卷')

    const assignment = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM assignments WHERE id = ${assignmentId} FOR UPDATE`
      const current = await tx.assignment.findUnique({ where: { id: assignmentId }, select: { status: true } })
      if (!current) throw notFound('作业不存在或已被删除')
      if (body.quiz && current.status !== 'draft') throw forbidden('试卷发布后不能修改题目，请另建一份试卷')
      return tx.assignment.update({ where: { id: assignmentId }, data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.instructions !== undefined ? { instructions: body.instructions } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.quiz ? { quizJson: JSON.stringify(body.quiz) } : {}),
        ...(body.scoresPublished !== undefined ? { scoresPublished: body.scoresPublished } : {}),
        ...(body.answersPublished !== undefined ? { answersPublished: body.answersPublished } : {}),
      }, select: { id: true, title: true, instructions: true, status: true, scoresPublished: true, answersPublished: true, quizJson: true } })
    })
    return { assignment: { ...assignment, quizJson: undefined, ...(parseQuizDefinition(assignment.quizJson) ? { quiz: projectQuiz(parseQuizDefinition(assignment.quizJson)!, true) } : {}) } }
  })

  app.post('/classes/:id/assignments/:assignmentId/rotate-link', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const assignmentId = parseBody(idField, (req.params as { assignmentId?: string }).assignmentId)
    await ownedClass(me.id, id)
    const existing = await prisma.assignment.findFirst({
      where: { id: assignmentId, classId: id },
      select: { id: true },
    })
    if (!existing) throw notFound('作业不存在或已被删除')

    const token = randomBytes(32).toString('base64url')
    await prisma.assignment.update({ where: { id: assignmentId }, data: { token } })
    return { ok: true, token, link: `/assign/${token}` }
  })

  app.delete('/classes/:id/assignments/:assignmentId', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const assignmentId = parseBody(idField, (req.params as { assignmentId?: string }).assignmentId)
    await ownedClass(me.id, id)
    const assignment = await prisma.assignment.findFirst({
      where: { id: assignmentId, classId: id },
      select: { id: true },
    })
    if (!assignment) throw notFound('作业不存在或已被删除')

    const submissions = await prisma.submission.findMany({
      where: { assignmentId },
      select: submissionSelect,
    })
    assertNoPublished(submissions, '作业里还有已发布到展厅的作品，请先撤下再删除')
    const files = collectFiles(submissions)

    await deleteSubmissionWorks(submissions)
    await prisma.assignment.delete({ where: { id: assignmentId } })
    await removeWorkImages(files)
    return { ok: true, id: assignmentId }
  })

  // ── 提交详情 / 发布到展厅 ─────────────────────────────────
  app.get('/classes/:id/assignments/:assignmentId/submissions/:submissionId', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const assignmentId = parseBody(idField, (req.params as { assignmentId?: string }).assignmentId)
    const submissionId = parseBody(idField, (req.params as { submissionId?: string }).submissionId)
    await ownedClass(me.id, id)

    const sub = await prisma.submission.findFirst({
      where: {
        id: submissionId,
        assignment: { id: assignmentId, classId: id },
      },
      select: {
        id: true,
        status: true,
        content: true,
        submittedAt: true,
        aiCalls: true,
        score: true,
        member: { select: { id: true, name: true, studentNo: true } },
        assignment: {
          select: {
            id: true,
            title: true,
            type: true,
            labId: true,
            moduleId: true,
            stage: true,
            activity: true,
            quizJson: true,
            classroom: { select: { name: true } },
          },
        },
        work: { select: { id: true, author: true, published: true, publishedAt: true } },
      },
    })
    if (!sub) throw notFound('提交记录不存在或已被删除')

    const storybook = sub.assignment.type === 'storybook' ? parseContent(sub.content) : null
    const labContent = sub.assignment.type === 'lab' ? parseLabContent(sub.content) : null
    const taskContent = sub.assignment.type === 'task' ? parseTaskContent(sub.content) : null
    return {
      submission: {
        id: sub.id,
        status: sub.status,
        submittedAt: sub.submittedAt ? sub.submittedAt.toISOString() : null,
        aiCalls: sub.aiCalls,
        score: sub.score,
        type: sub.assignment.type,
        memberName: sub.member.name,
        studentNo: sub.member.studentNo,
        assignmentTitle: sub.assignment.title,
        className: sub.assignment.classroom.name,
        labId: sub.assignment.labId,
        labTitle: labById(sub.assignment.labId)?.title ?? null,
        moduleId: sub.assignment.moduleId,
        stage: sub.assignment.stage,
        activity: sub.assignment.activity,
        poemName: storybook?.poemName ?? '',
        pages: storybook?.pages ?? [],
        lab: labContent,
        task: taskContent,
        ...(sub.assignment.type === 'quiz' && parseQuizDefinition(sub.assignment.quizJson) ? { quiz: {
          ...projectQuiz(parseQuizDefinition(sub.assignment.quizJson)!, true),
          answers: parseQuizSubmission(sub.content)?.answers ?? [], score: sub.score,
        } } : {}),
        work: sub.work
          ? {
              id: sub.work.id,
              author: sub.work.author,
              published: sub.work.published,
              publishedAt: sub.work.publishedAt ? sub.work.publishedAt.toISOString() : null,
            }
          : null,
        defaultAuthor: defaultAuthor(sub.assignment.classroom.name, sub.member.name),
      },
    }
  })

  app.post('/classes/:id/assignments/:assignmentId/submissions/:submissionId/publish', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const assignmentId = parseBody(idField, (req.params as { assignmentId?: string }).assignmentId)
    const submissionId = parseBody(idField, (req.params as { submissionId?: string }).submissionId)
    await ownedClass(me.id, id)
    await enforce([{ key: `assign:publish:${me.id}`, limit: 240, windowMs: 60 * 60 * 1000 }], '发布操作太频繁')
    const body = parseBody(publishBody, req.body ?? {})

    const sub = await prisma.submission.findFirst({
      where: { id: submissionId, assignment: { id: assignmentId, classId: id } },
      select: {
        id: true,
        status: true,
        content: true,
        member: { select: { name: true } },
        assignment: {
          select: {
            title: true,
            type: true,
            labId: true,
            moduleId: true,
            stage: true,
            activity: true,
            classroom: { select: { name: true } },
          },
        },
        work: { select: { id: true, author: true, images: true, published: true, publishedAt: true } },
      },
    })
    if (!sub) throw notFound('提交记录不存在或已被删除')
    if (sub.status !== 'submitted') throw badRequest('这名学生还没有提交作业')
    if (sub.assignment.type === 'quiz') throw forbidden('试卷提交不能发布到成果展厅')

    const author = cleanAuthor(body.author || defaultAuthor(sub.assignment.classroom.name, sub.member.name))
    if (!author) throw badRequest('请填写展厅署名')

    let title = ''
    let description = ''
    let images: string[] = []
    let grade = 'low'
    let module = 'm2'
    let workType = 'AI 课文绘本'
    let hue = 280

    if (sub.assignment.type === 'lab') {
      const content = parseLabContent(sub.content)
      const lab = labById(content?.labId || sub.assignment.labId)
      if (!content || !lab) throw badRequest('提交内容不完整，无法发布')
      const produced = content.work
      title = (produced?.title || `${lab.title}（${content.score} 分）`).slice(0, 120)
      description = (
        produced?.desc ||
        `${sub.member.name} 完成了「${lab.title}」，得分 ${content.score} 分。${content.note || ''}`
      ).slice(0, 1000)
      grade = lab.grade
      module = lab.module
      workType = (produced?.type || lab.type).slice(0, 32)
      hue = produced?.hue ?? lab.hue
    } else if (sub.assignment.type === 'task') {
      const content = parseTaskContent(sub.content)
      if (!content) throw badRequest('提交内容不完整，无法发布')
      if (!content.text.trim() && !content.images.length) throw badRequest('这份作业没有可发布的内容')
      title = sub.assignment.title.slice(0, 120)
      description = (
        content.text.trim() || `完成了课程任务「${sub.assignment.activity || sub.assignment.title}」。`
      ).slice(0, 1000)
      images = content.images
      grade = sub.assignment.stage || 'mid'
      module = sub.assignment.moduleId || 'm1'
      workType = '课程任务'
      hue = 35
    } else {
      const content = parseContent(sub.content)
      if (!content) throw badRequest('提交内容不完整，无法发布')
      images = contentImages(content)
      title = workTitle(content)
      description = workDescription(content)
    }

    if (sub.work?.published) {
      return {
        ok: true,
        alreadyPublished: true,
        work: {
          id: sub.work.id,
          title,
          author: sub.work.author,
          published: true,
          publishedAt: sub.work.publishedAt ? sub.work.publishedAt.toISOString() : null,
        },
      }
    }

    if (sub.work) {
      const saved = await copyWorkImages(sub.work.id, images)
      if (saved.length !== images.length) {
        await removeWorkImages(saved)
        throw new ApiError('GEN_FAILED', '作业插画文件缺失，请让学生重新提交后再发布')
      }
      const old = parseStoredImages(sub.work.images)
      const keep = new Set(saved)
      await removeWorkImages(old.filter((p) => !keep.has(p)))
      const work = await prisma.work.update({
        where: { id: sub.work.id },
        data: {
          title,
          author,
          grade,
          module,
          type: workType,
          hue,
          description,
          images: serializeImages(saved),
          published: true,
          ...(sub.work.publishedAt ? {} : { publishedAt: new Date() }),
        },
        select: { id: true, title: true, author: true, published: true, publishedAt: true },
      })
      return {
        ok: true,
        work: {
          ...work,
          publishedAt: work.publishedAt ? work.publishedAt.toISOString() : null,
        },
      }
    }

    let work: { id: string; title: string; author: string; published: boolean; publishedAt: Date | null }
    try {
      work = await prisma.work.create({
        data: {
          userId: me.id,
          submissionId: sub.id,
          title,
          author,
          grade,
          module,
          type: workType,
          description,
          hue,
          published: true,
          publishedAt: new Date(),
        },
        select: { id: true, title: true, author: true, published: true, publishedAt: true },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await prisma.work.findUnique({
          where: { submissionId: sub.id },
          select: { id: true, title: true, author: true, published: true, publishedAt: true },
        })
        if (existing) {
          return {
            ok: true,
            alreadyPublished: true,
            work: {
              ...existing,
              publishedAt: existing.publishedAt ? existing.publishedAt.toISOString() : null,
            },
          }
        }
      }
      throw err
    }

    const saved = await copyWorkImages(work.id, images)
    if (saved.length !== images.length) {
      await prisma.work.delete({ where: { id: work.id } }).catch(() => {})
      await removeWorkImages(saved)
      throw new ApiError('GEN_FAILED', '作业插画文件缺失，请让学生重新提交后再发布')
    }
    const updated = await prisma.work.update({
      where: { id: work.id },
      data: { images: serializeImages(saved) },
      select: { id: true, title: true, author: true, published: true, publishedAt: true },
    })
    return {
      ok: true,
      work: { ...updated, publishedAt: updated.publishedAt ? updated.publishedAt.toISOString() : null },
    }
  })

  app.delete('/classes/:id/assignments/:assignmentId/submissions/:submissionId/publish', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const assignmentId = parseBody(idField, (req.params as { assignmentId?: string }).assignmentId)
    const submissionId = parseBody(idField, (req.params as { submissionId?: string }).submissionId)
    await ownedClass(me.id, id)

    const sub = await prisma.submission.findFirst({
      where: { id: submissionId, assignment: { id: assignmentId, classId: id } },
      select: { work: { select: { id: true } } },
    })
    if (!sub?.work) throw notFound('这份作业还没有发布到展厅')
    await prisma.work.update({
      where: { id: sub.work.id },
      data: { published: false, publishedAt: null },
    })
    return { ok: true, id: sub.work.id, published: false }
  })

  app.post('/classes/:id/assignments/:assignmentId/submissions/:submissionId/reset', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(idField, (req.params as { id?: string }).id)
    const assignmentId = parseBody(idField, (req.params as { assignmentId?: string }).assignmentId)
    const submissionId = parseBody(idField, (req.params as { submissionId?: string }).submissionId)
    await ownedClass(me.id, id)

    const sub = await prisma.submission.findFirst({
      where: { id: submissionId, assignment: { id: assignmentId, classId: id } },
      select: {
        id: true,
        content: true,
        assignment: { select: { type: true } },
        work: { select: { id: true, images: true, published: true } },
      },
    })
    if (!sub) throw notFound('提交记录不存在或已被删除')
    if (sub.assignment.type === 'quiz') throw forbidden('试卷只允许提交一次，不支持重置后重做')
    if (sub.work?.published) throw forbidden('请先把展厅里的作品撤下，再重置学生提交')

    const files = [
      ...submissionImages(sub.assignment.type, sub.content),
      ...parseStoredImages(sub.work?.images),
    ]
    if (sub.work) await prisma.work.delete({ where: { id: sub.work.id } })
    await prisma.submission.update({
      where: { id: sub.id },
      data: { status: 'started', content: null, score: null, submittedAt: null },
    })
    await removeWorkImages(files)
    return { ok: true, id: sub.id }
  })

  // ── 学生端 ─────────────────────────────────────────────────
  app.get('/assign/:token', async (req) => {
    const token = parseBody(tokenField, (req.params as { token?: string }).token)
    const assignment = await prisma.assignment.findUnique({
      where: { token },
      select: {
        title: true,
        type: true,
        instructions: true,
        labId: true,
        moduleId: true,
        stage: true,
        activity: true,
        toolLabId: true,
        quizJson: true,
        scoresPublished: true,
        answersPublished: true,
        status: true,
        classroom: {
          select: { name: true, owner: { select: { nickname: true } } },
        },
      },
    })
    if (!assignment) throw notFound('作业链接不存在或已失效')
    return {
      assignment: {
        title: assignment.title,
        type: assignment.type,
        ...(assignment.type === 'quiz' && assignment.status !== 'draft' && parseQuizDefinition(assignment.quizJson)
          ? { quiz: projectQuiz(parseQuizDefinition(assignment.quizJson)!) } : {}),
        instructions: assignment.instructions,
        labId: assignment.labId,
        labTitle: labById(assignment.labId)?.title ?? null,
        moduleId: assignment.moduleId,
        stage: assignment.stage,
        activity: assignment.activity,
        toolLabId: assignment.toolLabId,
        toolLabTitle: labById(assignment.toolLabId)?.title ?? null,
        status: assignment.status,
        className: assignment.classroom.name,
        teacherName: assignment.classroom.owner.nickname,
        ...(assignment.type === 'quiz' ? { scoresPublished: assignment.scoresPublished, answersPublished: assignment.answersPublished } : {}),
        aiLimit: ASSIGN_AI_LIMIT,
      },
    }
  })

  const studentSession = async (req: FastifyRequest) => {
    const token = parseBody(tokenField, (req.params as { token?: string }).token)
    const session = await optionalAssignment(req)
    if (!session || session.assignment.token !== token) return { member: null }

    const work = await prisma.work.findUnique({
      where: { submissionId: session.submission.id },
      select: { published: true },
    })
    const raw = session.submission.status === 'submitted' ? session.submission.content : null
    const content =
      session.assignment.type === 'lab'
        ? parseLabContent(raw)
        : session.assignment.type === 'task'
          ? parseTaskContent(raw)
          : parseContent(raw)
    return {
      member: { id: session.member.id, name: session.member.name, studentNo: session.member.studentNo },
      submission: {
        type: session.assignment.type,
        status: session.submission.status,
        submittedAt: session.submission.submittedAt
          ? session.submission.submittedAt.toISOString()
          : null,
        aiCalls: session.submission.aiCalls,
        ...(session.assignment.type === 'quiz' ? studentQuizResult(session.assignment, session.submission) : { score: session.submission.score, content }),
        aiLimit: ASSIGN_AI_LIMIT,
        published: !!work?.published,
      },
    }
  }
  app.get('/assign/:token/me', studentSession)
  app.get('/assign/:token/session', studentSession)

  app.post('/assign/:token/verify', async (req, reply) => {
    const token = parseBody(tokenField, (req.params as { token?: string }).token)
    await enforce(
      [
        { key: `assign:verify:ip:${clientIp(req)}`, limit: 30, windowMs: 10 * 60 * 1000 },
        { key: `assign:verify:token:${token}`, limit: 300, windowMs: 60 * 60 * 1000 },
      ],
      '尝试次数太多，请稍后再试',
    )
    const body = parseBody(z.object({ name: memberNameField, studentNo: z.string().trim().max(40).optional() }), req.body)
    const assignment = await prisma.assignment.findUnique({
      where: { token },
      select: { id: true, classId: true, type: true, status: true, quizJson: true, scoresPublished: true, answersPublished: true },
    })
    if (!assignment) throw notFound('作业链接不存在或已失效')
    if (assignment.status === 'draft') throw forbidden('这份作业尚未发布')
    const matches = await prisma.classMember.findMany({
      where: { classId: assignment.classId, name: body.name },
      select: { id: true, name: true, studentNo: true },
    })
    const candidates = matches.filter(m => rosterNameKey(m.name) === rosterNameKey(body.name))
    if (candidates.length > 1 && !body.studentNo) throw forbidden('存在同名学生，请填写老师名单中的学号')
    const member = body.studentNo ? candidates.find(m => m.studentNo === body.studentNo) : candidates[0]
    if (!member) throw forbidden('姓名不在班级名单中，请检查后重试')

    if (assignment.status !== 'open') {
      const previous = await prisma.submission.findUnique({ where: { assignmentId_memberId: { assignmentId: assignment.id, memberId: member.id } }, select: { status: true } })
      if (assignment.type !== 'quiz' || previous?.status !== 'submitted') throw forbidden('这份作业已关闭，暂时不能开始')
    }

    const submission = await prisma.submission.upsert({
      where: { assignmentId_memberId: { assignmentId: assignment.id, memberId: member.id } },
      create: { assignmentId: assignment.id, memberId: member.id },
      update: {},
      select: { id: true, status: true, submittedAt: true, aiCalls: true, score: true, content: true },
    })

    const sessionToken = await signAssignmentSession({
      assignmentId: assignment.id,
      classId: assignment.classId,
      memberId: member.id,
      token,
    })
    setAssignmentCookie(reply, sessionToken)
    const work = await prisma.work.findUnique({
      where: { submissionId: submission.id },
      select: { published: true },
    })
    const raw = submission.status === 'submitted' ? submission.content : null
    const content =
      assignment.type === 'lab' ? parseLabContent(raw) : assignment.type === 'task' ? parseTaskContent(raw) : parseContent(raw)
    return {
      member: { id: member.id, name: member.name, studentNo: member.studentNo },
      submission: {
        type: assignment.type,
        status: submission.status,
        submittedAt: submission.submittedAt ? submission.submittedAt.toISOString() : null,
        aiCalls: submission.aiCalls,
        ...(assignment.type === 'quiz' ? studentQuizResult(assignment, submission) : { score: submission.score, content }),
        aiLimit: ASSIGN_AI_LIMIT,
        published: !!work?.published,
      },
    }
  })

  app.post('/assign/:token/leave', async (_req, reply) => {
    clearAssignmentCookie(reply)
    return { ok: true }
  })

  app.post(
    '/assign/:token/submit',
    { bodyLimit: MAX_SUBMIT_BYTES },
    async (req) => {
      const token = parseBody(tokenField, (req.params as { token?: string }).token)
      const session = await requireAssignment(req)
      if (session.assignment.token !== token) throw forbidden('作业链接已更新，请重新打开老师发的链接')
      if (session.assignment.status !== 'open') throw forbidden('这份作业已关闭，暂时不能提交')

      const current = await prisma.submission.findUnique({
        where: { id: session.submission.id },
        select: { id: true, status: true, content: true, work: { select: { id: true } } },
      })
      if (!current) throw notFound('提交记录不存在，请重新打开作业链接')
      if (current.work) throw forbidden('老师已经处理过这份作业，暂时不能再修改')

      await enforce(
        [
          { key: `assign:submit:member:${current.id}`, limit: 20, windowMs: 60 * 60 * 1000 },
          { key: `assign:submit:ip:${clientIp(req)}`, limit: 200, windowMs: 60 * 60 * 1000 },
        ],
        '提交作业太频繁',
      )

      const type = session.assignment.type
      if (type === 'quiz') {
        const body = parseBody(quizSubmitSchema, req.body)
        const submittedAt = new Date()
        await prisma.$transaction(async tx => {
          // Serialize against teacher closing/publishing and concurrent student submissions.
          await tx.$queryRaw`SELECT id FROM assignments WHERE id = ${session.assignment.id} FOR UPDATE`
          const assignment = await tx.assignment.findUnique({ where: { id: session.assignment.id }, select: { status: true, token: true, quizJson: true } })
          if (!assignment || assignment.token !== token) throw forbidden('作业链接已失效，请重新打开老师发的链接')
          if (assignment.status !== 'open') throw forbidden('这份作业已关闭，暂时不能提交')
          const quiz = parseQuizDefinition(assignment.quizJson)
          if (!quiz) throw badRequest('试卷内容不完整，请联系老师')
          const graded = gradeQuiz(quiz, body.answers)
          const result = await tx.submission.updateMany({
            where: { id: current.id, status: 'started' },
            data: { status: 'submitted', content: JSON.stringify(graded), score: graded.score, submittedAt },
          })
          if (result.count !== 1) throw forbidden('试卷已提交，不能重复提交或修改')
        })
        return { ok: true, submission: { type: 'quiz', status: 'submitted', submittedAt: submittedAt.toISOString() } }
      }
      const prefix = `${current.id}-${Date.now().toString(36)}`
      const previousImages = submissionImages(type, current.content)
      let content: StoredContent | StoredLabContent | StoredTaskContent
      let saved: string[] = []
      let score: number | null = null
      let summary: Record<string, number>

      if (type === 'lab') {
        const body = parseBody(labSubmitBody, req.body)
        if (!session.assignment.labId || body.labId !== session.assignment.labId) {
          throw badRequest('这份作业的互动练习对不上，请重新打开老师发的链接')
        }
        content = {
          version: 1,
          labId: body.labId,
          score: body.score,
          note: body.note,
          work: body.work
            ? {
                title: body.work.title,
                type: body.work.type,
                module: body.work.module,
                grade: body.work.grade,
                desc: body.work.desc,
                hue: body.work.hue,
              }
            : null,
        }
        score = body.score
        summary = { score: body.score }
      } else if (type === 'task') {
        const body = parseBody(taskSubmitBody, req.body)
        if (!body.text && !body.images.length) throw badRequest('请先写下作业内容或上传照片')
        saved = await persistWorkImages(prefix, body.images)
        if (saved.length !== body.images.length) {
          await removeWorkImages(saved)
          throw new ApiError('GEN_FAILED', '作业照片保存失败，请重新提交一次')
        }
        content = { version: 1, text: body.text, images: saved }
        summary = { images: saved.length }
      } else {
        const body = parseBody(storybookSubmitBody, req.body)
        saved = await persistWorkImages(prefix, body.pages.map((p) => p.image))
        if (saved.length !== body.pages.length) {
          await removeWorkImages(saved)
          throw new ApiError('GEN_FAILED', '插画保存失败，请重新提交一次')
        }
        content = {
          version: 1,
          poemName: body.poemName,
          pages: body.pages.map((p, i) => ({
            who: p.who,
            where: p.where,
            doing: p.doing,
            color: p.color,
            mood: p.mood,
            image: saved[i]!,
          })),
        }
        summary = { pages: content.pages.length }
      }

      const submittedAt = new Date()
      try {
        await prisma.submission.update({
          where: { id: current.id },
          data: {
            status: 'submitted',
            content: JSON.stringify(content),
            score,
            submittedAt,
          },
        })
      } catch (err) {
        await removeWorkImages(saved)
        throw err
      }
      await removeWorkImages(previousImages)
      return {
        ok: true,
        submission: {
          type,
          status: 'submitted',
          submittedAt: submittedAt.toISOString(),
          ...summary,
        },
      }
    },
  )
}
