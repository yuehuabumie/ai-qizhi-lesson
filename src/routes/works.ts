import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/db.js'
import { requireUser, optionalUser } from '../lib/auth.js'
import { parseBody } from '../lib/validate.js'
import { badRequest, forbidden, notFound } from '../lib/errors.js'
import { enforce, clientIp } from '../lib/rate-limit.js'
import {
  MAX_WORK_IMAGES,
  parseStoredImages,
  persistWorkImages,
  removeWorkImages,
  serializeImages,
} from '../lib/work-images.js'

/**
 * 个人作品与作品展厅。
 *
 * 作品默认落在个人作品库，只有作者显式发布后才进入公开展厅：
 * 课堂上随手保存的草稿不应该自动出现在全站可见的墙上。
 *
 * 权限边界：
 *   · GET  /works               公开，只列已发布
 *   · GET  /works/mine          登录，自己的全部作品（含未发布）
 *   · POST /works               登录，创建**未发布**作品
 *   · POST /works/:id/publish   登录 + 本人，发布（幂等）
 *   · DELETE /works/:id/publish 登录 + 本人，撤下（幂等）
 *   · GET  /works/:id           公开；未发布作品只有本人能看
 *   · DELETE /works/:id         登录 + 本人，彻底删除
 *   · POST/DELETE like          登录，仅已发布作品，幂等
 *
 * author 一律取账号昵称，**不接受客户端传值**。展厅是公开的，
 * 允许自填作者名等于给冒名留门（"李老师"、"学校官方"随便写）。
 * 老师想署班级名，改自己昵称即可；改昵称会同步更新旧作品署名。
 */

/** 单个账号最多能有多少份作品。挡的是开放注册下的无限灌水，不是正常使用。
 *  导出给 progress 的旧数据导入用——导入绝不能绕过配额（两处必须同口径）。 */
export const MAX_WORKS_PER_USER = 200

/**
 * 作品 id 是 cuid（25 位）。这里限制字符集只是为了别让奇怪的东西进 SQL，
 * 长度放宽到 40 留点余地。真正的越权防护是下面按 userId 比对，不是这个正则。
 */
const workIdField = z
  .string({ message: '作品编号不正确' })
  .trim()
  .min(1, '作品编号不正确')
  .max(40, '作品编号不正确')
  .regex(/^[A-Za-z0-9_-]+$/, '作品编号不正确')

/**
 * 插画来源只接受 https 或 data:image（都是出图接口真实会返回的形态）。
 * 服务端会再下载落盘，见 lib/work-images.ts；这里限制长度只是挡住
 * 拿超大字符串把请求体撑爆。真正的体积上限在下载阶段按字节判断。
 */
const imageSrcField = z
  .string({ message: '图片格式不正确' })
  .trim()
  .min(1, '图片格式不正确')
  .max(400_000, '单张图片太大')
  .refine(
    (v) => /^https:\/\/\S+$/i.test(v) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/i.test(v),
    '图片格式不正确',
  )

const createBody = z.object({
  title: z.string({ message: '给作品起个标题吧' }).trim().min(1, '给作品起个标题吧').max(120, '标题最多 120 字'),
  type: z.string().trim().max(32, '作品类型过长').default(''),
  grade: z.string().trim().max(8, '学段参数不正确').default('low'),
  module: z.string().trim().max(8, '模块参数不正确').default(''),
  desc: z.string().trim().max(1000, '作品说明最多 1000 字').default(''),
  images: z.array(imageSrcField).max(MAX_WORK_IMAGES, `最多 ${MAX_WORK_IMAGES} 张图片`).default([]),
  hue: z
    .number({ message: '色相必须是数字' })
    .int('色相必须是整数')
    .min(0, '色相超出范围')
    .max(360, '色相超出范围')
    .default(210),
})

/**
 * 列表参数。
 *
 * 用 `z.coerce.number()` 而不是 `z.number()`：query 里一切都是字符串。
 * ⚠️ 但 coerced 值在 min/max 之前是 NaN（`Number('abc')`），
 * 所以范围校验必须留着——NaN 过不了 `.int()`，会正常变成 400 而不是静默取默认值。
 */
const listQuery = z.object({
  module: z.string().trim().max(8, '模块参数不正确').optional(),
  page: z.coerce
    .number()
    .int('页码不正确')
    .min(1, '页码不正确')
    .max(10_000, '页码不正确')
    .default(1),
  pageSize: z.coerce
    .number()
    .int('每页数量不正确')
    .min(1, '每页数量不正确')
    .max(60, '每页数量不正确')
    .default(24),
})

