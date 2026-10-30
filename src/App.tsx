import { Component, Suspense, lazy, useCallback, useMemo, useState, type ReactNode } from 'react'
import { defaultState, validateState } from './core/catalog'
import { resourceName } from './core/labels'
import type { BlockState, SceneBlock, SceneEntity } from './core/schema'
import { useResources } from './resources/useResources'
import type { RenderDiagnostics, RenderMetrics, ViewCommand, ViewCommandKind } from './viewport/Viewport'
import { HelpDialog } from './ui/HelpDialog'
import { Icon, type IconName } from './ui/Icon'
import { ResourceBrowser } from './ui/ResourceBrowser'
import { ResourceInspector } from './ui/ResourceInspector'
import { ResourceManager } from './ui/ResourceManager'
import { EditorWorkbench } from './ui/EditorWorkbench'
import { useEditorSession } from './editor/useEditorSession'
import './App.css'
import './ui/workspace.css'

const Viewport = lazy(() => import('./viewport/Viewport').then(module => ({ default: module.Viewport })))
const EMPTY_POSITIONS: [number, number, number][] = []
const noop = () => {}
type Workspace = 'architecture' | 'component' | 'preview' | 'assets'

class ViewportBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <div className="viewport-empty" role="alert"><Icon name="warning" size={32} /><strong>3D preview unavailable</strong><p>Enable WebGL in your browser, then reload.</p><button onClick={() => location.reload()}>Reload</button></div> : this.props.children
  }
}

