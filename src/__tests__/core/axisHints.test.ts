import { describe, it, expect } from 'vitest'
import { axisHints } from '../../core/ui/axisHints'
import { addBone, createProject } from '../../domain/project'

const arrows = (h: ReturnType<typeof axisHints>) => `${h.r.arrow} ${h.u.arrow} ${h.f.arrow}`

describe('where a move goes on screen', () => {
  // 8 views, mirrored: views 6–8 are 4–2 flipped
  const p = createProject({ canvasSize: 32, viewCount: 8, mirror: true })
  const root = p.skeleton.bones[p.skeleton.rootOrder[0]]

  it("facing you, its right is your left and forward comes at you", () => {
    expect(arrows(axisHints(p, null, 0, root, 1))).toBe('← ↑ ⊙')
    expect(axisHints(p, null, 0, root, 1).r.words).toBe('← on screen')
  })

  it('from behind, its right is your right and forward goes away', () => {
    expect(arrows(axisHints(p, null, 0, root, 5))).toBe('→ ↑ ⊗')
  })

  it('from its left side it faces left, and its right points away', () => {
    expect(arrows(axisHints(p, null, 0, root, 3))).toBe('⊗ ↑ ←')
  })

  it('a mirrored view shows its source flipped, arrows too', () => {
    expect(arrows(axisHints(p, null, 0, root, 7))).toBe('⊗ ↑ →')
  })

  it("a child bone moves in its parent's frame: a parent lying on its side turns the arrows", () => {
    const q = createProject({ canvasSize: 32, viewCount: 1 })
    const lying = addBone(q, { name: 'lying', rest: { rotation: { f: 90 } } })
    const child = addBone(q, { name: 'child', parentId: lying.id })
    expect(arrows(axisHints(q, null, 0, child, 1))).not.toBe(arrows(axisHints(q, null, 0, lying, 1)))
    expect(axisHints(q, null, 0, child, 1).u.arrow).not.toBe('↑')
  })
})
