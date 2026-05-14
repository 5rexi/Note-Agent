/**
 * Agent Core — 对外导出
 */
export { AgentEngine, type AgentEngineOptions } from './engine/AgentEngine'
export { MultiProviderEngine, type MultiProviderEngineOptions } from './engine/MultiProviderEngine'
export { executeRound, type RoundExecutorOptions } from './engine/RoundExecutor'
export { ModelRouter, createDualModelConfig, createTriModelConfig, type ModelProfile, type RouterConfig, type RoutingRule, type RoutingContext, type RoutingResult } from './router/ModelRouter'

export type { Tool, ToolContext } from './tools/Tool'
export { registerTool, getTool, getAllTools, getToolNames, clearRegistry } from './tools/registry'
export { checkToolPermission, type PermissionContext, type PermissionRule } from './tools/permissions'

export type {
  Message,
  ContentPart,
  ToolCall,
  ToolResult,
  AgentEvent,
  LLMConfig,
  AgentContext,
  PermissionMode,
  PermissionResult,
  RoundResult,
} from './types'

export { createLLMClient, type LLMClient, type LLMStreamEvent } from './llm/client'

// Tool implementations
export { ReadFileTool } from './tools/impl/readFile'
export { ListFilesTool } from './tools/impl/listFiles'
export { WriteFileTool } from './tools/impl/writeFile'
export { EditFileTool } from './tools/impl/editFile'
export { EditFileRangeTool } from './tools/impl/editFileRange'
export { GlobSearchTool } from './tools/impl/globSearch'
export { GrepSearchTool } from './tools/impl/grepSearch'
export { ExecuteCommandTool } from './tools/impl/executeCommand'
export { WebFetchTool } from './tools/impl/webFetch'
export { WebSearchTool } from './tools/impl/webSearch'
export { BrowseTool } from './tools/impl/browse'
export { TodoWriteTool } from './tools/impl/todoWrite'
export { AskUserQuestionTool } from './tools/impl/askUserQuestion'
export { SubagentTool, setSubagentParentConfig } from './tools/impl/subagent'
export { SkillTool } from './skills/skillTool'
export { CostTool } from './cost/CostTool'
export { ToolSearchTool } from './tools/impl/toolSearch'
export { FileHistoryTool } from './tools/impl/history'
export { HttpTool } from './tools/impl/http'
export { IndexerTool } from './tools/impl/indexer'
export { SearchKnowledgeBaseTool } from './tools/impl/searchKnowledgeBase'
export { SearchArxivTool } from './tools/impl/searchArxiv'
export { SearchSemanticScholarTool } from './tools/impl/searchSemanticScholar'
export { SearchPubMedTool } from './tools/impl/searchPubMed'
export { ReplaceWordParagraphTool } from './tools/impl/replaceWordParagraph'
export { AddWordParagraphTool } from './tools/impl/addWordParagraph'
export { DeleteWordParagraphTool } from './tools/impl/deleteWordParagraph'
export { ModifyWordFormatTool } from './tools/impl/modifyWordFormat'
export { WordViewTool } from './tools/impl/wordView'
export { WordGetTool } from './tools/impl/wordGet'
export { WordSetTool } from './tools/impl/wordSet'
export { WordAddTool } from './tools/impl/wordAdd'
export { WordRemoveTool } from './tools/impl/wordRemove'
export { WordQueryTool } from './tools/impl/wordQuery'
export { WordRawTool } from './tools/impl/wordRaw'
export { DoneTool } from './tools/impl/done'

// Subsystems
export { fileStateCache } from './file-cache/FileStateCache'
export { hookRegistry, type HookEventType, type Hook, type HookHandler } from './hooks/types'
export { taskManager, type BackgroundTask } from './tasks/TaskManager'
export { Coordinator, type CoordinatorOptions, type WorkerConfig } from './coordinator/Coordinator'
export { WorktreeManager } from './worktree/WorktreeManager'
export { LSPClient, type LSPPosition, type LSPLocation, type LSPDiagnostic } from './lsp/client'
export { costTracker, getModelPricing, setCustomPricing, generateCostReport } from './cost/index'
export { stripSignatureBlocks } from './signature'
export { loadPermissionRules, createDefaultPermissionRules } from './tools/permissions/rules'

// MCP
export { MCPClient, type MCPServerConfig, type MCPTool, loadMCPConfig } from './mcp/client'
export { MCPSSEClient } from './mcp/sse-client'

// Config & utils
export { loadConfig, configSchema, parseCliArgs } from './config'
export { buildSystemPrompt } from './prompt/builder'
export { loadSkills, formatSkillsContext } from './skills/loader'
export { compactMessages, shouldCompact, estimateTokens } from './compact'
export { withRetry, classifyError, type ClassifiedError, type APIErrorCategory } from './retry'
export { logger, type LogLevel } from './logger'
