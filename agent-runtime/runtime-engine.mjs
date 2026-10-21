export async function loadRuntime(engine = process.env.PREP_AGENT_ENGINE || 'dsh') {
  if (engine === 'aiq') {
    const { AiqAgent, validatedSessionEvent } = await import('./aiq-agent/index.mjs')
    return { Agent: AiqAgent, validatedSessionEvent }
  }
  if (engine === 'dsh') {
    const { DeepSeekHarness, validatedSessionEvent } = await import('@deepseek-ai/dsh-sdk-client')
    return { Agent: DeepSeekHarness, validatedSessionEvent }
  }
  throw new Error('Unsupported preparation agent engine: ' + engine)
}
