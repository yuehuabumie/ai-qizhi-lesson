import type { FastifyInstance } from 'fastify'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/db.js'
import { requireUser } from '../lib/auth.js'
import { parseBody } from '../lib/validate.js'
import { badRequest } from '../lib/errors.js'
import { enforce } from '../lib/rate-limit.js'
import { MAX_WORKS_PER_USER } from './works.js'

/**
 * 学习进度。
 *
 * 设计要点：进度是**单调递增**的（做完不可能变回没做，分数只取更高），
 * 所以服务端所有写入都是「合并」而不是「覆盖」。这样多设备并发、
 * 断网重试、旧数据导入全都天然安全，不需要版本号或乐观锁——
 * 冲突的解决方式就是取并集，而并集是有交换律的。
 *
 * 唯一的例外是 DELETE /api/progress（重置），那是用户显式要求的清空。
 */

/** 训练 id 形如 quiz-arena / virtual-museum，限制字符集避免奇怪的东西进库 */
const labIdField = z
  .string({ message: '训练编号不正确' })
  .trim()
  .min(1, '训练编号不正确')
  .max(64, '训练编号过长')
  .regex(/^[A-Za-z0-9_-]+$/, '训练编号只能包含字母、数字、连字符')

const scoreField = z
  .number({ message: '分数必须是数字' })
  .int('分数必须是整数')
  .min(0, '分数不能为负')
  .max(10_000, '分数超出范围')

const noteField = z.string().trim().max(500, '备注最多 500 字')

const labPatch = z.object({
  done: z.boolean({ message: 'done 必须是布尔值' }).optional(),
  score: scoreField.nullish(),
  note: noteField.nullish(),
})

const quizPatch = z.object({ score: scoreField })

const importBody = z.object({
  labs: z.record(labIdField, labPatch).optional(),
  quizBest: scoreField.optional(),
  works: z
    .array(
      z.object({
        title: z.string().trim().min(1, '作品标题不能为空').max(120, '作品标题过长'),
        author: z.string().trim().max(60, '作者名过长').default(''),
        grade: z.string().trim().max(8, '学段参数不正确').default('low'),
        module: z.string().trim().max(8, '模块参数不正确').default(''),
        type: z.string().trim().max(32, '作品类型过长').default(''),
        desc: z.string().trim().max(1000, '作品描述过长').default(''),
        hue: z
          .number({ message: '色相必须是数字' })
          .int('色相必须是整数')
          .min(0, '色相超出范围')
          .max(360, '色相超出范围')
          .default(210),
      }),
    )
    .max(50, '一次最多导入 50 份作品')
    .optional(),
})

/** 单次导入的训练条目上限，跟互动训练总数同量级，防止构造超大 body */
const MAX_IMPORT_LABS = 200

/**
 * 单个账号最多能有多少条训练记录。
 *
 * labId 是客户端传的，不设上限的话，一个开放注册的账号可以拿随机 id
 * 无限 INSERT，把表撑大——真实训练只有 13 个，200 已经宽裕到不可能误伤。
 * 只在「要新建一行」时检查，更新已有记录不受影响。
 */
const MAX_LABS_PER_USER = 200

/**
 * 原子 upsert：一条 SQL 完成「取并集」，不先读后写。
 *
 * 先 SELECT 再 UPDATE 在并发下会丢分：两个请求都读到 0，分别写 90 和 80，
 * 结果是 80。交给数据库的 ON DUPLICATE KEY UPDATE 就不存在这个窗口。
 *
 * ⚠️ MySQL 8.0.20 起 `VALUES(col)` 已废弃（8.0.45 上会打 deprecation 警告），
 * 必须用行别名 `AS new` 再 `new.col` 引用新值。
 */
/** 事务内外通用：导入要整段放进事务，PUT 单条直接用全局 client */
type Db = Prisma.TransactionClient | typeof prisma

