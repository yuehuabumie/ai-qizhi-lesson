import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProviderFiles } from '../provider-files.mjs'

test('provider images are scoped to one conversation, survive broker reload, and delete only owned IDs',async()=>{
  const root=await mkdtemp(join(tmpdir(),'prep-provider-')),calls=[];let serial=0
  const request=async(method,path)=>{calls.push({method,path});return {status:200,body:method==='POST'?{id:'file-api-'+(++serial),type:'file',created_at:1}:method==='DELETE'?{id:path.split('/').pop(),type:'file_deleted'}:{id:path.split('/').pop(),type:'file'}}}
  const a={sessionId:'session-a',ownerId:'teacher-a'},b={sessionId:'session-b',ownerId:'teacher-b'}
  try{
    let store=new ProviderFiles(root,request)
    await store.handle(a,'POST','/v1/files',Buffer.from('a'),{});await store.handle(b,'POST','/v1/files',Buffer.from('b'),{})
    const listing=await store.handle(a,'GET','/v1/files?limit=50');assert.deepEqual(listing.body.data.map(f=>f.id),['file-api-1']);assert.equal(calls.filter(c=>c.method==='GET').length,0)
    assert.equal((await store.handle(b,'GET','/v1/files/file-api-1')).status,404)
    await assert.rejects(store.validateReferences(b,[{source:{type:'file',file_id:'file-api-1'}}]))
    await store.validateReferences(a,[{source:{type:'file',file_id:'file-api-1'}}])
    await assert.rejects(store.state({...a,ownerId:'teacher-b'}))
    store=new ProviderFiles(root,request)
    await store.validateReferences(a,[{file_id:'file-api-1'}])
    await store.removeSession(a)
    assert.deepEqual(calls.filter(c=>c.method==='DELETE').map(c=>c.path),['/v1/files/file-api-1'])
    assert.deepEqual((await store.handle(b,'GET','/v1/files')).body.data.map(f=>f.id),['file-api-2'])
  }finally{await rm(root,{recursive:true,force:true})}
})

test('host cleanup uses the Files beta and preserves owned files when the provider cannot delete yet',async()=>{
  const root=await mkdtemp(join(tmpdir(),'prep-provider-cleanup-')),calls=[]
  const job={sessionId:'cleanup-session',ownerId:'cleanup-teacher'}
  let unavailable=true
  const request=async(method,path,_bytes,headers)=>{
    calls.push({method,path,headers})
    assert.ok(headers['anthropic-beta'].split(',').includes('files-api-2025-04-14'),'all Files operations, even headerless host cleanup, require the Files beta')
    if(method==='POST')return {status:201,body:{id:'file-cleanup-image',type:'file',created_at:1}}
    return {status:unavailable?503:404,body:{error:{message:unavailable?'temporary outage':'already absent'}}}
  }
  try{
    const store=new ProviderFiles(root,request)
    await store.handle(job,'POST','/v1/files',Buffer.from('image'),{'anthropic-beta':'mid-conversation-tool-changes-2026-07-01'})
    assert.ok(calls[0].headers['anthropic-beta'].includes('mid-conversation-tool-changes-2026-07-01'),'the Files beta supplements existing allowed beta headers')
    await assert.rejects(store.removeSession(job),/清理暂未完成/)
    const restored=new ProviderFiles(root,request)
    await restored.validateReferences(job,[{file_id:'file-cleanup-image'}])
    unavailable=false
    await restored.removeSession(job)
    assert.deepEqual(calls.filter(call=>call.method==='DELETE').map(call=>call.path),['/v1/files/file-cleanup-image','/v1/files/file-cleanup-image'])
    assert.equal((await restored.handle(job,'GET','/v1/files')).body.data.length,0)
  }finally{await rm(root,{recursive:true,force:true})}
})
