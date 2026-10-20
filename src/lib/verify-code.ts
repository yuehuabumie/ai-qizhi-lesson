import { createHash, randomBytes, randomInt } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { ApiError } from './errors.js'

/**
 * 邮箱验证的「三段式」——整套设计照搬服务器上 301.group 已跑通的方案。
 *
 *   send-code    存 sha256(`${email}:${code}`)，15 分钟 TTL
 *   verify-code  校验通过后把 proofHash 写回**同一行**（注意：不标 usedAt）
 *   register     事务内凭 email+proofHash 原子地「认领」该行，再建号
 *
 * 为什么要有 proof，而不是「验证码对了就直接注册」：
 * 把「这个邮箱已验证」这件事，安全地**绑定到最终那次注册请求**上。
 * 否则攻击者拿到别人的验证码（或猜到）就能直接建号；而且验证码一旦可用，
 * 就存在重放窗口。proof 是 32 字节随机数，明文只回给前端一次，
 * 库里只存哈希——即使数据库被读也换不出可用凭证。
 */

export const CODE_TTL_MS = 15 * 60 * 1000
export const PROOF_TTL_MS = 15 * 60 * 1000

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')

/**
 * 6 位码只有 90 万种可能，单独哈希会被彩虹表秒破；
 * 混入 email 之后空间才够大。顺带解决另一个问题：不同用户摇到同一个码时，
 * `codeHash` 上的唯一索引不会打架。
 */
export function newCode(email: string) {
  const code = String(randomInt(100_000, 1_000_000))
  return { code, codeHash: sha256(`${email}:${code}`) }
}

export function newProof() {
  const proof = randomBytes(32).toString('base64url')
  return { proof, proofHash: sha256(proof) }
}

/** 作废该邮箱所有未使用的旧码，然后发一个新的。 */
export async function issueCode(email: string): Promise<string> {
  const now = new Date()

  await prisma.emailRegistrationCode.updateMany({
    where: { email, usedAt: null },
    data: { usedAt: now },
  })

  const expiresAt = new Date(now.getTime() + CODE_TTL_MS)

  // codeHash 是唯一索引，理论上会和历史行撞（同邮箱约 90 万分之一，
  // 而历史行不会被删）。撞了就重摇，不要把这个概率暴露成 500。
  for (let attempt = 0; attempt < 3; attempt++) {
    const { code, codeHash } = newCode(email)
    try {
      await prisma.emailRegistrationCode.create({ data: { email, codeHash, expiresAt } })
      return code
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
  throw new ApiError('INTERNAL_ERROR', '验证码生成失败，请稍后重试')
}

/**
 * 校验验证码，通过则签发 proof。
 * 注意这里**不**把行标记成已使用 —— proof 才是消费凭证，
 * 这样用户拿到 proof 后还能改昵称、返回上一步重填，不会白白作废。
 */
export async function verifyCode(
  email: string,
  code: string,
): Promise<{ proof: string; expiresInSeconds: number }> {
  const codeHash = sha256(`${email}:${code}`)
  const row = await prisma.emailRegistrationCode.findUnique({ where: { codeHash } })

  if (!row || row.email !== email) {
    throw new ApiError('CODE_INVALID', '验证码不正确')
  }
  if (row.usedAt) {
    throw new ApiError('CODE_INVALID', '验证码已失效，请重新获取')
  }
  const now = new Date()
  if (row.expiresAt <= now) {
    throw new ApiError('CODE_EXPIRED', '验证码已过期，请重新获取')
  }

  const { proof, proofHash } = newProof()
  await prisma.emailRegistrationCode.update({
    where: { id: row.id },
    data: {
      proofHash,
      // 顺延出一个完整的 15 分钟给用户填昵称和密码。
      // expiresAt 的语义自此从「验证码有效期」变成「proof 有效期」，
      // 但总寿命封顶在「签发后 30 分钟」——否则同一枚码每 15 分钟重新
      // verify 一次就能无限续期，邮件里写的「15 分钟有效」永远不成立。
      expiresAt: new Date(
        Math.min(
          now.getTime() + PROOF_TTL_MS,
          row.createdAt.getTime() + CODE_TTL_MS + PROOF_TTL_MS,
        ),
      ),
    },
  })

  return { proof, expiresInSeconds: Math.floor(PROOF_TTL_MS / 1000) }
}

/**
 * 在注册事务里原子地认领 proof。
 *
 * 必须是单条 `UPDATE ... WHERE`，不能先 SELECT 再 UPDATE ——
 * 两个并发的注册请求会同时读到「有效」然后都通过。updateMany 返回的
 * 受影响行数就是「抢到了没有」，这是整个流程里唯一不能省的一步。
 */
export async function consumeProof(
  tx: Prisma.TransactionClient,
  email: string,
  proof: string,
): Promise<void> {
  const res = await tx.emailRegistrationCode.updateMany({
    where: {
      email,
      proofHash: sha256(proof),
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  })
  if (res.count === 0) {
    throw new ApiError('PROOF_INVALID', '邮箱验证已失效，请重新获取验证码')
  }
}
