import { contextBridge, ipcRenderer } from 'electron'
import type { AgentEvent } from '../agent'

export interface ElectronAPI {
  // Workspaces
  getWorkspaces: () => Promise<any[]>
  createWorkspace: (name: string, path: string) => Promise<any>
  updateWorkspace: (id: string, data: any) => Promise<void>
  updateWorkspaceModelTier: (id: string, tier: string | null) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>

  // Task Folders
  getTaskFolders: (workspaceId?: string) => Promise<any[]>
  createTaskFolder: (data: any) => Promise<any>
  updateTaskFolder: (id: string, data: any) => Promise<void>
  deleteTaskFolder: (id: string) => Promise<void>

  // Tasks
  getTasks: () => Promise<any[]>
  getTasksByWorkspace: (workspaceId: string) => Promise<any[]>
  createTask: (title: string, workspaceId: string, folderId?: string) => Promise<any>
  updateTask: (id: string, title?: string, editorState?: string, status?: string, folderId?: string) => Promise<void>
  deleteTask: (id: string) => Promise<void>

  // Sessions
  getSessionByTask: (taskId: string) => Promise<any | null>
  createSession: (taskId: string, title: string, mode: string) => Promise<any>
  updateSessionMode: (id: string, mode: string) => Promise<void>
  updateSessionOverrides: (id: string, tier?: string | null, model?: string | null) => Promise<void>

  // Messages
  getMessages: (sessionId: string) => Promise<any[]>
  listMessagesByTasks: (taskIds: string[]) => Promise<any[]>
  createMessage: (sessionId: string, role: string, content: string) => Promise<any>
  clearSessionMessages: (sessionId: string) => Promise<void>
  getReportMessages: (taskIds: string[], startTime?: number, endTime?: number) => Promise<any[]>
  generateReport: (payload: any) => Promise<{ filePath: string; fileName: string; content: string }>
  generateReportStream: (payload: any) => Promise<{ filePath: string; fileName: string; content: string }>
  listReports: (reportDir: string) => Promise<{ name: string; path: string }[]>
  deleteReport: (filePath: string) => Promise<{ success: boolean; error?: string }>
  listSkills: (workspacePath: string) => Promise<Array<{ id: string; name: string; description: string; alwaysInject: boolean }>>

  // Settings
  getSetting: (key: string) => Promise<any>
  setSetting: (key: string, value: any) => Promise<void>

