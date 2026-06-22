import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import type {
  HostedConnectedAppsManageInput,
  HostedConnectedAppsRequest,
} from "@murphai/hosted-execution/connected-apps";

import {
  ComposioConnectedAppsRequestError,
  createComposioConnectedAppsClient,
  type ComposioConnectedAccount,
} from "./composio";
import {
  HOSTED_CONNECTED_APPS_POLICY_REVISION,
  assertHostedConnectedAppToolkit,
  formatHostedConnectedAppToolkitLabel,
  readHostedConnectedAppsConfig,
} from "./config";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

const CONNECTED_APP_INTENT_PREFIX = "cai_";
const CONNECTED_APP_INTENT_BYTES = 24;
const CONNECTED_APP_INTENT_TTL_MS = 15 * 60 * 1000;

export interface HostedConnectedAppIntent {
  alias: string | null;
  claimHash: string;
  completedAt: Date | null;
  connectedAccountId: string | null;
  expiresAt: Date;
  memberId: string;
  startedAt: Date | null;
  toolkit: string;
}

export async function executeHostedConnectedAppsRequest(input: {
  fetchImpl?: typeof fetch;
  memberId: string;
  prisma?: PrismaClient;
  request: HostedConnectedAppsRequest;
}): Promise<unknown> {
  const config = readHostedConnectedAppsConfig();
  const client = createComposioConnectedAppsClient({
    config,
    fetchImpl: input.fetchImpl,
  });
  const prisma = input.prisma ?? getPrisma();

  try {
    switch (input.request.operation) {
      case "manage":
        return await executeConnectedAppsManagement({
          client,
          config,
          input: input.request.input,
          memberId: input.memberId,
          prisma,
        });
      case "search": {
        const toolkits = input.request.input.toolkits?.map((toolkit) =>
          assertHostedConnectedAppToolkit(config, toolkit)
        );
        const sessionId = await ensureHostedConnectedAppsSession({
          client,
          memberId: input.memberId,
          prisma,
        });
        return await client.search({
          query: input.request.input.query,
          sessionId,
          ...(toolkits ? { toolkits } : {}),
        });
      }
      case "execute": {
        const sessionId = await ensureHostedConnectedAppsSession({
          client,
          memberId: input.memberId,
          prisma,
        });
        const account = await resolveOwnedConnectedAccount({
          client,
          memberId: input.memberId,
          selector: input.request.input.account,
        });
        return await client.execute({
          account: account.id,
          arguments: input.request.input.arguments,
          sessionId,
          toolSlug: input.request.input.toolSlug,
        });
      }
    }
  } catch (error) {
    throw mapConnectedAppsError(error);
  }
}

export async function startHostedConnectedAppConnection(input: {
  claim: string;
  fetchImpl?: typeof fetch;
  memberId: string;
  prisma?: PrismaClient;
}): Promise<{ redirectUrl: string }> {
  const config = readHostedConnectedAppsConfig();
  const client = createComposioConnectedAppsClient({
    config,
    fetchImpl: input.fetchImpl,
  });
  const prisma = input.prisma ?? getPrisma();
  const intent = await claimHostedConnectedAppIntent({
    claim: input.claim,
    memberId: input.memberId,
    prisma,
  });

  try {
    const sessionId = await ensureHostedConnectedAppsSession({
      client,
      memberId: input.memberId,
      prisma,
    });
    const callbackUrl = buildHostedConnectedAppCallbackUrl(input.claim);
    const link = await client.createLink({
      ...(intent.alias ? { alias: intent.alias } : {}),
      callbackUrl,
      sessionId,
      toolkit: intent.toolkit,
    });
    await prisma.hostedConnectedAppConnectIntent.update({
      where: { claimHash: intent.claimHash },
      data: { connectedAccountId: link.connectedAccountId },
    });
    return { redirectUrl: link.redirectUrl };
  } catch (error) {
    await releaseHostedConnectedAppIntent({
      claimHash: intent.claimHash,
      prisma,
    });
    throw mapConnectedAppsError(error);
  }
}

