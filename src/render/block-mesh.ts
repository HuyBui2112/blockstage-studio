import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, Vector3 } from 'three'
import type { Vec3 } from '../core/schema'
import type { Direction, Element, Face, ModelResolver, ResolvedBlock } from './models'

export type Surface = { texture: string; tint: boolean; shade: boolean; translucent?:boolean; singleSided?:boolean; color?:string }
export type BakedMesh = { geometry: BufferGeometry; surfaces: Surface[] }
const directions: Direction[] = ['down', 'up', 'north', 'south', 'west', 'east']
const opposite: Record<Direction, Direction> = { down:'up', up:'down', north:'south', south:'north', west:'east', east:'west' }
const normalAxis: Record<Direction, number> = { down:1, up:1, north:2, south:2, west:0, east:0 }
export function corners(face: Direction, [x, y, z]: Vec3, [X, Y, Z]: Vec3): Vec3[] {
  switch (face) {
    case 'down': return [[x,y,Z], [x,y,z], [X,y,z], [X,y,Z]]
    case 'up': return [[x,Y,z], [x,Y,Z], [X,Y,Z], [X,Y,z]]
    case 'north': return [[X,Y,z], [X,y,z], [x,y,z], [x,Y,z]]
    case 'south': return [[x,Y,Z], [x,y,Z], [X,y,Z], [X,Y,Z]]
    case 'west': return [[x,Y,z], [x,y,z], [x,y,Z], [x,Y,Z]]
    case 'east': return [[X,Y,Z], [X,y,Z], [X,y,z], [X,Y,z]]
  }
}
export function defaultUv(direction: Direction, { from: [x, y, z], to: [X, Y, Z] }: Element): [number, number, number, number] {
  switch (direction) {
    case 'down': return [x, 16-Z, X, 16-z]
    case 'up': return [x, z, X, Z]
    case 'north': return [16-X, 16-Y, 16-x, 16-y]
    case 'south': return [x, 16-Y, X, 16-y]
    case 'west': return [z, 16-Y, Z, 16-y]
    case 'east': return [16-Z, 16-Y, 16-z, 16-y]
  }
}
function rotation(x: number, y: number) { return new Matrix4().makeRotationY(-y * Math.PI / 180).multiply(new Matrix4().makeRotationX(-x * Math.PI / 180)) }
export function lockedIndices(direction: Direction, matrix: Matrix4) {
  const rotated = corners(direction, [-.5,-.5,-.5], [.5,.5,.5]).map(p => new Vector3(...p).applyMatrix4(matrix))
  const normal = rotated[1].clone().sub(rotated[0]).cross(rotated[2].clone().sub(rotated[0])).normalize()
  const target: Direction = Math.abs(normal.y) > .9 ? normal.y > 0 ? 'up' : 'down' : Math.abs(normal.x) > .9 ? normal.x > 0 ? 'east' : 'west' : normal.z > 0 ? 'south' : 'north'
  const canonical = corners(target, [-.5,-.5,-.5], [.5,.5,.5]).map(p => new Vector3(...p))
  return rotated.map(p => canonical.findIndex(c => c.distanceToSquared(p) < 1e-8))
}
export function bakeBlock(resolved: ResolvedBlock, resolver: ModelResolver,allowEmpty=false): BakedMesh {
  const surfaceIds = new Map<string, number>(), surfaces: Surface[] = []
  const triangles = new Map<number, { p: number[]; uv: number[] }>()
  let faces = 0
  for (const { application, model } of resolved.parts) {
    if (!model.elements&&!allowEmpty) throw new Error(`Chưa hỗ trợ renderer cho model không có elements: ${application.model}`)
    if ((model.elements?.length??0) > 4096) throw new Error('Quá nhiều model elements')
    const transform = rotation(application.x ?? 0, application.y ?? 0)
    for (const element of model.elements??[]) {
      if (![...element.from, ...element.to].every(v => Number.isFinite(v) && Math.abs(v) <= 1024)) throw new Error('Model coordinates không hợp lệ')
      let elementMatrix = new Matrix4()
      if (element.rotation) {
        const { axis, angle=0, origin, rescale } = element.rotation
        const angles=axis?[axis==='x'?angle:0,axis==='y'?angle:0,axis==='z'?angle:0]:[element.rotation.x??0,element.rotation.y??0,element.rotation.z??0]
        if(![...angles,...origin].every(v=>Number.isFinite(v)&&Math.abs(v)<=36000))throw new Error('Element rotation không hợp lệ')
        // The game's EulerXYZRotation applies X, then Y, then Z (JOML rotationZYX).
        const turn = new Matrix4().makeRotationFromEuler(new Euler(angles[0]*Math.PI/180,angles[1]*Math.PI/180,angles[2]*Math.PI/180,'ZYX'))
        // 26.2 rescales each rotated basis by its largest absolute component.
        // This also handles multi-axis rotations and angles beyond 45 degrees.
        const scale = new Vector3(1,1,1)
        if (rescale) {
          const m = turn.elements
          scale.set(...[0,4,8].map(i => 1 / Math.max(Math.abs(m[i]),Math.abs(m[i+1]),Math.abs(m[i+2]))) as [number,number,number])
        }
        elementMatrix = new Matrix4().makeTranslation(...origin).multiply(turn).multiply(new Matrix4().makeScale(scale.x,scale.y,scale.z)).multiply(new Matrix4().makeTranslation(-origin[0],-origin[1],-origin[2]))
      }
      for (const direction of directions) {
        const face: Face | undefined = element.faces[direction]
        if (!face) continue
        if (++faces > 16384) throw new Error('Model quá nhiều faces')
        const texture=resolver.textureInfo(model,face.texture)
        const surface: Surface = { texture: texture.path, translucent:texture.translucent, tint: (face.tintindex ?? -1) >= 0, shade: element.shade !== false }
        // Opposite faces of a zero-thickness element already provide both visible
        // sides. Rendering each face double-sided overlays their mirrored UVs.
        const axis = normalAxis[direction]
        if (element.from[axis] === element.to[axis] && element.faces[opposite[direction]]) surface.singleSided = true
        const id = JSON.stringify(surface)
        if (!surfaceIds.has(id)) { surfaceIds.set(id, surfaces.length); surfaces.push(surface) }
        const materialId = surfaceIds.get(id)!, data = triangles.get(materialId) ?? { p: [], uv: [] }
        const vertices = corners(direction, element.from, element.to).map(p => new Vector3(...p).applyMatrix4(elementMatrix).multiplyScalar(1/16).addScalar(-.5).applyMatrix4(transform))
        const [u, v, U, V] = face.uv ?? defaultUv(direction, element)
        if (![u,v,U,V].every(Number.isFinite) || ![0,90,180,270].includes(face.rotation ?? 0)) throw new Error('Face UV không hợp lệ')
        const uv = [[u/16,1-v/16],[u/16,1-V/16],[U/16,1-V/16],[U/16,1-v/16]]
        const indices = application.uvlock ? lockedIndices(direction, transform) : [0,1,2,3]
        const unit = [[0,1],[0,0],[1,0],[1,1]], anchor = unit[indices[0]], alongU = unit[indices[3]], alongV = unit[indices[1]]
        for (const n of [0,1,2,0,2,3]) {
          data.p.push(...vertices[n].toArray())
          const [s,t] = uv[(n + (face.rotation ?? 0)/90) % 4]
          // UV lock rotates the coordinates around the sprite center, after the
          // face rotation. Permuting crop corners alone preserves the wrong crop.
          data.uv.push(anchor[0]+s*(alongU[0]-anchor[0])+(1-t)*(alongV[0]-anchor[0]),anchor[1]+s*(alongU[1]-anchor[1])+(1-t)*(alongV[1]-anchor[1]))
        }
        triangles.set(materialId, data)
      }
    }
  }
  const geometry = new BufferGeometry(), positions: number[] = [], uvs: number[] = []
  for (const [material, data] of triangles) { geometry.addGroup(positions.length/3, data.p.length/3, material); for(const n of data.p)positions.push(n);for(const n of data.uv)uvs.push(n) }
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2)); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere()
  return { geometry, surfaces }
}
