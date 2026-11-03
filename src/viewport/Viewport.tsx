import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { BlockState, SceneBlock, SceneEntity, Vec3 } from '../core/schema'
import { stateKey, key } from '../core/schema'
import { bounds } from '../core/assembly'
import { DEMO_MATERIALS, type Material } from '../core/catalog'
import type { GameProfile } from '../core/profile'
import { texturePaths, type ResourcePack } from '../io/resources'
import { blockGeometry } from './geometry'
import { ModelResolver } from '../render/models'
import { bakeBlock, type BakedMesh, type Surface } from '../render/block-mesh'
import { bakeEntity, blockEntityAppearance, entityAppearance } from '../render/entities'
import { keyViewCommand, viewDirection, type ViewCommand, type ViewCommandKind } from './view-commands'
import { TextureImages } from '../render/texture-image'
import { textureAnimation, updateTextureAnimation, type TextureAnimation } from '../render/texture-animation'
import { EditorInteraction, type EditorViewportState, type EditorPlacementHit } from './editor-interaction'
import { CellPicker } from './cell-picking'
import { CONTEXT_CHAIN_IDS } from '../editor/placement-plan'
import { bakeSpecialBlock, specialBlockAppearance } from '../render/special-blocks'

export type { ViewCommand, ViewCommandKind } from './view-commands'
export type { EditorViewportState, EditorTransformIntent, EditorPlacementHit } from './editor-interaction'

export type Tool = 'select' | 'block' | 'component' | 'erase' | 'entity'
export type RenderDiagnostics = { modeledBlocks: number; fallbackBlocks: number; entities: number; issues: string[] }
export type RenderMetrics = { drawCalls: number; triangles: number; geometries: number; textures: number }
type Props = {
  blocks: SceneBlock[]; packs: ResourcePack[]; selected: string | null; tool: Tool; layer: number;
  ghost: Vec3[]; clip: number | null; local: boolean;
  catalog: Material[]; profile: GameProfile | null; entities: SceneEntity[];
  onPick: (block: SceneBlock | undefined, adjacent: Vec3) => void;
  onDelete: () => void; onUndo: (redo: boolean) => void; onRotate: () => void;
  onMessage: (message: string) => void; onHover: (pos: Vec3) => void;
  onEntityPick: (id: string) => void; onDiagnostics: (diagnostics: RenderDiagnostics) => void;
  command?: ViewCommand; frameKey?: string; previewMode?: boolean;
  onMetrics?: (metrics: RenderMetrics) => void;
  resolver?: ModelResolver;
  editor?: EditorViewportState;
}
type Batch = T.InstancedMesh

