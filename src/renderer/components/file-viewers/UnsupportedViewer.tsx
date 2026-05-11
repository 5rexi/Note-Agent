import { FileCode, FileText } from 'lucide-react'

interface UnsupportedViewerProps {
  fileName: string
  ext: string
  onViewAsText: () => void
}

export default function UnsupportedViewer({ fileName, ext, onViewAsText }: UnsupportedViewerProps) {
  return (
    <div className="flex flex-col h-full w-full items-center justify-center" style={{ background: 'var(--na-bg-panel)' }}>
      <FileCode className="w-16 h-16 mb-4" style={{ color: 'var(--na-text-tertiary)', opacity: 0.3 }} />
      <p className="text-[15px] font-medium" style={{ color: 'var(--na-text-secondary)' }}>
        暂不支持该文件类型
      </p>
      <p className="text-[12px] mt-1" style={{ color: 'var(--na-text-tertiary)' }}>
        {fileName}
      </p>
      <p className="text-[11px] mt-0.5" style={{ color: 'var(--na-text-tertiary)' }}>
        .{ext || '未知格式'}
      </p>
      <button
        onClick={onViewAsText}
        className="flex items-center gap-1.5 mt-4 px-4 py-2 text-[12px] rounded-lg transition-colors"
        style={{
          background: 'var(--na-accent)',
          color: '#fff',
        }}
      >
        <FileText className="w-3.5 h-3.5" />
        查看原始编码
      </button>
    </div>
  )
}
