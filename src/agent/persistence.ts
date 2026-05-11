/**
 * 会话持久化 — SQLite
 *
 * 存储路径: ~/.note_agent/sessions.db
 * 表: sessions, messages, memories
 */
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import type { Message } from './types'

const DB_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', '.note_agent')
const DB_PATH = join(DB_DIR, 'sessions.db')

export interface SessionRecord {
  id: string
  workspace: string
  mode: string
  title: string
  created_at: number
  updated_at: number
}

export interface MessageRecord {
  id: string
  session_id: string
  role: string
  content: string
  tool_calls: string | null
  tool_results: string | null
  created_at: number
}

export interface MemoryRecord {
  id: string
  session_id: string
  type: string
  content: string
  created_at: number
}

// Lazy-load better-sqlite3 to support CLI environments (e.g., Bun without native bindings)
let DatabaseConstructor: any = null
let dbInstance: any = null

function getDb(): any {
  if (dbInstance) return dbInstance

  if (!DatabaseConstructor) {
    try {
      DatabaseConstructor = require('better-sqlite3')
    } catch (err: any) {
      console.warn('[persistence] better-sqlite3 not available:', err.message)
      console.warn('[persistence] Running in memory-only mode (no session persistence)')
      dbInstance = createMemoryDb()
      return dbInstance
    }
  }

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true })
  }

  try {
    dbInstance = new DatabaseConstructor(DB_PATH)
    dbInstance.pragma('journal_mode = WAL')
    initSchema(dbInstance)
    return dbInstance
  } catch (err: any) {
    console.warn('[persistence] Failed to open SQLite database:', err.message)
    console.warn('[persistence] Running in memory-only mode (no session persistence)')
    dbInstance = createMemoryDb()
    return dbInstance
  }
}

// In-memory fallback for CLI / test environments
function createMemoryDb(): any {
  const sessions: SessionRecord[] = []
  const messages: MessageRecord[] = []
  const memories: MemoryRecord[] = []

  return {
    prepare(sql: string) {
      return {
        run(...args: any[]) {
          // no-op for DDL
        },
        get(...args: any[]) {
          return null
        },
        all(...args: any[]) {
          if (sql.includes('FROM sessions')) return sessions
          if (sql.includes('FROM messages')) return messages
          if (sql.includes('FROM memories')) return memories
          return []
        },
      }
    },
    exec(sql: string) {
      // no-op
    },
    pragma() {
      return {}
    },
    close() {},
    // Custom helpers for our API
    getMessages(sessionId: string) {
      return messages.filter((m) => m.session_id === sessionId).sort((a, b) => a.created_at - b.created_at)
    },
    createMessage(data: Partial<MessageRecord>) {
      const record = { id: data.id || String(Date.now()), created_at: Date.now(), ...data } as MessageRecord
      messages.push(record)
      return record
    },
    getSessions() { return sessions },
    createSession(data: Partial<SessionRecord>) {
      const record = { id: data.id || String(Date.now()), created_at: Date.now(), updated_at: Date.now(), ...data } as SessionRecord
      sessions.push(record)
      return record
    },
    updateSession(id: string, data: Partial<SessionRecord>) {
      const s = sessions.find((x) => x.id === id)
      if (s) Object.assign(s, data, { updated_at: Date.now() })
    },
    getMostRecentSession() {
      return sessions.sort((a, b) => b.updated_at - a.updated_at)[0] || null
    },
    clearSessionMessages(sessionId: string) {
      const idx = messages.findIndex((m) => m.session_id === sessionId)
      if (idx >= 0) messages.splice(idx, messages.filter((m) => m.session_id === sessionId).length)
    },
    getSetting(_key: string) { return null },
    setSetting(_key: string, _value: string) {},
  }
}

