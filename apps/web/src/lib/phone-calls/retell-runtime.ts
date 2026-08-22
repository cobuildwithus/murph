import {
  Retell,
  UnprocessableEntityError,
} from "retell-sdk";
import type { ClientOptions } from "retell-sdk";
import type {
  CallCreatePhoneCallParams,
} from "retell-sdk/resources/call";

import type {
  HostedPhoneCallProviderUsageResolution,
  HostedPhoneCallRuntimeRecord,
  PhoneCallRuntime,
  PhoneCallRuntimeReconciliationResult,
  PhoneCallRuntimeStartResult,
  PhoneCallRuntimeStopDisposition,
} from "./types";
import { readRetellTerminalProviderUsage } from "./usage";
import { markPhoneCallRuntimeNoActiveEffect } from "./types";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import {
  hasRetellBasicAttributesOnlyStorage,
  readRetellTransferEndAt,
  type RetellCallPayload,
} from "./retell-payloads";

const RETELL_API_BASE_URL = "https://api.retellai.com";
const RETELL_START_TIMEOUT_MS = 15_000;
const RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING = "basic_attributes_only";
const RETELL_WEBHOOK_PATH = "/api/retell/webhook";
const RETELL_PUBLIC_BASE_DYNAMIC_VARIABLE = "murph_public_base_url";
const RETELL_WEBHOOK_EVENTS = ["call_ended", "call_analyzed", "transfer_ended"] as const;
const RETELL_MISSING_ASSET_MESSAGE =
  "Cannot find requested asset under given api key.";

export function createRetellPhoneCallRuntime(input: {
  fetchImpl?: typeof fetch;
} = {}): PhoneCallRuntime {
  return new RetellPhoneCallRuntime(input.fetchImpl);
}

export interface RetellPhoneCallAccountDeletionRuntime {
  deleteProviderCall(
    providerCallId: string,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
  resolveProviderCall(
    murphPhoneCallId: string,
    options?: { signal?: AbortSignal },
  ): Promise<PhoneCallRuntimeReconciliationResult>;
}

export function createRetellPhoneCallAccountDeletionRuntime(input: {
  fetchImpl?: typeof fetch;
} = {}): RetellPhoneCallAccountDeletionRuntime {
  return new RetellPhoneCallRuntime(input.fetchImpl);
}

class RetellPhoneCallRuntime implements PhoneCallRuntime, RetellPhoneCallAccountDeletionRuntime {
  constructor(private readonly fetchImpl: typeof fetch | undefined) {}

  async start(
    call: HostedPhoneCallRuntimeRecord,
    options: { signal?: AbortSignal } = {},
  ): Promise<PhoneCallRuntimeStartResult> {
    let params: CallCreatePhoneCallParams;
    let client: Retell;
    try {
      params = buildRetellCreatePhoneCallRequest(call);
      client = this.buildClient();
    } catch (error) {
      throw markPhoneCallRuntimeNoActiveEffect(error);
    }

    try {
      options.signal?.throwIfAborted();
    } catch (error) {
      throw markPhoneCallRuntimeNoActiveEffect(error);
    }
    const response: Awaited<ReturnType<typeof client.call.createPhoneCall>> =
      await client.call.createPhoneCall(params, {
        signal: options.signal,
      });

    const providerCallId = readRetellProviderCallId(response.call_id);
    if (!providerCallId) {
      throw new TypeError("Retell create phone call returned no call_id.");
    }
    const storageSetting = readRetellDataStorageSetting(response.data_storage_setting);
    if (storageSetting !== RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING) {
      const error = buildRetellStorageModeMismatchError({
        storageSetting,
      });
      return {
        cleanupRequired: true,
        error,
        providerCallId,
      };
    }

    return { providerCallId };
  }

