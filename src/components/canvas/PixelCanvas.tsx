/**
 * The editing surface. One <canvas> shows the composed frame of the current
 * view through a zoom/pan transform; drawing tools map pointer positions
 * through the selected part's matrix into that part's image, so what you
 * paint lands exactly where the cursor is, whatever the rig does to the part.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { composeFrame, imageKey, partCanvasMatrix } from '../../core/raster/rasterizer'
import { fillAt, strokeSegment } from '../../core/tools/brush'
import { ZOOM_MAX, ZOOM_MIN, centeredPan, clampZoom, fitZoom, nextZoom, snapZoom, zoomAbout } from '../../core/tools/zoom'
import { blitCopy, clearRect, cloneImage, createImage, cropImage, TRANSPARENT, type Rect } from '../../domain/image'
import { getPartImage } from '../../domain/project'
import { apply, invert, type Mat2D } from '../../domain/transform'
import type { Id, PartImage, Project } from '../../domain/types'
import { isDerived, mirrorOf, viewLabel } from '../../domain/views'
import { isTypingTarget } from '../../hooks/useKeyboardShortcuts'
import { frameCache } from '../../store/caches'
import { editorStore, useEditor, type EditorState } from '../../store/editorStore'
import { drawRigOverlay, hitRig, type RigDrag, rigDragMove } from './rigOverlay'

type Pt = { x: number; y: number }

type Gesture =
  | { kind: 'idle' }
  | { kind: 'stroke'; pointerId: number; tool: 'pencil' | 'eraser'; key: string; partId: Id; variantId: Id; view: number; before: PartImage | undefined; working: PartImage; last: Pt; startClient: Pt; startedAt: number; moved: boolean; timer: number }
  | { kind: 'select'; pointerId: number; start: Pt; partId: Id }
  | { kind: 'move'; pointerId: number; key: string; partId: Id; variantId: Id; view: number; before: PartImage; base: PartImage; float: PartImage; rect: Rect; start: Pt; delta: Pt }
  | { kind: 'pan'; pointerId: number; startClient: Pt; startPan: Pt }
  | { kind: 'pinch'; a: number; b: number; startDist: number; startZoom: number; startMid: Pt; startPan: Pt }
  | { kind: 'rig'; pointerId: number; drag: RigDrag }

interface Target {
  partId: Id
  variantId: Id
  view: number
  srcView: number
  derived: boolean
  image: PartImage | undefined
  m: Mat2D | null
  animId: Id | null
  frame: number
}

function getTarget(s: EditorState): Target | null {
  const { doc, ui } = s
  const partId = ui.selectedPartId
  if (!partId || !doc.parts[partId]) return null
  const part = doc.parts[partId]
  const variantId = ui.variantId && part.variants[ui.variantId] ? ui.variantId : part.defaultVariant
  const derived = isDerived(doc.views.count, doc.views.mirror, ui.view)
  const srcView = derived ? mirrorOf(doc.views.count, ui.view) : ui.view
  const animId = ui.mode === 'draw' ? null : ui.animId
  const frame = ui.mode === 'draw' ? 0 : ui.frame
  return { partId, variantId, view: ui.view, srcView, derived, image: getPartImage(doc, partId, variantId, srcView), m: partCanvasMatrix(doc, animId, frame, partId), animId, frame }
}

/** Size for a new image of a part: match its existing images, else the canvas. */
function newImageSize(doc: Project, partId: Id, variantId: Id): { w: number; h: number } {
  const part = doc.parts[partId]
  const candidates = [part.variants[variantId], ...part.variantOrder.map(id => part.variants[id])]
  for (const v of candidates) {
    for (const img of Object.values(v?.images ?? {})) return { w: img.width, h: img.height }
  }
  return { w: doc.canvas.size, h: doc.canvas.size }
}

/** Nearest authored view of the same variant that has an image (for "copy from"). */
function nearestImageView(doc: Project, partId: Id, variantId: Id, view: number): number | null {
  const v = doc.parts[partId]?.variants[variantId]
  if (!v) return null
  const N = doc.views.count
  let best: number | null = null
  let bestD = Infinity
  for (const k of Object.keys(v.images).map(Number)) {
    const d = Math.min(Math.abs(k - view), N - Math.abs(k - view))
    if (d < bestD) { bestD = d; best = k }
  }
  return best
}

