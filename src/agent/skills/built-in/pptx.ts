/**
 * 内置 PPTX Skill — 隐式注入，不展示在 Available Skills 列表中
 * 基于 Anthropic pptx skill 适配，针对 Note Agent 环境优化
 *
 * 短期：prompt 优化
 * 中期：uv 环境预装 python-pptx，支持更精细的 PPTX 生成（原生 DrawingML 形状、模板复刻）
 */

export function shouldInjectPptxSkill(
  userInput: string,
  openFiles?: string[],
): boolean {
  const keywords = [
    '.pptx', 'pptx', 'ppt', 'powerpoint', 'presentation', 'slide deck', 'slides',
    '.ppt', 'ppt 文件', '演示文稿', '幻灯片', 'deck', 'pitch deck', 'keynote',
  ]
  const lower = userInput.toLowerCase()
  if (keywords.some((kw) => lower.includes(kw))) return true
  if (openFiles) {
    for (const f of openFiles) {
      const l = f.toLowerCase()
      if (l.endsWith('.pptx') || l.endsWith('.ppt')) return true
    }
  }
  return false
}

const BQ = '`'.repeat(3)

/**
 * PPTX Skill 精简摘要 — 上下文紧张时使用
 */
export const PPTX_SKILL_SUMMARY = [
  '## PPTX Guidelines (Summary)',
  '- ALL intermediate work MUST be in `{workspace}/.note_agent/temp/` using relative paths ONLY. NEVER use absolute paths like `/home/...` or `~/.note_agent/`.',
  '- Create: use `pptxgenjs` npm package via executeCommand in `.note_agent/temp/`.',
  '- Edit: unpack with `unzip` in `.note_agent/temp/`, edit XML, repack.',
  '- Convert: use LibreOffice `soffice --headless --convert-to pdf`.',
  '- See full guidelines for detailed API and design rules.',
].join('\n')

