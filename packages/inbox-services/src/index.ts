/**
 * Neutral inbox service surface shared by the CLI shell and headless assistant consumers.
 */
export { createIntegratedInboxServices } from './inbox-app/service.js'

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
  InboxServices,
  InboxSourceSetEnabledResult,
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
