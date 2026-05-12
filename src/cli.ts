#!/usr/bin/env node
/**
 * Note Agent CLI — 纯 Node.js，不依赖 Electron
 *
 * Phase 1 升级：配置系统 + 会话持久化 + 斜杠命令
 */
import * as readline from 'readline'
import * as path from 'path'
import {
  AgentEngine,
  MultiProviderEngine,
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
  AddWordParagraphTool,
  DeleteWordParagraphTool,
  ModifyWordFormatTool,
  ModelRouter,
  createDualModelConfig,
  createTriModelConfig,
} from './agent'
import { loadConfig, type AgentConfig } from './agent/config'
import { MCPClient, loadMCPConfig } from './agent/mcp/client'
import { createMCPTool } from './agent/mcp/tool-bridge'
import {
  createSession,
  getMostRecentSession,
  loadMessages,
  saveMessages,
  updateSession,
  listSessions,
  deleteSession,
} from './agent/persistence'
import type { Message } from './agent'

// ── Slash Command System ──

interface SlashCommand {
  name: string
  description: string
  aliases?: string[]
  execute: (args: string, context: CliContext) => Promise<void>
}

interface CliContext {
  config: AgentConfig
  engine: AgentEngine
  rl: readline.Interface
}

const commands = new Map<string, SlashCommand>()

function registerCommand(cmd: SlashCommand) {
  commands.set(cmd.name, cmd)
  if (cmd.aliases) {
    for (const alias of cmd.aliases) commands.set(alias, cmd)
  }
}

// ── Built-in Commands ──

registerCommand({
  name: 'help',
  description: 'Show available commands',
  aliases: ['h'],
  async execute(_args, ctx) {
    console.log('\nAvailable commands:')
    const seen = new Set<string>()
    for (const cmd of commands.values()) {
      if (seen.has(cmd.name)) continue
      seen.add(cmd.name)
      const aliasStr = cmd.aliases?.length ? ` (${cmd.aliases.join(', ')})` : ''
      console.log(`  /${cmd.name}${aliasStr} — ${cmd.description}`)
    }
    console.log('  exit — Quit the CLI\n')
  },
})

registerCommand({
  name: 'clear',
  description: 'Clear conversation history',
  async execute(_args, ctx) {
    ctx.engine.setMessages([])
    const sid = ctx.engine.getSessionId()
    if (sid) {
      const { clearMessages } = await import('./agent/persistence')
      clearMessages(sid)
    }
    console.log('Conversation cleared.\n')
  },
})

registerCommand({
  name: 'history',
  description: 'Show conversation history',
  async execute(_args, ctx) {
    const msgs = ctx.engine.getMessages()
    if (msgs.length === 0) {
      console.log('No messages yet.\n')
      return
    }
    for (const m of msgs) {
      if (m.role === 'user') console.log(`User: ${m.content}`)
      if (m.role === 'assistant') console.log(`Agent: ${m.content}`)
      if (m.role === 'tool') console.log(`Tool [${m.toolName}]: ${JSON.stringify(m.result).slice(0, 200)}`)
      if (m.role === 'system') console.log(`System: ${m.content}`)
    }
    console.log()
  },
})

registerCommand({
  name: 'mode',
  description: 'Switch permission mode: /mode <explore|ask|execute>',
  async execute(args, ctx) {
    const mode = args.trim() as 'explore' | 'ask' | 'execute'
    if (['explore', 'ask', 'execute'].includes(mode)) {
      ctx.engine.setMode(mode)
      ctx.rl.setPrompt(`${mode}> `)
      const sid = ctx.engine.getSessionId()
      if (sid) updateSession(sid, { mode })
      console.log(`Mode switched to ${mode}\n`)
    } else {
      console.log('Invalid mode. Use: explore, ask, execute\n')
    }
  },
})

registerCommand({
  name: 'sessions',
  description: 'List recent sessions',
  async execute(_args, ctx) {
    const sessions = listSessions(10)
    if (sessions.length === 0) {
      console.log('No sessions found.\n')
      return
    }
    console.log('\nRecent sessions:')
    for (const s of sessions) {
      const current = s.id === ctx.engine.getSessionId() ? ' (current)' : ''
      const date = new Date(s.updated_at * 1000).toLocaleString()
      console.log(`  [${s.id.slice(0, 8)}] ${s.title} — ${s.mode} — ${date}${current}`)
    }
    console.log()
  },
})

