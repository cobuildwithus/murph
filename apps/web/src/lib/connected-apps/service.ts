import "server-only";

import { createHash, randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  compactHostedConnectedAppsResult,
  serializeHostedConnectedAppsResult,
  type HostedConnectedAppsManageInput,
  type HostedConnectedAppsRequest,
} from "@murphai/hosted-execution/connected-apps";

import {
  ComposioConnectedAppsRequestError,
  createComposioConnectedAppsClient,
  type ComposioConnectedAccount,
} from "./composio";
import {
  assertHostedConnectedAppsSearchToolkit,
  assertHostedConnectedAppToolkit,
  buildHostedConnectedAppsPolicyRevision,
  formatHostedConnectedAppToolkitLabel,
  getHostedConnectedAppsCustomAuthExecution,
  getHostedConnectedAppsWritePolicy,
  isHostedConnectedAppsServiceTool,
  readHostedConnectedAppsConfig,
  readHostedOpenWeatherApiKey,
} from "./config";
import {
  executeOpenWeatherNationalAlerts,
  HOSTED_OPENWEATHER_NATIONAL_ALERTS_TOOL_SLUG,
  OpenWeatherAlertsRequestError,
} from "./openweather-alerts";
import { resolveHostedPublicBaseUrl } from "@/src/lib/hosted-web/public-url";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";
import { readActiveHostedMemberAccess } from "../hosted-onboarding/member-access";
import {
  HOSTED_ONBOARDING_TRANSACTION_OPTIONS,
  lockHostedMemberRow,
} from "@/src/lib/hosted-onboarding/shared";
import { getPrisma } from "@/src/lib/prisma";

const CONNECTED_APPS_RESULT_TOO_LARGE_MESSAGE =
  "That request returned more than Murph can read at once. Ask for fewer results, a narrower time range, or one item at a time.";
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
  return boundHostedConnectedAppsResult(
    await runHostedConnectedAppsRequest(input),
  );
}

// Provider output reaches the assistant verbatim, so markup is stripped here
// rather than at the runtime edge: the budget that matters is the serialized
// size the model reads, not the wire size the provider sent.
function boundHostedConnectedAppsResult(result: unknown): unknown {
  const compacted = compactHostedConnectedAppsResult(result);
  if (serializeHostedConnectedAppsResult(compacted) === null) {
    throw connectedAppsResultTooLargeError();
  }
  return compacted;
}

function connectedAppsResultTooLargeError(cause?: unknown) {
  return hostedOnboardingError({
    ...(cause === undefined ? {} : { cause }),
    code: "CONNECTED_APPS_RESULT_TOO_LARGE",
    httpStatus: 413,
    message: CONNECTED_APPS_RESULT_TOO_LARGE_MESSAGE,
  });
}

function connectedAppsWritePreflightError(
  error: ComposioConnectedAppsRequestError,
) {
  const retryable = error.retryable ?? isRetryableComposioFailure(error);
  return hostedOnboardingError({
    cause: error,
    code: "CONNECTED_APPS_WRITE_PREFLIGHT_UNAVAILABLE",
    details: buildConnectedAppsProviderErrorDetails(error),
    httpStatus: retryable ? 503 : 400,
    message: retryable
      ? "Connected account verification is temporarily unavailable."
      : "The connected account could not be verified.",
    retryable,
  });
}

