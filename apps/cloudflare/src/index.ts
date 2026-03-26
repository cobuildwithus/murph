import type {
  HostedExecutionBundleRef,
  HostedExecutionDispatchRequest,
  HostedExecutionRunnerResult,
} from "@healthybob/runtime-state";

import { readHostedExecutionSignatureHeaders, verifyHostedExecutionSignature } from "./auth.js";
import { readHostedExecutionEnvironment } from "./env.js";
import { json, readJsonObject } from "./json.js";
import { parseHostedUserEnvUpdate } from "./user-env.js";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "./user-runner.js";

interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  getByName(name: string): DurableObjectStubLike;
}

interface WorkerEnvironmentSource {
  BUNDLES: import("./bundle-store.js").R2BucketLike;
  HB_HOSTED_BUNDLE_KEY?: string;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_KEYS?: string;
  HOSTED_EXECUTION_ALLOWED_USER_ENV_PREFIXES?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID?: string;
  HOSTED_EXECUTION_CLOUDFLARE_BASE_URL?: string;
  HOSTED_EXECUTION_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS?: string;
  HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS?: string;
  HOSTED_EXECUTION_RETRY_DELAY_MS?: string;
  HOSTED_EXECUTION_RUNNER_BASE_URL?: string;
  HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_RUNNER_TIMEOUT_MS?: string;
  HOSTED_EXECUTION_SIGNING_SECRET?: string;
  HOSTED_EXECUTION_CLOUDFLARE_SIGNING_SECRET?: string;
  USER_RUNNER: DurableObjectNamespaceLike;
}

export default {
  async fetch(request: Request, env: WorkerEnvironmentSource): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "cloudflare-hosted-runner",
        });
      }

      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          service: "cloudflare-hosted-runner",
        });
      }

      const environment = readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      );

      const runnerCommitMatch = url.pathname.match(
        /^\/internal\/runner-events\/([^/]+)\/([^/]+)\/commit$/u,
      );

      if (runnerCommitMatch && request.method === "POST") {
        if (environment.runnerControlToken) {
          const authorization = request.headers.get("authorization");

          if (authorization !== `Bearer ${environment.runnerControlToken}`) {
            return json({ error: "Unauthorized" }, 401);
          }
        }

        const [, userId, eventId] = runnerCommitMatch;
        const payload = parseHostedExecutionCommitRequest(await readJsonObject(request));
        return env.USER_RUNNER.getByName(decodeURIComponent(userId)).fetch(
          new Request(
            `https://runner.internal/commit?eventId=${encodeURIComponent(decodeURIComponent(eventId))}&userId=${encodeURIComponent(decodeURIComponent(userId))}`,
            {
              body: JSON.stringify(payload),
              method: "POST",
            },
          ),
        );
      }

      if (
        request.method === "POST"
        && (url.pathname === "/internal/dispatch" || url.pathname === "/internal/events")
      ) {
        const payload = await request.text();
        const { signature, timestamp } = readHostedExecutionSignatureHeaders(request.headers);
        const verified = await verifyHostedExecutionSignature({
          payload,
          secret: environment.dispatchSigningSecret,
          signature,
          timestamp,
        });

        if (!verified) {
          return json({ error: "Unauthorized" }, 401);
        }

        const dispatch = JSON.parse(payload) as HostedExecutionDispatchRequest;
        const response = await env.USER_RUNNER
          .getByName(dispatch.event.userId)
          .fetch(new Request("https://runner.internal/dispatch", {
            body: payload,
            method: "POST",
          }));

        return response;
      }

      const match = url.pathname.match(/^\/internal\/users\/([^/]+)\/(run|status|env)$/u);

      if (match) {
        if (environment.controlToken) {
          const authorization = request.headers.get("authorization");

          if (authorization !== `Bearer ${environment.controlToken}`) {
            return json({ error: "Unauthorized" }, 401);
          }
        }

        const [, userId, action] = match;
        const decodedUserId = decodeURIComponent(userId);
        const forwarded = await buildDurableObjectControlRequest({
          action,
          request,
          userId: decodedUserId,
        });

        if (forwarded instanceof Response) {
          return forwarded;
        }

        return env.USER_RUNNER.getByName(decodedUserId).fetch(forwarded);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  },
};

export class UserRunnerDurableObject {
  private readonly runner: HostedUserRunner;

  constructor(state: DurableObjectStateLike, env: WorkerEnvironmentSource) {
    this.runner = new HostedUserRunner(
      state,
      readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      ),
      env.BUNDLES,
    );
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/dispatch") {
      const dispatch = JSON.parse(await request.text()) as HostedExecutionDispatchRequest;
      const status = await this.runner.dispatch(dispatch);

