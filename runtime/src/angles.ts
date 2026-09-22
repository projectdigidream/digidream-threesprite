/**
 * Directions.
 *
 * Angles are in TURNS (one turn = a full circle), anticlockwise seen from
 * above. Two of them decide what you see:
 *
 *   facing   where the character is heading
 *   bearing  the direction from the character to the camera
 *
 * Their difference is all that matters. View k of N is what a camera sees at
 * relative bearing (k − 1) / N, so view 1 is the character looking at you and
 * the numbers rise anticlockwise: with eight views, view 3 is the character's
 * left side and view 5 is its back.
 */

export const TAU = Math.PI * 2

/** Wrap to [0, 1). */
export const mod1 = (turns: number): number => ((turns % 1) + 1) % 1

export const turnsFromRadians = (radians: number): number => radians / TAU
export const turnsFromDegrees = (degrees: number): number => degrees / 360
export const radiansFromTurns = (turns: number): number => turns * TAU
export const degreesFromTurns = (turns: number): number => turns * 360

/** How far the camera stands round the character from its facing, in turns. */
export function relativeTurns(bearingTurns: number, facingTurns: number): number {
  return mod1(bearingTurns - facingTurns)
}

/**
 * The view a camera at `relativeTurns` sees, from 1 to `count`. Each view owns
 * the arc centred on its own angle, so the picture changes halfway between two
 * of them.
 */
export function viewFor(count: number, relative: number): number {
  const n = Math.max(1, Math.round(count))
  return (Math.round(mod1(relative) * n) % n) + 1
}

/** The relative bearing view k is drawn at, in turns. */
export function viewAngleTurns(count: number, view: number): number {
  return (view - 1) / Math.max(1, Math.round(count))
}

/**
 * Ground-plane handedness.
 *
 * `zBack` is the editor's own world and three.js's: y is up, +x is right and
 * +z comes towards the viewer, so headings run from +x towards −z. Godot's 3D
 * world matches it.
 *
 * `zForward` is Unity's: y is up, +x is right and +z goes away from the
 * viewer, which reverses the turn direction.
 */
export type Ground = 'zBack' | 'zForward'

/**
 * Heading of the vector (dx, dz) along the ground, in turns.
 *
 * Pass the camera minus the character to get the bearing; pass the character's
 * forward vector to get its facing.
 */
export function turnsFromGround(dx: number, dz: number, ground: Ground = 'zBack'): number {
  return mod1(Math.atan2(ground === 'zBack' ? -dz : dz, dx) / TAU)
}

/** Unit ground vector for a heading, the inverse of `turnsFromGround`. */
export function groundFromTurns(turns: number, ground: Ground = 'zBack'): { x: number; z: number } {
  const s = Math.sin(TAU * turns)
  return { x: Math.cos(TAU * turns), z: ground === 'zBack' ? -s : s }
}

/**
 * Heading of a yaw angle, in turns.
 *
 * Engines disagree on which way a positive yaw turns. `handed: 'ccw'` (the
 * default) reads a yaw that turns anticlockwise seen from above, as in three.js
 * and Godot; `'cw'` suits Unity's `transform.eulerAngles.y`.
 */
export function turnsFromYawRadians(yaw: number, handed: 'ccw' | 'cw' = 'ccw'): number {
  return mod1((handed === 'ccw' ? yaw : -yaw) / TAU)
}

export function turnsFromYawDegrees(yaw: number, handed: 'ccw' | 'cw' = 'ccw'): number {
  return mod1((handed === 'ccw' ? yaw : -yaw) / 360)
}
