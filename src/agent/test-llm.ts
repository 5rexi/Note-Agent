/**
 * LLM 集成测试 — 验证完整的对话流程
 * 从环境变量读取配置，不硬编码任何 key
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

async function main() {
  const provider = process.env.NA_PROVIDER || 'openai'
  const model = process.env.NA_MODEL || 'gpt-4o-mini'
  const apiKey = process.env.NA_API_KEY
  const baseUrl = process.env.NA_BASE_URL
  const workspace = process.env.NA_WORKSPACE || process.cwd()

  if (!apiKey) {
    console.error('Error: NA_API_KEY not set')
    process.exit(1)
  }

  console.log(`Provider: ${provider}`)
  console.log(`Model: ${model}`)
  console.log(`Base URL: ${baseUrl || '(default)'}`)
  console.log(`Workspace: ${workspace}`)
  console.log('')

  clearRegistry()
  const tools = [
    ReadFileTool,
    ListFilesTool,
    WriteFileTool,
    EditFileTool,
    GlobSearchTool,
    GrepSearchTool,
    ExecuteCommandTool,
  ]
  tools.forEach(registerTool)

  const engine = new AgentEngine({
    llmConfig: { provider, model, apiKey, baseUrl },
    workspacePath: workspace,
    mode: 'ask',
    tools,
  })

  const testInput = 'Read the package.json file and tell me the project name and version.'
  console.log(`User: ${testInput}\n`)
  console.log('Agent:', '')

  let textBuffer = ''
  let toolCallsCount = 0
  let toolResultsCount = 0
  let permissionRequests = 0

  try {
    for await (const event of engine.submit(testInput)) {
      switch (event.type) {
        case 'text':
          textBuffer += event.text
          process.stdout.write(event.text)
          break
        case 'reasoning':
          process.stdout.write(`\n[reasoning: ${event.text}]\n`)
          break
        case 'tool-use-start':
          toolCallsCount++
          console.log(`\n[Tool start: ${event.name}]`)
          break
        case 'tool-use-end':
          toolResultsCount++
          console.log(`[Tool end: ${event.name}] result=${JSON.stringify(event.result).slice(0, 200)}`)
          break
        case 'permission-request':
          permissionRequests++
          console.log(`\n[Permission request: ${event.description}]`)
          console.log('Auto-allowing for test...')
          event.resolve(true)
          break
        case 'error':
          console.log(`\n[ERROR] ${event.message}`)
          break
        case 'done':
          console.log('\n\n--- Done ---')
          break
      }
    }

    console.log('\n=== Summary ===')
    console.log(`Text output length: ${textBuffer.length}`)
    console.log(`Tool calls: ${toolCallsCount}`)
    console.log(`Tool results: ${toolResultsCount}`)
    console.log(`Permission requests: ${permissionRequests}`)
    console.log(`Final messages count: ${engine.getMessages().length}`)

    // Verify the model actually read the file
    if (textBuffer.toLowerCase().includes('note-agent') || textBuffer.toLowerCase().includes('0.2.0')) {
      console.log('\n✓ SUCCESS: Model correctly read and summarized package.json')
    } else if (toolCallsCount > 0) {
      console.log('\n? PARTIAL: Model called tools but may not have mentioned the content')
    } else {
      console.log('\n✗ FAIL: Model did not call readFile tool')
    }

  } catch (err: any) {
    console.error('\nTest failed:', err.message)
    process.exit(1)
  }
}

main()
