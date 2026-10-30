import { describe, expect, it } from 'vitest'
import { Texture } from 'three'
import { textureAnimation, updateTextureAnimation } from './texture-animation'

function png(width: number, height: number) {
  const bytes = new Uint8Array(24)
  bytes.set([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82])
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width); view.setUint32(20, height)
  return bytes
}

// The upload flips PNG rows; mapTransform operates on the model's bottom-up UVs.
function sampledPixel(texture: Texture, width: number, height: number, u: number, v: number) {
  texture.updateMatrix()
  const m = texture.matrix.elements.map(Math.fround)
  const x = Math.fround(Math.fround(u * m[0]) + m[6])
  const y = Math.fround(Math.fround(v * m[4]) + m[7])
  return [Math.floor(x * width), Math.floor((1 - y) * height)]
}

describe('texture sprite frames', () => {
  it.each([[16,48,8,3], [16,128,2,8]])('crops every vanilla lantern/fire frame without sampling its neighboring frame (%sx%s)', (width, height, frametime, count) => {
    const texture = new Texture()
    const animation = textureAnimation(texture, png(width, height), { animation: { frametime } }, 0)!
    expect([animation.columns, animation.rows]).toEqual([1, count])
    for (let frame = 0; frame < count; frame++) {
      updateTextureAnimation(animation, frame * frametime * 50)
      for (const u of [0, 1]) for (const v of [0, 1]) {
        const [x, y] = sampledPixel(texture, width, height, u, v)
        expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(width)
        expect(y).toBeGreaterThanOrEqual(frame * 16); expect(y).toBeLessThan((frame + 1) * 16)
      }
    }
    updateTextureAnimation(animation, count * frametime * 50)
    expect(sampledPixel(texture, width, height, 0, 1)[1]).toBe(0)
  })

  it('applies the first specified frame before decode and honors custom frame duration, sequence and loop', () => {
    const texture = new Texture()
    const animation = textureAnimation(texture, png(32, 32), { animation: { width:16, height:16, frametime:2, frames:[3, {index:0,time:1}, 2] } }, 100)!
    const pixel = () => sampledPixel(texture, 32, 32, 0, 1)
    expect(pixel()).toEqual([16,16])
    updateTextureAnimation(animation, 199); expect(pixel()).toEqual([16,16])
    updateTextureAnimation(animation, 200); expect(pixel()).toEqual([0,0])
    updateTextureAnimation(animation, 250); expect(pixel()).toEqual([0,16])
    updateTextureAnimation(animation, 350); expect(pixel()).toEqual([16,16])
    updateTextureAnimation(animation, 50); expect(pixel()).toEqual([16,16])
  })

  it('supports width-only and height-only strips, and PNG views with a nonzero byte offset', () => {
    const bytes = new Uint8Array(32); bytes.set(png(32, 16), 8)
    const horizontal = textureAnimation(new Texture(), bytes.subarray(8), { animation: { width:16 } }, 0)!
    expect([horizontal.columns,horizontal.rows]).toEqual([2,1])
    const vertical = textureAnimation(new Texture(), png(16, 32), { animation: { height:16 } }, 0)!
    expect([vertical.columns,vertical.rows]).toEqual([1,2])
  })

  it.each([
    { width:0 }, { width:3 }, { height:-1 }, { frametime:0 }, { frametime:1.5 },
    { frames:[] }, { frames:[null] }, { frames:[-1] }, { frames:[8] },
    { frames:[{index:0,time:0}] }, { frames:new Array(4097).fill(0) },
  ])('rejects invalid or excessive metadata without changing the texture: %j', animation => {
    const texture = new Texture()
    expect(() => textureAnimation(texture, png(16,128), {animation}, 0)).toThrow()
    expect(texture.repeat.toArray()).toEqual([1,1]); expect(texture.offset.toArray()).toEqual([0,0])
  })

  it('keeps ordinary texture metadata static and rejects malformed image dimensions', () => {
    expect(textureAnimation(new Texture(), png(16,16), {texture:{blur:false}}, 0)).toBeUndefined()
    expect(() => textureAnimation(new Texture(), png(0,16), {animation:{}}, 0)).toThrow()
    expect(() => textureAnimation(new Texture(), new Uint8Array(24), {animation:{}}, 0)).toThrow()
  })
})
