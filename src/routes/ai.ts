import { randomInt } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { env } from '../env.js'
import { optionalUser, requireUser } from '../lib/auth.js'
import {
  ASSIGN_AI_LIMIT,
  consumeAssignmentAiCall,
  optionalAssignment,
  refundAssignmentAiCall,
} from '../lib/assignment.js'
import { parseBody } from '../lib/validate.js'
import { ApiError, badRequest, forbidden, unauthorized } from '../lib/errors.js'
import { enforce, clientIp } from '../lib/rate-limit.js'

/**
 * 提示词魔法工坊的真实出图。
 *
 * 浏览器永远不接触上游密钥：前端只调这里，服务端带上 `AI_IMAGE_API_KEY`
 * 转发到阿里云 MaaS。两种模型的上游协议不同：
 *   · z-image 系列：百炼原生同步接口（multimodal-generation），一次固定 1 张；
 *     这里按 n 并发调用拼出候选（实测单张约 4–6 秒）。
 *   · qwen-image 系列：OpenAI 兼容的 `/images/generations`，一次可出 4 张，
 *     但约需 40–60 秒。
 *
 * 出图是一次同步上游调用，所以：
 *   · 本接口的 fetch 超时给到 120–280s；
 *   · nginx `/api/` 的 proxy_read_timeout 必须 ≥ 300s，否则浏览器先收到 504；
 *   · 限流必须按「一次点击 = 最多 4 张图 = 真金白银」来设，不能照抄普通写接口。
 */

const MAX_IMAGES = 4
const IS_Z_IMAGE = env.AI_IMAGE_MODEL.startsWith('z-image')

const genBody = z.object({
  prompt: z
    .string({ message: '缺少提示词' })
    .trim()
    .min(1, '缺少提示词')
    .max(800, '提示词太长，精简一下再试'),
  n: z
    .number({ message: '生成数量必须是数字' })
    .int('生成数量必须是整数')
    .min(1, '生成数量至少 1 张')
    .max(MAX_IMAGES, `一次最多生成 ${MAX_IMAGES} 张`)
    .default(MAX_IMAGES),
})

const storyBody = z.object({
  prompts: z
    .array(
      z
        .string({ message: '缺少提示词' })
        .trim()
        .min(1, '缺少提示词')
        .max(800, '提示词太长，精简一下再试'),
      { message: '缺少提示词' },
    )
    .min(1, '至少要有 1 页')
    .max(MAX_IMAGES, `一次最多生成 ${MAX_IMAGES} 页插画`),
})

interface UpstreamImage {
  url?: string
  b64_json?: string
}

/** 只接受 https 图片 URL 或 data:image，别让上游的异常值变成前端任意 URL 的 src */
function toImageSrc(item: UpstreamImage): string | null {
  if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
    return `data:image/png;base64,${item.b64_json}`
  }
  if (typeof item.url === 'string' && /^https?:\/\//.test(item.url)) return item.url
  return null
}

interface ZImageResult {
  status: number
  image: string | null
}

/**
 * 按提示词逐张出图（提示词工坊的 n 张候选、绘本的每页插画都走这里）。
 * 结果按输入顺序对位，失败位置留 null——绘本必须知道哪一页缺图。
 *
 * z-image 是百炼原生同步接口，一次固定返回 1 张，尺寸格式是 `1024*1024`
 * （星号），和兼容接口的 `1024x1024` 不同。
 *
 * 工作区对并发有限制（实测 4 发并发会有 1 个 `429 Throttling.RateQuota`），
 * 所以用 2 路并发 + 对 429/5xx 退避重试，4 张约 8–10 秒。
 * 直接 4 发并发会静默少图——每次点击都计费，少图不能让用户白掏钱。
 *
 * 同一提示词不传 seed 时，上游返回的图是**像素级相同**的（实测两张图
 * 像素哈希一致），4 个候选会变成同一张。所以每次调用都带随机 seed。
 */
const Z_IMAGE_CONCURRENCY = 2

interface ZImageFailure {
  status?: number
  error?: string
}

interface IndexedZImageFailure extends ZImageFailure {
  index: number
}

async function generatePerPrompt(
  prompts: string[],
  one: (prompt: string) => Promise<ZImageResult>,
): Promise<{ images: (string | null)[]; failures: IndexedZImageFailure[] }> {
  const images: (string | null)[] = prompts.map(() => null)
  const failures: IndexedZImageFailure[] = []
  let next = 0

  const worker = async () => {
    while (next < prompts.length) {
      const index = next
      next += 1
      let failure: ZImageFailure | null = { error: '没有尝试' }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await one(prompts[index]!)
          if (r.image) {
            images[index] = r.image
            failure = null
            break
          }
          failure = { status: r.status }
          // 400/422 是提示词本身的问题，重试没意义；429/5xx 才退避重试
          if (r.status !== 429 && r.status < 500) break
        } catch (err) {
          failure = { error: String(err).slice(0, 120) }
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
      }
      if (failure) failures.push({ index, ...failure })
    }
  }

  await Promise.all(Array.from({ length: Math.min(Z_IMAGE_CONCURRENCY, prompts.length) }, worker))
  return { images, failures }
}

