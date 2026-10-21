import test from 'node:test'
import assert from 'node:assert/strict'
import {apply} from '../lesson-plugin.mjs'

test('teaching proposals scope identical call IDs to their originating agents',async()=>{
  const tools=new Map(),requests=[],original=globalThis.fetch
  apply({systemPrompt:{section(){}},tools:{register(tool){tools.set(tool.name,tool)}}})
  globalThis.fetch=async(_url,options)=>{requests.push(JSON.parse(options.body));return {ok:true,json:async()=>({classrooms:[]})}}
  try{
    const tool=tools.get('list_classrooms')
    for(const agentId of ['parent-session','child-session'])await tool.execute({request:{}},{callId:'call-1',agent:{id:agentId},signal:new AbortController().signal})
    assert.deepEqual(requests.map(v=>v.callId),['parent-session:call-1','child-session:call-1'])
  }finally{globalThis.fetch=original}
})
