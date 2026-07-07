import { useCallback, useEffect, useState } from 'react'
import type { UpdateInfo, UpdateProgress, UpdateEvent, InstallResult } from '@/shared/update'

type UpdateSubscriber = (info: UpdateInfo) => void

export function useUpdate() {
  const [status, setStatus] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [pendingResult, setPendingResult] = useState<InstallResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [subscribers] = useState(() => new Set<UpdateSubscriber>())

  const notify = useCallback((info: UpdateInfo) => {
    setStatus(info)
    for (const cb of subscribers) cb(info)
  }, [subscribers])

  useEffect(() => {
    const loadInitial = async () => {
      const initial = await window.cranberri.update.status()
      notify(initial)
      const result = await window.cranberri.update.pendingResult()
      setPendingResult(result)
    }
    void loadInitial()

    const unsubscribe = window.cranberri.update.onEvent((event: UpdateEvent) => {
      if (event.type === 'status') {
        notify(event.status)
      } else if (event.type === 'progress') {
        setProgress(event.progress)
      }
    })
    return unsubscribe
  }, [notify])

  const check = useCallback(async () => {
    setChecking(true)
    try {
      const result = await window.cranberri.update.check()
      notify(result)
      return result
    } finally {
      setChecking(false)
    }
  }, [notify])

  const install = useCallback(async () => {
    setInstalling(true)
    try {
      const result = await window.cranberri.update.install()
      setPendingResult(result)
      return result
    } finally {
      setInstalling(false)
    }
  }, [])

  const clearResult = useCallback(async () => {
    await window.cranberri.update.clearResult()
    setPendingResult(null)
  }, [])

  const subscribe = useCallback((cb: UpdateSubscriber) => {
    subscribers.add(cb)
    return () => subscribers.delete(cb)
  }, [subscribers])

  return {
    status,
    progress,
    pendingResult,
    checking,
    installing,
    check,
    install,
    clearResult,
    subscribe,
  }
}
