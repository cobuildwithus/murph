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
  PhoneCallRuntime,
  PhoneCallRuntimeStartResult,
} from "./types";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

const RETELL_API_BASE_URL = "https://api.retellai.com";
const RETELL_START_TIMEOUT_MS = 15_000;
const RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING = "basic_attributes_only";
const RETELL_WEBHOOK_PATH = "/api/retell/webhook";
const RETELL_PUBLIC_BASE_DYNAMIC_VARIABLE = "murph_public_base_url";
const RETELL_WEBHOOK_EVENTS = ["call_ended", "call_analyzed"] as const;

export function createRetellPhoneCallRuntime(input: {
  fetchImpl?: typeof fetch;
} = {}): PhoneCallRuntime {
  return new RetellPhoneCallRuntime(input.fetchImpl);
}

class RetellPhoneCallRuntime implements PhoneCallRuntime {
  constructor(private readonly fetchImpl: typeof fetch | undefined) {}

  async start(call: HostedPhoneCallRuntimeRecord): Promise<PhoneCallRuntimeStartResult> {
    const params = buildRetellCreatePhoneCallRequest(call);
    const client = this.buildClient();
    const response = await client.call.createPhoneCall(params);

    const providerCallId = readRetellProviderCallId(response.call_id);
    if (!providerCallId) {
      throw new TypeError("Retell create phone call returned no call_id.");
    }
    const storageSetting = readRetellDataStorageSetting(response.data_storage_setting);
    if (storageSetting !== RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING) {
      throw buildRetellStorageModeMismatchError({
        storageSetting,
        stopFailure: await this.stopCallBestEffort(client, providerCallId),
      });
    }

    return { providerCallId };
  }

  private buildClient(): Retell {
    const options: ClientOptions = {
      apiKey: requireEnv("RETELL_API_KEY"),
      baseURL: RETELL_API_BASE_URL,
      fetchOptions: { redirect: "error" },
      maxRetries: 0,
      timeout: RETELL_START_TIMEOUT_MS,
    };
    if (this.fetchImpl) {
      options.fetch = this.fetchImpl as ClientOptions["fetch"];
    }
    return new Retell(options);
  }

  private async stopCallBestEffort(
    client: Retell,
    providerCallId: string,
  ): Promise<RetellStopCallFailure | null> {
    try {
      await client.call.stop(providerCallId);
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
  const agentOverride = buildRetellAgentOverride(publicBaseOrigin);

  return {
    from_number: requireEnv("RETELL_FROM_NUMBER"),
    to_number: call.brief.to.phoneNumber,
    override_agent_id: call.retellAgentId?.trim() || requireEnv("RETELL_AGENT_ID"),
    override_agent_version: call.retellAgentVersion?.trim()
      || process.env.RETELL_AGENT_VERSION?.trim()
      || "prod",
    ...(agentOverride ? { agent_override: agentOverride } : {}),
    metadata: {
      murph_phone_call_id: call.id,
    },
    retell_llm_dynamic_variables: buildRetellDynamicVariables(call, publicBaseOrigin),
  };
}

type RetellAgentOverride = NonNullable<CallCreatePhoneCallParams["agent_override"]>;

function buildRetellAgentOverride(publicBaseOrigin: string | null): RetellAgentOverride | null {
  if (!publicBaseOrigin) {
    return null;
  }

  return {
    agent: {
      webhook_events: [...RETELL_WEBHOOK_EVENTS],
      webhook_url: buildRetellCallbackUrl(publicBaseOrigin, RETELL_WEBHOOK_PATH),
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
  const target = brief.to.label?.trim() || "there";
  return `Hi, this is Murph, an AI assistant calling on the user's behalf. I'm calling ${target} to ${brief.goal}`;
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