export async function completeHostedConnectedAppConnection(input: {
  claim: string;
  connectedAccountId: string;
  fetchImpl?: typeof fetch;
  prisma?: PrismaClient;
}): Promise<{
  account: ComposioConnectedAccount;
  intent: HostedConnectedAppIntent;
}> {
  const config = readHostedConnectedAppsConfig();
  const client = createComposioConnectedAppsClient({
    config,
    fetchImpl: input.fetchImpl,
  });
  const prisma = input.prisma ?? getPrisma();
  const intent = await readHostedConnectedAppIntent({
    claim: input.claim,
    prisma,
  });
  const now = new Date();

  if (
    !intent.startedAt
    || intent.completedAt
    || intent.expiresAt <= now
    || intent.connectedAccountId !== input.connectedAccountId
  ) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_CALLBACK_INVALID",
      httpStatus: 410,
      message: "This connected-app link is no longer valid.",
    });
  }

  try {
    const accounts = await client.listAccounts({
      accountIds: [input.connectedAccountId],
      toolkit: intent.toolkit,
      userId: intent.memberId,
    });
    const account = accounts.find((candidate) =>
      candidate.id === input.connectedAccountId
      && candidate.toolkit.slug === intent.toolkit
      && candidate.status === "ACTIVE"
      && !candidate.isDisabled
    );
    if (!account) {
      throw hostedOnboardingError({
        code: "CONNECTED_APPS_CALLBACK_ACCOUNT_MISMATCH",
        httpStatus: 403,
        message: "The connected account could not be verified for this Murph member.",
      });
    }

    const completed = await prisma.hostedConnectedAppConnectIntent.updateMany({
      where: {
        claimHash: intent.claimHash,
        completedAt: null,
        connectedAccountId: input.connectedAccountId,
        expiresAt: { gt: now },
        startedAt: { not: null },
      },
      data: { completedAt: now },
    });
    if (completed.count !== 1) {
      throw invalidConnectedAppIntent();
    }
    const completedIntent = await prisma.hostedConnectedAppConnectIntent.findUnique({
      where: { claimHash: intent.claimHash },
    });
    if (!completedIntent) {
      throw invalidConnectedAppIntent();
    }
    return {
      account,
      intent: toHostedConnectedAppIntent(completedIntent),
    };
  } catch (error) {
    throw mapConnectedAppsError(error);
  }
}

export async function readHostedConnectedAppIntent(input: {
  claim: string;
  prisma?: PrismaClient;
}): Promise<HostedConnectedAppIntent> {
  const claimHash = normalizeConnectedAppClaimHash(input.claim);
  const record = claimHash
    ? await (input.prisma ?? getPrisma()).hostedConnectedAppConnectIntent.findUnique({
        where: { claimHash },
      })
    : null;
  if (!record) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_INTENT_NOT_FOUND",
      httpStatus: 404,
      message: "This connected-app link could not be found.",
    });
  }
  return toHostedConnectedAppIntent(record);
}

async function executeConnectedAppsManagement(input: {
  client: ReturnType<typeof createComposioConnectedAppsClient>;
  config: ReturnType<typeof readHostedConnectedAppsConfig>;
  input: HostedConnectedAppsManageInput;
  memberId: string;
  prisma: PrismaClient;
}): Promise<unknown> {
  switch (input.input.action) {
    case "list": {
      const toolkit = input.input.toolkit
        ? assertHostedConnectedAppToolkit(input.config, input.input.toolkit)
        : undefined;
      const accounts = await input.client.listAccounts({
        ...(toolkit ? { toolkit } : {}),
        userId: input.memberId,
      });
      return {
        accounts: accounts.map(presentConnectedAccount),
        toolkits: input.config.toolkits.map((slug) => ({
          label: formatHostedConnectedAppToolkitLabel(slug),
          slug,
        })),
      };
    }
    case "connect": {
      const toolkit = assertHostedConnectedAppToolkit(input.config, input.input.toolkit);
      const link = await createHostedConnectedAppIntent({
        alias: input.input.alias ?? null,
        memberId: input.memberId,
        prisma: input.prisma,
        toolkit,
      });
      return {
        connectUrl: link.connectUrl,
        expiresAt: link.expiresAt,
        status: "link_created",
        toolkit,
        toolkitLabel: formatHostedConnectedAppToolkitLabel(toolkit),
      };
    }
    case "rename": {
      const account = await resolveOwnedConnectedAccount({
        client: input.client,
        memberId: input.memberId,
        selector: input.input.account,
      });
      await input.client.renameAccount(account.id, input.input.alias);
      return {
        account: {
          ...presentConnectedAccount(account),
          alias: input.input.alias,
        },
        status: "renamed",
      };
    }
    case "disconnect": {
      const account = await resolveOwnedConnectedAccount({
        client: input.client,
        memberId: input.memberId,
        selector: input.input.account,
      });
      await input.client.disconnectAccount(account.id);
      return {
        account: presentConnectedAccount(account),
        status: "disconnected",
      };
    }
  }
}

