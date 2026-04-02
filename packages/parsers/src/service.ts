import type { FfmpegToolOptions } from "./adapters/ffmpeg.js";
import type {
  AttachmentParseJobClaimFilters,
  ParserRuntimeStore,
  RequeueAttachmentParseJobsInput,
} from "./contracts/runtime.js";
import type { ParserRegistry } from "./registry/registry.js";
import type { RunAttachmentParseJobResult } from "./pipelines/worker.js";
import { runAttachmentParseJobOnce, runAttachmentParseWorker } from "./pipelines/worker.js";

export interface CreateInboxParserServiceInput {
  vaultRoot: string;
  runtime: ParserRuntimeStore;
  registry: ParserRegistry;
  scratchRoot?: string;
  ffmpeg?: FfmpegToolOptions;
}

export interface InboxParserServiceDrainInput extends AttachmentParseJobClaimFilters {
  maxJobs?: number;
  signal?: AbortSignal;
}

export interface InboxParserService {
  drain(input?: InboxParserServiceDrainInput): Promise<RunAttachmentParseJobResult[]>;
  drainOnce(filters?: AttachmentParseJobClaimFilters): Promise<RunAttachmentParseJobResult | null>;
  requeue(filters?: RequeueAttachmentParseJobsInput): number;
}

export function createInboxParserService(input: CreateInboxParserServiceInput): InboxParserService {
  return {
    drain(drainInput = {}) {
      const { maxJobs, signal, ...jobFilters } = drainInput;
      return runAttachmentParseWorker({
        vaultRoot: input.vaultRoot,
        runtime: input.runtime,
        registry: input.registry,
        scratchRoot: input.scratchRoot,
        ffmpeg: input.ffmpeg,
        maxJobs,
        jobFilters,
        signal,
      });
    },
    drainOnce(jobFilters) {
      return runAttachmentParseJobOnce({
        vaultRoot: input.vaultRoot,
        runtime: input.runtime,
        registry: input.registry,
        scratchRoot: input.scratchRoot,
        ffmpeg: input.ffmpeg,
        jobFilters,
      });
    },
    requeue(filters) {
      return input.runtime.requeueAttachmentParseJobs(filters);
    },
  };
}