function dist(a: Pt, b: Pt): number { return Math.hypot(a.x - b.x, a.y - b.y) }

export default function PixelCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offRef = useRef<HTMLCanvasElement | null>(null)
  const onionRef = useRef<HTMLCanvasElement | null>(null)
  const checkerRef = useRef<CanvasPattern | null>(null)
  const outRef = useRef<Uint8ClampedArray | null>(null)
  const overridesRef = useRef(new Map<string, PartImage>())
  const gestureRef = useRef<Gesture>({ kind: 'idle' })
  const pointersRef = useRef(new Map<number, Pt & { type: string }>())
  const ignoreUntilUpRef = useRef(false)
  const spaceRef = useRef(false)
  const rafRef = useRef(0)
  const sizeRef = useRef({ w: 0, h: 0 })
  const fittedDocRef = useRef<string | null>(null)
  const [, force] = useState(0)

  const mode = useEditor(s => s.ui.mode)
  const tool = useEditor(s => s.ui.tool)
  const view = useEditor(s => s.ui.view)
  const revision = useEditor(s => s.revision)
  const selectedPartId = useEditor(s => s.ui.selectedPartId)
  const variantId = useEditor(s => s.ui.variantId)
  const docViews = useEditor(s => s.doc.views)

  // ── drawing ────────────────────────────────────────────────────────────────

  const redraw = useCallback(() => {
    rafRef.current = 0
    const canvas = canvasRef.current
    if (!canvas) return
    const s = editorStore.getState()
    const { doc, ui } = s
    const { w: W, h: H } = sizeRef.current
    if (W === 0 || H === 0) return
    const dpr = Math.min(window.devicePixelRatio || 1, 3)
    const bw = Math.round(W * dpr)
    const bh = Math.round(H * dpr)
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, bw, bh)
    ctx.scale(dpr, dpr)

    const n = doc.canvas.size
    const z = ui.zoom
    const px = ui.pan.x
    const py = ui.pan.y

    // checkerboard under the canvas area
    if (!checkerRef.current) {
      const c = document.createElement('canvas')
      c.width = 16; c.height = 16
      const cc = c.getContext('2d')!
      cc.fillStyle = '#2a3040'; cc.fillRect(0, 0, 16, 16)
      cc.fillStyle = '#343b4d'; cc.fillRect(0, 0, 8, 8); cc.fillRect(8, 8, 8, 8)
      checkerRef.current = ctx.createPattern(c, 'repeat')
    }
    ctx.save()
    ctx.translate(px, py)
    ctx.fillStyle = checkerRef.current ?? '#2a3040'
    ctx.fillRect(0, 0, n * z, n * z)
    ctx.restore()

    // compose the frame
    const showAnim = ui.mode === 'animate' || ui.mode === 'preview'
    const animId = showAnim ? ui.animId : null
    const frame = showAnim ? ui.frame : 0
    const dim = ui.mode === 'draw' && ui.ghostOthers && ui.selectedPartId && doc.partOrder.length > 1 ? { except: ui.selectedPartId, alpha: 0.35 } : undefined
    if (!outRef.current || outRef.current.length !== n * n * 4) outRef.current = new Uint8ClampedArray(n * n * 4)
    const pixels = composeFrame(doc, animId, frame, ui.view, { overrides: overridesRef.current, dim, out: outRef.current })

    if (!offRef.current) offRef.current = document.createElement('canvas')
    const off = offRef.current
    if (off.width !== n || off.height !== n) { off.width = n; off.height = n }
    const octx = off.getContext('2d')!
    octx.putImageData(new ImageData(pixels, n, n), 0, 0)

    ctx.imageSmoothingEnabled = false
    // onion skin: previous frame under the current one
    const anim = animId ? doc.animations[animId] : null
    if (showAnim && ui.onion && anim && anim.frameCount > 1) {
      const prevFrame = (frame - 1 + anim.frameCount) % anim.frameCount
      const prev = frameCache.get(animId, prevFrame, ui.view)
      if (!onionRef.current) onionRef.current = document.createElement('canvas')
      const oc = onionRef.current
      if (oc.width !== n || oc.height !== n) { oc.width = n; oc.height = n }
      oc.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(prev), n, n), 0, 0)
      ctx.globalAlpha = 0.35
      ctx.drawImage(oc, px, py, n * z, n * z)
      ctx.globalAlpha = 1
    }
    ctx.drawImage(off, px, py, n * z, n * z)

    // grid
    if (ui.grid && z >= 8) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let i = 1; i < n; i++) {
        ctx.moveTo(px + i * z + 0.5, py); ctx.lineTo(px + i * z + 0.5, py + n * z)
        ctx.moveTo(px, py + i * z + 0.5); ctx.lineTo(px + n * z, py + i * z + 0.5)
      }
      ctx.stroke()
    }
    // canvas border + ground line
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(px - 0.5, py - 0.5, n * z + 1, n * z + 1)
    ctx.strokeStyle = 'rgba(255,180,84,0.9)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(px - 8, py + n * z + 1); ctx.lineTo(px + n * z + 8, py + n * z + 1); ctx.stroke()

    const t = getTarget(s)
    const toScreen = (m: Mat2D, x: number, y: number): Pt => { const p = apply(m, x, y); return { x: px + p.x * z, y: py + p.y * z } }

    if (t && t.m && ui.mode === 'draw') {
      // mirror axis of the edited image
      if (ui.mirrorDraw && t.image) {
        const a = toScreen(t.m, t.image.width / 2, 0)
        const b = toScreen(t.m, t.image.width / 2, t.image.height)
        ctx.save(); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(94,200,255,0.9)'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore()
      }
      // selection
      const g = gestureRef.current
      const sel = g.kind === 'move' ? { ...g.rect, x: g.rect.x + g.delta.x, y: g.rect.y + g.delta.y } : ui.selection
      if (sel) {
        const c = [toScreen(t.m, sel.x, sel.y), toScreen(t.m, sel.x + sel.w, sel.y), toScreen(t.m, sel.x + sel.w, sel.y + sel.h), toScreen(t.m, sel.x, sel.y + sel.h)]
        ctx.save(); ctx.setLineDash([5, 3]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath(); ctx.stroke()
        ctx.strokeStyle = '#000'; ctx.lineDashOffset = 4; ctx.stroke(); ctx.restore()
      }
      // faint outline of the edited image's bounds when it is not the whole canvas
      if (t.image && (t.image.width !== n || t.image.height !== n || !isIdentityLike(t.m))) {
        const c = [toScreen(t.m, 0, 0), toScreen(t.m, t.image.width, 0), toScreen(t.m, t.image.width, t.image.height), toScreen(t.m, 0, t.image.height)]
        ctx.save(); ctx.strokeStyle = 'rgba(94,200,255,0.5)'; ctx.lineWidth = 1
        ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); for (let i = 1; i < 4; i++) ctx.lineTo(c[i].x, c[i].y); ctx.closePath(); ctx.stroke(); ctx.restore()
      }
    }

    if (ui.mode === 'rig' || ui.mode === 'animate') {
      drawRigOverlay(ctx, doc, ui, animId, frame, (x, y) => ({ x: px + x * z, y: py + y * z }), gestureRef.current.kind === 'rig' ? gestureRef.current.drag : null)
    }
  }, [])

  const schedule = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(redraw)
  }, [redraw])

  useEffect(() => editorStore.subscribe(schedule), [schedule])

  // size tracking + initial fit
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      sizeRef.current = { w: Math.round(r.width), h: Math.round(r.height) }
      const s = editorStore.getState()
      if (fittedDocRef.current !== s.doc.id && sizeRef.current.w > 0) {
        fittedDocRef.current = s.doc.id
        fitView()
      }
      schedule()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [schedule])

  // refit when a different document is loaded
  useEffect(() => {
    const s = editorStore.getState()
    if (fittedDocRef.current !== s.doc.id && sizeRef.current.w > 0) { fittedDocRef.current = s.doc.id; fitView() }
    schedule()
  }, [revision, schedule])

  function fitView() {
    const { doc } = editorStore.getState()
    const { w, h } = sizeRef.current
    const zoom = fitZoom(doc.canvas.size, w, h)
    editorStore.getState().setUi({ zoom, pan: centeredPan(doc.canvas.size, zoom, w, h) })
  }

  // ── coordinate helpers ─────────────────────────────────────────────────────

  const clientToCanvas = (cx: number, cy: number): Pt => {
    const r = canvasRef.current!.getBoundingClientRect()
    const { ui } = editorStore.getState()
    return { x: (cx - r.left - ui.pan.x) / ui.zoom, y: (cy - r.top - ui.pan.y) / ui.zoom }
  }
  const clientToLocal = (cx: number, cy: number): Pt => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: cx - r.left, y: cy - r.top }
  }
  /** Canvas position → image pixel of the target, via the pixel centre (matches the rasterizer's inverse mapping). */
  const canvasToImage = (t: Target, c: Pt): Pt | null => {
    if (!t.m) return null
    const inv = invert(t.m)
    if (!inv) return null
    const p = apply(inv, Math.floor(c.x) + 0.5, Math.floor(c.y) + 0.5)
    return { x: Math.floor(p.x), y: Math.floor(p.y) }
  }

  // ── gestures ───────────────────────────────────────────────────────────────

  const endStroke = (commit: boolean) => {
    const g = gestureRef.current
    if (g.kind !== 'stroke') return
    if (g.timer) clearTimeout(g.timer)
    overridesRef.current.delete(g.key)
    if (commit) editorStore.getState().commitPixels(g.tool === 'pencil' ? 'Draw' : 'Erase', g.partId, g.variantId, g.view, g.before, g.working)
    gestureRef.current = { kind: 'idle' }
    schedule()
  }

  const endMove = (commit: boolean) => {
    const g = gestureRef.current
    if (g.kind !== 'move') return
    overridesRef.current.delete(g.key)
    if (commit && (g.delta.x !== 0 || g.delta.y !== 0)) {
      const final = cloneImage(g.base)
      blitCopy(final, g.float, g.rect.x + g.delta.x, g.rect.y + g.delta.y)
      editorStore.getState().commitPixels('Move', g.partId, g.variantId, g.view, g.before, final)
      editorStore.getState().setUi({ selection: { ...g.rect, x: g.rect.x + g.delta.x, y: g.rect.y + g.delta.y } })
    }
    gestureRef.current = { kind: 'idle' }
    schedule()
  }

  const pickColor = (c: Pt) => {
    const s = editorStore.getState()
    const { doc, ui } = s
    const n = doc.canvas.size
    const x = Math.floor(c.x), y = Math.floor(c.y)
    if (x < 0 || y < 0 || x >= n || y >= n) return
    const showAnim = ui.mode !== 'draw'
    const full = composeFrame(doc, showAnim ? ui.animId : null, showAnim ? ui.frame : 0, ui.view)
    const i = (y * n + x) * 4
    if (full[i + 3] === 0) return
    s.setUi({ primary: [full[i], full[i + 1], full[i + 2], full[i + 3]] })
  }

  const startPinch = (a: number, b: number) => {
    const pa = pointersRef.current.get(a)!
    const pb = pointersRef.current.get(b)!
    const { ui } = editorStore.getState()
    gestureRef.current = { kind: 'pinch', a, b, startDist: Math.max(1, dist(pa, pb)), startZoom: ui.zoom, startMid: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }, startPan: { ...ui.pan } }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!
    canvas.setPointerCapture(e.pointerId)
    const local = clientToLocal(e.clientX, e.clientY)
    pointersRef.current.set(e.pointerId, { ...local, type: e.pointerType })
    if (ignoreUntilUpRef.current) return

    // second touch → pinch (cancels an in-progress stroke: palm/second-finger rejection)
    if (pointersRef.current.size === 2 && e.pointerType === 'touch') {
      const ids = [...pointersRef.current.keys()]
      if (gestureRef.current.kind === 'stroke') endStroke(false)
      if (gestureRef.current.kind === 'move') endMove(false)
      if (gestureRef.current.kind !== 'pinch') startPinch(ids[0], ids[1])
      return
    }
    if (gestureRef.current.kind !== 'idle') return

    const s = editorStore.getState()
    const { ui, doc } = s
    const c = clientToCanvas(e.clientX, e.clientY)
    const wantPan = ui.tool === 'hand' || e.button === 1 || spaceRef.current || (ui.mode !== 'draw' && ui.mode !== 'rig' && ui.mode !== 'animate')

    if (ui.mode === 'rig' || ui.mode === 'animate') {
      if (!wantPan) {
        const hit = hitRig(doc, ui, ui.mode === 'animate' ? ui.animId : null, ui.mode === 'animate' ? ui.frame : 0, c, (e.pointerType === 'touch' ? 24 : 14) / ui.zoom)
        if (hit) {
          gestureRef.current = { kind: 'rig', pointerId: e.pointerId, drag: hit }
          schedule()
          return
        }
      }
      gestureRef.current = { kind: 'pan', pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, startPan: { ...ui.pan } }
      return
    }

    if (wantPan) {
      gestureRef.current = { kind: 'pan', pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, startPan: { ...ui.pan } }
      return
    }
    if (e.button === 2) { pickColor(c); return }

    const t = getTarget(s)
    if (ui.tool === 'eyedropper') { pickColor(c); return }
    if (!t || !t.m) return
    if (t.derived) return // read-only view; the overlay explains

    const ip = canvasToImage(t, c)
    if (!ip) return

    if (ui.tool === 'pencil' || ui.tool === 'eraser') {
      const size = newImageSize(doc, t.partId, t.variantId)
      const working = t.image ? cloneImage(t.image) : createImage(size.w, size.h)
      const color = ui.tool === 'eraser' ? TRANSPARENT : ui.primary
      strokeSegment(working, ip.x, ip.y, ip.x, ip.y, color, ui.brushSize, ui.mirrorDraw)
      const key = imageKey(t.partId, t.variantId, t.srcView)
      overridesRef.current.set(key, working)
      const timer = e.pointerType === 'touch'
        ? window.setTimeout(() => {
          const g = gestureRef.current
          if (g.kind === 'stroke' && !g.moved) {
            endStroke(false)
            pickColor(c)
            ignoreUntilUpRef.current = true
          }
        }, 550)
        : 0
      gestureRef.current = { kind: 'stroke', pointerId: e.pointerId, tool: ui.tool, key, partId: t.partId, variantId: t.variantId, view: t.srcView, before: t.image, working, last: ip, startClient: { x: e.clientX, y: e.clientY }, startedAt: performance.now(), moved: false, timer }
      schedule()
      return
    }
    if (ui.tool === 'fill') {
      if (!t.image) return
      const working = cloneImage(t.image)
      if (fillAt(working, ip.x, ip.y, ui.primary, ui.mirrorDraw) > 0) s.commitPixels('Fill', t.partId, t.variantId, t.srcView, t.image, working)
      return
    }
    if (ui.tool === 'select') {
      gestureRef.current = { kind: 'select', pointerId: e.pointerId, start: ip, partId: t.partId }
      s.setUi({ selection: { x: ip.x, y: ip.y, w: 1, h: 1 } })
      return
    }
    if (ui.tool === 'move') {
      if (!t.image) return
      const rect = ui.selection ?? { x: 0, y: 0, w: t.image.width, h: t.image.height }
      const inside = ip.x >= rect.x && ip.y >= rect.y && ip.x < rect.x + rect.w && ip.y < rect.y + rect.h
      if (!inside && ui.selection) { s.setUi({ selection: null }); return }
      const base = cloneImage(t.image)
      const float = cropImage(t.image, rect)
      clearRect(base, rect)
      const key = imageKey(t.partId, t.variantId, t.srcView)
      overridesRef.current.set(key, cloneImage(t.image))
      gestureRef.current = { kind: 'move', pointerId: e.pointerId, key, partId: t.partId, variantId: t.variantId, view: t.srcView, before: t.image, base, float, rect, start: ip, delta: { x: 0, y: 0 } }
      return
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const local = clientToLocal(e.clientX, e.clientY)
    const prev = pointersRef.current.get(e.pointerId)
    if (prev) pointersRef.current.set(e.pointerId, { ...prev, ...local })
    const g = gestureRef.current
    const s = editorStore.getState()

    if (g.kind === 'pinch') {
      const pa = pointersRef.current.get(g.a)
      const pb = pointersRef.current.get(g.b)
      if (!pa || !pb) return
      const d = Math.max(1, dist(pa, pb))
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
      const newZoom = clampZoom(g.startZoom * (d / g.startDist))
      const pan = zoomAbout(g.startZoom, newZoom, g.startPan, g.startMid.x, g.startMid.y)
      s.setUi({ zoom: newZoom, pan: { x: pan.x + (mid.x - g.startMid.x), y: pan.y + (mid.y - g.startMid.y) } })
      return
    }
    if (g.kind === 'idle' || g.pointerId !== e.pointerId) return

    if (g.kind === 'pan') {
      s.setUi({ pan: { x: g.startPan.x + (e.clientX - g.startClient.x), y: g.startPan.y + (e.clientY - g.startClient.y) } })
      return
    }
    const c = clientToCanvas(e.clientX, e.clientY)
    if (g.kind === 'rig') {
      rigDragMove(s, g.drag, c, e.shiftKey)
      schedule()
      return
    }
    const t = getTarget(s)
    if (!t) return
    const ip = canvasToImage(t, c)
    if (!ip) return

    if (g.kind === 'stroke') {
      if (!g.moved && dist({ x: e.clientX, y: e.clientY }, g.startClient) > 6) g.moved = true
      if (ip.x === g.last.x && ip.y === g.last.y) return
      const color = g.tool === 'eraser' ? TRANSPARENT : s.ui.primary
      strokeSegment(g.working, g.last.x, g.last.y, ip.x, ip.y, color, s.ui.brushSize, s.ui.mirrorDraw)
      g.last = ip
      schedule()
      return
    }
    if (g.kind === 'select') {
      const x0 = Math.min(g.start.x, ip.x), y0 = Math.min(g.start.y, ip.y)
      const x1 = Math.max(g.start.x, ip.x), y1 = Math.max(g.start.y, ip.y)
      s.setUi({ selection: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } })
      return
    }
    if (g.kind === 'move') {
      const delta = { x: ip.x - g.start.x, y: ip.y - g.start.y }
      if (delta.x === g.delta.x && delta.y === g.delta.y) return
      g.delta = delta
      const temp = cloneImage(g.base)
      blitCopy(temp, g.float, g.rect.x + delta.x, g.rect.y + delta.y)
      overridesRef.current.set(g.key, temp)
      schedule()
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId)
    const g = gestureRef.current
    if (pointersRef.current.size === 0) ignoreUntilUpRef.current = false
    if (g.kind === 'pinch') {
      if (e.pointerId === g.a || e.pointerId === g.b) {
        // snap to a crisp level about the last midpoint
        const s = editorStore.getState()
        const z = s.ui.zoom
        const snapped = snapZoom(z)
        const { w, h } = sizeRef.current
        s.setUi({ zoom: snapped, pan: zoomAbout(z, snapped, s.ui.pan, w / 2, h / 2) })
        gestureRef.current = { kind: 'idle' }
        ignoreUntilUpRef.current = pointersRef.current.size > 0
      }
      return
    }
    if (g.kind === 'idle' || g.pointerId !== e.pointerId) return
    if (g.kind === 'stroke') { endStroke(true); return }
    if (g.kind === 'move') { endMove(true); return }
    if (g.kind === 'rig') {
      const s = editorStore.getState()
      g.drag.finish(s)
      gestureRef.current = { kind: 'idle' }
      schedule()
      return
    }
    gestureRef.current = { kind: 'idle' }
    schedule()
  }

  const onPointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId)
    const g = gestureRef.current
    if (g.kind === 'stroke') endStroke(false)
    else if (g.kind === 'move') endMove(false)
    else if (g.kind === 'rig') { g.drag.cancel(editorStore.getState()); gestureRef.current = { kind: 'idle' } }
    else gestureRef.current = { kind: 'idle' }
    if (pointersRef.current.size === 0) ignoreUntilUpRef.current = false
    schedule()
  }

  // wheel: ctrl/meta (and trackpad pinch) zooms about the cursor; plain wheel pans
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const s = editorStore.getState()
      const local = clientToLocal(e.clientX, e.clientY)
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01)
        const newZoom = clampZoom(s.ui.zoom * factor)
        s.setUi({ zoom: newZoom, pan: zoomAbout(s.ui.zoom, newZoom, s.ui.pan, local.x, local.y) })
      } else {
        s.setUi(ui => ({ pan: { x: ui.pan.x - e.deltaX, y: ui.pan.y - e.deltaY } }))
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  // canvas-local keys: zoom, fit, space-pan, delete selection, escape
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const s = editorStore.getState()
      if (e.key === ' ') { spaceRef.current = true; return }
      if (e.metaKey || e.ctrlKey) {
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomStep(1) }
        else if (e.key === '-') { e.preventDefault(); zoomStep(-1) }
        else if (e.key === '0') { e.preventDefault(); fitView() }
        return
      }
      if (e.key === '=' || e.key === '+') zoomStep(1)
      else if (e.key === '-') zoomStep(-1)
      else if (e.key === '0') fitView()
      else if (e.key === 'Escape') { s.setUi({ selection: null }); if (gestureRef.current.kind === 'stroke') endStroke(false) }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && s.ui.selection && s.ui.mode === 'draw') {
        const t = getTarget(s)
        if (t?.image && !t.derived) {
          const working = cloneImage(t.image)
          clearRect(working, s.ui.selection)
          s.commitPixels('Clear selection', t.partId, t.variantId, t.srcView, t.image, working)
        }
      }
    }
    const onUp = (e: KeyboardEvent) => { if (e.key === ' ') spaceRef.current = false }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function zoomStep(dir: 1 | -1) {
    const s = editorStore.getState()
    const { w, h } = sizeRef.current
    const z = nextZoom(s.ui.zoom, dir)
    s.setUi({ zoom: z, pan: zoomAbout(s.ui.zoom, z, s.ui.pan, w / 2, h / 2) })
  }

  // ── overlays (React) ───────────────────────────────────────────────────────

  const state = editorStore.getState()
  const target = getTarget(state)
  void revision; void selectedPartId; void variantId; void view; void docViews
  const derivedOf = target?.derived ? mirrorOf(state.doc.views.count, target.view) : null
  const missing = mode === 'draw' && target && !target.derived && !target.image
  const copyFrom = missing ? nearestImageView(state.doc, target.partId, target.variantId, target.srcView) : null

  const createImageForView = (from: number | null) => {
    const s = editorStore.getState()
    const t = getTarget(s)
    if (!t) return
    const src = from != null ? getPartImage(s.doc, t.partId, t.variantId, from) : undefined
    const size = newImageSize(s.doc, t.partId, t.variantId)
    const img = src ? cloneImage(src) : createImage(size.w, size.h)
    s.commitPixels('Create image', t.partId, t.variantId, t.srcView, undefined, img)
    force(x => x + 1)
  }

  const cursor = mode === 'draw'
    ? (tool === 'hand' ? 'grab' : tool === 'move' ? 'move' : 'crosshair')
    : mode === 'rig' || mode === 'animate' ? 'default' : 'grab'

  return (
    <div ref={containerRef} className="pixel-canvas">
      <canvas
        ref={canvasRef}
        className="pixel-canvas__surface"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={e => e.preventDefault()}
      />
      {mode === 'draw' && !target && (
        <div className="pixel-canvas__banner">No part selected. Add a part to start drawing.</div>
      )}
      {mode === 'draw' && target?.derived && derivedOf != null && (
        <div className="pixel-canvas__banner">
          View {target.view} ({viewLabel(state.doc.views.count, target.view)}) is mirrored from view {derivedOf}.
          <button onClick={() => editorStore.getState().setUi({ view: derivedOf })}>Edit view {derivedOf}</button>
        </div>
      )}
      {missing && target && (
        <div className="pixel-canvas__banner">
          This part has no image for view {target.view}. Drawing creates one, or:
          <button onClick={() => createImageForView(null)}>Blank image</button>
          {copyFrom != null && <button onClick={() => createImageForView(copyFrom)}>Copy from view {copyFrom}</button>}
        </div>
      )}
    </div>
  )
}

function isIdentityLike(m: Mat2D): boolean {
  return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.tx === 0 && m.ty === 0
}

export { ZOOM_MIN, ZOOM_MAX }
