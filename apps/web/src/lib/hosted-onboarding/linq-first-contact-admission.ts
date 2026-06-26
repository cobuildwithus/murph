import type { HostedLinqFirstContactAdmissionMode } from "./env";
import { hostedOnboardingError } from "./errors";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import { getHostedOnboardingEnvironment } from "./runtime";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const HOSTED_LINQ_FIRST_CONTACT_ADMISSION_TIMEOUT_MS = 2_500;
const HOSTED_LINQ_FIRST_CONTACT_ADMISSION_MIN_ALLOW_CONFIDENCE = 0.6;

const HOSTED_LINQ_FIRST_CONTACT_ADMISSION_CATEGORIES = [
  "benign_greeting",
  "join_intent",
  "murph_question",
  "not_murph_intent",
  "marketing_outreach",
  "promotional_campaign",
  "wrong_number_or_personal_logistics",
  "unsupported_content",
  "uncertain",
] as const;

type HostedLinqFirstContactAdmissionCategory =
  typeof HOSTED_LINQ_FIRST_CONTACT_ADMISSION_CATEGORIES[number];

const HOSTED_LINQ_FIRST_CONTACT_ADMISSION_ALLOW_CATEGORIES =
  new Set<HostedLinqFirstContactAdmissionCategory>([
    "benign_greeting",
    "join_intent",
    "murph_question",
  ]);

export type HostedLinqFirstContactAdmissionDecision = {
  category: HostedLinqFirstContactAdmissionCategory;
  confidence: number;
  kind: "allow" | "block";
  source: "deterministic" | "model";
};

export type HostedLinqFirstContactAdmissionRequest = {
  eventId: string;
  participantContactKind: "email" | "phone";
  partTypes: readonly string[];
  service: "imessage" | "rcs" | "sms" | "unknown";
  text: string | null;
};

type HostedLinqFirstContactAdmissionDecisionRecord = {
  category: string;
  confidence: number;
  decision: string;
  eventId: string;
  source: string;
};

export type HostedLinqFirstContactEventReceipt = {
  eventId: string;
};

type HostedLinqFirstContactAdmissionDecisionStore = {
  hostedLinqFirstContactAdmissionDecision: {
    create(input: {
      data: {
        category: HostedLinqFirstContactAdmissionCategory;
        confidence: number;
        decision: HostedLinqFirstContactAdmissionDecision["kind"];
        eventId: string;
        source: HostedLinqFirstContactAdmissionDecision["source"];
      };
    }): Promise<HostedLinqFirstContactAdmissionDecisionRecord>;
    findUnique(input: {
      where: {
        eventId: string;
      };
    }): Promise<HostedLinqFirstContactAdmissionDecisionRecord | null>;
  };
};

type HostedLinqFirstContactEventReceiptRecord = {
  eventId: string;
};

type HostedLinqFirstContactEventReceiptStore = {
  hostedLinqFirstContactEventReceipt: {
    create(input: {
      data: {
        eventId: string;
      };
    }): Promise<HostedLinqFirstContactEventReceiptRecord>;
    deleteMany(input: {
      where: {
        eventId: string;
      };
    }): Promise<{ count: number }>;
    findUnique(input: {
      where: {
        eventId: string;
      };
    }): Promise<HostedLinqFirstContactEventReceiptRecord | null>;
  };
};

type HostedLinqFirstContactAdmissionModelResult = {
  category: HostedLinqFirstContactAdmissionCategory;
  confidence: number;
  decision: "allow" | "block";
};

export function readHostedLinqFirstContactAdmissionMode(): HostedLinqFirstContactAdmissionMode {
  return getHostedOnboardingEnvironment().linqFirstContactAdmissionMode;
}