const mineQuery = z.object({
  status: z.enum(['all', 'published', 'draft']).default('all'),
  page: z.coerce.number().int('页码不正确').min(1, '页码不正确').max(10_000, '页码不正确').default(1),
  pageSize: z.coerce
    .number()
    .int('每页数量不正确')
    .min(1, '每页数量不正确')
    .max(60, '每页数量不正确')
    .default(24),
})

/** 列表和创建都只回这些字段，别把 userId/hidden 漏出去 */
const WORK_SELECT = {
  id: true,
  userId: true,
  title: true,
  author: true,
  grade: true,
  module: true,
  type: true,
  description: true,
  images: true,
  hue: true,
  published: true,
  publishedAt: true,
  createdAt: true,
  _count: { select: { likes: true } },
} satisfies Prisma.WorkSelect

type WorkRow = {
  id: string
  userId: string
  title: string
  author: string
  grade: string
  module: string
  type: string
  description: string
  images: string | null
  hue: number
  published: boolean
  publishedAt: Date | null
  createdAt: Date
  _count: { likes: number }
}

/** 转成前端的 WorkItem：`description` → `desc`，`_count.likes` → `likes` */
function toWork(row: WorkRow, me: { id: string } | null, likedIds: Set<string>) {
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    grade: row.grade,
    module: row.module,
    type: row.type,
    desc: row.description,
    images: parseStoredImages(row.images),
    hue: row.hue,
    likes: row._count.likes,
    published: row.published,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    mine: me !== null && row.userId === me.id,
    liked: likedIds.has(row.id),
  }
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
}

