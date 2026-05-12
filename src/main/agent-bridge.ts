/**
 * Agent Core IPC Bridge (v2)
 * 在 Electron main 进程中管理 AgentEngine 实例，通过 IPC 与 renderer 通信。
 *
 * Phase 1 增强：
 * - 注册全部 17 个工具 + MCP 工具
 * - 集成 ModelRouter（从 settings 读取三档配置）
 * - 支持 session 级模型覆盖（tier + model）
 * - 新增 IPC：switchModel / getCostReport / getSwitchHistory / resolveFileReferences
 */
import { ipcMain, BrowserWindow } from 'electron'
import {
  AgentEngine,
  MultiProviderEngine,
  getAllTools,
  registerTool,
  clearRegistry,
  ReadFileTool,
  ListFilesTool,
  WriteFileTool,
  EditFileTool,
  EditFileRangeTool,
  GlobSearchTool,
  GrepSearchTool,
  ExecuteCommandTool,
  WebFetchTool,
  WebSearchTool,
  BrowseTool,
  TodoWriteTool,
  AskUserQuestionTool,
  SubagentTool,
  setSubagentParentConfig,
  SkillTool,
  CostTool,
  ToolSearchTool,
  FileHistoryTool,
  HttpTool,
  IndexerTool,
  SearchKnowledgeBaseTool,
  SearchArxivTool,
  SearchSemanticScholarTool,
  SearchPubMedTool,
  ReplaceWordParagraphTool,
  AddWordParagraphTool,
  DeleteWordParagraphTool,
  ModifyWordFormatTool,
  DoneTool,
  ModelRouter,
  createTriModelConfig,
  createDualModelConfig,
  type ModelRouter as ModelRouterType,
  type RouterConfig,
} from '../agent'
import { MCPClient, loadMCPConfig } from '../agent/mcp/client'
import { createMCPTool } from '../agent/mcp/tool-bridge'
import type { Message, AgentEvent, LLMConfig, PermissionMode } from '../agent'
import type { Database } from './db'
import { existsSync, readFileSync } from 'fs'
import { join, isAbsolute } from 'path'
import { homedir } from 'os'

// ── Provider Config (from Settings) ──

interface ProviderConfig {
  id: string
  name: string
  provider: string
  baseUrl: string
  apiKey: string
  models: string[]
  defaultModel: string
  modelStrong?: string
  modelBalanced?: string
  modelFast?: string
}

interface DefaultConfig {
  providerId: string
  model: string
  reasoning: 'fast' | 'balanced' | 'deep'
}

// ── Tool Registration ──

let toolsInitialized = false
let mcpClients: MCPClient[] = []

function initTools() {
  if (toolsInitialized) return
  toolsInitialized = true

  clearRegistry()

  const tools = [
    ReadFileTool,
    ListFilesTool,
    WriteFileTool,
    EditFileTool,
    EditFileRangeTool,
    GlobSearchTool,
    GrepSearchTool,
    ExecuteCommandTool,
    WebFetchTool,
    WebSearchTool,
    BrowseTool,
    TodoWriteTool,
    AskUserQuestionTool,
    SubagentTool,
    SkillTool,
    new CostTool(),
    new ToolSearchTool(),
    new FileHistoryTool(),
    new HttpTool(),
    new IndexerTool(),
    SearchKnowledgeBaseTool,
    SearchArxivTool,
    SearchSemanticScholarTool,
    SearchPubMedTool,
    ReplaceWordParagraphTool,
    AddWordParagraphTool,
    DeleteWordParagraphTool,
    ModifyWordFormatTool,
    DoneTool,
  ]
  tools.forEach(registerTool)

  // Set subagent parent config from default provider (will be updated on first submit)
  setSubagentParentConfig({ provider: 'openai', model: 'gpt-4o-mini', apiKey: '' })

  // Connect MCP servers
  try {
    const mcpConfigs = loadMCPConfig()
    for (const mcpConfig of mcpConfigs) {
      try {
        const client = new MCPClient(mcpConfig)
        client.connect().then(async () => {
          const mcpTools = await client.listTools()
          for (const mcpTool of mcpTools) {
            registerTool(createMCPTool(client, mcpTool))
          }
          console.log(`[AgentBridge] MCP connected: ${mcpConfig.name} (${mcpTools.length} tools)`)
        }).catch((err: any) => {
          console.warn(`[AgentBridge] MCP failed ${mcpConfig.name}:`, err.message)
        })
        mcpClients.push(client)
      } catch (err: any) {
        console.warn(`[AgentBridge] MCP setup failed ${mcpConfig.name}:`, err.message)
      }
    }
  } catch {
    // ignore if mcp.json doesn't exist
  }
}

