import type { CmsBlockContractDefinition, CmsBlockEditorDescriptor } from '@web-app-demo/contracts'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Typography } from '@/components/typography'
import type { BlockEditorProps } from './registry'

export type DescriptorBlockEditorProps = BlockEditorProps & {
  definition: CmsBlockContractDefinition
}

export function DescriptorBlockEditor({ block, definition, onChange }: DescriptorBlockEditorProps) {
  const data = asRecord(block.data)
  const descriptor = definition.editor

  return (
    <div className="mt-3 grid gap-3 border-t pt-3">
      {descriptor.fields.map((field) => {
        const id = `cms-block-${block.id}-${field.key}`
        const hintId = `${id}-hint`
        const errorId = `${id}-error`
        const error = descriptorFieldError(field, data[field.key])
        const describedBy = error ? `${hintId} ${errorId}` : hintId
        const hint = descriptorFieldHint(field)

        return (
          <div className="grid gap-2" key={field.key}>
            <Label htmlFor={id}>{field.label}</Label>
            <Input
              aria-describedby={describedBy}
              aria-invalid={error ? true : undefined}
              id={id}
              max={field.kind === 'number' ? field.max : undefined}
              maxLength={field.kind === 'text' ? field.max : undefined}
              min={field.kind === 'number' ? field.min : undefined}
              minLength={field.kind === 'text' ? field.min : undefined}
              onChange={(event) => onChange(updateDescriptorValue(data, field, event.target.value))}
              required={field.required}
              type={field.kind === 'number' ? 'number' : 'text'}
              value={fieldValue(data[field.key], field.kind)}
            />
            <Typography id={hintId} tone="muted" variant="caption">{hint}</Typography>
            {error && <Typography id={errorId} role="alert" tone="destructive" variant="caption">{error}</Typography>}
          </div>
        )
      })}
    </div>
  )
}

type DescriptorField = CmsBlockEditorDescriptor['fields'][number]

function updateDescriptorValue(
  data: Record<string, unknown>,
  field: DescriptorField,
  rawValue: string,
) {
  const next = { ...data }
  if (rawValue === '' && !field.required) {
    delete next[field.key]
    return next
  }
  next[field.key] = field.kind === 'number' ? Number(rawValue) : rawValue
  return next
}

function descriptorFieldHint(field: DescriptorField) {
  if (field.min !== undefined && field.max !== undefined) return `От ${field.min} до ${field.max}`
  if (field.min !== undefined) return `Не меньше ${field.min}`
  if (field.max !== undefined) return `Не больше ${field.max}`
  return field.required ? 'Обязательное поле' : 'Необязательное поле'
}

function descriptorFieldError(field: DescriptorField, value: unknown) {
  if (field.required && (value === undefined || value === null || value === '')) return 'Обязательное поле'
  if (value === undefined || value === null || value === '') return undefined
  if (field.kind === 'text') {
    if (typeof value !== 'string') return 'Введите текст'
    if (field.min !== undefined && value.length < field.min) return `Введите не меньше ${field.min} символов`
    if (field.max !== undefined && value.length > field.max) return `Введите не больше ${field.max} символов`
    return undefined
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Введите число'
  if (field.min !== undefined && value < field.min) return `Значение должно быть не меньше ${field.min}`
  if (field.max !== undefined && value > field.max) return `Значение должно быть не больше ${field.max}`
  return undefined
}

function fieldValue(value: unknown, kind: DescriptorField['kind']) {
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value) ? value : ''
  return typeof value === 'string' ? value : ''
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
