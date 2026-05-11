import DatabaseConstructor from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

const DB_PATH = join(app.getPath('userData'), 'note-agent.db')

export class Database {
  private db: DatabaseConstructor.Database

  constructor() {
    this.db = new DatabaseConstructor(DB_PATH)
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS task_folders (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_task_folders_workspace ON task_folders(workspace_id);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        folder_id TEXT REFERENCES task_folders(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('temp', 'todo', 'in_progress', 'done', 'archived')),
        editor_state TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
        mode TEXT NOT NULL DEFAULT 'explore' CHECK(mode IN ('explore', 'ask', 'execute')),
        tier_override TEXT,
        model_override TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool')),
        content TEXT NOT NULL,
        tool_calls TEXT,
        tool_results TEXT,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `)

    // Migration: drop deprecated memory_summaries table (was never queried anywhere)
    this.db.exec(`DROP TABLE IF EXISTS memory_summaries`)

    // Migration: add folder_id to existing tasks if column doesn't exist
    const taskColumns = this.db.prepare("PRAGMA table_info(tasks)").all() as any[]
    const hasFolderId = taskColumns.find((c) => c.name === 'folder_id')
    if (!hasFolderId) {
      this.db.prepare('ALTER TABLE tasks ADD COLUMN folder_id TEXT REFERENCES task_folders(id) ON DELETE SET NULL').run()
    }

    // Migration: drop is_default column from task_folders (rebuild table)
    const folderColumns = this.db.prepare("PRAGMA table_info(task_folders)").all() as any[]
    const hasIsDefault = folderColumns.find((c) => c.name === 'is_default')
    if (hasIsDefault) {
      this.db.exec(`
        CREATE TABLE task_folders_new (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        INSERT INTO task_folders_new (id, workspace_id, name, created_at, updated_at)
          SELECT id, workspace_id, name, created_at, updated_at FROM task_folders;
        DROP TABLE task_folders;
        ALTER TABLE task_folders_new RENAME TO task_folders;
      `)
    }

    // Create indexes (safe to run multiple times, but need folder_id to exist)
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)').run()
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_folder ON tasks(folder_id)').run()
    this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)').run()

    // Legacy migration: copy old `tasks.group_name` values into `task_folders` if the column
    // still exists on this database. The column is removed by a later rebuild migration.
    const taskColsForLegacy = this.db.prepare("PRAGMA table_info(tasks)").all() as any[]
    if (taskColsForLegacy.find((c) => c.name === 'group_name')) {
      const hasFolders = this.db.prepare('SELECT COUNT(*) as count FROM task_folders').get() as any
      if (hasFolders.count === 0) {
        const tasksWithGroup = this.db.prepare("SELECT DISTINCT workspace_id, group_name FROM tasks WHERE group_name IS NOT NULL AND group_name != ''").all() as any[]
        for (const row of tasksWithGroup) {
          const folderId = crypto.randomUUID()
          this.db.prepare('INSERT INTO task_folders (id, workspace_id, name) VALUES (?, ?, ?)')
            .run(folderId, row.workspace_id, row.group_name)
          this.db.prepare('UPDATE tasks SET folder_id = ? WHERE workspace_id = ? AND group_name = ?')
            .run(folderId, row.workspace_id, row.group_name)
        }
      }
    }

    // Migration: add model_tier to workspaces if column doesn't exist
    const workspaceColumns = this.db.prepare("PRAGMA table_info(workspaces)").all() as any[]
    const hasModelTier = workspaceColumns.find((c) => c.name === 'model_tier')
    if (!hasModelTier) {
      this.db.prepare("ALTER TABLE workspaces ADD COLUMN model_tier TEXT CHECK(model_tier IN ('fast', 'balanced', 'strong'))").run()
    }

    // Migration: add tier_override and model_override to sessions
    const sessionColumns = this.db.prepare("PRAGMA table_info(sessions)").all() as any[]
    const hasTierOverride = sessionColumns.find((c) => c.name === 'tier_override')
    const hasModelOverride = sessionColumns.find((c) => c.name === 'model_override')
    if (!hasTierOverride) {
      this.db.prepare('ALTER TABLE sessions ADD COLUMN tier_override TEXT').run()
    }
    if (!hasModelOverride) {
      this.db.prepare('ALTER TABLE sessions ADD COLUMN model_override TEXT').run()
    }

    // Migration: rebuild tasks table — add 'temp' status, drop deprecated group_name column.
    // Clean up any leftover from a failed previous migration first.
    try { this.db.prepare("DROP TABLE IF EXISTS tasks_new").run() } catch {}

    const tasksSql = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'`).get() as any
    const tasksNeedRebuild = tasksSql && (!tasksSql.sql.includes("'temp'") || tasksSql.sql.includes('group_name'))
    if (tasksNeedRebuild) {
      this.db.prepare("UPDATE tasks SET status = 'todo' WHERE status IS NULL").run()
      this.db.exec(`
        CREATE TABLE tasks_new (
          id TEXT PRIMARY KEY,
          workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
          folder_id TEXT REFERENCES task_folders(id) ON DELETE SET NULL,
          title TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('temp', 'todo', 'in_progress', 'done', 'archived')),
          editor_state TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        INSERT INTO tasks_new (id, workspace_id, folder_id, title, status, editor_state, created_at, updated_at)
          SELECT id, workspace_id, folder_id, title, status, editor_state, created_at, updated_at FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_new RENAME TO tasks;
      `)
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id)').run()
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_folder ON tasks(folder_id)').run()
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)').run()
    }