async function ensureHostedConnectedAppsSession(input: {
  client: ReturnType<typeof createComposioConnectedAppsClient>;
  memberId: string;
  prisma: PrismaClient;
}): Promise<string> {
  const existing = await input.prisma.hostedConnectedAppsSession.findUnique({
    where: { memberId: input.memberId },
  });
  if (existing?.policyRevision === HOSTED_CONNECTED_APPS_POLICY_REVISION) {
    return existing.remoteSessionId;
  }

  // Hosted assistant work is serialized per member. Keeping the provider call
  // outside a database transaction avoids holding a member lock across network I/O.
  const remoteSessionId = await input.client.createSession(input.memberId);
  await input.prisma.hostedConnectedAppsSession.upsert({
    where: { memberId: input.memberId },
    create: {
      memberId: input.memberId,
      policyRevision: HOSTED_CONNECTED_APPS_POLICY_REVISION,
      remoteSessionId,
    },
    update: {
      policyRevision: HOSTED_CONNECTED_APPS_POLICY_REVISION,
      remoteSessionId,
    },
  });
  return remoteSessionId;
}

async function createHostedConnectedAppIntent(input: {
  alias: string | null;
  memberId: string;
  prisma: PrismaClient;
  toolkit: string;
}): Promise<{ connectUrl: string; expiresAt: string }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CONNECTED_APP_INTENT_TTL_MS);
  const claim = `${CONNECTED_APP_INTENT_PREFIX}${randomBytes(CONNECTED_APP_INTENT_BYTES).toString("base64url")}`;
  const claimHash = hashConnectedAppClaim(claim);
  const baseUrl = resolveHostedPublicBaseUrl();
  if (!baseUrl) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_PUBLIC_URL_UNAVAILABLE",
      httpStatus: 503,
      message: "Connected apps are temporarily unavailable.",
      retryable: true,
    });
  }

  await input.prisma.$transaction(async (tx) => {
    await lockHostedMemberRow(tx, input.memberId);
    await tx.hostedConnectedAppConnectIntent.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    await tx.hostedConnectedAppConnectIntent.create({
      data: {
        alias: input.alias,
        claimHash,
        expiresAt,
        memberId: input.memberId,
        toolkit: input.toolkit,
      },
    });
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);

  return {
    connectUrl: new URL(
      `/integrations/connect/${encodeURIComponent(claim)}`,
      `${baseUrl}/`,
    ).toString(),
    expiresAt: expiresAt.toISOString(),
  };
}

async function claimHostedConnectedAppIntent(input: {
  claim: string;
  memberId: string;
  prisma: PrismaClient;
}): Promise<HostedConnectedAppIntent> {
  const claimHash = normalizeConnectedAppClaimHash(input.claim);
  const now = new Date();
  if (!claimHash) {
    throw invalidConnectedAppIntent();
  }

  return await input.prisma.$transaction(async (tx) => {
    const updated = await tx.hostedConnectedAppConnectIntent.updateMany({
      where: {
        claimHash,
        completedAt: null,
        expiresAt: { gt: now },
        memberId: input.memberId,
        startedAt: null,
      },
      data: { startedAt: now },
    });
    if (updated.count !== 1) {
      throw invalidConnectedAppIntent();
    }
    const record = await tx.hostedConnectedAppConnectIntent.findUnique({
      where: { claimHash },
    });
    if (!record) {
      throw invalidConnectedAppIntent();
    }
    return toHostedConnectedAppIntent(record);
  }, HOSTED_ONBOARDING_TRANSACTION_OPTIONS);
}

