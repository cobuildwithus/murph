export {
  createInboxPipeline,
  processCapture,
} from "./kernel/pipeline.ts";
export type {
  CreateInboxPipelineInput,
  InboxPipeline,
  PipelineContext,
} from "./kernel/pipeline.ts";
export type {
  ConnectorRestartPolicy,
  RunPollConnectorBackfillInput,
  RunPollConnectorBackfillResult,
} from "./kernel/daemon.ts";
export {
  runPollConnectorBackfill,
} from "./kernel/daemon.ts";
export type {
  PersistedCapture,
  IndexedAttachment,
} from "./contracts/capture.ts";
export type {
  InboxCaptureRecord,
} from "./contracts/search.ts";

export {
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
} from "./kernel/sqlite.ts";
export type {
  InboxCaptureMutationRecord,
  InboxRuntimeStore,
} from "./kernel/sqlite.ts";

export {
  rebuildRuntimeFromVault,
} from "./indexing/persist.ts";
export {
  createCaptureCheckpoint,
} from "./shared-runtime.ts";
export {
  buildInboxAttachmentRetentionLedgerPath,
  INBOX_MEDIA_RETENTION_DAYS,
  INBOX_MEDIA_RETENTION_WINDOW_MS,
  runInboxMediaRetention,
  type InboxMediaRetentionMaterializeResult,
  type InboxMediaRetentionResult,
  type RunInboxMediaRetentionInput,
} from "./indexing/retention.ts";