  async resolveProviderCall(
    murphPhoneCallId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<PhoneCallRuntimeReconciliationResult> {
    options.signal?.throwIfAborted();
    const client = this.buildClient();
    const response = await client.call.list({
      filter_criteria: {
        metadata: [{
          key: "murph_phone_call_id",
          op: "eq",
          type: "string",
          value: murphPhoneCallId,
        }],
      },
      limit: 2,
      sort_order: "descending",
    }, {
      signal: options.signal,
    });
    const calls = response.items ?? [];
    if (
      response.has_more === true
      || calls.length > 1
      || calls.some((call) => readRetellMurphPhoneCallId(call.metadata) !== murphPhoneCallId)
    ) {
      throw new Error("Retell provider reconciliation returned ambiguous call authority.");
    }
    const call = calls[0];
    if (!call) {
      return { state: "not_found" };
    }

    const providerCallId = readRetellProviderCallId(call.call_id);
    if (!providerCallId) {
      throw new TypeError("Retell provider reconciliation returned no call_id.");
    }
    const storageSetting = readRetellDataStorageSetting(call.data_storage_setting);
    if (storageSetting === RETELL_BASIC_ATTRIBUTES_ONLY_STORAGE_SETTING) {
      return {
        providerCallId,
        state: "found",
      };
    }

    return {
      providerCallId,
      state: "cleanup_required",
    };
  }

  async resolveTerminalUsage(
    providerCallId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<HostedPhoneCallProviderUsageResolution> {
    const client = this.buildClient();
    const call = await client.call.retrieve(providerCallId, {
      signal: options.signal,
    });
    if (call.call_status === "registered" || call.call_status === "ongoing") {
      return { state: "pending" };
    }

    const terminalCall: RetellCallPayload = {
      call_id: call.call_id,
      ...(call.call_cost
        ? { call_cost: { combined_cost: call.call_cost.combined_cost } }
        : {}),
      ...(call.data_storage_setting
        ? { data_storage_setting: call.data_storage_setting }
        : {}),
      ...(call.disconnection_reason
        ? { disconnection_reason: call.disconnection_reason }
        : {}),
      ...(call.duration_ms === undefined ? {} : { duration_ms: call.duration_ms }),
      ...(call.end_timestamp === undefined ? {} : { end_timestamp: call.end_timestamp }),
      ...(call.transfer_end_timestamp === undefined
        ? {}
        : { transfer_end_timestamp: call.transfer_end_timestamp }),
    };
    const resolution = readRetellTerminalProviderUsage(terminalCall);
    if (resolution.state === "pending") {
      return resolution;
    }

    const transferEndedAt = readRetellTransferEndAt(terminalCall);
    if (
      terminalCall.disconnection_reason?.trim().toLowerCase() !== "call_transfer"
      || !transferEndedAt
    ) {
      return resolution;
    }
    if (!hasRetellBasicAttributesOnlyStorage(terminalCall)) {
      throw new TypeError(
        "Retell terminal transfer must use basic_attributes_only storage.",
      );
    }

    return {
      ...resolution,
      terminalTransfer: {
        endedAt: transferEndedAt,
        providerCallId: resolution.usage.providerCallId,
      },
    };
  }

  async deleteProviderCall(
    providerCallId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<void> {
    const client = this.buildClient();
    let call: Awaited<ReturnType<typeof client.call.retrieve>>;
    try {
      call = await client.call.retrieve(providerCallId, {
        signal: options.signal,
      });
    } catch (error) {
      if (isRetellMissingCallError(error)) {
        return;
      }
      throw error;
    }
    if (call.call_status === "registered" || call.call_status === "ongoing") {
      try {
        await client.call.stop(providerCallId, {
          signal: options.signal,
        });
      } catch (error) {
        if (isRetellMissingCallError(error)) {
          return;
        }
        throw error;
      }
    }
    try {
      await client.call.delete(providerCallId, {
        signal: options.signal,
      });
    } catch (error) {
      if (!isRetellMissingCallError(error)) {
        throw error;
      }
    }
  }

  async stopIfActive(
    providerCallId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<PhoneCallRuntimeStopDisposition> {
    const client = this.buildClient();
    let call: Awaited<ReturnType<typeof client.call.retrieve>>;
    try {
      call = await client.call.retrieve(providerCallId, {
        signal: options.signal,
      });
    } catch (error) {
      if (isRetellMissingCallError(error)) {
        return "already_terminal";
      }
      throw error;
    }
    if (call.call_status === "registered" || call.call_status === "ongoing") {
      try {
        await client.call.stop(providerCallId, {
          signal: options.signal,
        });
        return "stopped";
      } catch (error) {
        if (isRetellMissingCallError(error)) {
          return "already_terminal";
        }
        throw error;
      }
    }
    return "already_terminal";
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

}

function isRetellMissingCallError(error: unknown): boolean {
  if (!(error instanceof UnprocessableEntityError)) {
    return false;
  }

  const responseBody = error.error;
  return typeof responseBody === "object"
    && responseBody !== null
    && Reflect.get(responseBody, "message") === RETELL_MISSING_ASSET_MESSAGE;
}

function buildRetellStorageModeMismatchError(input: {
  storageSetting: string | null;
}): Error {
  return hostedOnboardingError({
    code: "RETELL_STORAGE_MODE_MISMATCH",
    details: {
      code: "retell_storage_mode_mismatch",
      operationName: "retell.create_phone_call",
      storageMode: formatRetellStorageSetting(input.storageSetting),
      type: formatRetellStorageSetting(input.storageSetting),
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

  const params: CallCreatePhoneCallParams = {
    from_number: requireEnv("RETELL_FROM_NUMBER"),
    to_number: call.brief.to.phoneNumber,
    override_agent_id: requireEnv("RETELL_AGENT_ID"),
    override_agent_version: process.env.RETELL_AGENT_VERSION?.trim() || "prod",
    metadata: {
      murph_phone_call_id: call.id,
    },
    retell_llm_dynamic_variables: buildRetellDynamicVariables(call, publicBaseOrigin),
  };
  if (agentOverride) {
    params.agent_override = agentOverride;
  }
  return params;
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

function readRetellMurphPhoneCallId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const value = Reflect.get(metadata, "murph_phone_call_id");
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
