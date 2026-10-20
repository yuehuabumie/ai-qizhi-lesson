/** Narrow public-page checks; no account, data writes, or mail. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { launch, sleep } from './lib/cdp-kit.mjs'
import { measureLayout, layoutFailures } from './lib/responsive-metrics.mjs'

const base = process.env.E2E_BASE || 'https://yuehua.online'
const output = process.env.AUDIT_OUTPUT || '/tmp/aiq-public-mobile'
mkdirSync(output, { recursive: true })
const reports = []
const page = await launch()
try {
  for (const [width, height] of [[320, 740], [375, 812]]) {
    await page.setViewport(width, height, { mobile: true })
    for (const route of ['/', '/about', '/curriculum', '/curriculum/m1', '/curriculum/m2', '/curriculum/m3', '/curriculum/m4', '/lab', '/teach', '/resources', '/videos', '/gallery', '/login', '/register']) {
      await page.goto(`${base}/#${route}`, '!!document.querySelector("main h1,main h2,main input")')
      await sleep(350)
      for (const theme of ['light', 'dark']) {
        await page.evaluate(`document.documentElement.classList.toggle('dark', ${theme === 'dark'})`)
        await sleep(100)
        const metrics = await page.evaluate(`(${measureLayout.toString()})(${JSON.stringify({ width, height })})`)
        const failures = layoutFailures(metrics)
        reports.push({ route, width, height, theme, metrics, failures })
        console.log(`${failures.length ? 'FAIL' : 'PASS'} ${route} ${width} ${theme} ${failures.join('; ')}`)
        await page.screenshot(`${output}/${route.replaceAll('/', '-') || 'home'}-${width}-${theme}.png`)
      }
    }
  }
} catch (err) {
  reports.push({ failures: [err.message] })
  console.error(err)
} finally {
  await page.close()
  writeFileSync(`${output}/report.json`, JSON.stringify({ base, reports }, null, 2))
  const failed = reports.filter((r) => r.failures.length)
  console.log(`窄屏检查 ${reports.length - failed.length}/${reports.length} 通过`)
  if (failed.length) process.exitCode = 1
}
