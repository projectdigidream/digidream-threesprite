/**
 * Ground-plane geometry for the 3D preview, in a y-up world (three.js). The
 * ground is the XZ plane; angles are turns, anticlockwise seen from above,
 * i.e. from +X towards −Z. Plain numbers only, so this is testable without
 * three.js and shared with the view-index maths in `domain/views.ts`.
 */

const TAU = Math.PI * 2

/** Unit vector on the ground for a heading in turns. */
export function facingDirection(turns: number): { x: number; y: number; z: number } {
  return { x: Math.cos(TAU * turns), y: 0, z: -Math.sin(TAU * turns) }
}

/** Heading, in turns, of the direction from (fromX, fromZ) to (toX, toZ). */
export function bearingTurns(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(-(toZ - fromZ), toX - fromX) / TAU
}

/** Y rotation that makes a +Z-facing plane at `pos` face the camera. */
export function billboardYaw(camX: number, camZ: number, posX: number, posZ: number): number {
  return Math.atan2(camX - posX, camZ - posZ)
}

/**
 * Screen-space x component (+1 = screen-right) of a character's facing
 * vector as seen by a camera at relative bearing `relTurns`. At rel = 0.25 the
 * camera stands at the character's left and the character faces screen-left.
 */
export function screenFacingX(relTurns: number): number {
  return -Math.sin(TAU * relTurns)
}

/** Component of the facing vector pointing at the viewer (+1 = towards the camera). */
export function screenFacingToward(relTurns: number): number {
  return Math.cos(TAU * relTurns)
}

/** Camera position on a circle around `pos` at bearing `turns`, `dist` away, `height` up. */
export function orbitPosition(posX: number, posZ: number, turns: number, dist: number, height: number) {
  const d = facingDirection(turns)
  return { x: posX + d.x * dist, y: height, z: posZ + d.z * dist }
}
