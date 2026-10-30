import assert from 'node:assert/strict'

/** Sample the live viewport's sprite matrices on the native GPU at UV edges. */
export async function runAnimationPixelScenario(evaluate) {
  const result = await evaluate(`(() => {
    const host = document.querySelector('.viewport')
    let fiber = host[Object.keys(host).find(name => name.startsWith('__reactFiber'))]
    let controller
    for (; fiber && !controller; fiber = fiber.return) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        const value = hook.memoizedState?.current
        if (value?.animationCache && value?.renderer) { controller = value; break }
      }
    }
    if (!controller?.animations.length) throw new Error('Expected an active animated viewport texture')
    let pairedSurfaces = 0
    for (const mesh of controller.batches) {
      const baked = [...controller.baked.values()].find(value => value.geometry === mesh.geometry)
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const [index, surface] of (baked?.surfaces ?? []).entries()) {
        if (!surface.singleSided) continue
        pairedSurfaces++
        if (materials[index]?.side !== 0) throw new Error('Opposing coplanar model faces must render FrontSide to avoid mirrored texture z-fighting')
      }
    }
    if (controller.props.blocks.some(block => /:(soul_)?campfire$/.test(block.state.name) && block.state.properties.lit === 'true') && !pairedSurfaces) {
      throw new Error('Lit campfire must expose opposing coplanar flame faces')
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
    const gl = canvas.getContext('webgl2', { antialias: false })
    if (!gl) throw new Error('Sprite edge test requires WebGL2')
    const shaders = [], texture = gl.createTexture(), program = gl.createProgram()
    try {
      for (const [kind, source] of [
        [gl.VERTEX_SHADER, '#version 300 es\\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0.,1.);}'],
        [gl.FRAGMENT_SHADER, '#version 300 es\\nprecision highp float;uniform sampler2D map;uniform mat3 crop;uniform vec2 corner;out vec4 color;void main(){color=texture(map,(crop*vec3(corner,1.)).xy);}'],
      ]) {
        const shader = gl.createShader(kind); shaders.push(shader)
        gl.shaderSource(shader, source); gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
      gl.useProgram(program); gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      const samples = []
      for (const animation of controller.animations) {
        const { texture: map, columns, rows } = animation
        const width = map.image.width, height = map.image.height
        const sheet = document.createElement('canvas'); sheet.width = width; sheet.height = height
        const context = sheet.getContext('2d')
        const color = index => [(index * 53 + 23) % 256, (index * 97 + 41) % 256, (index * 29 + 67) % 256, 255]
        for (let index = 0; index < columns * rows; index++) {
          const [r,g,b] = color(index); context.fillStyle = 'rgb('+r+','+g+','+b+')'
          context.fillRect(index % columns * width / columns, Math.floor(index / columns) * height / rows, width / columns, height / rows)
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet)
        const column = Math.round(map.offset.x * columns)
        const row = Math.round((1 - map.offset.y) * rows - 1)
        const expected = color(row * columns + column)
        map.updateMatrix()
        gl.uniformMatrix3fv(gl.getUniformLocation(program, 'crop'), false, map.matrix.elements)
        for (const u of [0,1]) for (const v of [0,1]) {
          gl.uniform2f(gl.getUniformLocation(program, 'corner'), u, v)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
          const pixel = new Uint8Array(4); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel)
          samples.push({ grid:[columns,rows], frame:row * columns + column, uv:[u,v], expected, pixel:[...pixel], pairedSurfaces })
        }
      }
      return samples
    } finally {
      gl.deleteTexture(texture); gl.deleteProgram(program)
      for (const shader of shaders) gl.deleteShader(shader)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  })()`)
  assert.ok(result.length >= 4, 'Expected GPU samples at all four sprite corners')
  for (const sample of result) {
    assert.deepEqual(sample.pixel, sample.expected, `Sprite grid ${sample.grid}, frame ${sample.frame}, UV ${sample.uv} must sample its own frame`)
  }
  return result.length
}