async function runHostedConnectedAppsRequest(input: {
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
          assertHostedConnectedAppsSearchToolkit(config, toolkit)
        );
        const sessionId = await ensureHostedConnectedAppsSession({
          client,
          config,
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
        const {
          account: selector,
          agentApproved,
          arguments: argumentsValue,
          toolSlug,
        } = input.request.input;
        if (toolSlug === HOSTED_OPENWEATHER_NATIONAL_ALERTS_TOOL_SLUG) {
          return await executeOpenWeatherNationalAlerts({
            apiKey: readHostedOpenWeatherApiKey(),
            arguments: argumentsValue,
            fetchImpl: input.fetchImpl,
          });
        }
        if (isHostedConnectedAppsServiceTool(toolSlug)) {
          const customAuthExecution = getHostedConnectedAppsCustomAuthExecution(toolSlug);
          if (customAuthExecution) {
            return await client.executeDirect({
              arguments: argumentsValue,
              customAuthParams: customAuthExecution.customAuthParams,
              toolSlug,
              userId: input.memberId,
              version: customAuthExecution.version,
            });
          }

          const sessionId = await ensureHostedConnectedAppsSession({
            client,
            config,
            memberId: input.memberId,
            prisma,
          });
          return await client.execute({
            arguments: argumentsValue,
            sessionId,
            toolSlug,
          });
        }

        const writePolicy = getHostedConnectedAppsWritePolicy(toolSlug);
        const emailWrite = writePolicy?.kind === "email";
        if (writePolicy) {
          assertHostedConnectedAppToolkit(config, writePolicy.toolkit);
          if (!agentApproved) {
            throw hostedOnboardingError({
              code: "CONNECTED_APPS_AGENT_APPROVAL_REQUIRED",
              httpStatus: 400,
              message: emailWrite
                ? "Approve the email before sending it."
                : "Approve the calendar event before adding it.",
            });
          }
          const unsupportedArguments = Object.keys(argumentsValue).filter(
            (key) => !writePolicy.allowedArguments.includes(key),
          );
          if (unsupportedArguments.length > 0) {
            throw hostedOnboardingError({
              code: "CONNECTED_APPS_WRITE_ARGUMENT_NOT_ALLOWED",
              httpStatus: 400,
              message: emailWrite
                ? "That email action includes unsupported options."
                : "That calendar action includes unsupported options.",
            });
          }
          const missingArguments = writePolicy.requiredArguments.filter((key) =>
            isMissingConnectedAppsWriteArgument(argumentsValue, key)
          );
          if (missingArguments.length > 0) {
            throw hostedOnboardingError({
              code: "CONNECTED_APPS_WRITE_ARGUMENT_REQUIRED",
              httpStatus: 400,
              message: emailWrite
                ? "That email action is missing required fields."
                : "That calendar action is missing required fields.",
            });
          }
        }

        if (!selector) {
          throw hostedOnboardingError({
            code: "CONNECTED_APPS_ACCOUNT_REQUIRED",
            httpStatus: 400,
            message: "Choose a connected account before running that tool.",
          });
        }
        let account: ComposioConnectedAccount;
        try {
          account = await resolveOwnedConnectedAccount({
            client,
            memberId: input.memberId,
            selector,
            scope: "configured",
            ...(writePolicy ? { toolkit: writePolicy.toolkit } : {}),
          });
        } catch (error) {
          if (writePolicy && error instanceof ComposioConnectedAppsRequestError) {
            throw connectedAppsWritePreflightError(error);
          }
          throw error;
        }

        if (writePolicy) {
          if (account.toolkit.slug.trim().toLowerCase() !== writePolicy.toolkit) {
            throw hostedOnboardingError({
              code: "CONNECTED_APPS_TOOLKIT_MISMATCH",
              httpStatus: 400,
              message: emailWrite
                ? "Choose an account that matches the email action."
                : "Choose an account that matches the calendar action.",
            });
          }
          return await client.executeDirect({
            account: account.id,
            arguments: {
              ...argumentsValue,
              ...writePolicy.forcedArguments,
            },
            toolSlug,
            version: writePolicy.version,
          }).catch((error: unknown) => {
            if (error instanceof ComposioConnectedAppsRequestError) {
              throw new ComposioConnectedAppsRequestError(
                `${emailWrite
                  ? "Composio email sending returned an ambiguous result."
                  : "Composio calendar event creation returned an ambiguous result."} ${error.message}`,
                error.status,
                {
                  cause: error,
                  operationName: toolSlug,
                  retryable: false,
                  type: error.type ?? (emailWrite
                    ? "composio_email_send_ambiguous"
                    : "composio_calendar_create_ambiguous"),
                },
              );
            }
            throw error;
          });
        }

        const sessionId = await ensureHostedConnectedAppsSession({
          client,
          config,
          memberId: input.memberId,
          prisma,
        });
        return await client.execute({
          account: account.id,
          arguments: argumentsValue,
          sessionId,
          toolSlug,
        });
      }
    }
  } catch (error) {
    throw mapConnectedAppsError(error);
  }
}

