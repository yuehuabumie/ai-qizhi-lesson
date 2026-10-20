import type { FastifyInstance } from 'fastify'
import { randomInt } from 'node:crypto'
import { compare, hash } from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../lib/db.js'
import { ApiError, badRequest } from '../lib/errors.js'
import { assertNotDisposable, emailField, parseBody } from '../lib/validate.js'
import { clear, clientIp, enforce, peek, peekTtlSec, record } from '../lib/rate-limit.js'
import {
  clearSessionCookie,
  optionalUser,
  requireUser,
  setSessionCookie,
  signSession,
  type PublicUser,
} from '../lib/auth.js'
import { consumeProof, issueCode, verifyCode } from '../lib/verify-code.js'
import { sendVerificationCode } from '../lib/mailer.js'
import {
  AVATAR_BODY_LIMIT,
  decodeAvatarDataUrl,
  persistAvatar,
  removeAvatar,
} from '../lib/avatar-images.js'
import { moderateAvatar } from '../lib/avatar-moderation.js'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/**
 * 限流参数集中在这里，方便按实际情况调。
 *
 * ⚠️ IP 维度必须按「一个机房一个 NAT 出口」来设，不能按「一个人一个 IP」。
 * 这个平台是给小学课堂用的：老师一声令下，40 个学生在同一间机房同时点
 * 「发送验证码」，出口 IP 完全一样。计划里原始值（发码 3 次/30 分钟、
 * 注册 5 次/天）会让第 4 个学生开始全部失败——最核心的使用场景直接不可用。
 *
 * 真正防滥用的不是 IP 限额，而是这三条**按账号**的限制：
 *   1. 每个账号必须有一个能收信的真实邮箱
 *   2. 单邮箱发码 60 秒冷却
 *   3. 单邮箱验证码错 5 次即作废、密码错 5 次锁 15 分钟
 * IP 限额只负责挡住「单机脚本刷」，所以按机房规模放宽，别误伤真人。
 */
const LIMITS = {
  sendCodeEmail: { limit: 1, windowMs: 1 * MINUTE },
  sendCodeIp: { limit: 60, windowMs: 10 * MINUTE },
  sendCodeIpDaily: { limit: 150, windowMs: DAY },

  verifyIp: { limit: 100, windowMs: 10 * MINUTE },
  verifyFailPerEmail: 5,

  registerIp: { limit: 40, windowMs: 10 * MINUTE },
  registerIpDaily: { limit: 120, windowMs: DAY },

  loginIp: { limit: 100, windowMs: 10 * MINUTE },
  loginFailPerEmail: 5,
  loginLockMs: 15 * MINUTE,

  // 资料修改是登录后的低频操作；改密码要防住「拿到会话后暴力试旧密码」
  profileUser: { limit: 30, windowMs: 60 * MINUTE },
  passwordUser: { limit: 20, windowMs: 60 * MINUTE },
  passwordIp: { limit: 60, windowMs: 60 * MINUTE },
  avatarUser: { limit: 20, windowMs: 60 * MINUTE },
} as const

/** bcrypt 成本因子。10 ≈ 60–100ms，登录接口能接受。 */
const BCRYPT_ROUNDS = 10

/**
 * 用户不存在时也要跑一次 bcrypt.compare，否则响应时间会明显更短，
 * 攻击者能靠计时把「哪些邮箱注册过」枚举出来。
 * 这是 "password" 的哈希，比对结果必然为 false（因为调用点已经有 `!user ||` 兜底）。
 */
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

const passwordField = z
  .string({ message: '请填写密码' })
  .min(8, '密码至少 8 位')
  // bcrypt 只取前 72 **字节**，超长部分会被静默丢弃。
  // 按字节而不是字符校验：24 个汉字就是 72 字节，按字符算会放进来被截断的密码
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, '密码过长：最多 72 字节（约 24 个汉字）')

const nicknameField = z
  .string({ message: '请填写昵称' })
  .trim()
  .min(1, '请填写昵称')
  .max(20, '昵称最多 20 个字')
  // 挡掉控制字符和零宽字符：它们会让昵称在列表里显示成空白或被截断
  .refine(
    (v) => !/[\u0000-\u001F\u007F\u200B-\u200F\u2028\u2029\uFEFF]/.test(v),
    '昵称包含非法字符',
  )

const avatarHueField = z
  .number({ message: '头像颜色不正确' })
  .int('头像颜色不正确')
  .min(0, '头像颜色不正确')
  .max(359, '头像颜色不正确')

