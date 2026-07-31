import {
  HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  buildHostedCustomInferenceModelAlias,
} from "@murphai/hosted-execution/assistant-inference";
import type {
  CloudflareHostedInferenceVerificationRequest,
  CloudflareHostedInferenceVerificationResult,
} from "@murphai/cloudflare-hosted-control/inference-verification";

import {
  HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA,
  type HostedInferenceRuntimeTarget,
} from "./hosted-inference-runtime-target.ts";
import {
  HostedCustomInferenceRequestError,
  adaptHostedCustomInferenceUpstreamResponse,
  buildHostedCustomInferenceUpstreamRequestBody,
  injectHostedCustomInferenceAuth,
} from "./runner-egress-custom-inference.ts";

const HOSTED_INFERENCE_VERIFICATION_REVISION = 1;
const HOSTED_INFERENCE_VERIFICATION_TOTAL_TIMEOUT_MS = 60_000;
const HOSTED_INFERENCE_VERIFICATION_TIMEOUT_MS = 20_000;
const HOSTED_INFERENCE_VERIFICATION_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const HOSTED_INFERENCE_VERIFICATION_TOOL_NAME = "murph_verify_connection";
const HOSTED_INFERENCE_VERIFICATION_TOOL_NONCE =
  "murph_connection_probe_v1";
const HOSTED_INFERENCE_VERIFICATION_FINAL_NONCE =
  "murph_connection_verified_v1";
const HOSTED_INFERENCE_VERIFICATION_IMAGE_NONCE =
  "murph_image_verified_v1";
const HOSTED_INFERENCE_VERIFICATION_IMAGE_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export class HostedInferenceVerificationError extends Error {
  constructor() {
    super("The custom inference endpoint did not pass Murph verification.");
    this.name = "HostedInferenceVerificationError";
  }
}

export async function verifyHostedInferenceConnection(input: {
  request: CloudflareHostedInferenceVerificationRequest;
  signal?: AbortSignal;
  upstreamFetchImpl?: typeof fetch;
}): Promise<CloudflareHostedInferenceVerificationResult> {
  const deadlineAt = Date.now() + HOSTED_INFERENCE_VERIFICATION_TOTAL_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(
    HOSTED_INFERENCE_VERIFICATION_TOTAL_TIMEOUT_MS,
  );
  const signal = input.signal
    ? AbortSignal.any([input.signal, timeoutSignal])
    : timeoutSignal;
  const target = buildVerificationTarget(input.request);
  const firstInput = buildToolProbeInput();
  const toolResponse = await sendVerificationRequest({
    body: {
      input: firstInput,
      instructions:
        `Call ${HOSTED_INFERENCE_VERIFICATION_TOOL_NAME} exactly once with the supplied nonce. Do not answer with text.`,
      max_output_tokens: 256,
      model: buildHostedCustomInferenceModelAlias(target.revision),
      tool_choice: {
        name: HOSTED_INFERENCE_VERIFICATION_TOOL_NAME,
        type: "function",
      },
      tools: [buildVerificationTool()],
    },
    deadlineAt,
    signal,
    target,
    upstreamFetchImpl: input.upstreamFetchImpl,
  });
  const call = requireVerificationToolCall(toolResponse);

  const finalResponse = await sendVerificationRequest({
    body: {
      input: [
        ...firstInput,
        {
          arguments: call.arguments,
          call_id: call.callId,
          name: HOSTED_INFERENCE_VERIFICATION_TOOL_NAME,
          type: "function_call",
        },
        {
          call_id: call.callId,
          output: JSON.stringify({
            nonce: HOSTED_INFERENCE_VERIFICATION_TOOL_NONCE,
            ok: true,
          }),
          type: "function_call_output",
        },
        {
          content: [{
            text:
              `Return exactly ${HOSTED_INFERENCE_VERIFICATION_FINAL_NONCE} and nothing else.`,
            type: "input_text",
          }],
          role: "user",
          type: "message",
        },
      ],
      max_output_tokens: 64,
      model: buildHostedCustomInferenceModelAlias(target.revision),
      tool_choice: "none",
      tools: [buildVerificationTool()],
    },
    deadlineAt,
    signal,
    target,
    upstreamFetchImpl: input.upstreamFetchImpl,
  });
  requireExactVerificationText(
    finalResponse,
    HOSTED_INFERENCE_VERIFICATION_FINAL_NONCE,
  );

  if (target.supportsImages) {
    const imageResponse = await sendVerificationRequest({
      body: {
        input: [{
          content: [
            {
              image_url: HOSTED_INFERENCE_VERIFICATION_IMAGE_DATA_URL,
              type: "input_image",
            },
            {
              text:
                `This is a synthetic one-pixel image. Return exactly ${HOSTED_INFERENCE_VERIFICATION_IMAGE_NONCE} and nothing else.`,
              type: "input_text",
            },
          ],
          role: "user",
          type: "message",
        }],
        max_output_tokens: 64,
        model: buildHostedCustomInferenceModelAlias(target.revision),
      },
      deadlineAt,
      signal,
      target,
      upstreamFetchImpl: input.upstreamFetchImpl,
    });
    requireExactVerificationText(
      imageResponse,
      HOSTED_INFERENCE_VERIFICATION_IMAGE_NONCE,
    );
  }

  return {
    verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
    verified: true,
  };
}

function buildVerificationTarget(
  request: CloudflareHostedInferenceVerificationRequest,
): HostedInferenceRuntimeTarget {
  return {
    ...request,
    revision: HOSTED_INFERENCE_VERIFICATION_REVISION,
    schema: HOSTED_INFERENCE_RUNTIME_TARGET_SCHEMA,
    verificationProfile: HOSTED_CUSTOM_INFERENCE_VERIFICATION_PROFILE,
  };
}

