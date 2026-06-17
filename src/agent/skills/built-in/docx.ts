/**
 * 内置 DOCX Skill — 隐式注入，不展示在 Available Skills 列表中
 * 基于 Anthropic docx skill 适配，针对 Note Agent 环境优化
 */

/**
 * 检测是否需要注入 docx skill
 */
export function shouldInjectDocxSkill(
  userInput: string,
  openFiles?: string[],
): boolean {
  const docxKeywords = [
    '.docx', 'docx', 'word document', 'word 文件', 'word file',
    '.doc', 'doc 文件',
    'microsoft word',
    'create a document', '生成文档', '创建文档',
    'letter', 'memo', 'report', 'template',
    'table of contents', '页眉', '页脚', '目录',
    'track changes', '修订', '批注', 'comment',
  ]

  const lowerInput = userInput.toLowerCase()
  if (docxKeywords.some((kw) => lowerInput.includes(kw.toLowerCase()))) {
    return true
  }

  if (openFiles) {
    for (const f of openFiles) {
      const lower = f.toLowerCase()
      if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
        return true
      }
    }
  }

  return false
}

/**
 * DOCX Skill 精简摘要 — 上下文紧张时使用
 */
export const DOCX_SKILL_SUMMARY = [
  '## DOCX Guidelines (Summary)',
  '- Read / summarize: **readFile** returns plain text in one step and is fine for SMALL docs. For LARGE docs (long manuscripts) readFile TRUNCATES — switch to **wordView** `outline` (heading map, very cheap) then `text` to read by section. Never use **grepSearch** on a .docx (it is a binary zip → garbled output); use wordView outline instead.',
  '- Create: use the **createDocument** tool (Markdown → .docx in one call). Do NOT write docx-js scripts.',
  '- Edit: **wordView** outline → **wordQuery** to find targets → **wordSet**/**wordBatchSet**/**wordAdd**/**wordRemove** (preserve formatting). **wordRaw** is the XML escape hatch.',
  '- Fill a template: **wordFillTemplate**.',
  '- ALWAYS build file paths with the **pathJoin** tool — never string concatenation.',
].join('\n')

/**
 * DOCX Skill 内容 — 适配 Note Agent 环境
 *
 * The dedicated Word tools (createDocument + the path-based word* tools) replace
 * the old "hand-write a docx-js script" workflow. Scripts are a last resort only.
 */
export const DOCX_SKILL_CONTENT = [
  '## DOCX Document Guidelines',
  '',
  'A .docx file is a ZIP of XML. Use the dedicated Word tools below — do NOT hand-write Node/docx-js scripts for normal work.',
  '',
  '### Read content (and summarizing)',
  '- SMALL doc: call **readFile** — it returns the full plain text in one step.',
  '- LARGE doc (long manuscript, many pages): **readFile** will TRUNCATE. Instead call **wordView** `outline` to get the heading hierarchy (cheap), then **wordView** `text` to read section by section. Do NOT run **grepSearch** on a .docx — it is a compressed binary archive and returns garbled bytes; use the wordView outline to locate sections.',
  '',
  '### Create a new document → `createDocument`',
  '- Use the **createDocument** tool to generate a .docx from Markdown in a single call. This is the right tool for reports, theses, letters, proposals.',
  '- Short content (< 2KB): pass it in `content`. Long content: **writeFile** the Markdown to a file first, then call createDocument with `sourcePath`.',
  '- Supports headings, bold, super/subscript, tables, and formulas — inline `$E=mc^2$` and block `$$ … $$` are auto-converted to Word OMML math.',
  '- Do NOT use executeCommand + npm scripts for document creation.',
  '',
  '### Edit an existing document → path-based Word tools (preserve formatting)',
  'Follow this order:',
  '1. **wordView** `outline` — heading hierarchy + element paths (most token-efficient; also `text` / `full` views).',
  '2. **wordQuery** — find target elements with CSS-like selectors; returns their paths.',
  '3. **wordGet** — inspect the element at a path before changing it.',
  '4. **wordSet** — set properties at one path. **wordBatchSet** — change many elements in ONE call (bulk formatting; far cheaper than repeated wordSet).',
  '5. **wordAdd** / **wordRemove** — add or remove elements at a path. To append a paragraph, use `parentPath="/body"`.',
  '6. **wordRaw** — raw XML get/set; the escape hatch when wordSet/wordAdd cannot express a change.',
  '',
  '### Fill a template → `wordFillTemplate`',
  '- Drop Markdown content into an existing .docx template in one shot.',
  '',
  '### Path rule',
  '- ALWAYS use the **pathJoin** tool to build file paths. NEVER concatenate strings with `+` (it produces broken paths like `.note_agenttemp`).',
  '',
  '### Advanced escape hatch (rare)',
  '- Only if `createDocument` cannot express a required layout, you may write a `docx`-js script as a last resort. Keep ALL intermediate files inside `.note_agent/temp/` and run it with executeCommand. This is not the default path.',
].join('\n')
