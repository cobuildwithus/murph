import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import type {
  HostedPhoneCallRuntimeRecord,
  PhoneCallRuntime,
  PhoneCallRuntimeStartResult,
} from "./types";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

const RETELL_CREATE_PHONE_CALL_URL = "https://api.retellai.com/v2/create-phone-call";
const RETELL_STOP_CALL_URL_BASE = "https://api.retellai.com/v2/stop-call";
const RETELL_START_TIMEOUT_MS = 15_000;
const RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING = "basic_attributes_only";

export function createRetellPhoneCallRuntime(input: {
  fetchImpl?: typeof fetch;
} = {}): PhoneCallRuntime {
  return new RetellPhoneCallRuntime(input.fetchImpl ?? fetch);
}

class RetellPhoneCallRuntime implements PhoneCallRuntime {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async start(call: HostedPhoneCallRuntimeRecord): Promise<PhoneCallRuntimeStartResult> {
    const response = await this.fetchImpl(RETELL_CREATE_PHONE_CALL_URL, {
      body: JSON.stringify(buildRetellCreatePhoneCallRequest(call)),
      headers: {
        authorization: `Bearer ${requireEnv("RETELL_API_KEY")}`,
        "content-type": "application/json",
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(RETELL_START_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Retell create phone call failed with HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const providerCallId = readProviderCallId(payload);
    if (!providerCallId) {
      throw new TypeError("Retell create phone call returned no call_id.");
    }
    const storageSetting = readRetellDataStorageSetting(payload);
    if (storageSetting !== RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING) {
      throw buildRetellStorageModeMismatchError({
        storageSetting,
        stopFailure: await this.stopCallBestEffort(providerCallId),
      });
    }

    return { providerCallId };
  }

  private async stopCallBestEffort(
    providerCallId: string,
  ): Promise<RetellStopCallFailure | null> {
    try {
      const response = await this.fetchImpl(readRetellStopCallUrl(providerCallId), {
        headers: {
          authorization: `Bearer ${requireEnv("RETELL_API_KEY")}`,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(RETELL_START_TIMEOUT_MS),
      });
      if (!response.ok) {
        return {
          statusCode: response.status,
          type: "retell_storage_mismatch_stop_http_failed",
        };
      }
      return null;
    } catch {
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

function buildRetellCreatePhoneCallRequest(call: HostedPhoneCallRuntimeRecord): Record<string, unknown> {
  assertRetellAgentDataStorageSetting();

  return {
    from_number: requireEnv("RETELL_FROM_NUMBER"),
    to_number: call.brief.to.phoneNumber,
    override_agent_id: requireEnv("RETELL_AGENT_ID"),
    override_agent_version: process.env.RETELL_AGENT_VERSION?.trim() || "prod",
    agent_override: {
      metadata: {
        murph_phone_call_id: call.id,
      },
      retell_llm_dynamic_variables: buildRetellDynamicVariables(call),
    },
  };
}

function assertRetellAgentDataStorageSetting(): void {
  const value = process.env.RETELL_AGENT_DATA_STORAGE_SETTING?.trim().toLowerCase();
  if (value !== RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING) {
    throw new TypeError(
      `RETELL_AGENT_DATA_STORAGE_SETTING must be ${RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING} for Retell phone calls.`,
    );
  }
}

function buildRetellDynamicVariables(call: HostedPhoneCallRuntimeRecord): Record<string, string> {
  const brief = call.brief;
  return {
    call_brief: JSON.stringify(brief),
    murph_timezone: brief.timeZone,
    opening_line: renderOpeningLine(brief),
    transfer_number: brief.allowTransferToUser
      ? call.transferNumber ?? ""
      : "",
  };
}

function renderOpeningLine(brief: HostedPhoneCallBrief): string {
  const target = brief.to.label?.trim() || "there";
  return `Hi, this is Murph, an AI assistant calling on the user's behalf. I'm calling ${target} to ${brief.goal}`;
}

function readRetellStopCallUrl(providerCallId: string): string {
  return `${RETELL_STOP_CALL_URL_BASE}/${encodeURIComponent(providerCallId)}`;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new TypeError(`${name} must be configured for Retell phone calls.`);
  }
  return value;
}

function readProviderCallId(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const callId = (value as Record<string, unknown>).call_id;
  return typeof callId === "string" && callId.trim() ? callId.trim() : null;
}

function readRetellDataStorageSetting(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const setting = (value as Record<string, unknown>).data_storage_setting;
  return typeof setting === "string" && setting.trim()
    ? setting.trim().toLowerCase()
    : null;
}

function formatRetellStorageSetting(value: string | null): string {
  return value ?? "missing";
}
