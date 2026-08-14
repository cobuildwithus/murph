import OpenAI, { APIError } from "openai";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";

import type { HostedLinqFirstContactAdmissionMode } from "./env";
import { hostedOnboardingError, isHostedOnboardingError } from "./errors";
import {
  createHostedLinqParticipantContactLookupKey,
  createHostedLinqParticipantContactLookupKeyReadCandidates,
  type HostedLinqParticipantContact,
} from "./linq-participant-contact";
import {
  sanitizeHostedOnboardingStructuredLogDetails,
  toHostedOnboardingLogIdSuffix,
} from "./logging";
import { getHostedOnboardingEnvironment } from "./runtime";

const OPENAI_RESPONSES_BASE_URL = "https://api.openai.com/v1";
const HOSTED_LINQ_FIRST_CONTACT_ADMISSION_TIMEOUT_MS = 10_000;
export const HOSTED_LINQ_FIRST_CONTACT_ADMISSION_MAX_ATTEMPTS = 4;

export type HostedLinqFirstContactAdmissionDecision = {
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
  confidence: number;
  decision: string;
  eventId: string;
  source: string;
};

type HostedLinqFirstContactAdmissionDecisionStore = {
  hostedLinqFirstContactAdmissionDecision: {
    createMany(input: {
      data: {
        confidence: number;
        decision: HostedLinqFirstContactAdmissionDecision["kind"];
        eventId: string;
        source: HostedLinqFirstContactAdmissionDecision["source"];
      };
      skipDuplicates: true;
    }): Promise<{ count: number }>;
    findUnique(input: {
      where: {
        eventId: string;
      };
    }): Promise<HostedLinqFirstContactAdmissionDecisionRecord | null>;
  };
};

type HostedLinqFirstContactAdmissionBudgetRecord = {
  eventId: string;
  participantContactKind: string;
  participantContactLookupKey: string;
};

type HostedLinqFirstContactAdmissionBudgetStore = {
  $executeRaw(
    template: TemplateStringsArray,
    ...values: readonly unknown[]
  ): Promise<number>;
  hostedLinqFirstContactAdmissionBudget: {
    create(input: {
      data: {
        eventId: string;
        participantContactKind: HostedLinqFirstContactAdmissionRequest["participantContactKind"];
        participantContactLookupKey: string;
      };
    }): Promise<HostedLinqFirstContactAdmissionBudgetRecord>;
    findFirst(input: {
      where: {
        eventId: string;
        participantContactLookupKey: {
          in: string[];
        };
      };
    }): Promise<HostedLinqFirstContactAdmissionBudgetRecord | null>;
    findMany(input: {
      select: {
        eventId: true;
      };
      where: {
        participantContactLookupKey: {
          in: string[];
        };
      };
    }): Promise<{ eventId: string }[]>;
  };
  hostedLinqFirstContactAdmissionDecision: {
    findMany(input: {
      where: {
        eventId: {
          in: string[];
        };
      };
    }): Promise<HostedLinqFirstContactAdmissionDecisionRecord[]>;
  };
};

export type HostedLinqFirstContactAdmissionBudgetClaim =
  | {
      decision: HostedLinqFirstContactAdmissionDecision;
      kind: "already_allowed";
    }
  | {
      attemptCount: number;
      kind: "claimed";
    }
  | {
      attemptCount: number;
      kind: "exhausted";
    };

type HostedLinqFirstContactAdmissionModelResult = {
  confidence: number;
  decision: "allow" | "block";
};

type HostedLinqFirstContactAdmissionProviderError = {
  code?: string;
  message?: string;
  requestIdPresent: boolean;
  type?: string;
};

type HostedLinqFirstContactAdmissionOpenAiRequestState = {
  errorResponse: Response | null;
  transportError: unknown;
};

export function readHostedLinqFirstContactAdmissionMode(): HostedLinqFirstContactAdmissionMode {
  return getHostedOnboardingEnvironment().linqFirstContactAdmissionMode;
}

// Returns a decision when the request can be resolved without an OpenAI
// classifier call. Callers should run this before claiming the per-contact
// admission budget so deterministic blocks never consume an attempt slot.
export function tryHostedLinqFirstContactAdmissionDeterministicDecision(
  request: HostedLinqFirstContactAdmissionRequest,
): HostedLinqFirstContactAdmissionDecision | null {
  if (!request.text) {
    return buildHostedLinqFirstContactAdmissionBlock({
      confidence: 1,
      source: "deterministic",
    });
  }
  return null;
}

