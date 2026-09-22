import type { Id } from '../../domain/types'

export type ExportFormat = 'doom' | 'atlas' | 'pngs' | 'gif'

export const FORMAT_INFO: Record<ExportFormat, { title: string; blurb: string; browser: boolean }> = {
  doom: {
    title: 'Doom-style PNGs',
    blurb: 'One PNG per frame and view named NAME + frame letter + rotation (TSPRA1.png …). Rotation 1 faces the viewer, then anticlockwise. Needs 1, 8 or 16 views and at most 26 frames.',
    browser: true,
  },
  atlas: {
    title: 'Atlas + JSON',
    blurb: 'One packed sheet with trimmed frames plus a JSON manifest: rects, feet pivots, animations, and every view with its angle. For Unity, Godot, Phaser or your own engine.',
    browser: true,
  },
  pngs: {
    title: 'PNG frames',
    blurb: 'A folder per animation with one full-canvas PNG per frame and view: sprite/anim/000_v01.png. No manifest.',
    browser: true,
  },
  gif: {
    title: 'GIF previews',
    blurb: 'An animated GIF per animation and view, plus a turntable GIF cycling every view of the first frame.',
    browser: true,
  },
}

export interface ExportOptions {
  /** Doom naming with an unsupported view count: export view 1 only as rotation 0. */
  doomFrontOnly: boolean
  atlasPow2: boolean
  turntableFps: number
}

export const DEFAULT_OPTIONS: ExportOptions = { doomFrontOnly: false, atlasPow2: false, turntableFps: 4 }

export interface ExportSelection {
  format: ExportFormat
  animIds: Id[]
  options: ExportOptions
}

export type SinkSpec = { kind: 'dir'; path: string } | { kind: 'zip'; path?: string; contentUri?: string }

export interface AnimationMeta { name: string; fps: number; loop: boolean; frameCount: number }
export interface FrameRef { anim: number; frame: number; view: number }

export interface BundleManifest {
  format: ExportFormat
  sink: SinkSpec
  sprite: string
  canvas: number
  views: { count: number; mirror: boolean }
  worldHeight: number
  animations: AnimationMeta[]
  frames: FrameRef[]
  options: ExportOptions
}

export interface ExportReport {
  files: string[]
  warnings: string[]
  bytes: number
  location: string
}
