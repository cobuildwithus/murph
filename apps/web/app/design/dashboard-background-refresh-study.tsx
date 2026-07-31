"use client";

import { useEffect, useState } from "react";
import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser";

import { OverviewPageContent } from "../(dashboard)/overview/overview-page-client";

type BrowserVaultEntity = Parameters<
  typeof createVaultReadModel
>[0]["entities"][number];

export function DashboardBackgroundRefreshStudy() {
  const [client, setClient] = useState<BrowserVaultQueryClient | null>(null);

  useEffect(() => {
    let cancelled = false;

    void createDesignClient().then((nextClient) => {
      if (!cancelled) {
        setClient(nextClient);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!client) {
    return null;
  }

  return (
    <div
      className="rounded-2xl border border-border bg-background p-5 sm:p-8"
      data-design-section="dashboard-background-refresh"
      id="dashboard-background-refresh-section"
      inert
    >
      <OverviewPageContent
        browserVault={{
          client,
          error: null,
          refresh: async () => {},
          refreshPending: false,
          status: "ready",
        }}
      />
    </div>
  );
}

async function createDesignClient(): Promise<BrowserVaultQueryClient> {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-31T18:00:00.000Z",
    metricPoints: [],
    sourceBundleHash: "dashboard-background-refresh-study",
    vault: createVaultReadModel({
      entities: [
        createDesignEntity("experiment", "focus-refresh-walk", {
          body: "A short walk after lunch has been easy to repeat.",
          date: "2026-07-29",
          experimentSlug: "light-morning-walk",
          occurredAt: "2026-07-29T12:30:00.000Z",
          recordClass: "bank",
          status: "active",
          tags: ["movement"],
          title: "Walk after lunch",
        }),
        createDesignEntity("journal", "focus-refresh-note", {
          body: "Energy stayed steady through the afternoon.",
          date: "2026-07-30",
          occurredAt: "2026-07-30T17:20:00.000Z",
          tags: ["energy"],
          title: "Afternoon energy note",
        }),
      ],
      metadata: { title: "Dashboard background refresh study" },
      vaultRoot: "browser://design-study",
    }),
  });

  return createBrowserVaultQueryClient(replica);
}

function createDesignEntity(
  family: BrowserVaultEntity["family"],
  entityId: string,
  overrides: Partial<BrowserVaultEntity>,
): BrowserVaultEntity {
  return {
    attributes: {},
    body: null,
    date: null,
    entityId,
    experimentSlug: null,
    family,
    frontmatter: null,
    kind: `${family}_entry`,
    links: [],
    lookupIds: [entityId],
    occurredAt: null,
    path: `design/${family}/${entityId}.md`,
    primaryLookupId: entityId,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: entityId,
    ...overrides,
  };
}
