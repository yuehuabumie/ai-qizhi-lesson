/** Shared mobile fixes for the existing Vue build. Keep rules scoped to controls;
 * training canvases and drag/drop geometry retain their own sizing. */
;(() => {
  if (document.getElementById('aiq-responsive-shell')) return
  const style = document.createElement('style')
  style.id = 'aiq-responsive-shell'
  style.textContent = `
html{scroll-padding-top:90px}
/* Preflight is disabled in this build; remove the browser's 8px canvas gutter. */
body{margin:0}
main{min-width:0}
main h1{text-wrap:balance}
main .grid>*{min-width:0}
@media(max-width:1023px), (pointer:coarse){
  .aiq-navbar button{min-height:44px}
  .aiq-navbar .el-button.is-circle{width:44px;height:44px;min-width:44px;flex-shrink:0}
  .el-button{min-height:44px;min-width:44px}
  .el-checkbox,.el-radio,.el-switch{min-height:44px;min-width:44px}
  .el-radio-button__inner{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}
  .el-slider__button{position:relative}
  .el-slider__button::before{content:'';position:absolute;inset:-12px}
  body .el-input .el-input__wrapper,body .el-select .el-select__wrapper{min-height:44px;box-sizing:border-box}
  .el-input__inner,.el-textarea__inner,.el-select__placeholder,.el-select__input{font-size:16px}
  main input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]),
  main textarea,main select,.me-modal input,.gal-modal input,.gal-modal textarea{font-size:16px}
  .el-tabs__item{min-height:44px}
  body .me-btn,body .me-tab,body .me-icon-btn,body .me-swatch,body .gal-btn,body .gal-like,body .gal-icon-btn,body .gal-pick-all{min-height:44px;min-width:44px}
  body .me-input,body .me-select,body .gal-input,body .gal-select{min-height:44px;font-size:16px}
  body .me-modal,body .gal-modal{box-sizing:border-box;max-height:calc(100dvh - 32px);overscroll-behavior:contain}
  .el-drawer__body{overscroll-behavior:contain;padding-bottom:calc(20px + env(safe-area-inset-bottom,0px))}
  .el-drawer__body a{min-height:44px;box-sizing:border-box}
  .el-dialog{max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;margin-top:12px!important;margin-bottom:12px!important}
  [data-aiq-page="teach"] main button.group,
  [data-aiq-page="videos"] main button,
  [data-aiq-page="curriculum"] main button,
  [data-aiq-lab="prompt-builder"] main button[class~="py-0.5"],
  [data-aiq-lab="virtual-museum"] main button[class~="py-1.5"]{min-height:44px;min-width:44px}
  [data-aiq-page="lab"] main :is(button,a)[class~="hover:underline"]{min-height:44px;display:inline-flex;align-items:center}
  [data-aiq-lab="virtual-museum"] main .overflow-hidden:has(>div>.grid>button.aspect-square){overflow-x:auto;overscroll-behavior-x:contain}
  [data-aiq-lab="virtual-museum"] main div:has(>.grid>button.aspect-square){min-width:528px;box-sizing:border-box}
  [data-aiq-lab="virtual-museum"] main .grid:has(>button.aspect-square){grid-template-columns:repeat(10,minmax(44px,1fr))!important}
  [data-aiq-lab="virtual-museum"] main button.aspect-square{min-width:44px;min-height:44px}
  [data-aiq-lab="fruit-trainer"] main .flex:has(>.el-radio-group){flex-wrap:wrap;gap:8px}
  .aiq-map-hint{font-size:13px;line-height:1.6;margin:0 0 10px;color:var(--aiq-muted)}
}
@media(max-width:1023px){
  [data-aiq-page="course"] main .grid{grid-template-columns:minmax(0,1fr)}
}
@media(max-width:639px){
  [data-aiq-page="course"] main .mb-5.flex:has(>.no-print){flex-wrap:wrap}
  [data-aiq-page="course"] main .mb-5.flex>a,[data-aiq-page="course"] main .mb-5.flex>span{flex-shrink:0}
  [data-aiq-page="course"] main .mb-5.flex>.no-print{flex:1 0 calc(50% - 4px);margin:4px 0 0}
  [data-aiq-page="course"] main .text-white.p-7{padding:20px}
  [data-aiq-page="course"] main .text-white .relative.flex>.text-right{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;text-align:left}
  [data-aiq-page="course"] main .mt-8.flex{flex-direction:column;align-items:stretch}
  [data-aiq-page="course"] main .mt-8.flex>.el-button{width:100%;margin-left:0;white-space:normal;height:auto}
  [data-aiq-page="resources"] main .grid.mb-6{grid-template-columns:repeat(2,minmax(0,1fr))}
  [data-aiq-page="resources"] main .flex.mb-5{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  [data-aiq-page="resources"] main .flex.mb-5>.el-input{grid-column:1/-1;width:100%!important}
  [data-aiq-page="resources"] main .flex.mb-5>.el-select{width:100%!important;min-width:0}
}
@media(prefers-reduced-motion:reduce){
  html{scroll-behavior:auto!important}
  .el-drawer,.el-overlay,.el-dialog{transition-duration:.01ms!important;animation-duration:.01ms!important}
}
`
  document.head.appendChild(style)

  function updateRoute() {
    const path = location.hash.slice(1).split('?')[0]
    document.documentElement.dataset.aiqPage = path.startsWith('/curriculum/') ? 'course' : (path.split('/')[1] || 'home')
    document.documentElement.dataset.aiqLab = path.startsWith('/lab/') ? path.split('/')[2] : ''
  }
  updateRoute()
  window.addEventListener('hashchange', updateRoute)

  // The shipped header's menu icon has no accessible name. Its Vue markup is
  // unavailable here, so keep the label in sync when login/theme state changes.
  function updateHeader() {
    const header = document.querySelector('header.aiq-navbar')
    if (!header) return false
    for (const button of header.querySelectorAll('button')) {
      if (button.classList.contains('lg:hidden')) {
        button.setAttribute('aria-label', '打开导航菜单')
        button.setAttribute('aria-haspopup', 'dialog')
        const drawer = header.querySelector('.el-drawer')
        button.setAttribute('aria-expanded', String(!!drawer && drawer.getBoundingClientRect().width > 0 && getComputedStyle(drawer).visibility !== 'hidden'))
      } else if (button.title) button.setAttribute('aria-label', button.title)
    }
    return header
  }
  function install() {
    const header = updateHeader()
    if (!header) { setTimeout(install, 100); return }
    let frame = 0
    new MutationObserver(() => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; updateHeader() })
    }).observe(header, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'title'] })
  }
  install()

  // Keep the museum's precise placement grid usable without shrinking its cells.
  // Scrolling belongs to this panel; the page itself retains the device width.
  function updateMap() {
    if (document.documentElement.dataset.aiqLab !== 'virtual-museum') return
    const grid = document.querySelector('main .grid:has(>button.aspect-square)')
    const panel = grid?.parentElement?.parentElement
    if (!panel) return
    ;[...grid.children].forEach((cell, index) => {
      cell.setAttribute('aria-label', `第 ${Math.floor(index / 10) + 1} 排第 ${index % 10 + 1} 列，${cell.textContent.trim() || (cell.querySelector('svg') ? '已摆放素材' : '空位')}`)
    })
    if (panel.dataset.aiqMapReady) return
    panel.dataset.aiqMapReady = 'true'
    panel.tabIndex = 0
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-label', '教室平面图')
    panel.setAttribute('aria-describedby', 'aiq-map-hint')
    const hint = document.createElement('p')
    hint.id = 'aiq-map-hint'
    hint.className = 'aiq-map-hint lg:hidden'
    hint.textContent = '左右滑动平面图，点格子摆放展品。'
    panel.before(hint)
  }
  let mapFrame = 0
  new MutationObserver(() => {
    if (mapFrame) return
    mapFrame = requestAnimationFrame(() => { mapFrame = 0; updateMap() })
  }).observe(document.getElementById('app') || document.body, { childList: true, subtree: true })
  updateMap()
})()
