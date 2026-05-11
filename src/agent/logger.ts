/**
 * 日志系统 — 四级日志输出到 ~/.note_agent/logs/
 */

import { existsSync, mkdirSync, appendFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const LOG_DIR = join(homedir(), '.note_agent', 'logs')

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true })
  }
}

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(LOG_DIR, `${date}.log`)
}

function formatTimestamp(): string {
  return new Date().toISOString()
}

class Logger {
  private level: LogLevel = 'info'
  private enabled: boolean = true

  setLevel(level: LogLevel): void {
    this.level = level
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  private shouldLog(level: LogLevel): boolean {
    return this.enabled && LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level]
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return

    ensureLogDir()

    const metaStr = meta ? ` ${JSON.stringify(meta)}` : ''
    const line = `[${formatTimestamp()}] [${level.toUpperCase()}] ${message}${metaStr}\n`

    // Append to file
    try {
      appendFileSync(getLogFile(), line, 'utf-8')
    } catch {
      // If file write fails, silently drop
    }

    // Also console output for error/warn in CLI mode
    if (level === 'error') {
      console.error(`[${level.toUpperCase()}] ${message}`)
    } else if (level === 'warn') {
      console.warn(`[${level.toUpperCase()}] ${message}`)
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta)
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta)
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta)
  }
}

export const logger = new Logger()
