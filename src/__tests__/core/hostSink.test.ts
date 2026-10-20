import { afterEach, describe, expect, it, vi } from 'vitest'
import { getSink } from '../../core/io/sink'
import { downloadBytes } from '../../core/io/browserDownload'

const w = window as unknown as { threespriteHost?: unknown }

describe('an embedding host takes file import and export', () => {
  afterEach(() => { delete w.threespriteHost })

  it('opens and saves through the host, and downloads too', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const host = { open: vi.fn(async () => ({ name: 'a.png', bytes })), save: vi.fn(async () => true) }
    w.threespriteHost = host
    const sink = getSink()
    expect(await sink.pickOpen(['png'], 'Import')).toEqual({ handle: { name: 'a.png' }, bytes })
    expect(host.open).toHaveBeenCalledWith(['png'], 'Import')
    await sink.write(await sink.pickSave('x.gpl', 'gpl') as { name: string }, bytes)
    downloadBytes('y.zip', bytes)
    expect(host.save.mock.calls.map(c => c[0])).toEqual(['x.gpl', 'y.zip'])
  })

  it('CONTROL: without a host the browser sink answers', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    URL.createObjectURL ??= () => 'blob:x'
    downloadBytes('y.zip', new Uint8Array([1]))
    expect(click).toHaveBeenCalledTimes(1)
    await expect(getSink().read({ name: 'x' })).rejects.toThrow(/browser/)
  })
})