export const PPTX_SKILL_CONTENT = [
  '## PPTX Guidelines',
  '',
  '### Reading Content',
  'Convert .pptx to PDF with LibreOffice, then read text or convert to images for visual QA:',
  BQ + 'bash',
  'soffice --headless --convert-to pdf presentation.pptx',
  'pdftoppm -jpeg -r 150 presentation.pdf slide',
  BQ,
  '',
  '### Creating New Presentations',
  'ALL work MUST happen inside `.note_agent/temp/`. Do NOT pollute the workspace root.',
  '',
  '`pptxgenjs` is pre-installed via NODE_PATH. Use it directly — NEVER run `npm init` or `npm install`.',
  '',
  '**Script pattern (save to `{workspace}/.note_agent/temp/gen-ppt.js` using relative paths only):**',
  BQ + 'javascript',
  'const pptxgen = require("pptxgenjs");',
  'let pres = new pptxgen();',
  'pres.layout = "LAYOUT_16x9"; // 10x5.625" (default). Also: 16x10, 4x3, WIDE',
  'let slide = pres.addSlide();',
  'slide.addText("Hello", { x: 0.5, y: 0.5, fontSize: 36, color: "363636" });',
  'pres.writeFile({ fileName: "../../output.pptx" }); // relative to the script directory (workspace root)',
  BQ,
  '',
  '**Execute:**',
  BQ + 'bash',
  'cd .note_agent/temp && node gen-ppt.js',
  BQ,
  '',
  '**Text**: Use arrays with `breakLine: true` for multi-line. Set `margin: 0` to align with shapes.',
  '**Bullets**: Use `bullet: true` option. NEVER unicode "•" (creates double bullets).',
  '**Shapes**: RECTANGLE, OVAL, LINE, ROUNDED_RECTANGLE. Use fresh option objects per call (PptxGenJS mutates them).',
  '**Images**: `slide.addImage({ path: "img.png", x, y, w, h })` or base64 `data:` string. Use `sizing: { type: "contain", w, h }` to preserve ratio.',
  '**Charts**: BAR, LINE, PIE. Set `chartColors`, `chartArea: { fill: { color: "FFFFFF" }, roundedCorners: true }`, hide legend with `showLegend: false`.',
  '**Tables**: `slide.addTable([["H1","H2"],["C1","C2"]], { x, y, w, h, border, fill })`.',
  '**Shadows**: `{ type: "outer", color: "000000", blur: 6, offset: 2, angle: 135, opacity: 0.15 }`. Offset must be non-negative.',
  '**Hex colors**: NEVER use "#" prefix (corrupts file). NEVER use 8-char hex for opacity. Use `opacity` property instead.',
  '',
  '### Template Replication (高级模板复刻)',
  'When user asks to replicate a template (复刻模板):',
  '1. Read the template .pptx file, convert to images, analyze layout / colors / typography / shapes.',
  '2. Extract the color palette (dominant 60-70%, supporting 20-30%, accent 10%).',
  '3. Measure grid: margins, gutters, column widths.',
  '4. Map each slide layout to pptxgenjs shape combinations (rounded rects, lines, image placeholders).',
  '5. Create a master slide (`pres.defineSlideMaster`) with the background, header/footer, and common shapes.',
  '6. Replicate text styles: font family, size, weight, color, line spacing.',
  '7. Replicate image treatment: rounded corners, overlays, masks (use shapes with fill + opacity).',
  '8. QA: generate → convert to images → compare side-by-side with template.',
  '',
  '### Animation Guidelines',
  'pptxgenjs supports basic animations via `slide.addText(..., { transition, animation })`:',
  '- `transition: { type: "fade", speed: "fast" }` for slide transitions.',
  '- `animation: { type: "fade", direction: "in" }` for element entrance.',
  '- Keep animations subtle and consistent. Do not mix more than 2 animation types per slide.',
  '',
  '### Editing Existing Presentations',
  'Unpack → Edit XML → Repack (ALL in .note_agent/temp/):',
  BQ + 'bash',
  'mkdir -p .note_agent/temp/unpacked && unzip presentation.pptx -d .note_agent/temp/unpacked/',
  '# Edit <a:t> text in .note_agent/temp/unpacked/ppt/slides/slide*.xml',
  '# Reorder/delete slides in .note_agent/temp/unpacked/ppt/presentation.xml <p:sldIdLst>',
  'cd .note_agent/temp/unpacked && zip -r ../../output.pptx .',
  BQ,
  '',
  '### Design Rules',
  '',
  '- Pick a bold, topic-specific color palette (one dominant 60-70%, 1-2 supporting, one accent).',
  '- Dark backgrounds for title/conclusion, light for content ("sandwich"). Or commit to dark throughout.',
  '- Every slide needs a visual element — image, chart, icon, or shape. No text-only slides.',
  '- Title 36-44pt bold, body 14-16pt, captions 10-12pt. Left-align body, center only titles.',
  '- 0.5" minimum margins, 0.3-0.5" between blocks.',
  '- Use ONE visual motif consistently: rounded frames, icon circles, thick borders, etc.',
  '- Vary layouts across slides (2-column, icon+text, half-bleed image, stat callouts).',
  '- NEVER accent lines under titles (AI hallmark). Use whitespace or background color instead.',
  '- For data-heavy slides, prefer charts over tables. For comparisons, use side-by-side layouts.',
  '',
  '### QA',
  '1. Generate → Convert to images via soffice+pdftoppm → Visually inspect.',
  '2. Find issues: overlapping elements, text overflow, low contrast, uneven gaps, leftover placeholders.',
  '3. Fix and re-verify. Do not declare success until a full pass reveals no new issues.',
  '',
  '### Future: python-pptx (Roadmap)',
  'When python-pptx is available in the uv environment (mid-term), prefer it for:',
  '- Complex template replication with precise shape positioning (DrawingML).',
  '- Custom animations and transitions not supported by pptxgenjs.',
  '- Direct XML-level manipulation with higher-level Python API.',
  '- Until then, use pptxgenjs for all PPTX operations.',
].join('\n')
