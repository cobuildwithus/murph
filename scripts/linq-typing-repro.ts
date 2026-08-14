import { createHmac, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

import LinqAPIV3, { APIError } from "@linqapp/sdk";
import type { MessageSendParams } from "@linqapp/sdk/resources/chats";

const DEFAULT_LINQ_API_BASE_URL = "https://api.linqapp.com/api/partner/v3";
const DEFAULT_OBSERVATION_MS = 5 * 60_000;
const DEFAULT_POST_MESSAGE_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_REPRO_MESSAGE =
  "Linq typing indicator repro probe. Please ignore.";

type ReproPhase = "before_outbound_message" | "after_outbound_message";

export interface LinqTypingReproOptions {
  apiBaseUrl: string;
  assertProgressTypingVisible: boolean;
  chatId: string;
  confirmLiveLinq: boolean;
  fingerprintSecret?: string | null;
  interactiveObservation: boolean;
  message: string;
  observationMs: number;
  postMessageDelayMs: number;
  sendMessage: boolean;
  timeoutMs: number;
  token: string;
}

export interface LinqTypingReproReport {
  schema: "murph.linq-typing-repro.v2";
  api: {
    baseUrlOrigin: string;
    baseUrlPath: string;
  };
  chat: RedactedIdentifier;
  startedAt: string;
  fingerprintScope: "env-secret" | "ephemeral";
  messageSend:
    | {
        attempted: false;
        skippedReason: "send-message-not-requested" | "typing-start-not-ok";
      }
    | {
        attempted: true;
        idempotencyKey: RedactedIdentifier;
        providerDeliveryStatus: LinqMessageDeliveryStatus | null;
        result: LinqApiCallReport;
        providerMessage: RedactedIdentifier;
        providerSentAtPresent: boolean;
      };
  observations: Array<{
    phase: ReproPhase;
    sawTypingIndicator: boolean | null;
  }>;
  typing: Array<{
    observationMs: number;
    phase: ReproPhase;
    start: LinqApiCallReport;
    stop:
      | LinqApiCallReport
      | {
          skippedReason:
            | "continued-through-progress-message"
            | "typing-start-not-ok";
      };
  }>;
  progressTypingAssertion:
    | {
        passed: null;
        required: false;
      }
    | {
        passed: boolean;
        required: true;
      };
}

type LinqMessageDeliveryStatus =
  | "pending"
  | "queued"
  | "sent"
  | "delivered"
  | "received"
  | "read"
  | "failed";

const LINQ_MESSAGE_DELIVERY_STATUSES = new Set<LinqMessageDeliveryStatus>([
  "pending",
  "queued",
  "sent",
  "delivered",
  "received",
  "read",
  "failed",
]);

export interface RedactedIdentifier {
  fingerprint: string;
  present: boolean;
}

export interface LinqApiCallReport {
  elapsedMs: number;
  errorName?: string;
  method: "DELETE" | "POST";
  ok: boolean;
  pathTemplate: "/chats/{chatId}/messages" | "/chats/{chatId}/typing";
  responseBodyJson: boolean | null;
  status: number | null;
  timedOut: boolean;
}

interface LinqRequestResult extends LinqApiCallReport {
  json: unknown;
}

type TypingCleanup = () => Promise<void>;

interface ReproDependencies {
  fetchImplementation?: typeof fetch;
  now?: () => Date;
  wait?: (ms: number) => Promise<void>;
  onStatus?: (status: LinqTypingReproStatus) => void;
  askObservation?: (phase: ReproPhase) => Promise<boolean | null>;
  cleanupStack?: LiveCleanupStack;
}

type LinqTypingReproStatus =
  | {
      kind: "typing-starting";
      observationMs: number;
      phase: ReproPhase;
    }
  | {
      call: LinqApiCallReport;
      kind: "typing-started";
      observationMs: number;
      phase: ReproPhase;
    }
  | {
      kind: "typing-stopping";
      phase: ReproPhase;
    }
  | {
      call: LinqApiCallReport;
      kind: "typing-stopped";
      phase: ReproPhase;
    }
  | {
      kind: "message-sending";
    }
  | {
      call: LinqApiCallReport;
      kind: "message-sent";
    };

interface ParsedArgs {
  assertProgressTypingVisible: boolean;
  confirmLiveLinq: boolean;
  env: NodeJS.ProcessEnv;
  interactiveObservation: boolean;
  sendMessage: boolean;
}

export function readLinqTypingReproOptions(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): LinqTypingReproOptions {
  const parsed = parseArgs(args, env);
  const token = readRequiredEnv(parsed.env, "LINQ_API_TOKEN");
  const chatId = readRequiredEnv(parsed.env, "LINQ_REPRO_CHAT_ID");
  if (
    parsed.assertProgressTypingVisible
    && (!parsed.sendMessage || !parsed.interactiveObservation)
  ) {
    throw new Error(
      "--assert-progress-typing-visible requires --send-message and --interactive-observation.",
    );
  }

  return {
    apiBaseUrl: readOptionalEnv(parsed.env, "LINQ_API_BASE_URL")
      ?? DEFAULT_LINQ_API_BASE_URL,
    assertProgressTypingVisible: parsed.assertProgressTypingVisible,
    chatId,
    confirmLiveLinq: parsed.confirmLiveLinq,
    fingerprintSecret: readOptionalEnv(parsed.env, "LINQ_REPRO_LOG_FINGERPRINT_SECRET"),
    interactiveObservation: parsed.interactiveObservation,
    message: readOptionalEnv(parsed.env, "LINQ_REPRO_MESSAGE")
      ?? DEFAULT_REPRO_MESSAGE,
    observationMs: readPositiveIntEnv(
      parsed.env,
      "LINQ_REPRO_OBSERVATION_MS",
      DEFAULT_OBSERVATION_MS,
    ),
    postMessageDelayMs: readPositiveIntEnv(
      parsed.env,
      "LINQ_REPRO_POST_MESSAGE_DELAY_MS",
      DEFAULT_POST_MESSAGE_DELAY_MS,
    ),
    sendMessage: parsed.sendMessage,
    timeoutMs: readPositiveIntEnv(parsed.env, "LINQ_REPRO_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    token,
  };
}

export async function runLinqTypingRepro(
  options: LinqTypingReproOptions,
  dependencies: ReproDependencies = {},
): Promise<LinqTypingReproReport> {
  if (!options.confirmLiveLinq) {
    throw new Error(
      "Refusing to call the live Linq API without --confirm-live-linq.",
    );
  }

  const baseUrl = normalizeBaseUrl(options.apiBaseUrl);
  const fingerprintSecret = normalizeText(options.fingerprintSecret)
    ?? randomBytes(32).toString("base64url");
  const fingerprintScope = normalizeText(options.fingerprintSecret)
    ? "env-secret"
    : "ephemeral";
  const context = { fingerprintSecret };
  const wait = dependencies.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const cleanupStack = dependencies.cleanupStack ?? new LiveCleanupStack();
  const runDependencies = {
    ...dependencies,
    cleanupStack,
  };

  const startedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const sequence = await runTypingSequence({
    baseUrl,
    chatId: options.chatId,
    context,
    dependencies: runDependencies,
    message: options.message,
    observationMs: options.observationMs,
    postMessageDelayMs: options.postMessageDelayMs,
    sendMessage: options.sendMessage,
    timeoutMs: options.timeoutMs,
    token: options.token,
    wait,
  });

  const progressTypingAssertion = options.assertProgressTypingVisible
    ? {
        passed:
          sequence.messageSend.attempted
          && sequence.messageSend.result.ok
          && sequence.observations.length === 2
          && sequence.observations.every(
            (observation) => observation.sawTypingIndicator === true,
          ),
        required: true as const,
      }
    : {
        passed: null,
        required: false as const,
      };

  return {
    schema: "murph.linq-typing-repro.v2",
    api: {
      baseUrlOrigin: baseUrl.origin,
      baseUrlPath: baseUrl.pathname,
    },
    chat: redactIdentifier(options.chatId, context),
    fingerprintScope,
    messageSend: sequence.messageSend,
    observations: sequence.observations,
    progressTypingAssertion,
    startedAt,
    typing: sequence.typing,
  };
}

async function runTypingSequence(input: {
  baseUrl: URL;
  chatId: string;
  context: { fingerprintSecret: string };
  dependencies: ReproDependencies;
  message: string;
  observationMs: number;
  postMessageDelayMs: number;
  sendMessage: boolean;
  timeoutMs: number;
  token: string;
  wait: (ms: number) => Promise<void>;
}): Promise<{
  messageSend: LinqTypingReproReport["messageSend"];
  observations: LinqTypingReproReport["observations"];
  typing: LinqTypingReproReport["typing"];
}> {
  const observations: LinqTypingReproReport["observations"] = [];
  const typing: LinqTypingReproReport["typing"] = [];
  const beforePhase = "before_outbound_message" as const;
  const afterPhase = "after_outbound_message" as const;

  input.dependencies.onStatus?.({
    kind: "typing-starting",
    observationMs: input.observationMs,
    phase: beforePhase,
  });
  const initialStart = await requestLinqApi({
    baseUrl: input.baseUrl,
    chatId: input.chatId,
    dependencies: input.dependencies,
    method: "POST",
    pathTemplate: "/chats/{chatId}/typing",
    timeoutMs: input.timeoutMs,
    token: input.token,
  });
  input.dependencies.onStatus?.({
    call: toCallReport(initialStart),
    kind: "typing-started",
    observationMs: input.observationMs,
    phase: beforePhase,
  });

  if (!initialStart.ok) {
    typing.push({
      observationMs: input.observationMs,
      phase: beforePhase,
      start: toCallReport(initialStart),
      stop: { skippedReason: "typing-start-not-ok" },
    });
    return {
      messageSend: {
        attempted: false,
        skippedReason: input.sendMessage
          ? "typing-start-not-ok"
          : "send-message-not-requested",
      },
      observations,
      typing,
    };
  }

  let stop: LinqRequestResult | null = null;
  let stopStarted = false;
  const stopOnce = async () => {
    if (stopStarted) {
      return;
    }
    stopStarted = true;
    stop = await stopTypingPhase({
      ...input,
      phase: input.sendMessage ? afterPhase : beforePhase,
    });
  };
  const unregisterCleanup = input.dependencies.cleanupStack?.register(stopOnce);

  let messageSend: LinqTypingReproReport["messageSend"] = {
    attempted: false,
    skippedReason: "send-message-not-requested",
  };
  let restart: LinqRequestResult | null = null;

  try {
    await input.wait(input.observationMs);
    observations.push({
      phase: beforePhase,
      sawTypingIndicator: input.dependencies.askObservation
        ? await input.dependencies.askObservation(beforePhase)
        : null,
    });

    if (input.sendMessage) {
      const sent = await sendLinqReproMessage(input);
      messageSend = sent.report;
      if (sent.result.ok) {
        await input.wait(input.postMessageDelayMs);
        input.dependencies.onStatus?.({
          kind: "typing-starting",
          observationMs: input.observationMs,
          phase: afterPhase,
        });
        restart = await requestLinqApi({
          baseUrl: input.baseUrl,
          chatId: input.chatId,
          dependencies: input.dependencies,
          method: "POST",
          pathTemplate: "/chats/{chatId}/typing",
          timeoutMs: input.timeoutMs,
          token: input.token,
        });
        input.dependencies.onStatus?.({
          call: toCallReport(restart),
          kind: "typing-started",
          observationMs: input.observationMs,
          phase: afterPhase,
        });

        if (restart.ok) {
          await input.wait(input.observationMs);
          observations.push({
            phase: afterPhase,
            sawTypingIndicator: input.dependencies.askObservation
              ? await input.dependencies.askObservation(afterPhase)
              : null,
          });
        }
      }
    }
  } finally {
    try {
      await stopOnce();
    } finally {
      unregisterCleanup?.();
    }
  }

  typing.push({
    observationMs: input.observationMs,
    phase: beforePhase,
    start: toCallReport(initialStart),
    stop: restart
      ? { skippedReason: "continued-through-progress-message" }
      : stop
        ? toCallReport(stop)
        : { skippedReason: "typing-start-not-ok" },
  });
  if (restart) {
    typing.push({
      observationMs: input.observationMs,
      phase: afterPhase,
      start: toCallReport(restart),
      stop: stop
        ? toCallReport(stop)
        : { skippedReason: "typing-start-not-ok" },
    });
  }

  return { messageSend, observations, typing };
}

async function sendLinqReproMessage(input: {
  baseUrl: URL;
  chatId: string;
  context: { fingerprintSecret: string };
  dependencies: ReproDependencies;
  message: string;
  timeoutMs: number;
  token: string;
}): Promise<{
  report: Extract<LinqTypingReproReport["messageSend"], { attempted: true }>;
  result: LinqRequestResult;
}> {
  const idempotencyKey = `linq-typing-repro:${Date.now()}:${randomBytes(8).toString("hex")}`;
  input.dependencies.onStatus?.({ kind: "message-sending" });
  const result = await requestLinqApi({
    baseUrl: input.baseUrl,
    body: {
      message: {
        idempotency_key: idempotencyKey,
        parts: [{ type: "text", value: input.message }],
      },
    },
    chatId: input.chatId,
    dependencies: input.dependencies,
    method: "POST",
    pathTemplate: "/chats/{chatId}/messages",
    timeoutMs: input.timeoutMs,
    token: input.token,
  });
  input.dependencies.onStatus?.({
    call: toCallReport(result),
    kind: "message-sent",
  });

  return {
    report: {
      attempted: true,
      idempotencyKey: redactIdentifier(idempotencyKey, input.context),
      providerDeliveryStatus: readLinqMessageDeliveryStatus(result.json),
      providerMessage: redactIdentifier(readLinqMessageId(result.json), input.context),
      providerSentAtPresent: readLinqMessageSentAt(result.json) !== null,
      result: toCallReport(result),
    },
    result,
  };
}

class LiveCleanupStack {
  private readonly cleanups = new Set<TypingCleanup>();

  register(cleanup: TypingCleanup): () => void {
    this.cleanups.add(cleanup);
    return () => {
      this.cleanups.delete(cleanup);
    };
  }

  async runAll(): Promise<void> {
    const cleanups = [...this.cleanups].reverse();
    this.cleanups.clear();
    for (const cleanup of cleanups) {
      await cleanup().catch(() => undefined);
    }
  }
}

async function stopTypingPhase(input: {
  baseUrl: URL;
  chatId: string;
  context: { fingerprintSecret: string };
  dependencies: ReproDependencies;
  observationMs: number;
  phase: ReproPhase;
  timeoutMs: number;
  token: string;
  wait: (ms: number) => Promise<void>;
}): Promise<LinqRequestResult> {
  input.dependencies.onStatus?.({
    kind: "typing-stopping",
    phase: input.phase,
  });
  const stop = await requestLinqApi({
    baseUrl: input.baseUrl,
    chatId: input.chatId,
    dependencies: input.dependencies,
    method: "DELETE",
    pathTemplate: "/chats/{chatId}/typing",
    timeoutMs: input.timeoutMs,
    token: input.token,
  });
  input.dependencies.onStatus?.({
    call: toCallReport(stop),
    kind: "typing-stopped",
    phase: input.phase,
  });
  return stop;
}

async function requestLinqApi(input: {
  baseUrl: URL;
  body?: MessageSendParams;
  chatId: string;
  dependencies: ReproDependencies;
  method: "DELETE" | "POST";
  pathTemplate: "/chats/{chatId}/messages" | "/chats/{chatId}/typing";
  timeoutMs: number;
  token: string;
}): Promise<LinqRequestResult> {
  const fetchImplementation = input.dependencies.fetchImplementation ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  const startedAt = Date.now();
  const client = new LinqAPIV3({
    apiKey: input.token,
    baseURL: resolveLinqSdkBaseUrl(input.baseUrl),
    fetch: fetchImplementation,
    logLevel: "off",
    maxRetries: 0,
    timeout: input.timeoutMs,
  });

  try {
    if (input.pathTemplate === "/chats/{chatId}/messages" && !input.body) {
      throw new Error("Linq message requests require an SDK message body.");
    }
    const operation = input.pathTemplate === "/chats/{chatId}/messages"
      ? client.chats.messages.send(
          input.chatId,
          input.body!,
          { signal: controller.signal },
        )
      : input.method === "POST"
        ? client.chats.typing.start(input.chatId, { signal: controller.signal })
        : client.chats.typing.stop(input.chatId, { signal: controller.signal });
    const { data, response } = await operation.withResponse();
    const json = data ?? null;

    return {
      elapsedMs: Date.now() - startedAt,
      json,
      method: input.method,
      ok: response.ok,
      pathTemplate: input.pathTemplate,
      responseBodyJson: json !== null,
      status: response.status,
      timedOut: false,
    };
  } catch (error) {
    return {
      elapsedMs: Date.now() - startedAt,
      errorName: error instanceof Error ? error.name : "UnknownError",
      json: null,
      method: input.method,
      ok: false,
      pathTemplate: input.pathTemplate,
      responseBodyJson: null,
      status: error instanceof APIError ? error.status : null,
      timedOut: controller.signal.aborted,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function resolveLinqSdkBaseUrl(baseUrl: URL): string {
  const sdkBase = new URL(baseUrl.toString());
  sdkBase.pathname = sdkBase.pathname.replace(/\/v3\/?$/u, "");
  return sdkBase.toString().replace(/\/$/u, "");
}

function toCallReport(result: LinqRequestResult): LinqApiCallReport {
  return {
    elapsedMs: result.elapsedMs,
    ...(result.errorName ? { errorName: result.errorName } : {}),
    method: result.method,
    ok: result.ok,
    pathTemplate: result.pathTemplate,
    responseBodyJson: result.responseBodyJson,
    status: result.status,
    timedOut: result.timedOut,
  };
}

function readLinqMessageId(value: unknown): string | null {
  const record = readRecord(value);
  const directId = readString(record, "id");
  if (directId) {
    return directId;
  }

  const message = readRecord(record?.message);
  const messageId = readString(message, "id");
  if (messageId) {
    return messageId;
  }

  const chat = readRecord(record?.chat);
  const chatMessage = readRecord(chat?.message);
  return readString(chatMessage, "id");
}

function readLinqMessageDeliveryStatus(
  value: unknown,
): LinqMessageDeliveryStatus | null {
  const status = readLinqMessageField(value, "delivery_status");
  return status && LINQ_MESSAGE_DELIVERY_STATUSES.has(status as LinqMessageDeliveryStatus)
    ? status as LinqMessageDeliveryStatus
    : null;
}

function readLinqMessageSentAt(value: unknown): string | null {
  return readLinqMessageField(value, "sent_at");
}

function readLinqMessageField(value: unknown, key: string): string | null {
  const record = readRecord(value);
  const message = readRecord(record?.message);
  const direct = readString(message, key);
  if (direct) {
    return direct;
  }

  const chat = readRecord(record?.chat);
  return readString(readRecord(chat?.message), key);
}

function redactIdentifier(
  value: string | null | undefined,
  context: { fingerprintSecret: string },
): RedactedIdentifier {
  const normalized = normalizeText(value);
  return {
    fingerprint: normalized
      ? `h1_${createHmac("sha256", context.fingerprintSecret)
        .update(normalized, "utf8")
        .digest("hex")
        .slice(0, 16)}`
      : "absent",
    present: normalized !== null,
  };
}

function parseArgs(args: readonly string[], env: NodeJS.ProcessEnv): ParsedArgs {
  const values = { ...env };
  let assertProgressTypingVisible = false;
  let confirmLiveLinq = false;
  let interactiveObservation = false;
  let sendMessage = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--observation-ms":
        values.LINQ_REPRO_OBSERVATION_MS = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--post-message-delay-ms":
        values.LINQ_REPRO_POST_MESSAGE_DELAY_MS = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--timeout-ms":
        values.LINQ_REPRO_TIMEOUT_MS = readArgValue(args, index, arg);
        index += 1;
        break;
      case "--send-message":
        sendMessage = true;
        break;
      case "--interactive-observation":
        interactiveObservation = true;
        break;
      case "--confirm-live-linq":
        confirmLiveLinq = true;
        break;
      case "--assert-progress-typing-visible":
        assertProgressTypingVisible = true;
        break;
      default:
        throw new Error(`Unknown argument: ${redactUnknownArg(arg)}`);
    }
  }

  return {
    assertProgressTypingVisible,
    confirmLiveLinq,
    env: values,
    interactiveObservation,
    sendMessage,
  };
}

function readArgValue(args: readonly string[], index: number, label: string): string {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`${label} requires a value.`);
  }

  return value;
}

function redactUnknownArg(arg: string | undefined): string {
  if (!arg) {
    return "<missing>";
  }
  const flagName = /^--[a-z0-9-]+/iu.exec(arg)?.[0];
  return flagName ?? "<redacted>";
}

function readRequiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = readOptionalEnv(env, key);
  if (!value) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function readOptionalEnv(env: NodeJS.ProcessEnv, key: string): string | null {
  return normalizeText(env[key]);
}

function readPositiveIntEnv(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const value = readOptionalEnv(env, key);
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${key} must be a positive integer.`);
  }

  return parsed;
}

function normalizeText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function askInteractiveObservation(
  phase: ReproPhase,
): Promise<boolean | null> {
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(
      `Did the recipient see a typing indicator for ${phase}? [y/n/skip] `,
    )).trim().toLowerCase();
    if (answer === "y" || answer === "yes") {
      return true;
    }
    if (answer === "n" || answer === "no") {
      return false;
    }
    return null;
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const options = readLinqTypingReproOptions(process.argv.slice(2));
  const cleanupStack = new LiveCleanupStack();
  const handleInterrupt = () => {
    console.error("[linq-typing-repro] Interrupted. Stopping active typing indicator.");
    void cleanupStack.runAll().finally(() => process.exit(130));
  };

  process.once("SIGINT", handleInterrupt);
  try {
    const report = await runLinqTypingRepro(options, {
      askObservation: options.interactiveObservation
        ? askInteractiveObservation
        : undefined,
      cleanupStack,
      onStatus: writeLinqTypingReproStatus,
    });
    console.log(JSON.stringify(report, null, 2));
    if (
      report.progressTypingAssertion.required
      && !report.progressTypingAssertion.passed
    ) {
      console.error(
        "[linq-typing-repro] Live progress typing assertion failed.",
      );
      process.exitCode = 1;
    }
  } finally {
    process.off("SIGINT", handleInterrupt);
    await cleanupStack.runAll();
  }
}

function writeLinqTypingReproStatus(status: LinqTypingReproStatus): void {
  switch (status.kind) {
    case "typing-starting":
      console.error(
        `[linq-typing-repro] POST /typing starting for ${formatReproPhase(status.phase)}.`,
      );
      break;
    case "typing-started":
      console.error(
        `[linq-typing-repro] POST /typing finished for ${formatReproPhase(status.phase)} `
          + `(ok=${String(status.call.ok)}, status=${formatNullableStatus(status.call.status)}). `
          + `Observe the recipient device for ${formatMs(status.observationMs)}.`,
      );
      break;
    case "typing-stopping":
      console.error(
        `[linq-typing-repro] DELETE /typing starting for ${formatReproPhase(status.phase)}.`,
      );
      break;
    case "typing-stopped":
      console.error(
        `[linq-typing-repro] DELETE /typing finished for ${formatReproPhase(status.phase)} `
          + `(ok=${String(status.call.ok)}, status=${formatNullableStatus(status.call.status)}).`,
      );
      break;
    case "message-sending":
      console.error("[linq-typing-repro] POST /messages starting.");
      break;
    case "message-sent":
      console.error(
        `[linq-typing-repro] POST /messages finished `
          + `(ok=${String(status.call.ok)}, status=${formatNullableStatus(status.call.status)}).`,
      );
      break;
  }
}

function formatReproPhase(phase: ReproPhase): string {
  return phase === "before_outbound_message"
    ? "before outbound API message"
    : "after outbound API message";
}

function formatNullableStatus(status: number | null): string {
  return status === null ? "none" : String(status);
}

function formatMs(ms: number): string {
  if (ms % 60_000 === 0) {
    return `${ms / 60_000}m`;
  }
  if (ms % 1_000 === 0) {
    return `${ms / 1_000}s`;
  }
  return `${ms}ms`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