export async function worksRoutes(app: FastifyInstance) {
  // ── 列表（开放浏览）──────────────────────────────────────
  app.get('/works', async (req) => {
    // 用 optionalUser 而不是 requireUser：没登录也要能看，
    // 只是 mine/liked 全为 false。requireUser 会直接把游客挡在门外。
    const me = await optionalUser(req)
    const q = parseBody(listQuery, req.query)

    const where: Prisma.WorkWhereInput = {
      hidden: false,
      published: true,
      ...(q.module ? { module: q.module } : {}),
    }

    // 两条查询并行。总数和当前页互不依赖，串行纯属浪费一个往返。
    const [total, rows] = await Promise.all([
      prisma.work.count({ where }),
      prisma.work.findMany({
        where,
        // 按发布先后排序：刚上墙的旧草稿也应该排在最前。
        // 加 id 做平局键：publishedAt 是毫秒精度，同毫秒发布的作品
        // 在只按时间排序时次序未定义，翻页会重复/漏项。
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: WORK_SELECT,
      }),
    ])

    // 我点过赞的是哪几件。没登录时传空串——cuid 不可能等于空串，
    // 查出来必然是空集，省掉一次分支（也就不需要两套 select）。
    const likedRows = await prisma.workLike.findMany({
      where: { userId: me?.id ?? '', workId: { in: rows.map((r) => r.id) } },
      select: { workId: true },
    })
    const likedIds = new Set(likedRows.map((l) => l.workId))

    return {
      works: rows.map((r) => toWork(r, me, likedIds)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      hasMore: q.page * q.pageSize < total,
    }
  })

  // ── 我的作品（含未发布）──────────────────────────────────
  app.get('/works/mine', async (req) => {
    const me = await requireUser(req)
    const q = parseBody(mineQuery, req.query)

    // submissionId 非空的是老师从班级作业发布上来的作品：
    // 它们在班级作业页管理，塞进个人作品库只会让老师的两套列表互相打架。
    const where: Prisma.WorkWhereInput = {
      userId: me.id,
      submissionId: null,
      ...(q.status === 'published' ? { published: true } : {}),
      ...(q.status === 'draft' ? { published: false } : {}),
    }

    const [allTotal, filteredTotal, draftTotal, onWallTotal, rows] = await Promise.all([
      prisma.work.count({ where: { userId: me.id, submissionId: null } }),
      prisma.work.count({ where }),
      prisma.work.count({ where: { userId: me.id, submissionId: null, published: false } }),
      prisma.work.count({ where: { userId: me.id, submissionId: null, published: true, hidden: false } }),
      prisma.work.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { ...WORK_SELECT, hidden: true },
      }),
    ])

    const likedRows = await prisma.workLike.findMany({
      where: { userId: me.id, workId: { in: rows.map((r) => r.id) } },
      select: { workId: true },
    })
    const likedIds = new Set(likedRows.map((l) => l.workId))

    return {
      works: rows.map((r) => ({
        ...toWork(r, me, likedIds),
        hidden: r.hidden,
      })),
      total: allTotal,
      filtered: filteredTotal,
      published: onWallTotal,
      drafts: draftTotal,
      page: q.page,
      pageSize: q.pageSize,
      hasMore: q.page * q.pageSize < filteredTotal,
    }
  })

  // ── 单件详情（开放浏览）──────────────────────────────────
  // 详情页可以直接用链接打开，不必先拉整张列表再在客户端找。
  // 和列表同一套字段与 liked/mine 口径，避免两处漂移。
  app.get('/works/:id', async (req) => {
    const me = await optionalUser(req)
    const id = parseBody(workIdField, (req.params as { id?: string }).id)

    // hidden 只在服务端判断，不返回给客户端
    const row = await prisma.work.findUnique({
      where: { id },
      select: { ...WORK_SELECT, hidden: true },
    })
    // 未发布作品只有作者本人能预览；对其他人连"存在过"都不透露。
    if (!row || row.hidden || (!row.published && row.userId !== me?.id)) {
      throw notFound('作品不存在或已被删除')
    }

    const liked = me
      ? await prisma.workLike.findUnique({
          where: { workId_userId: { workId: id, userId: me.id } },
          select: { workId: true },
        })
      : null

    return { work: toWork(row, me, new Set(liked ? [id] : [])) }
  })

  // ── 建作品 ───────────────────────────────────────────────
  app.post('/works', async (req) => {
    const me = await requireUser(req)
    // 主锚是按账号的限额；IP 键只作机房级兜底。
    // 按 IP 设 60/h 会把整间机房当成一个人：老师一声令下全班上传就互相挤兑，
    // 所以 IP 阈值按班级规模放宽，真正的防滥用靠账号维度。
    await enforce(
      [
        { key: `works:user:${me.id}`, limit: 60, windowMs: 60 * 60 * 1000 },
        { key: `works:ip:${clientIp(req)}`, limit: 240, windowMs: 60 * 60 * 1000 },
      ],
      '上传作品太频繁',
    )
    const body = parseBody(createBody, req.body)

    // 只在要新建时才数，更新场景不存在（没有编辑接口）。
    // 只数个人作品：班级作业发布的作品另有班级名额，不该挤占个人 200 份配额。
    const n = await prisma.work.count({ where: { userId: me.id, submissionId: null } })
    if (n >= MAX_WORKS_PER_USER) {
      throw badRequest(`每人最多上传 ${MAX_WORKS_PER_USER} 份作品，先删掉一些再传吧`)
    }

    const row = await prisma.work.create({
      data: {
        userId: me.id,
        title: body.title,
        // 服务端强制署名，不读 body.author（原因见文件头）
        author: me.nickname,
        grade: body.grade,
        module: body.module,
        type: body.type,
        description: body.desc,
        hue: body.hue,
      },
      select: WORK_SELECT,
    })

    // 图片落盘失败不应该让整份作品消失：文字部分已经成功入库，
    // 展厅退化成无图版本，比丢作品好。失败数量记日志便于排查上游。
    if (body.images.length) {
      try {
        const saved = await persistWorkImages(row.id, body.images)
        if (saved.length) {
          try {
            const withImages = await prisma.work.update({
              where: { id: row.id },
              data: { images: serializeImages(saved) },
              select: WORK_SELECT,
            })
            return { work: toWork(withImages, me, new Set()) }
          } catch (err) {
            // 行没记上就不能让文件留在磁盘上——否则没有任何记录能再清理它们
            await removeWorkImages(saved)
            throw err
          }
        }
        req.log.warn(
          { workId: row.id, requested: body.images.length },
          '作品图片全部保存失败，作品按无图创建',
        )
      } catch (err) {
        req.log.error({ err, workId: row.id, images: body.images.length }, '作品图片保存异常')
      }
    }

    return { work: toWork(row, me, new Set()) }
  })

  // ── 发布 / 撤下（仅本人，幂等）──────────────────────────
  app.post('/works/:id/publish', async (req) => {
    const me = await requireUser(req)
    await enforce(
      [{ key: `pub:user:${me.id}`, limit: 120, windowMs: 60 * 60 * 1000 }],
      '发布操作过于频繁',
    )
    const id = parseBody(workIdField, (req.params as { id?: string }).id)
    const row = await prisma.work.findUnique({
      where: { id },
      select: { userId: true, publishedAt: true, hidden: true },
    })
    if (!row) throw notFound('作品不存在或已被删除')
    if (row.userId !== me.id) throw forbidden('只能发布自己的作品')
    if (row.hidden) throw forbidden('作品已被下架，暂时不能发布')

    // 重复点「发布」不刷新 publishedAt：否则连点会把作品不断顶到展厅最前。
    const work = await prisma.work.update({
      where: { id },
      data: {
        published: true,
        ...(row.publishedAt ? {} : { publishedAt: new Date() }),
      },
      select: WORK_SELECT,
    })
    return { ok: true, work: toWork(work, me, new Set()) }
  })

  app.delete('/works/:id/publish', async (req) => {
    const me = await requireUser(req)
    await enforce(
      [{ key: `pub:user:${me.id}`, limit: 120, windowMs: 60 * 60 * 1000 }],
      '发布操作过于频繁',
    )
    const id = parseBody(workIdField, (req.params as { id?: string }).id)
    const row = await prisma.work.findUnique({
      where: { id },
      select: { userId: true },
    })
    if (!row) throw notFound('作品不存在或已被删除')
    if (row.userId !== me.id) throw forbidden('只能撤下自己的作品')

    // 保留点赞记录：重新发布时赞数还在，语义比清零更自然。
    await prisma.work.update({
      where: { id },
      data: { published: false, publishedAt: null },
    })
    return { ok: true, id, published: false }
  })

  // ── 删除（仅本人）────────────────────────────────────────
  app.delete('/works/:id', async (req) => {
    const me = await requireUser(req)
    const id = parseBody(workIdField, (req.params as { id?: string }).id)

    const row = await prisma.work.findUnique({ where: { id }, select: { userId: true, images: true } })
    // 不存在和不是自己的要分开报：混成一个 404 的话，用户删别人作品时
    // 会以为是"作品没了"，而不是"你没这个权限"。
    if (!row) throw notFound('作品不存在或已被删除')
    if (row.userId !== me.id) throw forbidden('只能删除自己上传的作品')

    try {
      await prisma.work.delete({ where: { id } })
    } catch (err) {
      // 双击/重试并发下第二个请求会撞 P2025（行已不在）。语义上等同
      // 「已经删掉了」，幂等成功，不要报成 500。
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025')) throw err
    }
    // 数据库行没了，磁盘文件也要跟着走，否则删除只是"从列表里消失"。
    await removeWorkImages(parseStoredImages(row.images))
    return { ok: true, id }
  })

  // ── 点赞 / 取消（幂等）────────────────────────────────────
  app.post('/works/:id/like', async (req) => {
    const me = await requireUser(req)
    await enforce(
      [{ key: `like:user:${me.id}`, limit: 200, windowMs: 60 * 60 * 1000 }],
      '点赞操作过于频繁',
    )
    const id = parseBody(workIdField, (req.params as { id?: string }).id)

    // 未发布作品不在展厅出现，也就不该能点赞；对客户端统一按"不存在"处理。
    const exists = await prisma.work.findUnique({
      where: { id },
      select: { hidden: true, published: true },
    })
    if (!exists || exists.hidden || !exists.published) throw notFound('作品不存在或已被删除')

    try {
      await prisma.workLike.create({ data: { workId: id, userId: me.id } })
    } catch (err) {
      // 已经点过 → 撞 (workId,userId) 唯一约束。这就是"幂等成功"，
      // 连点两下不该报错，也不该把赞数加两次。
      if (!isUniqueViolation(err)) {
        // 并发下检查通过后作品被删：外键冲突（P2003），对客户端就是"作品没了"
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          throw notFound('作品不存在或已被删除')
        }
        throw err
      }
    }

    return { liked: true, likes: await prisma.workLike.count({ where: { workId: id } }) }
  })

  app.delete('/works/:id/like', async (req) => {
    const me = await requireUser(req)
    await enforce(
      [{ key: `like:user:${me.id}`, limit: 200, windowMs: 60 * 60 * 1000 }],
      '点赞操作过于频繁',
    )
    const id = parseBody(workIdField, (req.params as { id?: string }).id)

    // deleteMany 而不是 delete：没点过赞时 delete 会抛 P2025，
    // 而"取消一个本来就没点的赞"应当安静地成功。
    await prisma.workLike.deleteMany({ where: { workId: id, userId: me.id } })

    return { liked: false, likes: await prisma.workLike.count({ where: { workId: id } }) }
  })
}
