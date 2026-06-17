/**
 * buildShellCommand — cross-platform spawn resolution
 */
import { describe, it, expect } from 'bun:test'
import { buildShellCommand, isBashLikeShell } from './shell-env'

describe('buildShellCommand', () => {
  it('cmd → cmd.exe /d /s /c', () => {
    const r = buildShellCommand('echo hi', 'C:\\proj', { type: 'cmd' }, 'win32')
    expect(r.file).toBe('cmd.exe')
    expect(r.args).toEqual(['/d', '/s', '/c', 'echo hi'])
    expect(r.bashLike).toBe(false)
  })

  it('legacy "native" normalizes to cmd', () => {
    const r = buildShellCommand('echo hi', 'C:\\proj', { type: 'native' }, 'win32')
    expect(r.file).toBe('cmd.exe')
  })

  it('powershell → -NoProfile -Command', () => {
    const r = buildShellCommand('Get-ChildItem', 'C:\\proj', { type: 'powershell' }, 'win32')
    expect(r.file).toBe('powershell.exe')
    expect(r.args).toEqual(['-NoProfile', '-Command', 'Get-ChildItem'])
    expect(r.bashLike).toBe(false)
  })

  it('gitbash → bash -c, bashLike', () => {
    const r = buildShellCommand('ls -la', 'C:\\proj', { type: 'gitbash', path: 'C:\\Git\\bin\\bash.exe' }, 'win32')
    expect(r.file).toBe('C:\\Git\\bin\\bash.exe')
    expect(r.args).toEqual(['-c', 'ls -la'])
    expect(r.bashLike).toBe(true)
  })

  it('wsl → wsl.exe bash -c with converted cwd', () => {
    const r = buildShellCommand('ls', 'C:\\Users\\me\\proj', { type: 'wsl' }, 'win32')
    expect(r.file).toBe('wsl.exe')
    expect(r.args[0]).toBe('bash')
    expect(r.args[1]).toBe('-c')
    expect(r.args[2]).toContain('/mnt/c/users/me/proj')
    expect(r.args[2]).toContain('&& ls')
  })

  it('unix passes the command as a single -c argument (not re-parsed)', () => {
    const r = buildShellCommand('echo hello world', '/home/me', { type: 'bash', path: '/bin/bash' }, 'linux')
    expect(r.file).toBe('/bin/bash')
    expect(r.args).toEqual(['-c', 'echo hello world'])
    expect(r.bashLike).toBe(true)
  })

  it('falls back to a platform default when no config is given', () => {
    const win = buildShellCommand('x', 'C:\\p', null, 'win32')
    expect(win.file).toBe('cmd.exe')
    const nix = buildShellCommand('x', '/p', null, 'linux')
    // Honors $SHELL or a sane default; in all cases a POSIX shell run with -c.
    expect(nix.file).toMatch(/(bash|zsh|sh)$/)
    expect(nix.args).toEqual(['-c', 'x'])
    expect(nix.bashLike).toBe(true)
  })

  it('isBashLikeShell classifies shells', () => {
    expect(isBashLikeShell('bash')).toBe(true)
    expect(isBashLikeShell('wsl')).toBe(true)
    expect(isBashLikeShell('cmd')).toBe(false)
    expect(isBashLikeShell('powershell')).toBe(false)
  })
})
