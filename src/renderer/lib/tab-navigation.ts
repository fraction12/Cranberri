import type { KeyboardEvent as ReactKeyboardEvent } from 'react'

export function nextTabIndex(current: number, count: number, key: string): number | null {
  if (count <= 0 || current < 0 || current >= count) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key === 'ArrowRight' || key === 'ArrowDown') return (current + 1) % count
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (current - 1 + count) % count
  return null
}

export function handleTabListKeyDown(event: ReactKeyboardEvent<HTMLElement>): void {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[role="tab"]') : null
  if (!target) return
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'))
  const next = nextTabIndex(tabs.indexOf(target), tabs.length, event.key)
  if (next === null) return
  event.preventDefault()
  tabs[next]?.focus()
  tabs[next]?.click()
}
