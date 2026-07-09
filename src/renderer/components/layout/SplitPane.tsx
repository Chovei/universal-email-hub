import { useRef, useCallback, type ReactNode } from 'react'
import { useUIStore } from '../../stores/uiStore'

interface SplitPaneProps {
  left: ReactNode
  right: ReactNode
  minLeft?: number
  maxLeft?: number
  minRight?: number
}

export function SplitPane({
  left,
  right,
  minLeft = 240,
  maxLeft = 600,
  minRight = 300,
}: SplitPaneProps) {
  const { splitRatio, setSplitRatio } = useUIStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDragging.current = true
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (e: MouseEvent) => {
        if (!isDragging.current || !containerRef.current) return
        const container = containerRef.current
        const rect = container.getBoundingClientRect()
        const totalWidth = rect.width
        const leftWidth = e.clientX - rect.left

        if (leftWidth < minLeft || totalWidth - leftWidth < minRight || leftWidth > maxLeft) return

        setSplitRatio(leftWidth / totalWidth)
      }

      const onMouseUp = () => {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [minLeft, maxLeft, minRight, setSplitRatio]
  )

  const leftWidth = `${(splitRatio * 100).toFixed(2)}%`
  const rightWidth = `${((1 - splitRatio) * 100).toFixed(2)}%`

  return (
    <div ref={containerRef} className="flex h-full overflow-hidden">
      <div style={{ width: leftWidth }} className="flex-none overflow-hidden">
        {left}
      </div>

      {/* Resize handle */}
      <div
        className="w-px bg-[var(--color-border)] hover:bg-[var(--color-primary)] transition-colors cursor-col-resize flex-none relative group"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-y-0 -left-1 -right-1 group-hover:bg-[var(--color-primary)] group-hover:opacity-10 rounded" />
      </div>

      <div style={{ width: rightWidth }} className="flex-none overflow-hidden">
        {right}
      </div>
    </div>
  )
}
