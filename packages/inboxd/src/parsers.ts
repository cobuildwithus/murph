import type { PollConnector } from "./connectors/types.ts";
import {
  runInboxDaemon,
  type ConnectorRestartPolicy,
} from "./kernel/daemon.ts";
import {
  createInboxPipeline,
  type CreateInboxPipelineInput,
  type InboxPipeline,
} from "./kernel/pipeline.ts";
import {
  createInboxParserService,
  type CreateInboxParserServiceInput,
  type InboxParserService,
} from "@murphai/parsers";

export interface CreateParsedInboxPipelineInput
  extends CreateInboxPipelineInput,
    Omit<CreateInboxParserServiceInput, "runtime" | "vaultRoot"> {}

export interface ParsedInboxPipeline extends InboxPipeline {
  readonly parserService: InboxParserService;
}

export interface RunInboxDaemonWithParsersInput extends CreateParsedInboxPipelineInput {
  connectors: PollConnector[];
  signal: AbortSignal;
  continueOnConnectorFailure?: boolean;
  connectorRestartPolicy?: ConnectorRestartPolicy;
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
  const {
    connectors,
    signal,
    continueOnConnectorFailure,
    connectorRestartPolicy,
    ...pipelineInput
  } = input;
  let pipeline: ParsedInboxPipeline | null = null;

  try {
    pipeline = await createParsedInboxPipeline(pipelineInput);
  } catch (error) {
    input.runtime.close();
    throw error;
  }

  try {
    if (signal.aborted) {
      await closeConnectors(connectors);
      return;
    }

    await pipeline.parserService.drain({
      signal,
    });
    if (signal.aborted) {
      await closeConnectors(connectors);
      return;
    }
    await runInboxDaemon({
      pipeline,
      connectors,
      signal,
      continueOnConnectorFailure,
      connectorRestartPolicy,
    });
  } catch (error) {
    await closeConnectors(connectors);
    throw error;
  } finally {
    pipeline.close();
  }
}

async function closeConnectors(connectors: PollConnector[]): Promise<void> {
  await Promise.allSettled(connectors.map((connector) => connector.close?.()));
}