    // Migration: rebuild sessions table to drop deprecated `model` column
    // (superseded by tier_override / model_override).
    try { this.db.prepare("DROP TABLE IF EXISTS sessions_new").run() } catch {}
    const sessionCols = this.db.prepare("PRAGMA table_info(sessions)").all() as any[]
    if (sessionCols.find((c) => c.name === 'model')) {
      this.db.exec(`
        CREATE TABLE sessions_new (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          mode TEXT NOT NULL DEFAULT 'explore' CHECK(mode IN ('explore', 'ask', 'execute')),
          tier_override TEXT,
          model_override TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        INSERT INTO sessions_new (id, task_id, mode, tier_override, model_override, created_at)
          SELECT id, task_id, mode, tier_override, model_override, created_at FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
      `)
    }

    // Migration: rebuild sessions table to add 'research' mode
    try { this.db.prepare("DROP TABLE IF EXISTS sessions_new").run() } catch {}
    const sessionSql = this.db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'`).get() as any
    const needsResearchMode = sessionSql && !sessionSql.sql.includes("'research'")
    if (needsResearchMode) {
      this.db.exec(`
        CREATE TABLE sessions_new (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
          mode TEXT NOT NULL DEFAULT 'explore' CHECK(mode IN ('explore', 'ask', 'execute', 'research')),
          tier_override TEXT,
          model_override TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        INSERT INTO sessions_new (id, task_id, mode, tier_override, model_override, created_at)
          SELECT id, task_id, mode, tier_override, model_override, created_at FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
      `)
    }

