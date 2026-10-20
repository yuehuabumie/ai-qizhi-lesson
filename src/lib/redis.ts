import Redis from 'ioredis'
import { env } from '../env.js'

/**
 * Redis 只用来做限流计数（见 lib/rate-limit.ts），**不是**关键路径。
 *
 * 服务器上 301.group 也在这台机器上跑，但它用的是默认 db0；我们用 db1，
 * 前缀再叠一层 `aiq:`，双重隔离，`FLUSHDB` 都不会互相误伤。
 *
 * 连不上不能拖垮整个服务：rate-limit 那边会在 redis 不可用时降级成
 * 进程内 Map，所以这里的策略是「一直重连、但别把错误刷屏」。
 *
 * 刻意**不用** ioredis 的 `keyPrefix` 选项：它对 `EVAL` 里的 KEYS 是否生效
 * 取决于是不是走 `defineCommand`，容易踩坑，而且排查时看不出真实键名。
 * 改成在代码里显式拼 —— 见 `rk()`。
 */
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false, // 掉线时立刻失败，交给降级逻辑，不要挂起请求
  retryStrategy: (times) => Math.min(times * 500, 10_000),
  lazyConnect: false,
})

/** 拼全限定键名。所有 Redis 键都必须过这一层，别裸写字符串。 */
export const rk = (key: string) => `${env.REDIS_PREFIX}${key}`

// 未捕获的 'error' 事件会让 Node 直接退出进程。
let lastErrLog = 0
redis.on('error', (err: Error) => {
  const now = Date.now()
  if (now - lastErrLog > 60_000) {
    lastErrLog = now
    console.warn('[redis] 连接异常（已降级为进程内限流）：', err.message)
  }
})

/** 供 /api/health 用：不抛异常，只回报通不通。 */
export async function pingRedis(): Promise<boolean> {
  try {
    if (redis.status !== 'ready') return false
    const pong = await redis.ping()
    return pong === 'PONG'
  } catch {
    return false
  }
}

export async function closeRedis() {
  try {
    await redis.quit()
  } catch {
    redis.disconnect()
  }
}
