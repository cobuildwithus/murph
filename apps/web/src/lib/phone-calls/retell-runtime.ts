import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";
import {
  APIConnectionError,
  APIError,
  Retell,
} from "retell-sdk";
import type { ClientOptions } from "retell-sdk";
import type {
  CallCreatePhoneCallParams,
} from "retell-sdk/resources/call";

import type {
  HostedPhoneCallRuntimeRecord,
  PhoneCallRuntimeStartResult,
  PhoneCallRuntime,
} from "./types";
import { PhoneCallRuntimeStartRejectedError } from "./types";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

const RETELL_API_BASE_URL = "https://api.retellai.com";
const RETELL_START_TIMEOUT_MS = 15_000;
const RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING = "basic_attributes_only";
const RETELL_WEBHOOK_PATH = "/api/retell/webhook";
const RETELL_PUBLIC_BASE_DYNAMIC_VARIABLE = "murph_public_base_url";
const RETELL_WEBHOOK_EVENTS = [
  "call_ended",
  "call_analyzed",
  "transfer_bridged",
  "transfer_cancelled",
] as const;

export function createRetellPhoneCallRuntime(input: {
  fetchImpl?: typeof fetch;
} = {}): PhoneCallRuntime {
  return new RetellPhoneCallRuntime(input.fetchImpl);
}

export async function stopRetellPhoneCall(
  providerCallId: string,
  input: { fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const normalizedProviderCallId = readRetellProviderCallId(providerCallId);
  if (!normalizedProviderCallId) {
    throw new TypeError("Retell provider call id is required.");
  }
  await stopRetellCall(buildRetellClient(input.fetchImpl), normalizedProviderCallId);
}

class RetellPhoneCallRuntime implements PhoneCallRuntime {
  constructor(private readonly fetchImpl: typeof fetch | undefined) {}

  validateStart(call: HostedPhoneCallRuntimeRecord): void {
    buildRetellCreatePhoneCallRequest(call);
    buildRetellClient(this.fetchImpl);
  }

  async start(call: HostedPhoneCallRuntimeRecord): Promise<PhoneCallRuntimeStartResult> {
    const params = buildRetellCreatePhoneCallRequest(call);
    const client = buildRetellClient(this.fetchImpl);
    let response: Awaited<ReturnType<Retell["call"]["createPhoneCall"]>>;
    try {
      response = await client.call.createPhoneCall(params);
    } catch (error) {
      throw classifyRetellCreatePhoneCallError(error);
    }

    const providerCallId = readRetellProviderCallId(response.call_id);
    if (!providerCallId) {
      // A successful response can arrive after Retell created the call even when
      // its body is incomplete. Keep the local reservation recoverable by the
      // metadata callback or stale-start sweep instead of declaring rejection.
      throw new Error("Retell create phone call returned no call_id.");
    }
    const storageSetting = readRetellDataStorageSetting(response.data_storage_setting);
    if (storageSetting !== RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING) {
      const stopFailure = await this.stopCallBestEffort(client, providerCallId);
      const mismatchError = buildRetellStorageModeMismatchError({
        storageSetting,
        stopFailure,
      });
      if (stopFailure) {
        throw new PhoneCallRuntimeStartRejectedError(mismatchError.message, {
          cause: mismatchError,
          providerCallId,
        });
      }
      throw new PhoneCallRuntimeStartRejectedError(mismatchError.message, {
        cause: mismatchError,
      });
    }

    return { providerCallId };
  }

  stop(providerCallId: string): Promise<void> {
    return stopRetellPhoneCall(
      providerCallId,
      this.fetchImpl ? { fetchImpl: this.fetchImpl } : {},
    );
  }

  private async stopCallBestEffort(
    client: Retell,
    providerCallId: string,
  ): Promise<RetellStopCallFailure | null> {
    try {
      await stopRetellCall(client, providerCallId);
      return null;
    } catch (error) {
      if (error instanceof APIConnectionError) {
        return {
          type: "retell_storage_mismatch_stop_fetch_failed",
        };
      }
      if (error instanceof APIError && typeof error.status === "number") {
        return {
          statusCode: error.status,
          type: "retell_storage_mismatch_stop_http_failed",
        };
      }
      return {
        type: "retell_storage_mismatch_stop_fetch_failed",
      };
    }
  }
}

function buildRetellClient(fetchImpl: typeof fetch | undefined): Retell {
  const options: ClientOptions = {
    apiKey: requireEnv("RETELL_API_KEY"),
    baseURL: RETELL_API_BASE_URL,
    fetchOptions: { redirect: "error" },
    maxRetries: 0,
    timeout: RETELL_START_TIMEOUT_MS,
  };
  if (fetchImpl) {
    options.fetch = fetchImpl as ClientOptions["fetch"];
  }
  return new Retell(options);
}

async function stopRetellCall(client: Retell, providerCallId: string): Promise<void> {
  await client.call.stop(providerCallId);
}

function classifyRetellCreatePhoneCallError(error: unknown): unknown {
  if (
    error instanceof APIError
    && typeof error.status === "number"
    && isDefiniteRetellCreatePhoneCallRejectionStatus(error.status)
  ) {
    return new PhoneCallRuntimeStartRejectedError(
      `Retell rejected create phone call with HTTP ${error.status}.`,
      { cause: error },
    );
  }
  return error;
}

function isDefiniteRetellCreatePhoneCallRejectionStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408;
}

