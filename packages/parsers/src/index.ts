export type { ParserArtifactKind, ParserArtifactRef, ParserArtifactSummary } from "./contracts/artifact.js";
export type {
  AttachmentParseJobClaimFilters,
  AttachmentParseJobFinalizeResult,
  AttachmentParseJobRecord,
  AttachmentParsePipeline,
  AttachmentParseState,
  CompleteAttachmentParseJobInput,
  FailAttachmentParseJobInput,
  ParserRuntimeAttachmentRecord,
  ParserRuntimeCaptureRecord,
  ParserRuntimeStore,
  RequeueAttachmentParseJobsInput,
} from "./contracts/runtime.js";
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
export type {
  ParserDoctorReport,
  ParserToolDiscovery,
  ParserToolDiscoverySource,
  ParserToolchainRuntimeConfig,
} from "./toolchain/discover.js";
export {
  createConfiguredParserRegistry,
  discoverParserToolchain,
  ffmpegOptionsFromDoctor,
  popplerPdfOptionsFromDoctor,
} from "./toolchain/discover.js";
export type {
  ParserToolName,
  ParserToolchainConfig,
  ParserToolchainPaths,
  ParserToolchainToolConfig,
  ParserToolchainTools,
  WriteParserToolchainConfigInput,
} from "./toolchain/config.js";
export {
  getParserToolchainPaths,
  readParserToolchainConfig,
  writeParserToolchainConfig,
} from "./toolchain/config.js";
export type { FfmpegToolOptions } from "./adapters/ffmpeg.js";
export { prepareAudioInput, resolveFfmpegCommand } from "./adapters/ffmpeg.js";
export type { PopplerPdfProviderOptions } from "./adapters/poppler-pdf.js";
export { createPopplerPdfProvider } from "./adapters/poppler-pdf.js";
export type { RemoteTranscriptionProviderOptions } from "./adapters/remote-transcription.js";
export { createRemoteTranscriptionProvider } from "./adapters/remote-transcription.js";
export type { WhisperCppProviderOptions } from "./adapters/whisper-cpp.js";
export { createWhisperCppProvider } from "./adapters/whisper-cpp.js";
export type {
  NormalizedZxingReadResult,
  ZxingWasmProviderOptions,
} from "./adapters/zxing-wasm.js";
export {
  buildDecodedImageCodeText,
  createZxingWasmProvider,
  normalizeZxingReadResults,
} from "./adapters/zxing-wasm.js";
export { createTextFileProvider } from "./adapters/text-file.js";
export type { PublishedParserArtifacts } from "./publish/writer.js";
export { writeParserArtifacts } from "./publish/writer.js";
export type {
  CreateInboxParserServiceInput,
  InboxParserService,
  InboxParserServiceDrainInput,
} from "./service.js";
export { createInboxParserService } from "./service.js";
export type { ParseAttachmentInput, ParseAttachmentResult } from "./pipelines/parse-attachment.js";
export { parseAttachment } from "./pipelines/parse-attachment.js";
export type { RunAttachmentParseJobResult, RunAttachmentParseWorkerInput } from "./pipelines/worker.js";
export { runAttachmentParseJobOnce, runAttachmentParseWorker } from "./pipelines/worker.js";
export type { CommandResult } from "./shared.js";
export { runCommand } from "./shared.js";

import { createTextFileProvider } from "./adapters/text-file.js";
import { createPopplerPdfProvider, type PopplerPdfProviderOptions } from "./adapters/poppler-pdf.js";
import {
  createZxingWasmProvider,
  type ZxingWasmProviderOptions,
} from "./adapters/zxing-wasm.js";
import { createWhisperCppProvider, type WhisperCppProviderOptions } from "./adapters/whisper-cpp.js";
import { createParserRegistry } from "./registry/registry.js";

export interface DefaultParserRegistryOptions {
  popplerPdf?: PopplerPdfProviderOptions;
  whisper?: WhisperCppProviderOptions;
  zxingWasm?: ZxingWasmProviderOptions;
}

export function createDefaultParserRegistry(options: DefaultParserRegistryOptions = {}) {
  return createParserRegistry([
    createTextFileProvider(),
    createPopplerPdfProvider(options.popplerPdf),
    createZxingWasmProvider(options.zxingWasm),
    createWhisperCppProvider(options.whisper),
  ]);
}
