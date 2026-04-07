import { createHostedExecutionVercelOidcBearerTokenProvider } from "./auth-adapter";
import { readHostedExecutionControlBaseUrl } from "./environment";
import { createHostedExecutionWebJsonRequester } from "./request-client";
import { hostedOnboardingError } from "../hosted-onboarding/errors";

export interface HostedPendingUsageClient {
  deletePendingUsage(userId: string, usageIds: readonly string[]): Promise<void>;
  getPendingUsage(userId: string, limit?: number): Promise<Record<string, unknown>[]>;
  getPendingUsageDirtyUsers(limit?: number): Promise<string[]>;
}

export function requireHostedPendingUsageClient(): HostedPendingUsageClient {
  const baseUrl = readHostedExecutionControlBaseUrl();

  if (!baseUrl) {
    throw hostedOnboardingError({
      code: "HOSTED_EXECUTION_CONTROL_NOT_CONFIGURED",
      message: "Hosted execution control is not configured yet. Contact support to finish setup.",
      httpStatus: 500,
    });
  }

  const requester = createHostedExecutionWebJsonRequester({
    baseUrl,
    getBearerToken: createHostedExecutionVercelOidcBearerTokenProvider(),
  });

  return {
    async deletePendingUsage(userId, usageIds) {
      await requester.requestJson({
        body: JSON.stringify({ usageIds: [...usageIds] }),
        label: "delete pending usage",
        method: "DELETE",
        parse: () => undefined,
        path: buildHostedPendingUsagePath(userId),
      });
    },
    async getPendingUsage(userId, limit) {
      const search = typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? new URLSearchParams({ limit: String(Math.floor(limit)) }).toString()
        : null;

      const response = await requester.requestJson({
        label: "pending usage",
        method: "GET",
        parse: parsePendingUsageRecords,
        path: buildHostedPendingUsagePath(userId),
        search,
      });

      return response ?? [];
    },
    async getPendingUsageDirtyUsers(limit) {
      const search = typeof limit === "number" && Number.isFinite(limit) && limit > 0
        ? new URLSearchParams({ limit: String(Math.floor(limit)) }).toString()
        : null;

      const response = await requester.requestJson({
        label: "pending usage dirty users",
        method: "GET",
        parse: parsePendingUsageDirtyUsers,
        path: buildHostedPendingUsageUsersPath(),
        search,
      });

      return response ?? [];
    },
  };
}

function buildHostedPendingUsagePath(userId: string): string {
  return `/internal/users/${encodeURIComponent(userId)}/usage/pending`;
}

function buildHostedPendingUsageUsersPath(): string {
  return "/internal/usage/pending-users";
}

function parsePendingUsageDirtyUsers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Pending usage dirty users response must be an array.");
  }

  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new TypeError(`Pending usage dirty users[${index}] must be a non-empty string.`);
    }

    return entry;
  });
}

function parsePendingUsageRecords(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Pending usage response must be an array.");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError(`Pending usage[${index}] must be an object.`);
    }

    return structuredClone(entry as Record<string, unknown>);
  });
}