async function mergeLab(
  db: Db,
  userId: string,
  labId: string,
  patch: { done?: boolean; score?: number | null; note?: string | null },
): Promise<{ done: boolean; score: number | null; note: string | null; updatedAt: Date }> {
  const done = patch.done ?? false
  const score = patch.score ?? null
  const note = patch.note ?? null

  // 只在「这次会新建一行」时才数总数。并发下两个新 labId 可能同时通过检查，
  // 最多多出个位数行，无所谓——这里要挡的是无限增长，不是精确配额。
  const existing = await db.labProgress.findUnique({
    where: { userId_labId: { userId, labId } },
    select: { id: true },
  })
  if (!existing) {
    const n = await db.labProgress.count({ where: { userId } })
    if (n >= MAX_LABS_PER_USER) {
      throw badRequest(`单个账号最多记录 ${MAX_LABS_PER_USER} 个训练的进度`)
    }
  }

  // 旧值必须写全 `lab_progress.xxx`。
  // 一旦有了行别名 AS new，**裸列名会被判为 ambiguous**（MySQL 1052）——
  // 它同时存在于表和新行两个命名空间里，MySQL 不肯替你猜。
  // `new.xxx` 是本次想写入的新值。
  //
  // 时间一律 UTC_TIMESTAMP(3) 而不是 NOW(3)：这台 MySQL 会话时区是 +08，
  // 而 Prisma 读 DATETIME 时按 UTC 解释，用 NOW() 每行会多出 8 小时，
  // 还会跟 @updatedAt 写进去的 UTC 值混在同一列里。详见 schema.prisma 顶部。
  await db.$executeRaw`
    INSERT INTO lab_progress (userId, labId, done, score, note, createdAt, updatedAt)
    VALUES (${userId}, ${labId}, ${done}, ${score}, ${note}, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)) AS new
    ON DUPLICATE KEY UPDATE
      done      = lab_progress.done OR new.done,
      score     = CASE WHEN new.score IS NULL THEN lab_progress.score
                       ELSE GREATEST(COALESCE(lab_progress.score, 0), new.score) END,
      note      = COALESCE(new.note, lab_progress.note),
      updatedAt = UTC_TIMESTAMP(3)
  `

  const findRow = () =>
    db.labProgress.findUnique({
      where: { userId_labId: { userId, labId } },
      select: { done: true, score: true, note: true, updatedAt: true },
    })
  let row = await findRow()
  if (!row) {
    // 另一设备/标签的 DELETE /progress 可能恰好落在 upsert 提交与读回之间。
    // 重读一次；仍没有就按本次 patch 合成返回值——行刚被显式重置，
    // 服务端已没有权威值，回合成值比抛 500（假报服务端故障）好。
    row = await findRow()
  }
  return row ?? { done, score, note, updatedAt: new Date() }
}