interface RetellStopCallFailure {
  statusCode?: number;
  type: "retell_storage_mismatch_stop_fetch_failed" | "retell_storage_mismatch_stop_http_failed";
}

function buildRetellStorageModeMismatchError(input: {
  stopFailure: RetellStopCallFailure | null;
  storageSetting: string | null;
}): Error {
  return hostedOnboardingError({
    cause: input.stopFailure
      ? new Error(input.stopFailure.statusCode
        ? `Retell stop call failed with HTTP ${input.stopFailure.statusCode}.`
        : "Retell stop call request failed.")
      : undefined,
    code: "RETELL_STORAGE_MODE_MISMATCH",
    details: {
      code: "retell_storage_mode_mismatch",
      operationName: "retell.create_phone_call",
      ...(input.stopFailure?.statusCode
        ? {
          statusCode: input.stopFailure.statusCode,
        }
        : {}),
      storageMode: formatRetellStorageSetting(input.storageSetting),
      type: input.stopFailure?.type ?? formatRetellStorageSetting(input.storageSetting),
    },
    httpStatus: 502,
    message: `Retell create phone call returned data_storage_setting ${formatRetellStorageSetting(input.storageSetting)}; expected ${RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING}.`,
    retryable: false,
  });
}

function buildRetellCreatePhoneCallRequest(call: HostedPhoneCallRuntimeRecord): CallCreatePhoneCallParams {
  assertRetellAgentDataStorageSetting();
  const publicBaseOrigin = readRetellPublicBaseOrigin();

  return {
    from_number: requireEnv("RETELL_FROM_NUMBER"),
    to_number: call.brief.to.phoneNumber,
    override_agent_id: call.retellAgentId?.trim() || requireEnv("RETELL_AGENT_ID"),
    override_agent_version: call.retellAgentVersion?.trim()
      || process.env.RETELL_AGENT_VERSION?.trim()
      || "prod",
    agent_override: buildRetellAgentOverride(publicBaseOrigin),
    metadata: {
      murph_phone_call_id: call.id,
    },
    retell_llm_dynamic_variables: buildRetellDynamicVariables(call, publicBaseOrigin),
  };
}

type RetellAgentOverride = NonNullable<CallCreatePhoneCallParams["agent_override"]>;

function buildRetellAgentOverride(publicBaseOrigin: string | null): RetellAgentOverride {
  return {
    agent: {
      webhook_events: [...RETELL_WEBHOOK_EVENTS],
      ...(publicBaseOrigin
        ? { webhook_url: buildRetellCallbackUrl(publicBaseOrigin, RETELL_WEBHOOK_PATH) }
        : {}),
    },
  };
}

function readRetellPublicBaseOrigin(): string | null {
  const value = process.env.RETELL_WEBHOOK_PUBLIC_BASE_URL?.trim();
  if (!value) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError("RETELL_WEBHOOK_PUBLIC_BASE_URL must be a valid HTTPS origin.");
  }

  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || (parsed.pathname !== "" && parsed.pathname !== "/")
  ) {
    throw new TypeError("RETELL_WEBHOOK_PUBLIC_BASE_URL must be a valid HTTPS origin.");
  }

  return parsed.origin;
}

function buildRetellCallbackUrl(publicBaseOrigin: string, pathname: string): string {
  return new URL(pathname, `${publicBaseOrigin}/`).toString();
}

function assertRetellAgentDataStorageSetting(): void {
  const value = process.env.RETELL_AGENT_DATA_STORAGE_SETTING?.trim().toLowerCase();
  if (value !== RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING) {
    throw new TypeError(
      `RETELL_AGENT_DATA_STORAGE_SETTING must be ${RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING} for Retell phone calls.`,
    );
  }
}

function buildRetellDynamicVariables(
  call: HostedPhoneCallRuntimeRecord,
  publicBaseOrigin: string | null,
): Record<string, string> {
  const brief = call.brief;
  return {
    call_brief: JSON.stringify(brief),
    murph_timezone: brief.timeZone,
    opening_line: call.openingLine?.trim() || renderOpeningLine(brief),
    ...(publicBaseOrigin
      ? {
        [RETELL_PUBLIC_BASE_DYNAMIC_VARIABLE]: publicBaseOrigin,
      }
      : {}),
    transfer_number: brief.allowTransferToUser
      ? call.transferNumber ?? ""
      : "",
  };
}

function renderOpeningLine(brief: HostedPhoneCallBrief): string {
  const goal = formatOpeningGoal(brief.goal);
  const callerName = brief.callerName?.trim();
  if (callerName) {
    return `Hi, this is Murph. I'm calling for ${callerName} to ${goal}`;
  }
  return `Hi, this is Murph. I'm calling to ${goal}`;
}

function formatOpeningGoal(goal: string): string {
  const trimmed = goal.trim();
  if (/^[A-Z][a-z]/u.test(trimmed)) {
    return `${trimmed[0]!.toLowerCase()}${trimmed.slice(1)}`;
  }
  return trimmed;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new TypeError(`${name} must be configured for Retell phone calls.`);
  }
  return value;
}

function readRetellProviderCallId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRetellDataStorageSetting(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function formatRetellStorageSetting(value: string | null): string {
  return value ?? "missing";
}
