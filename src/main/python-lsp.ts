/**
 * Python LSP Manager — bridges pyright-langserver to renderer via IPC
 *
 * Each workspace gets one LSPClient instance.
 */
import { join } from 'path'
import { existsSync } from 'fs'
import { LSPClient, type LSPPosition } from '../agent/lsp/client'
import { detectWorkspacePythonEnv, writePyrightConfig } from './python-env'

interface WorkspaceLSP {
  client: LSPClient
  workspacePath: string
}

const workspaces = new Map<string, WorkspaceLSP>()
const diagnosticsUnsubs = new Map<string, () => void>()

function getPyrightLangserverPath(): { command: string; args: string[] } {
  // In packaged Electron app, we need to use Electron's Node.js to run the JS file directly
  // because .bin wrappers don't work inside asar.
  const jsCandidates = [
    join(process.cwd(), 'node_modules', 'pyright', 'dist', 'pyright-langserver.js'),
    join(__dirname, '..', 'node_modules', 'pyright', 'dist', 'pyright-langserver.js'),
    join(__dirname, '..', '..', 'node_modules', 'pyright', 'dist', 'pyright-langserver.js'),
    join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'pyright', 'dist', 'pyright-langserver.js'),
  ]
  for (const c of jsCandidates) {
    if (existsSync(c)) {
      return { command: process.execPath, args: [c] }
    }
  }

  // Development fallback: use .bin wrapper
  const binCandidates = [
    join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'),
    join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'),
  ]
  for (const c of binCandidates) {
    if (existsSync(c)) {
      return { command: c, args: ['--stdio'] }
    }
  }

  // Ultimate fallback
  return { command: 'pyright-langserver', args: ['--stdio'] }
}

export async function startPythonLSP(
  workspacePath: string,
  savedEnvId?: string | null,
  onDiagnostics?: (event: { uri: string; diagnostics: any[] }) => void,
): Promise<boolean> {
  if (workspaces.has(workspacePath)) {
    const existing = workspaces.get(workspacePath)!
    if (existing.client.isInitialized()) return true
    await existing.client.disconnect().catch(() => {})
    workspaces.delete(workspacePath)
    diagnosticsUnsubs.get(workspacePath)?.()
    diagnosticsUnsubs.delete(workspacePath)
  }

  // Determine which Python env to use
  let selectedPythonPath: string | null = null
  if (savedEnvId) {
    const { getSelectedPythonEnv } = await import('./python-env')
    const env = getSelectedPythonEnv(workspacePath, savedEnvId)
    if (env) selectedPythonPath = env.pythonPath
  }

  // Write pyrightconfig.json so pyright knows about the venv
  writePyrightConfig(workspacePath, selectedPythonPath)

  const env = detectWorkspacePythonEnv(workspacePath)
  console.log('[PythonLSP] Starting for workspace:', workspacePath, 'env:', env?.type)

  const { command, args } = getPyrightLangserverPath()
  const rootUri = `file://${workspacePath}`
  const client = new LSPClient(command, args, rootUri)

  try {
    await client.connect()
    workspaces.set(workspacePath, { client, workspacePath })

    if (onDiagnostics) {
      const unsub = onPythonDiagnostics(workspacePath, onDiagnostics)
      diagnosticsUnsubs.set(workspacePath, unsub)
    }

    return true
  } catch (err) {
    console.error('[PythonLSP] Failed to start:', err)
    return false
  }
}

export async function stopPythonLSP(workspacePath: string): Promise<void> {
  const ws = workspaces.get(workspacePath)
  if (!ws) return
  await ws.client.disconnect().catch(() => {})
  workspaces.delete(workspacePath)
  diagnosticsUnsubs.get(workspacePath)?.()
  diagnosticsUnsubs.delete(workspacePath)
}

export async function openPythonDocument(workspacePath: string, uri: string, text: string): Promise<void> {
  const ws = workspaces.get(workspacePath)
  if (!ws) return
  await ws.client.openDocument(uri, 'python', text)
}

export async function changePythonDocument(workspacePath: string, uri: string, text: string): Promise<void> {
  const ws = workspaces.get(workspacePath)
  if (!ws) return
  await ws.client.changeDocument(uri, text)
}

export async function getPythonCompletion(
  workspacePath: string,
  uri: string,
  position: LSPPosition,
): Promise<any[]> {
  const ws = workspaces.get(workspacePath)
  if (!ws) return []
  try {
    return await ws.client.getCompletions(uri, position)
  } catch {
    return []
  }
}

export async function getPythonHover(
  workspacePath: string,
  uri: string,
  position: LSPPosition,
): Promise<{ contents: string } | null> {
  const ws = workspaces.get(workspacePath)
  if (!ws) return null
  try {
    return await ws.client.getHover(uri, position)
  } catch {
    return null
  }
}

export function onPythonDiagnostics(
  workspacePath: string,
  callback: (event: { uri: string; diagnostics: any[] }) => void,
): () => void {
  const ws = workspaces.get(workspacePath)
  if (!ws) return () => {}
  const handler = (event: { uri: string; diagnostics: any[] }) => callback(event)
  ws.client.on('diagnostics', handler)
  return () => ws.client.off('diagnostics', handler)
}
