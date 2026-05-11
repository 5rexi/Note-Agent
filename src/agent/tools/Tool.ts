/**
 * Tool 接口定义 — 参考 Claude Code 设计
 * 每个 Tool 必须主动声明自己是安全的（失败关闭原则）
 */
import type { z } from 'zod'
import type { ToolResult, PermissionResult, AgentContext } from '../types'
export type { ToolResult } from '../types'

export interface ToolContext {
  workspacePath: string
  mode: 'explore' | 'ask' | 'execute' | 'research'
  openFiles?: string[]
  sessionId?: string
  /** Optional event reporter for subagent/tools to forward internal events */
  reportEvent?: (event: import('../types').AgentEvent) => void
  /** Parent tool call ID, used by subagent to tag forwarded events */
  parentToolCallId?: string
  /** LLM config from the parent agent — used by subagent to create its own client */
  llmConfig?: import('../types').LLMConfig
  /** Selected data sources for this session (KB folders, APIs, MCP servers) */
  dataSources?: {
    kbFolderIds?: number[]
    apis?: string[]
    mcpServers?: string[]
  }
}

export interface Tool<Input = unknown, Output = unknown> {
  /** Tool 名称，模型通过这个名字调用 */
  readonly name: string

  /** 给模型看的描述 */
  readonly description: string

  /** Zod schema，用于校验输入 + 生成 JSON Schema */
  readonly inputSchema: z.ZodType<Input>

  /** 别名（向后兼容） */
  readonly aliases?: string[]

  // ── 安全声明 ──

  /** 是否只读操作。默认 false（失败关闭） */
  isReadOnly(): boolean

  /** 是否可安全并发执行。默认 false（失败关闭） */
  isConcurrencySafe(): boolean

  /** 是否破坏性操作（删除、覆盖、发送）。默认 false */
  isDestructive(): boolean

  // ── 权限 ──

  /** 检查权限，返回 allow / deny / ask */
  checkPermissions(input: Input, ctx: ToolContext): PermissionResult

  /** 为权限规则准备匹配器（如 Bash(git *) 匹配 git 命令） */
  preparePermissionMatcher?(input: Input): Promise<(pattern: string) => boolean>

  // ── 执行 ──

  /** 校验输入（Zod parse + 额外业务校验） */
  validateInput(raw: unknown): Input

  /** 实际执行 */
  call(input: Input, ctx: ToolContext): Promise<ToolResult<Output>>

  // ── 预算限制 ──

  /** 此 Tool 单次返回结果的最大字符数（默认 50000） */
  maxResultSizeChars?: number

  // ── 渲染（可选，给 CLI/UI 看） ──

  renderToolUse?(input: Input): string
  renderToolResult?(result: ToolResult<Output>): string
}

/** 从 Zod schema 生成 OpenAI function schema */
export function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const anySchema = schema as any
  // Zod v4 has built-in toJSONSchema()
  if (typeof anySchema.toJSONSchema === 'function') {
    const jsonSchema = anySchema.toJSONSchema()
    delete jsonSchema.$schema
    // DeepSeek (and some strict OpenAI-compatible providers) require the
    // top-level schema to declare type: "object". Zod v4's toJSONSchema()
    // for discriminatedUnion produces { oneOf: [...] } without a type,
    // which these providers reject with "got 'type: null'".
    if (!jsonSchema.type) {
      jsonSchema.type = 'object'
    }
    return jsonSchema
  }
  // Fallback for Zod v3
  if (anySchema._def?.typeName === 'ZodObject') {
    const shape = anySchema._def.shape()
    const properties: Record<string, unknown> = {}
    const required: string[] = []
    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodTypeToJson(val as z.ZodType)
      if (!(val as any).isOptional?.()) {
        required.push(key)
      }
    }
    return { type: 'object', properties, required }
  }
  return { type: 'object', properties: {} }
}

function zodTypeToJson(z: z.ZodType): unknown {
  const def = (z as any)._def
  switch (def?.typeName) {
    case 'ZodString':
      return { type: 'string', description: def.description }
    case 'ZodNumber':
      return { type: 'number', description: def.description }
    case 'ZodBoolean':
      return { type: 'boolean', description: def.description }
    case 'ZodArray':
      return { type: 'array', items: zodTypeToJson(def.type) }
    case 'ZodOptional':
      return zodTypeToJson(def.innerType)
    case 'ZodEnum':
      return { type: 'string', enum: def.values }
    default:
      return { type: 'string' }
  }
}
