export type {
  InboundAttachment,
  InboundAttachmentData,
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
export type {
  ChatAttachment,
  ChatMessage,
  CreateInboundCaptureFromChatMessageInput,
} from "./connectors/chat/message.js";
export {
  compareInboundCaptures,
  createInboundCaptureFromChatMessage,
} from "./connectors/chat/message.js";
export type {
  ChatPollDriver,
  ChatPollWatcherHandle,
  CreateNormalizedChatPollConnectorInput,
} from "./connectors/chat/poll.js";
export {
  createNormalizedChatPollConnector,
} from "./connectors/chat/poll.js";
export {
  createAgentmailApiPollDriver,
  createEmailPollConnector,
} from "./connectors/email/connector.js";
export type {
  AgentmailFetch,
  AgentmailPollDriver,
  CreateAgentmailApiPollDriverInput,
  EmailConnectorOptions,
} from "./connectors/email/connector.js";
export {
  buildAgentmailMessageText,
  inferDirectEmailThread,
  normalizeAgentmailMessage,
  resolveAgentmailAddress,
  resolveAgentmailDisplayName,
  toAgentmailChatMessage,
} from "./connectors/email/normalize.js";
export type {
  AgentmailAttachmentDownloadDriver,
  NormalizeAgentmailMessageInput,
} from "./connectors/email/normalize.js";
export type {
  AgentmailAttachmentDownload,
  AgentmailListMessagesResponse,
  AgentmailMessageAttachment,
  AgentmailMessageLike,
  AgentmailThreadLike,
} from "./connectors/email/types.js";
export {
  createLinqWebhookConnector,
} from "./connectors/linq/connector.js";
export type {
  LinqWebhookConnectorOptions,
} from "./connectors/linq/connector.js";
export {
  normalizeLinqWebhookEvent,
  requireLinqMessageReceivedEvent,
  toLinqChatMessage,
} from "./connectors/linq/normalize.js";
export type {
  LinqAttachmentDownloadDriver,
  NormalizeLinqWebhookEventInput,
} from "./connectors/linq/normalize.js";
export type {
  LinqIncomingMessage,
  LinqListPhoneNumbersResponse,
  LinqMediaPart,
  LinqMessagePart,
  LinqMessageReceivedData,
  LinqMessageReceivedEvent,
  LinqSendMessageResponse,
  LinqTextPart,
  LinqWebhookEvent,
} from "./connectors/linq/types.js";
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
  DEFAULT_TELEGRAM_ALLOWED_UPDATES,
  createTelegramApiPollDriver,
  createTelegramBotApiPollDriver,
  createTelegramPollConnector,
  createTelegramUpdateCheckpoint,
  readTelegramUpdateCheckpoint,
} from "./connectors/telegram/connector.js";
export type {
  CreateTelegramApiPollDriverInput,
  CreateTelegramBotApiPollDriverInput,
  TelegramApiClient,
  TelegramConnectorOptions,
  TelegramPollDriver,
} from "./connectors/telegram/connector.js";
export {
  buildTelegramThreadId,
  extractTelegramMessage,
  normalizeTelegramMessage,
  normalizeTelegramUpdate,
  toTelegramChatMessage,
} from "./connectors/telegram/normalize.js";
export type {
  NormalizeTelegramMessageInput,
  NormalizeTelegramUpdateInput,
  TelegramAttachmentDownloadDriver,
} from "./connectors/telegram/normalize.js";
export {
  parseTelegramThreadTarget,
  serializeTelegramThreadTarget,
} from "./connectors/telegram/target.js";
export type {
  TelegramThreadTarget,
} from "./connectors/telegram/target.js";
export type {
  TelegramChat,
  TelegramFile,
  TelegramFileBase,
  TelegramMessageLike,
  TelegramPhotoSize,
  TelegramUpdateLike,
  TelegramUser,
  TelegramWebhookInfo,
} from "./connectors/telegram/types.js";
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
