export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error'

export type AutosaveSnapshot<Draft> = {
  status: AutosaveStatus
  revision: number | null
  conflictDraft?: Draft
  error?: unknown
}

export type SerializedAutosave<Draft extends { expectedRevision: number }, Saved extends { draftRevision: number }> = {
  enqueue(draft: Draft): void
  flush(): Promise<Saved | undefined>
  snapshot(): AutosaveSnapshot<Draft>
  dispose(): void
}

/**
 * Keeps draft writes in order while collapsing edits made during an in-flight request.
 * A conflict is terminal for the queued pass: the exact local draft remains available so the UI
 * can show it and let the editor choose whether to reload or overwrite intentionally.
 */
export function createSerializedAutosave<
  Draft extends { expectedRevision: number },
  Saved extends { draftRevision: number },
>(input: {
  save(draft: Draft): Promise<Saved>
  onStateChange?: (snapshot: AutosaveSnapshot<Draft>) => void
}): SerializedAutosave<Draft, Saved> {
  let pending: Draft | undefined
  let running: Promise<Saved | undefined> | undefined
  let disposed = false
  let revision: number | null = null
  let state: AutosaveSnapshot<Draft> = { status: 'idle', revision }

  const publish = (next: AutosaveSnapshot<Draft>) => {
    state = next
    input.onStateChange?.(next)
  }

  const flush = async (): Promise<Saved | undefined> => {
    if (disposed) return undefined
    if (running) return running
    if (!pending) return undefined

    running = (async () => {
      let latestSaved: Saved | undefined
      while (pending && !disposed) {
        const queued = pending
        pending = undefined
        const draft = revision === null ? queued : { ...queued, expectedRevision: revision }
        publish({ status: 'saving', revision })

        try {
          const saved = await input.save(draft)
          latestSaved = saved
          if (disposed) break
          revision = saved.draftRevision
          publish({ status: 'saved', revision })
        } catch (error) {
          if (isConflict(error)) {
            publish({ status: 'conflict', revision, conflictDraft: draft, error })
          } else {
            publish({ status: 'error', revision, error })
          }
          pending = undefined
          break
        }
      }
      return latestSaved
    })().finally(() => {
      running = undefined
    })

    return running
  }

  return {
    enqueue(draft) {
      if (disposed) return
      pending = draft
      publish({ status: 'dirty', revision })
    },
    flush,
    snapshot: () => state,
    dispose() {
      disposed = true
      pending = undefined
    },
  }
}

function isConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; status?: unknown }
  return value.code === 'CMS_CONFLICT' || value.status === 409
}
