import { readFile,writeFile,rename,rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Never expose the account-wide provider file catalogue to an execution job. */
export class ProviderFiles {
  constructor(root,request){
    this.root=root;this.records=new Map()
    // Files API requires this beta for every operation, including host cleanup
    // which has no incoming SDK request headers to forward.
    this.request=(method,path,bytes,headers={})=>request(method,path,bytes,{...headers,'anthropic-beta':[...new Set([...String(headers['anthropic-beta']||'').split(',').map(value=>value.trim()).filter(Boolean),'files-api-2025-04-14'])].join(',')})
  }
  async state(job){
    if(!this.records.has(job.sessionId))this.records.set(job.sessionId,(async()=>{
      let value;try{value=JSON.parse(await readFile(this.path(job.sessionId),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
      if(value&&value.ownerId!==job.ownerId)throw new Error('模型附件归属不一致')
      return value||{ownerId:job.ownerId,files:{}}
    })())
    const state=await this.records.get(job.sessionId)
    if(state.ownerId!==job.ownerId)throw new Error('模型附件归属不一致')
    return state
  }
  path(id){if(!/^[A-Za-z0-9_-]{1,40}$/.test(id))throw new Error('会话编号不正确');return join(this.root,id+'.provider.json')}
  async save(job,state){
    state.writing=(state.writing||Promise.resolve()).catch(()=>{}).then(async()=>{
      const path=this.path(job.sessionId),tmp=path+'.tmp'
      await writeFile(tmp,JSON.stringify({ownerId:state.ownerId,files:state.files}),{mode:0o600});await rename(tmp,path)
    });await state.writing
  }
  async validateReferences(job,value){
    const state=await this.state(job)
    function visit(v){
      if(!v||typeof v!=='object')return
      if(typeof v.file_id==='string'&&!state.files[v.file_id])throw new Error('不能引用其他对话的模型附件')
      for(const child of Object.values(v))visit(child)
    }
    visit(value)
  }
  async handle(job,method,path,bytes,headers){
    const state=await this.state(job),url=new URL(path,'https://local'),parts=url.pathname.split('/').filter(Boolean)
    if(parts[0]!=='v1'||parts[1]!=='files'||parts.length>3)throw new Error('模型附件接口不存在')
    if(!parts[2]&&method==='GET'){
      const all=Object.values(state.files),after=url.searchParams.get('after_id'),start=after?all.findIndex(f=>f.id===after)+1:0,limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||100)),data=all.slice(start,start+limit)
      return {status:200,body:{data,first_id:data[0]?.id||null,last_id:data.at(-1)?.id||null,has_more:all.length>start+data.length}}
    }
    if(parts[2]){
      const id=parts[2]
      if(!/^file-[A-Za-z0-9_-]{1,180}$/.test(id)||!Object.hasOwn(state.files,id))return {status:404,body:{error:{type:'not_found_error',message:'模型附件不存在'}}}
      if(!['GET','DELETE'].includes(method))throw new Error('模型附件方法不支持')
      const response=await this.request(method,url.pathname,bytes,headers)
      if(method==='DELETE'&&(response.status===200||response.status===404)){delete state.files[id];await this.save(job,state)}
      return response
    }
    if(method!=='POST')throw new Error('模型附件方法不支持')
    if(Object.keys(state.files).length>=100)throw new Error('当前对话模型图片数量达到上限')
    const response=await this.request(method,'/v1/files',bytes,headers)
    if(response.status===200||response.status===201){
      const file=response.body
      if(!file||typeof file.id!=='string'||!/^file-[A-Za-z0-9_-]{1,180}$/.test(file.id))throw new Error('模型附件返回格式不正确')
      state.files[file.id]=file;await this.save(job,state)
    }
    return response
  }
  async removeSession(job){
    const state=await this.state(job)
    for(const id of Object.keys(state.files)){
      const response=await this.request('DELETE','/v1/files/'+id)
      if(response.status!==200&&response.status!==404)throw new Error('模型附件清理暂未完成，请稍后重试')
      delete state.files[id];await this.save(job,state)
    }
    await state.writing;await rm(this.path(job.sessionId),{force:true});this.records.delete(job.sessionId)
  }
}
