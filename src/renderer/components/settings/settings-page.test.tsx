import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingsDisclosure, SettingsList, SettingsPage, SettingsRow, SettingsSection } from './settings-page'

describe('settings typography hierarchy', () => {
  it('assigns semantic roles and tones to equivalent settings copy', () => {
    const html = renderToStaticMarkup(
      <SettingsPage title="General" description="Defaults for new tasks.">
        <SettingsSection title="Codex" description="Connection defaults.">
          <SettingsList>
            <SettingsRow label="Model" description="Used for new tasks.">
              <span>GPT-5</span>
            </SettingsRow>
          </SettingsList>
          <SettingsDisclosure title="Advanced" description="Optional">
            <span>Details</span>
          </SettingsDisclosure>
        </SettingsSection>
      </SettingsPage>,
    )

    expect(html).toContain('type-page-title')
    expect(html).toContain('type-panel-title')
    expect(html).toContain('type-body')
    expect(html).toContain('type-control')
    expect(html).toContain('type-metadata')
    expect(html).toContain('text-app-text-secondary')
  })
})
