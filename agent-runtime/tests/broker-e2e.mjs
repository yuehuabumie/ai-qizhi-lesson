/**
 * Real Linux/Docker isolation probe; deliberately no model, API key or database.
 * Run as root on the worker after stopping aiq-prep.service yourself:
 *   node agent-runtime/tests/broker-e2e.mjs
 * Requires the existing aiq-prep internal bridge, firewall and aiq-prep:1 image.
 * Leaves the live service stopped. Only this test's resources are cleaned up.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, statfs, lstat, realpath, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const gateway = '172.30.223.1'
const workerURL = 'http://127.0.0.1:3330'
const coreURL = 'http://127.0.0.1:3335'
const nonce = randomBytes(6).toString('hex')
const secret = randomBytes(32).toString('hex') // Never persisted or printed by this test.
const image = `aiq-prep:probe-${nonce}`
const sessionId = `probe_${nonce}_session`
const ownerId = `probe_${nonce}_owner`
const ids = ['first', 'second', 'cancel'].map(suffix => `probe_${nonce}_${suffix}`)
const containers = ids.map(id => `aiqprep-${id}`)
const fixture = Buffer.from('静态 Docker 文件权限与字节校验探针\n001,李明,0\n', 'utf8')
const inputRequests = new Map()
const artifacts = []
const probeFailures = []
let directory, broker, fakeCore, builtImage = false, brokerLog = '', passes = 0
const redact = value => String(value).replaceAll(secret, '[credential]')

function command(program, args, { timeout = 12000, input, allowFailure = false, maxOutput = 1024 * 1024 } = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let out = '', err = '', total = 0, settled = false
    const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolveResult(result) }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error(`${program} exceeded its ${timeout}ms timeout`)) }, timeout)
    child.on('error', error => finish(error))
    for (const [stream, name] of [[child.stdout, 'out'], [child.stderr, 'err']]) stream.on('data', bytes => {
      total += bytes.length
      if (total > maxOutput) { child.kill('SIGKILL'); finish(new Error(`${program} output limit exceeded`)); return }
      if (name === 'out') out += bytes; else err += bytes
    })
    child.on('close', code => {
      const result = { code, out, err }
      finish(code === 0 || allowFailure ? null : new Error(`${program} failed (${code}): ${redact(err || out).slice(-1500)}`), result)
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
const docker = (args, options) => command('docker', args, options)
async function inspectContainer(name) {
  const result = await docker(['inspect', '--type', 'container', name], { allowFailure: true, timeout: 5000 })
  return result.code === 0 ? JSON.parse(result.out)[0] : null
}
async function exists(path) { try { await stat(path); return true } catch (error) { if (error.code === 'ENOENT') return false; throw error } }
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`); passes++ }
  catch (error) { error.message = `${name}: ${error.message}`; throw error }
}
async function until(run, { timeout = 30000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { const result = await run(); if (result) return result; await delay(150) }
  throw new Error(`Timed out waiting for ${label}`)
}
async function host(path, { method = 'GET', body } = {}) {
  const response = await fetch(workerURL + path, {
    method, headers: { authorization: `Bearer ${secret}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000),
  })
  const value = await response.json()
  assert.ok(response.ok, `host API ${method} ${path} failed (${response.status}): ${redact(JSON.stringify(value))}`)
  return { status: response.status, value }
}
const requestFor = id => ({ id, sessionId, ownerId, content: 'STATIC ISOLATION TEST; DO NOT CALL A MODEL', timeoutMinutes: 2 })
async function startJob(id) { const response = await host('/jobs', { method: 'POST', body: requestFor(id) }); assert.equal(response.status, 202) }
async function events(id) { return (await host(`/jobs/${id}/events`)).value }
async function inContainer(container, code, timeout = 12000) {
  return JSON.parse((await docker(['exec', container, 'node', '-e', code], { timeout })).out)
}
async function ready(id, count) {
  const container = `aiqprep-${id}`
  return until(async () => {
    const state = await events(id)
    if (['failed', 'cancelled'].includes(state.status)) throw new Error(`Probe job stopped: ${redact(state.error || state.status)}`)
    if (!(await inspectContainer(container))) return false
    const result = await docker(['exec', container, 'cat', '/work/probe-ready.json'], { timeout: 4000, allowFailure: true })
    if (result.code !== 0) return false
    try { const data = JSON.parse(result.out); return data.counter === count ? data : false } catch { return false }
  }, { label: `static runner ${count}` })
}
async function completed(id) {
  const state = await until(async () => {
    const state = await events(id)
    if (state.status === 'failed') throw new Error(`Probe job failed: ${redact(state.error)}`)
    return state.status === 'completed' ? state : false
  }, { timeout: 35000, label: 'archive completion' })
  assert.equal(state.modelCalls, 0)
  await until(async () => !(await inspectContainer(`aiqprep-${id}`)), { label: 'completed container removal' })
  return state
}
async function freePort(address, port) {
  const server = net.createServer()
  await new Promise((ok, no) => { server.once('error', no); server.listen(port, address, ok) })
  await new Promise(ok => server.close(ok))
}

// This runner is a static file probe. It cannot call a provider and emits no AI claims.
const runner = `
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
const input=JSON.parse(await readFile('/state/input.json','utf8'));
assert.equal(input.files.length,1);
const f=input.files[0], bytes=await readFile('/inputs/'+f.id+'-'+f.name);
let previous=0;try{previous=Number(await readFile('/work/counter','utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
assert.ok(Number.isInteger(previous)&&previous>=0);
const counter=previous+1;
await mkdir('/work/output',{recursive:true});
await writeFile('/work/counter',String(counter));
await writeFile('/work/output/probe.txt',bytes);
for(const [name,target] of [['inside-link','/work/output/probe.txt'],['outside-link','/etc/passwd']]){
  try{await symlink(target,'/work/output/'+name)}catch(e){if(e.code!=='EEXIST')throw e}
}
await mkdir('/work/output/not-a-file',{recursive:true});
await writeFile('/work/probe-ready.json',JSON.stringify({uid:process.getuid(),counter,input:bytes.toString('utf8')}));
console.log(JSON.stringify({type:'status',data:{status:'running',message:'Static isolation probe; no model is called'}}));
await setTimeout(20000);
console.log(JSON.stringify({type:'done',data:{response:'STATIC_PROBE_OK count='+counter}}));
`

async function startFakeCore() {
  fakeCore = http.createServer(async (req, res) => {
    const reply = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    try {
      if (req.headers.authorization !== `Bearer ${secret}`) return reply(403, { error: 'unauthorized test core' })
      const url = new URL(req.url, coreURL), match = /^\/runs\/([^/]+)(.*)$/.exec(url.pathname)
      if (!match || !ids.includes(match[1])) return reply(404, {})
      const [, id, suffix] = match
      if (req.method === 'GET' && suffix === '/input') {
        inputRequests.set(id, (inputRequests.get(id) || 0) + 1)
        return reply(200, { files: [{ id: 'probeinput', name: 'probe-input.txt', size: fixture.length }], skills: [], history: [] })
      }
      if (req.method === 'GET' && suffix === '/attachments/probeinput') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(fixture); return
      }
      if (req.method === 'POST' && suffix === '/artifacts') {
        const chunks = []; let total = 0
        for await (const chunk of req) { total += chunk.length; if (total > 1024 * 1024) throw new Error('unexpected artifact size'); chunks.push(chunk) }
        artifacts.push({ id, filename: url.searchParams.get('filename'), bytes: Buffer.concat(chunks) })
        return reply(200, { attachment: { id: `artifact${artifacts.length}`, name: url.searchParams.get('filename') } })
      }
      return reply(404, { error: 'unexpected fake core endpoint' })
    } catch { if (!res.headersSent) reply(500, { error: 'fake core probe failed' }); else res.destroy() }
  })
  await new Promise((ok, no) => { fakeCore.once('error', no); fakeCore.listen(3335, '127.0.0.1', ok) })
}

async function main() {
  assert.equal(process.platform, 'linux', 'This integration test requires the actual Linux Docker worker')
  assert.equal(process.getuid?.(), 0, 'Run as root so the test can validate UMask=0077 and clean its own resources')
  // Never stop or restart a live service from a test.
  const service = await command('systemctl', ['is-active', 'aiq-prep.service'], { allowFailure: true, timeout: 5000 })
  assert.equal(service.out.trim(), 'inactive', 'Stop aiq-prep.service explicitly before running; this test will not stop it')
  await docker(['image', 'inspect', 'aiq-prep:1'])
  const bridge = JSON.parse((await docker(['network', 'inspect', 'aiq-prep'])).out)[0]
  assert.equal(bridge.Internal, true)
  assert.equal(bridge.Driver, 'bridge')
  assert.ok(bridge.IPAM.Config.some(item => item.Subnet === '172.30.223.0/24' && item.Gateway === gateway))
  assert.equal(bridge.Options['com.docker.network.bridge.name'], 'aiqprep0')
  for (const name of containers) assert.equal(await inspectContainer(name), null, 'Refusing a pre-existing container name')
  await freePort('127.0.0.1', 3330); await freePort(gateway, 3330); await freePort(gateway, 3333)
  const previousUmask = process.umask(0o077)
  try {
    directory = await mkdtemp('/var/lib/aiq-prep-test-')
    const disk = await statfs(directory)
    assert.ok(disk.bavail * disk.bsize >= 8 * 1024 ** 3, 'Broker requires at least 8GiB available disk space')
    const context = join(directory, 'image')
    await mkdir(context)
    await writeFile(join(context, 'runner.mjs'), runner)
    await writeFile(join(context, 'Dockerfile'), `FROM aiq-prep:1\nLABEL aiq.prep.probe="${nonce}"\nCOPY --chmod=0444 runner.mjs /app/runner.mjs\n`)
    await docker(['build', '--network=none', '--tag', image, context], { timeout: 120000, maxOutput: 2 * 1024 * 1024 })
    builtImage = true
    await startFakeCore()
    const env = { ...process.env, PREP_WORKER_SECRET: secret, PREP_CORE_URL: coreURL, PREP_DATA_DIR: directory,
      PREP_IMAGE: image, PREP_NETWORK: 'aiq-prep', PREP_BRIDGE_IP: gateway, PREP_CONCURRENCY: '1',
      DEEPSEEK_API_KEY: '', NODE_USE_ENV_PROXY: '0', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }
    delete env.PREP_ADMIN_PATCH
    broker = spawn(process.execPath, [fileURLToPath(new URL('../broker.mjs', import.meta.url))], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    const capture = bytes => { brokerLog = (brokerLog + redact(bytes)).slice(-10000) }
    broker.stdout.on('data', capture); broker.stderr.on('data', capture)
    await until(async () => {
      if (broker.exitCode !== null || broker.signalCode !== null) throw new Error(`Test broker exited early: ${brokerLog}`)
      try { return (await host('/health')).value.ready === false } catch { return false }
    }, { label: 'broker without a model key' })

    await startJob(ids[0])
    const first = await ready(ids[0], 1)
    const container = containers[0]
    // Run the external probes in parallel, within the static runner's 20s window.
    const probeResults = await Promise.allSettled([
      check('uid 1000 reads real input bytes under UMask 0077; input and app remain read-only', async () => {
        assert.equal(first.uid, 1000); assert.equal(first.input, fixture.toString('utf8'))
        const state = await inContainer(container, `(async()=>{const fs=require('node:fs/promises');const ro=async p=>{try{await fs.writeFile(p,'forbidden',{flag:'wx'});return false}catch(e){return ['EROFS','EACCES','EPERM'].includes(e.code)}};console.log(JSON.stringify({uid:process.getuid(),inputs:await ro('/inputs/forbidden'),app:await ro('/app/forbidden'),socket:require('node:fs').existsSync('/var/run/docker.sock')||require('node:fs').existsSync('/run/docker.sock'),hostCredential:!!process.env.PREP_WORKER_SECRET||!!process.env.DEEPSEEK_API_KEY}))})().catch(()=>process.exit(1))`)
        assert.deepEqual(state, { uid: 1000, inputs: true, app: true, socket: false, hostCredential: false })
        const inputDir = join(directory, 'inputs', ids[0])
        assert.equal((await stat(inputDir)).mode & 0o777, 0o755)
        assert.equal((await stat(join(inputDir, 'probeinput-probe-input.txt'))).mode & 0o777, 0o444)
        const inspection = await inspectContainer(container)
        assert.equal(inspection.Config.User, '1000:1000'); assert.equal(inspection.HostConfig.ReadonlyRootfs, true)
        assert.equal(inspection.HostConfig.Privileged, false); assert.ok(inspection.HostConfig.CapDrop.includes('ALL'))
        assert.ok(inspection.HostConfig.SecurityOpt.some(value => value.startsWith('no-new-privileges')))
        assert.equal(inspection.HostConfig.NetworkMode, 'aiq-prep')
        assert.ok(inspection.Mounts.filter(m => m.Type === 'bind').every(m => m.Destination === '/inputs' && m.RW === false))
      }),
      check('public HTTPS succeeds through the proxy without an API key', async () => {
        const result = await docker(['exec', container, 'curl', '--silent', '--show-error', '--max-time', '8', '--connect-timeout', '5', '--proxy', `http://${gateway}:3333`, '--noproxy', '', '--output', '/dev/null', '--write-out', '%{http_code}', 'https://api.deepseek.com/'], { timeout: 10000 })
        assert.match(result.out.trim(), /^[2-5]\d\d$/, 'Expected a real public HTTPS response; no model API was called')
      }),
      check('proxy rejects private and metadata destinations for HTTP and CONNECT', async () => {
        const result = await inContainer(container, `(async()=>{const http=require('node:http');const get=target=>new Promise((ok,no)=>{const r=http.get({host:'${gateway}',port:3333,path:target,timeout:3000},res=>{res.resume();ok(res.statusCode)});r.on('error',no);r.on('timeout',()=>r.destroy(new Error('timeout')))});const connect=()=>new Promise((ok,no)=>{const r=http.request({host:'${gateway}',port:3333,method:'CONNECT',path:'169.254.169.254:443',timeout:3000});r.on('connect',(res,socket)=>{socket.destroy();ok(res.statusCode)});r.on('error',no);r.on('timeout',()=>r.destroy(new Error('timeout')));r.end()});console.log(JSON.stringify(await Promise.all([get('http://${gateway}/'),get('http://169.254.169.254/latest/meta-data/'),get('http://127.0.0.1/'),connect()])))})().catch(()=>process.exit(1))`)
        assert.deepEqual(result, [403, 403, 403, 403])
      }),
      check('direct public egress and direct host SSH are blocked', async () => {
        const result = await inContainer(container, `(async()=>{const net=require('node:net');const connect=(host,port)=>new Promise(ok=>{const s=net.connect({host,port});let done=false;const finish=value=>{if(done)return;done=true;s.destroy();ok(value)};s.setTimeout(3000,()=>finish(false));s.on('error',()=>finish(false));s.on('connect',()=>finish(true))});console.log(JSON.stringify(await Promise.all([connect('1.1.1.1',443),connect('${gateway}',22)])))})().catch(()=>process.exit(1))`, 5000)
        assert.deepEqual(result, [false, false])
      }),
      check('job credentials cannot poll, cancel, create jobs or delete host sessions', async () => {
        const result = await inContainer(container, `(async()=>{const base=process.env.PREP_BROKER_URL,id=process.env.PREP_RUN_ID,headers={authorization:'Bearer '+process.env.PREP_JOB_TOKEN,'content-type':'application/json'};const cases=[['GET','/jobs/'+id+'/events'],['POST','/jobs/'+id+'/cancel'],['POST','/jobs'],['DELETE','/sessions/${sessionId}']];const statuses=[];for(const [method,path]of cases){const r=await fetch(base+path,{method,headers,body:method==='GET'?undefined:'{}',signal:AbortSignal.timeout(3000)});await r.arrayBuffer();statuses.push(r.status)}console.log(JSON.stringify(statuses))})().catch(()=>process.exit(1))`)
        assert.ok(result.every(status => status === 403 || status === 404))
        assert.equal((await events(ids[0])).status, 'running')
      }),
      check('only ordinary output files export; core receives the exact fixture bytes', async () => {
        const result = await inContainer(container, `(async()=>{const statuses=[];for(const path of ['/work/output/probe.txt','/etc/passwd','/work/output/outside-link','/work/output/inside-link','/work/output/not-a-file']){const r=await fetch(process.env.PREP_BROKER_URL+'/jobs/'+process.env.PREP_RUN_ID+'/export',{method:'POST',headers:{authorization:'Bearer '+process.env.PREP_JOB_TOKEN,'content-type':'application/json'},body:JSON.stringify({path}),signal:AbortSignal.timeout(4000)});await r.arrayBuffer();statuses.push(r.status)}console.log(JSON.stringify(statuses))})().catch(()=>process.exit(1))`)
        assert.equal(result[0], 200)
        assert.ok(result.slice(1).every(status => status >= 400), 'Outside paths, symlinks (including inside-output links), and directories must all be refused')
        assert.equal(artifacts.length, 1); assert.equal(artifacts[0].id, ids[0]); assert.equal(artifacts[0].filename, 'probe.txt')
        assert.deepEqual(artifacts[0].bytes, fixture)
      }),
    ])
    // A failed boundary assertion must not prevent archive/cancel cleanup checks.
    for (const result of probeResults) if (result.status === 'rejected') { probeFailures.push(result.reason); console.error(`FAIL ${redact(result.reason.message)}`) }
    await check('completion archives the conversation and removes the first container', async () => {
      const state = await completed(ids[0]); assert.equal(state.response, 'STATIC_PROBE_OK count=1')
      assert.ok(await exists(join(directory, 'sessions', sessionId + '.tgz')))
      const metadata = JSON.parse(await readFile(join(directory, 'sessions', sessionId + '.json'), 'utf8'))
      assert.equal(metadata.ownerId, ownerId)
      const journal = await readFile(join(directory, 'jobs', ids[0] + '.json'), 'utf8')
      assert.ok(!journal.includes(secret)); assert.ok(!Object.hasOwn(JSON.parse(journal), 'token'))
      assert.equal(await exists(join(directory, 'inputs', ids[0])), false)
    })
    await check('a second job restores its conversation counter from the actual archive', async () => {
      await startJob(ids[1]); const second = await ready(ids[1], 2)
      assert.equal(second.uid, 1000); assert.equal(second.counter, 2); assert.equal(second.input, fixture.toString('utf8'))
      assert.equal((await completed(ids[1])).response, 'STATIC_PROBE_OK count=2')
    })
    await check('host cancellation removes the running container and duplicate job IDs never rerun', async () => {
      await startJob(ids[2]); await ready(ids[2], 3)
      await host(`/jobs/${ids[2]}/cancel`, { method: 'POST', body: {} })
      assert.equal((await events(ids[2])).status, 'cancelled')
      assert.equal(await inspectContainer(containers[2]), null)
      const calls = inputRequests.get(ids[2])
      const replay = await host('/jobs', { method: 'POST', body: requestFor(ids[2]) })
      assert.equal(replay.status, 200); assert.equal(replay.value.status, 'cancelled')
      await host(`/jobs/${ids[2]}/cancel`, { method: 'POST', body: {} })
      await delay(300)
      assert.equal(inputRequests.get(ids[2]), calls); assert.equal(await inspectContainer(containers[2]), null)
    })
    await check('session deletion removes its archive, metadata and all job journals', async () => {
      await host(`/sessions/${sessionId}`, { method: 'DELETE', body: { ownerId } })
      for (const suffix of ['.json', '.tgz']) assert.equal(await exists(join(directory, 'sessions', sessionId + suffix)), false)
      for (const id of ids) assert.equal(await exists(join(directory, 'jobs', id + '.json')), false)
      assert.deepEqual(await readdir(join(directory, 'jobs')), [])
    })
    if (probeFailures.length) throw new Error(`${probeFailures.length} isolation probe(s) failed: ${probeFailures.map(error => redact(error.message)).join('; ')}`)
    console.log(`Broker Docker isolation: ${passes}/${passes} passed. No model or production database was used.`)
  } finally { process.umask(previousUmask) }
}

async function cleanup() {
  const failures = []
  if (broker && broker.exitCode === null && broker.signalCode === null) {
    broker.kill('SIGTERM')
    const exited = await Promise.race([new Promise(ok => broker.once('exit', () => ok(true))), delay(25000, false, { ref: false })])
    if (!exited) { broker.kill('SIGKILL'); await Promise.race([new Promise(ok => broker.once('exit', ok)), delay(2000, undefined, { ref: false })]) }
  }
  if (fakeCore?.listening) { fakeCore.closeAllConnections(); await new Promise(ok => fakeCore.close(ok)) }
  for (const name of (broker || builtImage ? containers : [])) {
    try {
      const inspection = await inspectContainer(name)
      if (!inspection) continue
      assert.equal(inspection.Config.Image, image, 'Refusing to remove a container that does not use this probe image')
      assert.equal(inspection.Config.Labels?.['aiq.prep'], '1')
      await docker(['rm', '-f', name], { timeout: 15000 })
    } catch (error) { failures.push(redact(error.message)) }
  }
  if (builtImage) {
    try {
      const inspection = JSON.parse((await docker(['image', 'inspect', image])).out)[0]
      assert.equal(inspection.Config.Labels?.['aiq.prep.probe'], nonce)
      await docker(['image', 'rm', image], { timeout: 15000 })
    } catch (error) { failures.push(redact(error.message)) }
  }
  if (directory) {
    try {
      // Validate the final absolute target before any recursive removal.
      assert.equal(resolve(directory), directory)
      assert.equal(dirname(directory), '/var/lib')
      assert.match(basename(directory), /^aiq-prep-test-[A-Za-z0-9]+$/)
      assert.equal(await realpath(directory), directory)
      const info = await lstat(directory); assert.ok(info.isDirectory() && !info.isSymbolicLink())
      await rm(directory, { recursive: true, force: true })
    } catch (error) { failures.push(redact(error.message)) }
  }
  if (failures.length) throw new Error(`Probe cleanup needs attention: ${failures.join('; ')}`)
}

let failure
try { await main() } catch (error) { failure = error; console.error(`FAIL ${redact(error.message)}`); if (brokerLog) console.error(`Test broker log: ${redact(brokerLog)}`) }
try { await cleanup() } catch (error) { failure ||= error; console.error(redact(error.message)) }
if (failure) process.exitCode = 1
