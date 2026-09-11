import { FrameCache } from '../core/raster/frameCache'
import { editorStore } from './editorStore'

/** Composed frames for the current document, invalidated by `revision`. */
export const frameCache = new FrameCache(
  () => editorStore.getState().doc,
  () => editorStore.getState().revision,
)
