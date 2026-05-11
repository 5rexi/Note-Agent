/**
 * System Prompt 构建器
 * 组装所有 section 为最终的 system prompt 字符串
 */
import type { SystemPromptSection, PromptContext, SectionGenerator } from './types'
import { ALL_SECTION_GENERATORS } from './sections'

/**
 * 构建 system prompt
 * 1. 运行所有 section generator
 * 2. 按优先级排序（同名 section 高优先级覆盖低优先级）
 * 3. 用 \n\n 连接
 */
export function buildSystemPrompt(ctx: PromptContext): string {
  const sections = buildSections(ctx, ALL_SECTION_GENERATORS)
  return sections.map((s) => s.content).join('\n\n')
}

/**
 * 构建 section 数组（可用于缓存分析）
 */
export function buildSections(
  ctx: PromptContext,
  generators: SectionGenerator[],
): SystemPromptSection[] {
  const sectionMap = new Map<string, SystemPromptSection>()

  for (const gen of generators) {
    const section = gen(ctx)
    if (!section) continue

    const existing = sectionMap.get(section.name)
    if (!existing || section.priority >= existing.priority) {
      sectionMap.set(section.name, section)
    }
  }

  // Sort by priority descending, then by name for stability
  return Array.from(sectionMap.values()).sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority
    return a.name.localeCompare(b.name)
  })
}

/**
 * 分离静态和动态 section（用于缓存优化）
 */
export function splitSections(sections: SystemPromptSection[]): {
  staticSections: SystemPromptSection[]
  dynamicSections: SystemPromptSection[]
} {
  return {
    staticSections: sections.filter((s) => s.cacheable),
    dynamicSections: sections.filter((s) => !s.cacheable),
  }
}
