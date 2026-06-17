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
import { TerminalManager } from './terminal'
import { getShellEnvFromDb } from './shell-env'
import {
  AgentEngine,
  MultiProviderEngine,
  getAllTools,
  registerTool,
  clearRegistry,
  ReadFileTool,
  ListFilesTool,
  WriteFileTool,
  AppendFileTool,
  EditFileTool,
  EditFileRangeTool,
  GlobSearchTool,
  GrepSearchTool,
  ExecuteCommandTool,
  WebFetchTool,
  WebSearchTool,
  BrowseTool,
  TodoWriteTool,
  UpdateMemoryTool,
  RecallHistoryTool,
  StartBackgroundTaskTool,
  ListBackgroundTasksTool,
  ReadBackgroundTaskTool,
  StopBackgroundTaskTool,
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
  PathJoinTool,
  WordViewTool,
  WordGetTool,
  WordSetTool,
  WordAddTool,
  WordRemoveTool,
  WordQueryTool,
  WordRawTool,
  WordFillTemplateTool,
  CreateDocumentTool,
  DoneTool,
  ModelRouter,
  createTriModelConfig,
  createDualModelConfig,
  type ModelRouter as ModelRouterType,
  type RouterConfig,
} from '../agent'
import { MCPClient, loadMCPConfig } from '../agent/mcp/client'
import { createMCPTool } from '../agent/mcp/tool-bridge'
import { extractKeyPoints, appendSessionMemory } from '../agent/memory'
import { backgroundTasks } from '../agent/tools/impl/background-task-manager'
import { createLLMClient } from '../agent'
import { InstallSkillTool } from '../agent/tools/impl/installSkill'
import { InstallMcpTool } from '../agent/tools/impl/installMcp'
import { InstallApiTool } from '../agent/tools/impl/installApi'
import type { Message, AgentEvent, LLMConfig, PermissionMode } from '../agent'

