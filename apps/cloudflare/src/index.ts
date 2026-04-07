import { DurableObject } from "cloudflare:workers";
export { ContainerProxy } from "@cloudflare/containers";

import type { CloudflareHostedUserEnvStatus } from "@murphai/cloudflare-hosted-control";
import {
  emitHostedExecutionStructuredLog,
  parseHostedExecutionDispatchRequest,
  type HostedExecutionDispatchRequest,
  type HostedExecutionDispatchResult,
  type HostedExecutionOutboxPayload,
  type HostedExecutionUserStatus,
} from "@murphai/hosted-execution";
import type {
  HostedExecutionDeviceSyncRuntimeApplyRequest,
  HostedExecutionDeviceSyncRuntimeApplyResponse,
  HostedExecutionDeviceSyncRuntimeSnapshotRequest,
  HostedExecutionDeviceSyncRuntimeSnapshotResponse,
} from "@murphai/device-syncd/hosted-runtime";
import {
  type GatewayFetchAttachmentsInput,
  type GatewayGetConversationInput,
  type GatewayListConversationsInput,
  type GatewayPollEventsInput,
  type GatewayListOpenPermissionsInput,
  type GatewayReadMessagesInput,
  type GatewayRespondToPermissionInput,
} from "@murphai/gateway-core";

import {
  verifyHostedExecutionVercelOidcRequest,
} from "./auth-adapter.ts";
import { readHostedExecutionEnvironment } from "./env.ts";
import type {
  HostedExecutionCommittedResult,
} from "./execution-journal.ts";
import {
  json,
  methodNotAllowed,
  notFound,
  unauthorized,
} from "./json.ts";
export { RunnerContainer } from "./runner-container.ts";
import type { HostedExecutionContainerNamespaceLike } from "./runner-container.ts";
import type { HostedEmailWorkerRequest } from "./hosted-email.ts";
import { handleHostedEmailIngress } from "./hosted-email/worker-ingress.ts";
import { type HostedUserEnvUpdate } from "./user-env.ts";
import {
  HostedUserRunner,
  type DurableObjectStateLike,
} from "./user-runner.ts";
import { handleGatewayRoute } from "./worker-routes/gateway.ts";
import {
  handleManualRunRoute,
  handlePendingUsageRoute,
  handlePendingUsageUsersRoute,
  handleSharePackRoute,
  handleStatusRoute,
  handleUserCryptoContextRoute,
  handleUserDeviceSyncRuntimeRoute,
  handleUserDispatchPayloadRoute,
  handleUserEmailAddressRoute,
  handleUserEnvRoute,
  handleUserStoredDispatchRoute,
} from "./worker-routes/internal-user.ts";
import type {
  WorkerUserRunnerCommitInput,
} from "./worker-contracts.ts";
import {
  readCachedRequestText,
  resolveUserRunnerStub,
  type UserRunnerDurableObjectStubLike,
  type WorkerEnvironmentSource,
  type WorkerRouteContext,
} from "./worker-routes/shared.ts";

type RouteParams = Readonly<Record<string, string>>;
type RouteMatcher = (pathname: string) => RouteParams | null;
type WorkerRouteAuthorization = "vercel-oidc" | null;
type WrongMethodResponse = "method-not-allowed" | "not-found";

interface DeclarativeRoute<Context> {
  authorizeBeforeMethod?: boolean;
  authorization?: WorkerRouteAuthorization;
  beforeMethod?(context: Context, params: RouteParams): Promise<Response | null> | Response | null;
  handle(context: Context, params: RouteParams): Promise<Response> | Response;
  match: RouteMatcher;
  methods: readonly string[];
  wrongMethodResponse?: WrongMethodResponse;
}

const workerPublicRoutes: readonly DeclarativeRoute<{
  request: Request;
  url: URL;
}>[] = [
  {
    handle() {
      return createServiceBannerResponse();
    },
    match: matchExactPath("/", "/health"),
    methods: ["GET"],
  },
];

