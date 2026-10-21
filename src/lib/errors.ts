/**
 * 统一错误体：`{"error":{"code":"...","message":"中文提示"}}`
 *
 * message 是给终端用户看的，一律写中文；code 是给前端做分支判断用的稳定标识。
 * 前端拿到后直接 `ElMessage.error(e.message)` 即可，不需要再做映射。
 */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'CODE_INVALID'
  | 'CODE_EXPIRED'
  | 'PROOF_INVALID'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'EMAIL_EXISTS'
  | 'RATE_LIMITED'
  | 'MAIL_SEND_FAILED'
  | 'GEN_FAILED'
  | 'INTERNAL_ERROR'
  | 'CONFLICT'

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  CODE_INVALID: 400,
  CODE_EXPIRED: 400,
  PROOF_INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EMAIL_EXISTS: 409,
  RATE_LIMITED: 429,
  MAIL_SEND_FAILED: 502,
  GEN_FAILED: 502,
  INTERNAL_ERROR: 500,
  CONFLICT: 409,
}

export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  /** 直接透传给客户端响应体的额外字段，例如 RATE_LIMITED 的 retryAfter */
  readonly extra?: Record<string, unknown>

  constructor(code: ErrorCode, message: string, extra?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS[code]
    this.extra = extra
  }

  toBody() {
    return { error: { code: this.code, message: this.message, ...this.extra } }
  }
}

export const badRequest = (msg: string) => new ApiError('VALIDATION_ERROR', msg)
export const unauthorized = (msg = '请先登录') => new ApiError('UNAUTHORIZED', msg)
export const forbidden = (msg = '没有权限执行该操作') => new ApiError('FORBIDDEN', msg)
export const notFound = (msg = '资源不存在') => new ApiError('NOT_FOUND', msg)