    // ── Knowledge Base Schema ──
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        last_indexed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_id INTEGER NOT NULL REFERENCES knowledge_folders(id) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_kc_folder ON knowledge_chunks(folder_id);
      CREATE INDEX IF NOT EXISTS idx_kc_file ON knowledge_chunks(file_path);
    `)

    // FTS5 virtual table for keyword search
    const ftsExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_chunks_fts'").get()
    if (!ftsExists) {
      this.db.exec(`
        CREATE VIRTUAL TABLE knowledge_chunks_fts USING fts5(
          content,
          content='knowledge_chunks',
          content_rowid='id'
        );
      `)
    }

    // Note: No default folders. Tasks without folder_id are shown in status groups.
  }

  // ── Workspaces ──
  getWorkspaces() {
    return this.db.prepare('SELECT * FROM workspaces ORDER BY created_at DESC').all()
  }

  createWorkspace(data: { id: string; name: string; path: string }) {
    this.db.prepare('INSERT INTO workspaces (id, name, path) VALUES (?, ?, ?)').run(data.id, data.name, data.path)
    return data
  }

  updateWorkspace(id: string, data: Partial<{ name: string; path: string; model_tier?: string | null }>) {
    const sets: string[] = []
    const vals: any[] = []
    if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name) }
    if (data.path !== undefined) { sets.push('path = ?'); vals.push(data.path) }
    if (data.model_tier !== undefined) { sets.push('model_tier = ?'); vals.push(data.model_tier) }
    sets.push('updated_at = unixepoch()')
    vals.push(id)
    this.db.prepare(`UPDATE workspaces SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }

  deleteWorkspace(id: string) {
    this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
  }

  // ── Task Folders ──
  getTaskFolders(workspaceId: string) {
    return this.db.prepare('SELECT * FROM task_folders WHERE workspace_id = ? ORDER BY created_at DESC').all(workspaceId)
  }

  createTaskFolder(data: { id: string; workspace_id: string; name: string }) {
    this.db.prepare('INSERT INTO task_folders (id, workspace_id, name) VALUES (?, ?, ?)')
      .run(data.id, data.workspace_id, data.name)
    return data
  }

  updateTaskFolder(id: string, data: Partial<{ name: string }>) {
    const sets: string[] = []
    const vals: any[] = []
    if (data.name !== undefined) { sets.push('name = ?'); vals.push(data.name) }
    sets.push('updated_at = unixepoch()')
    vals.push(id)
    this.db.prepare(`UPDATE task_folders SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }

  deleteTaskFolder(id: string) {
    this.db.prepare('DELETE FROM task_folders WHERE id = ?').run(id)
  }

  // ── Tasks ──
  getTasks() {
    return this.db.prepare(`
      SELECT t.*, w.name as workspace_name, f.name as folder_name
      FROM tasks t
      JOIN workspaces w ON t.workspace_id = w.id
      LEFT JOIN task_folders f ON t.folder_id = f.id
      ORDER BY t.created_at DESC
    `).all()
  }

  getTasksByWorkspace(workspaceId: string) {
    return this.db.prepare(`
      SELECT t.*, f.name as folder_name
      FROM tasks t
      LEFT JOIN task_folders f ON t.folder_id = f.id
      WHERE t.workspace_id = ?
      ORDER BY t.created_at DESC
    `).all(workspaceId)
  }

  createTask(data: { id: string; workspace_id: string; folder_id?: string; title: string; status?: string; editor_state?: string }) {
    this.db.prepare(`
      INSERT INTO tasks (id, workspace_id, folder_id, title, status, editor_state)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.id, data.workspace_id, data.folder_id ?? null, data.title, data.status ?? 'todo', data.editor_state ?? null)
    return { ...data, folder_id: data.folder_id ?? null, status: data.status ?? 'todo', editor_state: data.editor_state ?? null }
  }

  updateTask(id: string, data: Partial<{ title: string; status: string; folder_id: string; editor_state: string }>) {
    const sets: string[] = []
    const vals: any[] = []
    if (data.title !== undefined) { sets.push('title = ?'); vals.push(data.title) }
    if (data.status !== undefined) { sets.push('status = ?'); vals.push(data.status) }
    if (data.folder_id !== undefined) { sets.push('folder_id = ?'); vals.push(data.folder_id) }
    if (data.editor_state !== undefined) { sets.push('editor_state = ?'); vals.push(data.editor_state) }
    sets.push('updated_at = unixepoch()')
    vals.push(id)
    this.db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }

  deleteTask(id: string) {
    this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  // ── Sessions ──
  getSessionByTask(taskId: string) {
    return this.db.prepare('SELECT * FROM sessions WHERE task_id = ?').get(taskId)
  }

  createSession(data: { id: string; task_id: string; mode?: string }) {
    this.db.prepare('INSERT INTO sessions (id, task_id, mode) VALUES (?, ?, ?)')
      .run(data.id, data.task_id, data.mode ?? 'explore')
    return data
  }

  updateSessionMode(id: string, mode: string) {
    this.db.prepare('UPDATE sessions SET mode = ? WHERE id = ?').run(mode, id)
  }

  updateSessionOverrides(id: string, tierOverride?: string | null, modelOverride?: string | null) {
    this.db.prepare('UPDATE sessions SET tier_override = ?, model_override = ? WHERE id = ?')
      .run(tierOverride ?? null, modelOverride ?? null, id)
  }

  // ── Messages ──
  getMessages(sessionId: string) {
    return this.db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId)
  }

  createMessage(data: { id: string; session_id: string; role: string; content: string; tool_calls?: string; tool_results?: string }) {
    this.db.prepare(`
      INSERT INTO messages (id, session_id, role, content, tool_calls, tool_results)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(data.id, data.session_id, data.role, data.content, data.tool_calls ?? null, data.tool_results ?? null)
    return data
  }

  // ── Messages by tasks (for report generation) ──
  getMessagesByTaskIds(taskIds: string[], startTime?: number, endTime?: number) {
    if (taskIds.length === 0) return []
    const placeholders = taskIds.map(() => '?').join(',')
    let sql = `
      SELECT m.*, s.task_id, s.mode
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      WHERE s.task_id IN (${placeholders})
    `
    const params: any[] = [...taskIds]
    if (startTime !== undefined) {
      sql += ' AND m.created_at >= ?'
      params.push(startTime)
    }
    if (endTime !== undefined) {
      sql += ' AND m.created_at <= ?'
      params.push(endTime)
    }
    sql += ' ORDER BY s.task_id, m.created_at ASC'
    return this.db.prepare(sql).all(...params)
  }

  // ── Settings ──
  getSetting(key: string) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as any
    return row?.value ?? null
  }

  setSetting(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value)
  }

  clearSessionMessages(sessionId: string) {
    this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
  }

  // ── File History (multi-step undo) ──
  initFileHistory() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS file_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_file_history_path ON file_history(file_path);
      CREATE INDEX IF NOT EXISTS idx_file_history_path_version ON file_history(file_path, version);
    `)
  }

  pushFileHistory(filePath: string, content: string) {
    this.initFileHistory()
    // Get current max version
    const row = this.db.prepare('SELECT COALESCE(MAX(version), 0) as maxv FROM file_history WHERE file_path = ?').get(filePath) as any
    const nextVersion = (row?.maxv ?? 0) + 1
    this.db.prepare('INSERT INTO file_history (file_path, version, content) VALUES (?, ?, ?)').run(filePath, nextVersion, content)
    // Keep only the latest 10 versions per file
    this.db.prepare(`
      DELETE FROM file_history WHERE id IN (
        SELECT id FROM file_history WHERE file_path = ? ORDER BY version DESC LIMIT -1 OFFSET 10
      )
    `).run(filePath)
    return nextVersion
  }

  popFileHistory(filePath: string): { content: string; version: number } | null {
    this.initFileHistory()
    const row = this.db.prepare('SELECT content, version FROM file_history WHERE file_path = ? ORDER BY version DESC LIMIT 1').get(filePath) as any
    if (!row) return null
    this.db.prepare('DELETE FROM file_history WHERE file_path = ? AND version = ?').run(filePath, row.version)
    return { content: row.content, version: row.version }
  }

  peekFileHistory(filePath: string): { content: string; version: number } | null {
    this.initFileHistory()
    const row = this.db.prepare('SELECT content, version FROM file_history WHERE file_path = ? ORDER BY version DESC LIMIT 1').get(filePath) as any
    if (!row) return null
    return { content: row.content, version: row.version }
  }

  getFileHistoryCount(filePath: string): number {
    this.initFileHistory()
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM file_history WHERE file_path = ?').get(filePath) as any
    return row?.cnt ?? 0
  }

  clearFileHistory(filePath: string) {
    this.initFileHistory()
    this.db.prepare('DELETE FROM file_history WHERE file_path = ?').run(filePath)
  }

  // ── Session Snapshots (for undo-all) ──
  initSessionSnapshots() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_file_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX IF NOT EXISTS idx_session_snapshots_session ON session_file_snapshots(session_id);
      CREATE INDEX IF NOT EXISTS idx_session_snapshots_file ON session_file_snapshots(session_id, file_path);
    `)
  }

  saveSessionSnapshot(sessionId: string, filePath: string, content: string) {
    this.initSessionSnapshots()
    this.db.prepare('INSERT INTO session_file_snapshots (session_id, file_path, content) VALUES (?, ?, ?)').run(sessionId, filePath, content)
  }

  getSessionSnapshots(sessionId: string): Array<{ file_path: string; content: string }> {
    this.initSessionSnapshots()
    return this.db.prepare('SELECT file_path, content FROM session_file_snapshots WHERE session_id = ?').all(sessionId) as any[]
  }

  clearSessionSnapshots(sessionId: string) {
    this.initSessionSnapshots()
    this.db.prepare('DELETE FROM session_file_snapshots WHERE session_id = ?').run(sessionId)
  }

  // ── Knowledge Base ──
  addKnowledgeFolder(path: string, name: string) {
    const result = this.db.prepare('INSERT INTO knowledge_folders (path, name) VALUES (?, ?)').run(path, name)
    return { id: Number(result.lastInsertRowid), path, name }
  }

  removeKnowledgeFolder(id: number) {
    this.db.prepare('DELETE FROM knowledge_folders WHERE id = ?').run(id)
  }

  listKnowledgeFolders() {
    return this.db.prepare('SELECT * FROM knowledge_folders ORDER BY created_at DESC').all() as any[]
  }

  updateKnowledgeFolderIndexedAt(id: number) {
    this.db.prepare('UPDATE knowledge_folders SET last_indexed_at = unixepoch() WHERE id = ?').run(id)
  }

  clearKnowledgeChunks(folderId: number) {
    this.db.prepare('DELETE FROM knowledge_chunks WHERE folder_id = ?').run(folderId)
  }

  addKnowledgeChunk(folderId: number, filePath: string, content: string, chunkIndex: number, embedding?: number[]) {
    const result = this.db.prepare(`
      INSERT INTO knowledge_chunks (folder_id, file_path, content, embedding, chunk_index)
      VALUES (?, ?, ?, ?, ?)
    `).run(folderId, filePath, content, embedding ? JSON.stringify(embedding) : null, chunkIndex)
    const id = Number(result.lastInsertRowid)
    // Sync FTS5 index
    this.db.prepare(`INSERT INTO knowledge_chunks_fts(rowid, content) VALUES (?, ?)`).run(id, content)
    return id
  }

  searchKnowledgeBaseKeyword(query: string, folderIds?: number[], limit: number = 10) {
    const folderFilter = folderIds && folderIds.length > 0
      ? `AND k.folder_id IN (${folderIds.map(() => '?').join(',')})`
      : ''
    const sql = `
      SELECT k.id, k.folder_id, k.file_path, k.content, k.chunk_index,
             rank as score
      FROM knowledge_chunks_fts f
      JOIN knowledge_chunks k ON k.id = f.rowid
      WHERE knowledge_chunks_fts MATCH ? ${folderFilter}
      ORDER BY rank
      LIMIT ?
    `
    const params = folderFilter ? [query, ...folderIds!, limit] : [query, limit]
    return this.db.prepare(sql).all(...params) as any[]
  }

  getAllKnowledgeChunks(folderIds?: number[]) {
    const folderFilter = folderIds && folderIds.length > 0
      ? `WHERE folder_id IN (${folderIds.map(() => '?').join(',')})`
      : ''
    const sql = `SELECT * FROM knowledge_chunks ${folderFilter}`
    const params = folderFilter ? folderIds! : []
    return this.db.prepare(sql).all(...params) as any[]
  }
}
