import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../env.js'
import { ApiError } from './errors.js'

/**
 * 复用 301.group 的阿里云企业邮账号。
 *
 * 发件域是 301.group，SPF/DKIM 对它自洽，不会因为我们的站点叫 yuehua.online
 * 而失配 —— 这是选它而不是新开账号的主要原因。
 *
 * 两个坑：
 *  1. 阿里企业邮对突发发信有 454 限速。所以有一个**全进程串行队列**，
 *     同一时刻只有一封在飞。13 个学生的验证码排队几百毫秒，无感。
 *  2. 连接池一旦坏掉（对端 RST、认证过期）会一直坏下去，每次请求都失败。
 *     所以发送异常时把池子整个重建。
 */

const transportOptions = {
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD },
  pool: true,
  maxConnections: 2,
  maxMessages: 50, // 超过就换一条连接，规避长期连接被中间设备掐断
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 20_000,
} as const

let transporter: Transporter = nodemailer.createTransport(transportOptions)

function rebuild(): void {
  try {
    transporter.close()
  } catch {
    /* 已经坏了就算了 */
  }
  transporter = nodemailer.createTransport(transportOptions)
}

/**
 * 全进程串行队列。前一个任务失败也要继续跑下一个，
 * 所以链上挂的是「吞掉结果」的版本——否则一次失败会把队列永久卡死。
 */
let chain: Promise<unknown> = Promise.resolve()

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn)
  chain = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export interface CodeMail {
  to: string
  code: string
}

/** 纯文本 + 极简 HTML。刻意不放图片、不放短链——那些是垃圾邮件评分的高危项。 */
function compose(code: string) {
  const subject = '【AI 启智课】邮箱验证码'

  const text = [
    '你好，',
    '',
    '你正在注册「AI 启智课」账号，验证码是：',
    '',
    `    ${code}`,
    '',
    '验证码 15 分钟内有效，请勿转发给他人。',
    '',
    '如果这不是你本人的操作，忽略本邮件即可，你的邮箱不会被注册。',
    '',
    '—— AI 启智课 · 小学人工智能通识课教学平台',
  ].join('\n')

  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f5f6f8;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;color:#1f2430;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:28px;">
    <p style="margin:0 0 16px;font-size:15px;">你好，</p>
    <p style="margin:0 0 20px;font-size:15px;line-height:1.7;">
      你正在注册「AI 启智课」账号，验证码是：
    </p>
    <p style="margin:0 0 20px;font-size:32px;font-weight:700;letter-spacing:8px;text-align:center;color:#4f7cff;">
      ${code}
    </p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#6b7280;">
      验证码 15 分钟内有效，请勿转发给他人。
    </p>
    <p style="margin:0;font-size:13px;line-height:1.7;color:#6b7280;">
      如果这不是你本人的操作，忽略本邮件即可，你的邮箱不会被注册。
    </p>
    <hr style="margin:22px 0 14px;border:0;border-top:1px solid #eceef2;">
    <p style="margin:0;font-size:12px;color:#9aa1ac;">
      AI 启智课 · 小学人工智能通识课教学平台
    </p>
  </div>
</body></html>`

  return { subject, text, html }
}

export async function sendVerificationCode({ to, code }: CodeMail): Promise<void> {
  const { subject, text, html } = compose(code)

  await serialize(async () => {
    try {
      await transporter.sendMail({ from: env.SMTP_FROM, to, subject, text, html })
    } catch (err) {
      rebuild() // 池子大概率已经废了，换一套下次用
      const apiErr = translate(err)
      // 原始 SMTP 错误挂成 cause：translate 只给用户看人话，排障需要真实的
      // SMTP 响应（如 554 RCPT does not exist / 535 auth failed）。
      // pino 的 err 序列化会打印整条 cause 链，调用方照常 log({ err }) 即可。
      apiErr.cause = err
      throw apiErr
    }
  })
}

/** 把 nodemailer/SMTP 的英文报错翻成人话。原始错误挂在返回值的 cause 上。 */
function translate(err: unknown): ApiError {
  const e = err as { code?: string; responseCode?: number; message?: string }
  const code = e.code ?? ''
  const resp = e.responseCode ?? 0

  if (resp === 454 || code === 'EMESSAGE' || /too many|rate|limit/i.test(e.message ?? '')) {
    return new ApiError('MAIL_SEND_FAILED', '邮件发送过于频繁，请稍等一分钟再试')
  }
  if (code === 'EAUTH' || resp === 535) {
    return new ApiError('MAIL_SEND_FAILED', '邮件服务认证失败，请联系管理员')
  }
  if (['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EDNS'].includes(code)) {
    return new ApiError('MAIL_SEND_FAILED', '暂时连不上邮件服务器，请稍后再试')
  }
  return new ApiError('MAIL_SEND_FAILED', '验证码邮件发送失败，请稍后重试或换个邮箱')
}
