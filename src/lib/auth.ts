import type { FastifyReply, FastifyRequest } from 'fastify'
import { SignJWT, jwtVerify } from 'jose'
import { env } from '../env.js'
import { prisma } from './db.js'
import { unauthorized } from './errors.js'

/**
 * 会话 = HS256 JWT 装在 httpOnly cookie 里。
 *
 * payload 只有 `{ sub: userId, sv: sessionVersion }`。
 * `sv` 是「踢下线」机制：改密码 / 退出所有设备时把 users.sessionVersion +1，
 * 所有旧 token 立刻失效——比维护一张会话表轻得多，代价是每个鉴权请求
 * 多一次主键查询（这个量级完全无所谓）。
 */

const secret = new TextEncoder().encode(env.AUTH_SECRET)
const ALG = 'HS256'

export const SESSION_MAX_AGE = env.SESSION_TTL_DAYS * 24 * 60 * 60

export interface PublicUser {
  id: string
  email: string
  nickname: string
  avatarHue: number
  avatarUrl: string | null
  quizBest: number
}

export async function signSession(userId: string, sessionVersion: number): Promise<string> {
  return await new SignJWT({ sv: sessionVersion })
    .setProtectedHeader({ alg: ALG })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret)
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(env.COOKIE_NAME, token, {
    // ⚠️ path 必须显式写 '/'。默认值是「当前请求路径」，在 /api/auth/login
    // 下发的话浏览器只在 /api/auth/* 带上它，/api/progress 就永远 401。
    path: '/',
    httpOnly: true, // 前端 JS 读不到，防 XSS 偷 token
    sameSite: 'strict', // 防 CSRF：跨站发起的请求不带这个 cookie
    secure: env.COOKIE_SECURE,
    maxAge: SESSION_MAX_AGE,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(env.COOKIE_NAME, { path: '/' })
}

/** 解出 token 里的 { userId, sv }。过期、签名不对、被改过，都归为 null，不区分原因。 */
async function sessionClaims(token: string): Promise<{ userId: string; sv: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [ALG] })
    const userId = payload.sub ?? ''
    const sv = typeof payload.sv === 'number' ? payload.sv : NaN
    if (!userId || Number.isNaN(sv)) return null
    return { userId, sv }
  } catch {
    return null
  }
}

/** 查库并把行转成 PublicUser。用户不存在或 sessionVersion 不符都返回 null。 */
async function loadUser(userId: string, sv: number): Promise<PublicUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
  if (!user || user.sessionVersion !== sv) return null
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    avatarHue: user.avatarHue,
    avatarUrl: user.avatarUrl,
    quizBest: user.quizBest,
  }
}

/**
 * 未登录时返回 null，不抛异常——给 /api/auth/me 这类「可选登录」接口用。
 * 注意：只有「token 无效 / 用户不存在 / 已踢下线」才当未登录；
 * 数据库故障要照常抛出去（500），不能在 DB 挂掉时把所有人伪装成匿名。
 */
export async function optionalUser(req: FastifyRequest): Promise<PublicUser | null> {
  const token = req.cookies[env.COOKIE_NAME]
  if (!token) return null
  const claims = await sessionClaims(token)
  if (!claims) return null
  return await loadUser(claims.userId, claims.sv)
}

/** 需要登录的接口在 handler 第一行调用；不满足直接抛 401。 */
export async function requireUser(req: FastifyRequest): Promise<PublicUser> {
  const token = req.cookies[env.COOKIE_NAME]
  if (!token) throw unauthorized()

  const claims = await sessionClaims(token)
  if (!claims) throw unauthorized('登录已过期，请重新登录')

  const user = await loadUser(claims.userId, claims.sv)
  if (!user) throw unauthorized('登录已失效，请重新登录')
  return user
}
