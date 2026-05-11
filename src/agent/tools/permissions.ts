/**
 * 权限系统 — 参考 Claude Code 设计文档第5章
 *
 * 五级优先级选择：
 *   1. alwaysDenyRules（全局拒绝）
 *   2. checkPermissions()（Tool 自定义检查）
 *   3. alwaysAllowRules（全局允许）
 *   4. 模式级权限（explore/ask/execute）
 *   5. 用户确认（ASK 模式）
 *
 * 失败关闭原则：默认 deny/ask
 */
import type { Tool, ToolContext } from './Tool'
import type { PermissionMode, PermissionResult } from '../types'

export interface PermissionRule {
  /** 规则名称 */
  name: string
  /** 匹配模式：glob 或正则 */
  pattern: string
  /** 规则类型 */
  type: 'allow' | 'deny' | 'ask'
  /** 可选：仅对特定工具生效 */
  tool?: string
  /** 可选：仅对特定模式生效 */
  mode?: PermissionMode
}

export interface PermissionContext {
  mode: PermissionMode
  /** alwaysAllow 规则（最高优先级允许） */
  alwaysAllowRules: PermissionRule[]
  /** alwaysDeny 规则（最高优先级拒绝） */
  alwaysDenyRules: PermissionRule[]
  /** alwaysAsk 规则（强制询问） */
  alwaysAskRules: PermissionRule[]
  /** 已批准的 tool call IDs */
  approvedToolCallIds?: Set<string>
  /** 已拒绝的 tool call IDs */
  rejectedToolCallIds?: Set<string>
}

/**
 * 加载权限规则
 * 来源优先级：CLI args > 用户配置 > 项目配置
 */
export function loadPermissionRules(): {
  allow: PermissionRule[]
  deny: PermissionRule[]
  ask: PermissionRule[]
} {
  // TODO: 从 ~/.note_agent/permissions.json 和 .note_agent/permissions.json 加载
  return { allow: [], deny: [], ask: [] }
}

/**
 * 检查规则是否匹配
 */
function ruleMatches(rule: PermissionRule, toolName: string, input: unknown): boolean {
  if (rule.tool && rule.tool !== toolName) return false

  // Simple glob matching
  const pattern = rule.pattern
  if (pattern === '*') return true

  // Check if input contains pattern matchable string
  const inputStr = JSON.stringify(input)
  if (inputStr.includes(pattern)) return true

  // Try regex
  try {
    const regex = new RegExp(pattern)
    if (regex.test(inputStr)) return true
  } catch {
    // Invalid regex, treat as literal
  }

  return false
}

/**
 * 完整的权限检查流程（6步）
 */
export function checkToolPermission(
  tool: Tool,
  input: unknown,
  ctx: PermissionContext,
): PermissionResult {
  // Step 1: Check approved/rejected tool call IDs
  const toolCallId = (input as any)?._toolCallId
  if (toolCallId && ctx.approvedToolCallIds?.has(toolCallId)) {
    return { result: 'allow' }
  }
  if (toolCallId && ctx.rejectedToolCallIds?.has(toolCallId)) {
    return { result: 'deny', reason: 'User denied this operation' }
  }

  // Step 2: alwaysDeny rules (highest priority block)
  for (const rule of ctx.alwaysDenyRules) {
    if (ruleMatches(rule, tool.name, input)) {
      return { result: 'deny', reason: `Blocked by rule: ${rule.name}` }
    }
  }

  // Step 3: Tool's own checkPermissions()
  const toolResult = tool.checkPermissions(input, {
    workspacePath: '',
    mode: ctx.mode,
  })
  if (toolResult.result === 'deny') {
    return toolResult
  }

  // Step 4: alwaysAllow rules (override mode checks)
  for (const rule of ctx.alwaysAllowRules) {
    if (ruleMatches(rule, tool.name, input)) {
      return { result: 'allow' }
    }
  }

  // Step 5: alwaysAsk rules
  for (const rule of ctx.alwaysAskRules) {
    if (ruleMatches(rule, tool.name, input)) {
      return {
        result: 'ask',
        description: `Rule "${rule.name}" requires confirmation`,
      }
    }
  }

  // Step 6: Mode-level permission
  if (ctx.mode === 'explore' && !tool.isReadOnly()) {
    return { result: 'deny', reason: 'Explore mode only allows read-only operations' }
  }

  // Tool said ask
  if (toolResult.result === 'ask') {
    return toolResult
  }

  // ASK mode: destructive tools need confirmation
  if (ctx.mode === 'ask' && (tool.isDestructive() || !tool.isReadOnly())) {
    return {
      result: 'ask',
      description: tool.renderToolUse?.(input) || `${tool.name} on ${JSON.stringify(input)}`,
    }
  }

  // Default: allow
  return { result: 'allow' }
}

/**
 * 根据 deny 规则过滤工具列表
 * 被全局拒绝的工具不应出现在模型可见列表中
 */
export function filterToolsByDenyRules(
  tools: Tool[],
  denyRules: PermissionRule[],
): Tool[] {
  return tools.filter((tool) => {
    for (const rule of denyRules) {
      if (rule.tool === tool.name || rule.pattern === '*') {
        return false
      }
    }
    return true
  })
}
