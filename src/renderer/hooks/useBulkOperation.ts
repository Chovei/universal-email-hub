import { useState, useEffect, useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { BulkAction, BulkProgress, BulkResult, BulkRequest } from '@shared/types/ipc'

export function useBulkOperation() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<BulkProgress | null>(null)
  const [result, setResult] = useState<BulkResult | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const currentOpId = useRef<string | null>(null)
  // Keep the last action label so the done toast can describe what happened
  const lastAction = useRef<BulkAction | null>(null)

  useEffect(() => {
    const off1 = window.emailAPI.bulk.onProgress((p) => {
      if (p.operationId !== currentOpId.current) return
      lastAction.current = p.action
      setProgress(p)
    })
    const off2 = window.emailAPI.bulk.onDone((r) => {
      if (r.operationId !== currentOpId.current) return
      setProgress(null)
      setResult(r)
      setIsRunning(false)
      // C2: refresh the thread list so bulk changes show up immediately
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    })
    const off3 = window.emailAPI.bulk.onCancelled((c) => {
      if (c.operationId !== currentOpId.current) return
      setProgress(null)
      setIsRunning(false)
      // C2: batches completed before cancellation are already committed
      void queryClient.invalidateQueries({ queryKey: ['messages'] })
    })
    return () => { off1(); off2(); off3() }
  }, [queryClient])

  const execute = useCallback(async (req: Omit<BulkRequest, 'operationId'>) => {
    const operationId = crypto.randomUUID()
    currentOpId.current = operationId
    lastAction.current = req.action
    setResult(null)
    setProgress(null)
    setIsRunning(true)
    // I4: if the handler rejects the request (validation error, etc.) no
    // BULK_DONE event will ever arrive — reset state here instead
    try {
      const response = await window.emailAPI.bulk.execute({ ...req, operationId })
      if (response && 'error' in response) {
        setIsRunning(false)
        setProgress(null)
      }
    } catch {
      setIsRunning(false)
      setProgress(null)
    }
  }, [])

  const cancel = useCallback(async () => {
    if (currentOpId.current) await window.emailAPI.bulk.cancel(currentOpId.current)
  }, [])

  const undo = useCallback(async (undoToken: string) => {
    await window.emailAPI.bulk.undo(undoToken)
    setResult(null)
  }, [])

  const dismiss = useCallback(() => setResult(null), [])

  return {
    execute, cancel, undo, dismiss,
    progress, result, isRunning,
    lastAction: lastAction.current,
  }
}
