import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import { publicAddress,resolvePublic,createPublicProxy,providerEventTap } from '../network.mjs'
import { containerArgs } from '../broker.mjs'

test('private, special, metadata and IPv6 translation addresses cannot pass egress policy',()=>{
  for(const ip of ['0.0.0.0','10.0.0.1','127.1.2.3','169.254.169.254','172.16.0.1','172.31.255.255','192.168.1.1','100.64.0.1','198.18.1.1','224.0.0.1','::1','::ffff:127.0.0.1','64:ff9b::7f00:1','2002:7f00:1::'])assert.equal(publicAddress(ip),false,ip)
  for(const ip of ['1.1.1.1','8.8.8.8','43.131.233.40'])assert.equal(publicAddress(ip),true,ip)
})
test('DNS and numeric host variants resolving to loopback are rejected',async()=>{
  for(const host of ['localhost','127.0.0.1','::1'])await assert.rejects(resolvePublic(host))
})
test('HTTP and CONNECT proxy enforce destination and caller policy before connecting',async()=>{
  const server=createPublicProxy();await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const port=server.address().port
  try{
    const status=await new Promise((ok,no)=>http.get({host:'127.0.0.1',port,path:'http://169.254.169.254/latest/meta-data'},r=>{r.resume();ok(r.statusCode)}).on('error',no));assert.equal(status,403)
    const response=await new Promise((ok,no)=>{const socket=net.connect(port,'127.0.0.1',()=>socket.write('CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n'));socket.once('data',b=>{ok(b.toString());socket.destroy()});socket.on('error',no)})
    assert.match(response,/403 Forbidden/)
  }finally{await new Promise(ok=>server.close(ok))}
})
test('real provider reasoning and response deltas survive partial SSE and CRLF framing',()=>{
  const events=[],tap=providerEventTap((type,data)=>events.push({type,...data}))
  const frames=[{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'核对名单。'}},{type:'content_block_delta',delta:{type:'text_delta',text:'请确认。'}}].map(v=>'data: '+JSON.stringify(v)+'\r\n\r\n').join('')
  for(let i=0;i<frames.length;i+=3)tap.push(frames.slice(i,i+3));tap.flush()
  assert.equal(events.filter(e=>e.type==='reasoning').map(e=>e.text).join(''),'核对名单。')
  assert.equal(events.filter(e=>e.type==='text').map(e=>e.text).join(''),'请确认。')
})
test('container launch has no host credentials, writable bind, privilege or Docker socket',()=>{
  const args=containerArgs({container:'aiqprep-abc',id:'abc',token:'temporary-job-token'},'/var/lib/aiq-prep/inputs/abc')
  assert.ok(args.includes('--read-only'));assert.ok(args.includes('no-new-privileges'));assert.ok(args.includes('ALL'));assert.ok(args.includes('1000:1000'))
  assert.ok(args.includes('type=bind,src=/var/lib/aiq-prep/inputs/abc,dst=/inputs,readonly'))
  assert.doesNotMatch(args.join(' '),/docker.sock|DEEPSEEK_API_KEY|PREP_WORKER_SECRET|--privileged|--network host/)
})