// ── Model Router Builder ──

function buildModelRouter(providers: ProviderConfig[], defaultProviderId: string): ModelRouterType | undefined {
  const defaultProvider = providers.find((p) => p.id === defaultProviderId && p.apiKey)
  if (!defaultProvider) {
    // Try any provider with apiKey
    const anyProvider = providers.find((p) => p.apiKey)
    if (!anyProvider) return undefined
    return buildModelRouterFromProvider(anyProvider)
  }
  return buildModelRouterFromProvider(defaultProvider)
}

function buildModelRouterFromProvider(provider: ProviderConfig): ModelRouterType | undefined {
  const fast = provider.modelFast || provider.defaultModel
  const balanced = provider.modelBalanced || provider.defaultModel
  const strong = provider.modelStrong || provider.defaultModel

  const llmBase = {
    provider: provider.provider,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
  }

  // If all tiers are the same model, no routing needed
  if (fast === balanced && balanced === strong) return undefined

  // If only two distinct models, use dual config
  const models = [fast, balanced, strong].filter((m, i, arr) => arr.indexOf(m) === i)
  if (models.length === 2) {
    const config = createDualModelConfig(
      { name: fast, ...llmBase },
      { name: strong, ...llmBase },
    )
    return new ModelRouter(config)
  }

  // Three distinct models
  const config = createTriModelConfig(
    { name: fast, ...llmBase },
    { name: balanced, ...llmBase },
    { name: strong, ...llmBase },
  )
  return new ModelRouter(config)
}

// ── Session State ──

interface DataSourceSelection {
  kbFolderIds?: number[]
  apis?: string[]
  mcpServers?: string[]
}

interface SessionState {
  engine: AgentEngine
  running: boolean
  permissionResolvers: Map<string, (allow: boolean) => void>
  /** WebContents ID that initiated the current stream */
  senderId?: number
  /** Manual tier override (weak/medium/strong) */
  tierOverride?: 'weak' | 'medium' | 'strong'
  /** Manual model name override */
  modelOverride?: string
  /** Resolved LLM config at creation time */
  baseConfig: LLMConfig
  /** Selected data sources for this session */
  dataSources?: DataSourceSelection
  /** Files modified during this session (for undo-all) */
  modifiedFiles: Set<string>
  /** Whether the last submit has modifications that can be undone */
  canUndo: boolean
}

const sessions = new Map<string, SessionState>()

function getDb(): Database | null {
  return (global as any).__db ?? null
}

async function loadSettings() {
  const db = getDb()
  if (!db) return { providers: [] as ProviderConfig[], defaultConfig: null as DefaultConfig | null }
  try {
    const providersStr = db.getSetting('llmProviders')
    const defaultStr = db.getSetting('llmDefaultConfig')
    const providers = providersStr ? JSON.parse(providersStr) : []
    const defaultConfig = defaultStr ? JSON.parse(defaultStr) : null
    return { providers, defaultConfig }
  } catch {
    return { providers: [] as ProviderConfig[], defaultConfig: null as DefaultConfig | null }
  }
}

// ── Message Conversion ──

