/**
 * 跨模型 Session 测试
 * 验证：同一个 session 的消息历史在切换模型配置后能否正确传递
 *
 * 用法:
 *   NA_API_KEY=sk-xxx bun run src/agent/test-multi-model-session.ts
 */
import {
  AgentEngine,
  registerTool,
  clearRegistry,
  ReadFileTool,
  ListFilesTool,
} from './index'

async function runSessionTurn(
  engine: AgentEngine,
  userInput: string,
  label: string,
): Promise<string> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`🔄 Turn: ${label}`)
  console.log(`👤 User: ${userInput}`)
  console.log(`🤖 Agent: `)

  let textBuffer = ''
  let toolCalls = 0

  for await (const event of engine.submit(userInput)) {
    switch (event.type) {
      case 'text':
        textBuffer += event.text
        process.stdout.write(event.text)
        break
      case 'tool-use-start':
        toolCalls++
        console.log(`\n[Tool: ${event.name}]`)
        break
      case 'tool-use-end':
        // tool result
        break
      case 'error':
        console.log(`\n[ERROR] ${event.message}`)
        break
      case 'done':
        break
    }
  }

  console.log('\n')
  console.log(`   → Text length: ${textBuffer.length}, Tool calls: ${toolCalls}`)
  console.log(`   → Messages in history: ${engine.getMessages().length}`)
  return textBuffer
}

async function main() {
  const apiKey = process.env.NA_API_KEY
  if (!apiKey) {
    console.error('Error: NA_API_KEY not set')
    process.exit(1)
  }

  const workspace = process.env.NA_WORKSPACE || process.cwd()

  // 模型配置：模拟两个"不同厂商"的端点
  // 实际都用 Kimi，但用不同模型名来验证切换机制
  const configA = {
    provider: 'openai' as const,
    model: 'kimi-latest',
    apiKey,
    baseUrl: 'https://api.moonshot.cn/v1',
  }
  const configB = {
    provider: 'openai' as const,
    model: 'kimi-k1',
    apiKey,
    baseUrl: 'https://api.moonshot.cn/v1',
  }

  console.log('🧪 Multi-Model Session Test')
  console.log(`   Workspace: ${workspace}`)
  console.log(`   Model A:   ${configA.model} (${configA.baseUrl})`)
  console.log(`   Model B:   ${configB.model} (${configB.baseUrl})`)

  clearRegistry()
  const tools = [ReadFileTool, ListFilesTool]
  tools.forEach(registerTool)

  // ── Turn 1: Model A ──
  const engineA = new AgentEngine({
    llmConfig: configA,
    workspacePath: workspace,
    mode: 'ask',
    tools: tools as any,
    maxRounds: 5,
  })

  const replyA = await runSessionTurn(
    engineA,
    '请记住这个暗号：「芝麻开门」。这只是测试，请简短回复。',
    'Turn 1 → Model A (kimi-latest)',
  )

  // ── 模拟切换模型：创建新 Engine，保留消息历史 ──
  // 这正是 agent-bridge.ts 中 configChanged 时的行为
  const messages = engineA.getMessages()
  console.log(`\n📦 保存 ${messages.length} 条消息历史，准备切换模型...`)

  const engineB = new AgentEngine({
    llmConfig: configB,
    workspacePath: workspace,
    mode: 'ask',
    tools: tools as any,
    maxRounds: 5,
  })
  engineB.setMessages(messages)

  // ── Turn 2: Model B（应能看到 Turn 1 的历史）──
  const replyB = await runSessionTurn(
    engineB,
    '我刚才让你记住的暗号是什么？请直接回答。',
    'Turn 2 → Model B (kimi-k1)',
  )

  // ── 验证 ──
  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 验证结果')

  const pass = replyB.toLowerCase().includes('芝麻开门')
  if (pass) {
    console.log('✅ PASS: Model B 正确回忆了 Model A 对话中的暗号')
    console.log('   说明消息历史在模型切换时完整传递')
  } else {
    console.log('⚠️  Model B 的回复中未包含暗号')
    console.log('   回复内容:', replyB.slice(0, 200))
  }

  // ── Turn 3: 切回 Model A ──
  const messages2 = engineB.getMessages()
  console.log(`\n📦 再次保存 ${messages2.length} 条消息历史，切回 Model A...`)

  const engineC = new AgentEngine({
    llmConfig: configA,
    workspacePath: workspace,
    mode: 'ask',
    tools: tools as any,
    maxRounds: 5,
  })
  engineC.setMessages(messages2)

  const replyC = await runSessionTurn(
    engineC,
    '到目前为止我们进行了几次对话？请简短回答。',
    'Turn 3 → Model A (kimi-latest)',
  )

  const pass2 = replyC.includes('2') || replyC.includes('两') || replyC.includes('二')
  if (pass2) {
    console.log('✅ PASS: Model A 正确识别了之前的两轮对话')
  } else {
    console.log('⚠️  Model A 未正确识别对话轮数')
    console.log('   回复内容:', replyC.slice(0, 200))
  }

  console.log(`\n🏁 最终消息历史: ${engineC.getMessages().length} 条`)
  process.exit(pass ? 0 : 1)
}

main().catch((err) => {
  console.error('Test failed:', err)
  process.exit(1)
})