  // File system
  readFile: (path: string) => Promise<{ content: string; error?: string }>
  writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>
  readFileBase64: (path: string) => Promise<{ data: string; error?: string }>
  writeFileBase64: (path: string, data: string) => Promise<{ success: boolean; error?: string }>
  undoWriteFile: (path: string) => Promise<{ success: boolean; error?: string; version?: number }>
  snapshotBackup: (path: string) => Promise<{ success: boolean; error?: string }>
  getUndoCount: (path: string) => Promise<{ count: number }>
  listFiles: (dir: string) => Promise<{ entries: any[]; error?: string }>
  latexCompile: (path: string) => Promise<{ pdfPath?: string; error?: string; log?: string }>
  latexCheckEnv: () => Promise<{ found: Array<{ name: string; path: string }>; bundled: string | null; error?: string }>
  latexVerifyCompiler: (path: string) => Promise<{ ok: boolean; version?: string; error?: string }>
  latexDownloadTectonic: () => Promise<{ taskId: string | null; error?: string }>
  latexGetBundledPath: () => Promise<{ path: string | null }>
  latexRemoveBundled: () => Promise<{ success: boolean; error?: string }>
  officeConvertToPdf: (path: string) => Promise<{ pdfPath?: string; error?: string }>
  wordCheckEnv: () => Promise<{ found: Array<{ name: string; path: string }>; bundled: string | null; error?: string }>
  wordVerifySoffice: (path: string) => Promise<{ ok: boolean; version?: string; error?: string }>
  wordGetBundledPath: () => Promise<{ path: string | null }>
  wordExtractText: (path: string) => Promise<{ text?: string; markdown?: string; error?: string }>
  wordUnpack: (path: string, outputDir?: string) => Promise<{ success: boolean; error?: string; files: string[]; outputDir?: string }>
  wordPack: (inputDir: string, outputPath?: string) => Promise<{ success: boolean; error?: string }>
  wordConvertDocToDocx: (path: string) => Promise<{ outputPath?: string; error?: string }>
  wordCreateFromMarkdown: (payload: { outputPath: string; title?: string; content: string }) => Promise<{ success: boolean; path?: string; error?: string }>
  wordAnalyzeStructure: (path: string) => Promise<{ items: Array<{ type: string; summary: string; fullText: string; style?: string; lineStart: number; lineEnd: number }>; error?: string }>
  wordConvertToIndexedHtml: (path: string) => Promise<{ html: string; error?: string }>
  wordOpenExternally: (path: string) => Promise<{ success: boolean; error?: string }>
  wordWatchExternal: (path: string) => Promise<{ success: boolean }>
  wordUnwatchExternal: (path: string) => Promise<{ success: boolean }>
  wordGetPandocInfo: () => Promise<{ installed: boolean; path: string | null; version: string | null }>
  wordVerifyPandoc: (path: string) => Promise<{ ok: boolean; version: string | null; error?: string }>
  pandocDownload: () => Promise<{ taskId: string | null; error?: string }>
  pandocGetBundledPath: () => Promise<{ path: string | null }>
  pandocRemoveBundled: () => Promise<{ success: boolean; error?: string }>
  onWordExternalChanged: (callback: (filePath: string) => void) => () => void
  wordReplaceParagraph: (path: string, paragraphIndex: number, newText: string) => Promise<{ success: boolean; error?: string }>
  wordAddParagraph: (path: string, paragraphIndex: number, text: string) => Promise<{ success: boolean; error?: string }>
  wordDeleteParagraph: (path: string, paragraphIndex: number) => Promise<{ success: boolean; error?: string }>
  wordModifyFormat: (path: string, target: { type: 'paragraph'; paragraphIndex: number } | { type: 'global' }, changes: Array<{ property: string; value: any }>) => Promise<{ success: boolean; error?: string }>
  wordUndoChange: (path: string) => Promise<{ success: boolean; error?: string }>
  pdfGetCachedPath: (path: string) => Promise<{ pdfPath: string | null; isFresh: boolean }>
  pdfInvalidateCache: (path: string) => Promise<{ success: boolean }>
  taskGet: (id: string) => Promise<any | null>
  onTaskProgress: (callback: (taskId: string, progress: number) => void) => () => void
  onTaskCompleted: (callback: (taskId: string) => void) => () => void
  onTaskFailed: (callback: (taskId: string, error: string) => void) => () => void
  onTaskCreated: (callback: (task: any) => void) => () => void
  searchFiles: (dir: string, query: string) => Promise<{ results: any[]; error?: string }>
  renameFile: (dir: string, oldName: string, newName: string) => Promise<{ success: boolean; error?: string }>
  deleteFile: (dir: string, name: string) => Promise<{ success: boolean; error?: string }>
  moveFile: (dir: string, fileName: string, targetDir: string) => Promise<{ success: boolean; error?: string }>

  // Agent Core
  agentSubmit: (payload: {
    sessionId: string
    userInput: string
    config: any
    mode: 'explore' | 'ask' | 'execute' | 'research'
    workspacePath: string
    openFiles?: string[]
    tierOverride?: 'weak' | 'medium' | 'strong'
    modelOverride?: string
    attachments?: Array<{ type: 'image'; name: string; data: string; mediaType: string }>
    dataSources?: {
      kbFolderIds?: number[]
      apis?: string[]
      mcpServers?: string[]
    }
  }) => Promise<{ success: boolean; error?: string }>
  agentResolvePermission: (payload: { sessionId: string; toolCallId: string; allow: boolean }) => Promise<{ success: boolean; error?: string }>
  agentCancel: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  agentGetMessages: (sessionId: string) => Promise<any[]>
  agentClearSession: (sessionId: string) => Promise<{ success: boolean }>
  agentSwitchModel: (payload: { sessionId: string; tier?: 'weak' | 'medium' | 'strong'; model?: string }) => Promise<{ success: boolean; error?: string }>
  agentGetCostReport: (sessionId: string) => Promise<{ stats: Array<{ provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; callCount: number }>; total: { input: number; output: number } }>
  agentGetSwitchHistory: (sessionId: string) => Promise<any[]>
  agentGetTodoList: (sessionId: string) => Promise<Array<{ text: string; completed: boolean; createdAt: string }>>
  agentUndoAll: (sessionId: string) => Promise<{ success: boolean; restored?: number; error?: string }>
  agentCanUndo: (sessionId: string) => Promise<{ canUndo: boolean }>
  agentClearCost: () => Promise<{ success: boolean }>
  agentResolveFileReferences: (payload: { userInput: string; workspacePath: string; openFiles?: string[] }) => Promise<{ refs: string[] }>
  agentListModels: (provider: string, baseUrl: string, apiKey: string) => Promise<{ models: string[]; error?: string }>
  /** @deprecated Use `agentListModels`. Kept as alias for backwards compatibility. */
  listModels: (provider: string, baseUrl: string, apiKey: string) => Promise<{ models: string[]; error?: string }>
  onAgentEvent: (callback: (sessionId: string, event: AgentEvent) => void) => () => void