function dbToAgentMessage(dbMsg: any): Message | null {
  switch (dbMsg.role) {
    case 'user': {
      let content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = dbMsg.content
      if (dbMsg.content.startsWith('[')) {
        try {
          const parsed = JSON.parse(dbMsg.content)
          if (Array.isArray(parsed)) content = parsed as typeof content
        } catch {}
      }
      return { role: 'user', content }
    }
    case 'assistant': {
      let content = dbMsg.content || ''
      let toolCalls: any[] | undefined

      const metaMatch = content.match(/<!--NA_META:([A-Za-z0-9+/=]+)-->/)
      if (metaMatch) {
        try {
          const metadata = JSON.parse(Buffer.from(metaMatch[1], 'base64').toString('utf-8'))
          content = content.replace(/<!--NA_META:.*?-->(\n?\n?)?/, '').trim()
          if (metadata.toolCalls?.length) {
            toolCalls = metadata.toolCalls.map((tc: any) => ({
              id: tc.id,
              name: tc.name,
              input: tc.args || tc.input || {},
            }))
          }
        } catch {
          // ignore
        }
      }

      if (!toolCalls && dbMsg.tool_calls) {
        try { toolCalls = JSON.parse(dbMsg.tool_calls) } catch {}
      }

      return {
        role: 'assistant',
        content,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
      }
    }
    case 'tool': {
      let toolCallId = ''
      let toolName = ''
      let result: any = null

      try {
        const parsed = JSON.parse(dbMsg.content)
        if (parsed.type === 'tool-result') {
          toolCallId = parsed.toolCallId
          toolName = parsed.toolName
          result = parsed.result
        } else if (parsed.toolCallId && parsed.toolName) {
          toolCallId = parsed.toolCallId
          toolName = parsed.toolName
          result = parsed.result
        } else {
          result = parsed
        }
      } catch {
        result = dbMsg.content
      }

      return {
        role: 'tool',
        toolCallId: toolCallId || 'unknown',
        toolName: toolName || 'unknown',
        result,
      }
    }
    default:
      return null
  }
}

function agentMessageToDb(msg: Message): {
  role: string
  content: string
  tool_calls?: string
  tool_results?: string
} {
  switch (msg.role) {
    case 'user': {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      return { role: 'user', content }
    }
    case 'assistant': {
      let content = msg.content
      const reasoning = (msg as any).reasoningContent
      if (reasoning) {
        const meta = Buffer.from(JSON.stringify({ thinkContent: reasoning }), 'utf-8').toString('base64')
        content += `\n\n<!--NA_META:${meta}-->`
      }
      return {
        role: 'assistant',
        content,
        tool_calls: msg.toolCalls?.length ? JSON.stringify(msg.toolCalls) : undefined,
      }
    }
    case 'tool':
      return {
        role: 'tool',
        content: JSON.stringify({
          toolCallId: msg.toolCallId,
          toolName: msg.toolName,
          result: msg.result,
        }),
      }
    case 'system':
      return { role: 'system', content: msg.content }
    default:
      return { role: 'unknown', content: '' }
  }
}

// ── Session Management ──

function resolveLLMConfig(
  providers: ProviderConfig[],
  defaultConfig: DefaultConfig | null,
  tier?: 'weak' | 'medium' | 'strong',
  modelName?: string,
): LLMConfig | null {
  // 1. Direct model name override
  if (modelName) {
    for (const p of providers) {
      if (p.models.includes(modelName)) {
        return {
          provider: p.provider,
          providerName: p.name,
          model: modelName,
          apiKey: p.apiKey,
          baseUrl: p.baseUrl,
        }
      }
    }
  }

  // 2. Resolve default provider
  const provider = providers.find((p) => p.id === defaultConfig?.providerId && p.apiKey)
    || providers.find((p) => p.apiKey)
  if (!provider) return null

  // 3. Tier-based model selection
  const tierModel = tier === 'weak' ? provider.modelFast
    : tier === 'medium' ? provider.modelBalanced
    : tier === 'strong' ? provider.modelStrong
    : provider.defaultModel

  return {
    provider: provider.provider,
    providerName: provider.name,
    model: tierModel || provider.defaultModel,
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
  }
}

