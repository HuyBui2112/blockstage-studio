import type { Texture } from 'three'

type Frame = { index: number; time: number }
export type TextureAnimation = {
  texture: Texture; frames: Frame[]; columns: number; rows: number;
  width: number; height: number; start: number; duration: number;
}

function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** PNG dimensions and metadata are available before the image decoder uploads the map. */
export function textureAnimation(texture: Texture, bytes: Uint8Array, metadata: unknown, start: number): TextureAnimation | undefined {
  if (!metadata || typeof metadata !== 'object' || !('animation' in metadata)) return undefined
  const input = metadata.animation
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid animation metadata')
  const a = input as Record<string, unknown>
  const signature = [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82]
  if (bytes.length < 24 || !signature.every((v, i) => bytes[i] === v)) throw new Error('Invalid animation PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16), height = view.getUint32(20)
  const w = a.width ?? (a.height === undefined ? Math.min(width, height) : width)
  const h = a.height ?? (a.width === undefined ? Math.min(width, height) : height)
  if (!positive(width) || !positive(height) || !positive(w) || !positive(h)) throw new Error('Invalid animation size')
  const columns = width / w, rows = height / h, count = columns * rows
  if (!positive(columns) || !positive(rows) || count > 4096) throw new Error('Invalid animation size')
  const time = a.frametime ?? 1
  if (!positive(time)) throw new Error('Invalid animation time')
  const source = a.frames ?? Array.from({ length: count }, (_, index) => index)
  if (!Array.isArray(source) || !source.length || source.length > 4096) throw new Error('Invalid animation frames')
  const frames: Frame[] = source.map(value => {
    const frame = typeof value === 'number' ? { index: value, time } : value
    if (!frame || typeof frame !== 'object') throw new Error('Invalid animation frame')
    const index: unknown = frame.index, duration: unknown = frame.time ?? time
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= count || !positive(duration)) throw new Error('Invalid animation frame')
    return { index, time: duration }
  })
  const duration = frames.reduce((sum, frame) => sum + frame.time, 0)
  if (!Number.isSafeInteger(duration)) throw new Error('Invalid animation duration')
  const animation = { texture, frames, columns, rows, width, height, start, duration }
  updateTextureAnimation(animation, start)
  return animation
}

export function updateTextureAnimation(a: TextureAnimation, time: number) {
  let tick = Math.floor(Math.max(0, time - a.start) / 50) % a.duration
  let index = a.frames[0].index
  for (const frame of a.frames) {
    index = frame.index
    if (tick < frame.time) break
    tick -= frame.time
  }
  // Nearest filtering at an exact internal sprite edge can sample the adjacent
  // frame. A hundredth of a texel inset stays inside this frame even after the
  // GPU rounds the UV matrix, without visibly shrinking its edge pixels.
  const padX = .01 / a.width, padY = .01 / a.height
  a.texture.repeat.set(1 / a.columns - 2 * padX, 1 / a.rows - 2 * padY)
  a.texture.offset.set((index % a.columns) / a.columns + padX, 1 - (Math.floor(index / a.columns) + 1) / a.rows + padY)
}
