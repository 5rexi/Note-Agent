import { useState, useEffect, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { currentWorkspaceAtom, editorStateAtom } from '../atoms'
import { Folder, FileText, ChevronRight, ChevronDown } from 'lucide-react'

interface TreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: TreeNode[]
  expanded?: boolean
}

export default function FileTree() {
  const workspace = useAtomValue(currentWorkspaceAtom)
  const editorState = useAtomValue(editorStateAtom)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const loadDir = useCallback(async (dirPath: string): Promise<TreeNode[]> => {
    const result = await window.electronAPI.listFiles(dirPath)
    if (result.error) return []
    const nodes: TreeNode[] = []
    for (const entry of result.entries) {
      const fullPath = window.electronAPI.pathJoin(dirPath, entry.name)
      const relPath = workspace?.path ? fullPath.replace(workspace?.path + window.electronAPI.pathSep, '') : fullPath
      const node: TreeNode = {
        name: entry.name,
        path: relPath,
        isDirectory: entry.isDirectory,
      }
      if (entry.isDirectory) {
        node.children = []
      }
      nodes.push(node)
    }
    return nodes.sort((a, b) => {
      if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name)
      return a.isDirectory ? -1 : 1
    })
  }, [workspace?.path])

  useEffect(() => {
    if (!workspace) {
      setTree([])
      return
    }
    loadDir(workspace.path).then(setTree)
    // Tell main process to watch this workspace for external changes
    window.electronAPI.watchWorkspace(workspace.path)
  }, [workspace, loadDir])

  // Listen for external file changes and refresh the tree
  useEffect(() => {
    const unsub = window.electronAPI.onFileChanged(() => {
      if (!workspace) return
      loadDir(workspace.path).then(setTree)
    })
    return () => unsub()
  }, [workspace, loadDir])

  const toggleExpand = async (node: TreeNode) => {
    if (!node.isDirectory) return
    const newExpanded = new Set(expanded)
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path)
    } else {
      newExpanded.add(node.path)
      // Lazy load children
      if (!node.children || node.children.length === 0) {
        const children = await loadDir(window.electronAPI.pathJoin(workspace!.path, node.path))
        updateTreeNode(tree, node.path, children)
      }
    }
    setExpanded(newExpanded)
  }

  const updateTreeNode = (nodes: TreeNode[], targetPath: string, children: TreeNode[]) => {
    for (const n of nodes) {
      if (n.path === targetPath) {
        n.children = children
        setTree([...tree])
        return
      }
      if (n.children) {
        updateTreeNode(n.children, targetPath, children)
      }
    }
  }

  const openFile = (node: TreeNode) => {
    if (node.isDirectory) return
    // Update editor state to open this file
    // This is handled via a callback passed from parent
    window.dispatchEvent(new CustomEvent('file-tree:open', { detail: node.path }))
  }

  const renderNode = (node: TreeNode, depth: number = 0) => {
    const isExpanded = expanded.has(node.path)
    const isOpen = editorState.openFiles.includes(node.path)

    return (
      <div key={node.path}>
        <button
          onClick={() => (node.isDirectory ? toggleExpand(node) : openFile(node))}
          className={`flex items-center w-full text-left py-1 pr-2 text-[13px] transition-colors hover:bg-accent/50 ${
            isOpen ? 'bg-accent/30 text-accent-foreground' : 'text-foreground'
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {node.isDirectory ? (
            <>
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 mr-1 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-3 h-3 mr-1 shrink-0 text-muted-foreground" />
              )}
              <Folder className="w-3.5 h-3.5 mr-1.5 shrink-0 text-blue-400" />
            </>
          ) : (
            <>
              <span className="w-3 mr-1 shrink-0" />
              <FileText className="w-3.5 h-3.5 mr-1.5 shrink-0 text-muted-foreground" />
            </>
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {node.isDirectory && isExpanded && node.children && (
          <div>
            {node.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  if (!workspace) {
    return <div className="p-4 text-sm text-muted-foreground">先选择一个工作区</div>
  }

  return (
    <div className="py-1">
      {tree.map((node) => renderNode(node))}
    </div>
  )
}
