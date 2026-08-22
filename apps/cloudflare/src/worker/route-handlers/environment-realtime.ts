import {
  CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS,
  matchCloudflareHostedControlUserRoutePath,
} from "@murphai/cloudflare-hosted-control/routes";
import { ENVIRONMENT_REALTIME_TOOL_NAMES } from "@murphai/contracts";
import { emitHostedExecutionStructuredLog } from "@murphai/hosted-execution";
import OpenAI from "openai";

import { json } from "../../json.ts";
import {
  readCachedRequestText,
  type WorkerRouteContext,
} from "../../worker-routes/shared.ts";
import { requireBoundInternalRouteUser } from "../auth.ts";
import type { DeclarativeRoute } from "../routes.ts";
import { buildWorkerRouteLogDetails } from "../route-utils/log-details.ts";
import { decodeRouteParam } from "../route-utils/route-params.ts";

const SDP_MAX_BYTES = 64 * 1_024;
const environmentRealtimeCallRoute = {
  authorizeBeforeMethod: true,
  authorization: "vercel-oidc",
  beforeMethod(context, params) {
    return requireBoundInternalRouteUser(
      context,
      params,
      "environment-realtime-call",
    );
  },
  async handle(context, params) {
    const userId = decodeRouteParam(params.userId);
    const apiKey = context.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return json(
        {
          error: {
            code: "ENVIRONMENT_REALTIME_UNAVAILABLE",
            message: "Environment voice is unavailable.",
          },
        },
        503,
      );
    }

    const sdp = await readCachedRequestText(context, {
      limitBytes: SDP_MAX_BYTES,
    });
    if (!sdp.startsWith("v=0")) {
      return json(
        {
          error: {
            code: "ENVIRONMENT_REALTIME_SDP_INVALID",
            message: "The realtime connection request is invalid.",
          },
        },
        400,
      );
    }

    const form = new FormData();
    form.set("sdp", sdp);
    form.set("session", JSON.stringify(buildEnvironmentRealtimeSession()));

    let response: Response;
    try {
      const openai = new OpenAI({ apiKey, maxRetries: 0 });
      response = await openai.post("/realtime/calls", {
        body: form,
        headers: {
          "OpenAI-Safety-Identifier": await hashSafetyIdentifier(userId),
        },
        signal: context.request.signal,
      }).asResponse();
    } catch (error) {
      emitRealtimeFailure(context, userId, error, null);
      return realtimeProviderError();
    }

    if (!response.ok) {
      emitRealtimeFailure(context, userId, undefined, response.status);
      return realtimeProviderError();
    }
    const answerSdp = await response.text();
    if (!answerSdp.startsWith("v=0") || answerSdp.length > SDP_MAX_BYTES) {
      emitRealtimeFailure(context, userId, undefined, response.status, true);
      return realtimeProviderError();
    }
    return json({ sdp: answerSdp });
  },
  match: (pathname) =>
    matchCloudflareHostedControlUserRoutePath(
      "environmentRealtimeCall",
      pathname,
    ),
  methods: [
    CLOUDFLARE_HOSTED_CONTROL_USER_ROUTE_SPECS.environmentRealtimeCall.method,
  ],
  name: "environment-realtime-call",
  wrongMethodResponse: "method-not-allowed",
} satisfies DeclarativeRoute<WorkerRouteContext>;

export const environmentRealtimeRoutes = [
  environmentRealtimeCallRoute,
] as const;