class ViewportController {
  renderer: T.WebGLRenderer
  scene = new T.Scene()
  camera: T.PerspectiveCamera | T.OrthographicCamera = new T.PerspectiveCamera(50, 1, .02, 8192)
  controls: OrbitControls
  group = new T.Group()
  selection = new T.Box3Helper(new T.Box3(), 0xbab4a7)
  preview = new T.Box3Helper(new T.Box3(), 0x8ce1af)
  grid = new T.GridHelper(256, 256, 0x494842, 0x302f2c)
  ray = new T.Raycaster()
  pointer = new T.Vector2()
  batches: Batch[] = []
  textures: T.Texture[] = []
  textureCache = new Map<string, T.Texture>()
  materialCache = new Map<string, (T.MeshLambertMaterial|T.MeshBasicMaterial)[]>()
  geometryCache = new Map<string, T.BufferGeometry>()
  textureImages = new TextureImages()
  props: Props
  observer: ResizeObserver
  frame = 0
  disposed = false
  lastTime = 0
  keys = new Set<string>()
  down: [number, number] | null = null
  hover: Vec3 = [0, 0, 0]
  ctrlZoom = false
  host: HTMLDivElement
  occupied = new Set<string>()
  cellPicker = new CellPicker([])
  resolver: ModelResolver
  baked = new Map<string, BakedMesh>()
  entityMeshes: T.Mesh[] = []
  animationCache = new Map<T.Texture, TextureAnimation>()
  animations: TextureAnimation[] = []
  diagnosticsKey = ''
  metricsKey = ''
  placementHoverKey = ''
  placementPointer: [number, number] | null = null
  placementCameraKey = ''
  placementRegion: { pointerId: number; start: EditorPlacementHit; axis: number; plane: T.Plane; session?: string } | null = null
  editorInteraction: EditorInteraction
  constructor(host: HTMLDivElement, props: Props) {
    this.host = host
    this.props = props
    this.resolver = props.resolver ?? new ModelResolver(props.packs)
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    this.renderer.setClearColor('#232321')
    this.renderer.outputColorSpace = T.SRGBColorSpace
    this.renderer.domElement.tabIndex = 0
    this.renderer.domElement.setAttribute('aria-label', '3D preview. Middle mouse to orbit; Shift and middle mouse to pan; Home to frame all.')
    host.append(this.renderer.domElement)
    this.camera.position.set(14, 12, 17)
    this.controls = this.makeControls()
    this.controls.target.set(2, 2, 2); this.controls.update()
    this.scene.add(this.group, this.grid, this.selection, this.preview)
    this.editorInteraction = new EditorInteraction({
      canvas: this.renderer.domElement, host, scene: this.scene, camera: () => this.camera,
      navigation: enabled => { this.controls.enabled = enabled && !this.flying },
      invalidate: this.invalidate, message: message => this.props.onMessage(message),
      renderBlock: block => this.ghostRender(block), onGhostChange: () => this.refreshAnimations(),
    })
    this.selection.visible = this.preview.visible = false
    this.scene.add(new T.HemisphereLight(0xe3f4ff, 0x535c54, 2.1))
    const sun = new T.DirectionalLight(0xfff0d9, 2.5); sun.position.set(10, 18, 6); this.scene.add(sun)
    this.observer = new ResizeObserver(this.resize); this.observer.observe(host)
    const canvas = this.renderer.domElement
    canvas.addEventListener('pointerdown', this.pointerDown, true)
    canvas.addEventListener('pointermove', this.pointerMove, true)
    canvas.addEventListener('pointerleave', this.pointerLeave)
    canvas.addEventListener('pointercancel', this.pointerCancel)
    window.addEventListener('pointerup', this.pointerUp)
    canvas.addEventListener('contextmenu', this.contextMenu)
    canvas.addEventListener('keydown', this.keyDown)
    canvas.addEventListener('wheel', this.wheel, { passive: false, capture: true })
    document.addEventListener('pointerlockchange', this.lockChange)
    document.addEventListener('mousemove', this.mouseLook)
    document.addEventListener('keydown', this.flyKeyDown)
    document.addEventListener('keyup', this.keyUp)
    window.addEventListener('blur', this.blur)
    this.resize(); this.rebuild()
    if (props.frameKey !== undefined) this.frameBlocks(false)
  }
  get flying() { return document.pointerLockElement === this.renderer.domElement }
  contextMenu = (e: Event) => e.preventDefault()
  makeControls() {
    const c = new OrbitControls(this.camera, this.renderer.domElement)
    c.mouseButtons = { LEFT: undefined, MIDDLE: T.MOUSE.ROTATE, RIGHT: undefined }
    c.minDistance = .05; c.maxDistance = 4096; c.zoomToCursor = true; c.enableDamping = false
    c.addEventListener('change', this.invalidate)
    return c
  }
  resize = () => {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(w, h)
    if (this.camera instanceof T.PerspectiveCamera) this.camera.aspect = w / h
    else { const half = (this.camera.top - this.camera.bottom) / 2; this.camera.left = -half * w / h; this.camera.right = half * w / h }
    this.camera.updateProjectionMatrix(); this.invalidate()
  }
  invalidate = () => { if (!this.frame && !this.disposed) this.frame = requestAnimationFrame(this.render) }
  render = (time: number) => {
    this.frame = 0
    if (this.flying) {
      const dt = Math.min((time - this.lastTime) / 1000 || 0, .05)
      const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 20 : 4) * dt
      const delta = new T.Vector3(Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')), 0, Number(this.keys.has('KeyS')) - Number(this.keys.has('KeyW')))
      if (delta.lengthSq()) delta.normalize().applyQuaternion(this.camera.quaternion).multiplyScalar(speed)
      delta.y += (Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ'))) * speed
      this.camera.position.add(delta); this.invalidate()
    }
    this.lastTime = time
    if (this.props.editor?.tool === 'place' && this.placementPointer && !this.flying) {
      const cameraKey = `${this.camera.position.toArray()},${this.camera.quaternion.toArray()},${this.camera.projectionMatrix.elements}`
      if (cameraKey !== this.placementCameraKey) {
        this.placementCameraKey = cameraKey
        this.publishPlacementHover({ clientX: this.placementPointer[0], clientY: this.placementPointer[1] } as PointerEvent)
      }
    }
    for (const a of this.animations) updateTextureAnimation(a, time)
    if (this.animations.length) this.invalidate()
    const projection = this.camera instanceof T.OrthographicCamera ? 'orthographic' : 'perspective'
    if (this.renderer.domElement.dataset.projection !== projection) this.renderer.domElement.dataset.projection = projection
    this.renderer.render(this.scene, this.camera)
    if (this.props.editor) {
      const cameraData = JSON.stringify({ projection: new T.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).toArray(), look: this.camera.getWorldDirection(new T.Vector3()).toArray() })
      if (this.renderer.domElement.dataset.editorCamera !== cameraData) this.renderer.domElement.dataset.editorCamera = cameraData
    }
    this.editorInteraction.publishHandles()
    if (this.props.onMetrics) {
      const { render, memory }=this.renderer.info
      const metrics: RenderMetrics={drawCalls:render.calls,triangles:render.triangles,geometries:memory.geometries,textures:memory.textures}
      const metricsKey=JSON.stringify(metrics)
      if (metricsKey!==this.metricsKey) { this.metricsKey=metricsKey; this.props.onMetrics(metrics) }
    }
  }
  disposeMeshes(clearCaches=true) {
    for (const b of this.batches) b.dispose()
    this.batches = []; this.entityMeshes=[]; this.group.clear(); this.animations=[]
    if (!clearCaches) return
    this.editorInteraction.clearGhostMaterials()
    this.textureImages.clear()
    this.geometryCache.forEach(g => g.dispose()); this.geometryCache.clear()
    for (const b of this.baked.values()) b.geometry.dispose()
    this.baked.clear(); this.animationCache.clear()
    this.materialCache.forEach(ms => ms.forEach(m => m.dispose())); this.materialCache.clear()
    this.textureCache.clear()
    this.textures.forEach(t => t.dispose()); this.textures = []
  }
  materials(state: BlockState) {
    const cacheKey = stateKey(state)
    const existing = this.materialCache.get(cacheKey)
    if (existing) return existing
    const materials = texturePaths(state.name, state.properties).map(path => {
      const map = this.texture(path)
      const color = DEMO_MATERIALS.find(m => m.id === state.name)?.color ?? '#c78bbc'
      return new T.MeshLambertMaterial({ color: map ? 'white' : color, map, transparent: state.name.endsWith(':glass'), opacity: state.name.endsWith(':glass') ? .42 : 1, alphaTest: .1 })
    })
    this.materialCache.set(cacheKey, materials)
    return materials
  }
  texture(path: string): T.Texture | undefined {
    const existing = this.textureCache.get(path)
    if (existing) return existing
    const bytes = this.resolver.files.get(path)
    if (!bytes) return undefined
    const texture = this.textureImages.load(bytes,()=>this.invalidate(),()=>this.props.onMessage(`Could not decode texture: ${path}`))
    texture.magFilter=T.NearestFilter; texture.minFilter=T.NearestFilter; texture.colorSpace=T.SRGBColorSpace; texture.generateMipmaps=false
    this.textureCache.set(path,texture); this.textures.push(texture)
    if (this.resolver.files.has(path+'.mcmeta')) {
      try {
        const animation = textureAnimation(texture, bytes, this.resolver.json<unknown>(path+'.mcmeta'), performance.now())
        if (animation) this.animationCache.set(texture, animation)
      } catch { this.props.onMessage(`Invalid animation metadata: ${path}`) }
    }
    return texture
  }
  modelMaterials(surfaces: Surface[], state: BlockState) {
    const tint = /leaves|vine/.test(state.name)?'#77ab2f':/grass|fern|stem|lily_pad|sugar_cane/.test(state.name)?'#91bd59':'#ffffff'
    const transparent=/glass(?!_pane)|stained_glass|ice|slime|honey|nether_portal/.test(state.name)
    const key=JSON.stringify([surfaces,tint,transparent])
    const cached=this.materialCache.get(key)
    if (cached) return cached
    const materials=surfaces.map(s=>{const settings={map:this.texture(s.texture),color:s.color??(s.tint?tint:'white'),alphaTest:.1,transparent:transparent||s.translucent,side:s.singleSided?T.FrontSide:T.DoubleSide};return s.shade?new T.MeshLambertMaterial(settings):new T.MeshBasicMaterial(settings)})
    this.materialCache.set(key,materials);return materials
  }
  ghostRender(block: SceneBlock) {
    if (this.props.packs.some(pack => pack.enabled)) {
      try {
        const appearance=specialBlockAppearance(block.state)
        const special=blockEntityAppearance(block.state.name,block.state.properties)
        let mesh: BakedMesh
        if(appearance){
          const renderKey='special:'+stateKey(block.state)
          mesh=this.baked.get(renderKey)??bakeSpecialBlock(block.state,this.props.profile,this.resolver)!
          this.baked.set(renderKey,mesh)
        } else if (special && this.props.profile?.entityModels[special.layer] && this.resolver.files.has(special.texture)) {
          const renderKey=stateKey(block.state)
          mesh=this.baked.get(renderKey)??bakeEntity(this.props.profile.entityModels[special.layer],special.texture,'block')
          if(!this.baked.has(renderKey)) {
            mesh.geometry.rotateY(-(['south','west','north','east'].indexOf(block.state.properties.facing))*Math.PI/2)
            this.baked.set(renderKey,mesh)
          }
        } else {
          const resolved = this.resolver.resolve(block.state, block.pos)
          const renderKey = block.state.name + resolved.key
          const cached=this.baked.get(renderKey)
          if (cached) mesh=cached
          else {
            const material=this.props.catalog.find(material=>material.id===block.state.name)
            mesh=bakeBlock(resolved,this.resolver,material?.source==='game-profile'&&!material.hasBlockEntity)
            this.baked.set(renderKey,mesh)
          }
        }
        return {geometry:mesh.geometry,materials:this.modelMaterials(mesh.surfaces,block.state)}
      } catch { /* Keep unsupported models visible with the existing placeholder appearance. */ }
    }
    const id = stateKey(block.state)
    let geometry = this.geometryCache.get(id)
    if (!geometry) { geometry = blockGeometry(block.state); this.geometryCache.set(id, geometry) }
    return {geometry,materials:this.materials(block.state)}
  }
  refreshAnimations() {
    // Ghosts share texture objects with the committed model, including UV animation.
    const activeTextures = new Set<T.Texture>()
    for (const mesh of [...this.batches, ...this.entityMeshes, ...this.editorInteraction.ghost.children as T.Mesh[]]) {
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const texture = (material as T.MeshLambertMaterial).map
        if (texture) activeTextures.add(texture)
      }
    }
    this.animations = []
    for (const texture of activeTextures) {
      const animation = this.animationCache.get(texture)
      if (animation) this.animations.push(animation)
    }
  }
  rebuild(resourcesChanged=false) {
    // Reuse geometry/material/texture objects for state, yaw and clip changes.
    // Keep browsing caches bounded; changing the asset stack always invalidates them.
    this.disposeMeshes(resourcesChanged || this.baked.size>256 || this.textureCache.size>512 || this.geometryCache.size>256)
    if (resourcesChanged) this.resolver=this.props.resolver ?? new ModelResolver(this.props.packs)
    this.occupied = new Set(this.props.blocks.map(b => key(b.pos)))
    const groups = new Map<string, {blocks:SceneBlock[];mesh:BakedMesh|null;fallback:boolean}>()
    const diagnostics: RenderDiagnostics={modeledBlocks:0,fallbackBlocks:0,entities:0,issues:[]}
    const issues=new Set<string>()
    const catalog=new Map(this.props.catalog.map(m=>[m.id,m]))
    const visible = this.props.blocks.filter(b => (this.props.clip === null || b.pos[1] <= this.props.clip) && (!this.props.local || !this.props.selected || b.owner === this.props.selected))
    this.cellPicker = new CellPicker(visible)
    for (const b of visible) {
      if(['minecraft:air','minecraft:cave_air','minecraft:void_air'].includes(b.state.name))continue
      const chunk = b.pos.map(v => Math.floor(v / 16)).join(',')
      let mesh:BakedMesh|null=null,renderKey=stateKey(b.state),fallback=false
      if (this.props.packs.some(p=>p.enabled)) {
        try {
          const appearance=specialBlockAppearance(b.state)
          const special=blockEntityAppearance(b.state.name,b.state.properties)
          if(appearance){
            renderKey='special:'+stateKey(b.state)
            mesh=this.baked.get(renderKey)??bakeSpecialBlock(b.state,this.props.profile,this.resolver)!
            this.baked.set(renderKey,mesh);issues.add(`${b.state.name}: ${appearance.note}`)
          } else if (special && this.props.profile?.entityModels[special.layer] && this.resolver.files.has(special.texture)) {
            renderKey=stateKey(b.state)
            mesh=this.baked.get(renderKey)??bakeEntity(this.props.profile.entityModels[special.layer],special.texture,'block')
            if (!this.baked.has(renderKey)) {
              const angle=-(['south','west','north','east'].indexOf(b.state.properties.facing))*Math.PI/2
              mesh.geometry.rotateY(angle);this.baked.set(renderKey,mesh)
            }
          } else {
            const resolved=this.resolver.resolve(b.state,b.pos)
            renderKey=b.state.name+resolved.key
            const material=catalog.get(b.state.name)
            mesh=this.baked.get(renderKey)??bakeBlock(resolved,this.resolver,material?.source==='game-profile'&&!material.hasBlockEntity)
            this.baked.set(renderKey,mesh)
          }
          diagnostics.modeledBlocks++
        } catch (error) {
          fallback=true;diagnostics.fallbackBlocks++
          issues.add(`${b.state.name}: ${error instanceof Error?error.message:String(error)}`)
        }
      } else {
        fallback=true; diagnostics.fallbackBlocks++
        issues.add('No resource pack is enabled. Showing a placeholder outline.')
      }
      const k=chunk+'|'+renderKey
      const group=groups.get(k)??{blocks:[],mesh,fallback};group.blocks.push(b);groups.set(k,group)
    }
    const matrix = new T.Matrix4()
    for (const {blocks,mesh:baked,fallback} of groups.values()) {
      const state = blocks[0].state, cacheKey = stateKey(state)
      let geometry = this.geometryCache.get(cacheKey)
      if (baked) geometry=baked.geometry
      else if (!geometry) { geometry = blockGeometry(state); this.geometryCache.set(cacheKey, geometry) }
      const materials=baked?this.modelMaterials(baked.surfaces,state):this.materials(state)
      if (fallback) for (const material of materials) { material.color.set('#d673c4'); material.wireframe=true }
      const mesh = new T.InstancedMesh(geometry, materials, blocks.length)
      mesh.userData = { blocks }
      blocks.forEach((b, n) => mesh.setMatrixAt(n, matrix.makeTranslation(b.pos[0] + .5, b.pos[1] + .5, b.pos[2] + .5)))
      mesh.computeBoundingBox(); mesh.computeBoundingSphere(); this.group.add(mesh); this.batches.push(mesh)
    }
    for (const entity of this.props.entities) {
      if ((this.props.clip!==null&&entity.position[1]>this.props.clip)||(this.props.local&&this.props.selected&&this.props.selected!==`entity:${entity.id}`)) continue
      try {
        const appearance=entityAppearance(entity.type,this.props.profile,this.resolver)
        if (!appearance||!this.props.profile) throw new Error('No model or texture binding is available for this entity type.')
        const id='entity:'+appearance.layer+':'+appearance.texture
        const baked=this.baked.get(id)??bakeEntity(this.props.profile.entityModels[appearance.layer],appearance.texture)
        this.baked.set(id,baked)
        const mesh=new T.Mesh(baked.geometry,this.modelMaterials(baked.surfaces,{name:entity.type,properties:{}}))
        mesh.position.set(...entity.position);mesh.rotation.y=-entity.yaw*Math.PI/180;mesh.userData.entityId=entity.id
        this.entityMeshes.push(mesh);this.group.add(mesh);diagnostics.entities++
      } catch(error) {
        issues.add(`${entity.type}: ${error instanceof Error?error.message:String(error)}`)
        const type=this.props.profile?.entities.find(t=>t.id===entity.type)
        const width=Math.max(.1,type?.width??.6),height=Math.max(.1,type?.height??1.8),id='bounds:'+entity.type
        let geometry=this.geometryCache.get(id)
        if(!geometry){geometry=new T.BoxGeometry(width,height,width);this.geometryCache.set(id,geometry)}
        let materials=this.materialCache.get(id)
        if(!materials){materials=[new T.MeshLambertMaterial({color:'#d673c4',wireframe:true})];this.materialCache.set(id,materials)}
        const mesh=new T.Mesh(geometry,materials);mesh.position.set(entity.position[0],entity.position[1]+height/2,entity.position[2]);mesh.userData.entityId=entity.id
        this.entityMeshes.push(mesh);this.group.add(mesh)
      }
    }
    diagnostics.issues=[...issues]
    const diagnosticsKey=JSON.stringify(diagnostics)
    if (diagnosticsKey!==this.diagnosticsKey) { this.diagnosticsKey=diagnosticsKey; this.props.onDiagnostics(diagnostics) }
    this.grid.position.y = this.props.layer - .005
    this.highlight(); this.editorInteraction.update(this.props.previewMode ? undefined : this.props.editor, this.props.blocks, true); this.invalidate()
  }
  highlight() {
    if (this.props.previewMode || this.props.editor) { this.selection.visible=false; return }
    const blocks = this.props.blocks.filter(b => b.owner === this.props.selected)
    this.selection.visible = blocks.length > 0
    if (blocks.length) this.setBox(this.selection, blocks.map(b => b.pos))
    const entity=this.entityMeshes.find(m=>`entity:${m.userData.entityId}`===this.props.selected)
    if (entity) { this.selection.box.setFromObject(entity); this.selection.visible=true }
    this.invalidate()
  }
  setBox(helper: T.Box3Helper, positions: Vec3[]) {
    const { min, size } = bounds(positions.map(pos => ({ pos })))
    helper.box.set(new T.Vector3(...min).addScalar(-.015), new T.Vector3(...min.map((v, i) => v + size[i]) as Vec3).addScalar(.015))
  }
  hit(e: PointerEvent, selection = false) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1)
    this.ray.setFromCamera(this.pointer, this.camera)
    if (this.props.editor) {
      const placing = this.props.editor.tool === 'place' && !selection && !e.altKey
      // Selection uses occupied cells. Placement keeps actual model surfaces,
      // except chain attachment uses a deliberate, stable grid-cell face.
      const eligible=this.editorInteraction.selectableOwners
      const cell = this.cellPicker.hit(this.ray.ray, placing ? b => CONTEXT_CHAIN_IDS.has(b.state.name) : eligible ? b=>eligible.has(b.owner) : undefined)
      if (!placing) return cell ? { block: cell.block, adjacent: cell.block.pos.map((v, i) => v + cell.face[i]) as Vec3, face: cell.face, point: cell.point } : undefined
      if (cell) {
        const visual = this.ray.intersectObjects([...this.batches, ...this.entityMeshes], false)[0]
        if (!visual || cell.distance <= visual.distance + 1e-7) return { block: cell.block, adjacent: cell.block.pos.map((v, i) => v + cell.face[i]) as Vec3, face: cell.face, point: cell.point }
      }
    }
    const hit = this.ray.intersectObjects([...this.batches,...this.entityMeshes], false)[0]
    if (hit?.object.userData.entityId) return {block:undefined,adjacent:[Math.floor(hit.point.x),Math.floor(hit.point.y),Math.floor(hit.point.z)] as Vec3,face:[0,1,0] as Vec3,point:hit.point.toArray(),entityId:hit.object.userData.entityId as string}
    if (hit && hit.instanceId !== undefined) {
      const b = ((hit.object as Batch).userData.blocks as SceneBlock[])[hit.instanceId]
      const normal = hit.face?.normal.clone() ?? new T.Vector3(0, 1, 0)
      normal.transformDirection(hit.object.matrixWorld)
      const axis=[0,1,2].sort((a,b)=>Math.abs(normal.getComponent(b))-Math.abs(normal.getComponent(a)))[0]
      const face = [0, 1, 2].map(i => i === axis ? Math.sign(normal.getComponent(i)) : 0) as Vec3
      return { block: b, adjacent: b.pos.map((v, i) => v + face[i]) as Vec3, face, point: hit.point.toArray() }
    }
    const point = this.ray.ray.intersectPlane(new T.Plane(new T.Vector3(0, 1, 0), -this.props.layer), new T.Vector3())
    return point ? { block: undefined, adjacent: [Math.floor(point.x), this.props.layer, Math.floor(point.z)] as Vec3, face: [0,1,0] as Vec3, point: point.toArray() } : undefined
  }
  pointerDown = (e: PointerEvent) => {
    this.renderer.domElement.focus()
    if (this.flying) return
    if (e.button === 2 && this.placementRegion) { this.endPlacementRegion(true); e.stopImmediatePropagation(); e.preventDefault(); return }
    if (!this.props.previewMode && this.editorInteraction.pointerDown(e)) { this.down = null; e.stopImmediatePropagation(); e.preventDefault(); return }
    if (e.button === 0 && e.ctrlKey && !e.altKey && this.props.editor?.onPlacementRegionStart) {
      const hit = this.hit(e)
      if (hit) {
        const start = this.placementHit(hit), axis = start.face.findIndex(value => value !== 0)
        this.placementRegion = { pointerId: e.pointerId, start, axis, plane: new T.Plane().setFromNormalAndCoplanarPoint(new T.Vector3(...start.face), new T.Vector3(...start.point)) }
        this.down = null; this.placementPointer = null
        if(!this.props.editor.onPlacementRegionStart(start))this.endPlacementRegion(true)
        e.stopImmediatePropagation(); e.preventDefault(); return
      }
    }
    if (this.editorInteraction.suppressClick) this.down = null
    if (e.button === 1 && e.ctrlKey) { this.ctrlZoom = true; this.controls.enabled = false; e.stopImmediatePropagation(); e.preventDefault(); this.down = [e.clientX, e.clientY]; return }
    if (e.button === 0 && !this.editorInteraction.suppressClick) this.down = [e.clientX, e.clientY]
  }
  pointerMove = (e: PointerEvent) => {
    if (this.placementRegion) { this.pointPlacementRegion(e); return }
    this.placementPointer = [e.clientX, e.clientY]
    if (this.ctrlZoom && this.down) {
      const factor = Math.exp((e.clientY - this.down[1]) * .01)
      if (this.camera instanceof T.PerspectiveCamera) this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target)
      else { this.camera.zoom = Math.max(.01, this.camera.zoom / factor); this.camera.updateProjectionMatrix() }
      this.down = [e.clientX, e.clientY]; this.controls.update(); this.invalidate(); e.stopImmediatePropagation(); return
    }
    if (this.flying) return
    if (this.props.previewMode) return
    if (this.editorInteraction.pointerMove(e)) return
    const hit = this.hit(e)
    if (!hit) { this.pointerLeave(); return }
    if (this.props.editor?.tool === 'place') {
      if (e.altKey) { this.props.editor.onPlacementHover?.(null); this.placementHoverKey = '' }
      else this.publishPlacementHover(e, hit)
    }
    if (key(hit.adjacent) !== key(this.hover)) { this.hover = hit.adjacent; this.props.onHover(this.hover) }
    this.preview.visible = !this.props.editor && (this.props.tool === 'block' || this.props.tool === 'component')
    if (this.preview.visible) {
      const positions = (this.props.tool === 'component' ? this.props.ghost : [[0, 0, 0] as Vec3]).map(p => p.map((v, i) => v + hit.adjacent[i]) as Vec3)
      this.setBox(this.preview, positions)
      ;(this.preview.material as T.LineBasicMaterial).color.set(positions.some(p => this.occupied.has(key(p))) ? '#ed8f7c' : '#8ce1af')
    }
    this.invalidate()
  }
  pointerLeave = () => {
    this.placementPointer = null
    if (this.placementRegion) return
    this.preview.visible = false
    if (this.placementHoverKey) { this.placementHoverKey = ''; this.props.editor?.onPlacementHover?.(null) }
    this.invalidate()
  }
  pointerUp = (e: PointerEvent) => {
    if (e.button === 0 && this.placementRegion?.pointerId === e.pointerId) {
      const outside = !this.renderer.domElement.contains(e.target as Node)
      if (!outside) this.pointPlacementRegion(e)
      this.endPlacementRegion(outside); return
    }
    if (this.ctrlZoom) { this.ctrlZoom = false; this.controls.enabled = true; this.down = null; this.editorInteraction.pointerUp(e); return }
    if (!this.props.previewMode && this.editorInteraction.pointerUp(e)) { this.down = null; return }
    if (e.button !== 0 || !this.down || this.flying) return
    const click = Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) < 5
    this.down = null
    if (this.props.previewMode) return
    if (click && this.props.editor && this.renderer.domElement.contains(e.target as Node)) {
      const editor = this.props.editor, quickSelect = editor.tool === 'place' && e.altKey
      const hit = this.hit(e, quickSelect)
      if (quickSelect) { editor.onTool?.('select'); editor.onSelect(hit?.block ? [hit.block.owner] : [], e.shiftKey) }
      else if (editor.tool === 'place' && hit) editor.onPlace(this.placementHit(hit))
      else editor.onSelect(hit?.block ? [hit.block.owner] : [], e.shiftKey)
      return
    }
    if (click && this.renderer.domElement.contains(e.target as Node)) { const hit = this.hit(e); if (hit) { if ('entityId' in hit && hit.entityId && (this.props.tool==='select'||this.props.tool==='erase')) this.props.onEntityPick(hit.entityId); else this.props.onPick(hit.block, hit.adjacent) } }
  }
  pointPlacementRegion(e: PointerEvent) {
    const region = this.placementRegion
    if (!region || region.pointerId !== e.pointerId) return
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.ray.setFromCamera(new T.Vector2((e.clientX-rect.left)/rect.width*2-1,1-(e.clientY-rect.top)/rect.height*2),this.camera)
    const point = this.ray.ray.intersectPlane(region.plane,new T.Vector3())
    if (!point) return
    const pos = point.toArray().map(Math.floor) as Vec3
    pos[region.axis] = region.start.pos[region.axis]
    this.props.editor?.onPlacementRegionPoint?.(pos)
  }
  endPlacementRegion(cancel: boolean) {
    if (!this.placementRegion) return
    this.placementRegion = null; this.down = null; this.placementPointer = null
    this.props.editor?.onPlacementRegionEnd?.(cancel)
  }
  pointerCancel = () => { this.endPlacementRegion(true); this.down = null; this.editorInteraction.cancel() }
  placementHit(hit: NonNullable<ReturnType<ViewportController['hit']>>): EditorPlacementHit {
    const look = this.camera.getWorldDirection(new T.Vector3()).toArray()
    return { pos: hit.adjacent, face: hit.face, point: hit.point, look, ...(hit.block ? { target: hit.block.pos } : {}) }
  }
  publishPlacementHover(e: PointerEvent, hit = this.hit(e)) {
    if (!this.props.editor || this.props.editor.tool !== 'place') return
    if (!hit) { this.props.editor.onPlacementHover?.(null); this.placementHoverKey = ''; return }
    const placement = this.placementHit(hit)
    // Keep the half-cell boundary exact; floor-to-sixteenths can hide crossing 0.5.
    const hitKey = JSON.stringify([placement.pos, placement.face, placement.point.map(v => Math.round(v * 1000000)), placement.look?.map(v => Math.round(v * 1000000))])
    if (hitKey !== this.placementHoverKey) {
      this.placementHoverKey = hitKey
      this.props.editor.onPlacementHover?.(placement)
    }
  }
  frameBlocks(selected: boolean) {
    let blocks = selected ? this.props.blocks.filter(b => this.props.editor ? this.props.editor.selected.includes(b.owner) : b.owner === this.props.selected) : this.props.blocks
    let entities=this.entityMeshes.filter(m=>!selected||`entity:${m.userData.entityId}`===this.props.selected)
    if (selected && !blocks.length && !entities.length) { blocks=this.props.blocks; entities=this.entityMeshes }
    if (!blocks.length&&!entities.length) return
    const box=new T.Box3()
    for(const b of blocks){box.expandByPoint(new T.Vector3(...b.pos));box.expandByPoint(new T.Vector3(...b.pos).addScalar(1))}
    for(const mesh of entities)box.union(new T.Box3().setFromObject(mesh))
    const center=box.getCenter(new T.Vector3()), size=box.getSize(new T.Vector3()).toArray()
    const direction = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(center)
    this.camera.position.copy(center).addScaledVector(direction, Math.max(...size) * 2 + 2)
    if (this.camera instanceof T.OrthographicCamera) { this.camera.zoom = 1; this.camera.top = Math.max(...size); this.camera.bottom = -this.camera.top }
    this.resize(); this.controls.update(); this.invalidate()
  }
  toggleProjection() {
    const previous = this.camera, target = this.controls.target.clone()
    this.controls.dispose()
    if (previous instanceof T.PerspectiveCamera) {
      const half = previous.position.distanceTo(target) * Math.tan(T.MathUtils.degToRad(25))
      this.camera = new T.OrthographicCamera(-half, half, half, -half, .02, 8192)
    } else this.camera = new T.PerspectiveCamera(50, 1, .02, 8192)
    this.camera.position.copy(previous.position); this.camera.quaternion.copy(previous.quaternion)
    this.controls = this.makeControls(); this.controls.target.copy(target); this.controls.update(); this.resize()
    this.editorInteraction.syncTransform()
  }
  command(kind: ViewCommandKind) {
    if (kind === 'frame-all' || kind === 'frame-selected') { this.frameBlocks(kind === 'frame-selected'); return }
    if (kind === 'projection') { this.toggleProjection(); return }
    if (kind === 'fly') { this.renderer.domElement.focus(); void this.startFly(); return }
    const direction=viewDirection(kind)
    if (direction) {
      // Axis views are orthographic elevations/plans, regardless of the previous projection.
      // Repeated axis selections must never toggle back into perspective.
      if (this.camera instanceof T.PerspectiveCamera) this.toggleProjection()
      const distance=Math.max(.1,this.camera.position.distanceTo(this.controls.target))
      this.camera.position.copy(this.controls.target).addScaledVector(new T.Vector3(...direction).normalize(),distance)
    } else if (kind === 'zoom-in' || kind === 'zoom-out') {
      const factor=kind === 'zoom-in' ? .8 : 1.25
      if (this.camera instanceof T.PerspectiveCamera) this.camera.position.sub(this.controls.target).multiplyScalar(factor).add(this.controls.target)
      else { this.camera.zoom=T.MathUtils.clamp(this.camera.zoom/factor,.01,1000); this.camera.updateProjectionMatrix() }
    } else {
      const offset=this.camera.position.clone().sub(this.controls.target)
      const spherical=new T.Spherical().setFromVector3(offset)
      if (kind === 'orbit-left') spherical.theta-=Math.PI/12
      if (kind === 'orbit-right') spherical.theta+=Math.PI/12
      if (kind === 'orbit-up') spherical.phi-=Math.PI/12
      if (kind === 'orbit-down') spherical.phi+=Math.PI/12
      spherical.makeSafe(); this.camera.position.copy(this.controls.target).add(offset.setFromSpherical(spherical))
    }
    this.controls.update(); this.invalidate()
  }
  keyDown = (e: KeyboardEvent) => {
    if (this.flying) return
    const target=e.target
    if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return
    if (e.code === 'Escape' && this.placementRegion) { this.endPlacementRegion(true); e.preventDefault(); return }
    if (!this.props.previewMode && this.editorInteraction.keyDown(e)) { e.preventDefault(); return }
    const command=keyViewCommand(e.code,e.ctrlKey,e.shiftKey)
    if (command) { e.preventDefault(); this.command(command); return }
    if (this.props.previewMode) return
    if (['Delete', 'Backspace', 'KeyR'].includes(e.code) || e.ctrlKey && e.code === 'KeyZ') e.preventDefault()
    if (e.code === 'Delete' || e.code === 'Backspace') this.props.onDelete()
    else if (e.ctrlKey && e.code === 'KeyZ') this.props.onUndo(e.shiftKey)
    else if (e.code === 'KeyR') this.props.onRotate()
  }
  async startFly() {
    if (this.editorInteraction.modal || this.editorInteraction.dragging) this.editorInteraction.cancel()
    if (this.camera instanceof T.OrthographicCamera) this.toggleProjection()
    try { await this.renderer.domElement.requestPointerLock(); this.props.onMessage('Fly: WASD · Q/E down/up · Shift to speed up · Esc to exit') }
    catch { this.props.onMessage('Pointer lock is unavailable. Use middle mouse to navigate.') }
  }
  flyKeyDown = (e: KeyboardEvent) => { if (this.flying) { this.keys.add(e.code); e.preventDefault() } }
  keyUp = (e: KeyboardEvent) => { this.keys.delete(e.code) }
  blur = () => { this.keys.clear(); this.ctrlZoom = false; this.endPlacementRegion(true); if (this.editorInteraction.modal || this.editorInteraction.dragging || this.editorInteraction.boxStart || this.editorInteraction.boxArmed) this.editorInteraction.cancel(); this.down = null; this.controls.enabled = !this.flying; if (this.flying) document.exitPointerLock() }
  lockChange = () => {
    this.controls.enabled = !this.flying; this.keys.clear()
    if (!this.flying) { this.controls.target.copy(this.camera.position).addScaledVector(this.camera.getWorldDirection(new T.Vector3()), 4); this.controls.update() }
    this.lastTime = performance.now(); this.invalidate()
  }
  mouseLook = (e: MouseEvent) => {
    if (!this.flying) return
    const rotation = new T.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ')
    rotation.y -= e.movementX * .002; rotation.x = T.MathUtils.clamp(rotation.x - e.movementY * .002, -Math.PI / 2 + .01, Math.PI / 2 - .01)
    this.camera.quaternion.setFromEuler(rotation)
  }
  wheel = (e: WheelEvent) => { if (this.flying) { e.preventDefault(); e.stopImmediatePropagation() } }
  update(props: Props) {
    const resourcesChanged=props.packs!==this.props.packs || props.profile!==this.props.profile || props.resolver!==this.props.resolver
    const rebuild = resourcesChanged || props.blocks !== this.props.blocks || props.entities!==this.props.entities || props.catalog!==this.props.catalog || props.clip !== this.props.clip || props.local !== this.props.local || props.local && props.selected !== this.props.selected
    const editorToolChanged=props.editor?.tool!==this.props.editor?.tool
    const placementSessionChanged=props.editor?.placementSession!==this.props.editor?.placementSession
    const hidePreview=props.tool!==this.props.tool||props.ghost!==this.props.ghost||editorToolChanged
    const highlight=props.selected!==this.props.selected || props.previewMode!==this.props.previewMode
    const layer=props.layer!==this.props.layer
    const frame=props.frameKey!==this.props.frameKey
    const command=props.command?.id!==this.props.command?.id ? props.command : undefined
    this.props = props
    if (this.placementRegion) {
      if (rebuild || layer || props.previewMode || props.editor?.tool!=='place' || !props.editor.onPlacementRegionPoint || (this.placementRegion.session !== undefined && this.placementRegion.session !== props.editor.placementSession)) this.endPlacementRegion(true)
      else this.placementRegion.session = props.editor.placementSession
    }
    if(placementSessionChanged)this.placementPointer=null
    if (editorToolChanged || rebuild || layer) { this.placementHoverKey = ''; this.placementCameraKey = '' }
    if (rebuild) this.rebuild(resourcesChanged)
    else {
      if (layer) { this.grid.position.y=props.layer-.005; this.invalidate() }
      if (hidePreview) { this.preview.visible=false; this.invalidate() }
      if (highlight) { this.highlight(); this.invalidate() }
      this.editorInteraction.update(props.previewMode ? undefined : props.editor, props.blocks)
    }
    if (frame) this.frameBlocks(false)
    if (command) this.command(command.kind)
  }
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer.disconnect()
    if (this.flying) document.exitPointerLock()
    this.editorInteraction.dispose(); this.controls.dispose(); this.disposeMeshes()
    this.grid.geometry.dispose(); (this.grid.material as T.Material).dispose()
    this.selection.dispose(); this.preview.dispose(); this.renderer.dispose()
    window.removeEventListener('pointerup', this.pointerUp); window.removeEventListener('blur', this.blur)
    document.removeEventListener('pointerlockchange', this.lockChange); document.removeEventListener('mousemove', this.mouseLook)
    document.removeEventListener('keydown', this.flyKeyDown); document.removeEventListener('keyup', this.keyUp)
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, true)
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove, true)
    this.renderer.domElement.removeEventListener('pointerleave', this.pointerLeave)
    this.renderer.domElement.removeEventListener('pointercancel', this.pointerCancel)
    this.renderer.domElement.removeEventListener('contextmenu', this.contextMenu)
    this.renderer.domElement.removeEventListener('keydown', this.keyDown)
    this.renderer.domElement.removeEventListener('wheel', this.wheel, true)
    this.renderer.domElement.remove()
  }
}

export function Viewport(props: Props) {
  const host = useRef<HTMLDivElement>(null), view = useRef<ViewportController | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    try { view.current = new ViewportController(host.current!, props) }
    catch { setError('Could not start WebGL2. Enable graphics acceleration in your browser.') }
    return () => { view.current?.dispose(); view.current = null }
    // The controller owns the canvas; callbacks and scene state are updated separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { view.current?.update(props) })
  return <div className="viewport" ref={host}>{error && <div className="viewport-error">{error}</div>}</div>
}
