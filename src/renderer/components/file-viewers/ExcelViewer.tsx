import { useState, useEffect, useCallback } from 'react'
import { Loader2, Save, Table2 } from 'lucide-react'
import * as XLSX from 'xlsx'
import { toast } from 'sonner'

interface ExcelViewerProps {
  filePath: string
}

export default function ExcelViewer({ filePath }: ExcelViewerProps) {
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null)
  const [sheetName, setSheetName] = useState<string>('')
  const [sheetData, setSheetData] = useState<any[][]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  useEffect(() => {
    setIsLoading(true)
    setError(null)
    setWorkbook(null)
    setHasChanges(false)

    window.electronAPI.readFileBase64(filePath).then((result) => {
      if (result.error) {
        setError(result.error)
        setIsLoading(false)
        return
      }
      try {
        const buffer = Uint8Array.from(atob(result.data), (c) => c.charCodeAt(0))
        const wb = XLSX.read(buffer, { type: 'array' })
        setWorkbook(wb)
        const firstSheet = wb.SheetNames[0]
        setSheetName(firstSheet)
        const ws = wb.Sheets[firstSheet]
        setSheetData(XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][])
        setIsLoading(false)
      } catch (e: any) {
        setError(e.message || '解析失败')
        setIsLoading(false)
      }
    })
  }, [filePath])

  const handleCellChange = useCallback((row: number, col: number, value: string) => {
    setSheetData((prev) => {
      const next = prev.map((r) => [...r])
      if (!next[row]) next[row] = []
      next[row][col] = value
      return next
    })
    setHasChanges(true)
  }, [])

  const save = useCallback(async () => {
    if (!workbook || !sheetName) return
    try {
      const ws = XLSX.utils.aoa_to_sheet(sheetData)
      workbook.Sheets[sheetName] = ws
      const buffer = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
      const content = new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
      const base64 = btoa(content)
      const result = await window.electronAPI.writeFileBase64(filePath, base64)
      if (result.success) {
        toast.success('已保存')
        setHasChanges(false)
      } else {
        toast.error('保存失败: ' + result.error)
      }
    } catch (e: any) {
      toast.error('保存失败: ' + e.message)
    }
  }, [workbook, sheetName, sheetData, filePath])

  return (
    <div className="flex flex-col h-full w-full" style={{ background: 'var(--na-bg-panel)' }}>
      {/* Toolbar */}
      <div
        className="flex items-center justify-between px-3 shrink-0"
        style={{
          height: 36,
          borderBottom: '1px solid var(--na-border-subtle)',
          background: 'var(--na-bg-sidebar)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <Table2 className="w-3.5 h-3.5" style={{ color: 'var(--na-text-tertiary)' }} />
          <span className="text-[11px]" style={{ color: 'var(--na-text-tertiary)' }}>
            {sheetName || 'Excel'}
          </span>
          {workbook && workbook.SheetNames.length > 1 && (
            <select
              className="text-[11px] outline-none px-1.5 py-0.5 rounded"
              style={{ background: 'var(--na-bg-panel)', color: 'var(--na-text-secondary)', border: '1px solid var(--na-border-subtle)' }}
              value={sheetName}
              onChange={(e) => {
                const name = e.target.value
                setSheetName(name)
                setSheetData(XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }) as any[][])
                setHasChanges(false)
              }}
            >
              {workbook.SheetNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          )}
        </div>
        <button
          onClick={save}
          disabled={!hasChanges}
          className="flex items-center gap-1 px-2 py-1 text-[11px] rounded transition-colors"
          style={{
            color: hasChanges ? 'var(--na-status-ask)' : 'var(--na-text-tertiary)',
            borderRadius: 'var(--na-radius-sm)',
            background: hasChanges ? 'rgba(5,150,105,0.08)' : 'transparent',
          }}
        >
          <Save className="w-3 h-3" />
          保存
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-text-tertiary)' }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">加载表格...</span>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--na-status-explore)' }}>
            <span className="text-sm">加载失败: {error}</span>
          </div>
        )}
        {sheetData.length > 0 && (
          <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {sheetData.map((row, rowIdx) => (
                <tr key={rowIdx}>
                  {row.map((cell, colIdx) => (
                    <td
                      key={colIdx}
                      className="px-2 py-1 outline-none"
                      style={{
                        border: '1px solid var(--na-border-subtle)',
                        minWidth: 60,
                        background: rowIdx === 0 ? 'var(--na-bg-sidebar)' : 'transparent',
                        fontWeight: rowIdx === 0 ? 600 : 400,
                      }}
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => handleCellChange(rowIdx, colIdx, e.currentTarget.textContent || '')}
                    >
                      {cell ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
