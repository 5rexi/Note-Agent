import { Plus, Wrench } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

interface DataSourceItemProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  onAdd?: () => void
}

export function DataSourceItem({ icon: Icon, label, onClick, onAdd }: DataSourceItemProps) {
  return (
    <div className="group flex items-center gap-1">
      <button
        onClick={onClick}
        className="flex-1 flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-lg transition-colors text-left hover:bg-[var(--na-bg-hover)]"
        style={{ color: 'var(--na-text-secondary)' }}
      >
        <Icon className="w-4 h-4 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
        <span>{label}</span>
      </button>
      {onAdd && (
        <button
          onClick={(e) => { e.stopPropagation(); onAdd() }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded shrink-0"
          style={{ color: 'var(--na-text-tertiary)' }}
          title="创建"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

interface SkillItemProps {
  label: string
  onClick: () => void
  onAdd: () => void
}

export function SkillItem({ label, onClick, onAdd }: SkillItemProps) {
  return (
    <div className="group flex items-center gap-1">
      <button
        onClick={onClick}
        className="flex-1 flex items-center gap-2.5 px-2.5 py-1.5 text-[13px] rounded-lg transition-colors text-left hover:bg-[var(--na-bg-hover)]"
        style={{ color: 'var(--na-text-secondary)' }}
      >
        <Wrench className="w-4 h-4 shrink-0" style={{ color: 'var(--na-text-tertiary)' }} />
        <span>{label}</span>
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onAdd() }}
        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded shrink-0"
        style={{ color: 'var(--na-text-tertiary)' }}
        title="创建"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}
