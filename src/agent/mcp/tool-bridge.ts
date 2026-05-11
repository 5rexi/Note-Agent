/**
 * MCP Tool 桥接 — 将 MCP Tool 包装为本地 Tool 接口
 */
import { z } from 'zod'
import type { Tool, ToolContext } from '../tools/Tool'
import type { ToolResult } from '../types'
import type { MCPClient, MCPTool } from './client'

/**
 * 从 MCP JSON Schema 生成 Zod schema（简化版）
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') return z.any()

  const type = schema.type as string

  switch (type) {
    case 'string':
      return z.string()
    case 'number':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(jsonSchemaToZod(schema.items as Record<string, unknown>))
    case 'object': {
      const props = schema.properties as Record<string, Record<string, unknown>> || {}
      const required = (schema.required as string[]) || []
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [key, val] of Object.entries(props)) {
        let field = jsonSchemaToZod(val)
        if (!required.includes(key)) {
          field = field.optional()
        }
        shape[key] = field
      }
      return z.object(shape)
    }
    default:
      return z.any()
  }
}

/**
 * 将 MCP Tool 转换为本地 Tool
 */
export function createMCPTool(client: MCPClient, mcpTool: MCPTool): Tool {
  const schema = jsonSchemaToZod(mcpTool.inputSchema)

  return {
    name: `${client.getName()}_${mcpTool.name}`,
    description: `[MCP: ${client.getName()}] ${mcpTool.description}`,
    inputSchema: schema,

    isReadOnly() { return false },
    isConcurrencySafe() { return true },
    isDestructive() { return true },

    checkPermissions() {
      return { result: 'allow' }
    },

    validateInput(raw) {
      return schema.parse(raw)
    },

    async call(input, _ctx): Promise<ToolResult<any>> {
      try {
        const result = await client.callTool(mcpTool.name, input as Record<string, unknown>)
        return { data: result }
      } catch (err: any) {
        return { data: '', error: `MCP tool error: ${err.message}` }
      }
    },

    renderToolUse(input) {
      return `MCP [${client.getName()}]: ${mcpTool.name}(${JSON.stringify(input)})`
    },
  }
}