  // Shell Environment (Windows)
  shellEnvDetect: () => Promise<{ gitbash?: string; wsl: boolean }>
  shellEnvGet: () => Promise<{ type: 'gitbash' | 'wsl' | 'native'; path?: string } | null>
  shellEnvSet: (config: { type: 'gitbash' | 'wsl' | 'native'; path?: string }) => Promise<{ success: boolean }>
  shellEnvHasSetup: () => Promise<boolean>

  // Python LSP
  pythonLspStart: (workspacePath: string) => Promise<boolean>
  pythonLspStop: (workspacePath: string) => Promise<{ success: boolean }>
  pythonLspOpen: (workspacePath: string, uri: string, text: string) => Promise<{ success: boolean }>
  pythonLspChange: (workspacePath: string, uri: string, text: string) => Promise<{ success: boolean }>
  pythonLspCompletion: (workspacePath: string, uri: string, position: { line: number; character: number }) => Promise<any[]>
  pythonLspHover: (workspacePath: string, uri: string, position: { line: number; character: number }) => Promise<{ contents: string } | null>
  onPythonLspDiagnostics: (callback: (workspacePath: string, event: { uri: string; diagnostics: any[] }) => void) => () => void

  // Python / uv / conda Environment
  pythonEnvEnsureUv: () => Promise<string | null>
  pythonEnvEnsureAgentVenv: (workspacePath: string) => Promise<string | null>
  pythonEnvGetAgentPython: (workspacePath: string) => Promise<string | null>
  pythonEnvListAvailable: (workspacePath: string) => Promise<Array<{ id: string; label: string; type: string; pythonPath: string | null; venvPath?: string; condaEnvName?: string }>>
  pythonEnvGetSelected: (workspacePath: string, savedId: string | null) => Promise<{ id: string; label: string; type: string; pythonPath: string | null; venvPath?: string; condaEnvName?: string } | null>
  pythonEnvIsCondaInstalled: () => Promise<boolean>
  pythonEnvListCondaEnvs: () => Promise<Array<{ name: string; path: string }>>
  pythonEnvIsUvInstalled: () => Promise<boolean>

  // Terminal
  terminal: {
    create: (opts?: { shell?: string; cwd?: string; workspacePath?: string }) => Promise<{ id: string; shell: string }>
    write: (id: string, data: string) => Promise<void>
    resize: (id: string, cols: number, rows: number) => Promise<void>
    kill: (id: string) => Promise<void>
    listShells: () => Promise<{ name: string; path: string }[]>
    getDefaultShell: () => Promise<string | null>
    setDefaultShell: (shell: string) => Promise<void>
    onData: (cb: (event: { id: string; data: string }) => void) => () => void
    onExit: (cb: (event: { id: string; exitCode: number }) => void) => () => void
  }

  // Dialog
  openDirectory: () => Promise<{ path: string | null; canceled: boolean }>
  openFile: (options?: { multiple?: boolean; filters?: any[] }) => Promise<{ paths: string[]; canceled: boolean }>

  // Platform
  getPlatform: () => Promise<string>
  getHomeDir: () => Promise<string>
  setZoomFactor: (factor: number) => Promise<void>

  // File watcher
  watchWorkspace: (path: string) => void
  onFileChanged: (callback: (event: { type: string; path: string }) => void) => () => void
  taskList: () => Promise<any[]>
  taskStop: (id: string) => Promise<boolean>