function toPublic(u: {
  id: string
  email: string
  nickname: string
  avatarHue: number
  avatarUrl: string | null
  quizBest: number
}): PublicUser {
  return {
    id: u.id,
    email: u.email,
    nickname: u.nickname,
    avatarHue: u.avatarHue,
    avatarUrl: u.avatarUrl,
    quizBest: u.quizBest,
  }
}

export async function authRoutes(app: FastifyInstance) {
  // ── 发验证码 ────────────────────────────────────────────
  app.post('/auth/send-code', async (req) => {
    const { email } = parseBody(z.object({ email: emailField }), req.body)
    const ip = clientIp(req)

    assertNotDisposable(email)

    // 顺序有意义：最容易误伤的排最前，被拒时不会消耗后面的额度
    await enforce(
      [
        { key: `sc:mail:${email}`, ...LIMITS.sendCodeEmail },
        { key: `sc:ip:${ip}`, ...LIMITS.sendCodeIp },
        { key: `sc:ipd:${ip}`, ...LIMITS.sendCodeIpDaily },
      ],
      '验证码发送过于频繁',
    )

    const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (exists) throw new ApiError('EMAIL_EXISTS', '该邮箱已注册，请直接登录')

    const code = await issueCode(email)

    try {
      await sendVerificationCode({ to: email, code })
    } catch (err) {
      // 原始 SMTP 报错在 err.cause 上，只进日志，不回给客户端（可能含服务器地址、账号信息）
      req.log.error({ err, email }, '验证码邮件发送失败')
      throw err
    }

    // 新码已作废旧码（issueCode 内 updateMany），验错锁跟着按「码」清零：
    // 不清的话上一条 429 里「请重新获取验证码」就是空话——拿新码也还锁着。
    // 安全性不变：新码是新随机数，此前猜的全作废，爆破上限就是每枚码 5 次。
    await clear(`vc:fail:${email}`)

    req.log.info({ email, ip }, '验证码已发送')
    return { ok: true, message: '验证码已发送，请查收邮件（也看一眼垃圾箱）', expiresInSeconds: 900 }
  })

  // ── 校验验证码，换取 proof ──────────────────────────────
  app.post('/auth/verify-code', async (req) => {
    const { email, code } = parseBody(
      z.object({
        email: emailField,
        code: z
          .string({ message: '请输入验证码' })
          .trim()
          .regex(/^\d{6}$/, '验证码是 6 位数字'),
      }),
      req.body,
    )
    const ip = clientIp(req)

    await enforce([{ key: `vc:ip:${ip}`, ...LIMITS.verifyIp }], '尝试过于频繁')

    // 针对单个邮箱的爆破防护：6 位码只有 90 万种，不限次数是能被跑穿的。
    // 这条才是防爆破的主力，IP 限额只是辅助。
    const failKey = `vc:fail:${email}`
    if ((await peek(failKey)) >= LIMITS.verifyFailPerEmail) {
      throw new ApiError('RATE_LIMITED', '验证码错误次数过多，请重新获取验证码', {
        retryAfter: Math.max(1, await peekTtlSec(failKey)),
      })
    }

    try {
      const result = await verifyCode(email, code)
      await clear(failKey)
      return result
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CODE_INVALID') {
        await record(failKey, 10 * MINUTE)
      }
      throw err
    }
  })

  // ── 注册 ───────────────────────────────────────────────
  app.post('/auth/register', async (req, reply) => {
    const body = parseBody(
      z.object({
        email: emailField,
        proof: z.string({ message: '缺少邮箱验证凭证' }).min(20, '邮箱验证凭证无效').max(200),
        password: passwordField,
        nickname: nicknameField,
      }),
      req.body,
    )
    const ip = clientIp(req)

    await enforce(
      [
        { key: `rg:ip:${ip}`, ...LIMITS.registerIp },
        { key: `rg:ipd:${ip}`, ...LIMITS.registerIpDaily },
      ],
      '注册过于频繁',
    )

    // 哈希放在事务外：bcrypt 要几十到一百毫秒，不该占着数据库连接
    const passwordHash = await hash(body.password, BCRYPT_ROUNDS)

    const user = await prisma
      .$transaction(async (tx) => {
        const dup = await tx.user.findUnique({
          where: { email: body.email },
          select: { id: true },
        })
        if (dup) throw new ApiError('EMAIL_EXISTS', '该邮箱已注册，请直接登录')

        // 原子认领，并发双开时只有一个能抢到
        await consumeProof(tx, body.email, body.proof)

        return await tx.user.create({
          data: {
            email: body.email,
            passwordHash,
            nickname: body.nickname,
            avatarHue: randomInt(0, 360),
            // 走到这里邮箱必然已验证过，直接落时间戳，不做二次确认邮件
            emailVerifiedAt: new Date(),
          },
          select: {
            id: true,
            email: true,
            nickname: true,
            avatarHue: true,
            avatarUrl: true,
            quizBest: true,
            sessionVersion: true,
          },
        })
      })
      .catch((err: unknown) => {
        // 极端并发下两个请求都过了 dup 检查，后到的撞唯一索引
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ApiError('EMAIL_EXISTS', '该邮箱已注册，请直接登录')
        }
        throw err
      })

    setSessionCookie(reply, await signSession(user.id, user.sessionVersion))
    req.log.info({ userId: user.id, email: user.email, ip }, '新用户注册')

    return { ok: true, user: toPublic(user) }
  })

  // ── 登录 ───────────────────────────────────────────────
  app.post('/auth/login', async (req, reply) => {
    const { email, password } = parseBody(
      z.object({ email: emailField, password: z.string({ message: '请填写密码' }).min(1) }),
      req.body,
    )
    const ip = clientIp(req)

    await enforce([{ key: `lg:ip:${ip}`, ...LIMITS.loginIp }], '登录尝试过于频繁')

    const user = await prisma.user.findUnique({ where: { email } })
    const ok = await compare(password, user?.passwordHash ?? DUMMY_HASH)

    if (user && ok) {
      await clear(`lg:lock:${email}`)
      setSessionCookie(reply, await signSession(user.id, user.sessionVersion))
      return { ok: true, user: toPublic(user) }
    }

    // 锁只在失败路径上判定和累计——不能放在密码比对之前。
    // 先判锁的话，知道同学邮箱的人每 15 分钟错 5 次，就能让受害者
    // 拿着正确密码也登不进来（定向锁死），而邮箱是否注册本就是可枚举的。
    const lockKey = `lg:lock:${email}`
    if ((await peek(lockKey)) >= LIMITS.loginFailPerEmail) {
      throw new ApiError('RATE_LIMITED', '该账号密码错误次数过多，请 15 分钟后再试', {
        retryAfter: Math.max(1, await peekTtlSec(lockKey)),
      })
    }
    await record(lockKey, LIMITS.loginLockMs)
    // 不区分「邮箱不存在」和「密码错误」，避免账号枚举
    throw new ApiError('UNAUTHORIZED', '邮箱或密码不正确')
  })

  // ── 登出 ───────────────────────────────────────────────
  app.post('/auth/logout', async (_req, reply) => {
    // 无状态 JWT 没法「撤销」，只能让浏览器把 cookie 删掉。
    // 强制下线走 sessionVersion +1，见上面的改密码接口。
    clearSessionCookie(reply)
    return { ok: true }
  })

  // ── 当前用户 ───────────────────────────────────────────
  // 与计划里写的「未登录返回 401」有出入：这里改成 200 + { user: null }。
  // 原因：前端每次进页面都会调一次它探活，匿名访客是绝大多数，
  // 每次都在控制台刷一条红色 401 会淹没真正的错误。
  app.get('/auth/me', async (req) => {
    return { user: await optionalUser(req) }
  })

  // ── 修改资料（昵称 / 头像色）───────────────────────────
  app.patch('/auth/profile', async (req) => {
    const me = await requireUser(req)
    await enforce(
      [{ key: `pf:user:${me.id}`, ...LIMITS.profileUser }],
      '修改资料太频繁，请稍后再试',
    )
    const body = parseBody(
      z
        .object({
          nickname: nicknameField.optional(),
          avatarHue: avatarHueField.optional(),
        })
        .refine((v) => v.nickname !== undefined || v.avatarHue !== undefined, {
          message: '没有要修改的内容',
        }),
      req.body,
    )

    // 昵称是作品署名的唯一来源。改了昵称却只更新 users 表的话，
    // 展厅里旧作品仍挂着旧名字，学生会以为没改成功。
    const nicknameChanged = body.nickname !== undefined && body.nickname !== me.nickname
    const user = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: me.id },
        data: {
          ...(body.nickname !== undefined ? { nickname: body.nickname } : {}),
          ...(body.avatarHue !== undefined ? { avatarHue: body.avatarHue } : {}),
        },
        select: {
          id: true,
          email: true,
          nickname: true,
          avatarHue: true,
          avatarUrl: true,
          quizBest: true,
        },
      })
      if (nicknameChanged) {
        // 上限 200 份，单条 UPDATE 足够；和用户行同事务，避免只改一半。
        await tx.work.updateMany({
          where: { userId: me.id },
          data: { author: body.nickname as string },
        })
      }
      return u
    })

    return { ok: true, user: toPublic(user) }
  })

  // ── 上传 / 移除头像 ─────────────────────────────────────
  // 单独放宽 4MB bodyLimit：全局 256KB 是给文字接口的，一张 2MB 图片
  // 转成 base64 就会超过它。这里仍按「解码后 ≤2MB + 魔数校验」收口。
  const AVATAR_SELECT = {
    id: true,
    email: true,
    nickname: true,
    avatarHue: true,
    avatarUrl: true,
    quizBest: true,
  } as const

  app.post('/auth/avatar', { bodyLimit: AVATAR_BODY_LIMIT }, async (req) => {
    const me = await requireUser(req)
    await enforce(
      [{ key: `av:user:${me.id}`, ...LIMITS.avatarUser }],
      '头像上传太频繁，请稍后再试',
    )
    const { image } = parseBody(
      z.object({
        image: z
          .string({ message: '请选择头像图片' })
          .min(1, '请选择头像图片')
          .max(3_000_000, '头像图片太大（最多 2MB）'),
      }),
      req.body,
    )
    const buf = decodeAvatarDataUrl(image)
    if (!buf) throw badRequest('头像格式不正确（仅支持 PNG/JPEG/WebP，且不超过 2MB）')

    // 明确违规才拒绝；审核服务不可用/超时返回 null，按放行处理。
    // 失败时记 category 不记图片内容，方便排查模型是否过严。
    const verdict = await moderateAvatar(buf)
    if (verdict && !verdict.safe) {
      req.log.info({ userId: me.id, category: verdict.category }, '头像未通过 AI 审核')
      throw badRequest(
        verdict.reason ? `头像未通过审核：${verdict.reason}` : '头像未通过审核，请换一张图片',
      )
    }

    const saved = await persistAvatar(me.id, buf)
    let user
    try {
      user = await prisma.user.update({
        where: { id: me.id },
        data: { avatarUrl: saved },
        select: AVATAR_SELECT,
      })
    } catch (err) {
      // 行没写上就不能把新文件留在磁盘上
      await removeAvatar(saved)
      throw err
    }
    await removeAvatar(me.avatarUrl)
    req.log.info({ userId: me.id, avatar: saved }, '用户更新头像')

    return { ok: true, user: toPublic(user) }
  })

  app.delete('/auth/avatar', async (req) => {
    const me = await requireUser(req)
    await enforce(
      [{ key: `av:user:${me.id}`, ...LIMITS.avatarUser }],
      '头像操作太频繁，请稍后再试',
    )
    const user = await prisma.user.update({
      where: { id: me.id },
      data: { avatarUrl: null },
      select: AVATAR_SELECT,
    })
    await removeAvatar(me.avatarUrl)
    return { ok: true, user: toPublic(user) }
  })

  // ── 修改密码 ───────────────────────────────────────────
  // 校验旧密码 → 换新哈希 → sessionVersion +1（其他设备立即失效）→
  // 给当前设备签一张新版本号的 cookie，避免「改完密码把自己也踢下线」。
  app.post('/auth/password', async (req, reply) => {
    const me = await requireUser(req)
    await enforce(
      [
        { key: `pw:user:${me.id}`, ...LIMITS.passwordUser },
        { key: `pw:ip:${clientIp(req)}`, ...LIMITS.passwordIp },
      ],
      '修改密码太频繁，请稍后再试',
    )
    const body = parseBody(
      z.object({
        currentPassword: z.string({ message: '请输入当前密码' }).min(1, '请输入当前密码'),
        newPassword: passwordField,
      }),
      req.body,
    )
    if (body.currentPassword === body.newPassword) {
      throw badRequest('新密码不能和当前密码相同')
    }

    const row = await prisma.user.findUnique({
      where: { id: me.id },
      select: { passwordHash: true },
    })
    if (!row) throw new ApiError('UNAUTHORIZED', '登录已失效，请重新登录')
    if (!(await compare(body.currentPassword, row.passwordHash))) {
      throw badRequest('当前密码不正确')
    }

    const passwordHash = await hash(body.newPassword, BCRYPT_ROUNDS)
    const user = await prisma.user.update({
      where: { id: me.id },
      data: { passwordHash, sessionVersion: { increment: 1 } },
      select: {
        id: true,
        email: true,
        nickname: true,
        avatarHue: true,
        avatarUrl: true,
        quizBest: true,
        sessionVersion: true,
      },
    })
    setSessionCookie(reply, await signSession(user.id, user.sessionVersion))
    req.log.info({ userId: me.id, ip: clientIp(req) }, '用户修改密码')

    return { ok: true, user: toPublic(user) }
  })
}
