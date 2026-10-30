import { Texture } from 'three'

/** Own image requests as well as textures: cache disposal cancels pending decodes. */
export class TextureImages {
  private pending = new Set<() => void>()

  load(bytes: Uint8Array, onLoad: () => void, onError: () => void): Texture {
    const texture = new Texture()
    const image = new Image()
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: 'image/png' }))
    let active = true
    const finish = () => {
      active = false
      image.removeEventListener('load', loaded)
      image.removeEventListener('error', failed)
      this.pending.delete(cancel)
      URL.revokeObjectURL(url)
    }
    const loaded = () => {
      if (!active) return
      finish()
      texture.image = image
      texture.needsUpdate = true
      onLoad()
    }
    const failed = () => {
      if (!active) return
      finish()
      onError()
    }
    const cancel = () => {
      if (!active) return
      finish()
      image.removeAttribute('src')
    }
    this.pending.add(cancel)
    image.addEventListener('load', loaded)
    image.addEventListener('error', failed)
    image.src = url
    return texture
  }

  clear() {
    for (const cancel of this.pending) cancel()
  }
}