const workerInternalRoutes: readonly DeclarativeRoute<WorkerRouteContext>[] = [
  {
    authorization: "vercel-oidc",
    async handle(context) {
      return handleDispatchRoute(context);
    },
    match: matchExactPath("/internal/dispatch"),
    methods: ["POST"],
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleManualRunRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/run$/u),
    methods: ["POST"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleStatusRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/status$/u),
    methods: ["GET"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleUserEnvRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/env$/u),
    methods: ["GET", "PUT", "DELETE"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleUserDeviceSyncRuntimeRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/device-sync\/runtime$/u),
    methods: ["GET", "POST"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleUserCryptoContextRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/crypto-context$/u),
    methods: ["PUT"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleSharePackRoute(context, params.userId, params.shareId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/shares\/(?<shareId>[^/]+)\/pack$/u),
    methods: ["PUT", "DELETE"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleUserEmailAddressRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/email-address$/u),
    methods: ["GET"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleUserDispatchPayloadRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/dispatch-payload$/u),
    methods: ["PUT", "DELETE"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleUserStoredDispatchRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/dispatch-payload\/dispatch$/u),
    methods: ["POST"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context) {
      return handlePendingUsageUsersRoute(context);
    },
    match: matchExactPath("/internal/usage/pending-users"),
    methods: ["GET"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handlePendingUsageRoute(context, params.userId);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/usage\/pending$/u),
    methods: ["GET", "DELETE"],
    wrongMethodResponse: "method-not-allowed",
  },
  {
    authorizeBeforeMethod: true,
    authorization: "vercel-oidc",
    async handle(context, params) {
      return handleGatewayRoute(context, params.userId, params.resource);
    },
    match: matchNamedPath(/^\/internal\/users\/(?<userId>[^/]+)\/gateway\/(?<resource>conversations\/list|conversations\/get|messages\/read|messages\/send|attachments\/fetch|events\/poll|events\/wait|permissions\/list-open|permissions\/respond)$/u),
    methods: ["POST"],
    wrongMethodResponse: "method-not-allowed",
  },
];

export default {
  async fetch(request: Request, env: WorkerEnvironmentSource): Promise<Response> {
    try {
      const url = new URL(request.url);
      const publicResponse = await dispatchDeclarativeRoute(workerPublicRoutes, { request, url });
      if (publicResponse) {
        return publicResponse;
      }

      const environment = readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      );
      return (
        await dispatchDeclarativeRoute(workerInternalRoutes, {
          env,
          environment,
          request,
          url,
        })
      ) ?? notFound();
    } catch (error) {
      return mapWorkerRouteError(error);
    }
  },
  async email(message: HostedEmailWorkerRequest, env: WorkerEnvironmentSource): Promise<void> {
    await handleHostedEmailIngress(message, env);
  },
};

export class UserRunnerDurableObject extends DurableObject implements UserRunnerDurableObjectStubLike {
  private readonly runner: HostedUserRunner;

  constructor(state: DurableObjectStateLike, env: WorkerEnvironmentSource) {
    super(state as never, env as never);
    this.runner = new HostedUserRunner(
      state,
      readHostedExecutionEnvironment(
        env as unknown as Readonly<Record<string, string | undefined>>,
      ),
      env.BUNDLES,
      env,
      env.RUNNER_CONTAINER,
    );
  }

  async bootstrapUser(userId: string): Promise<{ userId: string }> {
    return this.runner.bootstrapUser(userId);
  }

  async provisionManagedUserCrypto(userId: string): Promise<{ recipientKinds: string[]; rootKeyId: string; userId: string }> {
    return this.runner.provisionManagedUserCrypto(userId);
  }

