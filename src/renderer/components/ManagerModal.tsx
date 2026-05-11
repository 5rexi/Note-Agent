import { useState, useEffect, useMemo } from 'react'
import { X, Plus, Search, Wrench, Cable, Globe, FileText, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface ManagerModalProps {
  open: boolean
  onClose: () => void
  workspacePath: string
  initialTab?: 'skills' | 'mcp' | 'api'
  onCreateNew?: (type: 'skills' | 'mcp' | 'api') => void
}

interface SkillItem {
  id: string
  name: string
  description: string
  source: string
  path: string
  content: string
  alwaysInject?: boolean
}

interface MCPItem {
  name: string
  transport: string
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

interface APIItem {
  id: string
  name: string
  description: string
  baseUrl: string
  path: string
  content: string
}

type TabType = 'skills' | 'mcp' | 'api'

const TAB_CONFIG: Record<TabType, { label: string; icon: typeof Wrench }> = {
  skills: { label: '技能', icon: Wrench },
  mcp: { label: 'MCP', icon: Cable },
  api: { label: 'API', icon: Globe },
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const result = { frontmatter: {} as Record<string, string>, body: content }
  if (!content.startsWith('---')) return result
  const endIdx = content.indexOf('---', 3)
  if (endIdx === -1) return result
  const fmText = content.slice(3, endIdx).trim()
  const body = content.slice(endIdx + 3).trim()
  const fm: Record<string, string> = {}
  for (const line of fmText.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim()
      const value = line.slice(colonIdx + 1).trim()
      fm[key] = value
    }
  }
  return { frontmatter: fm, body }
}

export default function ManagerModal({ open, onClose, workspacePath, initialTab = 'skills', onCreateNew }: ManagerModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>(initialTab)
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [mcps, setMcps] = useState<MCPItem[]>([])
  const [apis, setApis] = useState<APIItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    loadData()
  }, [open, activeTab, workspacePath])

  useEffect(() => {
    setActiveTab(initialTab)
  }, [initialTab])

  async function loadData() {
    setLoading(true)
    try {
      if (activeTab === 'skills') await loadSkills()
      else if (activeTab === 'mcp') await loadMCPs()
      else if (activeTab === 'api') await loadAPIs()
    } finally {
      setLoading(false)
    }
  }

  async function loadSkills() {
    const items: SkillItem[] = []
    const homeDir = await window.electronAPI.getHomeDir()
    const dirs = [
      { base: `${homeDir}/.note_agent/skills`, source: 'Global' },
      { base: `${workspacePath}/.note_agent/skills`, source: 'Workspace' },
    ]
    for (const { base, source } of dirs) {
      const result = await window.electronAPI.listFiles(base)
      if (result.error || !result.entries) continue
      for (const entry of result.entries) {
        if (entry.type !== 'directory') continue
        const skillMdPath = `${base}/${entry.name}/skill.md`
        const readResult = await window.electronAPI.readFile(skillMdPath)
        if (readResult.error) continue
        const { frontmatter, body } = parseFrontmatter(readResult.content)
        items.push({
          id: entry.name,
          name: frontmatter.name || entry.name,
          description: frontmatter.description || '',
          source,
          path: skillMdPath,
          content: body,
          alwaysInject: frontmatter.alwaysInject === 'true',
        })
      }
    }
    setSkills(items)
    setSelectedId(items[0]?.id ?? null)
  }

  async function loadMCPs() {
    const homeDir = await window.electronAPI.getHomeDir()
    const result = await window.electronAPI.readFile(`${homeDir}/.note_agent/mcp.json`)
    if (result.error) {
      setMcps([])
      setSelectedId(null)
      return
    }
    try {
      const config = JSON.parse(result.content)
      const servers: MCPItem[] = config.servers || []
      setMcps(servers)
      setSelectedId(servers[0]?.name ?? null)
    } catch {
      setMcps([])
      setSelectedId(null)
    }
  }

  async function loadAPIs() {
    const items: APIItem[] = []
    const base = `${workspacePath}/.note_agent/apis`
    const result = await window.electronAPI.listFiles(base)
    if (!result.error && result.entries) {
      for (const entry of result.entries) {
        if (entry.type !== 'file' || !entry.name.endsWith('.json')) continue
        const readResult = await window.electronAPI.readFile(`${base}/${entry.name}`)
        if (readResult.error) continue
        try {
          const config = JSON.parse(readResult.content)
          const id = entry.name.replace(/\.json$/, '')
          items.push({
            id,
            name: config.name || id,
            description: config.description || '',
            baseUrl: config.baseUrl || '',
            path: `${base}/${entry.name}`,
            content: readResult.content,
          })
        } catch {
          // ignore parse error
        }
      }
    }
    setApis(items)
    setSelectedId(items[0]?.id ?? null)
  }

  async function handleDeleteSkill(skill: SkillItem) {
    if (!confirm(`确定要删除技能 "${skill.name}" 吗？`)) return
    const base = skill.path.replace(/\/[^/]+$/, '') // parent dir of skill.md
    const slug = skill.id
    const result = await window.electronAPI.deleteFile(base, slug)
    if (result.success) {
      toast.success('技能已删除')
      loadSkills()
    } else {
      toast.error('删除失败: ' + result.error)
    }
  }

  async function handleDeleteMCP(mcp: MCPItem) {
    if (!confirm(`确定要删除 MCP 服务器 "${mcp.name}" 吗？`)) return
    const homeDir = await window.electronAPI.getHomeDir()
    const mcpPath = `${homeDir}/.note_agent/mcp.json`
    const readResult = await window.electronAPI.readFile(mcpPath)
    if (readResult.error) {
      toast.error('读取 MCP 配置失败')
      return
    }
    try {
      const config = JSON.parse(readResult.content)
      config.servers = (config.servers || []).filter((s: any) => s.name !== mcp.name)
      const writeResult = await window.electronAPI.writeFile(mcpPath, JSON.stringify(config, null, 2))
      if (writeResult.success) {
        toast.success('MCP 服务器已删除')
        loadMCPs()
      } else {
        toast.error('删除失败: ' + writeResult.error)
      }
    } catch {
      toast.error('解析 MCP 配置失败')
    }
  }

  async function handleDeleteAPI(api: APIItem) {
    if (!confirm(`确定要删除 API "${api.name}" 吗？`)) return
    const base = `${workspacePath}/.note_agent/apis`
    const result = await window.electronAPI.deleteFile(base, `${api.id}.json`)
    if (result.success) {
      toast.success('API 已删除')
      loadAPIs()
    } else {
      toast.error('删除失败: ' + result.error)
    }
  }

  const filteredSkills = useMemo(() => {
    if (!search.trim()) return skills
    const q = search.toLowerCase()
    return skills.filter((s) => s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q))
  }, [skills, search])

  const filteredMCPs = useMemo(() => {
    if (!search.trim()) return mcps
    const q = search.toLowerCase()
    return mcps.filter((m) => m.name.toLowerCase().includes(q))
  }, [mcps, search])

  const filteredAPIs = useMemo(() => {
    if (!search.trim()) return apis
    const q = search.toLowerCase()
    return apis.filter((a) => a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
  }, [apis, search])

  const selectedSkill = skills.find((s) => s.id === selectedId)
  const selectedMCP = mcps.find((m) => m.name === selectedId)
  const selectedAPI = apis.find((a) => a.id === selectedId)

  if (!open) return null

  const TabIcon = TAB_CONFIG[activeTab].icon

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: 800,
          height: 560,
          borderRadius: 'var(--na-radius-xl)',
          background: 'var(--na-bg-panel)',
          boxShadow: 'var(--na-shadow-xl)',
          border: '1px solid var(--na-border-subtle)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--na-border-subtle)' }}>
          <div className="flex items-center gap-3">
            <TabIcon className="w-4 h-4" style={{ color: 'var(--na-accent)' }} />
            <span className="text-[14px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>
              {TAB_CONFIG[activeTab].label}管理
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onCreateNew?.(activeTab)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors"
              style={{ background: 'var(--na-accent)', color: '#fff' }}
            >
              <Plus className="w-3.5 h-3.5" />
              新建
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--na-bg-hover)]" style={{ color: 'var(--na-text-tertiary)' }}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--na-border-subtle)' }}>
          {(Object.keys(TAB_CONFIG) as TabType[]).map((tab) => {
            const Icon = TAB_CONFIG[tab].icon
            return (
              <button
                key={tab}
                onClick={() => { setActiveTab(tab); setSearch('') }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-lg transition-colors"
                style={{
                  background: activeTab === tab ? 'var(--na-bg-active)' : 'transparent',
                  color: activeTab === tab ? 'var(--na-text-primary)' : 'var(--na-text-tertiary)',
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {TAB_CONFIG[tab].label}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--na-border-subtle)' }}>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--na-bg-active)' }}>
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索..."
              className="flex-1 text-[12px] outline-none bg-transparent"
              style={{ color: 'var(--na-text-primary)' }}
            />
          </div>
        </div>

        {/* Content */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: List */}
          <div className="w-64 shrink-0 overflow-auto" style={{ borderRight: '1px solid var(--na-border-subtle)' }}>
            {loading && (
              <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>加载中...</div>
            )}
            {!loading && activeTab === 'skills' && (
              <div className="p-1">
                {filteredSkills.length === 0 && (
                  <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>暂无技能</div>
                )}
                {filteredSkills.map((s) => (
                  <button
                    key={s.id + s.source}
                    onClick={() => setSelectedId(s.id)}
                    className="w-full text-left px-3 py-2 text-[12px] rounded-lg transition-colors"
                    style={{
                      background: selectedId === s.id ? 'var(--na-bg-active)' : 'transparent',
                      color: selectedId === s.id ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                    }}
                  >
                    <div className="font-medium truncate">{s.name}</div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>{s.id}</div>
                  </button>
                ))}
              </div>
            )}
            {!loading && activeTab === 'mcp' && (
              <div className="p-1">
                {filteredMCPs.length === 0 && (
                  <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>暂无 MCP 服务器</div>
                )}
                {filteredMCPs.map((m) => (
                  <button
                    key={m.name}
                    onClick={() => setSelectedId(m.name)}
                    className="w-full text-left px-3 py-2 text-[12px] rounded-lg transition-colors"
                    style={{
                      background: selectedId === m.name ? 'var(--na-bg-active)' : 'transparent',
                      color: selectedId === m.name ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                    }}
                  >
                    <div className="font-medium truncate">{m.name}</div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>{m.transport}</div>
                  </button>
                ))}
              </div>
            )}
            {!loading && activeTab === 'api' && (
              <div className="p-1">
                {filteredAPIs.length === 0 && (
                  <div className="text-[12px] text-center py-4" style={{ color: 'var(--na-text-tertiary)' }}>暂无 API 配置</div>
                )}
                {filteredAPIs.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelectedId(a.id)}
                    className="w-full text-left px-3 py-2 text-[12px] rounded-lg transition-colors"
                    style={{
                      background: selectedId === a.id ? 'var(--na-bg-active)' : 'transparent',
                      color: selectedId === a.id ? 'var(--na-text-primary)' : 'var(--na-text-secondary)',
                    }}
                  >
                    <div className="font-medium truncate">{a.name}</div>
                    <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>{a.baseUrl}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Detail */}
          <div className="flex-1 overflow-auto p-4">
            {activeTab === 'skills' && selectedSkill && (
              <SkillDetail skill={selectedSkill} onDelete={() => handleDeleteSkill(selectedSkill)} />
            )}
            {activeTab === 'mcp' && selectedMCP && (
              <MCPDetail mcp={selectedMCP} onDelete={() => handleDeleteMCP(selectedMCP)} />
            )}
            {activeTab === 'api' && selectedAPI && (
              <APIDetail api={selectedAPI} onDelete={() => handleDeleteAPI(selectedAPI)} />
            )}
            {!selectedSkill && activeTab === 'skills' && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <Wrench className="w-8 h-8 mb-2" style={{ color: 'var(--na-text-tertiary)' }} />
                <p className="text-[13px]" style={{ color: 'var(--na-text-secondary)' }}>选择一个技能查看详情</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>或点击「新建」创建技能</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SkillDetail({ skill, onDelete }: { skill: SkillItem; onDelete?: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{skill.name}</h2>
          <p className="text-[13px] mt-1" style={{ color: 'var(--na-text-secondary)' }}>{skill.description}</p>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-[11px] rounded-md transition-colors"
            style={{ background: 'var(--na-bg-active)', color: '#EF4444' }}
          >
            删除
          </button>
        )}
      </div>

      <div className="p-3 rounded-lg" style={{ background: 'var(--na-bg-active)' }}>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--na-text-tertiary)' }}>元数据</h3>
        <div className="space-y-1.5 text-[12px]">
          <div className="flex">
            <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>标识符</span>
            <span style={{ color: 'var(--na-text-primary)' }}>{skill.id}</span>
          </div>
          <div className="flex">
            <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>名称</span>
            <span style={{ color: 'var(--na-text-primary)' }}>{skill.name}</span>
          </div>
          <div className="flex">
            <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>描述</span>
            <span style={{ color: 'var(--na-text-primary)' }}>{skill.description || '-'}</span>
          </div>
          <div className="flex">
            <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>数据源</span>
            <span style={{ color: 'var(--na-text-primary)' }}>{skill.source}</span>
          </div>
          <div className="flex">
            <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>位置</span>
            <span className="font-mono truncate" style={{ color: 'var(--na-text-primary)' }}>{skill.path}</span>
          </div>
          {skill.alwaysInject && (
            <div className="flex">
              <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>自动注入</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--na-accent)', color: '#fff' }}>是</span>
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--na-text-tertiary)' }}>说明</h3>
        <div className="p-3 rounded-lg text-[12px] leading-relaxed whitespace-pre-wrap font-mono" style={{ background: 'var(--na-bg-sidebar)', color: 'var(--na-text-secondary)' }}>
          {skill.content || '无内容'}
        </div>
      </div>
    </div>
  )
}

function MCPDetail({ mcp, onDelete }: { mcp: MCPItem; onDelete?: () => void }) {
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{mcp.name}</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded mt-1 inline-block" style={{ background: 'var(--na-bg-active)', color: 'var(--na-text-tertiary)' }}>{mcp.transport}</span>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-[11px] rounded-md transition-colors"
            style={{ background: 'var(--na-bg-active)', color: '#EF4444' }}
          >
            删除
          </button>
        )}
      </div>

      <div className="p-3 rounded-lg" style={{ background: 'var(--na-bg-active)' }}>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--na-text-tertiary)' }}>配置</h3>
        <div className="space-y-1.5 text-[12px]">
          {mcp.command && (
            <div className="flex">
              <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>命令</span>
              <code className="font-mono" style={{ color: 'var(--na-text-primary)' }}>{mcp.command}</code>
            </div>
          )}
          {mcp.args && mcp.args.length > 0 && (
            <div className="flex">
              <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>参数</span>
              <code className="font-mono" style={{ color: 'var(--na-text-primary)' }}>{mcp.args.join(' ')}</code>
            </div>
          )}
          {mcp.url && (
            <div className="flex">
              <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>URL</span>
              <span style={{ color: 'var(--na-text-primary)' }}>{mcp.url}</span>
            </div>
          )}
          {mcp.env && Object.keys(mcp.env).length > 0 && (
            <div className="mt-2">
              <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>环境变量</span>
              <div className="mt-1 space-y-1">
                {Object.entries(mcp.env).map(([k, v]) => (
                  <div key={k} className="flex font-mono text-[11px]">
                    <span style={{ color: 'var(--na-text-secondary)' }}>{k}=</span>
                    <span style={{ color: 'var(--na-text-primary)' }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function APIDetail({ api, onDelete }: { api: APIItem; onDelete?: () => void }) {
  let endpoints: any[] = []
  try {
    const parsed = JSON.parse(api.content)
    endpoints = parsed.endpoints || []
  } catch {}

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[16px] font-semibold" style={{ color: 'var(--na-text-primary)' }}>{api.name}</h2>
          <p className="text-[13px] mt-1" style={{ color: 'var(--na-text-secondary)' }}>{api.description}</p>
        </div>
        {onDelete && (
          <button
            onClick={onDelete}
            className="px-3 py-1.5 text-[11px] rounded-md transition-colors"
            style={{ background: 'var(--na-bg-active)', color: '#EF4444' }}
          >
            删除
          </button>
        )}
      </div>

      <div className="p-3 rounded-lg" style={{ background: 'var(--na-bg-active)' }}>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--na-text-tertiary)' }}>元数据</h3>
        <div className="space-y-1.5 text-[12px]">
          <div className="flex">
            <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>名称</span>
            <span style={{ color: 'var(--na-text-primary)' }}>{api.name}</span>
          </div>
          <div className="flex">
            <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>Base URL</span>
            <span style={{ color: 'var(--na-text-primary)' }}>{api.baseUrl}</span>
          </div>
          <div className="flex">
            <span className="w-16 shrink-0" style={{ color: 'var(--na-text-tertiary)' }}>位置</span>
            <span className="font-mono truncate" style={{ color: 'var(--na-text-primary)' }}>{api.path}</span>
          </div>
        </div>
      </div>

      {endpoints.length > 0 && (
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--na-text-tertiary)' }}>接口</h3>
          <div className="space-y-2">
            {endpoints.map((ep: any, i: number) => (
              <div key={i} className="p-2.5 rounded-lg" style={{ background: 'var(--na-bg-active)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--na-accent)', color: '#fff' }}>{ep.method}</span>
                  <code className="text-[12px] font-mono" style={{ color: 'var(--na-text-primary)' }}>{ep.path}</code>
                </div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--na-text-secondary)' }}>{ep.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
