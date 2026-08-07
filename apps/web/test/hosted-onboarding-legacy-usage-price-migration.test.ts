import { describe, expect, test, vi } from "vitest";

import {
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY,
  HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
} from "@/src/lib/hosted-onboarding/legacy-usage-price";
import {
  classifyHostedStripeLegacyUsageMigrationSubscription,
  runHostedStripeLegacyUsageMigration,
  type HostedStripeLegacyUsageMigrationClient,
  type HostedStripeLegacyUsageMigrationItem,
  type HostedStripeLegacyUsageMigrationSubscription,
} from "@/src/lib/hosted-onboarding/legacy-usage-price-migration";

const KNOWN_PLAN_PRICES = ["price_pulse", "price_edge", "price_group"];

describe("legacy Stripe usage item migration", () => {
  test("selects only a marked metered companion on a canonical direct subscription", () => {
    const classification = classifyHostedStripeLegacyUsageMigrationSubscription({
      knownPlanPriceIds: new Set(KNOWN_PLAN_PRICES),
      subscription: makeSubscription({ legacy: true }),
    });

    expect(classification).toMatchObject({
      kind: "candidate",
      items: [{ id: "si_legacy_usage" }],
    });
  });

  test.each([
    ["unknown add-on", makeSubscription({ legacy: true, unknown: true })],
    ["quantity-bearing metered item", makeSubscription({ legacy: true, legacyQuantity: 1 })],
    ["duplicate legacy item", makeSubscription({ duplicateLegacy: true, legacy: true })],
    ["duplicate licensed item", makeSubscription({ duplicatePlan: true, legacy: true })],
  ])("rejects %s without selecting a deletion", (_label, subscription) => {
    expect(classifyHostedStripeLegacyUsageMigrationSubscription({
      knownPlanPriceIds: new Set(KNOWN_PLAN_PRICES),
      subscription,
    })).toEqual({ kind: "unsupported" });
  });

  test("deduplicates subscriptions returned by multiple known price scans", async () => {
    const subscription = makeSubscription({ legacy: true });
    const client = makeClient({
      byPrice: new Map([
        ["price_pulse", [subscription]],
        ["price_edge", [subscription]],
      ]),
    });

    await expect(runHostedStripeLegacyUsageMigration({
      apply: false,
      client,
      knownPlanPriceIds: KNOWN_PLAN_PRICES,
    })).resolves.toMatchObject({
      candidateItems: 1,
      candidateSubscriptions: 1,
      scanned: 1,
    });
  });

  test("deletes without proration through the client and verifies the final shape", async () => {
    const candidate = makeSubscription({ legacy: true });
    const clean = makeSubscription({ legacy: false });
    const client = makeClient({
      byPrice: new Map([["price_pulse", [candidate]]]),
      retrieved: [candidate, clean],
    });

    await expect(runHostedStripeLegacyUsageMigration({
      apply: true,
      client,
      expectedCandidateSubscriptions: 1,
      knownPlanPriceIds: KNOWN_PLAN_PRICES,
    })).resolves.toMatchObject({
      candidateSubscriptions: 1,
      migratedItems: 1,
      migratedSubscriptions: 1,
    });
    expect(client.deleteLegacyItem).toHaveBeenCalledWith({
      idempotencyKey: expect.stringMatching(
        /^hosted-legacy-usage-item-delete:[a-f0-9]{64}$/u,
      ),
      itemId: "si_legacy_usage",
    });
  });

  test("accepts an already-clean exact replay without deleting again", async () => {
    const candidate = makeSubscription({ legacy: true });
    const clean = makeSubscription({ legacy: false });
    const client = makeClient({
      byPrice: new Map([["price_pulse", [candidate]]]),
      retrieved: clean,
    });

    await expect(runHostedStripeLegacyUsageMigration({
      apply: true,
      client,
      expectedCandidateSubscriptions: 1,
      knownPlanPriceIds: KNOWN_PLAN_PRICES,
    })).resolves.toMatchObject({
      migratedItems: 0,
      migratedSubscriptions: 1,
    });
    expect(client.deleteLegacyItem).not.toHaveBeenCalled();
  });

  test("refuses deletion when the audited plan item identity changes", async () => {
    const candidate = makeSubscription({ legacy: true });
    const changed = makeSubscription({
      legacy: true,
      planItemId: "si_replaced_plan",
    });
    const client = makeClient({
      byPrice: new Map([["price_pulse", [candidate]]]),
      retrieved: changed,
    });

    await expect(runHostedStripeLegacyUsageMigration({
      apply: true,
      client,
      expectedCandidateSubscriptions: 1,
      knownPlanPriceIds: KNOWN_PLAN_PRICES,
    })).rejects.toThrow("candidate identity changed after audit");
    expect(client.deleteLegacyItem).not.toHaveBeenCalled();
  });

  test("audits candidates discovered through the Group plan price", async () => {
    const candidate = makeSubscription({
      legacy: true,
      planPriceId: "price_group",
    });
    const client = makeClient({
      byPrice: new Map([["price_group", [candidate]]]),
    });

    await expect(runHostedStripeLegacyUsageMigration({
      apply: false,
      client,
      knownPlanPriceIds: KNOWN_PLAN_PRICES,
    })).resolves.toMatchObject({
      candidateItems: 1,
      candidateSubscriptions: 1,
      scanned: 1,
    });
  });

  test("refuses every mutation when an active candidate is blocked", async () => {
    const client = makeClient({
      byPrice: new Map([
        ["price_pulse", [
          makeSubscription({ legacy: true }),
          makeSubscription({ id: "sub_pending", legacy: true, pendingUpdate: true }),
        ]],
      ]),
    });

    await expect(runHostedStripeLegacyUsageMigration({
      apply: true,
      client,
      expectedCandidateSubscriptions: 1,
      knownPlanPriceIds: KNOWN_PLAN_PRICES,
    })).rejects.toThrow("blocked or unsupported active subscriptions");
    expect(client.deleteLegacyItem).not.toHaveBeenCalled();
  });

  test("requires the exact dry-run candidate count before apply", async () => {
    const client = makeClient({
      byPrice: new Map([["price_pulse", [makeSubscription({ legacy: true })]]]),
    });

    await expect(runHostedStripeLegacyUsageMigration({
      apply: true,
      client,
      expectedCandidateSubscriptions: 0,
      knownPlanPriceIds: KNOWN_PLAN_PRICES,
    })).rejects.toThrow("candidate count changed");
    expect(client.deleteLegacyItem).not.toHaveBeenCalled();
  });
});

