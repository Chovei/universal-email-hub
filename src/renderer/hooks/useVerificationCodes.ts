import { useState, useEffect, useCallback } from 'react'
import type { VerificationCodeRow } from '@shared/types/db'

type Envelope<T> = { data?: T; error?: { code: string; message: string } }

export function useVerificationCodes() {
  const [codes, setCodes] = useState<VerificationCodeRow[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    const result = (await window.emailAPI.verificationCodes.list()) as unknown as Envelope<VerificationCodeRow[]>
    if (result?.data) setCodes(result.data)
    setIsLoading(false)
  }, [])

  useEffect(() => {
    void load()
    const unsubscribe = window.emailAPI.verificationCodes.onNew(() => void load())
    return unsubscribe
  }, [load])

  const markRead = useCallback(async (ids: string[]) => {
    await window.emailAPI.verificationCodes.markRead(ids)
    setCodes((prev) => prev.map((c) => (ids.includes(c.id) ? { ...c, isRead: true } : c)))
  }, [])

  const deleteCode = useCallback(async (ids: string[]) => {
    await window.emailAPI.verificationCodes.delete(ids)
    setCodes((prev) => prev.filter((c) => !ids.includes(c.id)))
  }, [])

  const unreadCount = codes.filter((c) => !c.isRead).length

  return { codes, isLoading, unreadCount, markRead, deleteCode }
}
