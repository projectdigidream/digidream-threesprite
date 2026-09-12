import { describe, it, expect } from 'vitest'
import { askConfirm, askText, dialogStore, notice, resolveCurrent } from '../../core/ui/dialogs'

describe('in-app dialogs', () => {
  it('queues requests and resolves them in order', async () => {
    const p1 = askText('Name?', { defaultValue: 'x' })
    const p2 = askConfirm('Sure?')
    const p3 = notice('Done')
    expect(dialogStore.getState().queue.map(q => q.kind)).toEqual(['prompt', 'confirm', 'notice'])
    resolveCurrent('  walk  ')
    expect(await p1).toBe('walk')
    resolveCurrent(true)
    expect(await p2).toBe(true)
    resolveCurrent(undefined)
    await p3
    expect(dialogStore.getState().queue).toHaveLength(0)
  })

  it('cancelling a prompt yields null and a confirm yields false', async () => {
    const p = askText('Name?')
    resolveCurrent(null)
    expect(await p).toBeNull()
    const c = askConfirm('Sure?')
    resolveCurrent(false)
    expect(await c).toBe(false)
    resolveCurrent('nothing queued') // no-op
  })
})
