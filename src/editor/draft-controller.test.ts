import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { newEditorDocument } from './model'
import { createDraftController, type DraftStatus } from './draft-controller'
import type { DraftWrite } from '../io/draft-repository'
import type { DraftHead } from '../io/draft-storage'

function request(revision = 1, id = 'draft-a'): DraftWrite {
  const document = newEditorDocument()
  document.id = 'document-a'
  return { id, epoch: id, documentId: document.id, workspace: document.workspace, document, revision, base: null }
}
const ack = (value: DraftWrite): DraftHead => ({ id: value.id, epoch: value.epoch, documentId: value.documentId, workspace: value.workspace, revision: value.revision, base: value.base, name: value.document.name, bytes: 1, cells: 0, updatedAt: Date.now(), status: 'live' })
function deferred() {
  let resolve!: (value: DraftHead) => void
  const promise = new Promise<DraftHead>(done => { resolve = done })
  return { promise, resolve }
}
describe('draft controller scheduling and acknowledgements', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10000) })
  afterEach(() => vi.useRealTimers())
  it('coalesces latest committed revision without writing repeated UI notifications', async () => {
    const write = vi.fn(async (value: DraftWrite) => ack(value)), statuses: DraftStatus[] = []
    const controller = createDraftController({ write, onStatus: value => statuses.push(value) })
    const first = request()
    controller.update(first)
    await vi.advanceTimersByTimeAsync(500)
    controller.update({ ...first, revision: 2 })
    controller.update({ ...first, revision: 2 })
    await vi.advanceTimersByTimeAsync(749)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0].revision).toBe(2)
    expect(controller.status).toEqual({ phase: 'protected', revision: 2 })
    expect(statuses.filter(value => value.phase === 'pending')).toHaveLength(2)
    controller.stop()
  })
  it('enforces a maximum delay while edits continue', async () => {
    const write = vi.fn(async (value: DraftWrite) => ack(value))
    const controller = createDraftController({ write, onStatus: () => {} })
    for (let revision = 1; revision <= 10; revision++) { controller.update(request(revision)); await vi.advanceTimersByTimeAsync(500) }
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0].revision).toBe(10)
    controller.stop()
  })
  it('keeps only the latest edit during a slow write; an old ack does not protect the latest edit', async () => {
    const first = deferred(), write = vi.fn((value: DraftWrite) => value.revision === 1 ? first.promise : Promise.resolve(ack(value)))
    const controller = createDraftController({ write, onStatus: () => {} })
    controller.update(request())
    await vi.advanceTimersByTimeAsync(750)
    controller.update(request(2)); controller.update(request(3))
    first.resolve(ack(request()))
    await vi.advanceTimersByTimeAsync(0)
    expect(controller.status).toEqual({ phase: 'pending', revision: 3 })
    expect(await controller.flush()).toBe(true)
    expect(write.mock.calls.map(([value]) => value.revision)).toEqual([1, 3])
    expect(controller.status).toEqual({ phase: 'protected', revision: 3 })
    controller.stop()
  })
  it('pauses pending work for Save/lifecycle, then resumes the new stream', async () => {
    const write = vi.fn(async (value: DraftWrite) => ack(value))
    const controller = createDraftController({ write, onStatus: () => {} })
    controller.update(request())
    await controller.pause()
    controller.update(request(2, 'new-stream'))
    await vi.advanceTimersByTimeAsync(6000)
    expect(write).not.toHaveBeenCalled()
    controller.resume()
    await vi.advanceTimersByTimeAsync(0)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0].id).toBe('new-stream')
    controller.stop()
  })
  it('ignores an old session ack after switching identity', async () => {
    const first = deferred(), write = vi.fn((value: DraftWrite) => value.id === 'draft-a' ? first.promise : Promise.resolve(ack(value)))
    const statuses: DraftStatus[] = []
    const controller = createDraftController({ write, onStatus: value => statuses.push(value) })
    controller.update(request())
    await vi.advanceTimersByTimeAsync(750)
    controller.update(request(1, 'draft-b'))
    first.resolve(ack(request()))
    await vi.advanceTimersByTimeAsync(0)
    expect(statuses.filter(value => value.phase === 'protected')).toEqual([])
    await controller.flush()
    expect(write.mock.calls[1][0].id).toBe('draft-b')
    controller.stop()
  })
  it('retains latest data on failure, requires retry, and never spins on quota errors', async () => {
    const write = vi.fn(async (value: DraftWrite) => { if (write.mock.calls.length === 1) throw new Error('QuotaExceeded'); return ack(value) })
    const controller = createDraftController({ write, onStatus: () => {} })
    controller.update(request())
    await vi.advanceTimersByTimeAsync(750)
    controller.update(request(4))
    await vi.advanceTimersByTimeAsync(30000)
    expect(write).toHaveBeenCalledTimes(1)
    expect(controller.status.phase).toBe('error')
    expect(await controller.retry()).toBe(true)
    expect(write.mock.calls[1][0].revision).toBe(4)
    controller.stop()
  })
  it('adopts an atomic recovery without writing a duplicate revision', async () => {
    const write = vi.fn(async (value: DraftWrite) => ack(value))
    const controller = createDraftController({ write, onStatus: () => {} })
    controller.adopt(request())
    controller.update(request())
    await vi.advanceTimersByTimeAsync(5000)
    expect(write).not.toHaveBeenCalled()
    expect(controller.status.phase).toBe('protected')
    controller.stop()
  })
  it('cancels pristine/clean work and stops timers/callbacks at the ownership boundary', async () => {
    const write = vi.fn(async (value: DraftWrite) => ack(value)), onStatus = vi.fn()
    const controller = createDraftController({ write, onStatus })
    controller.update(request()); controller.update(null)
    await vi.advanceTimersByTimeAsync(1000)
    expect(write).not.toHaveBeenCalled()
    controller.update(request()); controller.stop()
    const count = onStatus.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(write).not.toHaveBeenCalled()
    expect(onStatus).toHaveBeenCalledTimes(count)
    expect(vi.getTimerCount()).toBe(0)
  })
})
