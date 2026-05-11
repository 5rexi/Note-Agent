/**
 * 记忆管理系统 — 3 层记忆架构
 *
 * | 层级 | 文件位置 | 内容 |
 * |------|----------|------|
 * | 工作区记忆 | <workspace>/.note_agent/NOTEAGENT.md | 项目背景、技术栈、约定 |
 * | 用户记忆 | ~/.note_agent/user-profile.md | 用户偏好、常用命令 |
 * | 会话记忆 | 数据库存储 | 本轮摘要、关键决策 |
 */

import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import { loadMemories, saveMemory, deleteMemory } from './persistence'

const WORKSPACE_MEMORY_FILE = '.note_agent/NOTEAGENT.md'
const USER_PROFILE_FILE = 'user-profile.md'
const SESSION_MEMORY_TYPE = 'session'
const MAX_SESSION_MEMORY_ITEMS = 20
const MAX_MEMORY_CHARS_PER_ITEM = 2000

/**
 * 读取工作区记忆 (NOTEAGENT.md)
 */
export function loadWorkspaceMemory(workspacePath: string): string | undefined {
  const filePath = join(resolve(workspacePath), WORKSPACE_MEMORY_FILE)
  if (!existsSync(filePath)) return undefined
  try {
    const content = readFileSync(filePath, 'utf-8').trim()
    return content.length > 0 ? content : undefined
  } catch {
    return undefined
  }
}

/**
 * 读取用户记忆 (user-profile.md)
 */
export function loadUserProfile(): string | undefined {
  const filePath = join(homedir(), '.note_agent', USER_PROFILE_FILE)
  if (!existsSync(filePath)) return undefined
  try {
    const content = readFileSync(filePath, 'utf-8').trim()
    return content.length > 0 ? content : undefined
  } catch {
    return undefined
  }
}

/**
 * 追加会话记忆
 */
export function appendSessionMemory(sessionId: string, content: string): void {
  const trimmed = content.trim().slice(0, MAX_MEMORY_CHARS_PER_ITEM)
  if (trimmed.length === 0) return

  // Clean up old memories if too many
  const existing = loadMemories(sessionId, SESSION_MEMORY_TYPE)
  if (existing.length >= MAX_SESSION_MEMORY_ITEMS) {
    // Remove oldest (last in DESC order = last item)
    const oldest = existing[existing.length - 1]
    if (oldest) deleteMemory(oldest.id)
  }

  saveMemory(sessionId, SESSION_MEMORY_TYPE, trimmed)
}

/**
 * 获取会话记忆内容（按时间倒序合并）
 */
export function getSessionMemory(sessionId: string): string | undefined {
  const memories = loadMemories(sessionId, SESSION_MEMORY_TYPE)
  if (memories.length === 0) return undefined

  // Sort by created_at ASC (oldest first)
  const sorted = [...memories].sort((a, b) => a.created_at - b.created_at)
  return sorted.map((m) => m.content).join('\n\n---\n\n')
}

/**
 * 清除会话记忆
 */
export function clearSessionMemory(sessionId: string): void {
  const memories = loadMemories(sessionId, SESSION_MEMORY_TYPE)
  for (const m of memories) {
    deleteMemory(m.id)
  }
}

export interface MemoryContext {
  /** 工作区记忆 (NOTEAGENT.md) */
  workspaceMemory?: string
  /** 用户记忆 (user-profile.md) */
  userProfile?: string
  /** 会话记忆 */
  sessionMemory?: string
}

/**
 * 构建完整的记忆上下文
 */
export function buildMemoryContext(workspacePath: string, sessionId?: string): MemoryContext {
  const ctx: MemoryContext = {
    workspaceMemory: loadWorkspaceMemory(workspacePath),
    userProfile: loadUserProfile(),
  }

  if (sessionId) {
    ctx.sessionMemory = getSessionMemory(sessionId)
  }

  return ctx
}

/**
 * 将记忆上下文格式化为 system prompt 可用的字符串
 */
export function formatMemoryContext(ctx: MemoryContext): string {
  const parts: string[] = []

  if (ctx.workspaceMemory) {
    parts.push(`## Project Context (NOTEAGENT.md)\n${ctx.workspaceMemory}`)
  }

  if (ctx.userProfile) {
    parts.push(`## User Profile\n${ctx.userProfile}`)
  }

  if (ctx.sessionMemory) {
    parts.push(`## Session Memory\n${ctx.sessionMemory}`)
  }

  return parts.join('\n\n---\n\n')
}

/**
 * 从对话消息中提取关键信息作为 session memory
 * 简单启发式：提取用户明确指令和关键 tool 结果
 */
export function extractKeyPoints(messages: Array<{ role: string; content: string; toolName?: string }>): string[] {
  const points: string[] = []

  for (const msg of messages) {
    if (msg.role === 'user') {
      const content = msg.content as string
      // Heuristic: if user message looks like an instruction/constraint
      if (content.includes('always') || content.includes('never') || content.includes('prefer') || content.includes('use')) {
        points.push(`User instruction: ${content.slice(0, 200)}`)
      }
    }
    if (msg.role === 'tool' && msg.toolName) {
      // Extract tool results that look significant
      const result = msg.content as string
      if (result && result.length > 0 && result.length < 500) {
        points.push(`${msg.toolName} result: ${result.slice(0, 200)}`)
      }
    }
  }

  return points
}
