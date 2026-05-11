#!/usr/bin/env bun
/**
 * 测试脚本：验证 Word→PPT 任务分解和 subagent 调用
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
  WebFetchTool,
  WebSearchTool,
  TodoWriteTool,
  AskUserQuestionTool,
  SubagentTool,
  setSubagentParentConfig,
  SkillTool,
  CostTool,
  ToolSearchTool,
  FileHistoryTool,
  HttpTool,
  IndexerTool,
  ReplaceWordParagraphTool,
} from './src/agent'

async function main() {
  clearRegistry()
  const tools = [
    ReadFileTool,
    ListFilesTool,
    WriteFileTool,
    EditFileTool,
    GlobSearchTool,
    GrepSearchTool,
    ExecuteCommandTool,
    WebFetchTool,
    WebSearchTool,
    TodoWriteTool,
    AskUserQuestionTool,
    SubagentTool,
    SkillTool,
    new CostTool(),
    new ToolSearchTool(),
    new FileHistoryTool(),
    new HttpTool(),
    new IndexerTool(),
    ReplaceWordParagraphTool,
  ]
  tools.forEach(registerTool)

  setSubagentParentConfig({
    provider: 'openai',
    model: 'MiniMax-M2.7',
    apiKey: process.env.NA_API_KEY || '',
    baseUrl: 'https://api.minimax.chat/v1',
  })

  const engine = new AgentEngine({
    llmConfig: {
      provider: 'openai',
      model: 'MiniMax-M2.7',
      apiKey: process.env.NA_API_KEY || '',
      baseUrl: 'https://api.minimax.chat/v1',
    },
    workspacePath: '.',
    mode: 'execute',
    tools,
    maxRounds: 10,
    autoCompact: true,
    openFiles: ['ref/交通系统应急管控与实践.docx'],
  })

  const userInput = 'make a ppt for this document'
  console.log('=== User Input ===')
  console.log(userInput)
  console.log('')

  try {
    for await (const event of engine.submit(userInput)) {
      console.log('EVENT:', JSON.stringify(event))
    }
    console.log('\n=== DONE ===')
  } catch (err: any) {
    console.error('\n=== ERROR ===')
    console.error(err.message)
    console.error(err.stack)
  }
}

main()
