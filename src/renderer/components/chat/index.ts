/**
 * Chat sub-components extracted from the original 2300-line ChatPanel.tsx.
 *
 * Migration TODO (left for follow-up):
 *  - Extract `AiMessageContent` (history rendering)
 *  - Extract `StreamingCard` (live streaming display + tool calls)
 *  - Extract the input/composer area
 *  - Extract permission queue + question handling
 *
 * Each of those carries non-trivial state and prop-drilling that should
 * be migrated incrementally.
 */
export { mergeAssistantMessages } from './mergeAssistantMessages'
export { FoldableSection } from './FoldableSection'
export { modeConfig, statusConfig, toolIcons, getLastLine, extractMetadata } from './shared'