function getOrCreateSessionState(
  sessionId: string,
  config: LLMConfig,
  mode: PermissionMode,
  workspacePath: string,
  openFiles?: string[],
  modelRouter?: ModelRouterType,
  tierOverride?: 'weak' | 'medium' | 'strong',
  modelOverride?: string,
  dataSources?: DataSourceSelection,
): SessionState {
  let state = sessions.get(sessionId)

  // If config changed significantly, recreate engine
  const configChanged = state && (
    state.baseConfig.provider !== config.provider
    || state.baseConfig.model !== config.model
    || state.baseConfig.apiKey !== config.apiKey
    || state.baseConfig.baseUrl !== config.baseUrl
    || state.tierOverride !== tierOverride
    || state.modelOverride !== modelOverride
  )

  // If mode changed, recreate engine to update visible tools
  const modeChanged = state && state.engine.getMode() !== mode

  if (!state || configChanged || modeChanged) {
    initTools()

    // Filter tools by mode: explore mode only shows read-only tools
    const allTools = getAllTools()
    const visibleTools = mode === 'explore'
      ? allTools.filter((t) => t.isReadOnly())
      : allTools

    // Allow user override via setting `agentMaxRounds` (clamped to [5, 200]).
    // Default 50 covers multi-step tasks like ppt/docx generation. The
    // previous hardcoded value of 5 caused the agent to silently die mid-task.
    // Research mode defaults to 80 rounds for deep multi-step research.
    let maxRounds = mode === 'research' ? 80 : 50
    try {
      const db = getDb()
      const raw = db?.getSetting('agentMaxRounds')
      if (raw) {
        const parsed = parseInt(String(raw), 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          maxRounds = Math.min(200, Math.max(5, parsed))
        }
      }
    } catch {
      // fall back to default
    }

    const engine = new AgentEngine({
      llmConfig: config,
      mode,
      workspacePath,
      openFiles,
      tools: visibleTools,
      maxRounds,
      modelRouter,
      dataSources,
    })
    engine.setSessionId(sessionId)

    // Load message history from DB
    const db = getDb()
    if (db) {
      const dbMessages = db.getMessages(sessionId)
      const agentMessages = dbMessages
        .map(dbToAgentMessage)
        .filter((m: Message | null): m is Message => m !== null)
      engine.setMessages(agentMessages)
    }

    // If we have an old state, preserve message history
    if (state) {
      engine.setMessages(state.engine.getMessages())
    }

    state = {
      engine,
      running: false,
      permissionResolvers: new Map(),
      baseConfig: { ...config },
      tierOverride,
      modelOverride,
      dataSources,
      modifiedFiles: new Set(),
      canUndo: false,
    }
    sessions.set(sessionId, state)
  } else {
    state.engine.setMode(mode)
    // Update data sources on each submit so user can change them per message
    state.dataSources = dataSources
  }
  return state
}

function clearSessionState(sessionId: string) {
  sessions.delete(sessionId)
}

// ── Database Helpers ──

function genId(): string {
  return crypto.randomUUID()
}

function saveMessageToDb(sessionId: string, msg: Message) {
  const db = getDb()
  if (!db) return
  // Skip system messages — they are internal prompts/reminders and the DB schema
  // only allows 'user', 'assistant', 'tool' roles.
  if (msg.role === 'system') return
  // Skip empty assistant messages (no content and no tool calls) — these are
  // created when the model ignores instructions and produce blank responses.
  if (
    msg.role === 'assistant' &&
    (!msg.content || msg.content.trim() === '') &&
    (!msg.toolCalls || msg.toolCalls.length === 0)
  ) {
    return
  }
  const dbMsg = agentMessageToDb(msg)
  db.createMessage({
    id: genId(),
    session_id: sessionId,
    role: dbMsg.role,
    content: dbMsg.content,
    tool_calls: dbMsg.tool_calls ?? undefined,
    tool_results: dbMsg.tool_results ?? undefined,
  })
}

// ── File Reference Resolution ──