function generateZImages(prompts: string[]) {
  return generatePerPrompt(prompts, generateZImage)
}

async function generateZImage(prompt: string): Promise<ZImageResult> {
  // 原生接口挂在裸域名下，没有 `/compatible-mode/v1` 后缀
  const origin = new URL(env.AI_IMAGE_BASE_URL).origin
  const res = await fetch(`${origin}/api/v1/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.AI_IMAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.AI_IMAGE_MODEL,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: {
        size: '1024*1024',
        prompt_extend: false,
        seed: randomInt(0, 2_147_483_648),
      },
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) return { status: res.status, image: null }

  const payload = (await res.json().catch(() => null)) as {
    output?: { choices?: { message?: { content?: { image?: string }[] } }[] }
  } | null
  const url = payload?.output?.choices?.[0]?.message?.content?.[0]?.image
  return {
    status: res.status,
    image: typeof url === 'string' && /^https?:\/\//.test(url) ? url : null,
  }
}

/** qwen-image 系列的兼容接口，逐页出图时一次只要 1 张（绘本复用） */
async function generateCompatibleImage(prompt: string): Promise<ZImageResult> {
  const res = await fetch(`${env.AI_IMAGE_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.AI_IMAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.AI_IMAGE_MODEL,
      prompt,
      n: 1,
      size: '1024x1024',
    }),
    signal: AbortSignal.timeout(280_000),
  })
  if (!res.ok) return { status: res.status, image: null }

  const payload = (await res.json().catch(() => null)) as {
    data?: UpstreamImage[]
  } | null
  const image = (payload?.data ?? []).map(toImageSrc).find((x): x is string => x !== null) ?? null
  return { status: res.status, image }
}

