/**
 * Owns the assistant chat composer's terminal-editor seam so the top-level Ink
 * view can stay focused on chat layout, model switching, and controller state.
 */

export {
  formatQueuedFollowUpPreview,
  mergeComposerDraftWithQueuedPrompts,
  normalizeAssistantInkArrowKey,
  resolveComposerTerminalAction,
} from './composer-terminal.js'
export type { ComposerSubmitMode } from './composer-terminal.js'

export {
  applyComposerEditingInput,
  normalizeComposerInsertedText,
} from './composer-editing.js'

export {
  clampComposerCursorOffset,
  enqueuePendingComposerValue,
  findComposerNextWordEnd,
  findComposerPreviousWordStart,
  reconcileComposerControlledValue,
  resolveComposerVerticalCursorMove,
} from './composer-state.js'
export type {
  ComposerControlledSyncInput,
  ComposerControlledSyncResult,
  ComposerEditingResult,
  ComposerEditingState,
} from './composer-state.js'

export { renderComposerValue } from './composer-render.js'