  async getDeviceSyncRuntimeSnapshot(input: {
    request: HostedExecutionDeviceSyncRuntimeSnapshotRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeSnapshotResponse> {
    return this.runner.getDeviceSyncRuntimeSnapshot(input);
  }

  async applyDeviceSyncRuntimeUpdates(input: {
    request: HostedExecutionDeviceSyncRuntimeApplyRequest;
  }): Promise<HostedExecutionDeviceSyncRuntimeApplyResponse> {
    return this.runner.applyDeviceSyncRuntimeUpdates(input);
  }

  async putPendingUsage(input: {
    usage: readonly Record<string, unknown>[];
  }): Promise<{ recorded: number; usageIds: string[] }> {
    return this.runner.putPendingUsage(input);
  }

  async readPendingUsage(input?: { limit?: number | null }): Promise<Record<string, unknown>[]> {
    return this.runner.readPendingUsage(input);
  }

  async deletePendingUsage(input: { usageIds: readonly string[] }): Promise<void> {
    return this.runner.deletePendingUsage(input);
  }

  async deleteStoredDispatchPayload(input: {
    payload: HostedExecutionOutboxPayload;
  }): Promise<void> {
    return this.runner.deleteStoredDispatchPayload(input);
  }

  async dispatchStoredPayload(input: {
    payload: HostedExecutionOutboxPayload;
  }): Promise<HostedExecutionDispatchResult> {
    return this.runner.dispatchStoredPayload(input);
  }

  async storeDispatchPayload(input: {
    dispatch: HostedExecutionDispatchRequest;
  }): Promise<HostedExecutionOutboxPayload> {
    return this.runner.storeDispatchPayload(input);
  }

  async dispatch(input: HostedExecutionDispatchRequest): Promise<HostedExecutionUserStatus> {
    return this.runner.dispatch(input);
  }

  async dispatchWithOutcome(input: HostedExecutionDispatchRequest): Promise<HostedExecutionDispatchResult> {
    return this.runner.dispatchWithOutcome(input);
  }

  async commit(input: WorkerUserRunnerCommitInput): Promise<HostedExecutionCommittedResult> {
    return this.runner.commit(input);
  }

  async gatewayListConversations(input?: GatewayListConversationsInput) {
    return this.runner.gatewayListConversations(input);
  }

  async gatewayGetConversation(input: GatewayGetConversationInput) {
    return this.runner.gatewayGetConversation(input);
  }

  async gatewayReadMessages(input: GatewayReadMessagesInput) {
    return this.runner.gatewayReadMessages(input);
  }

  async gatewayFetchAttachments(input: GatewayFetchAttachmentsInput) {
    return this.runner.gatewayFetchAttachments(input);
  }

  async gatewayPollEvents(input?: GatewayPollEventsInput) {
    return this.runner.gatewayPollEvents(input);
  }

  async gatewayListOpenPermissions(input?: GatewayListOpenPermissionsInput) {
    return this.runner.gatewayListOpenPermissions(input);
  }

  async gatewayRespondToPermission(input: GatewayRespondToPermissionInput) {
    return this.runner.gatewayRespondToPermission(input);
  }

  async status(): Promise<HostedExecutionUserStatus> {
    return this.runner.status();
  }

  async getUserEnvStatus(): Promise<CloudflareHostedUserEnvStatus> {
    return this.runner.getUserEnvStatus();
  }

  async updateUserEnv(update: HostedUserEnvUpdate): Promise<CloudflareHostedUserEnvStatus> {
    return this.runner.updateUserEnv(update);
  }

  async clearUserEnv(): Promise<CloudflareHostedUserEnvStatus> {
    return this.runner.clearUserEnv();
  }

  async fetch(): Promise<Response> {
    return notFound();
  }

  async alarm(): Promise<void> {
    await this.runner.alarm();
  }
}

async function dispatchDeclarativeRoute<Context>(
  routes: readonly DeclarativeRoute<Context>[],
  context: Context & { request: Request; url: URL },
): Promise<Response | null> {
  for (const route of routes) {
    const params = route.match(context.url.pathname);
    if (!params) {
      continue;
    }

    if (route.authorizeBeforeMethod) {
      const authorizationError = await authorizeRoute(route.authorization ?? null, context);
      if (authorizationError) {
        return authorizationError;
      }
    }

    const preMethodResponse = await route.beforeMethod?.(context, params);
    if (preMethodResponse) {
      return preMethodResponse;
    }

    if (!route.methods.includes(context.request.method)) {
      return respondToWrongMethod(route.wrongMethodResponse ?? "not-found");
    }

    if (!route.authorizeBeforeMethod) {
      const authorizationError = await authorizeRoute(route.authorization ?? null, context);
      if (authorizationError) {
        return authorizationError;
      }
    }

    return route.handle(context, params);
  }

  return null;
}

function createServiceBannerResponse(): Response {
  return json({ ok: true, service: "cloudflare-hosted-runner" });
}

async function authorizeRoute(
  authorization: WorkerRouteAuthorization,
  context: { request: Request } & Partial<WorkerRouteContext>,
): Promise<Response | null> {
  switch (authorization) {
    case "vercel-oidc": {
      const validation = context.environment?.vercelOidcValidation;
      if (!validation) {
        return unauthorized();
      }
      const verified = await verifyHostedExecutionVercelOidcRequest({
        request: context.request,
        validation,
      });

      return verified ? null : unauthorized();
    }
    default:
      return null;
  }
}

async function handleDispatchRoute(context: WorkerRouteContext): Promise<Response> {
  const payload = await readCachedRequestText(context);
  const dispatch = parseHostedExecutionDispatchRequest(JSON.parse(payload) as unknown);
  const result = await (await resolveUserRunnerStub(context.env, dispatch.event.userId)).dispatchWithOutcome(dispatch);
  return result.event.state === "backpressured" ? json(result, 429) : json(result);
}

function matchExactPath(...paths: readonly string[]): RouteMatcher {
  const allowedPaths = new Set(paths);
  return (pathname) => (allowedPaths.has(pathname) ? {} : null);
}

function matchNamedPath(pattern: RegExp): RouteMatcher {
  return (pathname) => {
    const match = pattern.exec(pathname);
    if (!match?.groups) {
      return null;
    }
    return match.groups;
  };
}

function respondToWrongMethod(response: WrongMethodResponse): Response {
  return response === "method-not-allowed" ? methodNotAllowed() : notFound();
}

function mapWorkerRouteError(error: unknown): Response {
  emitHostedExecutionStructuredLog({
    component: "worker",
    error,
    level: "error",
    message: "Hosted worker route failed.",
    phase: "failed",
  });
  const classified = classifyPublicRouteError(error);
  return json({ error: classified.error }, classified.status);
}

function classifyPublicRouteError(error: unknown): { error: string; status: number } {
  if (error instanceof SyntaxError) {
    return { error: "Invalid JSON.", status: 400 };
  }
  if (error instanceof TypeError || error instanceof RangeError || error instanceof URIError) {
    return { error: "Invalid request.", status: 400 };
  }
  return { error: "Internal error.", status: 500 };
}