      return isBackpressuredStatus(status, dispatch.eventId)
        ? json(status, 429)
        : json(status);
    }

    if (request.method === "POST" && url.pathname === "/commit") {
      const userId = url.searchParams.get("userId");
      const eventId = url.searchParams.get("eventId");

      if (!userId || !eventId) {
        return json({ error: "userId and eventId are required." }, 400);
      }

      return json({
        committed: await this.runner.commit({
          eventId,
          payload: parseHostedExecutionCommitRequest(await readJsonObject(request)),
          userId,
        }),
        ok: true,
      });
    }

    if (request.method === "POST" && url.pathname === "/run") {
      const body = await readJsonObject(request);
      const userId = typeof body.userId === "string" ? body.userId : null;

      if (!userId) {
        return json({ error: "userId is required." }, 400);
      }

      const dispatch: HostedExecutionDispatchRequest = {
        event: {
          kind: "assistant.cron.tick",
          reason: "manual",
          userId,
        },
        eventId: `manual:${Date.now()}`,
        occurredAt: new Date().toISOString(),
      };
      const status = await this.runner.run(dispatch);

      return isBackpressuredStatus(status, dispatch.eventId)
        ? json(status, 429)
        : json(status);
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const userId = url.searchParams.get("userId") ?? "unknown";
      return json(await this.runner.status(userId));
    }

    if (url.pathname === "/env") {
      const userId = url.searchParams.get("userId");

      if (!userId) {
        return json({ error: "userId is required." }, 400);
      }

      if (request.method === "GET") {
        return json(await this.runner.getUserEnvStatus(userId));
      }

      if (request.method === "PUT") {
        return json(
          await this.runner.updateUserEnv(
            userId,
            parseHostedUserEnvUpdate(await readJsonObject(request)),
          ),
        );
      }

      if (request.method === "DELETE") {
        return json(await this.runner.clearUserEnv(userId));
      }
    }

    return json({ error: "Not found" }, 404);
  }

  async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

async function buildDurableObjectControlRequest(input: {
  action: string;
  request: Request;
  userId: string;
}): Promise<Request | Response> {
  switch (input.action) {
    case "status":
      if (input.request.method !== "GET") {
        return json({ error: "Method not allowed." }, 405);
      }

      return new Request(`https://runner.internal/status?userId=${encodeURIComponent(input.userId)}`, {
        method: "GET",
      });
    case "run": {
      if (input.request.method !== "POST") {
        return json({ error: "Method not allowed." }, 405);
      }

      const body = {
        ...(await readOptionalJsonObject(input.request)),
        userId: input.userId,
      };

      return new Request("https://runner.internal/run", {
        body: JSON.stringify(body),
        method: "POST",
      });
    }
    case "env": {
      const url = `https://runner.internal/env?userId=${encodeURIComponent(input.userId)}`;

      if (input.request.method === "GET" || input.request.method === "DELETE") {
        return new Request(url, {
          method: input.request.method,
        });
      }

      if (input.request.method !== "PUT") {
        return json({ error: "Method not allowed." }, 405);
      }

      return new Request(url, {
        body: JSON.stringify(await readOptionalJsonObject(input.request)),
        method: "PUT",
      });
    }
    default:
      return json({ error: "Not found" }, 404);
  }
}

function parseHostedExecutionCommitRequest(payload: Record<string, unknown>): HostedExecutionRunnerResult & {
  currentBundleRefs: {
    agentState: HostedExecutionBundleRef | null;
    vault: HostedExecutionBundleRef | null;
  };
} {
  const bundles = requireRecord(payload.bundles, "bundles");
  const result = requireRecord(payload.result, "result");

  return {
    bundles: {
      agentState: readHostedBundleBase64Value(bundles.agentState, "bundles.agentState"),
      vault: readHostedBundleBase64Value(bundles.vault, "bundles.vault"),
    },
    currentBundleRefs: readCommittedBundleRefs(payload.currentBundleRefs),
    result: {
      eventsHandled: requireNumber(result.eventsHandled, "result.eventsHandled"),
      summary: requireString(result.summary, "result.summary"),
    },
  };
}

function isBackpressuredStatus(
  status: { backpressuredEventIds?: string[] },
  eventId: string,
): boolean {
  return status.backpressuredEventIds?.includes(eventId) ?? false;
}

function readCommittedBundleRefs(value: unknown): {
  agentState: HostedExecutionBundleRef | null;
  vault: HostedExecutionBundleRef | null;
} {
  const record = requireRecord(value, "currentBundleRefs");

  return {
    agentState: readHostedBundleRef(record.agentState),
    vault: readHostedBundleRef(record.vault),
  };
}

function readHostedBundleRef(value: unknown): HostedExecutionBundleRef | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new TypeError("Commit bundle refs must be objects or null.");
  }

  if (
    typeof value.hash !== "string"
    || typeof value.key !== "string"
    || typeof value.size !== "number"
    || typeof value.updatedAt !== "string"
  ) {
    throw new TypeError("Commit bundle refs must include hash, key, size, and updatedAt.");
  }

  return {
    hash: value.hash,
    key: value.key,
    size: value.size,
    updatedAt: value.updatedAt,
  };
}

function readHostedBundleBase64Value(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a base64 string or null.`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }

  return value;
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object.`);
  }

  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a string.`);
  }

  return value;
}


async function readOptionalJsonObject(request: Request): Promise<Record<string, unknown>> {
  const payload = await request.text();

  if (!payload.trim()) {
    return {};
  }

  const parsed = JSON.parse(payload) as unknown;

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError("Request body must be a JSON object.");
  }

  return parsed as Record<string, unknown>;
}
