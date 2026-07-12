import type { ReactNode } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import { AddMenu } from './AddMenu'
import { ApprovalSelector } from './ApprovalSelector'
import { AttachmentChips } from './AttachmentChips'
import { ComposerEditor } from './ComposerEditor'
import { ComposerSuggestionMenu } from './ComposerSuggestionMenu'
import { ContextInputChips } from './ContextInputChips'
import { ContextWindowIndicator } from './ContextWindowIndicator'
import { GoalModePill } from './GoalModePill'
import { ModelSelector } from './ModelSelector'
import { PlanModePill } from './PlanModePill'
import { VoiceDictationButton } from './VoiceDictationButton'
import type { ChatComposerController } from '../../state/use-chat-composer'

const COMPOSER_SCRIM_CLASS = [
  'pointer-events-none absolute inset-x-0 bottom-0 z-[900] bg-gradient-to-t',
  'from-[var(--app-bg)] via-[var(--app-bg)]/95 to-transparent px-4 pb-4 pt-14 sm:px-6',
].join(' ')
const COMPOSER_CARD_CLASS = [
  'pointer-events-auto relative mx-auto w-full max-w-[780px] rounded-[18px]',
  'bg-app-surface p-3 shadow-xl ring-1 ring-app-border/75 transition-shadow duration-fast ease-standard focus-within:ring-2 focus-within:ring-app-accent/40',
].join(' ')
const SEND_BUTTON_CLASS = [
  'flex h-8 w-8 items-center justify-center rounded-full bg-app-text text-app-bg',
  'transition-colors duration-fast ease-standard hover:bg-app-text/85 disabled:pointer-events-none disabled:opacity-35',
].join(' ')

export function ChatComposer({
  composer,
  contextUsage,
  isRunning,
  isWorkerThread,
  threadId,
  inputBlockReason,
  setupStatus,
}: {
  composer: ChatComposerController
  contextUsage: { usedTokens: number; contextWindow: number }
  isRunning: boolean
  isWorkerThread: boolean
  threadId: string | null
  inputBlockReason: string | null
  setupStatus?: ReactNode
}) {
  return (
    <div className={COMPOSER_SCRIM_CLASS}>
      <div
        ref={composer.composerRef}
        data-chat-composer="true"
        onFocusCapture={() => composer.setComposerFocused(true)}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget as Node | null
          if (nextTarget && composer.composerRef.current?.contains(nextTarget)) return
          composer.setComposerFocused(false)
        }}
        className={COMPOSER_CARD_CLASS}
      >
        <AttachmentChips attachments={composer.attachments} onRemove={composer.removeAttachment} />
        {setupStatus}
        <ContextInputChips attachments={composer.contextInputParts} onRemove={composer.removeContextInput} />
        {composer.showSuggestions && (
          <ComposerSuggestionMenu
            title={composer.suggestionTitle}
            suggestions={composer.suggestions}
            activeIndex={Math.min(composer.suggestionIndex, composer.suggestions.length - 1)}
            usedTokens={contextUsage.usedTokens}
            contextWindow={contextUsage.contextWindow}
            onSelect={composer.insertSuggestion}
          />
        )}
        <ComposerEditor
          ref={composer.editorRef}
          value={composer.input}
          catalog={composer.composerCatalog}
          disabled={Boolean(inputBlockReason)}
          onChange={composer.setInputSnapshot}
          onTriggerChange={composer.setTrigger}
          onSubmit={() => { void composer.submit() }}
          onSuggestionKeyDown={composer.handleSuggestionKeyDown}
          onPaste={composer.addTransferInputs}
          onDrop={composer.addTransferInputs}
          placeholder={
            isRunning
              ? isWorkerThread
                ? 'Steer this worker through its parent...'
                : 'Send a follow-up while Codex works...'
              : composer.goalMode
                ? 'Describe your goal, define measurable outcomes for best results'
                : inputBlockReason
                  ? inputBlockReason
                  : threadId
                    ? 'Ask for follow-up changes'
                    : 'Ask Codex to inspect, edit, or explain this repo'
          }
        />
        <div data-composer-toolbar="true" className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[var(--app-text-muted)]">
          <div className="flex shrink-0 items-center gap-3">
            <AddMenu
              onAttachFiles={() => { void composer.attachFiles() }}
              onGoal={() => {
                composer.setGoalMode((current) => {
                  const next = !current
                  if (next) composer.setPlanMode(false)
                  return next
                })
              }}
              onPlanMode={() => {
                composer.setPlanMode((current) => {
                  const next = !current
                  if (next) composer.setGoalMode(false)
                  return next
                })
              }}
              onPlugin={composer.usePlugin}
            />
            <ApprovalSelector
              value={composer.turnSettings.approvalMode ?? 'custom'}
              onChange={(approvalMode) => composer.setTurnSettings((current) => ({ ...current, approvalMode }))}
            />
            {composer.goalMode && <GoalModePill onRemove={() => composer.setGoalMode(false)} />}
            {composer.planMode && <PlanModePill onRemove={() => composer.setPlanMode(false)} />}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 xl:gap-3">
            <ContextWindowIndicator usedTokens={contextUsage.usedTokens} contextWindow={contextUsage.contextWindow} />
            <ModelSelector settings={composer.turnSettings} onChange={composer.setTurnSettings} />
            <VoiceDictationButton listening={composer.voiceListening} onClick={composer.toggleVoiceDictation} />
            <button
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { void composer.primaryAction() }}
              disabled={composer.primaryActionIsStop ? !threadId : !composer.hasContent || Boolean(inputBlockReason)}
              className={SEND_BUTTON_CLASS}
              aria-label={composer.primaryActionIsStop ? 'Stop Codex' : 'Send message'}
              title={composer.primaryActionIsStop ? 'Stop Codex' : 'Send message'}
            >
              {composer.primaryActionIsStop ? <Square className="h-3 w-3 fill-current" /> : <ArrowUp className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
