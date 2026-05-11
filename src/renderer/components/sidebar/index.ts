/**
 * Sidebar sub-components.
 *
 * Migration TODO (left for follow-up):
 *  - Extract FileTreeView (~300 lines) — currently inline in Sidebar.tsx.
 *    Needs careful audit of its workspace.id / electronAPI dependencies.
 *  - Extract WorkspaceSelector, TaskList (status-grouped task rendering),
 *    ReportSection. Each carries non-trivial state (context menus,
 *    inline editing) that should move along with the markup.
 *  - Move statusConfig and STATUS_ORDER constants here.
 */
export { DataSourceItem, SkillItem } from './items'
