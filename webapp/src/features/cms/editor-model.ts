import type { StructuredTextDocument } from '@web-app-demo/contracts'
import type { ContentBlock } from '@web-app-demo/contracts'

export type BenefitIcon = 'check' | 'star' | 'shield' | 'spark'

export type BenefitItem = {
  title: string
  text: string
  icon: BenefitIcon
}

/** Blocks that can be inserted without first selecting an existing media or catalogue item. */
export type InsertableBlockType = Extract<
  ContentBlock['type'],
  'hero' | 'textImage' | 'benefits' | 'cta' | 'contacts' | 'formPlaceholder'
>

export function createEditorBlock(type: InsertableBlockType, id: string): ContentBlock {
  switch (type) {
    case 'hero':
      return {
        id,
        type,
        data: {
          eyebrow: 'Новый раздел',
          title: 'Новый первый экран',
          text: 'Расскажите посетителю, почему это важно.',
          primaryAction: { label: 'Подробнее', href: '/' },
        },
      }
    case 'textImage':
      return {
        id,
        type,
        data: {
          title: 'Новый раздел',
          content: { type: 'document', blocks: [{ type: 'paragraph', children: [{ type: 'text', text: 'Добавьте текст.', marks: [] }] }] },
          imageSide: 'right',
        },
      }
    case 'benefits':
      return {
        id,
        type,
        data: {
          title: 'Почему выбирают нас',
          items: [
            { title: 'Первое преимущество', text: 'Коротко опишите ценность.', icon: 'check' },
            { title: 'Второе преимущество', text: 'Коротко опишите ценность.', icon: 'star' },
          ],
        },
      }
    case 'cta':
      return {
        id,
        type,
        data: { title: 'Готовы начать?', text: 'Свяжитесь с нами, чтобы обсудить задачу.', primaryAction: { label: 'Связаться', href: '/' } },
      }
    case 'contacts':
      return {
        id,
        type,
        data: { title: 'Контакты', showAddress: true, showHours: true, showContacts: true, showSocials: false, showMap: false },
      }
    case 'formPlaceholder':
      return {
        id,
        type,
        data: { title: 'Свяжитесь с нами', text: 'Выберите удобный способ связи.', contactMethod: 'phone' },
      }
  }
}

export function duplicateEditorBlock(block: ContentBlock, id: string): ContentBlock {
  return { ...structuredClone(block), id }
}

export function moveEditorBlock(blocks: readonly ContentBlock[], index: number, direction: -1 | 1): ContentBlock[] {
  const target = index + direction
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return [...blocks]
  const next = [...blocks]
  const [block] = next.splice(index, 1)
  next.splice(target, 0, block)
  return next
}

export function removeEditorBlock(blocks: readonly ContentBlock[], index: number): ContentBlock[] {
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
