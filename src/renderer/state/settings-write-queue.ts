import type { AppSettings } from '@/shared/settings'

type SettingsUpdate = (current: AppSettings) => AppSettings

export class SettingsWriteQueue {
  private current: AppSettings
  private tail: Promise<void> = Promise.resolve()
  private ready: boolean

  constructor(
    initial: AppSettings,
    private readonly persist: (settings: AppSettings) => Promise<AppSettings>,
    private readonly onSaved: (settings: AppSettings) => void,
    ready = true,
  ) {
    this.current = initial
    this.ready = ready
  }

  replace(settings: AppSettings): void {
    this.current = settings
    this.ready = true
  }

  enqueue(update: SettingsUpdate): Promise<void> {
    if (!this.ready) return Promise.reject(new Error('Settings must load before they can be changed'))
    const operation = this.tail.then(async () => {
      const saved = await this.persist(update(this.current))
      this.current = saved
      this.onSaved(saved)
    })
    this.tail = operation.catch(() => undefined)
    return operation
  }
}
