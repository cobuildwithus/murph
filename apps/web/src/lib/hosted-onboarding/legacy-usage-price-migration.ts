import type Stripe from "stripe";

import { sha256Hex } from "../primitives";
import { isHostedStripeLegacyAiUsageMeteredItem } from "./legacy-usage-price";

const HOSTED_STRIPE_LEGACY_USAGE_MIGRATION_MAX_SCANNED = 10_000;
const HOSTED_STRIPE_LEGACY_USAGE_MIGRATION_MAX_CANDIDATES = 1_000;

export interface HostedStripeLegacyUsageMigrationItem {
  id: string;
  price: {
    id: string;
    metadata: Stripe.Metadata;
    recurring: {
      interval: string;
      intervalCount: number;
      usageType: string;
    } | null;
  };
  quantity: number | null;
}

export interface HostedStripeLegacyUsageMigrationSubscription {
  id: string;
  items: readonly HostedStripeLegacyUsageMigrationItem[];
  pendingUpdate: boolean;
  scheduleId: string | null;
  status: string;
}

export interface HostedStripeLegacyUsageMigrationClient {
  deleteLegacyItem(input: {
    idempotencyKey: string;
    itemId: string;
  }): Promise<void>;
  listSubscriptionsByPrice(
    priceId: string,
  ): AsyncIterable<HostedStripeLegacyUsageMigrationSubscription>;
  retrieveSubscription(
    subscriptionId: string,
  ): Promise<HostedStripeLegacyUsageMigrationSubscription>;
}

export interface HostedStripeLegacyUsageMigrationSummary {
  alreadyClean: number;
  blockedPendingUpdate: number;
  blockedSchedule: number;
  candidateItems: number;
  candidateSubscriptions: number;
  migratedItems: number;
  migratedSubscriptions: number;
  scanned: number;
  terminal: number;
  unsupported: number;
}

type HostedStripeLegacyUsageMigrationClassification =
  | { kind: "already_clean" }
  | { kind: "blocked_pending_update" }
  | { kind: "blocked_schedule" }
  | {
    items: readonly HostedStripeLegacyUsageMigrationItem[];
    kind: "candidate";
    planItem: HostedStripeLegacyUsageMigrationItem;
  }
  | { kind: "terminal" }
  | { kind: "unsupported" };

export function projectHostedStripeLegacyUsageMigrationSubscription(
  subscription: Stripe.Subscription,
): HostedStripeLegacyUsageMigrationSubscription {
  return {
    id: subscription.id,
    items: subscription.items.data.map((item) => ({
      id: item.id,
      price: {
        id: item.price.id,
        metadata: item.price.metadata,
        recurring: item.price.recurring
          ? {
              interval: item.price.recurring.interval,
              intervalCount: item.price.recurring.interval_count,
              usageType: item.price.recurring.usage_type,
            }
          : null,
      },
      quantity: typeof item.quantity === "number" ? item.quantity : null,
    })),
    pendingUpdate: subscription.pending_update !== null,
    scheduleId: coerceStripeObjectId(subscription.schedule),
    status: subscription.status,
  };
}

export function classifyHostedStripeLegacyUsageMigrationSubscription(input: {
  knownPlanPriceIds: ReadonlySet<string>;
  subscription: HostedStripeLegacyUsageMigrationSubscription;
}): HostedStripeLegacyUsageMigrationClassification {
  if (
    input.subscription.status === "canceled"
    || input.subscription.status === "incomplete_expired"
  ) {
    return { kind: "terminal" };
  }

  const planItems = input.subscription.items.filter((item) =>
    input.knownPlanPriceIds.has(item.price.id)
  );
  const legacyItems = input.subscription.items.filter((item) =>
    isHostedStripeLegacyAiUsageMeteredItem(projectMigrationItemForLegacyCheck(item))
  );
  const supportedItemIds = new Set([
    ...planItems.map((item) => item.id),
    ...legacyItems.map((item) => item.id),
  ]);

  if (
    planItems.length !== 1
    || !isHostedStripeLicensedMonthlyMigrationItem(planItems[0])
    || legacyItems.length > 1
    || input.subscription.items.some((item) => !supportedItemIds.has(item.id))
  ) {
    return { kind: "unsupported" };
  }

  if (legacyItems.length === 0) {
    return { kind: "already_clean" };
  }
  if (input.subscription.pendingUpdate) {
    return { kind: "blocked_pending_update" };
  }
  if (input.subscription.scheduleId) {
    return { kind: "blocked_schedule" };
  }

  return {
    items: legacyItems,
    kind: "candidate",
    planItem: planItems[0],
  };
}

