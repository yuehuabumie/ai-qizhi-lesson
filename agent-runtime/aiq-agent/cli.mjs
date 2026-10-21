import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'

const patches = []
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 2) {
  if (args[index] === '--profile' && args[index + 1] === 'sdk') continue
  if (args[index] === '--patch' && args[index + 1]) {
    patches.push(resolve(args[index + 1]))
    continue
  }
  throw new Error('AIQ Agent only supports its SDK runtime and explicit patch files')
}

const home = resolve(process.env.DSH_HOME || '.aiq-agent')
const configuration = resolve(home, 'aiq-profile/root.yml')
await mkdir(resolve(home, 'aiq-profile'), { recursive: true, mode: 0o700 })
await writeFile(configuration, '[]\n', { mode: 0o600 })

let context
let stopping = false
let ready = false
const readyListeners = new Set()
async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  const timeout = setTimeout(() => process.exit(code || 1), 10000)
  timeout.unref()
  try { await context?.fiber.dispose() }
  finally { clearTimeout(timeout); process.exit(code) }
}
process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown(130))
process.once('uncaughtException', error => { console.error(error); void shutdown(1) })
process.once('unhandledRejection', error => { console.error(error); void shutdown(1) })

const overlayFiles = [fileURLToPath(new URL('./profile.yml', import.meta.url)), ...patches]
const overlays = overlayFiles.flatMap(path => loadOverlayPatches('aiq-agent', path))
context = await boot('aiq-agent', configuration, overlays, host => {
  context = host
  provideCmdline(host, {
    args: [],
    exit: code => void shutdown(code),
    ready: {
      onReady(listener) {
        if (ready) listener()
        else readyListeners.add(listener)
        return () => readyListeners.delete(listener)
      },
    },
  })
}, pathToFileURL(fileURLToPath(new URL('./', import.meta.url))).href)
if (!stopping) {
  ready = true
  for (const listener of readyListeners) listener()
  readyListeners.clear()
}
