import { z } from 'zod'
import { badRequest } from './errors.js'

export function normalizeRosterName(value: string): string {
  return value.replace(/[　\r\n\t]/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim()
}
const optionalText = (max: number) => z.string().trim().max(max).regex(/^[^\u0000-\u001f\u007f]*$/, '字段不能包含控制字符').nullable().optional().transform(v => v === undefined ? undefined : v || null)
const fields = z.object({
  name: z.string().max(120).transform(normalizeRosterName).refine(v => v.length >= 1 && v.length <= 30, '姓名需要 1–30 个字'),
  studentNo: optionalText(40),
  gender: optionalText(20),
  score: z.number().finite().min(0).max(1_000_000).nullable().optional(),
})
export const memberInputSchema = fields.transform(v => ({ name: v.name, studentNo: v.studentNo ?? null, gender: v.gender ?? null, score: v.score ?? null }))
export const memberPatchSchema = fields.partial().refine(v => Object.keys(v).length > 0, '没有可更新的成员信息')
export type RosterMember = { id: string; name: string; studentNo: string | null; gender: string | null; score: number | null }
export const rosterOperationSchema = z.object({
  action: z.enum(['add', 'update', 'delete']),
  id: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/).optional(),
  ...fields.partial().shape,
}).superRefine((op, ctx) => {
  if (op.action !== 'add' && !op.id) ctx.addIssue({ code: 'custom', message: '缺少成员编号', path: ['id'] })
  if (op.action === 'add' && !op.name) ctx.addIssue({ code: 'custom', message: '缺少学生姓名', path: ['name'] })
})
export type RosterOperation = z.infer<typeof rosterOperationSchema>

/** MySQL's usual name collation folds accents. Match the application's identity
 * normalization after querying so René/Rene do not become an unusable duplicate.
 */
export function rosterNameKey(name: string): string {
  return normalizeRosterName(name).normalize('NFKC').toLocaleLowerCase()
}

/** Validate the complete prospective roster, including collisions with existing members. */
export function assertRoster(members: Pick<RosterMember, 'name' | 'studentNo'>[], maxMembers = 100): void {
  if (members.length > maxMembers) throw badRequest(`一个班级最多 ${maxMembers} 人`)
  const numbers = new Set<string>()
  const names = new Map<string, (string | null)[]>()
  for (const m of members) {
    if (m.studentNo) {
      const key = m.studentNo.normalize('NFKC').toLocaleLowerCase()
      if (numbers.has(key)) throw badRequest(`学号“${m.studentNo}”重复，请先确认名单`)
      numbers.add(key)
    }
    const key = rosterNameKey(m.name)
    const values = names.get(key) ?? []
    values.push(m.studentNo)
    names.set(key, values)
  }
  for (const ids of names.values()) {
    if (ids.length > 1 && ids.some(id => !id)) throw badRequest('存在同名学生，请为同名学生分别填写不同学号')
  }
}

export function planRosterOperations(current: RosterMember[], operations: RosterOperation[]) {
  const next = new Map(current.map(m => [m.id, { ...m }]))
  const touched = new Set<string>()
  const removed: string[] = []
  for (const [index, op] of operations.entries()) {
    if (op.action === 'add') {
      next.set(`new:${index}`, { id: `new:${index}`, ...memberInputSchema.parse(op) })
      continue
    }
    if (!op.id || !next.has(op.id)) throw badRequest('成员不存在或不属于当前班级')
    if (touched.has(op.id)) throw badRequest('同一批操作不能重复修改同一名学生')
    touched.add(op.id)
    if (op.action === 'delete') { next.delete(op.id); removed.push(op.id); continue }
    const previous = next.get(op.id)!
    next.set(op.id, {
      ...previous,
      ...(op.name !== undefined ? { name: op.name } : {}),
      ...(op.studentNo !== undefined ? { studentNo: op.studentNo } : {}),
      ...(op.gender !== undefined ? { gender: op.gender } : {}),
      ...(op.score !== undefined ? { score: op.score } : {}),
    })
  }
  const members = [...next.values()]
  assertRoster(members)
  return { members, removed }
}

export function assertGroupPartition(memberIds: string[], groups: { name: string; memberIds: string[] }[]): void {
  if (new Set(groups.map(g => g.name.normalize('NFKC').toLocaleLowerCase())).size !== groups.length) throw badRequest('小组名称不能重复')
  const expected = new Set(memberIds)
  const grouped = new Set<string>()
  for (const group of groups) for (const id of group.memberIds) {
    if (!expected.has(id)) throw badRequest('分组中包含不属于当前班级的成员')
    if (grouped.has(id)) throw badRequest('同一名学生不能分到多个小组')
    grouped.add(id)
  }
  if (grouped.size !== expected.size) throw badRequest('请将班级全部学生分组，每人恰好出现一次')
}
