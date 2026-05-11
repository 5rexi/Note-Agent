/**
 * 权限规则加载器
 * 从配置文件加载 alwaysAllow / alwaysDeny / alwaysAsk 规则
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { PermissionRule } from './index'
import type { PermissionMode } from '../../types'

const USER_RULES_PATH = join(homedir(), '.note_agent', 'permissions.json')

interface PermissionConfig {
  allow?: Array<{
    name: string
    pattern: string
    tool?: string
    mode?: PermissionMode
  }>
  deny?: Array<{
    name: string
    pattern: string
    tool?: string
    mode?: PermissionMode
  }>
  ask?: Array<{
    name: string
    pattern: string
    tool?: string
    mode?: PermissionMode
  }>
}

/**
 * 从用户配置文件加载权限规则
 */
export function loadPermissionRules(): {
  allow: PermissionRule[]
  deny: PermissionRule[]
  ask: PermissionRule[]
} {
  if (!existsSync(USER_RULES_PATH)) {
    return { allow: [], deny: [], ask: [] }
  }

  try {
    const content = readFileSync(USER_RULES_PATH, 'utf-8')
    const config: PermissionConfig = JSON.parse(content)

    return {
      allow: (config.allow || []).map((r) => ({
        name: r.name,
        pattern: r.pattern,
        type: 'allow' as const,
        tool: r.tool,
        mode: r.mode,
      })),
      deny: (config.deny || []).map((r) => ({
        name: r.name,
        pattern: r.pattern,
        type: 'deny' as const,
        tool: r.tool,
        mode: r.mode,
      })),
      ask: (config.ask || []).map((r) => ({
        name: r.name,
        pattern: r.pattern,
        type: 'ask' as const,
        tool: r.tool,
        mode: r.mode,
      })),
    }
  } catch {
    return { allow: [], deny: [], ask: [] }
  }
}

/**
 * 创建默认权限配置文件（如果不存在）
 */
export function createDefaultPermissionRules(): void {
  if (existsSync(USER_RULES_PATH)) return

  const defaultRules: PermissionConfig = {
    deny: [
      {
        name: 'Block dangerous commands',
        pattern: 'rm -rf /|mkfs|dd if=/dev/zero|format c:',
        tool: 'executeCommand',
      },
    ],
    ask: [
      {
        name: 'Confirm git push',
        pattern: 'git push',
        tool: 'executeCommand',
      },
      {
        name: 'Confirm file deletion',
        pattern: 'rm ',
        tool: 'executeCommand',
      },
    ],
  }

  try {
    const dir = join(homedir(), '.note_agent')
    if (!existsSync(dir)) {
      const { mkdirSync } = require('fs')
      mkdirSync(dir, { recursive: true })
    }
    readFileSync(USER_RULES_PATH, 'utf-8') // trigger error if not exists
  } catch {
    const { writeFileSync } = require('fs')
    writeFileSync(USER_RULES_PATH, JSON.stringify(defaultRules, null, 2), 'utf-8')
  }
}