function resolveFileReferences(
  userInput: string,
  workspacePath: string,
  openFiles: string[],
): string[] {
  const refs: string[] = []

  // 1. Extract @mentions
  const atMentions = userInput.match(/@([\w./-]+(?:\.[\w]+)?)/g)
  if (atMentions) {
    for (const mention of atMentions) {
      const name = mention.slice(1)
      refs.push(name)
    }
  }

  // 2. Keyword-based resolution
  const lower = userInput.toLowerCase()

  // Explicit current-file references
  const currentFileKeywords = [
    '这个文件', '当前文件', '该文件', '此文件',
    '针对这个文件', '关于这个文件', '在这个文件里',
    '把这个文件', '改这个文件', '修改这个', '改一下这个',
    '优化这个文件', '调整这个文件', '修复这个文件',
  ]
  if (currentFileKeywords.some((kw) => lower.includes(kw))) {
    if (openFiles.length > 0) {
      refs.push(openFiles[openFiles.length - 1])
    }
  }

  // Implicit edit intent without explicit file mention — default to current file
  // Only trigger when no @mentions exist and message looks like an edit request
  if (atMentions === null) {
    const editVerbs = ['修改', '改', '优化', '调整', '修复', '重构', '更新']
    const hasEditVerb = editVerbs.some((v) => lower.includes(v))
    // Exclude if user explicitly mentions another file context
    const hasFileContext = lower.includes('文件') || lower.includes('文档') || lower.includes('代码')
                         || lower.includes('项目') || lower.includes('目录') || lower.includes('文件夹')
    if (hasEditVerb && !hasFileContext && openFiles.length > 0) {
      refs.push(openFiles[openFiles.length - 1])
    }
  }

  if (lower.includes('这些文件') || lower.includes('打开的文件') || lower.includes('所有文件')) {
    refs.push(...openFiles)
  }

  return [...new Set(refs)]
}

// ── IPC Bridge ──

