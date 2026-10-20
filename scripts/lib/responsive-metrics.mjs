// Runs in the page. Use the requested CSS viewport: mobile auto-shrink can make
// innerWidth grow to fit overflowing content and hide a layout regression.
export function measureLayout({ width, height }) {
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return Object.fromEntries(['x', 'y', 'width', 'height', 'right', 'bottom'].map((k) => [k, Math.round(r[k] * 10) / 10]))
  }
  const visible = (el) => {
    const s = getComputedStyle(el)
    return s.display !== 'none' && s.visibility !== 'hidden' && el.getClientRects().length > 0
  }
  const clipped = (el) => {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a), r = a.getBoundingClientRect()
      if (s.overflowX !== 'visible' && r.right <= width + 1 && r.left >= -1) return true
    }
    return false
  }
  const elements = [...document.querySelectorAll('body *')].filter(visible)
  const controls = elements.filter((el) => el.matches('button,a[href],input:not([type="hidden"]),select,textarea'))
    .map((el) => {
      // Element Plus uses small/transparent native inputs inside a full-size
      // clickable label or wrapper. Measure that real pointer target.
      const target = el.matches('input') ? el.closest('.el-checkbox,.el-radio,.el-radio-button,.el-switch,.el-input__wrapper,.el-select__wrapper') || el : el
      return { tag: el.tagName, text: (el.getAttribute('aria-label') || target.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40),
        cls: String(target.className).slice(0, 80), disabled: !!el.disabled, inline: el.matches('a') && getComputedStyle(el).display === 'inline', ...rect(target) }
    })
  const offenders = elements.filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && (r.right > width + 1 || r.left < -1) && !clipped(el)
  }).slice(0, 12).map((el) => ({ tag: el.tagName, cls: String(el.className).slice(0, 80), ...rect(el) }))
  const bar = document.querySelector('[data-sbk-supervisor]')
  const modal = [...document.querySelectorAll('.cls-modal,.sbk-modal,.me-modal,.gal-modal,.el-dialog')].find(visible)
  return {
    width, height, innerWidth, innerHeight, docWidth: document.documentElement.scrollWidth,
    scale: visualViewport?.scale ?? 1, theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
    offenders, small24: controls.filter((c) => !c.disabled && !c.inline && (c.width < 24 || c.height < 24)),
    small44: controls.filter((c) => !c.disabled && !c.inline && (c.width < 44 || c.height < 44)),
    supervisor: bar && visible(bar) ? { ...rect(bar), paddingBottom: parseFloat(getComputedStyle(document.body).paddingBottom),
      buttons: controls.filter((c) => c.cls.includes('sbk-supervisor-')) } : null,
    modal: modal ? rect(modal) : null,
    inputFonts: elements.filter((el) => el.matches('input:not([type]),input[type=text],input[type=email],input[type=password],input[type=search],input[type=number],textarea,select'))
      .map((el) => ({ cls: String(el.className), size: parseFloat(getComputedStyle(el).fontSize) })),
  }
}

export function layoutFailures(m) {
  const failures = []
  if (m.docWidth > m.width + 1) failures.push(`页面横向溢出 ${m.docWidth}/${m.width}`)
  if (m.innerWidth > m.width + 1 || m.scale < 0.99) failures.push(`页面自动缩小 innerWidth=${m.innerWidth}, scale=${m.scale}`)
  if (m.offenders.length) failures.push(`可见元素越界 ${m.offenders.length} 个`)
  if (m.modal && (m.modal.y < -1 || m.modal.bottom > m.height + 1)) failures.push('弹窗超出视口')
  if (m.width < 1024 && m.inputFonts?.some((f) => f.size < 16)) failures.push('手机表单字号不足 16px')
  if (m.supervisor) {
    const b = m.supervisor
    if (b.x < -1 || b.right > m.width + 1 || b.bottom > m.height + 1) failures.push('学生操作条超出视口')
    if (b.paddingBottom < b.height + m.height - b.bottom) failures.push('学生操作条底部留白不足')
    if (b.buttons.some((c) => c.height < 44 || c.width < 44)) failures.push('学生操作条按钮不足 44px')
  }
  return failures
}