/** Kind of "create" session triggered from the UI (Sidebar +Skill/+MCP/+API). */
export type CreateKind = 'skill' | 'mcp' | 'api'
/** Install tools gated to a specific create context. Invisible in normal chat. */
const INSTALL_TOOL_NAMES = ['installSkill', 'installMcp', 'installApi']
const CREATE_KIND_TOOL: Record<CreateKind, string> = {
  skill: 'installSkill',
  mcp: 'installMcp',
  api: 'installApi',
}
import type { Database } from './db'
import { existsSync, readFileSync } from 'fs'
import { join, isAbsolute } from 'path'
import { homedir, platform } from 'os'

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
    AppendFileTool,
    EditFileTool,
    EditFileRangeTool,
    GlobSearchTool,
    GrepSearchTool,
    ExecuteCommandTool,
    WebFetchTool,
    WebSearchTool,
    BrowseTool,
    TodoWriteTool,
    UpdateMemoryTool,
    RecallHistoryTool,
    StartBackgroundTaskTool,
    ListBackgroundTasksTool,
    ReadBackgroundTaskTool,
    StopBackgroundTaskTool,
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
    PathJoinTool,
    WordViewTool,
    WordGetTool,
    WordSetTool,
    WordAddTool,
    WordRemoveTool,
    WordQueryTool,
    WordRawTool,
    WordFillTemplateTool,
    CreateDocumentTool,
    InstallSkillTool,
    InstallMcpTool,
    InstallApiTool,
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
        }).catch((err: any) => {
          // MCP connection failed — logged silently
        })
        mcpClients.push(client)
      } catch {
        // MCP setup failed — logged silently
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
  /** Gated "create" context (skill/mcp/api); gates the matching install tool. */
  createKind?: CreateKind
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
      let content: string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }> = dbMsg.content || ''
      if (typeof dbMsg.content === 'string' && dbMsg.content.startsWith('[')) {
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
      let reasoningContent: string | undefined

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
          if (metadata.thinkContent) {
            reasoningContent = metadata.thinkContent
          }
        } catch {
          // ignore
        }
      }

      if (!toolCalls && dbMsg.tool_calls) {
        try { toolCalls = JSON.parse(dbMsg.tool_calls) } catch {}
      }
      if (!reasoningContent && dbMsg.reasoning_content) {
        reasoningContent = dbMsg.reasoning_content
      }

      return {
        role: 'assistant',
        content,
        toolCalls: toolCalls?.length ? toolCalls : undefined,
        reasoningContent,
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
  reasoning_content?: string
} {
  switch (msg.role) {
    case 'user': {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      return { role: 'user', content }
    }
    case 'assistant': {
      let content = msg.content
      const reasoning = (msg as any).reasoningContent
      // Keep legacy HTML comment embedding for backward compatibility
      if (reasoning) {
        const meta = Buffer.from(JSON.stringify({ thinkContent: reasoning }), 'utf-8').toString('base64')
        content += `\n\n<!--NA_META:${meta}-->`
      }
      return {
        role: 'assistant',
        content,
        tool_calls: msg.toolCalls?.length ? JSON.stringify(msg.toolCalls) : undefined,
        reasoning_content: reasoning || undefined,
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
  createKind?: CreateKind,
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
  // If the gated create-context changed, recreate to add/remove the install tool
  const createKindChanged = state && state.createKind !== createKind

  if (!state || configChanged || modeChanged || createKindChanged) {
    initTools()

    // Filter tools by mode: explore mode only shows read-only tools
    const allTools = getAllTools()
    let visibleTools = mode === 'explore'
      ? allTools.filter((t) => t.isReadOnly())
      : allTools

    // Gate the install tools: they are NEVER visible in normal chat. First
    // strip ALL install tools, then (only in a create-context triggered by the
    // UI's +Skill/+MCP/+API button) add back the single matching tool — even in
    // explore mode, since installing requires a write tool.
    visibleTools = visibleTools.filter((t) => !INSTALL_TOOL_NAMES.includes(t.name))
    if (createKind) {
      const wanted = allTools.find((t) => t.name === CREATE_KIND_TOOL[createKind])
      if (wanted && !visibleTools.includes(wanted)) visibleTools = [...visibleTools, wanted]
    }

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

    // Read compact threshold from settings (default 80_000 to align with compact.ts).
    let compactThreshold = 80_000
    try {
      const db = getDb()
      const raw = db?.getSetting('compactThreshold')
      if (raw) {
        const parsed = parseInt(String(raw), 10)
        if (Number.isFinite(parsed) && parsed > 0) {
          compactThreshold = parsed
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
      compactConfig: { threshold: compactThreshold },
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
      createKind,
      modifiedFiles: new Set(),
      canUndo: false,
    }
    sessions.set(sessionId, state)
  } else {
    state.engine.setMode(mode)
    // Update data sources on each submit so user can change them per message
    state.dataSources = dataSources
    state.createKind = createKind
  }
  return state
}

/**
 * Opt-in prompt tidying: ask the FAST model for a short structured "task brief"
 * (goal · target files · constraints) that is prepended as CONTEXT — the user's
 * original message is kept verbatim. Bounded by a timeout; returns null on any
 * failure so it never blocks a submit.
 */
async function generateTaskBrief(userInput: string, openFiles: string[], config: LLMConfig): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const client = createLLMClient(config)
    const sys =
      'You are a planning assistant for a coding/writing agent. Read the user request and produce a SHORT task brief (3-5 lines max): the GOAL, the TARGET file(s), and key CONSTRAINTS. ' +
      'Do NOT answer or perform the task, and do NOT add anything the user did not imply. Reply in the user\'s language. Output only the brief.'
    const ctxFiles = openFiles.length ? `\n\nOpen files (active last): ${openFiles.join(', ')}` : ''
    const msgs: Message[] = [
      { role: 'system', content: sys },
      { role: 'user', content: userInput + ctxFiles },
    ]
    let out = ''
    for await (const ev of client.stream(msgs, [], controller.signal)) {
      if (ev.type === 'text') out += ev.text
    }
    out = out.trim()
    return out.length > 0 ? out.slice(0, 600) : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function clearSessionState(sessionId: string) {
  // Kill any background tasks belonging to this session so they don't orphan.
  try { backgroundTasks.killSession(sessionId) } catch {}
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
    reasoning_content: dbMsg.reasoning_content ?? undefined,
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

  // Explicit current-file references (Chinese + English)
  const currentFileKeywords = [
    '这个文件', '当前文件', '该文件', '此文件',
    '针对这个文件', '关于这个文件', '在这个文件里',
    '把这个文件', '改这个文件', '修改这个', '改一下这个',
    '优化这个文件', '调整这个文件', '修复这个文件',
    '这个文档', '当前文档', '这份文档',
    'this file', 'current file', 'the file', 'this doc', 'this document',
    'the document', 'current document', 'the doc',
  ]
  if (currentFileKeywords.some((kw) => lower.includes(kw))) {
    if (openFiles.length > 0) {
      refs.push(openFiles[openFiles.length - 1])
    }
  }

  // Implicit edit intent without explicit file mention — default to current file.
  // Only trigger when no @mentions exist and message looks like an edit request.
  if (atMentions === null) {
    const editVerbs = [
      '修改', '改', '优化', '调整', '修复', '重构', '更新',
      'edit', 'fix', 'modify', 'change', 'update', 'refactor', 'improve', 'rewrite', 'optimize', 'adjust', 'revise',
    ]
    const hasEditVerb = editVerbs.some((v) => lower.includes(v))
    // Exclude if the user explicitly names another file/context (so we don't
    // wrongly attach the open file to a project-wide or other-file request).
    const fileContextWords = [
      '文件', '文档', '代码', '项目', '目录', '文件夹',
      'file', 'document', 'doc', 'code', 'project', 'directory', 'folder',
    ]
    const hasFileContext = fileContextWords.some((w) => lower.includes(w))
    if (hasEditVerb && !hasFileContext && openFiles.length > 0) {
      refs.push(openFiles[openFiles.length - 1])
    }
  }

  const allFilesKeywords = ['这些文件', '打开的文件', '所有文件', 'these files', 'open files', 'all files', 'all open files']
  if (allFilesKeywords.some((kw) => lower.includes(kw))) {
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
      createKind?: CreateKind
    }) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { success: false, error: 'No window' }

      const { sessionId, userInput, config, mode, workspacePath, openFiles, tierOverride, modelOverride, attachments, dataSources, createKind } = payload

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
        modelRouter, tierOverride, modelOverride, dataSources, createKind,
      )

      if (state.running) {
        return { success: false, error: 'Agent is already running for this session' }
      }

      state.running = true
      state.senderId = event.sender.id
      state.permissionResolvers.clear()

      // Build enhanced user input with file references
      const fileRefs = resolveFileReferences(userInput, workspacePath, openFiles || [])
      let enhancedInput = fileRefs.length > 0
        ? `${userInput}\n\n[Referenced files: ${fileRefs.join(', ')}]`
        : userInput

      // Opt-in: prepend a fast-model "task brief" as context (original kept).
      try {
        if (getDb()?.getSetting('promptTaskBrief') === 'true') {
          const weakCfg = resolveLLMConfig(providers, defaultConfig, 'weak') || effectiveConfig
          const brief = await generateTaskBrief(userInput, openFiles || [], weakCfg)
          if (brief) enhancedInput = `[任务摘要（自动生成，仅供参考）]\n${brief}\n[/任务摘要]\n\n${enhancedInput}`
        }
      } catch { /* never block submit */ }

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
          // Before an edit/create tool runs, capture the file's CURRENT state so
          // undo-all can revert ANY file the agent touches — not just open ones —
          // and delete files it creates. tool-use-start fires before the write.
          if (agentEvent.type === 'tool-use-start') {
            try {
              const name = (agentEvent as any).name || ''
              const EDIT_TOOLS = ['writeFile', 'writeFileBase64', 'editFile', 'editFileRange', 'appendFile', 'createDocument', 'wordFillTemplate', 'replaceWordParagraph', 'wordSet', 'wordBatchSet', 'wordAdd', 'wordRemove', 'wordRaw']
              const inp = (agentEvent as any).input || {}
              const rawPath = inp.path || inp.filePath || inp.outputPath
              const db2 = getDb()
              if (EDIT_TOOLS.includes(name) && typeof rawPath === 'string' && db2) {
                const abs = isAbsolute(rawPath) ? rawPath : join(workspacePath, rawPath)
                if (!db2.hasSessionSnapshot(sessionId, abs)) {
                  const { readFileSync, existsSync } = require('fs')
                  const { extname } = require('path')
                  if (!existsSync(abs)) {
                    db2.saveSessionSnapshot(sessionId, abs, '', true) // created this turn → delete on undo
                  } else {
                    const ext = extname(abs).toLowerCase()
                    const isBinary = ['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.pdf', '.zip', '.jar', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico'].includes(ext)
                    const content = isBinary ? readFileSync(abs).toString('base64') : readFileSync(abs, 'utf-8')
                    db2.saveSessionSnapshot(sessionId, abs, content, false)
                  }
                  state.canUndo = true
                }
              }
            } catch { /* best-effort snapshot */ }
          }
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

        // End-of-turn auto-capture: extract durable user instructions from THIS
        // turn's messages into session memory. Heuristic only (no token cost).
        // Scoped to newMessages so we don't re-capture prior turns.
        // Skip when the turn was cancelled — `state.running` is set false by the
        // agent:cancel handler, so a half-finished turn doesn't pollute memory.
        if (state.running) try {
          const turnForMemory = newMessages.map((m) => {
            if (m.role === 'tool') {
              return { role: 'tool', content: typeof m.result === 'string' ? m.result : JSON.stringify(m.result), toolName: m.toolName }
            }
            const content = typeof m.content === 'string'
              ? m.content
              : Array.isArray(m.content)
                ? m.content.map((p: any) => (p.type === 'text' ? p.text : '')).join(' ')
                : ''
            return { role: m.role, content }
          })
          const points = extractKeyPoints(turnForMemory)
            .filter((p) => p.startsWith('User instruction:'))
            .slice(0, 3)
          for (const p of points) appendSessionMemory(sessionId, p)

          // Refresh the conversation summary used by the recall index. Cheap:
          // the first user message is what the conversation is about.
          const firstUser = allMessages.find((m) => m.role === 'user')
          if (firstUser) {
            const text = typeof firstUser.content === 'string'
              ? firstUser.content
              : Array.isArray(firstUser.content)
                ? firstUser.content.map((p: any) => (p.type === 'text' ? p.text : '')).join(' ')
                : ''
            const summary = text.trim().slice(0, 200)
            const sdb = getDb()
            if (summary && sdb && typeof (sdb as any).setSessionSummary === 'function') {
              (sdb as any).setSessionSummary(sessionId, summary)
            }
          }
        } catch { /* memory capture is best-effort */ }

        return { success: true }
      } catch (err: any) {
        const stack = err?.stack || ''
        const errorMessage = err?.message || 'Unknown error'
        if (!window.isDestroyed()) {
          window.webContents.send('agent:event', sessionId, {
            type: 'error',
            message: errorMessage,
          })
        }
        return { success: false, error: errorMessage }
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

  // Conversation search (recall) — for the chat header search overlay.
  ipcMain.handle(
    'recall:search',
    async (_event, payload: { query: string; sessionId?: string; workspacePath?: string; limit?: number }) => {
      const db = getDb() as any
      if (!db || typeof db.searchMessages !== 'function') return { hits: [], summaries: [] }
      const hits = db.searchMessages(payload.query, {
        sessionId: payload.sessionId,
        workspacePath: payload.workspacePath,
        limit: payload.limit ?? 30,
      })
      const summaries = payload.workspacePath && typeof db.getSessionSummaries === 'function'
        ? db.getSessionSummaries(payload.workspacePath)
        : []
      return { hits, summaries }
    },
  )

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
    const { writeFileSync, existsSync, unlinkSync } = require('fs')
    const { extname } = require('path')
    let restored = 0
    const errors: string[] = []
    for (const snap of snapshots) {
      try {
        // Files the agent CREATED this turn had no prior state — delete them.
        if (snap.was_created) {
          if (existsSync(snap.file_path)) unlinkSync(snap.file_path)
          restored++
          continue
        }
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

  // Python LSP (pyright)
  ipcMain.handle('pythonLsp:start', async (_event, workspacePath: string) => {
    const { startPythonLSP } = await import('./python-lsp')
    const db = getDb()
    const savedId = db?.getSetting(`pythonEnv:${workspacePath}`) || null
    return await startPythonLSP(workspacePath, savedId, (event) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('pythonLsp:diagnostics', workspacePath, event)
      })
    })
  })
  ipcMain.handle('pythonLsp:stop', async (_event, workspacePath: string) => {
    const { stopPythonLSP } = await import('./python-lsp')
    await stopPythonLSP(workspacePath)
    return { success: true }
  })
  ipcMain.handle('pythonLsp:open', async (_event, workspacePath: string, uri: string, text: string) => {
    const { openPythonDocument } = await import('./python-lsp')
    await openPythonDocument(workspacePath, uri, text)
    return { success: true }
  })
  ipcMain.handle('pythonLsp:change', async (_event, workspacePath: string, uri: string, text: string) => {
    const { changePythonDocument } = await import('./python-lsp')
    await changePythonDocument(workspacePath, uri, text)
    return { success: true }
  })
  ipcMain.handle('pythonLsp:completion', async (_event, workspacePath: string, uri: string, position: { line: number; character: number }) => {
    const { getPythonCompletion } = await import('./python-lsp')
    return await getPythonCompletion(workspacePath, uri, position)
  })
  ipcMain.handle('pythonLsp:hover', async (_event, workspacePath: string, uri: string, position: { line: number; character: number }) => {
    const { getPythonHover } = await import('./python-lsp')
    return await getPythonHover(workspacePath, uri, position)
  })

  // Python / uv / conda virtual environment
  ipcMain.handle('pythonEnv:ensureUv', async () => {
    const { ensureUvInstalled } = await import('./python-env')
    return await ensureUvInstalled()
  })
  ipcMain.handle('pythonEnv:ensureAgentVenv', async (_event, workspacePath: string) => {
    const { ensureAgentVenv } = await import('./python-env')
    return await ensureAgentVenv(workspacePath)
  })
  ipcMain.handle('pythonEnv:getAgentPython', async (_event, workspacePath: string) => {
    const { getAgentPythonPath } = await import('./python-env')
    return getAgentPythonPath(workspacePath)
  })
  ipcMain.handle('pythonEnv:listAvailable', async (_event, workspacePath: string) => {
    const { getAvailablePythonEnvs } = await import('./python-env')
    return getAvailablePythonEnvs(workspacePath)
  })
  ipcMain.handle('pythonEnv:getSelected', async (_event, workspacePath: string, savedId: string | null) => {
    const { getSelectedPythonEnv } = await import('./python-env')
    return getSelectedPythonEnv(workspacePath, savedId)
  })
  ipcMain.handle('pythonEnv:isCondaInstalled', async () => {
    const { isCondaInstalled } = await import('./python-env')
    return isCondaInstalled()
  })
  ipcMain.handle('pythonEnv:listCondaEnvs', async () => {
    const { listCondaEnvs } = await import('./python-env')
    return listCondaEnvs()
  })
  ipcMain.handle('pythonEnv:isUvInstalled', async () => {
    const { isUvInstalled } = await import('./python-env')
    return isUvInstalled()
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

  // ── Terminal ──
  const terminalManager = new TerminalManager()

  terminalManager.on('data', ({ id, data }) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('terminal:data', { id, data })
    })
  })
  terminalManager.on('exit', ({ id, exitCode }) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('terminal:exit', { id, exitCode })
    })
  })

  ipcMain.handle('terminal:create', async (_event, opts?: { shell?: string; cwd?: string; workspacePath?: string }) => {
    let pythonEnv = null
    if (opts?.workspacePath) {
      const { getSelectedPythonEnv } = await import('./python-env')
      const db = getDb()
      const savedId = db?.getSetting(`pythonEnv:${opts.workspacePath}`) || null
      pythonEnv = getSelectedPythonEnv(opts.workspacePath, savedId)
    }
    const session = terminalManager.create(opts?.shell, opts?.cwd, pythonEnv)
    return { id: session.id, shell: session.shell }
  })
  ipcMain.handle('terminal:write', async (_event, id: string, data: string) => {
    terminalManager.write(id, data)
  })
  ipcMain.handle('terminal:resize', async (_event, id: string, cols: number, rows: number) => {
    terminalManager.resize(id, cols, rows)
  })
  ipcMain.handle('terminal:kill', async (_event, id: string) => {
    terminalManager.kill(id)
  })
  ipcMain.handle('terminal:listShells', async () => {
    const shells: { name: string; path: string }[] = []
    if (platform() === 'win32') {
      shells.push({ name: 'PowerShell', path: 'powershell.exe' })
      shells.push({ name: 'CMD', path: 'cmd.exe' })
      const env = getShellEnvFromDb()
      if (env?.type === 'gitbash') shells.push({ name: 'Git Bash', path: env.path || 'bash.exe' })
      if (env?.type === 'wsl') shells.push({ name: 'WSL', path: 'wsl.exe' })
    } else {
      shells.push({ name: 'Bash', path: '/bin/bash' })
      if (existsSync('/bin/zsh')) shells.push({ name: 'Zsh', path: '/bin/zsh' })
      if (existsSync('/usr/bin/fish')) shells.push({ name: 'Fish', path: '/usr/bin/fish' })
    }
    return shells
  })

  ipcMain.handle('terminal:getDefaultShell', async () => {
    const { getTerminalDefaultShell } = await import('./terminal')
    return getTerminalDefaultShell()
  })

  ipcMain.handle('terminal:setDefaultShell', async (_event, shell: string) => {
    const { saveTerminalDefaultShell } = await import('./terminal')
    saveTerminalDefaultShell(shell)
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
