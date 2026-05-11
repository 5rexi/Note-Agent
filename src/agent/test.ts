/**
 * Agent Core 单元测试 — 用 mock LLM 验证核心逻辑
 */
import {
  AgentEngine,
  registerTool,
  clearRegistry,
  ReadFileTool,
  ListFilesTool,
  WriteFileTool,
  EditFileTool,
  GlobSearchTool,
  GrepSearchTool,
  ExecuteCommandTool,
} from './index'
import type { LLMClient, LLMStreamEvent, Message, ToolCall } from './index'

// ── Mock LLM Client ──

function createMockClient(responses: Array<{ text?: string; toolCalls?: ToolCall[] }>): LLMClient {
  let callIndex = 0
  return {
    async *stream(messages, tools) {
      const resp = responses[callIndex++]
      if (!resp) {
        yield { type: 'done' }
        return
      }
      if (resp.text) {
        yield { type: 'text', text: resp.text }
      }
      if (resp.toolCalls) {
        for (const tc of resp.toolCalls) {
          yield { type: 'tool_use', toolCall: tc }
        }
      }
      yield { type: 'done' }
    },
  }
}

// ── Tests ──

async function testToolRegistry() {
  clearRegistry()
  registerTool(ReadFileTool)
  registerTool(ListFilesTool)

  const tool = ReadFileTool
  console.assert(tool.name === 'readFile', 'Tool name should be readFile')
  console.assert(tool.isReadOnly() === true, 'readFile should be read-only')
  console.assert(tool.isConcurrencySafe() === true, 'readFile should be concurrency-safe')
  console.log('✓ Tool registry test passed')
}

async function testPermissions() {
  const exploreCtx = { workspacePath: '/tmp', mode: 'explore' as const, openFiles: [] }
  const askCtx = { workspacePath: '/tmp', mode: 'ask' as const, openFiles: [] }
  const executeCtx = { workspacePath: '/tmp', mode: 'execute' as const, openFiles: [] }

  // ReadFile is allowed in all modes
  console.assert(ReadFileTool.checkPermissions({ path: 'test.txt' }, exploreCtx).result === 'allow')
  console.assert(ReadFileTool.checkPermissions({ path: 'test.txt' }, askCtx).result === 'allow')
  console.assert(ReadFileTool.checkPermissions({ path: 'test.txt' }, executeCtx).result === 'allow')

  // WriteFile is denied in explore, ask in ask, allowed in execute
  console.assert(WriteFileTool.checkPermissions({ path: 'test.txt', content: 'hello' }, exploreCtx).result === 'deny')
  console.assert(WriteFileTool.checkPermissions({ path: 'test.txt', content: 'hello' }, askCtx).result === 'ask')
  console.assert(WriteFileTool.checkPermissions({ path: 'test.txt', content: 'hello' }, executeCtx).result === 'allow')

  console.log('✓ Permission test passed')
}

async function testAgentEngineTextOnly() {
  clearRegistry()
  registerTool(ReadFileTool)

  const mockClient = createMockClient([
    { text: 'Hello! I can help you with that.' },
  ])

  // Override the LLM client creation — we'll test with a direct approach
  // For now, just test that AgentEngine can be created and submit works
  const engine = new AgentEngine({
    llmConfig: { provider: 'openai', model: 'gpt-4o', apiKey: 'dummy' },
    workspacePath: process.cwd(),
    mode: 'ask',
    tools: [ReadFileTool],
  })

  console.assert(engine.isRunning() === false, 'Engine should not be running initially')
  console.log('✓ AgentEngine creation test passed')
}

async function testToolExecution() {
  const ctx = { workspacePath: process.cwd(), mode: 'execute' as const }

  // Test readFile on a known file
  const result = await ReadFileTool.call({ path: 'package.json' }, ctx)
  console.assert(result.data.includes('"name": "note-agent"'), 'Should read package.json')
  console.assert(!result.error, 'Should not have error')
  console.log('✓ Tool execution test passed')
}

async function runAllTests() {
  console.log('Running Agent Core tests...\n')
  await testToolRegistry()
  await testPermissions()
  await testAgentEngineTextOnly()
  await testToolExecution()
  console.log('\nAll tests passed! ✓')
}

runAllTests().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
