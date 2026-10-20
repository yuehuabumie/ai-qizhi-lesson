import { z } from 'zod'
import { badRequest } from './errors.js'

/**
 * 把 zod 的报错压成一条中文提示。
 *
 * 不用 zod 自带的英文 message：这些字符串会原样出现在前端的 ElMessage 里，
 * 给小学生和家长看的界面不能冒出 "Invalid input: expected string"。
 * 所以每个 schema 字段都自己写中文 message，这里只负责取第一条。
 */
export function parseBody<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw badRequest(issue?.message || '请求参数不正确')
  }
  return result.data
}

/** 邮箱字段复用，统一小写并去空格。 */
export const emailField = z
  .string({ message: '请填写邮箱' })
  .trim()
  .toLowerCase()
  .min(5, '邮箱格式不正确')
  .max(191, '邮箱过长')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, '邮箱格式不正确')

/** 一次性邮箱域名黑名单。挡不住人工批量注册，但能挡掉脚本刷的一大批。 */
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'throwawaymail.com', 'yopmail.com', 'sharklasers.com',
  'guerrillamailblock.com', 'grr.la', 'guerrillamail.info', 'spam4.me',
  'trashmail.com', 'trashmail.me', 'dispostable.com', 'mailnesia.com',
  'maildrop.cc', 'getnada.com', 'tempr.email', 'discard.email',
  'fakeinbox.com', 'throwaway.email', 'emailondeck.com', 'moakt.com',
  'mohmal.com', 'tempmailo.com', 'luxusmail.org', 'inboxkitten.com',
  'dropmail.me', '33mail.com',
])

export function assertNotDisposable(email: string) {
  const domain = email.slice(email.lastIndexOf('@') + 1)
  if (DISPOSABLE.has(domain)) {
    throw badRequest('请使用常用邮箱注册，临时邮箱无法接收验证码')
  }
}
