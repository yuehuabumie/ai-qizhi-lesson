import { createPrepStudio } from './prep/studio.js'

if (!window.__AIQ_PREP_STUDIO__) {
  window.__AIQ_PREP_STUDIO__ = true
  const studio = createPrepStudio()
  studio.boot().catch((error) => console.warn('[prep-studio] 页面初始化失败', error))
}