export async function aiRoutes(app: FastifyInstance) {
  app.post('/ai/image', async (req) => {
    const me = await requireUser(req)
    // 一次调用出 4 张图，按账号主限、IP 只作机房级兜底（整间教室同一个出口 IP）
    await enforce(
      [
        { key: `ai:gen:user:${me.id}`, limit: 10, windowMs: 60 * 60 * 1000 },
        { key: `ai:gen:ip:${clientIp(req)}`, limit: 80, windowMs: 60 * 60 * 1000 },
      ],
      '生成画面太频繁',
    )

    const body = parseBody(genBody, req.body)

    const started = Date.now()

    // ── z-image：原生接口一张一张出，受并发配额限制 ──────────
    if (IS_Z_IMAGE) {
      const { images: raw, failures } = await generateZImages(
        Array.from({ length: body.n }, () => body.prompt),
      )
      const images = raw.filter((x): x is string => x !== null)

      if (!images.length) {
        req.log.error(
          { userId: me.id, promptLen: body.prompt.length, ms: Date.now() - started, failures },
          'AI 出图失败（z-image 全部失败）',
        )
        const statuses = failures.map((f) => f.status)
        if (statuses.length && statuses.every((s) => s === 400 || s === 422)) {
          throw badRequest('这个提示词暂时生成不出来，换个描述试试')
        }
        throw new ApiError('GEN_FAILED', '画面生成失败，请稍后再试')
      }

      // 部分失败不阻断：前端按实际张数展示，但要留下线索排查配额问题
      if (failures.length) {
        req.log.warn(
          { userId: me.id, promptLen: body.prompt.length, images: images.length, failures },
          'AI 出图部分候选失败',
        )
      }
      req.log.info(
        { userId: me.id, promptLen: body.prompt.length, images: images.length, ms: Date.now() - started },
        'AI 出图完成',
      )
      return { images, model: env.AI_IMAGE_MODEL }
    }

    // ── qwen-image：OpenAI 兼容接口，一次请求出 n 张 ──────────
    let upstream: Response
    try {
      upstream = await fetch(`${env.AI_IMAGE_BASE_URL}/images/generations`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.AI_IMAGE_API_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: env.AI_IMAGE_MODEL,
          prompt: body.prompt,
          n: body.n,
          size: '1024x1024',
        }),
        signal: AbortSignal.timeout(280_000),
      })
    } catch (err) {
      req.log.error({ err, ms: Date.now() - started }, 'AI 出图请求失败（网络/超时）')
      throw new ApiError('GEN_FAILED', '画面生成超时或服务不可用，请稍后再试')
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      req.log.error(
        { status: upstream.status, body: text.slice(0, 500), ms: Date.now() - started },
        'AI 出图上游返回错误',
      )
      // 400/422 是提示词本身的问题，回 400 让用户改描述；其余算上游故障
      if (upstream.status === 400 || upstream.status === 422) {
        throw badRequest('这个提示词暂时生成不出来，换个描述试试')
      }
      throw new ApiError('GEN_FAILED', '画面生成失败，请稍后再试')
    }

    const payload = (await upstream.json().catch(() => null)) as {
      data?: UpstreamImage[]
    } | null
    const images = (payload?.data ?? [])
      .map(toImageSrc)
      .filter((x): x is string => x !== null)

    if (!images.length) {
      req.log.error({ ms: Date.now() - started }, 'AI 出图上游返回空列表')
      throw new ApiError('GEN_FAILED', '画面生成失败，请稍后再试')
    }

    // 只记长度和耗时，不记提示词正文（学生输入的内容不进日志）
    req.log.info(
      { userId: me.id, promptLen: body.prompt.length, images: images.length, ms: Date.now() - started },
      'AI 出图完成',
    )
    return { images, model: env.AI_IMAGE_MODEL }
  })

  /**
   * 两个入口共用一套出图逻辑：
   *   · 老师（登录会话）——创作台里自由生成；
   *   · 学生（作业链接会话）——没有账号，凭班级作业 cookie 进入。
   * 学生按 submission.aiCalls 做终身配额，且作业关闭后立即拒绝。
   */
  app.post('/ai/storybook', async (req) => {
    const user = await optionalUser(req)
    const assignment = user ? null : await optionalAssignment(req)
    if (!user && !assignment) throw unauthorized('请先登录，或从老师发的作业链接进入')
    if (assignment && assignment.assignment.status !== 'open') {
      throw forbidden('这份作业已关闭，暂时不能生成插画')
    }
    if (assignment && assignment.assignment.type !== 'storybook') {
      throw forbidden('这份作业不需要生成插画')
    }

    // 一次最多 4 页，和提示词工坊一样按「每次点击 = 真实计费」设限
    await enforce(
      user
        ? [
            { key: `ai:story:user:${user.id}`, limit: 10, windowMs: 60 * 60 * 1000 },
            { key: `ai:story:ip:${clientIp(req)}`, limit: 80, windowMs: 60 * 60 * 1000 },
          ]
        : [
            // 学生按「这一份作业」限流；终身次数另有 aiCalls 原子计数兜底
            {
              key: `ai:story:assign:${assignment!.submission.id}`,
              limit: ASSIGN_AI_LIMIT,
              windowMs: 60 * 60 * 1000,
            },
            // 整间教室常共用一个出口 IP，阈值按班级规模放宽，只作机房级兜底
            { key: `ai:story:ip:${clientIp(req)}`, limit: 400, windowMs: 60 * 60 * 1000 },
          ],
      '生成绘本太频繁',
    )

    const body = parseBody(storyBody, req.body)

    // 原子占用排在参数校验之后：格式错误不该消耗学生配额
    if (assignment && !(await consumeAssignmentAiCall(assignment.submission.id))) {
      throw new ApiError('RATE_LIMITED', '这份作业的 AI 生成次数已用完，请联系老师')
    }

    // 学生姓名（未成年人信息）不进日志，只记作业和提交编号
    const actor = user
      ? { userId: user.id }
      : { assignmentId: assignment!.assignment.id, submissionId: assignment!.submission.id }

    const started = Date.now()

    // 逐页出图，结果按页序对位；某一页失败只留空，不拖垮整本
    const one = IS_Z_IMAGE ? generateZImage : generateCompatibleImage
    const { images, failures } = await generatePerPrompt(body.prompts, one)
    const okCount = images.filter((x) => x !== null).length

    if (!okCount) {
      // 整次失败不占学生配额，否则一次上游抖动就烧掉一次机会
      if (assignment) await refundAssignmentAiCall(assignment.submission.id)
      req.log.error(
        { ...actor, pages: body.prompts.length, ms: Date.now() - started, failures },
        '绘本插画失败（全部失败）',
      )
      const statuses = failures.map((f) => f.status)
      if (statuses.length && statuses.every((s) => s === 400 || s === 422)) {
        throw badRequest('这组描述暂时画不出来，换个说法试试')
      }
      throw new ApiError('GEN_FAILED', '插画生成失败，请稍后再试')
    }

    if (failures.length) {
      req.log.warn(
        { ...actor, pages: body.prompts.length, images: okCount, failures },
        '绘本插画部分失败',
      )
    }
    req.log.info(
      { ...actor, pages: body.prompts.length, images: okCount, ms: Date.now() - started },
      '绘本插画完成',
    )
    return { images, model: env.AI_IMAGE_MODEL }
  })
}
