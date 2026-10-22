/**
 * What an export will produce, computed without composing a single pixel, so
 * the panel can show file names and refuse impossible exports up front. The
 * naming rules mirror the Rust side exactly (src-tauri/src/commands.rs).
 */
import { DOOM_SPRITE_NAME_RE, type Id, type Project } from '../../domain/types'
import type { ExportSelection } from './types'

export interface PlannedFile {
  name: string
  /** Index into the bundle's frame list (anim → frame → view order), when the file is one frame. */
  frameIndex?: number
}

export interface ExportPlan {
  files: PlannedFile[]
  errors: string[]
  warnings: string[]
  frameCount: number
  viewCount: number
}

export function slug(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_-]/g, '_')
  return s || 'anim'
}

export const doomSupportsViews = (n: number) => n === 1 || n === 8 || n === 16

export function doomRotationChar(n: number, view: number): string {
  if (n === 1) return '0'
  if (n === 8 && view >= 1 && view <= 8) return String(view)
  if (n === 16 && view >= 1 && view <= 9) return String(view)
  if (n === 16 && view >= 10 && view <= 16) return String.fromCharCode(65 + view - 10)
  throw new Error(`Doom-style naming supports 1, 8 or 16 views, not ${n}`)
}

export function doomFrameLetter(i: number): string {
  if (i < 0 || i >= 26) throw new Error('Doom-style naming supports at most 26 frames per sprite (A–Z)')
  return String.fromCharCode(65 + i)
}

/** The project as one export sees it: only the selected parts, under the id the files take. */
export function scopedProject(project: Project, sel: ExportSelection): Project {
  if (!sel.parts && !sel.spriteName) return project
  const keep = sel.parts ? new Set(sel.parts) : null
  const only = (ids: Id[]) => (keep ? ids.filter(id => keep.has(id)) : ids)
  return {
    ...project,
    spriteName: sel.spriteName || project.spriteName,
    partOrder: only(project.partOrder),
    partOrderByView: Object.fromEntries(Object.entries(project.partOrderByView).map(([v, ids]) => [v, only(ids ?? [])])),
  }
}

export function planExport(project: Project, sel: ExportSelection): ExportPlan {
  const N = project.views.count
  const anims = project.animationOrder.filter(id => sel.animIds.includes(id)).map(id => project.animations[id])
  const errors: string[] = []
  if (sel.parts && sel.parts.length === 0) errors.push('No parts are ticked: tick the ones to export.')
  const warnings: string[] = []
  const files: PlannedFile[] = []
  const totalFrames = anims.reduce((a, x) => a + x.frameCount, 0)
  if (anims.length === 0) errors.push('Select at least one animation.')

  // bundle frame index for (animIdx, frame, view): anim → frame → view
  let idx = 0
  const index = (a: number, f: number, v: number) => {
    void a; void f; void v
    return idx++
  }

  switch (sel.format) {
    case 'doom': {
      if (!DOOM_SPRITE_NAME_RE.test(project.spriteName)) errors.push(`Doom-style naming needs a sprite id of exactly 4 characters, A–Z or 0–9; this one is "${project.spriteName}". Change it in Project settings, or pick another format.`)
      const frontOnly = !doomSupportsViews(N)
      if (frontOnly && !sel.options.doomFrontOnly) errors.push(`Doom-style naming supports 1, 8 or 16 views; this sprite has ${N}. Change the view count, or enable "front view only".`)
      if (frontOnly && sel.options.doomFrontOnly) warnings.push(`Only view 1 will be exported, as rotation 0 (${N} views cannot be named Doom-style).`)
      if (totalFrames > 26) errors.push(`Doom-style naming supports at most 26 frames per sprite (letters A–Z); the selected animations have ${totalFrames}.`)
      if (errors.length) break
      let letter = 0
      anims.forEach((anim, ai) => {
        for (let f = 0; f < anim.frameCount; f++) {
          const L = doomFrameLetter(letter++)
          for (let v = 1; v <= N; v++) {
            const i = index(ai, f, v)
            if (frontOnly && v !== 1) continue
            files.push({ name: `${project.spriteName}${L}${frontOnly ? '0' : doomRotationChar(N, v)}.png`, frameIndex: i })
          }
        }
      })
      break
    }
    case 'pngs': {
      anims.forEach((anim, ai) => {
        for (let f = 0; f < anim.frameCount; f++) {
          for (let v = 1; v <= N; v++) {
            files.push({ name: `${project.spriteName}/${slug(anim.name)}/${String(f).padStart(3, '0')}_v${String(v).padStart(2, '0')}.png`, frameIndex: index(ai, f, v) })
          }
        }
      })
      break
    }
    case 'atlas': {
      files.push({ name: `${project.spriteName}.png` }, { name: `${project.spriteName}.json` })
      break
    }
    case 'gif': {
      for (const anim of anims) {
        if (anim.fps > 0 && Math.abs(100 / anim.fps - Math.round(100 / anim.fps)) > 1e-6) {
          warnings.push(`${anim.name}: GIF timing is in 1/100 s steps, so ${anim.fps} fps plays at ${(100 / Math.round(100 / anim.fps)).toFixed(2)} fps.`)
        }
        for (let v = 1; v <= N; v++) files.push({ name: `${project.spriteName}_${slug(anim.name)}_v${String(v).padStart(2, '0')}.gif` })
      }
      if (N > 1 && anims.length) files.push({ name: `${project.spriteName}_turntable.gif` })
      break
    }
  }
  return { files, errors, warnings, frameCount: totalFrames, viewCount: N }
}
