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
