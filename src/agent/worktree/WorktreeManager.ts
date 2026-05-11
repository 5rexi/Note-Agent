/**
 * Worktree 隔离 — Git Worktree 管理
 * 参考设计文档第10章
 */
import { execSync } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export class WorktreeManager {
  private basePath: string

  constructor(basePath: string) {
    this.basePath = basePath
  }

  /**
   * 创建隔离的 git worktree
   */
  create(worktreeName: string, branch?: string): string {
    const worktreePath = join(this.basePath, '..', `.worktree-${worktreeName}`)

    try {
      const cmd = branch
        ? `git worktree add "${worktreePath}" -b "${branch}"`
        : `git worktree add "${worktreePath}"`
      execSync(cmd, { cwd: this.basePath, encoding: 'utf-8' })
    } catch {
      // If not a git repo, just create a directory
      if (!existsSync(worktreePath)) {
        mkdirSync(worktreePath, { recursive: true })
      }
    }

    return worktreePath
  }

  /**
   * 移除 worktree
   */
  remove(worktreePath: string): void {
    try {
      execSync(`git worktree remove "${worktreePath}" --force`, {
        cwd: this.basePath,
        encoding: 'utf-8',
      })
    } catch {
      // Not a git worktree, ignore
    }
  }

  /**
   * 列出所有 worktree
   */
  list(): string[] {
    try {
      const output = execSync('git worktree list --porcelain', {
        cwd: this.basePath,
        encoding: 'utf-8',
      })
      return output
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length))
    } catch {
      return []
    }
  }
}