export function registerAgentBridge() {
  // Submit a user message and start the agent loop
  ipcMain.handle(
    'agent:submit',
    async (event, payload: {
      sessionId: string
      userInput: string
      config: LLMConfig
      mode: PermissionMode
      workspacePath: string
      openFiles?: string[]
      tierOverride?: 'weak' | 'medium' | 'strong'
      modelOverride?: string
      attachments?: Array<{ type: 'image'; name: string; data: string; mediaType: string }>
      dataSources?: DataSourceSelection
    }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { success: false, error: 'No window' }

      const { sessionId, userInput, config, mode, workspacePath, openFiles, tierOverride, modelOverride, attachments, dataSources } = payload

      // Load settings to build model router
      const { providers, defaultConfig } = await loadSettings()
      const modelRouter = buildModelRouter(providers, defaultConfig?.providerId || '')

      // If tier/model override provided, resolve the actual config
      let effectiveConfig = config
      if (tierOverride || modelOverride) {
        const resolved = resolveLLMConfig(providers, defaultConfig, tierOverride, modelOverride)
        if (resolved) {
          effectiveConfig = resolved
        }
      }

      // Update subagent parent config
      setSubagentParentConfig({
        provider: effectiveConfig.provider,
        model: effectiveConfig.model,
        apiKey: effectiveConfig.apiKey,
        baseUrl: effectiveConfig.baseUrl,
      })

      const state = getOrCreateSessionState(
        sessionId, effectiveConfig, mode, workspacePath, openFiles,
        modelRouter, tierOverride, modelOverride, dataSources,
      )

      if (state.running) {
        return { success: false, error: 'Agent is already running for this session' }
      }

      state.running = true
      state.senderId = event.sender.id
      state.permissionResolvers.clear()

      // Build enhanced user input with file references
      const fileRefs = resolveFileReferences(userInput, workspacePath, openFiles || [])
      const enhancedInput = fileRefs.length > 0
        ? `${userInput}\n\n[Referenced files: ${fileRefs.join(', ')}]`
        : userInput

      // Save session snapshots for undo-all (per-submit)
      const db = getDb()
      if (db) {
        db.clearSessionSnapshots(sessionId)
        state.modifiedFiles.clear()
        const BINARY_EXTS = new Set([
          'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'pdf',
          'zip', 'jar', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico',
        ])
        for (const filePath of openFiles || []) {
          if (!filePath) continue
          const absPath = isAbsolute(filePath) ? filePath : join(workspacePath, filePath)
          try {
            const { readFileSync } = require('fs')
            const { extname } = require('path')
            const ext = extname(absPath).toLowerCase().replace('.', '')
            const isBinary = BINARY_EXTS.has(ext)
            if (isBinary) {
              const buffer = readFileSync(absPath)
              db.saveSessionSnapshot(sessionId, absPath, buffer.toString('base64'))
            } else {
              const content = readFileSync(absPath, 'utf-8')
              db.saveSessionSnapshot(sessionId, absPath, content)
            }
          } catch {
            // ignore files that can't be read (missing, etc.)
          }
        }
        state.canUndo = true
      }

      const beforeCount = state.engine.getMessages().length

      try {
        let submitParams: string | { text: string; imageParts?: Array<{ type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> } = enhancedInput
        if (attachments && attachments.length > 0) {
          submitParams = {
            text: enhancedInput,
            imageParts: attachments.map((a) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: a.mediaType, data: a.data },
            })),
          }
        }
        const generator = state.engine.submit(submitParams)

        for await (const agentEvent of generator) {
          if (!state.running) break
          // Track file modifications for undo-all
          if (agentEvent.type === 'tool-use-end') {
            const toolName = (agentEvent as any).name || ''
            const result = (agentEvent as any).result
            if (toolName && (toolName.includes('write') || toolName.includes('replace') || toolName.includes('create'))) {
              const path = result?.path || result?.filePath || result?.data?.path || result?.data?.filePath
              if (path && typeof path === 'string') {
                state.modifiedFiles.add(path)
              }
            }
          }
          if (!window.isDestroyed()) {
            const serializableEvent = makeSerializable(agentEvent, state)
            window.webContents.send('agent:event', sessionId, serializableEvent)
          }
        }

        // Save new messages (assistant + tool) to DB
        const allMessages = state.engine.getMessages()
        const newMessages = allMessages.slice(beforeCount + 1)
        for (const msg of newMessages) {
          saveMessageToDb(sessionId, msg)
        }

        return { success: true }
      } catch (err: any) {
        console.error('[AgentBridge] submit error:', err)
        if (!window.isDestroyed()) {
          window.webContents.send('agent:event', sessionId, {
            type: 'error',
            message: err.message || 'Unknown error',
          })
        }
        return { success: false, error: err.message }
      } finally {
        state.running = false
        state.senderId = undefined
        state.permissionResolvers.clear()
      }
    },
  )

  // Resolve a pending permission request
  ipcMain.handle(
    'agent:resolvePermission',
    async (_event, payload: { sessionId: string; toolCallId: string; allow: boolean }) => {
      const { sessionId, toolCallId, allow } = payload
      const state = sessions.get(sessionId)
      if (!state) return { success: false, error: 'Session not found' }

      const resolver = state.permissionResolvers.get(toolCallId)
      if (!resolver) return { success: false, error: 'Permission request not found' }

      resolver(allow)
      state.permissionResolvers.delete(toolCallId)
      return { success: true }
    },
  )

  // Cancel the current stream for a session
  ipcMain.handle('agent:cancel', async (_event, sessionId: string) => {
    const state = sessions.get(sessionId)
    if (!state) return { success: false, error: 'Session not found' }

    state.running = false
    state.engine.abort()

    // Clean up stale plan and todo files so they don't leak into the next task
    try {
      const { clearPlan } = await import('../agent/planner/TaskPlanner')
      clearPlan(sessionId)
    } catch {}
    try {
      const { TodoWriteTool } = await import('../agent/tools/impl/todoWrite')
      await TodoWriteTool.call({ action: 'clear' }, { workspacePath: state.engine.getWorkspacePath(), mode: state.engine.getMode(), sessionId })
    } catch {}

    return { success: true }
  })

  // Get AgentCore messages for a session
  ipcMain.handle('agent:getMessages', async (_event, sessionId: string) => {
    const state = sessions.get(sessionId)
    if (!state) return []
    return state.engine.getMessages()
  })

  // Clear session state
  ipcMain.handle('agent:clearSession', async (_event, sessionId: string) => {
    const state = sessions.get(sessionId)
    if (state) {
      state.running = false
      state.engine.abort()
    }
    clearSessionState(sessionId)
    return { success: true }
  })

  // Switch model for a session (manual override)
  ipcMain.handle(
    'agent:switchModel',
    async (_event, payload: { sessionId: string; tier?: 'weak' | 'medium' | 'strong'; model?: string }) => {
      const { sessionId, tier, model } = payload
      const state = sessions.get(sessionId)
      if (!state) return { success: false, error: 'Session not found' }

      state.tierOverride = tier
      state.modelOverride = model

      // Recreate engine with new config on next submit
      const { providers, defaultConfig } = await loadSettings()
      const resolved = resolveLLMConfig(providers, defaultConfig, tier, model)
      if (resolved) {
        state.baseConfig = resolved
        // Force recreate on next submit by clearing the cached state
        // (getOrCreateSessionState will detect config change)
        const oldMessages = state.engine.getMessages()
        sessions.delete(sessionId)
        // Re-create with new config but preserve messages
        const newState = getOrCreateSessionState(
          sessionId, resolved, state.engine.getMode(),
          (state.engine as any).opts?.workspacePath || '',
          (state.engine as any).opts?.openFiles,
          buildModelRouter(providers, defaultConfig?.providerId || ''),
          tier, model,
        )
        newState.engine.setMessages(oldMessages)
      }

      return { success: true }
    },
  )

  // Get cost report for a session (global provider-level token stats)
  ipcMain.handle('agent:getCostReport', async (_event, _sessionId: string) => {
    const { costTracker } = await import('../agent/cost/tracker')
    const stats = costTracker.getProviderStats()
    const total = costTracker.getTotalTokens()
    return {
      stats,
      total,
    }
  })

  // Undo all modifications made during the last submit
  ipcMain.handle('agent:undoAll', async (_event, sessionId: string) => {
    const db = getDb()
    const state = sessions.get(sessionId)
    if (!db || !state) {
      return { success: false, error: 'Session not found' }
    }
    if (!state.canUndo) {
      return { success: false, error: 'No modifications to undo' }
    }
    const snapshots = db.getSessionSnapshots(sessionId)
    if (snapshots.length === 0) {
      state.canUndo = false
      return { success: false, error: 'No snapshots found for this session' }
    }
    const { writeFileSync } = require('fs')
    const { extname } = require('path')
    let restored = 0
    const errors: string[] = []
    for (const snap of snapshots) {
      try {
        const ext = extname(snap.file_path).toLowerCase()
        const isBinary = ['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.pdf', '.zip', '.jar', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(ext)
        if (isBinary) {
          // Binary files are stored as base64 in snapshots
          const buffer = Buffer.from(snap.content, 'base64')
          writeFileSync(snap.file_path, buffer)
        } else {
          writeFileSync(snap.file_path, snap.content, 'utf-8')
        }
        restored++
      } catch (err: any) {
        errors.push(`${snap.file_path}: ${err.message}`)
      }
    }
    db.clearSessionSnapshots(sessionId)
    state.modifiedFiles.clear()
    state.canUndo = false
    if (errors.length > 0) {
      return { success: false, error: `Restored ${restored}/${snapshots.length} files. Errors: ${errors.join('; ')}` }
    }
    return { success: true, restored }
  })

  // Check if the session has undoable modifications
  ipcMain.handle('agent:canUndo', async (_event, sessionId: string) => {
    const state = sessions.get(sessionId)
    if (!state) return { canUndo: false }
    return { canUndo: state.canUndo }
  })

  // Clear global cost tracker records
  ipcMain.handle('agent:clearCost', async () => {
    const { costTracker } = await import('../agent/cost/tracker')
    costTracker.clear()
    return { success: true }
  })

  // Shell environment detection & config (Windows only)
  ipcMain.handle('shellEnv:detect', async () => {
    const { autoDetectShellEnv } = await import('./shell-env')
    return autoDetectShellEnv()
  })
  ipcMain.handle('shellEnv:get', async () => {
    const { getShellEnvFromDb } = await import('./shell-env')
    return getShellEnvFromDb()
  })
  ipcMain.handle('shellEnv:set', async (_event, config) => {
    const { saveShellEnvToDb } = await import('./shell-env')
    saveShellEnvToDb(config)
    return { success: true }
  })
  ipcMain.handle('shellEnv:hasSetup', async () => {
    const { hasCompletedShellEnvSetup } = await import('./shell-env')
    return hasCompletedShellEnvSetup()
  })

  // Python / uv virtual environment
  ipcMain.handle('pythonEnv:ensureUv', async () => {
    const { ensureUvInstalled } = await import('./python-env')
    return await ensureUvInstalled()
  })
  ipcMain.handle('pythonEnv:ensureVenv', async (_event, workspacePath: string) => {
    const { ensureWorkspaceVenv } = await import('./python-env')
    return await ensureWorkspaceVenv(workspacePath)
  })
  ipcMain.handle('pythonEnv:getPython', async (_event, workspacePath: string) => {
    const { getWorkspacePythonPath } = await import('./python-env')
    return getWorkspacePythonPath(workspacePath)
  })

  // Get model switch history for a session
  ipcMain.handle('agent:getSwitchHistory', async (_event, sessionId: string) => {
    const state = sessions.get(sessionId)
    if (!state) return []
    // MultiProviderEngine exposes getSwitchHistory
    const engine = state.engine as any
    if (engine.getSwitchHistory) {
      return engine.getSwitchHistory()
    }
    return []
  })

  // Resolve file references from natural language
  ipcMain.handle(
    'agent:resolveFileReferences',
    async (_event, payload: { userInput: string; workspacePath: string; openFiles?: string[] }) => {
      const { userInput, workspacePath, openFiles } = payload
      const refs = resolveFileReferences(userInput, workspacePath, openFiles || [])
      return { refs }
    },
  )

  // List models
  ipcMain.handle(
    'agent:listModels',
    async (_event, provider: string, baseUrl: string, apiKey: string) => {
      try {
        if (provider === 'anthropic') {
          return {
            models: [
              'claude-sonnet-4-20250514',
              'claude-haiku-4-20250514',
              'claude-opus-4-20250514',
            ],
            error: null,
          }
        }
        const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '') + '/models'
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        })
        if (!res.ok) {
          const err = await res.text()
          return { models: [], error: err }
        }
        const data = await res.json()
        const models = (data.data || [])
          .map((m: any) => m.id)
          .filter(
            (id: string) =>
              !id.includes('embedding') &&
              !id.includes('tts') &&
              !id.includes('whisper') &&
              !id.includes('dall'),
          )
          .slice(0, 50)
        return { models, error: null }
      } catch (err: any) {
        return { models: [], error: err.message }
      }
    },
  )

  // ── Todo List ──
  ipcMain.handle('agent:todoList', async (_event, sessionId: string) => {
    const tasksPath = join(homedir(), '.note_agent', 'tasks', `${sessionId}.json`)
    if (!existsSync(tasksPath)) return []
    try {
      return JSON.parse(readFileSync(tasksPath, 'utf-8'))
    } catch {
      return []
    }
  })
}

