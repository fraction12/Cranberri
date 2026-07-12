import type { ReactNode } from 'react'
import { formatInlineCodexText, MentionPill } from './mention-pill'
import type { CodexSkillInfo } from '@/shared/codex'

const SKILL_INLINE_ICON = '📦'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function inlineSkillText(skill: CodexSkillInfo): string {
  return `${SKILL_INLINE_ICON} ${skill.displayName}`
}

export function inputHasSkill(input: string, skill: CodexSkillInfo): boolean {
  const promptLink = new RegExp(`\\[\\$${escapeRegExp(skill.name)}\\]\\(${escapeRegExp(skill.path)}\\)`)
  return promptLink.test(input) || new RegExp(`(^|\\s)${escapeRegExp(inlineSkillText(skill))}(?=\\s|$)`).test(input)
}

export function selectedSkillsFromInput(input: string, skills: CodexSkillInfo[]): CodexSkillInfo[] {
  return skills.filter((skill) => inputHasSkill(input, skill))
}

export function renderSkillText(text: string, skills: CodexSkillInfo[]): ReactNode[] {
  if (/\[[$@][^\]]+\]\([^)]+\)/.test(text)) return formatInlineCodexText(text)
  const selectedSkills = selectedSkillsFromInput(text, skills)
  if (selectedSkills.length === 0) return formatInlineCodexText(text)

  const pattern = new RegExp(`(${selectedSkills.map((skill) => escapeRegExp(inlineSkillText(skill))).join('|')})`, 'g')
  return text.split(pattern).map((part, index) => {
    const skill = selectedSkills.find((item) => inlineSkillText(item) === part)
    if (!skill) return <span key={index}>{formatInlineCodexText(part)}</span>
    return <MentionPill key={index} mention={{ kind: 'skill', label: skill.displayName }} />
  })
}
