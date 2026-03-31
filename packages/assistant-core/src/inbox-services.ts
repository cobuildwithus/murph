/**
 * Neutral inbox service surface. The old createIntegratedInboxCliServices name stays
 * as a compatibility alias while new code should prefer createIntegratedInboxServices.
 */
export {
  createIntegratedInboxServices,
  createIntegratedInboxServices as createIntegratedInboxCliServices,
} from './inbox-app/service.js'

export type {
  CanonicalAttachmentPromotionResult,
  CanonicalPromotionLookupSpec,
  CanonicalPromotionLookupTarget,
  CanonicalPromotionManifest,
  CanonicalPromotionMatch,
  ConfiguredParserRegistryRuntime,
  CoreRuntimeModule,
  EmailDriver,
  ImessageDriver,
  InboxCliServices,
  InboxServices,
  InboxParserServiceRuntime,
  InboxPaths,
  InboxPipeline,
  InboxRunEvent,
  InboxRuntimeModule,
  ParserDoctorRuntimeReport,
  ParserRuntimeDrainResult,
  ParserToolRuntimeStatus,
  ParsersRuntimeModule,
  PersistedCapture,
  PollConnector,
  PromotionScope,
  PromotionStore,
  PromotionTarget,
  RuntimeAttachmentParseJobRecord,
  RuntimeAttachmentRecord,
  RuntimeCaptureRecord,
  RuntimeCaptureRecordInput,
  RuntimeSearchHit,
  RuntimeStore,
  TelegramDriver,
} from './inbox-app/types.js'
