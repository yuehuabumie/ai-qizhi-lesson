import { z } from 'zod'
import { badRequest } from './errors.js'

const questionId = z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9_-]+$/, '题目编号不正确')

export const quizDefinitionSchema = z.object({
  questions: z.array(z.object({
    id: questionId,
    type: z.enum(['single', 'boolean']),
    stem: z.string().trim().min(1, '题干不能为空').max(2000),
    options: z.array(z.string().trim().min(1).max(500)).min(2).max(8),
    answer: z.number().int().min(0).max(7),
    points: z.number().int().min(1).max(100),
    explanation: z.string().trim().max(2000).default(''),
  }).superRefine((q, ctx) => {
    if (q.answer >= q.options.length) ctx.addIssue({ code: 'custom', message: '正确答案超出选项范围', path: ['answer'] })
    if (q.type === 'boolean' && (q.options.length !== 2 || q.options[0] !== '正确' || q.options[1] !== '错误')) {
      ctx.addIssue({ code: 'custom', message: '判断题选项必须为“正确”和“错误”', path: ['options'] })
    }
    if (new Set(q.options).size !== q.options.length) ctx.addIssue({ code: 'custom', message: '选项不能重复', path: ['options'] })
  })).min(1, '试卷至少需要一道题').max(100, '试卷最多 100 道题'),
}).superRefine((quiz, ctx) => {
  if (new Set(quiz.questions.map(q => q.id)).size !== quiz.questions.length) {
    ctx.addIssue({ code: 'custom', message: '题目编号不能重复', path: ['questions'] })
  }
})

export type QuizDefinition = z.infer<typeof quizDefinitionSchema>
export const quizAnswersSchema = z.array(z.object({ questionId, answer: z.number().int().min(0).max(7) })).min(1).max(100)
export const quizSubmitSchema = z.object({ kind: z.literal('quiz'), answers: quizAnswersSchema })
export type QuizAnswers = z.infer<typeof quizAnswersSchema>

export function parseQuizDefinition(raw: string | null | undefined): QuizDefinition | null {
  if (!raw) return null
  try {
    const parsed = quizDefinitionSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

export function projectQuiz(quiz: QuizDefinition, revealAnswers = false) {
  return {
    questions: quiz.questions.map(q => ({
      id: q.id, type: q.type, stem: q.stem, options: q.options, points: q.points,
      ...(revealAnswers ? { answer: q.answer, explanation: q.explanation } : {}),
    })),
    totalPoints: quiz.questions.reduce((sum, q) => sum + q.points, 0),
  }
}

export function gradeQuiz(quiz: QuizDefinition, answers: QuizAnswers) {
  const byQuestion = new Map(answers.map(a => [a.questionId, a.answer]))
  if (byQuestion.size !== answers.length) throw badRequest('同一道题不能重复作答')
  if (answers.length !== quiz.questions.length) throw badRequest('请完成试卷中的全部题目')
  let score = 0
  const ordered = quiz.questions.map(q => {
    const answer = byQuestion.get(q.id)
    if (answer === undefined || answer < 0 || answer >= q.options.length) throw badRequest('答案与试卷题目不匹配，请检查后重试')
    if (answer === q.answer) score += q.points
    return { questionId: q.id, answer }
  })
  return { version: 1 as const, kind: 'quiz' as const, answers: ordered, score, totalPoints: quiz.questions.reduce((sum, q) => sum + q.points, 0) }
}

export function parseQuizSubmission(raw: string | null | undefined): { kind: 'quiz'; answers: QuizAnswers } | null {
  if (!raw) return null
  try {
    const parsed = quizSubmitSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

/** Only the explicitly published dimensions enter student responses. */
export function studentQuizResult(
  assignment: { quizJson: string | null; scoresPublished: boolean; answersPublished: boolean },
  submission: { status: string; content: string | null; score: number | null },
) {
  const quiz = parseQuizDefinition(assignment.quizJson)
  const submitted = submission.status === 'submitted'
  return {
    quiz: quiz ? projectQuiz(quiz, submitted && assignment.answersPublished) : null,
    content: submitted ? parseQuizSubmission(submission.content) : null,
    ...(submitted && assignment.scoresPublished ? { score: submission.score } : {}),
    scoresPublished: assignment.scoresPublished,
    answersPublished: assignment.answersPublished,
  }
}
