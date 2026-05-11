/**
 * 会话级 Agent 引擎
 * 管理消息历史、驱动 RoundExecutor、处理权限确认
 */
import type { Message, AgentEvent, LLMConfig, PermissionMode } from '../types'
import type { Tool } from '../tools/Tool'
import type { PermissionContext } from '../tools/permissions'
import { checkToolPermission } from '../tools/permissions'
import { loadPermissionRules } from '../tools/permissions/rules'
import { executeRound } from './RoundExecutor'
import { buildSystemPrompt } from '../prompt/builder'
import { buildMinimalPrompt } from '../prompt/minimal'
import type { PromptContext } from '../prompt/types'
import type { LLMClient } from '../llm/client'
import { SessionCostTracker } from '../cost'
import { logger } from '../logger'
import type { ModelRouter, RoutingResult } from '../router/ModelRouter'
import type { CompactConfig } from '../compact'
import { loadTasks, formatTasks, saveTasks } from '../tools/impl/todoWrite'
import { prepareSession, getCompletedStepIds } from './planner-integration'
import { loadSkills, getSkillPrompt } from '../skills/loader'

export interface AgentEngineOptions {
  llmConfig: LLMConfig
  workspacePath: string
  mode: PermissionMode
  openFiles?: string[]
  tools: Tool[]
  maxRounds?: number
  /** 可选：注入自定义 LLMClient（用于测试） */
  llmClient?: LLMClient
  /** 后台Agent标志：避免权限提示，自动拒绝所有ask请求 */
  shouldAvoidPermissionPrompts?: boolean
  /** 模型路由器（启用自动模型选择） */
  modelRouter?: ModelRouter
  /** 启用自动上下文压缩（默认 true） */
  autoCompact?: boolean
  /** 压缩配置 */
  compactConfig?: Partial<CompactConfig>
  /** Selected data sources for this session */
  dataSources?: {
    kbFolderIds?: number[]
    apis?: string[]
    mcpServers?: string[]
  }
}

export class AgentEngine {
  private messages: Message[] = []
  private opts: AgentEngineOptions
  private running = false
  private sessionId: string | null = null
  private provider: string
  private model: string
  private costTracker = new SessionCostTracker()
  private abortController: AbortController | null = null

