import { type ReactNode } from "react";
import {
  createBrowserVaultQueryClient,
  createBrowserVaultReplica,
  createVaultReadModel,
  parseBrowserVaultReplica,
  type BrowserVaultQueryClient,
} from "@murphai/query/browser";
import { buildMetricProjection } from "@murphai/query";
import { beforeEach, expect, test, vi } from "vitest";

import { renderClientComponent } from "./render-client-component";

const browserVaultMock = vi.hoisted(() => ({
  value: {
    client: null as BrowserVaultQueryClient | null,
    error: null as string | null,
    freshness: "fresh" as "fresh" | "stale",
    refresh: vi.fn(async () => {}),
    refreshPending: false,
    status: "empty" as "empty" | "error" | "loading" | "ready",
  },
}));

vi.mock("@/src/lib/browser-vault/context", () => ({
  useBrowserVault() {
    return browserVaultMock.value;
  },
  useBrowserVaultSelector<T>(selector: (client: BrowserVaultQueryClient) => T) {
    return browserVaultMock.value.client ? selector(browserVaultMock.value.client) : null;
  },
}));

vi.mock("@/src/components/ui/auth-button", () => ({
  AuthButton({ children }: { children: ReactNode }) {
    return <button type="button">{children}</button>;
  },
}));

vi.mock("next/link", () => ({
  default({ children, href, ...props }: {
    children: ReactNode;
    href: string;
    [key: string]: unknown;
  }) {
    return <a {...props} href={href}>{children}</a>;
  },
}));

import {
  BiomarkersPageClient,
  type DeviceTrackedBiomarker,
} from "../app/(dashboard)/biomarkers/biomarkers-page-client";

type CanonicalEntity = Parameters<typeof createVaultReadModel>[0]["entities"][number];

const DEVICE_BIOMARKERS: DeviceTrackedBiomarker[] = [
  {
    key: "biomarker:resting-heart-rate",
    privateMetricBindings: [{ metricKey: "resting-heart-rate", role: "primary" }],
    routeId: "resting-heart-rate",
    shortName: "Resting heart rate",
    trendDefaults: {
      aggregation: "mean",
      comparisonWindowDays: 30,
      latestWindowDays: 7,
      minimumPoints: 3,
    },
    unit: "bpm",
    valuePrecision: 0,
  },
  {
    key: "biomarker:hrv",
    privateMetricBindings: [{ metricKey: "hrv", role: "primary" }],
    routeId: "hrv",
    shortName: "HRV",
    trendDefaults: {
      aggregation: "mean",
      comparisonWindowDays: 30,
      latestWindowDays: 7,
      minimumPoints: 3,
    },
    unit: "ms",
    valuePrecision: 0,
  },
];

beforeEach(() => {
  browserVaultMock.value = {
    client: null,
    error: null,
    freshness: "fresh",
    refresh: vi.fn(async () => {}),
    refreshPending: false,
    status: "empty",
  };
});

test("device-tracked biomarkers with private readings return to the index", async () => {
  browserVaultMock.value.client = await clientWithRestingHeartRate();
  browserVaultMock.value.status = "ready";

  const rendered = await renderClientComponent(
    <BiomarkersPageClient authenticated deviceBiomarkers={DEVICE_BIOMARKERS} />,
    { requireButton: false },
  );

  try {
    const text = rendered.container.textContent ?? "";
    expect(text).toContain("From your devices");
    expect(text).toContain("Resting heart rate");
    expect(text).toContain("bpm");
    expect(text).toContain("readings");

    // Only measured metrics appear: HRV has no private data.
    expect(text).not.toContain("HRV");

    const link = rendered.container.querySelector('a[href="/biomarkers/resting-heart-rate"]');
    expect(link).not.toBeNull();

    // The header count includes device metrics even with zero lab results.
    expect(text).toContain("1 biomarker");
    expect(text).toContain("No lab results yet");
  } finally {
    await rendered.cleanup();
  }
});

test("the device section stays hidden without data or authentication", async () => {
  const signedOut = await renderClientComponent(
    <BiomarkersPageClient authenticated={false} deviceBiomarkers={DEVICE_BIOMARKERS} />,
  );
  try {
    expect(signedOut.container.textContent).not.toContain("From your devices");
  } finally {
    await signedOut.cleanup();
  }

  browserVaultMock.value.client = await clientWithoutMetrics();
  browserVaultMock.value.status = "ready";
  const empty = await renderClientComponent(
    <BiomarkersPageClient authenticated deviceBiomarkers={DEVICE_BIOMARKERS} />,
    { requireButton: false },
  );
  try {
    expect(empty.container.textContent).not.toContain("From your devices");
    expect(empty.container.textContent).not.toContain("Resting heart rate");
  } finally {
    await empty.cleanup();
  }
});

async function clientWithRestingHeartRate(): Promise<BrowserVaultQueryClient> {
  const dates = ["2026-07-10", "2026-07-11", "2026-07-12", "2026-07-13", "2026-07-14", "2026-07-15"];
  const vault = createVaultReadModel({
    entities: dates.map((date, index) =>
      createObservation(`evt_rhr_${date}`, `${date}T07:00:00.000Z`, {
        metric: "resting-heart-rate",
        source: "manual",
        unit: "bpm",
        value: 60 + (index % 2),
      })),
    metadata: null,
    vaultRoot: "browser://vault",
  });
  return buildClient(vault);
}

async function clientWithoutMetrics(): Promise<BrowserVaultQueryClient> {
  const vault = createVaultReadModel({
    entities: [],
    metadata: null,
    vaultRoot: "browser://vault",
  });
  return buildClient(vault);
}

async function buildClient(
  vault: Parameters<typeof buildMetricProjection>[0],
): Promise<BrowserVaultQueryClient> {
  const replica = await createBrowserVaultReplica({
    generatedAt: "2026-07-16T12:00:00.000Z",
    metricPoints: buildMetricProjection(vault).metricPoints,
    sourceBundleHash: "f".repeat(64),
    vault,
  });
  return createBrowserVaultQueryClient(parseBrowserVaultReplica(replica));
}

function createObservation(
  entityId: string,
  occurredAt: string,
  attributes: Record<string, unknown>,
): CanonicalEntity {
  return {
    attributes,
    body: null,
    date: occurredAt.slice(0, 10),
    entityId,
    experimentSlug: null,
    family: "event",
    frontmatter: null,
    kind: "observation",
    links: [],
    lookupIds: [entityId],
    occurredAt,
    path: `ledger/events/${occurredAt.slice(0, 4)}/${occurredAt.slice(0, 7)}.jsonl`,
    primaryLookupId: entityId,
    recordClass: "ledger",
    relatedIds: [],
    status: null,
    stream: null,
    tags: [],
    title: "Observation",
  } satisfies CanonicalEntity;
}
