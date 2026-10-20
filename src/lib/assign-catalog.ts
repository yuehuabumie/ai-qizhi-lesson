/**
 * 班级作业可选的互动训练目录。
 *
 * 前端训练数据在构建产物里（site/assets/labs-*.js），后端只在发布作品时
 * 需要标题/模块/学段这些元数据，所以这里维护一份最小副本。改动训练清单时
 * 两边要一起更新；对不上时创建作业会被拒绝，不会静默生成错误作品。
 */
export interface LabInfo {
  id: string
  title: string
  module: string
  grade: 'low' | 'mid' | 'high'
  type: string
  hue: number
}

export const ASSIGN_LABS: LabInfo[] = [
  { id: 'device-detection', title: 'AI 设备辨别大挑战', module: 'm1', grade: 'low', type: '互动练习', hue: 210 },
  { id: 'ai-senses', title: 'AI 的五官配对', module: 'm1', grade: 'low', type: '互动练习', hue: 200 },
  { id: 'input-output', title: '输入 → 分析 → 输出', module: 'm1', grade: 'mid', type: '流程图', hue: 265 },
  { id: 'ai-mistakes', title: 'AI 也会犯错', module: 'm1', grade: 'mid', type: '案例分析', hue: 20 },
  { id: 'fruit-trainer', title: '教机器分水果', module: 'm1', grade: 'high', type: 'AI 实验', hue: 120 },
  { id: 'ethics-court', title: 'AI 伦理小法庭', module: 'm1', grade: 'high', type: 'AI 伦理守则', hue: 220 },
  { id: 'prompt-builder', title: '提示词魔法工坊', module: 'm2', grade: 'mid', type: '提示词设计', hue: 265 },
  { id: 'virtual-museum', title: 'MR 虚拟博物馆搭建', module: 'm3', grade: 'mid', type: 'MR 空间方案', hue: 175 },
  { id: 'mr-designer', title: '未来智慧博物馆设计', module: 'm3', grade: 'high', type: 'MR 设计方案', hue: 190 },
  { id: 'inventor', title: 'AI 发明家工作台', module: 'm4', grade: 'mid', type: 'AI 发明作品', hue: 35 },
  { id: 'plant-butler', title: '智能植物管家模拟器', module: 'm4', grade: 'mid', type: '仿真实验', hue: 140 },
  { id: 'quiz-arena', title: 'AI 知识挑战赛', module: 'all', grade: 'mid', type: '闯关答题', hue: 45 },
]

// AI 绘本创作台由 storybook 作业类型单独承载，不再作为 lab 选项
export const ASSIGN_LAB_IDS = ASSIGN_LABS.map((lab) => lab.id)

export function labById(id: string | null | undefined): LabInfo | null {
  if (!id) return null
  return ASSIGN_LABS.find((lab) => lab.id === id) || null
}

export const ASSIGN_MODULE_IDS = ['m1', 'm2', 'm3', 'm4'] as const
export const ASSIGN_STAGES = ['low', 'mid', 'high'] as const
