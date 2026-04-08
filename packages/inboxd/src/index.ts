export type {
  InboundAttachment,
  InboundAttachmentData,
  InboundCapture,
  IndexedAttachment,
  PersistedCapture,
  StoredAttachment,
  StoredCapture,
} from "./contracts/capture.ts";
export type {
  InboxCaptureRecord,
  InboxListFilters,
  InboxSearchFilters,
  InboxSearchHit,
} from "./contracts/search.ts";
export type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobFilters,
  AttachmentParseJobRecord,
  AttachmentParsePipeline,
  AttachmentParseState,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  RequeueAttachmentParseJobsInput,
} from "./contracts/derived.ts";
export type {
  BaseConnector,
  Cursor,
  EmitCapture,
  PollConnector,
  WebhookConnector,
} from "./connectors/types.ts";
export type {
  ChatAttachment,
  ChatMessage,
  CreateInboundCaptureFromChatMessageInput,
} from "./connectors/chat/message.ts";
export {
  compareInboundCaptures,
  createInboundCaptureFromChatMessage,
} from "./connectors/chat/message.ts";
export {
  normalizeTextValue,
  sanitizeRawMetadata,
  toIsoTimestamp,
} from "./shared-runtime.ts";
export type {
  ChatPollDriver,
  ChatPollWatcherHandle,
  CreateNormalizedChatPollConnectorInput,
} from "./connectors/chat/poll.ts";
export {
  createNormalizedChatPollConnector,
} from "./connectors/chat/poll.ts";
export {
  createAgentmailApiPollDriver,
  createEmailPollConnector,
} from "./connectors/email/connector.ts";
export type {
  AgentmailFetch,
  AgentmailPollDriver,
  CreateAgentmailApiPollDriverInput,
  EmailConnectorOptions,
} from "./connectors/email/connector.ts";
export {
  buildAgentmailMessageText,
  buildEmailMessageText,
  inferAttachmentKind,
  inferDirectEmailThread,
  inferDirectEmailThreadFromParticipants,
  normalizeAgentmailMessage,
  resolveAgentmailAddress,
  resolveAgentmailDisplayName,
  resolveEmailAddress,
  resolveEmailDisplayName,
  toAgentmailChatMessage,
} from "./connectors/email/normalize.ts";
export type {
  AgentmailAttachmentDownloadDriver,
  BuildEmailMessageTextInput,
  InferDirectEmailThreadParticipantsInput,
  NormalizeAgentmailMessageInput,
} from "./connectors/email/normalize.ts";
export {
  normalizeParsedEmailMessage,
  toParsedEmailChatMessage,
} from "./connectors/email/normalize-parsed.ts";
export type {
  NormalizeParsedEmailMessageInput,
} from "./connectors/email/normalize-parsed.ts";
export {
  parseRawEmailMessage,
  readRawEmailHeaderValue,
  splitEmailAddressList,
} from "./connectors/email/parsed.ts";
export type {
  ParsedEmailAttachment,
  ParsedEmailMessage,
  RawEmailHeaderValue,
} from "./connectors/email/parsed.ts";
export type {
  AgentmailAttachmentDownload,
  AgentmailListMessagesResponse,
  AgentmailMessageAttachment,
  AgentmailMessageLike,
  AgentmailThreadLike,
} from "./connectors/email/types.ts";
export {
  createLinqWebhookConnector,
} from "./connectors/linq/connector.ts";
export type {
  LinqWebhookConnectorOptions,
} from "./connectors/linq/connector.ts";
export {
  normalizeLinqWebhookEvent,
  toLinqChatMessage,
} from "./connectors/linq/normalize.ts";
export type {
  LinqAttachmentDownloadDriver,
  NormalizeLinqWebhookEventInput,
} from "./connectors/linq/normalize.ts";
export {
  DEFAULT_TELEGRAM_ALLOWED_UPDATES,
  createTelegramApiPollDriver,
  createTelegramBotApiPollDriver,
  createTelegramPollConnector,
  createTelegramUpdateCheckpoint,
  readTelegramUpdateCheckpoint,
} from "./connectors/telegram/connector.ts";
export type {
  CreateTelegramApiPollDriverInput,
  CreateTelegramBotApiPollDriverInput,
  TelegramApiClient,
  TelegramConnectorOptions,
  TelegramPollDriver,
} from "./connectors/telegram/connector.ts";
export {
  normalizeTelegramMessage,
  normalizeTelegramUpdate,
  toTelegramChatMessage,
} from "./connectors/telegram/normalize.ts";
export type {
  NormalizeTelegramMessageInput,
  NormalizeTelegramUpdateInput,
  TelegramAttachmentDownloadDriver,
} from "./connectors/telegram/normalize.ts";
export {
  createConnectorRegistry,
} from "./kernel/registry.ts";
export type {
  ConnectorRegistry,
} from "./kernel/registry.ts";
export {
  runInboxDaemon,
  runPollConnector,
} from "./kernel/daemon.ts";
export type {
  ConnectorRestartPolicy,
} from "./kernel/daemon.ts";
export {
  createInboxPipeline,
  processCapture,
} from "./kernel/pipeline.ts";
export type {
  CreateInboxPipelineInput,
  InboxPipeline,
  PipelineContext,
} from "./kernel/pipeline.ts";
export {
  createParsedInboxPipeline,
  runInboxDaemonWithParsers,
} from "./parsers.ts";
export type {
  CreateParsedInboxPipelineInput,
  ParsedInboxPipeline,
  RunInboxDaemonWithParsersInput,
} from "./parsers.ts";
export {
  listInboxCaptureMutations,
  openInboxRuntime,
  readInboxCaptureMutationHead,
} from "./kernel/sqlite.ts";
export type {
  InboxCaptureMutationRecord,
  InboxRuntimeStore,
  OpenInboxRuntimeInput,
} from "./kernel/sqlite.ts";
export {
  appendImportAudit,
  appendInboxCaptureEvent,
  ensureInboxVault,
  persistCanonicalInboxCapture,
  persistRawCapture,
  rebuildRuntimeFromVault,
} from "./indexing/persist.ts";
