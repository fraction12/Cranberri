import type { ReactNode } from 'react'
import { formatInlineCodexText, MentionPill } from './Transcript'
import type { CodexSkillInfo, CodexUserInput } from '@/shared/codex'

const SKILL_INLINE_ICON = '📦'
type TextInputElements = NonNullable<Extract<CodexUserInput, { type: 'text' }>['text_elements']>

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function inlineSkillText(skill: CodexSkillInfo): string {
  return `${SKILL_INLINE_ICON} ${skill.displayName}`
}

export function inputHasSkill(input: string, skill: CodexSkillInfo): boolean {
  return new RegExp(`(^|\\s)${escapeRegExp(inlineSkillText(skill))}(?=\\s|$)`).test(input)
}

export function selectedSkillsFromInput(input: string, skills: CodexSkillInfo[]): CodexSkillInfo[] {
  return skills.filter((skill) => inputHasSkill(input, skill))
}

export function skillTextElements(text: string, skills: CodexSkillInfo[]): TextInputElements {
  const encoder = new TextEncoder()
  return skills.flatMap((skill) => {
    const token = inlineSkillText(skill)
    const elements: TextInputElements = []
    let offset = text.indexOf(token)
    while (offset !== -1) {
      elements.push({
        byteRange: {
          start: encoder.encode(text.slice(0, offset)).length,
          end: encoder.encode(text.slice(0, offset + token.length)).length,
        },
        placeholder: token,
      })
      offset = text.indexOf(token, offset + token.length)
    }
    return elements
  })
}

export function renderSkillText(text: string, skills: CodexSkillInfo[]): ReactNode[] {
  const selectedSkills = selectedSkillsFromInput(text, skills)
  if (selectedSkills.length === 0) return formatInlineCodexText(text)

  const pattern = new RegExp(`(${selectedSkills.map((skill) => escapeRegExp(inlineSkillText(skill))).join('|')})`, 'g')
  return text.split(pattern).map((part, index) => {
    const skill = selectedSkills.find((item) => inlineSkillText(item) === part)
    if (!skill) return <span key={index}>{formatInlineCodexText(part)}</span>
    return <MentionPill key={index} mention={{ kind: 'skill', label: skill.displayName }} />
  })
}

export function renderComposerText(input: string, skills: CodexSkillInfo[]): ReactNode[] {
  return renderSkillText(input, skills)
}
