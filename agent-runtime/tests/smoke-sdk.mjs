// Run inside the actual image, without a model key or network access.
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'
import { writeFile } from 'node:fs/promises'
const patches=[{id:'tool-plugin-manager',disabled:true},{id:'session-query-sqlite',disabled:true},{insert:[{id:'aiq-teaching',name:'/app/lesson-plugin.mjs'}]}]
await writeFile('/tmp/smoke.yml',JSON.stringify(patches))
const options={profile:'sdk',patches:['/tmp/smoke.yml'],dshHome:'/state/dsh',processCwd:'/work',cwd:'/work',model:'deepseek-flash',provider:'deepseek-official',maxTokens:1000,initializeTimeoutMs:60000}
const h=new DeepSeekHarness(options)
try{await h.session('offline-smoke').setWorkingDirectory('/work');console.log('SDK_INITIALIZE_OK')}finally{await h.close()}
const reopened=new DeepSeekHarness(options)
try{await reopened.resumeSession('offline-smoke');console.log('PERSISTED_SESSION_OK')}finally{await reopened.close()}
