import { addBone } from '../../domain/project'
import type { Project } from '../../domain/types'

/**
 * A root bone standing upright at the feet point. Being on the vertical axis
 * it projects to the bottom centre at angle 90° in EVERY view, so a part
 * with offset (0,0) and rotation −90 (what `addPart` sets for an upright
 * bone) places its image with pixel `pivot` at the bottom centre, i.e. an
 * image's top-left lands at canvas (size/2 − pivot.x, size − pivot.y).
 */
export function feetBone(p: Project, length = 4) {
  return addBone(p, { length })
}

/** Pivot that puts an image's top-left corner at canvas (x, y) on a feet bone. */
export function pivotFor(p: Project, x: number, y: number) {
  return { x: p.canvas.size / 2 - x, y: p.canvas.size - y }
}
