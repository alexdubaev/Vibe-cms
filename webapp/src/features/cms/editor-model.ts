import type { StructuredTextDocument } from '@web-app-demo/contracts'

export type BenefitIcon = 'check' | 'star' | 'shield' | 'spark'

export type BenefitItem = {
  title: string
  text: string
  icon: BenefitIcon
}

export function toggleMediaSelection(
  current: readonly string[],
  mediaId: string,
  selected: boolean,
  maximum = 20,
) {
  if (selected) {
    if (current.includes(mediaId) || current.length >= maximum) return [...current]
    return [...current, mediaId]
  }
  return current.filter((id) => id !== mediaId)
}

/**
 * Converts the supported structured-text subset into a compact editor-friendly
 * plain text representation. The helper deliberately ignores formatting while
 * preserving the visible order of paragraphs, headings, quotes, and lists.
 */
export function structuredTextToPlainText(value: unknown): string {
  if (!isRecord(value) || value.type !== 'document' || !Array.isArray(value.blocks)) return ''

  const lines: string[] = []
  for (const block of value.blocks) {
    if (!isRecord(block)) continue
    if (block.type === 'bulletList' || block.type === 'numberedList') {
      if (!Array.isArray(block.items)) continue
      for (const item of block.items) {
        const line = inlineChildrenToText(isRecord(item) ? item.children : undefined)
        if (line) lines.push(line)
      }
      continue
    }
    const line = inlineChildrenToText(block.children)
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

/**
 * Builds a schema-compatible paragraph document from the multiline editor
 * value. Empty lines are ignored and the contract's block/character limits are
 * applied before returning the value. An entirely empty editor is represented
 * by null so callers can keep the last valid document while the user is typing.
 */
export function plainTextToStructuredText(value: string): StructuredTextDocument | null {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  const blocks: StructuredTextDocument['blocks'] = []
  let remainingCharacters = 10_000

  for (const line of lines) {
    const text = line.trim().slice(0, Math.min(2_000, remainingCharacters))
    if (!text) continue
    blocks.push({ type: 'paragraph', children: [{ type: 'text', text, marks: [] }] })
    remainingCharacters -= text.length
    if (blocks.length >= 80 || remainingCharacters <= 0) break
  }

  return blocks.length > 0 ? { type: 'document', blocks } : null
}

export function updateBenefitItem(
  items: readonly BenefitItem[],
  index: number,
  patch: Partial<BenefitItem>,
): BenefitItem[] {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : { ...item }))
}

export function addBenefitItem(items: readonly BenefitItem[], maximum = 8): BenefitItem[] {
  const next = items.map((item) => ({ ...item }))
  if (next.length >= maximum) return next
  next.push({ title: 'Новое преимущество', text: 'Добавьте описание', icon: 'check' })
  return next
}

export function removeBenefitItem(items: readonly BenefitItem[], index: number, minimum = 2): BenefitItem[] {
  const next = items.map((item) => ({ ...item }))
  if (next.length <= minimum || index < 0 || index >= next.length) return next
  next.splice(index, 1)
  return next
}

function inlineChildrenToText(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .map((child) => {
      if (!isRecord(child)) return ''
      if (child.type === 'text' && typeof child.text === 'string') return child.text
      if (child.type === 'link' && typeof child.label === 'string') return child.label
      return ''
    })
    .join('')
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