function isMissingConnectedAppsWriteArgument(
  argumentsValue: Readonly<Record<string, unknown>>,
  key: string,
): boolean {
  if (!Object.hasOwn(argumentsValue, key)) {
    return true;
  }
  const value = argumentsValue[key];
  return value === null
    || value === undefined
    || (typeof value === "string" && value.trim().length === 0)
    || (Array.isArray(value) && value.length === 0);
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
  let providerLinkAttempted = false;

  try {
    const sessionId = await ensureHostedConnectedAppsSession({
      client,
      config,
      memberId: input.memberId,
      prisma,
    });
    const callbackUrl = buildHostedConnectedAppCallbackUrl(input.claim);
    providerLinkAttempted = true;
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
    if (!providerLinkAttempted) {
      await releaseHostedConnectedAppIntent({
        claimHash: intent.claimHash,
        prisma,
      });
    }
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
    if (!await isHostedConnectedAppsMemberActive({
      memberId: intent.memberId,
      prisma,
    })) {
      await cleanupInactiveMemberConnectedAccountBestEffort({
        accountId: input.connectedAccountId,
        client,
        intent,
      });
      throw inactiveConnectedAppsMemberError();
    }

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
        ...(toolkit ? {} : { toolkits: null }),
        userId: input.memberId,
      });
      return {
        accounts: accounts.map((account) => presentConnectedAccount(account, input.config)),
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
        scope: "all-owned",
      });
      await input.client.renameAccount(account.id, input.input.alias);
      return {
        account: {
          ...presentConnectedAccount(account, input.config),
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
        scope: "all-owned",
      });
      await input.client.disconnectAccount(account.id);
      return {
        account: presentConnectedAccount(account, input.config),
        status: "disconnected",
      };
    }
  }
}