function buildEnvironmentRealtimeSession() {
  return {
    audio: {
      input: {
        transcription: {
          delay: "low",
          model: "gpt-live-transcribe",
          prompt:
            "A private home environment interview. Vocabulary may include temperature, humidity, carbon dioxide, ventilation, lighting, water, sleep, workspace, sauna, and health devices.",
        },
        turn_detection: {
          create_response: false,
          eagerness: "high",
          interrupt_response: false,
          type: "semantic_vad",
        },
      },
    },
    instructions: [
      "You are Murph's private Environment fact extractor and interview controller.",
      "The app supplies the current topic, the next visible topic, and the exact allowed Habitat fields.",
      "Listen for explicit facts only. Never infer an answer from weak context.",
      "Treat the visible prompt and field labels as the question context for the member's answer.",
      "When exactly one current field remains, bind a concise answer to that field when its meaning is a valid answer, even if the member does not repeat the field label or use a full sentence.",
      "When several current fields remain, bind a concise answer only when its meaning identifies the field clearly.",
      "For enum fields, normalize synonyms, natural descriptions, and more specific equivalent terms to the matching canonical value. Semantic normalization is not an unsupported inference.",
      "Save every allowed fact directly entailed by the member's words, even when they do not repeat a field label. A specific measurement, setting, device use, or result can directly establish a related field. Do not save facts that still require a guess.",
      "Preserve useful detail beyond the canonical value in an optional note on that field. Keep measurements, brands, models, setup, location within the home, limits, and exceptions. Write one factual sentence in the member's language, with at most 400 characters. Do not add advice or inference.",
      "Never put a street, building number, postal code, or exact home address in a note. For home location, retain only the city, region, or broad area type.",
      "Understand any language.",
      "Translate meaning into the exact canonical allowed values without translating those stored values.",
      "Never return user-visible text or audio. Never ask a question. Choose exactly one tool for every response.",
      "For every turn with explicit current-topic facts, call a tool before returning.",
      `When the member asks to change language, call ${ENVIRONMENT_REALTIME_TOOL_NAMES.setLanguage}.`,
      "A clear request to end, stop, finish, save and end, or conclude the conversation is a finish command in any language.",
      `Save facts and navigation together with ${ENVIRONMENT_REALTIME_TOOL_NAMES.updateInterview}.`,
      "A topic can also be completed when the member explicitly declines its remaining fields.",
      "Uncertainty or lack of knowledge leaves the field unresolved and writes nothing. Use the string declined only for an explicit skip, refusal, or preference not to answer.",
      "If the member clearly answers the next visible topic early, include that topic too.",
      "When saving, include the ISO 639-1 code of the language spoken in the latest answer.",
    ].join(" "),
    max_output_tokens: 640,
    model: "gpt-realtime-2.1",
    output_modalities: ["text"],
    parallel_tool_calls: false,
    tool_choice: "required",
    tools: [
      {
        description:
          "Change the visible interview language when the member asks for a specific language.",
        name: ENVIRONMENT_REALTIME_TOOL_NAMES.setLanguage,
        parameters: {
          additionalProperties: false,
          properties: {
            languageCode: {
              description: "ISO 639-1 code requested by the member.",
              type: "string",
            },
          },
          required: ["languageCode"],
          type: "object",
        },
        type: "function",
      },
      {
        description:
          "Continue only when the latest turn is unrelated, unintelligible, or contains no explicit new fact or interview command. Do not use this for a concise answer that is semantically valid for the visible field.",
        name: ENVIRONMENT_REALTIME_TOOL_NAMES.continueInterview,
        parameters: {
          additionalProperties: false,
          properties: {},
          type: "object",
        },
        type: "function",
      },
      {
        description:
          "Save every explicit fact for the visible topic, then optionally navigate. Facts are saved before navigation.",
        name: ENVIRONMENT_REALTIME_TOOL_NAMES.updateInterview,
        parameters: {
          additionalProperties: false,
          properties: {
            action: {
              enum: ["back", "next", "skip", "finish"],
              type: "string",
            },
            languageCode: {
              description:
                "ISO 639-1 code of the language spoken in the member's latest answer.",
              type: "string",
            },
            topics: {
              items: {
                additionalProperties: false,
                properties: {
                  answers: {
                    items: {
                      additionalProperties: false,
                      properties: {
                        aspectId: { type: "string" },
                        indicatorId: { type: "string" },
                        note: {
                          anyOf: [
                            { maxLength: 400, minLength: 1, type: "string" },
                            { type: "null" },
                          ],
                        },
                        value: {
                          anyOf: [
                            { type: "string" },
                            { type: "number" },
                            { type: "boolean" },
                          ],
                        },
                      },
                      required: ["aspectId", "indicatorId", "value"],
                      type: "object",
                    },
                    maxItems: 16,
                    minItems: 1,
                    type: "array",
                  },
                  topicId: { type: "string" },
                },
                required: ["topicId", "answers"],
                type: "object",
              },
              maxItems: 5,
              minItems: 1,
              type: "array",
            },
          },
          type: "object",
        },
        type: "function",
      },
    ],
    type: "realtime",
  };
}

async function hashSafetyIdentifier(userId: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`murph-environment:${userId}`),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function emitRealtimeFailure(
  context: WorkerRouteContext,
  userId: string,
  error: unknown,
  providerStatus: number | null,
  invalidResponse = false,
): void {
  emitHostedExecutionStructuredLog({
    component: "worker",
    details: {
      ...buildWorkerRouteLogDetails(
        {
          reason: "environment-realtime-provider-failed",
          routeName: "environment-realtime-call",
        },
        context.request,
        userId,
      ),
      ...(invalidResponse ? { invalidResponse: "true" } : {}),
      ...(providerStatus === null
        ? {}
        : { providerStatus: String(providerStatus) }),
    },
    ...(error === undefined ? {} : { error }),
    level: "error",
    message: "Hosted Environment Realtime session creation failed.",
    phase: "failed",
    userId,
  });
}

function realtimeProviderError(): Response {
  return json(
    {
      error: {
        code: "ENVIRONMENT_REALTIME_PROVIDER_FAILED",
        message: "Murph could not start live voice right now.",
      },
    },
    502,
  );
}
