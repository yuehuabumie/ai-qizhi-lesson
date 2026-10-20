import { PrismaClient } from '@prisma/client'
import { isProd } from '../env.js'

/**
 * 全局单例。
 *
 * tsx watch 在开发时会重复求值模块，不挂到 globalThis 上会每改一次代码就
 * 新建一个连接池，几十次热重载之后 MySQL 就 max_connections 了。
 */
const globalForPrisma = globalThis as unknown as { __aiqPrisma?: PrismaClient }

export const prisma =
  globalForPrisma.__aiqPrisma ??
  new PrismaClient({
    log: ['warn', 'error'],
  })

if (!isProd) globalForPrisma.__aiqPrisma = prisma

/** 供 /api/health 用：不抛异常，只回报通不通。 */
export async function pingDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}