  // Knowledge Base
  kbAddFolder: (path: string, name: string) => Promise<{ id: number; path: string; name: string }>
  kbRemoveFolder: (id: number) => Promise<void>
  kbListFolders: () => Promise<any[]>
  kbIndexFolder: (folderId: number) => Promise<{ success: boolean; indexed: number; error?: string }>
  kbSearch: (query: string, options?: { folderIds?: number[]; topK?: number }) => Promise<any[]>

  // Path utilities (cross-platform)
  pathJoin: (...segments: string[]) => string
  pathDirname: (p: string) => string
  pathBasename: (p: string, ext?: string) => string
  pathSep: string
  pathIsAbsolute: (p: string) => boolean
  pathNormalize: (p: string) => string
}

function genId(): string {
  return crypto.randomUUID()
}

const api: ElectronAPI = {
  getWorkspaces: () => ipcRenderer.invoke('db:workspaces:list'),
  createWorkspace: (name, path) => ipcRenderer.invoke('db:workspaces:create', { id: genId(), name, path }),
  updateWorkspace: (id, data) => ipcRenderer.invoke('db:workspaces:update', id, data),
  updateWorkspaceModelTier: (id, tier) => ipcRenderer.invoke('db:workspaces:updateModelTier', id, tier),
  deleteWorkspace: (id) => ipcRenderer.invoke('db:workspaces:delete', id),

  getTaskFolders: (workspaceId) => ipcRenderer.invoke('db:taskFolders:list', workspaceId),
  createTaskFolder: (data) => ipcRenderer.invoke('db:taskFolders:create', { id: genId(), ...data }),
  updateTaskFolder: (id, data) => ipcRenderer.invoke('db:taskFolders:update', id, data),
  deleteTaskFolder: (id) => ipcRenderer.invoke('db:taskFolders:delete', id),

  getTasks: () => ipcRenderer.invoke('db:tasks:list'),
  getTasksByWorkspace: (workspaceId) => ipcRenderer.invoke('db:tasks:listByWorkspace', workspaceId),
  createTask: (title, workspaceId, folderId) => ipcRenderer.invoke('db:tasks:create', { id: genId(), workspace_id: workspaceId, folder_id: folderId, title }),
  updateTask: (id, title, editorState, status, folderId) => {
    const data: any = {}
    if (title !== undefined) data.title = title
    if (editorState !== undefined) data.editor_state = editorState
    if (status !== undefined) data.status = status
    if (folderId !== undefined) data.folder_id = folderId
    return ipcRenderer.invoke('db:tasks:update', id, data)
  },
  deleteTask: (id) => ipcRenderer.invoke('db:tasks:delete', id),

  getSessionByTask: (taskId) => ipcRenderer.invoke('db:sessions:getByTask', taskId),
  createSession: (taskId, title, mode) => ipcRenderer.invoke('db:sessions:create', { id: genId(), task_id: taskId, title, mode }),
  updateSessionMode: (id, mode) => ipcRenderer.invoke('db:sessions:updateMode', id, mode),
  updateSessionOverrides: (id, tier, model) => ipcRenderer.invoke('db:sessions:updateOverrides', id, tier, model),

  getMessages: (sessionId) => ipcRenderer.invoke('db:messages:list', sessionId),
  listMessagesByTasks: (taskIds) => ipcRenderer.invoke('db:messages:listByTasks', taskIds),
  createMessage: (sessionId, role, content) => ipcRenderer.invoke('db:messages:create', { id: genId(), session_id: sessionId, role, content }),
  clearSessionMessages: (sessionId) => ipcRenderer.invoke('db:messages:clear', sessionId),
  getReportMessages: (taskIds, startTime, endTime) => ipcRenderer.invoke('report:getMessages', taskIds, startTime, endTime),
  generateReport: (payload) => ipcRenderer.invoke('report:generate', payload),
  generateReportStream: (payload) => ipcRenderer.invoke('report:generateStream', payload),
  listReports: (reportDir) => ipcRenderer.invoke('report:list', reportDir),
  deleteReport: (filePath) => ipcRenderer.invoke('report:delete', filePath),
  listSkills: (workspacePath) => ipcRenderer.invoke('skills:list', workspacePath),

  getSetting: (key) => ipcRenderer.invoke('db:settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('db:settings:set', key, value),

  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
  readFileBase64: (path) => ipcRenderer.invoke('fs:readFileBase64', path),
  writeFileBase64: (path, data) => ipcRenderer.invoke('fs:writeFileBase64', path, data),
  undoWriteFile: (path) => ipcRenderer.invoke('fs:undoWrite', path),
  snapshotBackup: (path) => ipcRenderer.invoke('fs:snapshotBackup', path),
  getUndoCount: (path) => ipcRenderer.invoke('fs:getUndoCount', path),
  listFiles: (dir) => ipcRenderer.invoke('fs:listFiles', dir),
  latexCompile: (path) => ipcRenderer.invoke('latex:compile', path),
  latexCheckEnv: () => ipcRenderer.invoke('latex:checkEnv'),
  latexVerifyCompiler: (path) => ipcRenderer.invoke('latex:verifyCompiler', path),
  latexDownloadTectonic: () => ipcRenderer.invoke('latex:downloadTectonic'),
  latexGetBundledPath: () => ipcRenderer.invoke('latex:getBundledPath'),
  latexRemoveBundled: () => ipcRenderer.invoke('latex:removeBundled'),
  officeConvertToPdf: (path) => ipcRenderer.invoke('office:convertToPdf', path),
  wordCheckEnv: () => ipcRenderer.invoke('word:checkEnv'),
  wordVerifySoffice: (path) => ipcRenderer.invoke('word:verifySoffice', path),
  wordGetBundledPath: () => ipcRenderer.invoke('word:getBundledPath'),
  wordExtractText: (path) => ipcRenderer.invoke('word:extractText', path),
  wordUnpack: (path, outputDir) => ipcRenderer.invoke('word:unpack', path, outputDir),
  wordPack: (inputDir, outputPath) => ipcRenderer.invoke('word:pack', inputDir, outputPath),
  wordConvertDocToDocx: (path) => ipcRenderer.invoke('word:convertDocToDocx', path),
  wordCreateFromMarkdown: (payload) => ipcRenderer.invoke('word:createFromMarkdown', payload),
  wordAnalyzeStructure: (path) => ipcRenderer.invoke('word:analyzeStructure', path),
  wordConvertToIndexedHtml: (path) => ipcRenderer.invoke('word:convertToIndexedHtml', path),
  wordOpenExternally: (path) => ipcRenderer.invoke('word:openExternally', path),
  wordWatchExternal: (path) => ipcRenderer.invoke('word:watchExternal', path),
  wordUnwatchExternal: (path) => ipcRenderer.invoke('word:unwatchExternal', path),
  wordGetPandocInfo: () => ipcRenderer.invoke('word:getPandocInfo'),
  wordVerifyPandoc: (path) => ipcRenderer.invoke('word:verifyPandoc', path),
  pandocDownload: () => ipcRenderer.invoke('pandoc:download'),
  pandocGetBundledPath: () => ipcRenderer.invoke('pandoc:getBundledPath'),
  pandocRemoveBundled: () => ipcRenderer.invoke('pandoc:removeBundled'),
  onWordExternalChanged: (callback) => {
    const handler = (_e: any, filePath: string) => callback(filePath)
    ipcRenderer.on('word:external-changed', handler)
    return () => ipcRenderer.removeListener('word:external-changed', handler)
  },
  wordReplaceParagraph: (path, paragraphIndex, newText) => ipcRenderer.invoke('word:replaceParagraph', path, paragraphIndex, newText),
  wordAddParagraph: (path, paragraphIndex, text) => ipcRenderer.invoke('word:addParagraph', path, paragraphIndex, text),
  wordDeleteParagraph: (path, paragraphIndex) => ipcRenderer.invoke('word:deleteParagraph', path, paragraphIndex),
  wordModifyFormat: (path, target, changes) => ipcRenderer.invoke('word:modifyFormat', path, target, changes),
  wordUndoChange: (path) => ipcRenderer.invoke('word:undoChange', path),
  pdfGetCachedPath: (path) => ipcRenderer.invoke('pdf:getCachedPath', path),
  pdfInvalidateCache: (path) => ipcRenderer.invoke('pdf:invalidateCache', path),
  taskGet: (id) => ipcRenderer.invoke('task:get', id),
  onTaskProgress: (callback) => {
    const handler = (_e: any, taskId: string, progress: number) => callback(taskId, progress)
    ipcRenderer.on('task:progress', handler)
    return () => ipcRenderer.removeListener('task:progress', handler)
  },
  onTaskCompleted: (callback) => {
    const handler = (_e: any, taskId: string) => callback(taskId)
    ipcRenderer.on('task:completed', handler)
    return () => ipcRenderer.removeListener('task:completed', handler)
  },
  onTaskFailed: (callback) => {
    const handler = (_e: any, taskId: string, error: string) => callback(taskId, error)
    ipcRenderer.on('task:failed', handler)
    return () => ipcRenderer.removeListener('task:failed', handler)
  },
  onTaskCreated: (callback) => {
    const handler = (_e: any, task: any) => callback(task)
    ipcRenderer.on('task:created', handler)
    return () => ipcRenderer.removeListener('task:created', handler)
  },
  searchFiles: (dir, query) => ipcRenderer.invoke('fs:searchFiles', dir, query),
  renameFile: (dir, oldName, newName) => ipcRenderer.invoke('fs:rename', dir, oldName, newName),
  deleteFile: (dir, name) => ipcRenderer.invoke('fs:delete', dir, name),
  moveFile: (dir, fileName, targetDir) => ipcRenderer.invoke('fs:move', dir, fileName, targetDir),

  agentSubmit: (payload) => ipcRenderer.invoke('agent:submit', payload),
  agentResolvePermission: (payload) => ipcRenderer.invoke('agent:resolvePermission', payload),
  agentCancel: (sessionId) => ipcRenderer.invoke('agent:cancel', sessionId),
  agentGetMessages: (sessionId) => ipcRenderer.invoke('agent:getMessages', sessionId),
  agentClearSession: (sessionId) => ipcRenderer.invoke('agent:clearSession', sessionId),
  agentSwitchModel: (payload) => ipcRenderer.invoke('agent:switchModel', payload),
  agentGetCostReport: (sessionId) => ipcRenderer.invoke('agent:getCostReport', sessionId),
  agentGetSwitchHistory: (sessionId) => ipcRenderer.invoke('agent:getSwitchHistory', sessionId),
  agentGetTodoList: (sessionId) => ipcRenderer.invoke('agent:todoList', sessionId),
  agentUndoAll: (sessionId) => ipcRenderer.invoke('agent:undoAll', sessionId),
  agentCanUndo: (sessionId) => ipcRenderer.invoke('agent:canUndo', sessionId),
  agentClearCost: () => ipcRenderer.invoke('agent:clearCost'),
  agentResolveFileReferences: (payload) => ipcRenderer.invoke('agent:resolveFileReferences', payload),
  agentListModels: (provider, baseUrl, apiKey) => ipcRenderer.invoke('agent:listModels', provider, baseUrl, apiKey),
  listModels: (provider, baseUrl, apiKey) => ipcRenderer.invoke('agent:listModels', provider, baseUrl, apiKey),
  onAgentEvent: (callback) => {
    const handler = (_e: any, sessionId: string, event: AgentEvent) => callback(sessionId, event)
    ipcRenderer.on('agent:event', handler)
    return () => ipcRenderer.removeListener('agent:event', handler)
  },

  // Shell Environment (Windows)
  shellEnvDetect: () => ipcRenderer.invoke('shellEnv:detect'),
  shellEnvGet: () => ipcRenderer.invoke('shellEnv:get'),
  shellEnvSet: (config) => ipcRenderer.invoke('shellEnv:set', config),
  shellEnvHasSetup: () => ipcRenderer.invoke('shellEnv:hasSetup'),

  // Python LSP
  pythonLspStart: (workspacePath) => ipcRenderer.invoke('pythonLsp:start', workspacePath),
  pythonLspStop: (workspacePath) => ipcRenderer.invoke('pythonLsp:stop', workspacePath),
  pythonLspOpen: (workspacePath, uri, text) => ipcRenderer.invoke('pythonLsp:open', workspacePath, uri, text),
  pythonLspChange: (workspacePath, uri, text) => ipcRenderer.invoke('pythonLsp:change', workspacePath, uri, text),
  pythonLspCompletion: (workspacePath, uri, position) => ipcRenderer.invoke('pythonLsp:completion', workspacePath, uri, position),
  pythonLspHover: (workspacePath, uri, position) => ipcRenderer.invoke('pythonLsp:hover', workspacePath, uri, position),
  onPythonLspDiagnostics: (callback) => {
    const handler = (_: any, workspacePath: string, event: { uri: string; diagnostics: any[] }) => callback(workspacePath, event)
    ipcRenderer.on('pythonLsp:diagnostics', handler)
    return () => ipcRenderer.removeListener('pythonLsp:diagnostics', handler)
  },

  // Python / uv / conda Environment
  pythonEnvEnsureUv: () => ipcRenderer.invoke('pythonEnv:ensureUv'),
  pythonEnvEnsureAgentVenv: (workspacePath) => ipcRenderer.invoke('pythonEnv:ensureAgentVenv', workspacePath),
  pythonEnvGetAgentPython: (workspacePath) => ipcRenderer.invoke('pythonEnv:getAgentPython', workspacePath),
  pythonEnvListAvailable: (workspacePath) => ipcRenderer.invoke('pythonEnv:listAvailable', workspacePath),
  pythonEnvGetSelected: (workspacePath, savedId) => ipcRenderer.invoke('pythonEnv:getSelected', workspacePath, savedId),
  pythonEnvIsCondaInstalled: () => ipcRenderer.invoke('pythonEnv:isCondaInstalled'),
  pythonEnvListCondaEnvs: () => ipcRenderer.invoke('pythonEnv:listCondaEnvs'),
  pythonEnvIsUvInstalled: () => ipcRenderer.invoke('pythonEnv:isUvInstalled'),

  // Terminal
  terminal: {
    create: (opts) => ipcRenderer.invoke('terminal:create', opts),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.invoke('terminal:kill', id),
    listShells: () => ipcRenderer.invoke('terminal:listShells'),
    getDefaultShell: () => ipcRenderer.invoke('terminal:getDefaultShell'),
    setDefaultShell: (shell) => ipcRenderer.invoke('terminal:setDefaultShell', shell),
    onData: (cb) => {
      const handler = (_: any, payload: any) => cb(payload)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (cb) => {
      const handler = (_: any, payload: any) => cb(payload)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
  },

  openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
  openFile: (options) => ipcRenderer.invoke('dialog:openFile', options ?? {}),
  getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  getHomeDir: () => ipcRenderer.invoke('app:getHomeDir'),
  setZoomFactor: (factor) => ipcRenderer.invoke('app:setZoomFactor', factor),

  watchWorkspace: (path) => ipcRenderer.send('fs:watchWorkspace', path),
  onFileChanged: (callback) => {
    const handler = (_e: any, event: { type: string; path: string }) => callback(event)
    ipcRenderer.on('fs:file-changed', handler)
    return () => ipcRenderer.removeListener('fs:file-changed', handler)
  },
  taskList: () => ipcRenderer.invoke('task:list'),
  taskStop: (id) => ipcRenderer.invoke('task:stop', id),

  // Knowledge Base
  kbAddFolder: (path, name) => ipcRenderer.invoke('kb:folders:add', path, name),
  kbRemoveFolder: (id) => ipcRenderer.invoke('kb:folders:remove', id),
  kbListFolders: () => ipcRenderer.invoke('kb:folders:list'),
  kbIndexFolder: (folderId) => ipcRenderer.invoke('kb:index', folderId),
  kbSearch: (query, options) => ipcRenderer.invoke('kb:search', query, options),

  // Path utilities (cross-platform) — use sendSync to keep synchronous API
  pathJoin: (...segments: string[]) => ipcRenderer.sendSync('path:join', ...segments),
  pathDirname: (p: string) => ipcRenderer.sendSync('path:dirname', p),
  pathBasename: (p: string, ext?: string) => ipcRenderer.sendSync('path:basename', p, ext),
  pathSep: ipcRenderer.sendSync('path:sep'),
  pathIsAbsolute: (p: string) => ipcRenderer.sendSync('path:isAbsolute', p),
  pathNormalize: (p: string) => ipcRenderer.sendSync('path:normalize', p),
}

contextBridge.exposeInMainWorld('electronAPI', api)
