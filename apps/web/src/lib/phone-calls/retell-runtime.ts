import type {
  HostedPhoneCallBrief,
} from "@murphai/hosted-execution/phone-calls";

import type {
  HostedPhoneCallRuntimeRecord,
  PhoneCallRuntime,
  PhoneCallRuntimeStartResult,
} from "./types";

const RETELL_CREATE_PHONE_CALL_URL = "https://api.retellai.com/v2/create-phone-call";
const RETELL_START_TIMEOUT_MS = 15_000;

export function createRetellPhoneCallRuntime(input: {
  fetchImpl?: typeof fetch;
} = {}): PhoneCallRuntime {
  return new RetellPhoneCallRuntime(input.fetchImpl ?? fetch);
}

class RetellPhoneCallRuntime implements PhoneCallRuntime {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async start(call: HostedPhoneCallRuntimeRecord): Promise<PhoneCallRuntimeStartResult> {
    const response = await this.fetchImpl(readRetellCreatePhoneCallUrl(), {
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

    return { providerCallId };
  }
}

function buildRetellCreatePhoneCallRequest(call: HostedPhoneCallRuntimeRecord): Record<string, unknown> {
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

function readRetellCreatePhoneCallUrl(): string {
  return process.env.RETELL_CREATE_PHONE_CALL_URL?.trim() || RETELL_CREATE_PHONE_CALL_URL;
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
