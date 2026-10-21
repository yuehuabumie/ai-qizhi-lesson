import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { claimModelCall } from '../broker.mjs'

test('the default budget permits 100 model calls and records the actual limit error once',()=>{
  const job={id:'budget-fixture',status:'running',events:[],modelCalls:0}
  try{
    for(let i=0;i<100;i++)claimModelCall(job)
    assert.equal(job.modelCalls,100);assert.equal(job.events.length,0)
    assert.throws(()=>claimModelCall(job),/100次/)
    assert.match(job.error,/PREP_MAX_MODEL_CALLS/)
    assert.equal(job.events.length,1);assert.equal(job.events[0].type,'error');assert.equal(job.events[0].data.message,job.error)
    assert.throws(()=>claimModelCall(job),/100次/);assert.equal(job.events.length,1)
    const earlier={...job,error:'the original specific failure',events:[]}
    assert.throws(()=>claimModelCall(earlier));assert.equal(earlier.error,'the original specific failure');assert.equal(earlier.events.length,0)
  }finally{clearTimeout(job.flushTimer)}
})

test('administrator budget configuration accepts only integers from 1 through 500',()=>{
  const broker=new URL('../broker.mjs',import.meta.url).href
  for(const [value,valid] of [['1',true],['125',true],['500',true],['0',false],['501',false],['2.5',false],['NaN',false]]){
    const result=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(broker)})`],{encoding:'utf8',env:{...process.env,PREP_MCP_CONFIG:'',PREP_MAX_MODEL_CALLS:value}})
    assert.equal(result.status===0,valid,`PREP_MAX_MODEL_CALLS=${value}`)
    if(!valid)assert.match(result.stderr,/PREP_MAX_MODEL_CALLS/)
  }
})
