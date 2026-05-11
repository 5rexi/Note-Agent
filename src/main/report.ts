import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync, statSync } from 'fs'
import { join } from 'path'
import { Database } from './db'
import type { LLMConfig } from '../agent/types'
import { getSkillList } from '../agent/skills/loader'

/* ── Types ── */

interface SourceItem {
  type: string
  id: string
  title: string
  content?: string
}

interface Category {
  name: string
  sourceIds: string[]
}

interface EnrichedSource extends SourceItem {
  artifacts: string[]
  artifactContents: Map<string, string>
}

/* ── LLM wrapper ── */

/**
 * Simple non-streaming LLM call for report tasks.
 * Uses fetch directly to avoid streaming client quirks (reasoning-only models, etc.)
 */
async function callLLM(config: LLMConfig, systemPrompt: string, userPrompt: string, maxTokens = 4096): Promise<string> {
  const baseUrl = (config.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const isAnthropic = config.provider === 'anthropic'

  if (isAnthropic) {
    const url = `${baseUrl}/messages`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTokens,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Anthropic API ${res.status}: ${err}`)
    }
    const data = await res.json() as any
    return data.content?.map((c: any) => c.text).join('') || ''
  }

  // OpenAI-compatible
  const isOpenAiOfficial = !config.baseUrl || config.baseUrl.includes('api.openai.com')
  const url = isOpenAiOfficial ? 'https://api.openai.com/v1/chat/completions' : `${baseUrl}/chat/completions`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`API ${res.status}: ${err}`)
  }
  const data = await res.json() as any
  return data.choices?.[0]?.message?.content || ''
}

/* ── Artifact extraction ── */

const TEXT_EXTS = new Set([
  'md', 'tex', 'txt', 'py', 'js', 'ts', 'jsx', 'tsx', 'html', 'css',
  'json', 'yml', 'yaml', 'sh', 'bat', 'go', 'rs', 'java', 'cpp', 'c',
  'h', 'hpp', 'ipynb', 'xml', 'sql', 'rb', 'php', 'swift', 'kt',
])

/**
 * Extract file paths from conversation text that look like artifacts
 * (files created, edited, or referenced by tool calls).
 */
function extractArtifacts(content: string): string[] {
  const artifacts = new Set<string>()

  const patterns: RegExp[] = [
    // writeFile('path', ...) or writeFile("path", ...)
    /writeFile\s*\([^)]*['"]([^'"]+)['"]/g,
    // editFile('path', ...)
    /editFile\s*\([^)]*['"]([^'"]+)['"]/g,
    // replaceWordParagraph / replaceWordBlock
    /replaceWord(?:Paragraph|Block)\s*\([^)]*['"]([^'"]+)['"]/g,
    // <write_file>path</write_file>
    /<write_file>([^<]+)<\/write_file>/g,
    // <edit_file>path</edit_file>
    /<edit_file>([^<]+)<\/edit_file>/g,
    // <replace_word_paragraph>path</replace_word_paragraph>
    /<replace_word_paragraph>([^<]+)<\/replace_word_paragraph>/g,
    // wordCreateFromMarkdown({ outputPath: 'path' })
    /outputPath\s*:\s*['"]([^'"]+)['"]/g,
    // latexCompile('path')
    /latexCompile\s*\(\s*['"]([^'"]+)['"]/g,
    // 中文表述 + quoted path
    /(?:写入|保存到|输出到|生成文件|创建文件|完成了).*?['"]([^'"]+\.[^'"]{1,10})['"]/g,
    // File paths with common extensions
    /['"]([^'"]+\.(?:md|tex|docx|txt|py|js|ts|jsx|tsx|html|css|json|yml|yaml|sh|bat|go|rs|java|cpp|c|h|hpp|ipynb|xml|sql|rb|php|swift|kt))['"]/gi,
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(content)) !== null) {
      const p = match[1].trim()
      if (
        p &&
        p.length > 0 &&
        p.length < 120 &&
        !p.includes('\n') &&
        !p.startsWith('http') &&
        !p.startsWith('data:')
      ) {
        artifacts.add(p)
      }
    }
  }

  return [...artifacts]
}

/**
 * Try to read artifact files from workspace. Returns a map of path -> content.
 * Skips binary files and files > 500KB. Truncates content to 8000 chars.
 */
function readArtifactContents(artifactPaths: string[], workspacePath: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const p of artifactPaths) {
    try {
      let fullPath = p
      if (!existsSync(fullPath) && workspacePath) {
        fullPath = join(workspacePath, p)
      }
      if (!existsSync(fullPath)) continue

      const stats = statSync(fullPath)
      if (stats.size > 500 * 1024) continue

      const ext = fullPath.split('.').pop()?.toLowerCase() || ''
      if (!TEXT_EXTS.has(ext)) continue

      const content = readFileSync(fullPath, 'utf-8')
      result.set(p, content.slice(0, 8000))
    } catch {
      // ignore unreadable files
    }
  }
  return result
}

/* ── Internal categorization (invisible to user) ── */

async function categorizeMaterials(
  sources: EnrichedSource[],
  config: LLMConfig,
): Promise<Category[]> {
  const systemPrompt = `你是材料分类助手。请将以下工作材料按主题分成 2-5 个类别。

分类原则：
- 同一领域/主题的材料归为一类
- 如果一个任务生成了多个文件，这些文件和该任务应放在同一类
- 类别名称简短自然（2-8个字），不要编号，不要加序号

返回纯 JSON 数组，不要加 markdown 代码块，不要加任何解释：
[{"name":"类别名称","sourceIds":["task:xxx","file:xxx","desc:xxx"]}]`

  let userPrompt = `以下是需要分类的工作材料：\n\n`
  for (const s of sources) {
    const contentPreview = (s.content || '').slice(0, 600).replace(/\n/g, ' ')
    const artifactHint = s.artifacts.length > 0 ? `\n产出文件：${s.artifacts.join('、')}` : ''
    userPrompt += `---\nID: ${s.id}\n标题: ${s.title}\n类型: ${s.type}${artifactHint}\n内容摘要: ${contentPreview}\n\n`
  }
  userPrompt += `\n请按主题分类，返回 JSON 数组。`

  const raw = await callLLM(config, systemPrompt, userPrompt, 1024)

  // Extract JSON
  let jsonStr = raw.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  }

  try {
    const categories = JSON.parse(jsonStr) as Category[]
    if (Array.isArray(categories) && categories.length > 0) {
      const valid = categories.filter(
        (c) => c.name && Array.isArray(c.sourceIds) && c.sourceIds.length > 0,
      )
      if (valid.length > 0) return valid
    }
  } catch {
    // fall through
  }

  // Fallback: each source becomes its own category
  return sources.map((s) => ({ name: s.title, sourceIds: [s.id] }))
}

/* ── Default generation prompt ── */

const DEFAULT_GENERATE_SYSTEM_PROMPT = `你是一位工作报告代笔助手。你的任务是根据提供的材料，帮用户写出一份自然、真实的工作报告。

⚠️ 角色定位：
- 报告中的"我"永远指代任务执行者（用户），不是你（AI）
- 你只是在帮用户组织语言，不是在描述你帮用户做了什么

核心写作原则：

1.【深度总结产出物】——这是最重要的要求
   不要只说"完成了xxx.md的撰写"，要深入总结里面的核心内容：
   - 法学调研：报告的核心观点、梳理的法律条文、分析的案例、提出的建议
   - 文学分析：分析视角、核心论点、文本解读、比较结论
   - 工程代码：实现了什么功能、技术方案、关键设计、解决了什么问题
   - 文档修改：改了什么、为什么改、改了之后的效果
   - 数据调研：数据来源、分析方法、关键发现、结论
   产出物的内容摘要已经提供给你，请从中提炼实质内容写入报告。

2.【已完成的工作】
   对话中生成的文件、修改的文档、撰写的代码，都是已经完成的工作成果。
   用"完成了..."、"梳理了..."、"分析了..."、"实现了..."来描述。
   不要写成"计划"、"准备"、"后续将"。

3.【融入思考过程】
   如果对话中体现了思考、对比、决策过程，可以自然地融入报告。
   比如"经过对比三种方案，决定采用..."、"在调研中发现...，因此调整了..."

4.【写作风格】
   - 像同事之间口头汇报工作，自然、温和、不做作
   - 中文句子主语可加可不加，加了用"我"，不加也完全没问题
   - 不要堆砌术语和空话，说人话
   - 不要模板腔（不要每段都"首先...其次...最后..."）
   - 篇幅弹性：小工作一两句话，大工作可以多写，该长则长，该短则短

5.【不要提及 AI】
   不要出现"AI建议..."、"助手提供了..."、"系统提示..."等表述。
   工具调用痕迹（如writeFile、replaceWordParagraph等）只是工作过程，不要写入报告。

报告结构：
1. 标题必须是 "# Work Report"
2. 按类别分章节（## 级别），每个类别是一个主题
3. 每个章节把相关任务串起来写，自然地交代做了什么、怎么做的、有什么实质性产出
4. 不要写"未来计划"章节`

/* ── Handlers ── */

export function registerReportHandlers(database: Database) {
  // Get messages for selected tasks (optional time range in unix seconds)
  ipcMain.handle('report:getMessages', (_e, taskIds: string[], startTime?: number, endTime?: number) => {
    return database.getMessagesByTaskIds(taskIds, startTime, endTime)
  })

  // Generate report (internal two-phase: categorize → generate)
  ipcMain.handle('report:generateStream', async (_e, payload: {
    config: LLMConfig
    categorizeConfig?: LLMConfig
    sources: SourceItem[]
    globalDescription?: string
    templateContent?: string
    reportDir: string
    workspacePath?: string
    timeRange?: { start?: string; end?: string }
  }) => {
    const {
      config,
      categorizeConfig,
      sources,
      globalDescription,
      templateContent,
      reportDir,
      workspacePath,
      timeRange,
    } = payload

    /* ── Phase 1: Enrich sources with artifact extraction ── */
    const enrichedSources: EnrichedSource[] = sources.map((s) => ({
      ...s,
      artifacts: extractArtifacts(s.content || ''),
      artifactContents: new Map<string, string>(),
    }))

    // Collect all unique artifact paths and read them
    const allArtifactPaths = new Set<string>()
    for (const s of enrichedSources) {
      for (const p of s.artifacts) allArtifactPaths.add(p)
    }
    const allArtifactContents = workspacePath
      ? readArtifactContents([...allArtifactPaths], workspacePath)
      : new Map<string, string>()

    // Assign contents back to each source
    for (const s of enrichedSources) {
      for (const p of s.artifacts) {
        const c = allArtifactContents.get(p)
        if (c) s.artifactContents.set(p, c)
      }
    }

    /* ── Phase 2: Internal categorization (invisible to user) ── */
    const catConfig = categorizeConfig || config
    let categories: Category[] = []
    try {
      categories = await categorizeMaterials(enrichedSources, catConfig)
    } catch {
      // Fallback: each source as its own category
      categories = enrichedSources.map((s) => ({ name: s.title, sourceIds: [s.id] }))
    }

    /* ── Phase 3: Build generation prompt ── */
    const systemPrompt = templateContent || DEFAULT_GENERATE_SYSTEM_PROMPT

    let userPrompt = ''
    if (timeRange?.start || timeRange?.end) {
      userPrompt += `时间范围：${timeRange.start || '开始'} 至 ${timeRange.end || '现在'}\n\n`
    }
    if (globalDescription) {
      userPrompt += `总体要求：${globalDescription}\n\n`
    }

    userPrompt += `以下工作材料已按主题分类。请仔细阅读每个材料的内容和产出文件，然后按类别撰写工作报告。\n\n`

    for (const cat of categories) {
      userPrompt += `## 类别：${cat.name}\n\n`
      const catSources = cat.sourceIds
        .map((id) => enrichedSources.find((s) => s.id === id))
        .filter(Boolean) as EnrichedSource[]

      for (const s of catSources) {
        const label = s.type === 'task' ? '【任务】' : s.type === 'file' ? '【文件】' : '【补充描述】'
        userPrompt += `### ${label} ${s.title}\n`

        const content = (s.content || '').trim()
        if (content) {
          userPrompt += `对话记录：\n${content}\n`
        }

        if (s.artifacts.length > 0) {
          userPrompt += `\n产出文件：\n`
          for (const [path, fileContent] of s.artifactContents) {
            userPrompt += `- ${path}\n`
            if (fileContent) {
              const preview = fileContent.slice(0, 4000)
              const truncated = fileContent.length > 4000 ? '...（内容已截断）' : ''
              userPrompt += `  内容摘要：\n${preview}${truncated}\n`
            }
          }
          userPrompt += `\n`
        }

        userPrompt += `\n`
      }
    }

    userPrompt += `\n现在开始撰写工作报告。记住：这是用户自己的工作汇报，"我"指用户。深度总结每个产出文件的内容，不要只列文件名。开头直接写 "# Work Report"。`

    /* ── Phase 4: Generate ── */
    const content = await callLLM(config, systemPrompt, userPrompt)

    if (!content.trim()) {
      throw new Error('模型返回了空内容，请检查模型配置或切换模型后重试')
    }

    // Strip accidental intro
    let cleaned = content.trim()
    const introPatterns = [
      /^好的[，,]?.*?(?=#)/s,
      /^当然[，,]?.*?(?=#)/s,
      /^没问题[，,]?.*?(?=#)/s,
      /^.*?(?:我将|我会|我来|作为).*?(?:撰写|写作|生成|整理).*?(?=#)/s,
      /^.*?(?:I will|I am|As a|Here is).*?(?:write|generate|create).*?(?=#)/s,
    ]
    for (const pattern of introPatterns) {
      cleaned = cleaned.replace(pattern, '')
    }
    cleaned = cleaned.trim()

    mkdirSync(reportDir, { recursive: true })
    const dateStr = new Date().toISOString().split('T')[0]
    let fileName = `${dateStr} Report.md`
    let counter = 1
    while (existsSync(join(reportDir, fileName))) {
      fileName = `${dateStr} Report (${counter}).md`
      counter++
    }
    const filePath = join(reportDir, fileName)
    writeFileSync(filePath, cleaned, 'utf-8')

    return { filePath, fileName, content: cleaned }
  })

  // Legacy non-streaming generate (keep for compatibility)
  ipcMain.handle('report:generate', async (_e, payload: any) => {
    const {
      provider,
      model,
      apiKey,
      baseUrl,
      taskIds,
      startTime,
      endTime,
      reportDir,
      styleFilePath,
      styleDescription,
    } = payload

    const allMessages = database.getMessagesByTaskIds(taskIds) as any[]
    const messages = allMessages.filter(
      (m) => m.created_at * 1000 >= startTime && m.created_at * 1000 <= endTime,
    )

    if (messages.length === 0) {
      throw new Error('选定时间区间内没有找到消息记录')
    }

    const conversationText = messages
      .map((m) => {
        const role = m.role === 'user' ? '用户' : 'AI'
        return `### ${role}\n${m.content}`
      })
      .join('\n\n')

    let styleReference = ''
    if (styleFilePath) {
      try { styleReference = readFileSync(styleFilePath, 'utf-8') } catch {}
    }

    let systemPrompt = `你是一个专业的工作报告生成助手。请根据提供的对话记录生成一份 Markdown 格式的工作报告。`
    if (styleReference && styleDescription) {
      systemPrompt += `\n\n风格描述：${styleDescription}\n\n风格参考文件内容：\n${styleReference}`
    } else if (styleReference) {
      systemPrompt += `\n\n请仿照以下文件的风格和排版来生成报告：\n${styleReference}`
    } else if (styleDescription) {
      systemPrompt += `\n\n风格要求：${styleDescription}`
    } else {
      systemPrompt += `\n\n请生成一份结构清晰、内容完整的工作报告，包含工作概述、主要成果、遇到的问题和下一步计划等部分。`
    }

    const isOpenAiOfficial = provider !== 'anthropic' && (!baseUrl || baseUrl.includes('api.openai.com'))
    const url = isOpenAiOfficial ? 'https://api.openai.com/v1/chat/completions' : `${baseUrl}/chat/completions`

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `请根据以下工作对话记录生成工作报告：\n\n${conversationText}` },
        ],
        stream: false,
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`API error ${res.status}: ${errText}`)
    }

    const data = (await res.json()) as any
    const content = data.choices?.[0]?.message?.content || ''

    const dateStr = new Date().toISOString().split('T')[0]
    let fileName = `${dateStr} 周报.md`
    mkdirSync(reportDir, { recursive: true })
    let counter = 1
    let filePath = join(reportDir, fileName)
    while (readdirSync(reportDir).includes(fileName)) {
      fileName = `${dateStr} 周报 (${counter}).md`
      filePath = join(reportDir, fileName)
      counter++
    }

    writeFileSync(filePath, content, 'utf-8')
    return { filePath, fileName, content }
  })

  ipcMain.handle('report:list', (_e, reportDir: string) => {
    try {
      const files = readdirSync(reportDir)
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ name: f, path: join(reportDir, f) }))
        .sort((a, b) => b.name.localeCompare(a.name))
      return files
    } catch {
      return []
    }
  })

  ipcMain.handle('report:delete', (_e, filePath: string) => {
    try {
      unlinkSync(filePath)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // Skill list (for slash command UI)
  ipcMain.handle('skills:list', (_e, workspacePath: string) => {
    return getSkillList(workspacePath)
  })
}