async function releaseHostedConnectedAppIntent(input: {
  claimHash: string;
  prisma: PrismaClient;
}): Promise<void> {
  await input.prisma.hostedConnectedAppConnectIntent.updateMany({
    where: {
      claimHash: input.claimHash,
      completedAt: null,
    },
    data: {
      connectedAccountId: null,
      startedAt: null,
    },
  });
}

async function resolveOwnedConnectedAccount(input: {
  client: ReturnType<typeof createComposioConnectedAppsClient>;
  memberId: string;
  selector: string;
}): Promise<ComposioConnectedAccount> {
  const accounts = await input.client.listAccounts({ userId: input.memberId });
  const selector = input.selector.trim().toLowerCase();
  const matches = accounts.filter((account) =>
    account.id.toLowerCase() === selector
    || account.alias?.toLowerCase() === selector
    || account.wordId?.toLowerCase() === selector
  );
  if (matches.length === 1) {
    return matches[0]!;
  }
  if (matches.length > 1) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_ACCOUNT_AMBIGUOUS",
      httpStatus: 409,
      message: "More than one connected account matches that name. List accounts and choose an exact account id.",
    });
  }
  throw hostedOnboardingError({
    code: "CONNECTED_APPS_ACCOUNT_NOT_FOUND",
    httpStatus: 404,
    message: "That connected account was not found for this Murph member.",
  });
}

function presentConnectedAccount(account: ComposioConnectedAccount) {
  return {
    alias: account.alias,
    id: account.id,
    status: account.status,
    toolkit: account.toolkit.slug,
    toolkitLabel: formatHostedConnectedAppToolkitLabel(account.toolkit.slug),
    wordId: account.wordId,
  };
}

function buildHostedConnectedAppCallbackUrl(claim: string): string {
  const baseUrl = resolveHostedPublicBaseUrl();
  if (!baseUrl) {
    throw hostedOnboardingError({
      code: "CONNECTED_APPS_PUBLIC_URL_UNAVAILABLE",
      httpStatus: 503,
      message: "Connected apps are temporarily unavailable.",
      retryable: true,
    });
  }
  const url = new URL("/integrations/connect/complete", `${baseUrl}/`);
  url.searchParams.set("claim", claim);
  return url.toString();
}

function normalizeConnectedAppClaimHash(claim: string): string | null {
  return /^cai_[A-Za-z0-9_-]{32}$/u.test(claim)
    ? hashConnectedAppClaim(claim)
    : null;
}

function hashConnectedAppClaim(claim: string): string {
  return createHash("sha256").update(claim).digest("hex");
}

function toHostedConnectedAppIntent(record: {
  alias: string | null;
  claimHash: string;
  completedAt: Date | null;
  connectedAccountId: string | null;
  expiresAt: Date;
  memberId: string;
  startedAt: Date | null;
  toolkit: string;
}): HostedConnectedAppIntent {
  return { ...record };
}

function invalidConnectedAppIntent() {
  return hostedOnboardingError({
    code: "CONNECTED_APPS_INTENT_UNAVAILABLE",
    httpStatus: 410,
    message: "This connected-app link is expired, already used, or belongs to another Murph account.",
  });
}

function mapConnectedAppsError(error: unknown): unknown {
  if (!(error instanceof ComposioConnectedAppsRequestError)) {
    return error;
  }
  const retryable = error.status === null || error.status === 429 || error.status >= 500;
  return hostedOnboardingError({
    code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
    httpStatus: retryable ? 503 : 400,
    message: retryable
      ? "Connected apps are temporarily unavailable."
      : "The connected-app request could not be completed.",
    retryable,
  });
}