registerCommand({
  name: 'save',
  description: 'Save session with a name: /save <name>',
  async execute(args, ctx) {
    const title = args.trim() || 'Untitled'
    const sid = ctx.engine.getSessionId()
    if (sid) {
      updateSession(sid, { title })
      console.log(`Session saved as "${title}"\n`)
    }
  },
})

registerCommand({
  name: 'load',
  description: 'Load a session by ID: /load <id>',
  async execute(args, ctx) {
    const id = args.trim()
    if (!id) {
      console.log('Usage: /load <session-id>\n')
      return
    }
    const { getSession } = await import('./agent/persistence')
    const session = getSession(id)
    if (!session) {
      console.log('Session not found.\n')
      return
    }
    const msgs = loadMessages(session.id)
    ctx.engine.setMessages(msgs)
    ctx.engine.setSessionId(session.id)
    ctx.engine.setMode(session.mode as any)
    ctx.rl.setPrompt(`${session.mode}> `)
    console.log(`Loaded session "${session.title}" (${msgs.length} messages)\n`)
  },
})

registerCommand({
  name: 'cost',
  description: 'Show cost and token usage for current session',
  async execute(_args, ctx) {
    const report = ctx.engine.getCostTracker().formatReport()
    console.log('\n' + report + '\n')
  },
})


registerCommand({
  name: 'model',
  description: 'Switch active model: /model <name> or /model list',
  async execute(args, ctx) {
    const arg = args.trim()
    if (!arg || arg === 'list') {
      const current = ctx.engine instanceof MultiProviderEngine
        ? ctx.engine.getCurrentModel()
        : { provider: ctx.config.provider, model: ctx.config.model }
      console.log(`\nCurrent model: ${current.provider}:${current.model}`)
      if (ctx.engine instanceof MultiProviderEngine) {
        const history = ctx.engine.getSwitchHistory()
        if (history.length > 0) {
          console.log('Switch history:')
          for (const h of history) {
            console.log(`  ${h.from.model} → ${h.to.model} (${h.reason})`)
          }
        }
      }
      console.log()
      return
    }

    if (ctx.engine instanceof MultiProviderEngine) {
      try {
        ctx.engine.switchModel(arg)
        console.log(`Switched to model: ${arg}\n`)
      } catch (err: any) {
        console.log(`Error: ${err.message}\n`)
      }
    } else {
      console.log('Multi-model routing not enabled. Set secondaryModel in config.\n')
    }
  },
})

registerCommand({
  name: 'config',
  description: 'Show current configuration',
  async execute(_args, ctx) {
    const c = ctx.config
    console.log('\nCurrent configuration:')
    console.log(`  Provider: ${c.provider}`)
    console.log(`  Model: ${c.model}`)
    console.log(`  Base URL: ${c.baseUrl || '(default)'}`)
    console.log(`  Workspace: ${c.workspace}`)
    console.log(`  Mode: ${c.mode}`)
    console.log(`  Max Rounds: ${c.maxRounds}`)
    console.log(`  Memory: ${c.memory.enabled ? 'on' : 'off'} (autoCompact: ${c.memory.autoCompact ? 'on' : 'off'})`)
    console.log(`  Log Level: ${c.logLevel}`)
    console.log()
  },
})

// ── Main ──