function initSchema(db: DatabaseConstructor.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      workspace TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'ask',
      title TEXT NOT NULL DEFAULT 'Untitled',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool', 'system')),
      content TEXT NOT NULL,
      tool_calls TEXT,
      tool_results TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
  `)
}

function genId(): string {
  return crypto.randomUUID()
}

// ── Session CRUD ──

export function createSession(workspace: string, mode: string = 'ask', title: string = 'Untitled'): SessionRecord {
  const db = getDb()
  const id = genId()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO sessions (id, workspace, mode, title, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, workspace, mode, title, now, now)

  return { id, workspace, mode, title, created_at: now, updated_at: now }
}

export function getSession(id: string): SessionRecord | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRecord | undefined
}

export function listSessions(limit: number = 20): SessionRecord[] {
  const db = getDb()
  return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(limit) as SessionRecord[]
}

export function updateSession(id: string, data: Partial<Pick<SessionRecord, 'mode' | 'title'>>): void {
  const db = getDb()
  const sets: string[] = []
  const vals: any[] = []

  if (data.mode !== undefined) { sets.push('mode = ?'); vals.push(data.mode) }
  if (data.title !== undefined) { sets.push('title = ?'); vals.push(data.title) }
  sets.push('updated_at = ?')
  vals.push(Math.floor(Date.now() / 1000))
  vals.push(id)

  db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
}

export function deleteSession(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function getMostRecentSession(): SessionRecord | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT 1').get() as SessionRecord | undefined
}

// ── Message CRUD ──

export function saveMessages(sessionId: string, messages: Message[]): void {
  const db = getDb()
  const insert = db.prepare(`
    INSERT OR REPLACE INTO messages (id, session_id, role, content, tool_calls, tool_results, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const now = Math.floor(Date.now() / 1000)

  db.transaction(() => {
    for (const msg of messages) {
      const id = (msg as any).id || genId()
      const role = msg.role
      const content = msg.role === 'user' || msg.role === 'assistant' || msg.role === 'system'
        ? (msg.content as string)
        : ''
      const toolCalls = msg.role === 'assistant' && msg.toolCalls
        ? JSON.stringify(msg.toolCalls)
        : null
      const toolResults = msg.role === 'tool'
        ? JSON.stringify({ toolCallId: msg.toolCallId, toolName: msg.toolName, result: msg.result })
        : null

      insert.run(id, sessionId, role, content, toolCalls, toolResults, now)
    }
  })()

  // Update session timestamp
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(now, sessionId)
}

export function loadMessages(sessionId: string): Message[] {
  const db = getDb()
  const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as MessageRecord[]

  return rows.map((row): Message => {
    switch (row.role) {
      case 'user':
        return { role: 'user', content: row.content }
      case 'assistant':
        return {
          role: 'assistant',
          content: row.content,
          toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
        }
      case 'tool': {
        const parsed = row.tool_results ? JSON.parse(row.tool_results) : {}
        return {
          role: 'tool',
          toolCallId: parsed.toolCallId || 'unknown',
          toolName: parsed.toolName || 'unknown',
          result: parsed.result ?? row.tool_results,
        }
      }
      case 'system':
        return { role: 'system', content: row.content }
      default:
        return { role: 'user', content: row.content }
    }
  })
}

export function clearMessages(sessionId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
}

// ── Memory CRUD ──

export function saveMemory(sessionId: string, type: string, content: string): MemoryRecord {
  const db = getDb()
  const id = genId()
  const now = Math.floor(Date.now() / 1000)

  db.prepare(`
    INSERT INTO memories (id, session_id, type, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, sessionId, type, content, now)

  return { id, session_id: sessionId, type, content, created_at: now }
}

export function loadMemories(sessionId: string, type?: string): MemoryRecord[] {
  const db = getDb()
  if (type) {
    return db.prepare('SELECT * FROM memories WHERE session_id = ? AND type = ? ORDER BY created_at DESC').all(sessionId, type) as MemoryRecord[]
  }
  return db.prepare('SELECT * FROM memories WHERE session_id = ? ORDER BY created_at DESC').all(sessionId) as MemoryRecord[]
}

export function deleteMemory(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM memories WHERE id = ?').run(id)
}