function buildToolProbeInput(): Record<string, unknown>[] {
  return [{
    content: [{
      text:
        `Use the verification tool with nonce ${HOSTED_INFERENCE_VERIFICATION_TOOL_NONCE}.`,
      type: "input_text",
    }],
    role: "user",
    type: "message",
  }];
}

function buildVerificationTool(): Record<string, unknown> {
  return {
    description: "Validates the synthetic Murph custom-inference tool loop.",
    name: HOSTED_INFERENCE_VERIFICATION_TOOL_NAME,
    parameters: {
      additionalProperties: false,
      properties: {
        nonce: {
          const: HOSTED_INFERENCE_VERIFICATION_TOOL_NONCE,
          type: "string",
        },
      },
      required: ["nonce"],
      type: "object",
    },
    strict: true,
    type: "function",
  };
}

async function sendVerificationRequest(input: {
  body: Record<string, unknown>;
  deadlineAt: number;
  signal: AbortSignal;
  target: HostedInferenceRuntimeTarget;
  upstreamFetchImpl?: typeof fetch;
}): Promise<Record<string, unknown>> {
  const remainingMs = input.deadlineAt - Date.now();
  if (input.signal.aborted || remainingMs <= 0) {
    throw new HostedInferenceVerificationError();
  }
  const response = await fetchVerificationUpstream({
    body: input.body,
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(Math.min(
        HOSTED_INFERENCE_VERIFICATION_TIMEOUT_MS,
        remainingMs,
      )),
    ]),
    target: input.target,
    upstreamFetchImpl: input.upstreamFetchImpl,
  });
  try {
    const adapted = await adaptHostedCustomInferenceUpstreamResponse({
      protocol: input.target.protocol,
      response,
      revision: input.target.revision,
    });
    if (!adapted.ok) {
      await adapted.body?.cancel();
      throw new HostedInferenceVerificationError();
    }

    const stream = await readBoundedText(
      adapted.body,
      HOSTED_INFERENCE_VERIFICATION_RESPONSE_MAX_BYTES,
    );
    return requireCompletedResponse(stream);
  } catch {
    throw new HostedInferenceVerificationError();
  }
}

async function fetchVerificationUpstream(input: {
  body: Record<string, unknown>;
  signal: AbortSignal;
  target: HostedInferenceRuntimeTarget;
  upstreamFetchImpl?: typeof fetch;
}): Promise<Response> {
  let body: string;
  try {
    body = buildHostedCustomInferenceUpstreamRequestBody({
      body: new TextEncoder().encode(JSON.stringify(input.body)).buffer,
      target: input.target,
    });
  } catch (error) {
    if (error instanceof HostedCustomInferenceRequestError) {
      throw new HostedInferenceVerificationError();
    }
    throw error;
  }
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
  });
  injectHostedCustomInferenceAuth(headers, input.target);
  try {
    return await (input.upstreamFetchImpl ?? fetch)(
      new Request(input.target.endpointUrl, {
        body,
        headers,
        method: "POST",
        redirect: "manual",
        signal: input.signal,
      }),
    );
  } catch {
    throw new HostedInferenceVerificationError();
  }
}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  limitBytes: number,
): Promise<string> {
  if (!body) throw new HostedInferenceVerificationError();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > limitBytes) throw new HostedInferenceVerificationError();
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function requireCompletedResponse(stream: string): Record<string, unknown> {
  let completed: Record<string, unknown> | null = null;
  for (const block of stream.replaceAll("\r\n", "\n").split("\n\n")) {
    if (!block.trim()) continue;
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new HostedInferenceVerificationError();
    }
    if (
      isRecord(parsed)
      && parsed.type === "response.completed"
      && isRecord(parsed.response)
    ) {
      completed = parsed.response;
    }
  }
  if (!completed) throw new HostedInferenceVerificationError();
  return completed;
}

function requireVerificationToolCall(response: Record<string, unknown>): {
  arguments: string;
  callId: string;
} {
  if (!Array.isArray(response.output)) {
    throw new HostedInferenceVerificationError();
  }
  const calls = response.output.filter(
    (item): item is Record<string, unknown> =>
      isRecord(item) && item.type === "function_call",
  );
  if (calls.length !== 1) throw new HostedInferenceVerificationError();
  const call = calls[0];
  if (
    call.name !== HOSTED_INFERENCE_VERIFICATION_TOOL_NAME
    || typeof call.call_id !== "string"
    || typeof call.arguments !== "string"
  ) {
    throw new HostedInferenceVerificationError();
  }
  let args: unknown;
  try {
    args = JSON.parse(call.arguments);
  } catch {
    throw new HostedInferenceVerificationError();
  }
  if (
    !isRecord(args)
    || args.nonce !== HOSTED_INFERENCE_VERIFICATION_TOOL_NONCE
  ) {
    throw new HostedInferenceVerificationError();
  }
  return {
    arguments: call.arguments,
    callId: call.call_id,
  };
}

function requireExactVerificationText(
  response: Record<string, unknown>,
  expected: string,
): void {
  if (!Array.isArray(response.output)) {
    throw new HostedInferenceVerificationError();
  }
  const text = response.output
    .flatMap((item) =>
      isRecord(item) && item.type === "message" && Array.isArray(item.content)
        ? item.content
        : []
    )
    .map((part) =>
      isRecord(part) && part.type === "output_text" && typeof part.text === "string"
        ? part.text
        : ""
    )
    .join("")
    .trim();
  if (text !== expected) throw new HostedInferenceVerificationError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
