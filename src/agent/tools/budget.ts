/**
 * Tool 结果预算限制 — 防止超长结果撑爆上下文
 *
 * 策略：
 * 1. 当结果字符串长度超过 maxChars 时，截断为前 maxChars 个字符
 * 2. 完整结果保存到 ~/.note_agent/tool-results/<toolCallId>.json
 * 3. 在截断结果中附加提示，告知模型完整路径
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { ToolResult } from '../types'

const DEFAULT_MAX_RESULT_CHARS = 50000
const TRUNCATION_NOTICE = '\n\n[...结果已截断 — 完整内容已保存到本地文件，可通过 path 读取]'

function getToolResultsDir(): string {
  const dir = join(homedir(), '.note_agent', 'tool-results')
  try {
    mkdirSync(dir, { recursive: true })
  } catch {
    // ignore
  }
  return dir
}

/**
 * 计算结果字符串长度（JSON 序列化后）
 */
function resultStringLength(result: ToolResult): number {
  try {
    const serialized = JSON.stringify(result.data)
    return serialized ? serialized.length : 0
  } catch {
    return result.data !== undefined ? String(result.data).length : 0
  }
}

/**
 * 保存完整结果到文件
 */
function saveFullResult(toolCallId: string, result: ToolResult): string {
  const dir = getToolResultsDir()
  const path = join(dir, `${toolCallId}.json`)
  const payload = {
    savedAt: new Date().toISOString(),
    toolCallId,
    result,
  }
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf-8')
  return path
}

/**
 * 对 ToolResult 应用预算限制
 * @param result 原始结果
 * @param maxChars 最大字符数（默认 50000）
 * @param toolCallId 用于保存文件名
 * @returns 可能被截断的结果
 */
export function applyBudget(
  result: ToolResult,
  maxChars: number = DEFAULT_MAX_RESULT_CHARS,
  toolCallId: string,
): ToolResult {
  const len = resultStringLength(result)
  if (len <= maxChars) {
    return result
  }

  // Save full result first
  const fullPath = saveFullResult(toolCallId, result)

  // Truncate data
  const fullStr = JSON.stringify(result.data)
  const availableChars = Math.max(100, maxChars - TRUNCATION_NOTICE.length)
  const truncatedStr = fullStr.slice(0, availableChars) + TRUNCATION_NOTICE

  // Try to keep it valid JSON if possible
  let truncatedData: unknown
  try {
    truncatedData = JSON.parse(truncatedStr)
  } catch {
    truncatedData = truncatedStr
  }

  return {
    ...result,
    data: truncatedData,
    truncated: true,
    fullResultPath: fullPath,
  }
}