export async function runHostedStripeLegacyUsageMigration(input: {
  apply: boolean;
  client: HostedStripeLegacyUsageMigrationClient;
  expectedCandidateSubscriptions?: number;
  knownPlanPriceIds: readonly string[];
}): Promise<HostedStripeLegacyUsageMigrationSummary> {
  const knownPlanPriceIds = normalizeKnownPlanPriceIds(input.knownPlanPriceIds);
  const subscriptions = await listUniqueSubscriptions({
    client: input.client,
    knownPlanPriceIds,
  });
  const summary = createEmptySummary();
  const candidates: Array<{
    items: readonly HostedStripeLegacyUsageMigrationItem[];
    planItem: HostedStripeLegacyUsageMigrationItem;
    subscriptionId: string;
  }> = [];

  for (const subscription of subscriptions) {
    summary.scanned += 1;
    const classification = classifyHostedStripeLegacyUsageMigrationSubscription({
      knownPlanPriceIds,
      subscription,
    });

    switch (classification.kind) {
      case "already_clean":
        summary.alreadyClean += 1;
        break;
      case "blocked_pending_update":
        summary.blockedPendingUpdate += 1;
        break;
      case "blocked_schedule":
        summary.blockedSchedule += 1;
        break;
      case "candidate":
        summary.candidateSubscriptions += 1;
        summary.candidateItems += classification.items.length;
        candidates.push({
          items: classification.items,
          planItem: classification.planItem,
          subscriptionId: subscription.id,
        });
        break;
      case "terminal":
        summary.terminal += 1;
        break;
      case "unsupported":
        summary.unsupported += 1;
        break;
    }
  }

  if (!input.apply) {
    return summary;
  }

  assertHostedStripeLegacyUsageMigrationApplyAllowed({
    expectedCandidateSubscriptions: input.expectedCandidateSubscriptions,
    summary,
  });

  for (const candidate of candidates) {
    const refreshedBeforeDelete = await retrieveSubscriptionSafely(
      input.client,
      candidate.subscriptionId,
    );
    const refreshedClassification = classifyHostedStripeLegacyUsageMigrationSubscription({
      knownPlanPriceIds,
      subscription: refreshedBeforeDelete,
    });
    if (
      refreshedClassification.kind === "already_clean"
      && hostedStripeLegacyUsageMigrationPlanItemMatches({
        actual: refreshedBeforeDelete.items.find((item) =>
          knownPlanPriceIds.has(item.price.id)
        ) ?? null,
        expected: candidate.planItem,
      })
    ) {
      summary.migratedSubscriptions += 1;
      continue;
    }
    if (
      refreshedClassification.kind !== "candidate"
      || !hostedStripeLegacyUsageMigrationPlanItemMatches({
        actual: refreshedClassification.planItem,
        expected: candidate.planItem,
      })
      || !hostedStripeLegacyUsageMigrationItemsMatch({
        actual: refreshedClassification.items,
        expected: candidate.items,
      })
    ) {
      throw new Error(
        "Legacy usage migration candidate identity changed after audit; rerun dry-run before applying.",
      );
    }

    for (const item of refreshedClassification.items) {
      await deleteLegacyItemSafely({
        client: input.client,
        item,
        subscriptionId: candidate.subscriptionId,
      });
      summary.migratedItems += 1;
    }

    const refreshed = await retrieveSubscriptionSafely(
      input.client,
      candidate.subscriptionId,
    );
    const classification = classifyHostedStripeLegacyUsageMigrationSubscription({
      knownPlanPriceIds,
      subscription: refreshed,
    });
    if (
      classification.kind !== "already_clean"
      || !hostedStripeLegacyUsageMigrationPlanItemMatches({
        actual: refreshed.items.find((item) => knownPlanPriceIds.has(item.price.id)) ?? null,
        expected: candidate.planItem,
      })
    ) {
      throw new Error(
        "Legacy usage migration could not verify the cleaned subscription shape; rerun dry-run before retrying.",
      );
    }
    summary.migratedSubscriptions += 1;
  }

  return summary;
}

function hostedStripeLegacyUsageMigrationItemsMatch(input: {
  actual: readonly HostedStripeLegacyUsageMigrationItem[];
  expected: readonly HostedStripeLegacyUsageMigrationItem[];
}): boolean {
  if (input.actual.length !== input.expected.length) {
    return false;
  }
  const expectedById = new Map(input.expected.map((item) => [item.id, item]));
  return input.actual.every((actualItem) =>
    hostedStripeLegacyUsageMigrationItemMatches({
      actual: actualItem,
      expected: expectedById.get(actualItem.id) ?? null,
    })
  );
}

function hostedStripeLegacyUsageMigrationPlanItemMatches(input: {
  actual: HostedStripeLegacyUsageMigrationItem | null;
  expected: HostedStripeLegacyUsageMigrationItem;
}): boolean {
  return hostedStripeLegacyUsageMigrationItemMatches(input)
    && input.actual?.quantity === 1
    && input.actual.price.recurring?.usageType === "licensed";
}

function hostedStripeLegacyUsageMigrationItemMatches(input: {
  actual: HostedStripeLegacyUsageMigrationItem | null;
  expected: HostedStripeLegacyUsageMigrationItem | null;
}): boolean {
  return Boolean(
    input.actual
    && input.expected
    && input.actual.id === input.expected.id
    && input.actual.price.id === input.expected.price.id
    && input.actual.quantity === input.expected.quantity,
  );
}