export async function classifyHostedLinqFirstContactAdmission(input: {
  request: HostedLinqFirstContactAdmissionRequest;
  signal?: AbortSignal;
}): Promise<HostedLinqFirstContactAdmissionDecision> {
  if (!input.request.text) {
    return buildHostedLinqFirstContactAdmissionBlock({
      category: "unsupported_content",
      confidence: 1,
      source: "deterministic",
    });
  }

  const environment = getHostedOnboardingEnvironment();
  const apiKey = environment.linqFirstContactAdmissionOpenAiApiKey;
  if (!apiKey) {
    throw buildHostedLinqFirstContactAdmissionUnavailableError({
      failureCategory: "missing_key",
      retryable: false,
    });
  }

  const timeoutSignal = AbortSignal.timeout(HOSTED_LINQ_FIRST_CONTACT_ADMISSION_TIMEOUT_MS);
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      body: JSON.stringify(buildHostedLinqFirstContactAdmissionOpenAiBody({
        model: environment.linqFirstContactAdmissionModel,
        request: input.request,
      })),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal,
    });
  } catch (error) {
    throw buildHostedLinqFirstContactAdmissionUnavailableError({
      cause: error,
      failureCategory: "transport",
      retryable: true,
    });
  }

  if (!response.ok) {
    const providerError = await readHostedLinqFirstContactAdmissionProviderError(response);
    throw buildHostedLinqFirstContactAdmissionUnavailableError({
      cause: new Error("OpenAI Responses API error."),
      failureCategory: "http",
      httpStatus: response.status,
      providerError,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw buildHostedLinqFirstContactAdmissionUnavailableError({
      cause: error,
      failureCategory: "invalid_json",
      retryable: true,
    });
  }

  const terminalBlock = readHostedLinqFirstContactAdmissionTerminalBlock(payload);
  if (terminalBlock) {
    logHostedLinqFirstContactAdmissionDecision(input.request, {
      ...terminalBlock,
      model: environment.linqFirstContactAdmissionModel,
    });
    return terminalBlock;
  }

  if (!responseHasHostedLinqFirstContactAdmissionCompletedStatus(payload)) {
    throw buildHostedLinqFirstContactAdmissionUnavailableError({
      failureCategory: "invalid_output",
      retryable: true,
    });
  }

  const modelResult = parseHostedLinqFirstContactAdmissionModelResult(
    readHostedLinqFirstContactAdmissionOutputText(payload),
  );
  if (!modelResult) {
    throw buildHostedLinqFirstContactAdmissionUnavailableError({
      failureCategory: "invalid_output",
      retryable: true,
    });
  }

  const decision = normalizeHostedLinqFirstContactAdmissionModelDecision(modelResult);
  logHostedLinqFirstContactAdmissionDecision(input.request, {
    ...decision,
    model: environment.linqFirstContactAdmissionModel,
  });
  return decision;
}

export async function readRecordedHostedLinqFirstContactAdmissionDecision(input: {
  eventId: string;
  prisma: HostedLinqFirstContactAdmissionDecisionStore;
}): Promise<HostedLinqFirstContactAdmissionDecision | null> {
  const record = await input.prisma.hostedLinqFirstContactAdmissionDecision.findUnique({
    where: {
      eventId: input.eventId,
    },
  });
  return parseHostedLinqFirstContactAdmissionDecisionRecord(record);
}

export async function recordHostedLinqFirstContactAdmissionDecision(input: {
  decision: HostedLinqFirstContactAdmissionDecision;
  eventId: string;
  prisma: HostedLinqFirstContactAdmissionDecisionStore;
}): Promise<HostedLinqFirstContactAdmissionDecision> {
  try {
    const created = await input.prisma.hostedLinqFirstContactAdmissionDecision.create({
      data: {
        category: input.decision.category,
        confidence: input.decision.confidence,
        decision: input.decision.kind,
        eventId: input.eventId,
        source: input.decision.source,
      },
    });
    return parseHostedLinqFirstContactAdmissionDecisionRecord(created) ?? input.decision;
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await readRecordedHostedLinqFirstContactAdmissionDecision({
      eventId: input.eventId,
      prisma: input.prisma,
    });
    if (existing) {
      return existing;
    }
    throw error;
  }
}

export async function readHostedLinqFirstContactEventReceipt(input: {
  eventId: string;
  prisma: HostedLinqFirstContactEventReceiptStore;
}): Promise<HostedLinqFirstContactEventReceipt | null> {
  const record = await input.prisma.hostedLinqFirstContactEventReceipt.findUnique({
    where: {
      eventId: input.eventId,
    },
  });
  return parseHostedLinqFirstContactEventReceiptRecord(record);
}

export async function recordHostedLinqFirstContactEventConsumed(input: {
  eventId: string;
  prisma: HostedLinqFirstContactEventReceiptStore;
}): Promise<HostedLinqFirstContactEventReceipt> {
  try {
    const created = await input.prisma.hostedLinqFirstContactEventReceipt.create({
      data: {
        eventId: input.eventId,
      },
    });
    return parseHostedLinqFirstContactEventReceiptRecord(created) ?? {
      eventId: input.eventId,
    };
  } catch (error) {
    if (!isPrismaUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await readHostedLinqFirstContactEventReceipt({
      eventId: input.eventId,
      prisma: input.prisma,
    });
    if (existing) {
      return existing;
    }
    throw error;
  }
}

export async function deleteHostedLinqFirstContactEventReceipt(input: {
  eventId: string;
  prisma: HostedLinqFirstContactEventReceiptStore;
}): Promise<void> {
  await input.prisma.hostedLinqFirstContactEventReceipt.deleteMany({
    where: {
      eventId: input.eventId,
    },
  });
}

function buildHostedLinqFirstContactAdmissionOpenAiBody(input: {
  model: string;
  request: HostedLinqFirstContactAdmissionRequest;
}): Record<string, unknown> {
  return {
    input: [
      {
        content: [
          "Classify the first inbound iMessage, SMS, or RCS message from an unknown sender to Murph, a personal health assistant.",
          "Return allow only when the message plausibly comes from a human intentionally trying to contact Murph, start using Murph, ask about Murph, or send a benign short greeting like hi, hey, or hello.",
          "Return block for messages addressed to another person, personal logistics, wrong-number bait, marketing, sales, recruiting, SEO, lead-generation outreach, promotional campaigns, referral or coupon blasts, opt-out boilerplate, media-only messages, unsupported content, or anything ambiguous.",
          "When uncertain, block. Do not reward messages for being conversational if they are not plausibly for Murph.",
        ].join("\n"),
        role: "system",
      },
      {
        content: JSON.stringify({
          participantContactKind: input.request.participantContactKind,
          partTypes: input.request.partTypes,
          product: "Murph",
          service: input.request.service,
          text: input.request.text,
        }),
        role: "user",
      },
    ],
    max_output_tokens: 200,
    model: input.model,
    reasoning: { effort: "low" },
    store: false,
    text: {
      format: {
        name: "linq_first_contact_admission",
        schema: {
          additionalProperties: false,
          properties: {
            category: {
              enum: HOSTED_LINQ_FIRST_CONTACT_ADMISSION_CATEGORIES,
              type: "string",
            },
            confidence: {
              maximum: 1,
              minimum: 0,
              type: "number",
            },
            decision: {
              enum: ["allow", "block"],
              type: "string",
            },
          },
          required: ["decision", "category", "confidence"],
          type: "object",
        },
        strict: true,
        type: "json_schema",
      },
    },
  };
}

function normalizeHostedLinqFirstContactAdmissionModelDecision(
  result: HostedLinqFirstContactAdmissionModelResult,
): HostedLinqFirstContactAdmissionDecision {
  if (
    result.decision === "allow"
    && HOSTED_LINQ_FIRST_CONTACT_ADMISSION_ALLOW_CATEGORIES.has(result.category)
    && result.confidence >= HOSTED_LINQ_FIRST_CONTACT_ADMISSION_MIN_ALLOW_CONFIDENCE
  ) {
    return {
      category: result.category,
      confidence: result.confidence,
      kind: "allow",
      source: "model",
    };
  }

  return buildHostedLinqFirstContactAdmissionBlock({
    category: HOSTED_LINQ_FIRST_CONTACT_ADMISSION_ALLOW_CATEGORIES.has(result.category)
      ? "uncertain"
      : result.category,
    confidence: result.confidence,
    source: "model",
  });
}

function buildHostedLinqFirstContactAdmissionBlock(input: {
  category: HostedLinqFirstContactAdmissionCategory;
  confidence: number;
  source: HostedLinqFirstContactAdmissionDecision["source"];
}): HostedLinqFirstContactAdmissionDecision {
  return {
    category: input.category,
    confidence: clampHostedLinqFirstContactAdmissionConfidence(input.confidence),
    kind: "block",
    source: input.source,
  };
}

function parseHostedLinqFirstContactAdmissionModelResult(
  outputText: string | null,
): HostedLinqFirstContactAdmissionModelResult | null {
  if (!outputText) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    return null;
  }

  const record = readRecord(parsed);
  if (!record) {
    return null;
  }

  const decision = readString(record.decision);
  const category = readString(record.category);
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
    ? record.confidence
    : null;

  if (
    (decision !== "allow" && decision !== "block")
    || !isHostedLinqFirstContactAdmissionCategory(category)
    || confidence === null
    || confidence < 0
    || confidence > 1
  ) {
    return null;
  }

  return {
    category,
    confidence,
    decision,
  };
}

function parseHostedLinqFirstContactAdmissionDecisionRecord(
  record: HostedLinqFirstContactAdmissionDecisionRecord | null,
): HostedLinqFirstContactAdmissionDecision | null {
  if (!record) {
    return null;
  }

  const category = readString(record.category);
  if (
    (record.decision !== "allow" && record.decision !== "block")
    || !isHostedLinqFirstContactAdmissionCategory(category)
    || !Number.isFinite(record.confidence)
    || record.confidence < 0
    || record.confidence > 1
    || (record.source !== "deterministic" && record.source !== "model")
  ) {
    return null;
  }

  return {
    category,
    confidence: record.confidence,
    kind: record.decision,
    source: record.source,
  };
}

function parseHostedLinqFirstContactEventReceiptRecord(
  record: HostedLinqFirstContactEventReceiptRecord | null,
): HostedLinqFirstContactEventReceipt | null {
  if (
    !record
    || record.eventId.trim().length === 0
  ) {
    return null;
  }

  return {
    eventId: record.eventId,
  };
}

function readHostedLinqFirstContactAdmissionTerminalBlock(
  payload: unknown,
): HostedLinqFirstContactAdmissionDecision | null {
  const record = readRecord(payload);
  if (!record) {
    return null;
  }

  const incompleteDetails = readRecord(record.incomplete_details);
  if (
    readString(record.status) === "incomplete"
    && readString(incompleteDetails?.reason) === "content_filter"
  ) {
    return buildHostedLinqFirstContactAdmissionBlock({
      category: "unsupported_content",
      confidence: 1,
      source: "model",
    });
  }

  return responseHasHostedLinqFirstContactAdmissionRefusal(record)
    ? buildHostedLinqFirstContactAdmissionBlock({
      category: "unsupported_content",
      confidence: 1,
      source: "model",
    })
    : null;
}

function responseHasHostedLinqFirstContactAdmissionRefusal(
  record: Record<string, unknown>,
): boolean {
  if (!Array.isArray(record.output)) {
    return false;
  }

  for (const item of record.output) {
    const itemRecord = readRecord(item);
    if (!itemRecord || !Array.isArray(itemRecord.content)) {
      continue;
    }

    for (const contentItem of itemRecord.content) {
      const contentRecord = readRecord(contentItem);
      if (
        readString(contentRecord?.type) === "refusal"
        || readString(contentRecord?.refusal)
      ) {
        return true;
      }
    }
  }

  return false;
}

function responseHasHostedLinqFirstContactAdmissionCompletedStatus(
  payload: unknown,
): boolean {
  const record = readRecord(payload);
  return readString(record?.status) === "completed";
}

function readHostedLinqFirstContactAdmissionOutputText(payload: unknown): string | null {
  const record = readRecord(payload);
  if (!record) {
    return null;
  }

  const outputText = readString(record.output_text);
  if (outputText) {
    return outputText;
  }

  if (!Array.isArray(record.output)) {
    return null;
  }

  for (const item of record.output) {
    const itemRecord = readRecord(item);
    if (!itemRecord || !Array.isArray(itemRecord.content)) {
      continue;
    }

    for (const contentItem of itemRecord.content) {
      const contentRecord = readRecord(contentItem);
      const text = readString(contentRecord?.text);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function logHostedLinqFirstContactAdmissionDecision(
  request: HostedLinqFirstContactAdmissionRequest,
  decision: HostedLinqFirstContactAdmissionDecision & { model: string },
): void {
  console.info(
    "Hosted Linq first-contact admission decision.",
    sanitizeHostedOnboardingStructuredLogDetails({
      category: decision.category,
      confidence: decision.confidence,
      decision: decision.kind,
      eventIdSuffix: toHostedOnboardingLogIdSuffix(request.eventId),
      model: decision.model,
      source: decision.source,
    }),
  );
}

function isHostedLinqFirstContactAdmissionCategory(
  value: string | null,
): value is HostedLinqFirstContactAdmissionCategory {
  return HOSTED_LINQ_FIRST_CONTACT_ADMISSION_CATEGORIES.includes(
    value as HostedLinqFirstContactAdmissionCategory,
  );
}

function clampHostedLinqFirstContactAdmissionConfidence(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readHostedLinqFirstContactAdmissionProviderError(
  response: Response,
): Promise<{
  code?: string;
  message?: string;
  requestIdPresent: boolean;
  type?: string;
}> {
  const requestIdPresent = Boolean(
    response.headers.get("x-request-id")
    ?? response.headers.get("openai-request-id"),
  );
  const text = await response.text().catch(() => "");
  const boundedText = text.slice(0, 4_096);
  let parsed: unknown;
  try {
    parsed = JSON.parse(boundedText);
  } catch {
    return {
      requestIdPresent,
    };
  }

  const parsedRecord = readRecord(parsed);
  const errorRecord = readRecord(parsedRecord?.error);
  return {
    ...(readBoundedProviderErrorString(errorRecord?.code)
      ? { code: readBoundedProviderErrorString(errorRecord?.code) }
      : {}),
    requestIdPresent,
    ...(readBoundedProviderErrorString(errorRecord?.type)
      ? { type: readBoundedProviderErrorString(errorRecord?.type) }
      : {}),
  };
}

function readBoundedProviderErrorString(value: unknown): string | undefined {
  const text = readString(value);
  return text ? text.slice(0, 240) : undefined;
}

function isPrismaUniqueConstraintError(error: unknown): boolean {
  return readRecord(error)?.code === "P2002";
}

function buildHostedLinqFirstContactAdmissionUnavailableError(input: {
  cause?: unknown;
  failureCategory: "http" | "invalid_json" | "invalid_output" | "missing_key" | "transport";
  httpStatus?: number;
  providerError?: {
    code?: string;
    requestIdPresent: boolean;
    type?: string;
  };
  retryable: boolean;
}) {
  return hostedOnboardingError({
    cause: input.cause,
    code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
      details: {
        operationName: "hosted_linq_first_contact_admission",
        providerErrorCode: input.providerError?.code,
        providerErrorType: input.providerError?.type,
      providerRequestIdPresent: input.providerError?.requestIdPresent,
      statusCode: input.httpStatus,
      type: input.failureCategory,
    },
    httpStatus: 503,
    message: "Linq first-contact admission classifier is unavailable.",
    retryable: input.retryable,
  });
}