  constructor(opts: AgentEngineOptions) {
    this.opts = opts
    this.provider = opts.llmConfig.provider
    this.model = opts.llmConfig.model
    this.costTracker.setProvider(opts.llmConfig.providerName || opts.llmConfig.provider)
    this.costTracker.setModel(opts.llmConfig.model)
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getCostTracker(): SessionCostTracker {
    return this.costTracker
  }

  setMessages(messages: Message[]) {
    this.messages = [...messages]
  }

  isRunning(): boolean {
    return this.running
  }

  abort(): void {
    this.abortController?.abort()
  }

  setMode(mode: PermissionMode): void {
    this.opts.mode = mode
  }

  getMode(): PermissionMode {
    return this.opts.mode
  }

  getWorkspacePath(): string {
    return this.opts.workspacePath
  }

  getSessionId(): string | null {
    return this.sessionId
  }

  setSessionId(id: string | null): void {
    this.sessionId = id
  }

  getProvider(): string { return this.provider }
  getModel(): string { return this.model }

  /**
   * 提交用户输入，Agent 自主循环直到完成。
   * 通过 async generator 向外广播事件。
   *
   * ASK 模式下遇到需要确认的 tool，会 yield permission-request 事件。
   * 调用方通过调用 event.resolve(true/false) 来允许/拒绝。
   * 如果拒绝，工具不会执行，但对话会继续（模型会看到拒绝结果）。
   */
  async *submit(userInput: string | { text: string; imageParts?: Array<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> }): AsyncGenerator<AgentEvent, void, unknown> {
    if (this.running) {
      yield { type: 'error', message: 'Agent is already running' }
      return
    }

    this.running = true

    // Parse input
    let text = typeof userInput === 'string' ? userInput : userInput.text
    const imageParts = typeof userInput === 'string' ? undefined : userInput.imageParts

    // ── /skill command interception ──
    let slashSkillPrompt: string | undefined
    const skillMatch = text.match(/^\/skill\s+(\S+)(?:\s+(.*))?$/s)
    if (skillMatch) {
      const skillId = skillMatch[1]
      const remainingText = skillMatch[2] || ''
      const skills = loadSkills(this.opts.workspacePath)
      const skill = skills.find((s) => s.id === skillId)
      if (skill) {
        slashSkillPrompt = getSkillPrompt(skill)
        text = remainingText.trim() || `[使用 ${skill.name} 技能]`
      }
      // If skill not found, leave text as-is (fallback to normal message)
    }

    // Add user message
    let userMsg: Message
    if (imageParts && imageParts.length > 0) {
      const parts: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = [...imageParts]
      if (text.trim()) parts.push({ type: 'text', text })
      userMsg = { role: 'user', content: parts }
    } else {
      userMsg = { role: 'user', content: text }
    }
    this.messages.push(userMsg)

    const toolContext = {
      workspacePath: this.opts.workspacePath,
      mode: this.opts.mode,
      openFiles: this.opts.openFiles,
      sessionId: this.sessionId ?? undefined,
      dataSources: this.opts.dataSources,
    }

    const rules = loadPermissionRules()
    const permissionContext: PermissionContext = {
      mode: this.opts.mode,
      alwaysAllowRules: rules.allow,
      alwaysDenyRules: rules.deny,
      alwaysAskRules: rules.ask,
      approvedToolCallIds: new Set(),
      rejectedToolCallIds: new Set(),
    }

    const fileTreeSummary = summarizeFileTree(this.opts.workspacePath, 30)
    const { taskPlan, persistedPlan, minimalPromptCtx } = await prepareSession({
      text,
      llmConfig: this.opts.llmConfig,
      sessionId: this.sessionId,
      workspacePath: this.opts.workspacePath,
      openFiles: this.opts.openFiles,
      mode: this.opts.mode,
      toolContext,
      fileTreeSummary,
    })
    let baseSystemPrompt = buildMinimalPrompt(minimalPromptCtx)
    if (slashSkillPrompt) {
      baseSystemPrompt += `\n\n## Active Skill\n${slashSkillPrompt}`
    }
    console.log('[AgentEngine] System prompt length:', baseSystemPrompt.length, 'chars')

    // Boost maxRounds for research-phase tasks
    let effectiveMaxRounds = this.opts.maxRounds
    if (taskPlan?.phases?.some(p => p.mode === 'research')) {
      const current = effectiveMaxRounds ?? 50
      effectiveMaxRounds = Math.max(current, 80)
      console.log('[AgentEngine] Research phase detected — boosting maxRounds to', effectiveMaxRounds)
    }

    try {
      // Build llmConfig resolver: fixed or dynamic via router
      let lastRoutingResult: RoutingResult | undefined
      const llmConfigResolver = this.opts.modelRouter
        ? (round: number) => {
            const routing = this.opts.modelRouter!.select({
              userInput: text,
              messages: this.messages,
              toolNames: this.opts.tools.map((t) => t.name),
              round,
            })
            if (!lastRoutingResult || lastRoutingResult.config.model !== routing.config.model) {
              lastRoutingResult = routing
              logger.info('Model switched', { model: routing.config.model, reason: routing.reason })
            }
            return routing.config
          }
        : this.opts.llmConfig

      // Dynamic system prompt builder: rebuilds minimal prompt every round
      const buildSystemPromptWithReminder = (_round: number, _messages: Message[]): string => {
        const currentTodos = loadTasks(this.sessionId ?? undefined)
        const completedIds = persistedPlan ? getCompletedStepIds(currentTodos) : []
        return buildMinimalPrompt({
          ...minimalPromptCtx,
          completedStepIds: completedIds,
          todoStatus: currentTodos.length > 0 ? formatTasks(currentTodos) : undefined,
        })
      }

      this.abortController = new AbortController()
      const roundGenerator = executeRound(this.messages, {
        llmConfig: llmConfigResolver,
        tools: this.opts.tools,
        toolContext,
        permissionContext,
        systemPrompt: buildSystemPromptWithReminder,
        maxRounds: effectiveMaxRounds,
        llmClient: this.opts.llmClient,
        signal: this.abortController.signal,
        autoCompact: this.opts.autoCompact,
        compactConfig: this.opts.compactConfig,
      })



      for await (const event of roundGenerator) {
        // Collect usage data
        if (event.type === 'usage') {
          this.costTracker.addUsage(event.inputTokens, event.outputTokens)
          logger.info('Round usage', { inputTokens: event.inputTokens, outputTokens: event.outputTokens })
          continue
        }

        // Yield the event FIRST so UI can update (e.g. tool-use-start adds the tool to the list).
        // This ensures permission-request can find the tool in toolCalls and update its status.
        yield event

        // Then intercept tool-use-start to check if confirmation is needed.
        if (event.type === 'tool-use-start') {
          const tool = this.opts.tools.find((t) => t.name === event.name || t.aliases?.includes(event.name))
          if (tool) {
            // Use full checkToolPermission (includes mode-level checks, rules, etc.)
            // rather than just tool.checkPermissions.
            const perm = checkToolPermission(tool, event.input, permissionContext)
            if (perm.result === 'ask') {
              if (this.opts.shouldAvoidPermissionPrompts) {
                // Background agents auto-reject permission prompts
                permissionContext.rejectedToolCallIds!.add(event.toolCallId)
              } else {
                // Pause and ask user for confirmation
                let resolveFn: (allow: boolean) => void
                const promise = new Promise<boolean>((r) => { resolveFn = r })

                yield {
                  type: 'permission-request',
                  toolCallId: event.toolCallId,
                  name: event.name,
                  description: perm.description,
                  resolve: resolveFn!,
                }

                const allowed = await promise

                if (allowed) {
                  permissionContext.approvedToolCallIds!.add(event.toolCallId)
                } else {
                  permissionContext.rejectedToolCallIds!.add(event.toolCallId)
                }
              }
            }
          }
        }

        // After tool execution, check for todo updates to broadcast progress
        if (event.type === 'tool-use-end') {
          const currentTodos = loadTasks(this.sessionId ?? undefined)
          if (currentTodos.length > 0) {
            // Auto-mark the first incomplete todo as complete when an OUTPUT tool succeeds.
            // Only "write/replace" type tools count as task progress — not searches/reads.
            const outputTools = ['writeFile', 'writeFileBase64', 'replaceWordParagraph', 'createDocument']
            if (outputTools.includes(event.name)) {
              const firstIncomplete = currentTodos.find((t) => !t.completed)
              if (firstIncomplete) {
                firstIncomplete.completed = true
                saveTasks(currentTodos, this.sessionId ?? undefined)
              }
            }
            const completed = currentTodos.filter((t) => t.completed).length
            yield {
              type: 'todo-update',
              tasks: currentTodos.map((t) => ({ text: t.text, completed: t.completed })),
              completedCount: completed,
              totalCount: currentTodos.length,
            }
          }
        }
      }

      // ── Error reporting: if last assistant's tool calls all failed, report to user ──
      const lastAssistantMsg = [...this.messages].reverse().find((m) => m.role === 'assistant')
      if (lastAssistantMsg?.toolCalls && lastAssistantMsg.toolCalls.length > 0) {
        const toolCallIds = lastAssistantMsg.toolCalls.map((tc) => tc.id)
        const toolResults = this.messages
          .filter((m): m is Extract<typeof m, { role: 'tool' }> => m.role === 'tool')
          .filter((m) => toolCallIds.includes(m.toolCallId))

        const failedResults = toolResults.filter((m) => {
          const r = m.result as any
          return r && (r.error || r.rejected)
        })

        if (failedResults.length > 0 && failedResults.length === toolCallIds.length) {
          // All tool calls failed — report specific errors to user
          const errors = failedResults
            .map((m) => {
              const r = m.result as any
              if (r.rejected) return `${m.toolName}: User denied this operation`
              return `${m.toolName}: ${r.error || 'Unknown error'}`
            })
            .join('\n')
          const errorMsg = `❌ Operation failed:\n${errors}`
          console.error(`[Agent] ${errorMsg}`)
          yield { type: 'error', message: errorMsg }
        }
      }

      // ── Nudge: if task has uncompleted todos and last response had no tools, log warning ──
      // Note: RoundExecutor already gives the model one extra round when a round has no
      // tool calls (via `continue`), and the plan reminder is injected from round 1+.
      // This handles most cases. If tasks are still incomplete here, the model chose not
      // to use tools — likely either the task is truly done or the model is confused.
      const currentTodos = loadTasks(this.sessionId ?? undefined)
      const hasIncompleteTasks = currentTodos.some((t) => !t.completed)
      const hadToolCalls = lastAssistantMsg?.toolCalls && lastAssistantMsg.toolCalls.length > 0
      const hadAskQuestion = this.messages.some(
        (m) => m.role === 'tool' && (m as any).toolName === 'askUserQuestion',
      )

      if (hasIncompleteTasks && !hadToolCalls && !hadAskQuestion) {
        const nextTodo = currentTodos.find((t) => !t.completed)
        const warningMsg = `⚠️ Task ended early. Incomplete step: "${nextTodo?.text ?? 'unknown'}". ` +
          `The model did not produce the expected tool call. Try rephrasing with more explicit instructions.`
        console.warn(`[Agent] ${warningMsg}`)
        yield { type: 'text', text: warningMsg }
      }

      yield { type: 'done' }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        yield { type: 'done' }
      } else {
        yield { type: 'error', message: err.message || 'Unknown error' }
      }
    } finally {
      this.running = false
      this.abortController = null
    }
  }
}

function summarizeFileTree(workspacePath: string, maxEntries: number = 200): string {
  try {
    const { readdirSync, statSync } = require('fs')
    const { join, relative } = require('path')

    const entries: string[] = []

    function walk(dir: string, depth: number = 0) {
      if (entries.length >= maxEntries) return
      if (depth > 3) return

      const items = readdirSync(dir, { withFileTypes: true })
      for (const item of items) {
        if (entries.length >= maxEntries) break
        if (item.name.startsWith('.')) continue
        const fullPath = join(dir, item.name)
        const relPath = relative(workspacePath, fullPath)
        if (item.isDirectory()) {
          entries.push(`[D] ${relPath}/`)
          walk(fullPath, depth + 1)
        } else {
          entries.push(`[F] ${relPath}`)
        }
      }
    }

    walk(workspacePath)
    return entries.join('\n')
  } catch {
    return '(could not read file tree)'
  }
}