/** 前端 ProgressMap 的形状，跟 stores/app.ts 的 LabRecord 对齐 */
function toLabRecord(row: {
  labId: string
  done: boolean
  score: number | null
  note: string | null
  updatedAt: Date
}) {
  return {
    labId: row.labId,
    done: row.done,
    score: row.score,
    note: row.note,
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function progressRoutes(app: FastifyInstance) {
  // ── 拉取全量进度 ──────────────────────────────────────────
  app.get('/progress', async (req) => {
    const me = await requireUser(req)
    const rows = await prisma.labProgress.findMany({
      where: { userId: me.id },
      select: { labId: true, done: true, score: true, note: true, updatedAt: true },
    })

    // 用对象而非数组返回：前端本来就是以 labId 为键的 map，
    // 省一次 reduce，而且顺序无关（进度没有顺序语义）
    const labs: Record<string, ReturnType<typeof toLabRecord>> = {}
    for (const r of rows) {
      const rec = toLabRecord(r)
      labs[r.labId] = rec
    }

    return { labs, quizBest: me.quizBest }
  })

  // ── 更新单个训练 ──────────────────────────────────────────
  app.put('/progress/labs/:labId', async (req) => {
    const me = await requireUser(req)
    // 必须走 parseBody：直接 .parse() 抛的是 ZodError，不是 ApiError，
    // 会被全局兜底当成 500。客户端传错参数是 400，不是服务端故障。
    const labId = parseBody(labIdField, (req.params as { labId?: string }).labId)
    const patch = parseBody(labPatch, req.body)

    if (patch.done === undefined && patch.score == null && patch.note == null) {
      throw badRequest('没有要更新的内容')
    }

    const row = await mergeLab(prisma, me.id, labId, patch)
    // 回传合并后的权威值，前端用它校正本地乐观更新
    return { lab: toLabRecord({ labId, ...row }) }
  })

  // ── 知识挑战赛最好成绩 ────────────────────────────────────
  app.put('/progress/quiz', async (req) => {
    const me = await requireUser(req)
    const { score } = parseBody(quizPatch, req.body)

    // 一条 UPDATE + GREATEST，天然原子，不需要事务
    await prisma.$executeRaw`
      UPDATE users SET quizBest = GREATEST(quizBest, ${score}), updatedAt = UTC_TIMESTAMP(3)
      WHERE id = ${me.id}
    `
    const user = await prisma.user.findUnique({
      where: { id: me.id },
      select: { quizBest: true },
    })
    return { quizBest: user?.quizBest ?? score }
  })

  // ── 清空进度（用户显式重置）────────────────────────────────
  app.delete('/progress', async (req) => {
    const me = await requireUser(req)
    await prisma.$transaction([
      prisma.labProgress.deleteMany({ where: { userId: me.id } }),
      prisma.user.update({ where: { id: me.id }, data: { quizBest: 0 } }),
    ])
    return { labs: {}, quizBest: 0 }
  })

  // ── 旧 localStorage 一次性导入 ────────────────────────────
  // 刻意做成「合并」而非「覆盖」：先在新设备登录过、再回老设备导入的场景下，
  // 覆盖会把新设备上做的进度抹掉，合并不会。
  app.post('/progress/import', async (req) => {
    const me = await requireUser(req)
    // 导入会批量写进度、挑战赛成绩和作品，必须有限流：
    // 真正常态是每台设备一次，1 小时 10 次已经宽裕到不可能误伤
    await enforce(
      [{ key: `pi:user:${me.id}`, limit: 10, windowMs: 60 * 60 * 1000 }],
      '导入过于频繁',
    )
    const body = parseBody(importBody, req.body)

    const labEntries = Object.entries(body.labs ?? {})
    if (labEntries.length > MAX_IMPORT_LABS) {
      throw badRequest(`一次最多导入 ${MAX_IMPORT_LABS} 条训练记录`)
    }

    // 整段放进一个事务：中途失败（如撞 200 条进度上限）不再留下
    // 「API 说失败、数据却导了一半」的半提交状态
    return await prisma.$transaction(
      async (tx) => {
        let importedLabs = 0
        for (const [labId, patch] of labEntries) {
          await mergeLab(tx, me.id, labId, patch)
          importedLabs += 1
        }

        let quizBest = me.quizBest
        if (body.quizBest != null) {
          await tx.$executeRaw`
            UPDATE users SET quizBest = GREATEST(quizBest, ${body.quizBest}), updatedAt = UTC_TIMESTAMP(3)
            WHERE id = ${me.id}
          `
          const u = await tx.user.findUnique({
            where: { id: me.id },
            select: { quizBest: true },
          })
          quizBest = u?.quizBest ?? quizBest
        }

        // 本机作品一并搬上云。这里不走 P7 的 /works 接口（那是给「新创作」的，
        // 导入是批量场景），但 /works 有的两道闸这里必须同口径补上：
        //   · 配额：否则 import 是绕过 MAX_WORKS_PER_USER 灌水的后门
        //   · 内容去重：createMany 不是幂等的，响应丢失后重试/双标签确认
        //     会把同一批作品重复上墙。同账号 title+desc+type+hue 全同视为同一份。
        // 客户端没带创作时间，落库时间就是导入时刻。
        let importedWorks = 0
        if (body.works?.length) {
          const existing = await tx.work.findMany({
            where: { userId: me.id },
            select: { title: true, description: true, type: true, hue: true },
          })
          const seen = new Set(
            existing.map((w) => `${w.title}\u0000${w.description}\u0000${w.type}\u0000${w.hue}`),
          )
          const fresh = body.works.filter((w) => {
            const key = `${w.title}\u0000${w.desc}\u0000${w.type}\u0000${w.hue}`
            if (seen.has(key)) return false
            seen.add(key) // 同一批里的重复也去掉
            return true
          })
          const remaining = Math.max(0, MAX_WORKS_PER_USER - existing.length)
          // 旧版本的本机作品本来就是"在展厅里"的，导入后保持已发布，
          // 否则用户升级后会发现自己的作品全从展厅消失。
          const importedAt = new Date()
          const data = fresh.slice(0, remaining).map((w) => ({
            userId: me.id,
            title: w.title,
            // author 以账号昵称为准：本机存的名字可能是随手填的
            author: me.nickname,
            grade: w.grade,
            module: w.module,
            type: w.type,
            description: w.desc,
            hue: w.hue,
            published: true,
            publishedAt: importedAt,
          }))
          if (data.length) {
            const res = await tx.work.createMany({ data })
            importedWorks = res.count
          }
        }

        return { importedLabs, importedWorks, quizBest }
      },
      { timeout: 20_000 },
    )
  })
}