async function ensureHostedConnectedAppsSession(input: {
  client: ReturnType<typeof createComposioConnectedAppsClient>;
  config: ReturnType<typeof readHostedConnectedAppsConfig>;
  memberId: string;
  prisma: PrismaClient;
}): Promise<string> {
  const policyRevision = buildHostedConnectedAppsPolicyRevision(input.config);
  const existing = await input.prisma.hostedConnectedAppsSession.findUnique({
    where: { memberId: input.memberId },
  });
  if (existing?.policyRevision === policyRevision) {
    return existing.remoteSessionId;
  }

  // Hosted assistant work is serialized per member. Keeping the provider call
  // outside a database transaction avoids holding a member lock across network I/O.
  const remoteSessionId = await input.client.createSession(input.memberId);
  await input.prisma.hostedConnectedAppsSession.upsert({
    where: { memberId: input.memberId },
    create: {
      memberId: input.memberId,
      policyRevision,
      remoteSessionId,
    },
    update: {
      policyRevision,
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
    await assertHostedConnectedAppsMemberActiveTx({
      memberId: input.memberId,
      prisma: tx,
    });
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
    await assertHostedConnectedAppsMemberActiveTx({
      memberId: input.memberId,
      prisma: tx,
    });
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
  scope: "all-owned" | "configured";
  toolkit?: string;
}): Promise<ComposioConnectedAccount> {
  const accounts = await input.client.listAccounts({
    ...(input.scope === "all-owned"
      ? { toolkits: null }
      : input.toolkit
        ? { toolkit: input.toolkit }
        : {}),
    userId: input.memberId,
  });
  const selectableAccounts = input.scope === "configured"
    ? accounts.filter((account) =>
        account.status.trim().toUpperCase() === "ACTIVE"
        && !account.isDisabled
      )
    : accounts;
  const scopedAccounts = input.toolkit
    ? selectableAccounts.filter((account) =>
        account.toolkit.slug.trim().toLowerCase() === input.toolkit
      )
    : selectableAccounts;
  const selector = input.selector.trim().toLowerCase();
  const matches = scopedAccounts.filter((account) =>
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

async function assertHostedConnectedAppsMemberActiveTx(input: {
  memberId: string;
  prisma: Prisma.TransactionClient;
}): Promise<void> {
  await lockHostedMemberRow(input.prisma, input.memberId);
  if (!await isHostedConnectedAppsMemberActive(input)) {
    throw inactiveConnectedAppsMemberError();
  }
}

async function isHostedConnectedAppsMemberActive(input: {
  memberId: string;
  prisma: PrismaClient | Prisma.TransactionClient;
}): Promise<boolean> {
  return readActiveHostedMemberAccess(input);
}

async function cleanupInactiveMemberConnectedAccountBestEffort(input: {
  accountId: string;
  client: ReturnType<typeof createComposioConnectedAppsClient>;
  intent: HostedConnectedAppIntent;
}): Promise<void> {
  try {
    const accounts = await input.client.listAccounts({
      accountIds: [input.accountId],
      statuses: null,
      toolkit: input.intent.toolkit,
      userId: input.intent.memberId,
    });
    const account = accounts.find((candidate) =>
      candidate.id === input.accountId
      && candidate.toolkit.slug === input.intent.toolkit
    );
    if (account?.status.toUpperCase() === "ACTIVE") {
      await input.client.disconnectAccount(input.accountId);
    }
    await input.client.deleteAccount(input.accountId);
  } catch {
    // Account deletion is best-effort on the callback path. The account
    // deletion flow performs fail-closed provider cleanup before local removal.
  }
}

function inactiveConnectedAppsMemberError() {
  return hostedOnboardingError({
    code: "CONNECTED_APPS_MEMBER_INACTIVE",
    httpStatus: 403,
    message: "Connected apps are unavailable for this Murph account.",
  });
}

function presentConnectedAccount(
  account: ComposioConnectedAccount,
  config: Pick<ReturnType<typeof readHostedConnectedAppsConfig>, "toolkits">,
) {
  return {
    alias: account.alias,
    id: account.id,
    status: account.status,
    toolkit: account.toolkit.slug,
    toolkitConfigured: config.toolkits.includes(account.toolkit.slug),
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
  if (error instanceof OpenWeatherAlertsRequestError) {
    return hostedOnboardingError({
      cause: error,
      code: error.type === "openweather_invalid_arguments"
        ? "CONNECTED_APPS_REQUEST_INVALID"
        : "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
      details: {
        operationName: HOSTED_OPENWEATHER_NATIONAL_ALERTS_TOOL_SLUG,
        ...(error.status === null ? {} : { statusCode: error.status }),
        type: error.type,
      },
      httpStatus: error.retryable ? 503 : 400,
      message: error.retryable
        ? "Connected apps are temporarily unavailable."
        : "The connected-app request could not be completed.",
      retryable: error.retryable,
    });
  }
  if (!(error instanceof ComposioConnectedAppsRequestError)) {
    return error;
  }
  // A provider body too large to read is a narrowable request, not an outage.
  // Reporting it as one is what left the assistant offering a retry that could
  // only fail again.
  if (error.type === "composio_response_too_large") {
    return connectedAppsResultTooLargeError(error);
  }
  const retryable = error.retryable ?? isRetryableComposioFailure(error);
  return hostedOnboardingError({
    cause: error,
    code: "CONNECTED_APPS_PROVIDER_UNAVAILABLE",
    details: buildConnectedAppsProviderErrorDetails(error),
    httpStatus: retryable ? 503 : 400,
    message: retryable
      ? "Connected apps are temporarily unavailable."
      : "The connected-app request could not be completed.",
    retryable,
  });
}

function isRetryableComposioFailure(
  error: ComposioConnectedAppsRequestError,
): boolean {
  // A malformed body arrives on a 200 with nothing about the request to blame,
  // so calling it non-retryable would tell the assistant that repeating the
  // call must fail — a claim the evidence does not support.
  if (error.type === "composio_invalid_json") {
    return true;
  }
  return error.status === null || error.status === 429 || error.status >= 500;
}

function buildConnectedAppsProviderErrorDetails(
  error: ComposioConnectedAppsRequestError,
): Record<string, unknown> | undefined {
  const details: Record<string, unknown> = {};
  if (error.operationName) {
    details.operationName = error.operationName;
  }
  if (error.status !== null) {
    details.statusCode = error.status;
  }
  if (error.type) {
    details.type = error.type;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}