async function main(): Promise<void> {
  const config = loadConfig()

  if (!config.apiKey) {
    console.error('Error: NA_API_KEY is required. Set it via:')
    console.error('  - Environment variable: NA_API_KEY=xxx')
    console.error('  - ~/.note_agent/config.json: { "apiKey": "xxx" }')
    process.exit(1)
  }

  // Register tools
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
    AddWordParagraphTool,
    DeleteWordParagraphTool,
    ModifyWordFormatTool,
  ]
  tools.forEach(registerTool)

  // Set subagent parent config
  setSubagentParentConfig({
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
  })

  // Connect MCP servers
  const mcpConfigs = loadMCPConfig()
  const mcpClients: MCPClient[] = []
  for (const mcpConfig of mcpConfigs) {
    try {
      const client = new MCPClient(mcpConfig)
      await client.connect()
      const mcpTools = await client.listTools()
      for (const mcpTool of mcpTools) {
        registerTool(createMCPTool(client, mcpTool))
      }
      mcpClients.push(client)
      console.log(`[MCP] Connected: ${mcpConfig.name} (${mcpTools.length} tools)`)
    } catch (err: any) {
      console.error(`[MCP] Failed to connect ${mcpConfig.name}: ${err.message}`)
    }
  }

  // Multi-model setup
  let engine: AgentEngine
  let router: ModelRouter | undefined

  // Check if secondary model is configured (for multi-model routing)
  const secondaryModel = (config as any).secondaryModel
  if (secondaryModel && secondaryModel.apiKey) {
    router = new ModelRouter(createDualModelConfig(
      {
        name: config.model,
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      },
      {
        name: secondaryModel.model,
        provider: secondaryModel.provider || config.provider,
        apiKey: secondaryModel.apiKey,
        baseUrl: secondaryModel.baseUrl || config.baseUrl,
      },
    ))
    engine = new MultiProviderEngine({
      llmConfig: {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
      },
      workspacePath: config.workspace,
      mode: config.mode,
      tools,
      maxRounds: config.maxRounds,
      modelRouter: router,
      autoCompact: true,
    })
    console.log(`[Multi-Model] Primary: ${config.model} | Secondary: ${secondaryModel.model}`)
  } else {
    engine = new AgentEngine({
      llmConfig: {
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
      },
      workspacePath: config.workspace,
      mode: config.mode,
      tools,
      maxRounds: config.maxRounds,
      autoCompact: true,
    })
  }

  // Try to restore most recent session
  const recent = getMostRecentSession()
  if (recent && recent.workspace === config.workspace) {
    const msgs = loadMessages(recent.id)
    engine.setMessages(msgs)
    engine.setSessionId(recent.id)
    engine.setMode(recent.mode as any)
    console.log(`\nNote Agent CLI — Restored session: ${recent.title} (${msgs.length} messages)`)
    console.log(`Mode: ${recent.mode} | Workspace: ${config.workspace}\n`)
  } else {
    const session = createSession(config.workspace, config.mode, 'Untitled')
    engine.setSessionId(session.id)
    console.log(`\nNote Agent CLI — New session: ${session.id}`)
    console.log(`Mode: ${config.mode} | Workspace: ${config.workspace}\n`)
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${engine.getMode()}> `,
  })

  const ctx: CliContext = { config, engine, rl }

  console.log('Type /help for commands, or just start chatting.\n')

  rl.prompt()

  rl.on('line', async (line) => {
    const input = line.trim()
    if (!input) {
      rl.prompt()
      return
    }

    // Handle exit
    if (input === 'exit' || input === 'quit') {
      rl.close()
      return
    }

    // Handle slash commands
    if (input.startsWith('/')) {
      const spaceIdx = input.indexOf(' ')
      const cmdName = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx)
      const args = spaceIdx === -1 ? '' : input.slice(spaceIdx + 1)

      const cmd = commands.get(cmdName)
      if (cmd) {
        try {
          await cmd.execute(args, ctx)
        } catch (err: any) {
          console.log(`[Command Error] ${err.message}\n`)
        }
      } else {
        console.log(`Unknown command: /${cmdName}. Type /help for available commands.\n`)
      }
      rl.prompt()
      return
    }

    // Normal chat
    console.log()

    try {
      for await (const event of engine.submit(input)) {
        switch (event.type) {
          case 'text':
            process.stdout.write(event.text)
            break
          case 'reasoning':
            process.stdout.write(`\n[思考] ${event.text}\n`)
            break
          case 'tool-use-start':
            console.log(`\n[Tool] ${event.name}`)
            break
          case 'tool-use-end':
            break
          case 'permission-request':
            process.stdout.write(`\n[Permission] ${event.description}\nAllow? (y/n) `)
            const answer = await new Promise<string>((resolve) => {
              rl.once('line', (line) => resolve(line.trim().toLowerCase()))
            })
            event.resolve(answer === 'y' || answer === 'yes')
            break
          case 'error':
            console.log(`\n[Error] ${event.message}`)
            break
          case 'model-switch':
            console.log(`\n[Model Switch] ${event.provider}:${event.model} — ${event.reason}`)
            break
          case 'done':
            console.log('\n')
            break
        }
      }

      // Auto-save after each turn
      const sid = engine.getSessionId()
      if (sid) {
        saveMessages(sid, engine.getMessages())
      }
    } catch (err: any) {
      console.log(`\n[Error] ${err.message}\n`)
    }

    rl.prompt()
  })

  rl.on('close', () => {
    console.log('\nGoodbye!')
    process.exit(0)
  })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
