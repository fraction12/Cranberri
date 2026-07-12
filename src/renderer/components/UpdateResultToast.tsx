import { useEffect } from 'react'
import { toast } from 'sonner'
import { useUpdate } from '../state/update'

export function UpdateResultToast() {
  const { pendingResult } = useUpdate()

  useEffect(() => {
    if (!pendingResult) return
    const message = pendingResult.message ?? (pendingResult.success ? 'Update installed' : 'Update failed')
    if (pendingResult.success) toast.success(message)
    else toast.error(message)
  }, [pendingResult])

  return null
}