// ── Helpers ──

type SerializableAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-use-start'; toolCallId: string; name: string; input: Record<string, unknown> }
  | { type: 'tool-use-end'; toolCallId: string; name: string; result: unknown }
  | { type: 'permission-request'; toolCallId: string; name: string; description: string }
  | { type: 'error'; message: string }
  | { type: 'done' }
  | { type: 'model-switch'; provider: string; model: string; reason: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'context-compacted'; method: 'micro' | 'llm'; tokensBefore: number; tokensAfter: number }
  | { type: 'step-start'; stepId: number; description: string; totalSteps: number }
  | { type: 'step-end'; stepId: number; status: 'completed' | 'failed'; error?: string }
  | { type: 'step-retry'; stepId: number; attempt: number; reason: string }
  | { type: 'subagent-tool-start'; parentToolCallId: string; toolCallId: string; name: string; input: Record<string, unknown> }
  | { type: 'subagent-tool-end'; parentToolCallId: string; toolCallId: string; name: string; result: unknown }
  | { type: 'subagent-text'; parentToolCallId: string; text: string }
  | { type: 'todo-update'; tasks: Array<{ text: string; completed: boolean }>; completedCount: number; totalCount: number }

function makeSerializable(
  event: AgentEvent,
  state: SessionState,
): SerializableAgentEvent {
  if (event.type === 'permission-request') {
    state.permissionResolvers.set(event.toolCallId, event.resolve)
    return {
      type: 'permission-request',
      toolCallId: event.toolCallId,
      name: event.name,
      description: event.description,
    }
  }
  // usage events are also serializable
  if (event.type === 'usage') {
    return { type: 'usage', inputTokens: event.inputTokens, outputTokens: event.outputTokens }
  }
  // model-switch events
  if (event.type === 'model-switch') {
    return { type: 'model-switch', provider: event.provider, model: event.model, reason: event.reason }
  }
  // All other events are already serializable
  return event as SerializableAgentEvent
}