function projectMigrationItemForLegacyCheck(
  item: HostedStripeLegacyUsageMigrationItem,
): Parameters<typeof isHostedStripeLegacyAiUsageMeteredItem>[0] {
  return {
    price: {
      metadata: item.price.metadata,
      recurring: item.price.recurring
        ? {
            interval: item.price.recurring.interval,
            interval_count: item.price.recurring.intervalCount,
            usage_type: item.price.recurring.usageType,
          }
        : null,
    },
    quantity: item.quantity,
  };
}

function isHostedStripeLicensedMonthlyMigrationItem(
  item: HostedStripeLegacyUsageMigrationItem,
): boolean {
  return item.price.recurring?.interval === "month"
    && item.price.recurring.intervalCount === 1
    && item.price.recurring.usageType === "licensed"
    && item.quantity === 1;
}

function normalizeKnownPlanPriceIds(values: readonly string[]): Set<string> {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  const unique = new Set(normalized);
  if (unique.size === 0 || unique.size !== normalized.length) {
    throw new Error(
      "Legacy usage migration requires a non-empty set of distinct plan prices.",
    );
  }
  return unique;
}

async function listUniqueSubscriptions(input: {
  client: HostedStripeLegacyUsageMigrationClient;
  knownPlanPriceIds: ReadonlySet<string>;
}): Promise<HostedStripeLegacyUsageMigrationSubscription[]> {
  const subscriptions = new Map<string, HostedStripeLegacyUsageMigrationSubscription>();
  try {
    for (const priceId of input.knownPlanPriceIds) {
      for await (const subscription of input.client.listSubscriptionsByPrice(priceId)) {
        subscriptions.set(subscription.id, subscription);
        if (subscriptions.size > HOSTED_STRIPE_LEGACY_USAGE_MIGRATION_MAX_SCANNED) {
          throw new Error("scan_limit");
        }
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "scan_limit") {
      throw new Error("Legacy usage migration exceeded its bounded subscription scan.");
    }
    throw new Error(
      "Legacy usage migration could not list Stripe subscriptions; no changes were started.",
    );
  }
  return [...subscriptions.values()];
}

function assertHostedStripeLegacyUsageMigrationApplyAllowed(input: {
  expectedCandidateSubscriptions?: number;
  summary: HostedStripeLegacyUsageMigrationSummary;
}): void {
  if (
    !Number.isSafeInteger(input.expectedCandidateSubscriptions)
    || input.expectedCandidateSubscriptions === undefined
    || input.expectedCandidateSubscriptions < 0
  ) {
    throw new Error(
      "Apply mode requires an exact non-negative expected candidate count from a fresh dry-run.",
    );
  }
  if (
    input.summary.candidateSubscriptions
      > HOSTED_STRIPE_LEGACY_USAGE_MIGRATION_MAX_CANDIDATES
  ) {
    throw new Error("Legacy usage migration exceeded its bounded candidate count.");
  }
  if (
    input.summary.candidateSubscriptions
      !== input.expectedCandidateSubscriptions
  ) {
    throw new Error(
      "Legacy usage migration candidate count changed after dry-run; rerun dry-run before applying.",
    );
  }
  if (
    input.summary.blockedPendingUpdate > 0
    || input.summary.blockedSchedule > 0
    || input.summary.unsupported > 0
  ) {
    throw new Error(
      "Legacy usage migration found blocked or unsupported active subscriptions; resolve them before applying.",
    );
  }
}

async function deleteLegacyItemSafely(input: {
  client: HostedStripeLegacyUsageMigrationClient;
  item: HostedStripeLegacyUsageMigrationItem;
  subscriptionId: string;
}): Promise<void> {
  try {
    await input.client.deleteLegacyItem({
      idempotencyKey: `hosted-legacy-usage-item-delete:${sha256Hex(
        `${input.subscriptionId}:${input.item.id}`,
      )}`,
      itemId: input.item.id,
    });
  } catch {
    throw new Error(
      "Legacy usage migration stopped after a Stripe deletion failure; rerun dry-run before retrying.",
    );
  }
}

async function retrieveSubscriptionSafely(
  client: HostedStripeLegacyUsageMigrationClient,
  subscriptionId: string,
): Promise<HostedStripeLegacyUsageMigrationSubscription> {
  try {
    return await client.retrieveSubscription(subscriptionId);
  } catch {
    throw new Error(
      "Legacy usage migration could not verify a changed subscription; rerun dry-run before retrying.",
    );
  }
}

function createEmptySummary(): HostedStripeLegacyUsageMigrationSummary {
  return {
    alreadyClean: 0,
    blockedPendingUpdate: 0,
    blockedSchedule: 0,
    candidateItems: 0,
    candidateSubscriptions: 0,
    migratedItems: 0,
    migratedSubscriptions: 0,
    scanned: 0,
    terminal: 0,
    unsupported: 0,
  };
}

function coerceStripeObjectId(
  value: string | { id?: string } | null,
): string | null {
  if (typeof value === "string") {
    return value;
  }
  return typeof value?.id === "string" ? value.id : null;
}