export default function App() {
  const resources = useResources()
  const { packs, profile, catalog, resolver, ready, busy } = resources
  const editorSession = useEditorSession(catalog, resources.profile?.neighborRules)
  const [workspace, changeWorkspace] = useState<Workspace>(() => {
    try {
      const saved = localStorage.getItem('blockstage-workspace')
      if (['architecture', 'component', 'preview', 'assets'].includes(saved ?? '')) return saved as Workspace
    } catch { /* Storage preferences are optional; editor documents use IndexedDB. */ }
    return 'architecture'
  })
  function setWorkspace(next: Workspace) {
    editorSession.cancelPreview()
    changeWorkspace(next)
    try { localStorage.setItem('blockstage-workspace', next) } catch { /* Session remains usable. */ }
  }
  const [kind, setKind] = useState<'block' | 'entity'>('block')
  const [requestedState, setState] = useState<BlockState>(() => defaultState('minecraft:oak_log'))
  const state = useMemo(() => {
    try { validateState(requestedState, catalog); return requestedState }
    catch { return defaultState(catalog.some(item => item.id === requestedState.name) ? requestedState.name : catalog[0].id, catalog) }
  }, [requestedState, catalog])
  const [entityId, setEntityId] = useState('minecraft:armor_stand')
  const [yaw, setYaw] = useState(0)
  const [managerOpen, setManagerOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(() => matchMedia('(min-width: 761px)').matches)
  const [inspectorOpen, setInspectorOpen] = useState(() => matchMedia('(min-width: 1000px)').matches)
  const [message, setMessage] = useState('')
  const [command, setCommand] = useState<ViewCommand>()
  const [diagnostics, setDiagnostics] = useState<RenderDiagnostics>({ modeledBlocks: 0, fallbackBlocks: 0, entities: 0, issues: [] })
  const [metrics, setMetrics] = useState<RenderMetrics>({ drawCalls: 0, triangles: 0, geometries: 0, textures: 0 })
  const selectedId = kind === 'block' ? state.name : entityId
  const enabled = packs.filter(pack => pack.enabled).length

  const blocks = useMemo<SceneBlock[]>(() => kind === 'block' ? [{ pos: [0, 0, 0], state, owner: 'preview' }] : [], [kind, state])
  const entities = useMemo<SceneEntity[]>(() => kind === 'entity' ? [{ id: 'preview', type: entityId, position: [0, 0, 0], yaw }] : [], [kind, entityId, yaw])
  const frameKey = `${kind}:${selectedId}:${enabled > 0}`
  const view = useCallback((next: ViewCommandKind) => setCommand(previous => ({ id: (previous?.id ?? 0) + 1, kind: next })), [])
  const select = useCallback((id: string) => {
    setMessage('')
    if (kind === 'block') setState(defaultState(id, catalog))
    else { setEntityId(id); setYaw(0) }
  }, [kind, catalog])
  const setPreviewState = useCallback((next: BlockState) => {
    try { validateState(next, catalog); setState(next); setMessage('') }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
  }, [catalog])
  const navigation: { kind: ViewCommandKind; label: string; icon: IconName }[] = [
    { kind: 'frame-all', label: 'Frame asset · Home', icon: 'frame' },
    { kind: 'projection', label: 'Perspective / orthographic · Numpad 5', icon: 'perspective' },
    { kind: 'zoom-in', label: 'Zoom in', icon: 'zoom-in' },
    { kind: 'zoom-out', label: 'Zoom out', icon: 'zoom-out' },
  ]
  const status = !ready ? 'Restoring resources' : busy ? 'Updating resources' : !enabled ? 'No assets enabled' : workspace === 'assets' && diagnostics.issues.length ? 'Partial appearance' : workspace === 'assets' ? 'Resource preview' : 'Editor ready'

  return <div className={`app-shell${workspace === 'assets' && !libraryOpen ? ' library-hidden' : ''}${workspace === 'assets' && !inspectorOpen ? ' inspector-hidden' : ''}`} data-ready={ready}>
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><Icon name="cube" size={24} /></span><span>Blockstage<span className="brand-studio">Studio</span></span></div>
      <nav className="workspace-tabs" aria-label="Workspaces">{([['architecture', 'Architecture'], ['component', 'Component Editor'], ['preview', '3D Preview'], ['assets', 'Assets']] as const).map(([id, label]) => <button key={id} aria-label={`${label} workspace`} aria-pressed={workspace === id} className={workspace === id ? 'active' : ''} onClick={() => { editorSession.cancelPreview(); setWorkspace(id) }}>{label}</button>)}</nav>
      <div className="top-actions"><span className="version-label">Java 26.2</span><button className="icon-button" aria-label="Navigation help" title="Navigation help" onClick={() => setHelpOpen(true)}><Icon name="help" size={18} /></button><button className="button primary" onClick={() => setManagerOpen(true)} disabled={!ready}><Icon name="layers" size={16} />Resources<span className="button-count">{packs.length}</span></button></div>
    </header>
    {workspace === 'assets' ? <main className="workbench">
      {libraryOpen && <aside className="library"><ResourceBrowser catalog={catalog} profile={profile} resolver={resolver} kind={kind} selected={selectedId} onKind={setKind} onSelect={select} /></aside>}
      <section className="stage" aria-label="3D resource preview">
        <div className="view-toolbar"><div className="view-label"><button className="icon-button" aria-label="Toggle asset library" aria-pressed={libraryOpen} onClick={() => setLibraryOpen(value => !value)}><Icon name="menu" size={16} /></button><span>Asset preview</span><span className="preview-badge">3D</span></div><div className="view-actions">{navigation.map(item => <button className="icon-button" key={item.kind} aria-label={item.label} title={item.label} onClick={() => view(item.kind)}><Icon name={item.icon} size={17} /></button>)}<span className="toolbar-separator" /><button className="icon-button" aria-label="Toggle inspector" aria-pressed={inspectorOpen} onClick={() => setInspectorOpen(value => !value)}><Icon name="sliders" size={17} /></button></div></div>
        <div className="canvas-wrap">
          <ViewportBoundary>
            <Suspense fallback={<div className="viewport-empty"><Icon name="cube" size={32} /><span>Opening viewport…</span></div>}>
              <Viewport
                blocks={blocks} entities={entities} packs={packs} catalog={catalog} profile={profile} resolver={resolver}
                selected={null} tool="select" layer={0} ghost={EMPTY_POSITIONS} clip={null} local={false}
                onPick={noop} onDelete={noop} onUndo={noop} onRotate={noop} onHover={noop} onEntityPick={noop}
                onDiagnostics={setDiagnostics} onMetrics={setMetrics} onMessage={setMessage}
                previewMode frameKey={frameKey} command={command}
              />
            </Suspense>
          </ViewportBoundary>
          <div className="viewport-caption"><span>{resourceName(selectedId)}</span><small>1 unit = 1 block</small></div>
          <div className="navigation-widget" aria-label="Camera views"><button className="nav-up" aria-label="Orbit up" title="Orbit up · Numpad 8" onClick={() => view('orbit-up')}><Icon name="chevron-up" size={14} /></button><button className="nav-left" aria-label="Orbit left" title="Orbit left · Numpad 4" onClick={() => view('orbit-left')}><Icon name="chevron" size={14} /></button><button className="nav-front" aria-label="Front view" title="Front: looking north (−Z) · Numpad 1" onClick={() => view('front')}>Z</button><button className="nav-right" aria-label="Orbit right" title="Orbit right · Numpad 6" onClick={() => view('orbit-right')}><Icon name="chevron" size={14} /></button><button className="nav-down" aria-label="Orbit down" title="Orbit down · Numpad 2" onClick={() => view('orbit-down')}><Icon name="chevron-down" size={14} /></button><button className="nav-top" aria-label="Top view" title="Top: looking down (−Y) · Numpad 7" onClick={() => view('top')}>Y</button><button className="nav-side" aria-label="Right view" title="Right: looking west (−X) · Numpad 3" onClick={() => view('right')}>X</button></div>
          {!enabled && ready && <div className="setup-prompt"><Icon name="layers" size={18} /><span>Add game assets to see their appearance</span><button className="button" onClick={() => setManagerOpen(true)}>Import resources</button></div>}
          {!!diagnostics.issues.length && enabled > 0 && <details className="viewport-diagnostics"><summary><Icon name="warning" size={14} />Appearance details <span>{diagnostics.issues.length}</span></summary><ul>{diagnostics.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></details>}
        </div>
        <div className="stage-footer"><span><Icon name="orbit" size={14} /><kbd>MMB</kbd> Orbit<span className="shortcut-extra"> · <kbd>Shift MMB</kbd> Pan · <kbd>Wheel</kbd> Zoom</span></span><button className="text-button" onClick={() => setHelpOpen(true)}><Icon name="keyboard" size={14} />Controls</button></div>
      </section>
      {inspectorOpen && <aside className="inspector"><ResourceInspector kind={kind} id={selectedId} state={state} profile={profile} catalog={catalog} resolver={resolver} onState={setPreviewState} yaw={yaw} onYaw={value => setYaw(Math.max(-360, Math.min(360, value)))} /></aside>}
    </main> : <EditorWorkbench resources={resources} session={editorSession} workspace={workspace} onWorkspace={setWorkspace} onResources={() => setManagerOpen(true)} />}
    <footer className="statusbar"><span className={`resource-status${enabled ? ' connected' : ''}`}><span className="status-dot" />{status}</span><span>{enabled} / {packs.length} packs enabled</span><span className="status-spacer" /><span title={`${metrics.drawCalls} draw calls · ${metrics.triangles.toLocaleString()} triangles · ${metrics.textures} textures`}>Local workspace</span><span className="status-unit">+Y up · Grid 1</span></footer>
    <output className="render-diagnostics" hidden data-modeled={diagnostics.modeledBlocks} data-fallback={diagnostics.fallbackBlocks} data-entities={diagnostics.entities} data-asset={selectedId} data-properties={JSON.stringify(state.properties)} />
    {!managerOpen && (resources.error || message) && <div className="feedback-toast" role="alert"><Icon name="warning" size={16} /><span>{resources.error || message}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => { resources.clearError(); setMessage('') }}><Icon name="close" size={15} /></button></div>}
    {managerOpen && <ResourceManager resources={resources} onClose={() => setManagerOpen(false)} />}
    {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
  </div>
}
