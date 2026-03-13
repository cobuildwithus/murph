export type {
  InboundAttachment,
  InboundCapture,
  IndexedAttachment,
  PersistedCapture,
  StoredAttachment,
  StoredCapture,
} from "./contracts/capture.js";
export type {
  InboxCaptureRecord,
  InboxListFilters,
  InboxSearchFilters,
  InboxSearchHit,
} from "./contracts/search.js";
export type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobFilters,
  AttachmentParseJobRecord,
  AttachmentParsePipeline,
  AttachmentParseState,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  RequeueAttachmentParseJobsInput,
} from "./contracts/derived.js";
export type {
  BaseConnector,
  Cursor,
  EmitCapture,
  PollConnector,
  WebhookConnector,
} from "./connectors/types.js";
export {
  createImessageConnector,
  loadImessageKitDriver,
} from "./connectors/imessage/connector.js";
export type {
  ImessageConnectorOptions,
  ImessageGetMessagesInput,
  ImessagePollDriver,
  ImessageWatchOptions,
} from "./connectors/imessage/connector.js";
export {
  normalizeImessageAttachment,
  normalizeImessageMessage,
} from "./connectors/imessage/normalize.js";
export type {
  ImessageKitAttachmentLike,
  ImessageKitChatLike,
  ImessageKitMessageLike,
} from "./connectors/imessage/normalize.js";
export {
  createConnectorRegistry,
} from "./kernel/registry.js";
export type {
  ConnectorRegistry,
} from "./kernel/registry.js";
export {
  runInboxDaemon,
  runPollConnector,
} from "./kernel/daemon.js";
export {
  createInboxPipeline,
  processCapture,
} from "./kernel/pipeline.js";
export type {
  CreateInboxPipelineInput,
  InboxPipeline,
  PipelineContext,
} from "./kernel/pipeline.js";
export {
  openInboxRuntime,
} from "./kernel/sqlite.js";
export type {
  InboxRuntimeStore,
  OpenInboxRuntimeInput,
} from "./kernel/sqlite.js";
export {
  appendImportAudit,
  appendInboxCaptureEvent,
  ensureInboxVault,
  persistRawCapture,
  rebuildRuntimeFromVault,
} from "./indexing/persist.js";
