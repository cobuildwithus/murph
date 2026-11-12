/**
 * Neutral inbox service surface shared by the CLI shell and headless assistant consumers.
 */
export { createIntegratedInboxServices } from './inbox-app/service.js'

export type {
  CanonicalPromotionLookupSpec,
  CanonicalPromotionLookupTarget,
  CanonicalPromotionManifest,
  CanonicalPromotionMatch,
  CoreRuntimeModule,
  InboxServices,
  InboxPaths,
  InboxPipeline,
  InboxRuntimeModule,
  ParsersRuntimeModule,
  PersistedCapture,
  PromotionScope,
  PromotionStore,
  PromotionTarget,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeCaptureRecordInput,
  RuntimeSearchHit,
  RuntimeStore,
} from './inbox-app/types.js'
