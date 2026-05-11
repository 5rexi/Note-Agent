/**
 * System Prompt 模块化类型定义
 * 参考 Claude Code 的 section 数组架构
 */
import type { PermissionMode } from '../types'

export interface SystemPromptSection {
  /** Section 名称（用于调试和覆盖） */
  name: string
  /** Section 内容 */
  content: string
  /** 优先级：高优先级覆盖低优先级同名 section */
  priority: number
  /** 是否可缓存（静态内容可缓存，动态内容不可缓存） */
  cacheable: boolean
}

export interface PromptContext {
  mode: PermissionMode
  workspacePath: string
  openFiles?: string[]
  fileTree?: string
  memoryContent?: string
  disabledTools?: string[]
  skillsContext?: string
  /** 内置隐式 skills 内容（如 docx skill），不在 Available Skills 列表中展示 */
  builtInSkills?: string
  /** 当前 session 的 todo list 状态 */
  todoStatus?: string
}

export type SectionGenerator = (ctx: PromptContext) => SystemPromptSection | null