function makeClient(input: {
  byPrice: Map<string, HostedStripeLegacyUsageMigrationSubscription[]>;
  retrieved?:
    | HostedStripeLegacyUsageMigrationSubscription
    | readonly HostedStripeLegacyUsageMigrationSubscription[];
}): HostedStripeLegacyUsageMigrationClient & {
  deleteLegacyItem: ReturnType<typeof vi.fn>;
} {
  const deleteLegacyItem = vi.fn(async () => undefined);
  let retrieveIndex = 0;
  return {
    deleteLegacyItem,
    async *listSubscriptionsByPrice(priceId) {
      for (const subscription of input.byPrice.get(priceId) ?? []) {
        yield subscription;
      }
    },
    async retrieveSubscription(subscriptionId) {
      if (Array.isArray(input.retrieved)) {
        const retrieved = input.retrieved[retrieveIndex]
          ?? input.retrieved.at(-1);
        retrieveIndex += 1;
        if (retrieved) {
          return retrieved;
        }
      } else if (input.retrieved) {
        return input.retrieved;
      }
      return makeSubscription({
        id: subscriptionId,
        legacy: false,
      });
    },
  };
}

function makeSubscription(input: {
  duplicateLegacy?: boolean;
  duplicatePlan?: boolean;
  id?: string;
  legacy: boolean;
  legacyQuantity?: number;
  pendingUpdate?: boolean;
  planItemId?: string;
  planPriceId?: string;
  unknown?: boolean;
}): HostedStripeLegacyUsageMigrationSubscription {
  const items: HostedStripeLegacyUsageMigrationItem[] = [
    makePlanItem(
      input.planItemId ?? "si_plan",
      input.planPriceId ?? "price_pulse",
    ),
  ];
  if (input.duplicatePlan) {
    items.push(makePlanItem("si_plan_duplicate", "price_edge"));
  }
  if (input.legacy) {
    items.push(makeLegacyItem("si_legacy_usage", input.legacyQuantity ?? null));
  }
  if (input.duplicateLegacy) {
    items.push(makeLegacyItem("si_legacy_usage_duplicate", null));
  }
  if (input.unknown) {
    items.push(makePlanItem("si_unknown", "price_unknown"));
  }
  return {
    id: input.id ?? "sub_candidate",
    items,
    pendingUpdate: input.pendingUpdate === true,
    scheduleId: null,
    status: "active",
  };
}

function makeLegacyItem(
  id: string,
  quantity: number | null,
): HostedStripeLegacyUsageMigrationItem {
  return {
    id,
    price: {
      id: "price_legacy_usage",
      metadata: {
        [HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_KEY]:
          HOSTED_STRIPE_LEGACY_AI_USAGE_PRICE_METADATA_VALUE,
      },
      recurring: {
        interval: "month",
        intervalCount: 1,
        usageType: "metered",
      },
    },
    quantity,
  };
}

function makePlanItem(
  id: string,
  priceId: string,
): HostedStripeLegacyUsageMigrationItem {
  return {
    id,
    price: {
      id: priceId,
      metadata: {},
      recurring: {
        interval: "month",
        intervalCount: 1,
        usageType: "licensed",
      },
    },
    quantity: 1,
  };
}
