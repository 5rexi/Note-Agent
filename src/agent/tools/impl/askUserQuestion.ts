/**
 * AskUserQuestionTool — 主动追问用户
 *
 * 当 Agent 需要更多信息时，使用此工具向用户提问。
 * 工具返回问题文本，模型会在回复中呈现给用户。
 * 用户在下一轮消息中回答。
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../Tool'
import type { ToolResult } from '../../types'

const inputSchema = z.object({
  question: z.string().describe('The question to ask the user. Be specific and concise.'),
  options: z.array(z.string()).optional().describe('Optional predefined answer options'),
  context: z.string().optional().describe('Optional context explaining why this question is needed'),
  followUpQuestions: z.array(z.object({
    question: z.string().describe('A follow-up question to ask after the user answers the main question'),
    options: z.array(z.string()).optional().describe('Optional predefined answer options for this follow-up'),
  })).optional().describe('Optional follow-up questions. Use this when you need to ask multiple related questions in sequence. The user will answer them one by one.'),
})

type Input = z.infer<typeof inputSchema>

export const AskUserQuestionTool: Tool<Input, { questions: Array<{ question: string; options?: string[] }> }> = {
  name: 'askUserQuestion',
  description: 'Ask the user clarifying question(s) when you need more information. Questions will be presented to the user one by one, and they will respond after all are answered. Use this when: requirements are unclear, multiple valid approaches exist, you need confirmation on a specific detail, or the user request is ambiguous. If you have multiple related questions, use followUpQuestions to chain them.',
  inputSchema,
  aliases: ['ask'],

  isReadOnly() { return true },
  isConcurrencySafe() { return true },
  isDestructive() { return false },

  checkPermissions() {
    return { result: 'allow' }
  },

  validateInput(raw) {
    return inputSchema.parse(raw)
  },

  async call(input: Input, _ctx: ToolContext): Promise<ToolResult<{ questions: Array<{ question: string; options?: string[] }> }>> {
    const questions: Array<{ question: string; options?: string[] }> = [
      { question: input.question, options: input.options },
    ]
    if (input.followUpQuestions && input.followUpQuestions.length > 0) {
      for (const fq of input.followUpQuestions) {
        questions.push({ question: fq.question, options: fq.options })
      }
    }
    return { data: { questions } }
  },

  renderToolUse(input) {
    return `Ask user: "${input.question}"${input.followUpQuestions?.length ? ` (+${input.followUpQuestions.length} follow-ups)` : ''}`
  },

  renderToolResult(result) {
    // result is ToolResult<{ questions: [...] }>
    const data = (result as any)?.data
    if (data && typeof data === 'object' && Array.isArray(data.questions)) {
      const qs = data.questions as Array<{ question: string; options?: string[] }>
      let text = '## Questions for User\n\n'
      qs.forEach((q, i) => {
        text += `${i + 1}. ${q.question}\n`
        if (q.options && q.options.length > 0) {
          text += `   Options: ${q.options.join(', ')}\n`
        }
      })
      text += '\n*Waiting for user response — do NOT generate follow-up text or additional tool calls until the user replies.*'
      return text
    }
    return String(result)
  }
}
