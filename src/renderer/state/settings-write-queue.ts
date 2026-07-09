import type { AppSettings } from '@/shared/settings'

type SettingsUpdate = (current: AppSettings) => AppSettings

export class SettingsWriteQueue {
  private current: AppSettings
  private tail: Promise<void> = Promise.resolve()

  constructor(
    initial: AppSettings,
    private readonly persist: (settings: AppSettings) => Promise<AppSettings>,
    private readonly onSaved: (settings: AppSettings) => void,
  ) {
    this.current = initial
  }

  replace(settings: AppSettings): void {
    this.current = settings
  }

  enqueue(update: SettingsUpdate): Promise<void> {
    const operation = this.tail.then(async () => {
      const saved = await this.persist(update(this.current))
      this.current = saved
      this.onSaved(saved)
    })
    this.tail = operation.catch(() => undefined)
    return operation
  }
}
