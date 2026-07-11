import { useEffect, useState } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  CODEX_APPROVAL_MODES,
  CODEX_MODELS,
  getCodexEffortsForModel,
  getCodexSpeedsForModel,
  normalizeCodexReasoningEffort,
  normalizeCodexSpeed,
  type CodexConnectionStatus,
} from '@/shared/codex'
import { useSettings } from '../../state/settings'
import { buttonStyle, cn, fieldStyle } from '../../lib/ui'
import { SettingsList, SettingsPage, SettingsRow, SettingsSection } from './settings-page'

const SELECT_CLASS = cn(fieldStyle, 'w-56 max-w-[45vw]')

function connectionActionLabel(status: CodexConnectionStatus | null, busy: boolean): string {
  if (busy) return status?.updateRequired ? 'Updating...' : 'Connecting...'
  if (status?.updateRequired) return 'Update Codex'
  if (status?.authenticated) return 'Connected'
  if (status?.installed === false) return 'Install Codex'
  return 'Connect'
}

export function GeneralSettings() {
  const { settings, updateSection } = useSettings()
  const [status, setStatus] = useState<CodexConnectionStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const efforts = getCodexEffortsForModel(settings.codex.defaultModel)
  const speeds = getCodexSpeedsForModel(settings.codex.defaultModel)

  useEffect(() => {
    window.cranberri.codex.getConnectionStatus()
      .then((next) => {
        setStatus(next)
        setConnectionError(null)
      })
      .catch((error) => setConnectionError(error instanceof Error ? error.message : 'Could not check Codex'))
  }, [])

  const connect = async () => {
    setConnecting(true)
    setConnectionError(null)
    try {
      const next = await window.cranberri.codex.connect()
      setStatus(next)
      toast.success(next.updateRequired ? 'Codex updated' : 'Codex connected')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not connect Codex'
      setConnectionError(message)
      toast.error(message)
      window.cranberri.codex.getConnectionStatus().then(setStatus).catch(() => undefined)
    } finally {
      setConnecting(false)
    }
  }

  const saveDefaults = async (values: Partial<typeof settings.codex>) => {
    try {
      await updateSection('codex', values)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save Codex defaults')
    }
  }

  const connectionDetail = connectionError
    ? 'Codex connection needs attention.'
    : status?.detail ?? 'Checking Codex connection...'

  return (
    <SettingsPage title="General" description="Defaults for new Codex tasks.">
      <SettingsSection title="Codex">
        <SettingsList>
          <SettingsRow label="Connection" description={connectionDetail}>
            {status?.authenticated && !status.updateRequired ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-app-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
              </span>
            ) : (
              <button
                type="button"
                onClick={() => void connect()}
                disabled={connecting}
                className={buttonStyle({ tone: status?.updateRequired ? 'primary' : 'secondary', size: 'small' })}
              >
                {connectionActionLabel(status, connecting)}
              </button>
            )}
          </SettingsRow>
        </SettingsList>
      </SettingsSection>

      <SettingsSection title="Task defaults" description="Applied when a task does not provide its own setting.">
        <SettingsList>
          <SettingsRow label="Model">
            <select
              aria-label="Default model"
              value={settings.codex.defaultModel}
              onChange={(event) => {
                const defaultModel = event.target.value
                void saveDefaults({
                  defaultModel,
                  defaultEffort: normalizeCodexReasoningEffort(defaultModel, settings.codex.defaultEffort),
                  defaultSpeed: normalizeCodexSpeed(defaultModel, settings.codex.defaultSpeed),
                })
              }}
              className={SELECT_CLASS}
            >
              {CODEX_MODELS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </SettingsRow>
          <SettingsRow label="Reasoning">
            <select
              aria-label="Default reasoning effort"
              value={settings.codex.defaultEffort}
              onChange={(event) => void saveDefaults({ defaultEffort: event.target.value as typeof settings.codex.defaultEffort })}
              className={SELECT_CLASS}
            >
              {efforts.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </SettingsRow>
          <SettingsRow label="Speed">
            <select
              aria-label="Default speed"
              value={settings.codex.defaultSpeed ?? 'standard'}
              onChange={(event) => void saveDefaults({ defaultSpeed: event.target.value as typeof settings.codex.defaultSpeed })}
              className={SELECT_CLASS}
            >
              {speeds.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </SettingsRow>
          <SettingsRow label="Approval policy">
            <select
              aria-label="Default approval mode"
              value={settings.codex.defaultApprovalMode}
              onChange={(event) => void saveDefaults({ defaultApprovalMode: event.target.value as typeof settings.codex.defaultApprovalMode })}
              className={SELECT_CLASS}
            >
              {CODEX_APPROVAL_MODES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </SettingsRow>
        </SettingsList>
      </SettingsSection>
    </SettingsPage>
  )
}
