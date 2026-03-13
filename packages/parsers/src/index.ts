export type { ParserArtifactKind, ParserArtifactRef, ParserArtifactSummary } from "./contracts/artifact.js";
export type {
  ParseBlockKind,
  ParseIntent,
  ParseOutputMetadata,
  ParseRequest,
  ParseWarning,
  ParsedBlock,
  ParsedTable,
  ParserOutput,
  ProviderRunResult,
} from "./contracts/parse.js";
export type {
  ParserProvider,
  ParserProviderLocality,
  ParserProviderOpenness,
  ParserProviderRuntime,
  ProviderAvailability,
  ProviderSelection,
} from "./contracts/provider.js";
export type { ProviderRankingPolicy } from "./registry/policy.js";
export { DEFAULT_PROVIDER_RANKING_POLICY, scoreProvider } from "./registry/policy.js";
export type { ParserRegistry } from "./registry/registry.js";
export { createParserRegistry } from "./registry/registry.js";
export type { FfmpegToolOptions } from "./adapters/ffmpeg.js";
export { prepareAudioInput, resolveFfmpegCommand } from "./adapters/ffmpeg.js";
export type { WhisperCppProviderOptions } from "./adapters/whisper-cpp.js";
export { createWhisperCppProvider } from "./adapters/whisper-cpp.js";
export type { PdfToTextProviderOptions } from "./adapters/pdftotext.js";
export { createPdfToTextProvider } from "./adapters/pdftotext.js";
export type { PaddleOcrProviderOptions } from "./adapters/paddleocr.js";
export { createPaddleOcrProvider } from "./adapters/paddleocr.js";
export { createTextFileProvider } from "./adapters/text-file.js";
export type { PublishedParserArtifacts } from "./publish/writer.js";
export { writeParserArtifacts } from "./publish/writer.js";
export { resolveInboxAttachmentArtifact } from "./inboxd/bridge.js";
export type {
  CreateInboxParserServiceInput,
  InboxParserService,
  InboxParserServiceDrainInput,
} from "./service.js";
export { createInboxParserService } from "./service.js";
export type {
  CreateParsedInboxPipelineInput,
  ParsedInboxPipeline,
  RunInboxDaemonWithParsersInput,
} from "./inboxd/pipeline.js";
export { createParsedInboxPipeline, runInboxDaemonWithParsers } from "./inboxd/pipeline.js";
export type { ParseAttachmentInput, ParseAttachmentResult } from "./pipelines/parse-attachment.js";
export { parseAttachment } from "./pipelines/parse-attachment.js";
export type { RunAttachmentParseJobResult, RunAttachmentParseWorkerInput } from "./pipelines/worker.js";
export { runAttachmentParseJobOnce, runAttachmentParseWorker } from "./pipelines/worker.js";

import { createPaddleOcrProvider } from "./adapters/paddleocr.js";
import { createPdfToTextProvider, type PdfToTextProviderOptions } from "./adapters/pdftotext.js";
import { createTextFileProvider } from "./adapters/text-file.js";
import { createWhisperCppProvider, type WhisperCppProviderOptions } from "./adapters/whisper-cpp.js";
import { createParserRegistry } from "./registry/registry.js";

export interface DefaultParserRegistryOptions {
  whisper?: WhisperCppProviderOptions;
  pdf?: PdfToTextProviderOptions;
  paddle?: import("./adapters/paddleocr.js").PaddleOcrProviderOptions;
}

export function createDefaultParserRegistry(options: DefaultParserRegistryOptions = {}) {
  return createParserRegistry([
    createTextFileProvider(),
    createWhisperCppProvider(options.whisper),
    createPdfToTextProvider(options.pdf),
    createPaddleOcrProvider(options.paddle),
  ]);
}
