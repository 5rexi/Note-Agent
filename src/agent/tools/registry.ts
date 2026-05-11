/**
 * Tool 注册表 — 所有可用工具的集合
 */
import type { Tool } from './Tool'

const registry = new Map<string, Tool>()
const aliasMap = new Map<string, string>() // alias -> canonical name

export function registerTool(tool: Tool): void {
  registry.set(tool.name, tool)
  for (const alias of tool.aliases || []) {
    aliasMap.set(alias, tool.name)
  }
}

export function getTool(name: string): Tool | undefined {
  const canonical = aliasMap.get(name) || name
  return registry.get(canonical)
}

export function getAllTools(): Tool[] {
  return Array.from(registry.values())
}

export function getToolNames(): string[] {
  return Array.from(registry.keys())
}

export function clearRegistry(): void {
  registry.clear()
  aliasMap.clear()
}
