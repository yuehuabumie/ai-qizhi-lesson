import { randomBytes } from 'node:crypto'
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { resolve, basename } from 'node:path'
import { env } from '../env.js'
import { prisma } from './db.js'
import { badRequest } from './errors.js'

const mimeTypes: Record<string,string> = {
  pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt:'text/plain',md:'text/markdown',csv:'text/csv',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',heic:'image/heic',heif:'image/heif',svg:'image/svg+xml',html:'text/html',json:'application/json',
}
export function safeFilename(input:string) {
  const name = basename(input.replace(/\\/g,'/')).replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,180)
  if (!name || name==='.' || name==='..') throw badRequest('文件名不正确')
  return name
}
export function fileMime(name:string,kind:'upload'|'artifact') {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (!mimeTypes[ext] || (kind==='upload' && ['svg','html','json'].includes(ext))) throw badRequest('暂不支持此文件格式；请使用图片、PDF、Word、Excel、PPT 或文本')
  return mimeTypes[ext]
}
function filePath(key:string) {
  if(!/^[a-f0-9]{48}$/.test(key)) throw new Error('Invalid private storage key')
  return resolve(env.PREP_STORAGE_DIR,'files',key)
}
export async function storeAttachment(ownerId:string,sessionId:string,nameInput:string,bytes:Buffer,kind:'upload'|'artifact') {
  const name = safeFilename(nameInput), mime=fileMime(name,kind)
  if(!bytes.length || bytes.length>env.PREP_MAX_FILE_MB*1024*1024) throw badRequest(`文件需要大于0字节且不超过${env.PREP_MAX_FILE_MB}MB`)
  const storageKey=randomBytes(24).toString('hex')
  await mkdir(resolve(env.PREP_STORAGE_DIR,'files'),{recursive:true,mode:0o700})
  await writeFile(filePath(storageKey),bytes,{flag:'wx',mode:0o600})
  try { return await prisma.$transaction(async tx=>{
    // Hold a shared quota-row lock until commit, including across API processes.
    await tx.$executeRaw`INSERT IGNORE INTO prep_storage_lock (id) VALUES (1)`
    await tx.$queryRaw`SELECT id FROM prep_storage_lock WHERE id=1 FOR UPDATE`
    const sessions=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM prep_sessions WHERE id=${sessionId} AND ownerId=${ownerId} FOR UPDATE`
    if(!sessions.length)throw badRequest('对话已删除，请重新打开备课页面')
      const [user,total]=await Promise.all([tx.prepAttachment.aggregate({where:{ownerId},_sum:{size:true}}),tx.prepAttachment.aggregate({_sum:{size:true}})])
      if((user._sum.size||0)+bytes.length>env.PREP_USER_STORAGE_MB*1024*1024)throw badRequest('个人备课文件空间已满，请删除不需要的对话')
      if((total._sum.size||0)+bytes.length>env.PREP_GLOBAL_STORAGE_MB*1024*1024)throw badRequest('备课文件总空间已满，请联系管理员')
      return await tx.prepAttachment.create({data:{ownerId,sessionId,name,mime,size:bytes.length,kind,storageKey}})
  },{timeout:30000,maxWait:20000}) }
  catch(error) {await unlink(filePath(storageKey)).catch(()=>{});throw error}
}
export const readAttachment = (key:string) => readFile(filePath(key))
export const removeAttachment = (key:string) => unlink(filePath(key)).catch(()=>{})
export const attachmentDto = (a:{id:string,name:string,mime:string,size:number,kind:string,createdAt:Date}) => ({id:a.id,name:a.name,mime:a.mime,size:a.size,kind:a.kind,createdAt:a.createdAt})
