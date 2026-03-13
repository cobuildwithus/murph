import {
  createInboxPipeline,
  runInboxDaemon,
  type CreateInboxPipelineInput,
  type InboxPipeline,
  type PollConnector,
} from "@healthybob/inboxd";

import type { CreateInboxParserServiceInput, InboxParserService } from "../service.js";
import { createInboxParserService } from "../service.js";

export interface CreateParsedInboxPipelineInput
  extends CreateInboxPipelineInput,
    Omit<CreateInboxParserServiceInput, "runtime" | "vaultRoot"> {}

export interface ParsedInboxPipeline extends InboxPipeline {
  readonly parserService: InboxParserService;
}

export interface RunInboxDaemonWithParsersInput extends CreateParsedInboxPipelineInput {
  connectors: PollConnector[];
  signal: AbortSignal;
}

export async function createParsedInboxPipeline(
  input: CreateParsedInboxPipelineInput,
): Promise<ParsedInboxPipeline> {
  const pipeline = await createInboxPipeline(input);
  const parserService = createInboxParserService(input);

  return {
    runtime: pipeline.runtime,
    parserService,
    async processCapture(capture) {
      const persisted = await pipeline.processCapture(capture);
      await parserService.drain({
        captureId: persisted.captureId,
      });
      return persisted;
    },
    close() {
      pipeline.close();
    },
  };
}

export async function runInboxDaemonWithParsers(
  input: RunInboxDaemonWithParsersInput,
): Promise<void> {
  const { connectors, signal, ...pipelineInput } = input;
  const pipeline = await createParsedInboxPipeline(pipelineInput);

  try {
    await runInboxDaemon({
      pipeline,
      connectors,
      signal,
    });
  } finally {
    pipeline.close();
  }
}
