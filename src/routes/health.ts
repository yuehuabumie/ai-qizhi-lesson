import type { FastifyInstance } from 'fastify'
import { pingDb } from '../lib/db.js'
import { pingRedis } from '../lib/redis.js'

/**
 * GET /api/health —— 部署后第一条要 curl 的接口，不鉴权。
 *
 * 探针并发跑，避免一个慢就串行拖两个。db 不通直接 503：
 * 数据库挂了这服务就没有任何可用功能，让 nginx/监控看到红色比假装健康好。
 */
export async function healthRoutes(app: FastifyInstance) {
  app.get('/health', async (_req, reply) => {
    const [db, redisOk] = await Promise.all([pingDb(), pingRedis()])
    const healthy = db

    reply.code(healthy ? 200 : 503)
    return {
      ok: healthy,
      db,
      // redis 只是限流的加速器，挂了会自动降级，不影响 ok
      redis: redisOk,
      uptime: Math.round(process.uptime()),
      version: 1,
    }
  })
}
