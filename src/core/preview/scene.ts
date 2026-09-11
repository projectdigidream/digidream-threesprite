/**
 * The 3D preview scene: billboarded sprites on a ground grid, orbit camera,
 * and the view-selection logic that mirrors what a game does. Textures come
 * from the same composed frames as the 2D editor and the exporters.
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Id, ViewIndex } from '../../domain/types'
import { viewIndex } from '../../domain/views'
import { bearingTurns, billboardYaw, facingDirection } from './rotation'

export interface SceneSource {
  /** Composed RGBA frame for (anim, frame, view), canvas-sized. */
  frame: (animId: Id | null, frame: number, view: ViewIndex) => Uint8ClampedArray
  canvasSize: () => number
  revision: () => number
}

export interface SceneParams {
  N: number
  animId: Id | null
  frame: number
  worldHeight: number
  spread: boolean
  facingTurns: number
  showArrows: boolean
}

interface TexEntry { revision: number; size: number; tex: THREE.DataTexture }

class TextureCache {
  private entries = new Map<string, TexEntry>()
  constructor(private readonly src: SceneSource, private readonly cap = 256) {}

  get(animId: Id | null, frame: number, view: ViewIndex): THREE.DataTexture {
    const key = `${animId ?? '_'}:${frame}:${view}`
    const rev = this.src.revision()
    const size = this.src.canvasSize()
    const hit = this.entries.get(key)
    if (hit && hit.revision === rev && hit.size === size) return hit.tex
    const data = this.src.frame(animId, frame, view)
    if (hit && hit.size === size) {
      ;(hit.tex.image.data as Uint8ClampedArray).set(data)
      hit.tex.needsUpdate = true
      hit.revision = rev
      return hit.tex
    }
    if (hit) hit.tex.dispose()
    const copy = new Uint8ClampedArray(data)
    const tex = new THREE.DataTexture(copy, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
    tex.flipY = true
    tex.magFilter = THREE.NearestFilter
    tex.minFilter = THREE.NearestFilter
    tex.generateMipmaps = false
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    if (this.entries.size >= this.cap) {
      const first = this.entries.keys().next().value
      if (first !== undefined) { this.entries.get(first)?.tex.dispose(); this.entries.delete(first) }
    }
    this.entries.set(key, { revision: rev, size, tex })
    return tex
  }

  dispose() {
    for (const e of this.entries.values()) e.tex.dispose()
    this.entries.clear()
  }
}

interface SpriteInstance {
  group: THREE.Group
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  arrow: THREE.ArrowHelper
  label: THREE.Sprite
  labelCanvas: HTMLCanvasElement
  labelText: string
  facingTurns: number
  view: ViewIndex
}

/** Positions of the spread instances along X, centred, in units of world height. */
export function spreadPositions(N: number, spacing: number): number[] {
  const out: number[] = []
  for (let i = 0; i < N; i++) out.push((i - (N - 1) / 2) * spacing)
  return out
}

export class PreviewScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  readonly controls: OrbitControls
  private textures: TextureCache
  private instances: SpriteInstance[] = []
  private grid: THREE.GridHelper
  private lastKey = ''
  /** Called when the primary instance's shown view changes. */
  onView: ((view: ViewIndex, instanceViews: ViewIndex[]) => void) | null = null

