import {
  structuredTextDocumentSchema,
  type RegisteredContentBlock,
  type StructuredTextDocument,
} from '@web-app-demo/contracts'

import { createAdminBlock } from './site-package/registry'

export type BenefitIcon = 'check' | 'star' | 'shield' | 'spark'

export type BenefitItem = {
  title: string
  text: string
  icon: BenefitIcon
}

export function createEditorBlock(type: string, id: string): RegisteredContentBlock {
  return createAdminBlock(type, id)
}

export function duplicateEditorBlock(block: RegisteredContentBlock, id: string): RegisteredContentBlock {
  return { ...structuredClone(block), id }
}

export function moveEditorBlock(
  blocks: readonly RegisteredContentBlock[],
  index: number,
  direction: -1 | 1,
): RegisteredContentBlock[] {
  const target = index + direction
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return [...blocks]
  const next = [...blocks]
  const [block] = next.splice(index, 1)
  next.splice(target, 0, block)
  return next
}

export function removeEditorBlock(blocks: readonly RegisteredContentBlock[], index: number): RegisteredContentBlock[] {
  if (blocks.length <= 1 || index < 0 || index >= blocks.length) return [...blocks]
  return blocks.filter((_, blockIndex) => blockIndex !== index)
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

/**
 * Converts the small, human-readable editor notation into the public-safe
 * structured-text contract. The notation keeps formatting discoverable without
 * exposing JSON: `##`/`###` headings, `-`/`1.` lists, `>` quotes, `**bold**`,
 * `_italic_`, and `[label](url)` links.
 */
export function editorTextToStructuredText(value: string): StructuredTextDocument | null {
  if (/\]\(\s*(?:javascript|data|vbscript):/i.test(value)) return null

  const blocks: unknown[] = []
  let paragraphLines: string[] = []
  let list: { type: 'bulletList' | 'numberedList'; items: unknown[] } | null = null

  const flushParagraph = () => {
    const text = paragraphLines.join('\n').trim()
    paragraphLines = []
    if (!text) return
    blocks.push({ type: 'paragraph', children: parseInlineText(text) })
  }

  const flushList = () => {
    if (list && list.items.length > 0) blocks.push(list)
    list = null
  }

  const flushInlineContent = () => {
    flushParagraph()
    flushList()
  }

  for (const rawLine of value.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushInlineContent()
      continue
    }

    const heading = line.match(/^(#{2,3})\s+(.+)$/)
    if (heading) {
      flushInlineContent()
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        children: parseInlineText(heading[2]),
      })
      continue
    }

    const quote = line.match(/^>\s*(.+)$/)
    if (quote) {
      flushInlineContent()
      blocks.push({ type: 'quote', children: parseInlineText(quote[1]) })
      continue
    }

    const bullet = line.match(/^[-*]\s+(.+)$/)
    const numbered = line.match(/^\d+[.)]\s+(.+)$/)
    if (bullet || numbered) {
      flushParagraph()
      const type = bullet ? 'bulletList' : 'numberedList'
      if (!list || list.type !== type) {
        flushList()
        list = { type, items: [] }
      }
      list.items.push({ type: 'listItem', children: parseInlineText((bullet ?? numbered)![1]) })
      continue
    }

    flushList()
    paragraphLines.push(rawLine)
  }

  flushInlineContent()
  try {
    const parsed = structuredTextDocumentSchema.safeParse({ type: 'document', blocks })
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** Serialises a valid structured-text document back to the editor notation. */
export function structuredTextToEditorText(value: unknown): string {
  const parsed = structuredTextDocumentSchema.safeParse(value)
  if (!parsed.success) return ''

  return parsed.data.blocks
    .map((block) => {
      switch (block.type) {
        case 'paragraph':
          return inlineNodesToEditorText(block.children)
        case 'heading':
          return `${'#'.repeat(block.level)} ${inlineNodesToEditorText(block.children)}`
        case 'quote':
          return `> ${inlineNodesToEditorText(block.children)}`
        case 'bulletList':
          return block.items.map((item) => `- ${inlineNodesToEditorText(item.children)}`).join('\n')
        case 'numberedList':
          return block.items.map((item, index) => `${index + 1}. ${inlineNodesToEditorText(item.children)}`).join('\n')
      }
    })
    .join('\n\n')
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

function parseInlineText(value: string): unknown[] {
  const nodes: unknown[] = []
  const pattern = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|_[^_]+_|\[[^\]]+\]\([^)]*\))/g
  let cursor = 0

  for (const match of value.matchAll(pattern)) {
    const token = match[0]
    const index = match.index ?? 0
    if (index > cursor) nodes.push({ type: 'text', text: value.slice(cursor, index), marks: [] })

    if (token.startsWith('[')) {
      const link = token.match(/^\[([^\]]+)\]\(([^)]*)\)$/)
      if (link) nodes.push({ type: 'link', label: link[1], href: link[2] })
    } else if (token.startsWith('***')) {
      nodes.push({ type: 'text', text: token.slice(3, -3), marks: ['bold', 'italic'] })
    } else if (token.startsWith('**')) {
      nodes.push({ type: 'text', text: token.slice(2, -2), marks: ['bold'] })
    } else {
      nodes.push({ type: 'text', text: token.slice(1, -1), marks: ['italic'] })
    }
    cursor = index + token.length
  }

  if (cursor < value.length) nodes.push({ type: 'text', text: value.slice(cursor), marks: [] })
  return nodes.filter((node) => {
    if (!isRecord(node)) return false
    return node.type === 'link' || (typeof node.text === 'string' && node.text.length > 0)
  })
}

function inlineNodesToEditorText(nodes: readonly unknown[]): string {
  return nodes.map((node) => {
    if (!isRecord(node)) return ''
    if (node.type === 'link' && typeof node.label === 'string' && typeof node.href === 'string') {
      return `[${node.label}](${node.href})`
    }
    if (node.type !== 'text' || typeof node.text !== 'string') return ''
    const marks = Array.isArray(node.marks) ? node.marks : []
    const bold = marks.includes('bold')
    const italic = marks.includes('italic')
    if (bold && italic) return `***${node.text}***`
    if (bold) return `**${node.text}**`
    if (italic) return `_${node.text}_`
    return node.text
  }).join('')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
