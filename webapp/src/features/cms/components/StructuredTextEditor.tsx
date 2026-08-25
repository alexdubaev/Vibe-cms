import type { StructuredTextDocument } from '@web-app-demo/contracts'
import { useState } from 'react'

import { Typography } from '@/components/typography'
import { Textarea } from '@/components/ui/textarea'

import { editorTextToStructuredText, structuredTextToEditorText } from '../editor-model'

export function StructuredTextEditor({
  id,
  onChange,
  value,
}: {
  id: string
  onChange: (value: StructuredTextDocument) => void
  value: unknown
}) {
  const [invalid, setInvalid] = useState(false)

  return (
    <div className="grid gap-2">
      <Textarea
        aria-describedby={`${id}-hint${invalid ? ` ${id}-error` : ''}`}
        aria-invalid={invalid}
        defaultValue={structuredTextToEditorText(value)}
        id={id}
        onChange={(event) => {
          const next = editorTextToStructuredText(event.target.value)
          if (!next) {
            setInvalid(event.target.value.trim().length > 0)
            return
          }
          setInvalid(false)
          onChange(next)
        }}
        placeholder="Добавьте текст или начните строку с ##, -, >"
        rows={8}
      />
      <Typography id={`${id}-hint`} tone="muted" variant="caption">
        Поддерживаются заголовки с ##, списки с - и 1., цитаты с &gt;, **жирный**, _курсив_ и ссылки [текст](адрес).
      </Typography>
      {invalid && (
        <Typography id={`${id}-error`} role="alert" tone="destructive" variant="caption">
          Проверьте формат ссылки и убедитесь, что она ведёт на внутренний путь или безопасный HTTPS-адрес.
        </Typography>
      )}
    </div>
  )
}
