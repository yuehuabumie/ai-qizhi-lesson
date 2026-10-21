import { fileURLToPath } from 'node:url'
import { DeepSeekHarness, validatedSessionEvent } from '@deepseek-ai/dsh-sdk-client'

export class AiqAgent extends DeepSeekHarness {
  constructor(options = {}) {
    super({ ...options, dshBin: fileURLToPath(new URL('./cli.mjs', import.meta.url)), profile: 'sdk' })
  }
}

export { validatedSessionEvent }
