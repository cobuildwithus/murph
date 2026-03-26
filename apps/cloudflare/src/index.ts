import type { HostedExecutionDispatchRequest } from "@healthybob/runtime-state";

import { readHostedExecutionSignatureHeaders, verifyHostedExecutionSignature } from "./auth.js";
import { readHostedExecutionEnvironment } from "./env.js";
import { json, readJsonObject } from "./json.js";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
  type DurableObjectStorageLike,
} from "./user-runner.js";

interface DurableObjectStubLike {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  getByName(name: string): DurableObjectStubLike;
}

interface WorkerEnvironmentSource {
  BUNDLES: import("./bundle-store.js").R2BucketLike;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY?: string;
  HOSTED_EXECUTION_BUNDLE_ENCRYPTION_KEY_ID?: string;
  HOSTED_EXECUTION_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_DEFAULT_ALARM_DELAY_MS?: string;
  HOSTED_EXECUTION_MAX_EVENT_ATTEMPTS?: string;
  HOSTED_EXECUTION_RETRY_DELAY_MS?: string;
  HOSTED_EXECUTION_RUNNER_BASE_URL?: string;
  HOSTED_EXECUTION_RUNNER_CONTROL_TOKEN?: string;
  HOSTED_EXECUTION_SIGNING_SECRET?: string;
  USER_RUNNER: DurableObjectNamespaceLike;
}

export default {
  async fetch(request: Request, env: WorkerEnvironmentSource): Promise<Response> {
    try {
      const url = new URL(request.url);
      const environment = readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      );

      if (request.method === "GET" && url.pathname === "/health") {
        return json({
          ok: true,
          service: "cloudflare-hosted-runner",
        });
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

      const match = url.pathname.match(/^\/internal\/users\/([^/]+)\/(run|status)$/u);

      if (match) {
        if (environment.controlToken) {
          const authorization = request.headers.get("authorization");

          if (authorization !== `Bearer ${environment.controlToken}`) {
            return json({ error: "Unauthorized" }, 401);
          }
        }

        const [, userId, action] = match;
        return env.USER_RUNNER
          .getByName(decodeURIComponent(userId))
          .fetch(new Request(
            action === "status"
              ? `https://runner.internal/status?userId=${encodeURIComponent(decodeURIComponent(userId))}`
              : "https://runner.internal/run",
            {
              body: action === "run" ? JSON.stringify(await readJsonObject(request)) : null,
              method: request.method,
            },
          ));
      }

      return json({ ok: true, service: "cloudflare-hosted-runner" });
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
      return json(await this.runner.dispatch(JSON.parse(await request.text())));
    }

    if (request.method === "POST" && url.pathname === "/run") {
      const body = await readJsonObject(request);
      const userId = typeof body.userId === "string" ? body.userId : null;

      if (!userId) {
        return json({ error: "userId is required." }, 400);
      }

      return json(
        await this.runner.run({
          event: {
            kind: "assistant.cron.tick",
            reason: "manual",
            userId,
          },
          eventId: `manual:${Date.now()}`,
          occurredAt: new Date().toISOString(),
        }),
      );
    }

    if (request.method === "GET" && url.pathname === "/status") {
      const userId = url.searchParams.get("userId") ?? "unknown";
      return json(await this.runner.status(userId));
    }

    return json({ error: "Not found" }, 404);
  }

  async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}