export function buildHostedLinqFirstContactAdmissionClassifierUnavailableDecision():
  HostedLinqFirstContactAdmissionDecision {
  return buildHostedLinqFirstContactAdmissionAllow({
    confidence: 1,
    source: "deterministic",
  });
}

export function isHostedLinqFirstContactAdmissionClassifierUnavailableError(error: unknown): boolean {
  return isHostedOnboardingError(error)
    && error.code === "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE";
}

export async function classifyHostedLinqFirstContactAdmission(input: {
  request: HostedLinqFirstContactAdmissionRequest;
  signal?: AbortSignal;
}): Promise<HostedLinqFirstContactAdmissionDecision> {
  const deterministicDecision = tryHostedLinqFirstContactAdmissionDeterministicDecision(input.request);
  if (deterministicDecision) {
    return deterministicDecision;
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

  const requestState: HostedLinqFirstContactAdmissionOpenAiRequestState = {
    errorResponse: null,
    transportError: null,
  };
  const openAi = new OpenAI({
    adminAPIKey: null,
    apiKey,
    baseURL: OPENAI_RESPONSES_BASE_URL,
    fetch: createHostedFirstContactAdmissionOpenAiFetch(fetch, requestState),
    logLevel: "off",
    maxRetries: 0,
    organization: null,
    project: null,
    timeout: HOSTED_LINQ_FIRST_CONTACT_ADMISSION_TIMEOUT_MS,
    webhookSecret: null,
  });

  let response: Response;
  try {
    response = await openAi.responses.create(
      buildHostedLinqFirstContactAdmissionOpenAiBody({
        model: environment.linqFirstContactAdmissionModel,
        request: input.request,
      }),
      {
        maxRetries: 0,
        signal,
        timeout: HOSTED_LINQ_FIRST_CONTACT_ADMISSION_TIMEOUT_MS,
      },
    ).asResponse();
  } catch (error) {
    const errorResponse = requestState.errorResponse;
    if (errorResponse) {
      const providerError = await readHostedLinqFirstContactAdmissionProviderError(errorResponse);
      if (isHostedLinqFirstContactAdmissionQuotaExhausted({
        providerError,
        status: errorResponse.status,
      })) {
        const decision = buildHostedLinqFirstContactAdmissionAllow({
          confidence: 1,
          source: "deterministic",
        });
        logHostedLinqFirstContactAdmissionDecision(input.request, {
          ...decision,
          model: environment.linqFirstContactAdmissionModel,
        });
        return decision;
      }

      throw buildHostedLinqFirstContactAdmissionUnavailableError({
        cause: providerError.message
          ? new Error(`OpenAI Responses API error: ${providerError.message}`)
          : undefined,
        failureCategory: "http",
        httpStatus: errorResponse.status,
        providerError,
        retryable: errorResponse.status === 429 || errorResponse.status >= 500,
      });
    }

    if (error instanceof APIError && typeof error.status === "number") {
      const providerError = readHostedLinqFirstContactAdmissionApiError(error);
      if (isHostedLinqFirstContactAdmissionQuotaExhausted({
        providerError,
        status: error.status,
      })) {
        const decision = buildHostedLinqFirstContactAdmissionAllow({
          confidence: 1,
          source: "deterministic",
        });
        logHostedLinqFirstContactAdmissionDecision(input.request, {
          ...decision,
          model: environment.linqFirstContactAdmissionModel,
        });
        return decision;
      }

      throw buildHostedLinqFirstContactAdmissionUnavailableError({
        cause: providerError.message
          ? new Error(`OpenAI Responses API error: ${providerError.message}`)
          : undefined,
        failureCategory: "http",
        httpStatus: error.status,
        providerError,
        retryable: error.status === 429 || error.status >= 500,
      });
    }

    throw buildHostedLinqFirstContactAdmissionUnavailableError({
      cause: requestState.transportError ?? error,
      failureCategory: "transport",
      retryable: true,
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
  await input.prisma.hostedLinqFirstContactAdmissionDecision.createMany({
    data: {
      confidence: input.decision.confidence,
      decision: input.decision.kind,
      eventId: input.eventId,
      source: input.decision.source,
    },
    skipDuplicates: true,
  });

  const recorded = await readRecordedHostedLinqFirstContactAdmissionDecision({
    eventId: input.eventId,
    prisma: input.prisma,
  });
  if (!recorded) {
    throw new Error("Hosted Linq first-contact admission decision was not recorded.");
  }

  return recorded;
}

export async function claimHostedLinqFirstContactAdmissionBudget(input: {
  eventId: string;
  participantContact: HostedLinqParticipantContact;
  tx: HostedLinqFirstContactAdmissionBudgetStore;
}): Promise<HostedLinqFirstContactAdmissionBudgetClaim> {
  // Read every key version that still resolves to this contact so the budget
  // and replay guard survive contact-privacy-key rotation. Lock and insert use
  // the version-independent and current values respectively, matching the
  // discipline in hosted-member-routing-linq for participant contacts.
  const lookupKeyCandidates = createHostedLinqParticipantContactLookupKeyReadCandidates({
    kind: input.participantContact.kind,
    value: input.participantContact.value,
  });
  if (lookupKeyCandidates.length === 0) {
    throw new TypeError(
      "Hosted Linq first-contact admission budget requires at least one readable lookup key.",
    );
  }

  const currentLookupKey = createHostedLinqParticipantContactLookupKey({
    kind: input.participantContact.kind,
    value: input.participantContact.value,
  });
  if (!currentLookupKey) {
    throw new TypeError(
      "Hosted Linq first-contact admission budget requires a current contact lookup key.",
    );
  }

  // Per-contact advisory lock serializes concurrent distinct-event claims so
  // the cap check and insert observe a consistent attempt count. The lock
  // value is the version-independent `${kind}:${value}` so concurrent claims
  // contend even across a key-version boundary. Released on transaction
  // commit. Mirrors acquireHostedLinqRoutingWriteLockTx.
  await input.tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${"hosted-linq-first-contact-admission-budget"}),
      hashtext(${`${input.participantContact.kind}:${input.participantContact.value}`})
    )
  `;

  const alreadyCounted = await input.tx.hostedLinqFirstContactAdmissionBudget.findFirst({
    where: {
      eventId: input.eventId,
      participantContactLookupKey: {
        in: lookupKeyCandidates,
      },
    },
  });
  const history = await readHostedLinqFirstContactAdmissionContactHistory({
    lookupKeyCandidates,
    tx: input.tx,
  });
  if (alreadyCounted) {
    return {
      attemptCount: history.chargeableCount,
      kind: "claimed",
    };
  }

  // Admission is a decision about a contact, not about one message. Once any
  // earlier event for this contact recorded a reusable allow, later events
  // reuse it instead of spending another attempt or another classifier call.
  // Without that, a sender who keeps messaging before they resolve to a member
  // burns the cap on repeat offers and is then blocked forever, on this path
  // and on the ordinary direct one.
  if (history.reusableAllow) {
    return {
      decision: history.reusableAllow,
      kind: "already_allowed",
    };
  }

  if (history.chargeableCount >= HOSTED_LINQ_FIRST_CONTACT_ADMISSION_MAX_ATTEMPTS) {
    return {
      attemptCount: history.chargeableCount,
      kind: "exhausted",
    };
  }

  await input.tx.hostedLinqFirstContactAdmissionBudget.create({
    data: {
      eventId: input.eventId,
      participantContactKind: input.participantContact.kind,
      participantContactLookupKey: currentLookupKey,
    },
  });

  return {
    attemptCount: history.chargeableCount + 1,
    kind: "claimed",
  };
}

// The budget rows carry the contact key and the decision rows carry the
// outcome; they join on the event id. Reading them together here keeps the
// contact-key candidates (and their rotation handling) inside this owner
// instead of leaking the lookup-key rules into callers, and derives both facts
// the caller needs from one pair of reads.
//
// `reusableAllow` answers only the contact question, "may Murph answer this
// stranger at all". Just a model-source allow qualifies: the other allow this
// path persists is the classifier-unavailable fail-open, which is evidence
// that nobody could check the sender rather than evidence the sender is
// welcome, so reusing it would let one outage admit a contact permanently.
// Whether an inbound may mint instant-start entitlement stays a property of the
// exact event that earned its own model allow, which is why nothing is ever
// written under a later event id.
//
// `chargeableCount` is the lifetime cap's meaning: attempts that actually spent
// a classification. A fail-open event never reached the classifier, so charging
// it would let an outage alone exhaust the contact — four unavailable events
// would leave the contact with no reusable evidence and no remaining attempts,
// permanently silent on both the group and direct paths with no repair short of
// a database edit. Real blocks, model allows, and never-completed attempts all
// still count, so the spend and abuse bound keeps its meaning.
async function readHostedLinqFirstContactAdmissionContactHistory(input: {
  lookupKeyCandidates: string[];
  tx: HostedLinqFirstContactAdmissionBudgetStore;
}): Promise<{
  chargeableCount: number;
  reusableAllow: HostedLinqFirstContactAdmissionDecision | null;
}> {
  const attempts = await input.tx.hostedLinqFirstContactAdmissionBudget.findMany({
    select: {
      eventId: true,
    },
    where: {
      participantContactLookupKey: {
        in: input.lookupKeyCandidates,
      },
    },
  });
  if (attempts.length === 0) {
    return { chargeableCount: 0, reusableAllow: null };
  }

  const records = await input.tx.hostedLinqFirstContactAdmissionDecision.findMany({
    where: {
      eventId: {
        in: attempts.map(({ eventId }) => eventId),
      },
    },
  });
  const decisionsByEventId = new Map(
    records.map((record) => [
      record.eventId,
      parseHostedLinqFirstContactAdmissionDecisionRecord(record),
    ]),
  );

  let reusableAllow: HostedLinqFirstContactAdmissionDecision | null = null;
  let chargeableCount = 0;
  for (const { eventId } of attempts) {
    const decision = decisionsByEventId.get(eventId) ?? null;
    if (decision?.kind === "allow" && decision.source === "model") {
      reusableAllow ??= decision;
    }
    if (!isHostedLinqFirstContactAdmissionFailOpenDecision(decision)) {
      chargeableCount += 1;
    }
  }

  return { chargeableCount, reusableAllow };
}

// The classifier-unavailable fallback is the only allow this path records
// without asking the model.
function isHostedLinqFirstContactAdmissionFailOpenDecision(
  decision: HostedLinqFirstContactAdmissionDecision | null,
): boolean {
  return decision?.kind === "allow" && decision.source === "deterministic";
}

function buildHostedLinqFirstContactAdmissionOpenAiBody(input: {
  model: string;
  request: HostedLinqFirstContactAdmissionRequest;
}): ResponseCreateParamsNonStreaming {
  return {
    input: [
      {
        content: [
          "Goal: decide whether this first inbound iMessage, SMS, or RCS message from an unknown sender should be admitted so Murph, a personal health assistant, can reply.",
          "Default to allow. Murph would rather reply to a stranger than turn one away.",
          "Allow anything that reads like a real person reaching out — including bare greetings like \"hi\", \"hey\", \"yo\", \"sup\", emoji-only, single-word pings, any health/wellness/life question, any message that mentions Murph, and any genuine question or intent to use the product.",
          "Only block if the message is clearly automated marketing, sales, recruiting, SEO outreach, lead generation, promotional or coupon blasts, mass-template solicitations, or other obvious commercial spam aimed at an inbox rather than a person.",
          "When uncertain whether a message is a real human greeting or commercial spam, return allow.",
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
    model: input.model,
    reasoning: { effort: "medium" },
    service_tier: "priority",
    store: false,
    text: {
      format: {
        name: "linq_first_contact_admission",
        schema: {
          additionalProperties: false,
          properties: {
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
          required: ["decision", "confidence"],
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
  return result.decision === "allow"
    ? buildHostedLinqFirstContactAdmissionAllow({
      confidence: result.confidence,
      source: "model",
    })
    : buildHostedLinqFirstContactAdmissionBlock({
      confidence: result.confidence,
      source: "model",
    });
}

function buildHostedLinqFirstContactAdmissionAllow(input: {
  confidence: number;
  source: HostedLinqFirstContactAdmissionDecision["source"];
}): HostedLinqFirstContactAdmissionDecision {
  return {
    confidence: clampHostedLinqFirstContactAdmissionConfidence(input.confidence),
    kind: "allow",
    source: input.source,
  };
}

function buildHostedLinqFirstContactAdmissionBlock(input: {
  confidence: number;
  source: HostedLinqFirstContactAdmissionDecision["source"];
}): HostedLinqFirstContactAdmissionDecision {
  return {
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
  const confidence = typeof record.confidence === "number" && Number.isFinite(record.confidence)
    ? record.confidence
    : null;

  if (
    (decision !== "allow" && decision !== "block")
    || confidence === null
    || confidence < 0
    || confidence > 1
  ) {
    return null;
  }

  return {
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

  if (
    (record.decision !== "allow" && record.decision !== "block")
    || !Number.isFinite(record.confidence)
    || record.confidence < 0
    || record.confidence > 1
    || (record.source !== "deterministic" && record.source !== "model")
  ) {
    return null;
  }

  return {
    confidence: record.confidence,
    kind: record.decision,
    source: record.source,
  };
}

// Custom-boundary parse of the OpenAI Responses API payload (canonical SDK shape:
// `Response` from `openai/resources/responses/responses`). The SDK owns request
// construction and transport, while these defensive walks remain the executable
// response contract because provider payloads are untrusted: we consume only a
// narrow set of fields from the deep discriminated union.
// `status` must equal `"completed"` before we trust the structured output;
// `incomplete_details.reason === "content_filter"` is a terminal block;
// `output[].content[].type === "refusal"` (or any `output[].content[].refusal`
// string) is a terminal block; the structured payload is read from `output_text`
// first, then fallback `output[].content[].text`. Provider error paths (non-2xx)
// throw `buildHostedLinqFirstContactAdmissionUnavailableError` upstream before
// these parsers run, and unstructured/invalid JSON falls through to the
// `"invalid_output"` retryable path.
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
      confidence: 1,
      source: "model",
    });
  }

  return responseHasHostedLinqFirstContactAdmissionRefusal(record)
    ? buildHostedLinqFirstContactAdmissionBlock({
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
      confidence: decision.confidence,
      decision: decision.kind,
      eventIdSuffix: toHostedOnboardingLogIdSuffix(request.eventId),
      model: decision.model,
      source: decision.source,
    }),
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
): Promise<HostedLinqFirstContactAdmissionProviderError> {
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
    ...(readBoundedProviderErrorString(errorRecord?.message)
      ? { message: readBoundedProviderErrorString(errorRecord?.message) }
      : {}),
    requestIdPresent,
    ...(readBoundedProviderErrorString(errorRecord?.type)
      ? { type: readBoundedProviderErrorString(errorRecord?.type) }
      : {}),
  };
}

function readHostedLinqFirstContactAdmissionApiError(
  error: APIError,
): HostedLinqFirstContactAdmissionProviderError {
  const errorRecord = readRecord(error.error);
  return {
    ...(readBoundedProviderErrorString(errorRecord?.code)
      ? { code: readBoundedProviderErrorString(errorRecord?.code) }
      : {}),
    ...(readBoundedProviderErrorString(errorRecord?.message)
      ? { message: readBoundedProviderErrorString(errorRecord?.message) }
      : {}),
    requestIdPresent: Boolean(
      error.requestID
      ?? error.headers?.get("openai-request-id"),
    ),
    ...(readBoundedProviderErrorString(errorRecord?.type)
      ? { type: readBoundedProviderErrorString(errorRecord?.type) }
      : {}),
  };
}

function createHostedFirstContactAdmissionOpenAiFetch(
  fetchImpl: typeof fetch,
  state: HostedLinqFirstContactAdmissionOpenAiRequestState,
): typeof fetch {
  const sdkFetch = async (
    request: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    try {
      const response = await fetchImpl.call(undefined, request, init);
      if (!response.ok) {
        try {
          state.errorResponse = response.clone();
        } catch {
          state.errorResponse = null;
        }
      }
      return response;
    } catch (error) {
      state.transportError = error;
      throw error;
    }
  };

  return Object.assign(sdkFetch, { Response });
}

function readBoundedProviderErrorString(value: unknown): string | undefined {
  const text = readString(value);
  return text ? text.slice(0, 240) : undefined;
}

function isHostedLinqFirstContactAdmissionQuotaExhausted(input: {
  providerError: {
    code?: string;
    message?: string;
    type?: string;
  };
  status: number;
}): boolean {
  if (input.status !== 429) {
    return false;
  }

  const code = input.providerError.code?.toLowerCase();
  const type = input.providerError.type?.toLowerCase();
  const message = input.providerError.message?.toLowerCase() ?? "";
  return code === "insufficient_quota"
    || code === "billing_hard_limit_reached"
    || type === "insufficient_quota"
    || type === "billing_hard_limit_reached"
    || (
      message.includes("exceeded your current quota")
      && message.includes("billing")
    )
    || message.includes("insufficient quota")
    || message.includes("billing hard limit")
    || message.includes("out of credits")
    || message.includes("credit balance");
}

function buildHostedLinqFirstContactAdmissionUnavailableError(input: {
  cause?: unknown;
  failureCategory: "http" | "invalid_json" | "invalid_output" | "missing_key" | "transport";
  httpStatus?: number;
  providerError?: HostedLinqFirstContactAdmissionProviderError;
  retryable: boolean;
}) {
  return hostedOnboardingError({
    cause: input.cause,
    code: "LINQ_FIRST_CONTACT_ADMISSION_CLASSIFIER_UNAVAILABLE",
    details: {
      operationName: "hosted_linq_first_contact_admission",
      providerErrorCode: input.providerError?.code,
      providerErrorMessage: input.providerError?.message,
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