  constructor(canvas: HTMLCanvasElement, private readonly src: SceneSource) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'low-power' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.scene.background = new THREE.Color(0x181c26)
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 200)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.12
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02
    this.controls.minDistance = 0.3
    this.controls.maxDistance = 60
    this.grid = new THREE.GridHelper(10, 10, 0x4a5368, 0x2a3040)
    this.scene.add(this.grid)
    const axes = new THREE.AxesHelper(0.5)
    axes.position.y = 0.002
    this.scene.add(axes)
    this.textures = new TextureCache(src)
    this.resetCamera(1)
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / Math.max(1, h)
    this.camera.updateProjectionMatrix()
  }

  resetCamera(h: number, spreadWidth = 0) {
    const dist = Math.max(3 * h, spreadWidth * 0.9 + 2 * h)
    this.controls.target.set(0, h / 2, 0)
    // Slightly off-axis so the ground reads as 3D, but well inside view 1's arc (±180°/N) for any N ≤ 16.
    const d = facingDirection(0.03)
    this.camera.position.set(d.x * dist, h * 0.9, d.z * dist)
    this.camera.lookAt(this.controls.target)
    this.controls.update()
  }

  private makeInstance(h: number): SpriteInstance {
    const geo = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, depthWrite: true })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.scale.set(h, h, 1)
    mesh.position.y = h / 2
    const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.01, 0), h * 0.8, 0xffb454, h * 0.2, h * 0.12)
    const labelCanvas = document.createElement('canvas')
    labelCanvas.width = 256
    labelCanvas.height = 64
    const labelTex = new THREE.CanvasTexture(labelCanvas)
    labelTex.colorSpace = THREE.SRGBColorSpace
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTex, transparent: true, depthTest: false }))
    label.scale.set(h * 0.9, h * 0.225, 1)
    label.position.y = h * 1.14
    const group = new THREE.Group()
    group.add(mesh, arrow, label)
    this.scene.add(group)
    return { group, mesh, arrow, label, labelCanvas, labelText: '', facingTurns: 0, view: 1 }
  }

  private disposeInstance(i: SpriteInstance) {
    this.scene.remove(i.group)
    i.mesh.geometry.dispose()
    i.mesh.material.dispose()
    i.arrow.dispose()
    ;(i.label.material.map as THREE.Texture | null)?.dispose()
    i.label.material.dispose()
  }

  private setLabel(i: SpriteInstance, text: string) {
    if (i.labelText === text) return
    i.labelText = text
    const ctx = i.labelCanvas.getContext('2d')!
    ctx.clearRect(0, 0, 256, 64)
    ctx.font = 'bold 30px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(16, 8, 224, 48)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, 128, 33)
    ;(i.label.material.map as THREE.Texture).needsUpdate = true
  }

  /** Rebuild instances when count / height / spread change. */
  private layout(p: SceneParams) {
    const h = Math.max(0.05, p.worldHeight)
    const count = p.spread ? p.N : 1
    const key = `${count}:${h}:${p.spread}`
    if (key === this.lastKey) return
    this.lastKey = key
    for (const i of this.instances) this.disposeInstance(i)
    this.instances = []
    const spacing = h * 1.5
    const xs = p.spread ? spreadPositions(count, spacing) : [0]
    for (let i = 0; i < count; i++) {
      const inst = this.makeInstance(h)
      inst.group.position.x = xs[i]
      this.instances.push(inst)
    }
    const gridSize = Math.max(10, Math.ceil(count * spacing + 4))
    this.scene.remove(this.grid)
    this.grid.dispose()
    this.grid = new THREE.GridHelper(gridSize, gridSize, 0x4a5368, 0x2a3040)
    this.scene.add(this.grid)
    this.resetCamera(h, p.spread ? count * spacing : 0)
  }

  tick(p: SceneParams) {
    this.layout(p)
    this.controls.update()
    const cam = this.camera.position
    const views: ViewIndex[] = []
    let changed = false
    this.instances.forEach((inst, i) => {
      inst.facingTurns = p.spread ? i / p.N : p.facingTurns
      const px = inst.group.position.x
      const pz = inst.group.position.z
      const bearing = bearingTurns(px, pz, cam.x, cam.z)
      const view = viewIndex(p.N, inst.facingTurns, bearing)
      if (view !== inst.view) { inst.view = view; changed = true }
      views.push(view)
      const tex = this.textures.get(p.animId, p.frame, view)
      if (inst.mesh.material.map !== tex) { inst.mesh.material.map = tex; inst.mesh.material.needsUpdate = true }
      inst.mesh.rotation.y = billboardYaw(cam.x, cam.z, px, pz)
      const d = facingDirection(inst.facingTurns)
      inst.arrow.setDirection(new THREE.Vector3(d.x, 0, d.z))
      inst.arrow.visible = p.showArrows
      inst.label.visible = p.showArrows
      this.setLabel(inst, p.spread ? `${Math.round(inst.facingTurns * 360)}° → view ${view}` : `view ${view}`)
    })
    if (changed && this.onView && this.instances.length) this.onView(this.instances[0].view, views)
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    for (const i of this.instances) this.disposeInstance(i)
    this.instances = []
    this.textures.dispose()
    this.controls.dispose()
    this.grid.dispose()
    this.renderer.dispose()
  }
}
