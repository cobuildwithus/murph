import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { Ajv2020 } from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";
import { afterEach, describe, expect, it } from "vitest";

import {
  acquireDirectoryLock,
  buildSnapshot,
  claimIncident,
  createInitialState,
  evaluateAnomalies,
  filterSnapshotForIncident,
  parseState,
  parseAdapterEvidence,
  parseProviderEvidence,
  renderActiveIncidents,
  renderIncidentHistory,
  safeErrorCode,
  transitionIncident,
  updateStateFromSnapshot,
  type AdapterEvidence,
  type ProductionWatchSnapshot,
} from "./prod-watch/core.ts";
import {
  renderLaunchdPlistTemplate,
  verifySchedulerExecutableChain,
} from "./prod-watch.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const prodWatchPath = path.join(repoRoot, "scripts", "prod-watch.ts");
const fixtureRoot = path.join(repoRoot, "scripts", "prod-watch", "fixtures");
const addFormats = createRequire(import.meta.url)("ajv-formats") as FormatsPlugin;
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("production-watch snapshot contract", () => {
  it("keeps a healthy fixture bounded, aggregate-only, and quiet", () => {
    const snapshot = buildFixtureSnapshot("healthy", new Date("2026-08-09T20:00:00.000Z"));

    expect(snapshot.schemaVersion).toBe("prod-watch.snapshot.v1");
    expect(snapshot.monitor.status).toBe("partial");
    expect(snapshot.monitor.evidenceComplete).toBe(false);
    expect(snapshot.anomalyCandidates).toEqual([]);
    expect(snapshot.fingerprints).toHaveLength(1);
    expect(snapshot.fingerprints[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/u);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("fixture-healthy-runtime-error");
    expect(serialized).not.toContain("userId");
    expect(serialized).not.toContain("attemptId");
    expect(serialized).not.toContain("prompt");
    expect(serialized).not.toContain("transcript");
  });

  it("marks a complete fresh database and provider envelope healthy", () => {
    const now = new Date("2026-08-09T20:00:00.000Z");
    const provider = parseProviderEvidence(JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as unknown);
    const snapshot = buildSnapshot({
      now,
      runId: "test-complete",
      mode: "collect",
      dryRun: true,
      startedAt: new Date(now.getTime() - 100),
      timeoutMs: 240000,
      skippedOverlap: false,
      previousStart: new Date(now.getTime() - 30 * 60 * 1000),
      currentStart: new Date(now.getTime() - 15 * 60 * 1000),
      end: now,
      lookbackMinutes: 15,
      settlingDelaySeconds: 0,
      configuredSources: ["database", "vercel", "cloudflare", "stripe"],
      evidences: [
        rebaseEvidence(readFixture("healthy"), now),
        ...provider.sources.map((source) => rebaseEvidence(source, now)),
      ],
      failures: [],
    });

    expect(snapshot.monitor).toMatchObject({ status: "healthy", evidenceComplete: true });
    expect(snapshot.sourceHealth.every((source) => source.coverage === "complete")).toBe(true);
    expect(snapshot.anomalyCandidates).toEqual([]);
  });

  it("requires authenticated aggregate collection proof before provider coverage is complete", () => {
    const raw = JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as { sources: Array<{ auth: string; counters: Array<{ metric: string; current: number }> }> };
    raw.sources[0]!.auth = "unknown";
    expect(() => parseProviderEvidence(raw)).toThrow("provider_ok_auth_unproven");

    raw.sources[0]!.auth = "ok";
    raw.sources[0]!.counters = raw.sources[0]!.counters.filter(
      (counter) => counter.metric !== "provider_request_count",
    );
    expect(() => parseProviderEvidence(raw)).toThrow("provider_ok_rate_facts_incomplete");

    const missingTimeout = JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as { sources: Array<{ counters: Array<{ metric: string; current: number }> }> };
    missingTimeout.sources[0]!.counters = missingTimeout.sources[0]!.counters.filter(
      (counter) => counter.metric !== "provider_timeout_count",
    );
    expect(() => parseProviderEvidence(missingTimeout)).toThrow("provider_ok_rate_facts_incomplete");

    const subsetOnly = JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as { sources: Array<{ counters: Array<{ dimensions: Record<string, string> }> }> };
    for (const source of subsetOnly.sources) {
      source.counters = source.counters.filter((counter) => Object.keys(counter.dimensions).length > 1);
    }
    expect(() => parseProviderEvidence(subsetOnly)).toThrow("provider_ok_rate_facts_incomplete");

    const mismatchedDimensions = JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as {
      sources: Array<{
        counters: Array<{ metric: string; dimensions: { source: string; surface: string } }>;
      }>;
    };
    mismatchedDimensions.sources[0]!.counters.find(
      (counter) => counter.metric === "provider_timeout_count",
    )!.dimensions.surface = "different_surface";
    expect(() => parseProviderEvidence(mismatchedDimensions))
      .toThrow("provider_ok_rate_facts_incomplete");

    const duplicateDenominator = JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as { sources: Array<{ counters: Array<{ metric: string; sampleCount?: number }> }> };
    duplicateDenominator.sources[0]!.counters[0]!.sampleCount = 240;
    expect(() => parseProviderEvidence(duplicateDenominator))
      .toThrow("provider_counter_denominator_duplicate");

    const zeroAggregate = JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as { sources: Array<{ counters: Array<{ metric: string; current: number }> }> };
    const requestCount = zeroAggregate.sources[0]!.counters.find(
      (counter) => counter.metric === "provider_request_count",
    );
    requestCount!.current = 0;
    for (const numerator of zeroAggregate.sources[0]!.counters.filter(
      (counter) => counter.metric === "provider_error_count" || counter.metric === "provider_timeout_count",
    )) {
      numerator.current = 0;
    }
    expect(() => parseProviderEvidence(zeroAggregate)).not.toThrow();
  });

  it("keeps unproven direct provider evidence partial even outside envelope parsing", () => {
    const now = new Date("2026-08-09T20:00:00.000Z");
    const provider = parseProviderEvidence(JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as unknown);
    const unproven = structuredClone(
      provider.sources.find((source) => source.source === "vercel")!,
    ) as AdapterEvidence;
    unproven.auth = "unknown";
    unproven.counters = [{
      metric: "provider_error_count",
      dimensions: { source: "vercel", surface: "hosted_web" },
      unit: "count",
      current: 20,
      previous: 1,
      sampleCount: 240,
      previousSampleCount: 230,
    }];
    const snapshot = buildSnapshot({
      now,
      runId: "test-unproven-provider",
      mode: "collect",
      dryRun: true,
      startedAt: new Date(now.getTime() - 100),
      timeoutMs: 240000,
      skippedOverlap: false,
      previousStart: new Date(now.getTime() - 30 * 60 * 1000),
      currentStart: new Date(now.getTime() - 15 * 60 * 1000),
      end: now,
      lookbackMinutes: 15,
      settlingDelaySeconds: 0,
      configuredSources: ["database", "vercel", "cloudflare", "stripe"],
      evidences: [
        rebaseEvidence(readFixture("healthy"), now),
        rebaseEvidence(unproven, now),
        ...provider.sources
          .filter((source) => source.source !== "vercel")
          .map((source) => rebaseEvidence(source, now)),
      ],
      failures: [],
    });

    expect(snapshot.monitor).toMatchObject({ status: "partial", evidenceComplete: false });
    expect(snapshot.sourceHealth.find((source) => source.source === "vercel"))
      .toMatchObject({ status: "ok", auth: "unknown", coverage: "partial" });
    expect(snapshot.anomalyCandidates.some((candidate) => candidate.source === "vercel")).toBe(false);

    const subsetOnly = structuredClone(
      provider.sources.find((source) => source.source === "vercel")!,
    ) as AdapterEvidence;
    subsetOnly.counters = subsetOnly.counters.filter(
      (counter) => Object.keys(counter.dimensions).length > 1,
    );
    const subsetSnapshot = buildSnapshot({
      now,
      runId: "test-subset-provider",
      mode: "collect",
      dryRun: true,
      startedAt: new Date(now.getTime() - 100),
      timeoutMs: 240000,
      skippedOverlap: false,
      previousStart: new Date(now.getTime() - 30 * 60 * 1000),
      currentStart: new Date(now.getTime() - 15 * 60 * 1000),
      end: now,
      lookbackMinutes: 15,
      settlingDelaySeconds: 0,
      configuredSources: ["database", "vercel", "cloudflare", "stripe"],
      evidences: [
        rebaseEvidence(readFixture("healthy"), now),
        rebaseEvidence(subsetOnly, now),
      ],
      failures: [],
    });
    expect(subsetSnapshot.sourceHealth.find((source) => source.source === "vercel")?.coverage)
      .toBe("partial");
    expect(subsetSnapshot.monitor).toMatchObject({ status: "partial", evidenceComplete: false });
  });

  it("retains every bounded mandatory fingerprint and anomaly under capacity pressure", () => {
    const now = new Date("2026-08-09T20:00:00.000Z");
    const provider = parseProviderEvidence(JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as unknown);
    const database = rebaseEvidence(readFixture("healthy"), now);
    const makeSensitiveFingerprints = (source: AdapterEvidence["source"], count: number) =>
      Array.from({ length: count }, (_, index) => ({
        rawFingerprint: `mandatory_${source}_${index}`,
        source,
        component: "privacy_boundary",
        phase: "write",
        severity: "low" as const,
        count: 1,
        previousCount: 0,
        firstSeenAt: new Date(now.getTime() - 60_000).toISOString(),
        lastSeenAt: now.toISOString(),
        errorCode: `privacy_loss_${index}`,
      }));
    database.fingerprints = makeSensitiveFingerprints("database", 13);
    const providers = provider.sources.map((source) => ({
      ...rebaseEvidence(source, now),
      fingerprints: makeSensitiveFingerprints(source.source, 8),
    }));

    const snapshot = buildSnapshot({
      now,
      runId: "test-mandatory-capacity",
      mode: "collect",
      dryRun: true,
      startedAt: new Date(now.getTime() - 100),
      timeoutMs: 240000,
      skippedOverlap: false,
      previousStart: new Date(now.getTime() - 30 * 60 * 1000),
      currentStart: new Date(now.getTime() - 15 * 60 * 1000),
      end: now,
      lookbackMinutes: 15,
      settlingDelaySeconds: 0,
      configuredSources: ["database", "vercel", "cloudflare", "stripe"],
      evidences: [database, ...providers],
      failures: [],
    });

    expect(snapshot.fingerprints).toHaveLength(37);
    expect(snapshot.anomalyCandidates.filter((candidate) => candidate.category === "sensitive"))
      .toHaveLength(37);
    expect(snapshot.redaction).toMatchObject({ maxFingerprints: 37, maxAnomalyCandidates: 245 });
  });

  it("keeps every Stripe anomaly alert-only even when its metric name is generic", () => {
    const now = new Date("2026-08-09T20:00:00.000Z");
    const provider = parseProviderEvidence(JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as unknown);
    const stripe = provider.sources.find((source) => source.source === "stripe");
    const stripeError = stripe?.counters.find((counter) => counter.metric === "provider_error_count");
    expect(stripeError).toBeDefined();
    stripeError!.current = 10;
    stripeError!.previous = 0;

    const snapshot = buildSnapshot({
      now,
      runId: "test-stripe-sensitive",
      mode: "collect",
      dryRun: true,
      startedAt: new Date(now.getTime() - 100),
      timeoutMs: 240000,
      skippedOverlap: false,
      previousStart: new Date(now.getTime() - 30 * 60 * 1000),
      currentStart: new Date(now.getTime() - 15 * 60 * 1000),
      end: now,
      lookbackMinutes: 15,
      settlingDelaySeconds: 0,
      configuredSources: ["database", "vercel", "cloudflare", "stripe"],
      evidences: [
        rebaseEvidence(readFixture("healthy"), now),
        ...provider.sources.map((source) => rebaseEvidence(source, now)),
      ],
      failures: [],
    });
    const anomaly = snapshot.anomalyCandidates.find(
      (candidate) => candidate.source === "stripe" && candidate.ruleId === "error_rate_regression",
    );
    expect(anomaly).toMatchObject({
      severity: "high",
      category: "sensitive",
      automationClass: "alert_only",
      minimumConsecutiveRuns: 2,
    });
  });

  it("keeps provider metric and exact dimensions in anomaly and streak identity", () => {
    const makeSnapshot = (surface: string, now: Date): ProductionWatchSnapshot => {
      const provider = parseProviderEvidence(JSON.parse(
        readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
      ) as unknown);
      const vercel = provider.sources.find((source) => source.source === "vercel")!;
      for (const counter of vercel.counters) {
        if (counter.dimensions.surface !== undefined) {
          counter.dimensions.surface = surface;
        }
      }
      const errors = vercel.counters.find((counter) => (
        counter.metric === "provider_error_count" && counter.dimensions.surface === surface
      ))!;
      errors.current = 20;
      errors.previous = 1;
      return buildSnapshot({
        now,
        runId: `provider-surface-${surface}`,
        mode: "collect",
        dryRun: true,
        startedAt: new Date(now.getTime() - 100),
        timeoutMs: 240000,
        skippedOverlap: false,
        previousStart: new Date(now.getTime() - 30 * 60 * 1000),
        currentStart: new Date(now.getTime() - 15 * 60 * 1000),
        end: now,
        lookbackMinutes: 15,
        settlingDelaySeconds: 0,
        configuredSources: ["database", "vercel", "cloudflare", "stripe"],
        evidences: [
          rebaseEvidence(readFixture("healthy"), now),
          ...provider.sources.map((source) => rebaseEvidence(source, now)),
        ],
        failures: [],
      });
    };

    const api = makeSnapshot("api", new Date("2026-08-09T20:00:00.000Z"));
    const hosted = makeSnapshot("hosted_web", new Date("2026-08-09T20:05:00.000Z"));
    const apiAnomaly = api.anomalyCandidates.find((candidate) => candidate.source === "vercel")!;
    const hostedAnomaly = hosted.anomalyCandidates.find((candidate) => candidate.source === "vercel")!;
    expect(apiAnomaly.fingerprint).not.toBe(hostedAnomaly.fingerprint);

    let state = createInitialState(
      new Date("2026-08-09T19:55:00.000Z"),
      ["database", "vercel", "cloudflare", "stripe"],
    );
    state = updateStateFromSnapshot(state, api).state;
    state = updateStateFromSnapshot(state, hosted).state;
    expect(state.incidents.filter((incident) => incident.source === "vercel")).toHaveLength(0);
    state = updateStateFromSnapshot(
      state,
      makeSnapshot("hosted_web", new Date("2026-08-09T20:10:00.000Z")),
    ).state;
    expect(state.incidents.filter((incident) => incident.source === "vercel")).toHaveLength(1);

    const simultaneous = makeSnapshot("hosted_web", new Date("2026-08-09T20:15:00.000Z"));
    const vercelCounters = simultaneous.counters.filter((counter) => counter.dimensions.source === "vercel");
    vercelCounters.push(
      {
        metric: "provider_request_count",
        dimensions: { source: "vercel", surface: "api" },
        unit: "count",
        current: 240,
        previous: 230,
      },
      {
        metric: "provider_error_count",
        dimensions: { source: "vercel", surface: "api" },
        unit: "count",
        current: 20,
        previous: 1,
      },
      {
        metric: "provider_timeout_count",
        dimensions: { source: "vercel", surface: "api" },
        unit: "count",
        current: 0,
        previous: 0,
      },
      {
        metric: "deployment_error_count",
        dimensions: { source: "vercel", surface: "hosted_web" },
        unit: "count",
        current: 20,
        previous: 1,
      },
    );
    simultaneous.counters = [
      ...simultaneous.counters.filter((counter) => counter.dimensions.source !== "vercel"),
      ...vercelCounters,
    ];
    simultaneous.anomalyCandidates = evaluateAnomalies({
      now: new Date(simultaneous.generatedAt),
      sourceHealth: simultaneous.sourceHealth,
      releaseContext: simultaneous.releaseContext,
      counters: simultaneous.counters,
      latency: simultaneous.latency,
      fingerprints: simultaneous.fingerprints,
      failures: simultaneous.collectorFailures,
    });
    const simultaneousVercel = simultaneous.anomalyCandidates.filter((candidate) => (
      candidate.source === "vercel" && candidate.ruleId === "error_rate_regression"
    ));
    expect(simultaneousVercel).toHaveLength(3);
    expect(new Set(simultaneousVercel.map((candidate) => candidate.fingerprint)).size).toBe(3);
    expect(simultaneousVercel.map((candidate) => candidate.signalCode)).toEqual(expect.arrayContaining([
      "deployment_error_count|source=vercel|surface=hosted_web",
      "provider_error_count|source=vercel|surface=api",
      "provider_error_count|source=vercel|surface=hosted_web",
    ]));

    let simultaneousState = createInitialState(
      new Date("2026-08-09T20:10:00.000Z"),
      ["database", "vercel", "cloudflare", "stripe"],
    );
    simultaneousState = updateStateFromSnapshot(simultaneousState, simultaneous).state;
    const repeated = structuredClone(simultaneous) as ProductionWatchSnapshot;
    repeated.generatedAt = "2026-08-09T20:20:00.000Z";
    repeated.run.runId = "provider-surface-repeat";
    repeated.run.startedAt = "2026-08-09T20:19:59.900Z";
    repeated.run.finishedAt = repeated.generatedAt;
    simultaneousState = updateStateFromSnapshot(simultaneousState, repeated).state;
    expect(simultaneousState.incidents.filter((incident) => incident.source === "vercel"))
      .toHaveLength(0);
    const newerObservation = structuredClone(repeated) as ProductionWatchSnapshot;
    newerObservation.generatedAt = "2026-08-09T20:25:00.000Z";
    newerObservation.run.runId = "provider-surface-new-observation";
    newerObservation.run.startedAt = "2026-08-09T20:24:59.900Z";
    newerObservation.run.finishedAt = newerObservation.generatedAt;
    const vercelHealth = newerObservation.sourceHealth.find((health) => health.source === "vercel")!;
    vercelHealth.collectedAt = "2026-08-09T20:23:00.000Z";
    vercelHealth.freshnessSeconds = 120;
    simultaneousState = updateStateFromSnapshot(simultaneousState, newerObservation).state;
    const rendered = renderActiveIncidents(simultaneousState);
    expect(rendered).toContain("surface=api");
    expect(rendered).toContain("surface=hosted_web");
  });

  it("advances provider streaks only for newer source observations", () => {
    const makeProviderSnapshot = (now: Date, anomalous: boolean): ProductionWatchSnapshot => {
      const provider = parseProviderEvidence(JSON.parse(
        readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
      ) as unknown);
      if (anomalous) {
        const vercel = provider.sources.find((source) => source.source === "vercel")!;
        const errors = vercel.counters.find((counter) => (
          counter.metric === "provider_error_count"
          && counter.dimensions.surface === "hosted_web"
        ))!;
        errors.current = 20;
        errors.previous = 1;
      }
      return buildSnapshot({
        now,
        runId: `provider-observation-${now.toISOString()}`,
        mode: "collect",
        dryRun: true,
        startedAt: new Date(now.getTime() - 100),
        timeoutMs: 240000,
        skippedOverlap: false,
        previousStart: new Date(now.getTime() - 30 * 60 * 1000),
        currentStart: new Date(now.getTime() - 15 * 60 * 1000),
        end: now,
        lookbackMinutes: 15,
        settlingDelaySeconds: 0,
        configuredSources: ["database", "vercel", "cloudflare", "stripe"],
        evidences: [
          rebaseEvidence(readFixture("healthy"), now),
          ...provider.sources.map((source) => rebaseEvidence(source, now)),
        ],
        failures: [],
      });
    };

    const first = makeProviderSnapshot(new Date("2026-08-09T20:00:00.000Z"), true);
    const fingerprint = first.anomalyCandidates.find((candidate) => candidate.source === "vercel")!
      .fingerprint;
    let state = createInitialState(
      new Date("2026-08-09T19:55:00.000Z"),
      ["database", "vercel", "cloudflare", "stripe"],
    );
    state = updateStateFromSnapshot(state, first).state;

    const replay = structuredClone(first) as ProductionWatchSnapshot;
    replay.generatedAt = "2026-08-09T20:05:00.000Z";
    replay.run.runId = "provider-observation-replay";
    replay.run.finishedAt = replay.generatedAt;
    state = updateStateFromSnapshot(state, replay).state;
    expect(state.anomalyStreaks[fingerprint]?.count).toBe(1);
    expect(state.incidents.some((incident) => incident.fingerprint === fingerprint)).toBe(false);

    state = updateStateFromSnapshot(
      state,
      buildFixtureSnapshot("healthy", new Date("2026-08-09T20:07:00.000Z")),
    ).state;
    expect(state.anomalyStreaks[fingerprint]?.count).toBe(1);
    state = updateStateFromSnapshot(
      state,
      makeProviderSnapshot(new Date("2026-08-09T20:10:00.000Z"), true),
    ).state;
    expect(state.incidents.some((incident) => incident.fingerprint === fingerprint)).toBe(true);

    state = updateStateFromSnapshot(
      state,
      makeProviderSnapshot(new Date("2026-08-09T20:15:00.000Z"), false),
    ).state;
    expect(state.anomalyStreaks[fingerprint]).toBeUndefined();

    let expired = createInitialState(
      new Date("2026-08-09T19:55:00.000Z"),
      ["database", "vercel", "cloudflare", "stripe"],
    );
    expired = updateStateFromSnapshot(expired, first).state;
    expired = updateStateFromSnapshot(
      expired,
      buildFixtureSnapshot("healthy", new Date("2026-08-09T22:01:00.000Z")),
    ).state;
    expect(expired.anomalyStreaks[fingerprint]).toBeUndefined();
  });

  it("scores production anomalies only from fresh complete successful source evidence", () => {
    type EvidenceMode = "degraded" | "failed" | "fresh" | "stale" | "unauthenticated" | "unavailable";
    const makeSnapshot = (mode: EvidenceMode, now: Date): ProductionWatchSnapshot => {
      const provider = parseProviderEvidence(JSON.parse(
        readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
      ) as unknown);
      const evidences = provider.sources.map((source) => rebaseEvidence(source, now));
      const vercel = evidences.find((source) => source.source === "vercel")!;
      const errors = vercel.counters.find((counter) => (
        counter.metric === "provider_error_count"
        && counter.dimensions.surface === "hosted_web"
      ))!;
      errors.current = 20;
      errors.previous = 1;
      const failures = [] as Array<{
        source: "vercel";
        class: "rate_limit";
        code: string;
        retryable: boolean;
      }>;
      if (mode === "degraded") {
        vercel.status = "degraded";
        failures.push({ source: "vercel", class: "rate_limit", code: "rate_limited", retryable: true });
      } else if (mode === "failed") {
        failures.push({ source: "vercel", class: "rate_limit", code: "rate_limited", retryable: true });
      } else if (mode === "stale") {
        vercel.collectedAt = new Date(now.getTime() - 1_901_000).toISOString();
        vercel.freshnessSeconds = 1_901;
      } else if (mode === "unauthenticated") {
        vercel.auth = "failed";
      } else if (mode === "unavailable") {
        vercel.status = "unavailable";
        vercel.auth = "unknown";
        vercel.releaseContext = [];
        vercel.counters = [];
        vercel.latency = [];
        vercel.fingerprints = [];
      }
      return buildSnapshot({
        now,
        runId: `${mode}-${now.toISOString()}`,
        mode: "collect",
        dryRun: true,
        startedAt: new Date(now.getTime() - 100),
        timeoutMs: 240000,
        skippedOverlap: false,
        previousStart: new Date(now.getTime() - 30 * 60 * 1000),
        currentStart: new Date(now.getTime() - 15 * 60 * 1000),
        end: now,
        lookbackMinutes: 15,
        settlingDelaySeconds: 0,
        configuredSources: ["database", "vercel", "cloudflare", "stripe"],
        evidences: [rebaseEvidence(readFixture("healthy"), now), ...evidences],
        failures,
      });
    };

    for (const mode of ["degraded", "failed", "stale", "unauthenticated", "unavailable"] as const) {
      const first = makeSnapshot(mode, new Date("2026-08-09T20:00:00.000Z"));
      const second = makeSnapshot(mode, new Date("2026-08-09T20:05:00.000Z"));
      const vercelCandidates = first.anomalyCandidates.filter((candidate) => candidate.source === "vercel");
      expect(vercelCandidates.length).toBeGreaterThan(0);
      expect(vercelCandidates.every((candidate) => candidate.category === "monitor")).toBe(true);
      expect(first.counters.some((counter) => counter.dimensions.source === "vercel")).toBe(false);
      expect(first.latency.some((summary) => summary.dimensions.source === "vercel")).toBe(false);
      expect(first.fingerprints.some((fingerprint) => fingerprint.source === "vercel")).toBe(false);
      expect(first.releaseContext.some((release) => release.source === "vercel")).toBe(false);
      let state = createInitialState(
        new Date("2026-08-09T19:55:00.000Z"),
        ["database", "vercel", "cloudflare", "stripe"],
      );
      state = updateStateFromSnapshot(state, first).state;
      state = updateStateFromSnapshot(state, second).state;
      const vercelIncidents = state.incidents.filter((incident) => incident.source === "vercel");
      expect(vercelIncidents.length).toBeGreaterThan(0);
      expect(vercelIncidents.every((incident) => incident.category === "monitor")).toBe(true);
    }

    const firstFresh = makeSnapshot("fresh", new Date("2026-08-09T20:00:00.000Z"));
    const secondFresh = makeSnapshot("fresh", new Date("2026-08-09T20:05:00.000Z"));
    expect(firstFresh.anomalyCandidates).toContainEqual(expect.objectContaining({
      source: "vercel",
      ruleId: "error_rate_regression",
      signalCode: "provider_error_count|source=vercel|surface=hosted_web",
    }));
    let freshState = createInitialState(
      new Date("2026-08-09T19:55:00.000Z"),
      ["database", "vercel", "cloudflare", "stripe"],
    );
    freshState = updateStateFromSnapshot(freshState, firstFresh).state;
    freshState = updateStateFromSnapshot(freshState, secondFresh).state;
    expect(freshState.incidents).toContainEqual(expect.objectContaining({
      source: "vercel",
      ruleId: "error_rate_regression",
    }));
  });

  it("treats clinical, consent, and integrity code paths as sensitive", () => {
    const evidence = readFixture("healthy");
    evidence.fingerprints[0]!.component = "clinical_record_write";
    evidence.fingerprints[0]!.errorCode = "canonical_write_corrupt";
    const snapshot = buildFromEvidence(evidence, new Date("2026-08-09T20:00:00.000Z"));
    expect(snapshot.anomalyCandidates.find((candidate) => candidate.ruleId === "sensitive_domain_signal"))
      .toMatchObject({ automationClass: "alert_only", severity: "high" });
  });

  it("retains canonical operation identity for sensitive policy and exact fingerprint drill-down", () => {
    const evidence = readFixture("healthy");
    const generic = {
      ...evidence.fingerprints[0]!,
      component: "assistant.tool",
      phase: "tool_call",
      severity: "low" as const,
      errorCode: "tool_error",
      issueKind: "tool_error",
      surface: "hosted",
      count: 1,
      previousCount: 0,
    };
    evidence.fingerprints = [
      {
        ...generic,
        rawFingerprint: "fixture-generic-subscription-tool-error",
        operation: "murph.subscription",
      },
      {
        ...generic,
        rawFingerprint: "fixture-generic-weather-tool-error",
        operation: "murph.weather",
      },
    ];
    const snapshot = buildFromEvidence(evidence, new Date("2026-08-09T20:00:00.000Z"));
    const subscriptionFingerprint = snapshot.fingerprints.find(
      (fingerprint) => fingerprint.operation === "murph.subscription",
    )!;
    const weatherFingerprint = snapshot.fingerprints.find(
      (fingerprint) => fingerprint.operation === "murph.weather",
    )!;
    expect(snapshot.anomalyCandidates).toContainEqual(expect.objectContaining({
      ruleId: "sensitive_domain_signal",
      sourceFingerprint: subscriptionFingerprint.fingerprint,
      minimumConsecutiveRuns: 1,
    }));
    expect(snapshot.anomalyCandidates.some(
      (candidate) => candidate.sourceFingerprint === weatherFingerprint.fingerprint,
    )).toBe(false);

    const state = updateStateFromSnapshot(
      createInitialState(new Date("2026-08-09T19:55:00.000Z"), ["database"]),
      snapshot,
    ).state;
    const incident = state.incidents.find(
      (candidate) => candidate.sourceFingerprint === subscriptionFingerprint.fingerprint,
    )!;
    const filtered = filterSnapshotForIncident(snapshot, incident);
    expect(filtered.fingerprints.map((fingerprint) => fingerprint.fingerprint))
      .toEqual([subscriptionFingerprint.fingerprint]);
  });

  it("flags sensitive domains for escalation and requires repeated windows for noisy regressions", () => {
    const snapshot = buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:00:00.000Z"));
    const sensitive = snapshot.anomalyCandidates.find((candidate) => candidate.ruleId === "sensitive_domain_signal");
    const errorCount = snapshot.anomalyCandidates.find((candidate) => candidate.ruleId === "error_count_regression");

    expect(sensitive).toMatchObject({
      severity: "high",
      automationClass: "alert_only",
      minimumConsecutiveRuns: 1,
    });
    expect(errorCount).toMatchObject({
      automationClass: "remediation_candidate",
      minimumConsecutiveRuns: 2,
      deploymentCorrelated: true,
    });
  });

  it("deduplicates stable incidents across repeated windows and release changes", () => {
    const first = buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:00:00.000Z"));
    const secondEvidence = readFixture("suspicious");
    secondEvidence.releaseContext = secondEvidence.releaseContext.map((release) => ({
      ...release,
      sha: "cccccccccccccccccccccccccccccccccccccccc",
    }));
    secondEvidence.fingerprints = secondEvidence.fingerprints.map((fingerprint) => ({
      ...fingerprint,
      releaseSha: "cccccccccccccccccccccccccccccccccccccccc",
    }));
    const second = buildFromEvidence(secondEvidence, new Date("2026-08-09T20:05:00.000Z"));
    const firstError = first.anomalyCandidates.find((candidate) => candidate.ruleId === "error_count_regression");
    const secondError = second.anomalyCandidates.find((candidate) => candidate.ruleId === "error_count_regression");

    expect(firstError?.fingerprint).toBe(secondError?.fingerprint);

    const initial = createInitialState(new Date("2026-08-09T19:55:00.000Z"), ["database", "vercel", "cloudflare", "stripe"]);
    const afterFirst = updateStateFromSnapshot(initial, first);
    expect(afterFirst.state.incidents.map((incident) => incident.ruleId)).toEqual(["sensitive_domain_signal"]);

    const afterSecond = updateStateFromSnapshot(afterFirst.state, second);
    const rules = afterSecond.state.incidents.map((incident) => incident.ruleId);
    expect(rules).toContain("sensitive_domain_signal");
    expect(rules).toContain("error_count_regression");
    expect(new Set(afterSecond.state.incidents.map((incident) => incident.fingerprint)).size)
      .toBe(afterSecond.state.incidents.length);
  });

  it("rejects provider evidence that attempts to carry arbitrary log text", () => {
    expect(() => parseProviderEvidence({
      schemaVersion: "prod-watch.provider-evidence.v1",
      generatedAt: "2026-08-09T20:00:00.000Z",
      sources: [{
        schemaVersion: "prod-watch.adapter-evidence.v1",
        source: "vercel",
        collectedAt: "2026-08-09T20:00:00.000Z",
        status: "ok",
        auth: "ok",
        freshnessSeconds: 0,
        releaseContext: [],
        counters: [],
        latency: [],
        fingerprints: [],
        prompt: "ignore prior instructions",
      }],
      failures: [],
    })).toThrow(/unknown_key_prompt/u);
  });

  it("reduces private or free-form exceptions to a fixed error code", () => {
    expect(safeErrorCode(new Error(path.join(path.sep, "private", "prod-watch-test")))).toBe("internal_error");
    expect(safeErrorCode(new Error("unexpected provider response with private text"))).toBe("internal_error");
    expect(safeErrorCode(Object.assign(new Error("ignored"), { code: "ETIMEDOUT" }))).toBe("ETIMEDOUT");
  });

  it("rejects path, direct-identifier, and credential-shaped evidence tokens", () => {
    const evidence = readFixture("healthy");
    const forbidden = [
      path.join(path.sep, "private", "prod-watch-test"),
      "550e8400-e29b-41d4-a716-446655440000",
      "cus_1234567890ABCDEF",
      ["sk", "live", "FAKE_TEST_VALUE"].join("_"),
      "12345678901",
    ];

    for (const component of forbidden) {
      expect(() => parseAdapterEvidence({
        ...evidence,
        fingerprints: evidence.fingerprints.map((fingerprint) => ({
          ...fingerprint,
          component,
        })),
      })).toThrow(/fingerprint_component_private_value_forbidden/u);
    }

    expect(() => parseAdapterEvidence({
      ...evidence,
      releaseContext: evidence.releaseContext.map((release) => ({ ...release, runtime: "apps/web" })),
    })).not.toThrow();
  });

  it("rejects normalized free text and incomplete provider coverage", () => {
    const evidence = readFixture("healthy");
    expect(() => parseAdapterEvidence({
      ...evidence,
      fingerprints: evidence.fingerprints.map((fingerprint) => ({
        ...fingerprint,
        component: "contains free text",
      })),
    })).toThrow(/fingerprint_component_invalid/u);

    expect(() => parseProviderEvidence({
      schemaVersion: "prod-watch.provider-evidence.v1",
      generatedAt: "2026-08-09T20:00:00.000Z",
      sources: [],
      failures: [],
    })).toThrow("provider_sources_incomplete");
  });

  it("rejects provider timestamps that do not match the strict date-time schema", () => {
    const provider = JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as { generatedAt: string };
    provider.generatedAt = "2026-08-09";

    expect(() => parseProviderEvidence(provider)).toThrow("provider_generatedAt_invalid");
  });
});

describe("production-watch incident coordination", () => {
  it("enforces one owner per incident and records human-readable projections", () => {
    const snapshot = buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:00:00.000Z"));
    const promoted = buildPromotedSuspiciousState();
    const incident = promoted.incidents[0];
    expect(incident).toBeDefined();

    const claimed = claimIncident(promoted, incident!.fingerprint, "session-a", new Date("2026-08-09T20:01:00.000Z"), 15);
    expect(() => claimIncident(claimed, incident!.fingerprint, "session-b", new Date("2026-08-09T20:02:00.000Z"), 15))
      .toThrow("incident_already_claimed");

    const escalated = transitionIncident(
      claimed,
      incident!.fingerprint,
      "session-a",
      "escalated",
      new Date("2026-08-09T20:03:00.000Z"),
    );
    expect(renderActiveIncidents(escalated)).toContain("session-a");
    expect(renderActiveIncidents(escalated)).toContain(incident!.id);
    expect(renderIncidentHistory(escalated)).toContain(incident!.id);
    expect(renderIncidentHistory(escalated)).toContain(incident!.fingerprint.slice(0, 16));
  });

  it("keeps drill-down anomalies scoped when unrelated incidents lack source fingerprints", () => {
    const snapshot = buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:00:00.000Z"));
    const primary = snapshot.anomalyCandidates.find(
      (candidate) => candidate.source === "database" && candidate.sourceFingerprint === undefined,
    );
    expect(primary).toBeDefined();
    snapshot.anomalyCandidates.push({
      ...primary!,
      fingerprint: "f".repeat(64),
      source: "vercel",
      signalCode: "unrelated_vercel_signal",
    });
    const promoted = buildPromotedSuspiciousState();
    const incident = promoted.incidents.find((candidate) => candidate.fingerprint === primary!.fingerprint);
    expect(incident).toBeDefined();

    const filtered = filterSnapshotForIncident(snapshot, incident!);
    expect(filtered.anomalyCandidates.map((candidate) => candidate.fingerprint))
      .toEqual([primary!.fingerprint]);
  });

  it("keeps metric incident labels and database drill-down scoped to the exact signal", () => {
    const buildIngressSnapshot = (now: Date): ProductionWatchSnapshot => {
      const evidence = readFixture("suspicious");
      const linqCounters = evidence.counters.filter((counter) => (
        ["ingress_accepted_count", "ingress_incomplete_count"].includes(counter.metric)
        && counter.dimensions.surface === "linq"
      ));
      evidence.counters.push(...linqCounters.map((counter) => ({
        ...counter,
        dimensions: { ...counter.dimensions, surface: "telegram" },
      })));
      return buildSnapshot({
        now,
        runId: `database-ingress-${now.toISOString()}`,
        mode: "collect",
        dryRun: true,
        startedAt: new Date(now.getTime() - 100),
        timeoutMs: 240000,
        skippedOverlap: false,
        previousStart: new Date(now.getTime() - 30 * 60 * 1000),
        currentStart: new Date(now.getTime() - 15 * 60 * 1000),
        end: now,
        lookbackMinutes: 15,
        settlingDelaySeconds: 0,
        configuredSources: ["database"],
        evidences: [rebaseEvidence(evidence, now)],
        failures: [],
      });
    };

    const first = buildIngressSnapshot(new Date("2026-08-09T20:00:00.000Z"));
    const second = buildIngressSnapshot(new Date("2026-08-09T20:05:00.000Z"));
    let state = createInitialState(new Date("2026-08-09T19:55:00.000Z"), ["database"]);
    state = updateStateFromSnapshot(state, first).state;
    state = updateStateFromSnapshot(state, second).state;
    const ingressIncidents = state.incidents.filter((incident) => (
      incident.ruleId === "timeout_rate_regression"
    ));
    expect(ingressIncidents).toHaveLength(2);
    const linq = ingressIncidents.find((incident) => incident.signalCode.includes("surface=linq"));
    const telegram = ingressIncidents.find((incident) => incident.signalCode.includes("surface=telegram"));
    expect(linq).toBeDefined();
    expect(telegram).toBeDefined();

    const sourceMismatch = structuredClone(state);
    sourceMismatch.incidents.find((incident) => incident.fingerprint === linq!.fingerprint)!
      .signalCode = linq!.signalCode.replace("source=database", "source=vercel");
    expect(() => parseState(sourceMismatch)).toThrow("incident_signal_source_mismatch");

    for (const [incident, surface] of [[linq!, "linq"], [telegram!, "telegram"]] as const) {
      const filtered = filterSnapshotForIncident(second, incident);
      expect(filtered.counters.map((counter) => counter.metric).sort()).toEqual([
        "ingress_accepted_count",
        "ingress_incomplete_count",
      ]);
      expect(filtered.counters.every((counter) => counter.dimensions.surface === surface)).toBe(true);
      expect(filtered.anomalyCandidates.map((candidate) => candidate.fingerprint))
        .toEqual([incident.fingerprint]);
    }

    const fingerprintIncident = state.incidents.find((incident) => incident.sourceFingerprint !== undefined);
    expect(fingerprintIncident).toBeDefined();
    const fingerprintDrillDown = filterSnapshotForIncident(second, fingerprintIncident!);
    expect(fingerprintDrillDown.fingerprints.map((fingerprint) => fingerprint.fingerprint))
      .toEqual([fingerprintIncident!.sourceFingerprint]);
  });

  it("does not downgrade a durable escalation when its triage lease expires", () => {
    const snapshot = buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:00:00.000Z"));
    const initial = createInitialState(new Date("2026-08-09T19:55:00.000Z"), ["database"]);
    const promoted = updateStateFromSnapshot(initial, snapshot).state;
    const incident = promoted.incidents[0]!;
    let state = claimIncident(promoted, incident.fingerprint, "session-a", new Date("2026-08-09T20:01:00.000Z"), 5);
    state = transitionIncident(state, incident.fingerprint, "session-a", "escalated", new Date("2026-08-09T20:02:00.000Z"));

    const roundTrip = parseState(JSON.parse(JSON.stringify(state)) as unknown);
    const afterExpiry = claimIncident(roundTrip, incident.fingerprint, "session-b", new Date("2026-08-09T20:07:00.000Z"), 5);
    const recovered = afterExpiry.incidents.find((candidate) => candidate.fingerprint === incident.fingerprint);
    expect(recovered).toMatchObject({
      state: "escalated",
      owner: { sessionId: "session-b" },
    });
    expect(recovered?.transitions.at(-2)).toMatchObject({ from: "escalated", to: "escalated" });
  });

  it("never relaxes an existing sensitive incident policy and rejects inconsistent state", () => {
    const now = new Date("2026-08-09T20:00:00.000Z");
    const snapshot = buildFixtureSnapshot("suspicious", now);
    const initial = createInitialState(new Date("2026-08-09T19:55:00.000Z"), ["database"]);
    const promoted = updateStateFromSnapshot(initial, snapshot).state;
    const sensitive = promoted.incidents.find((incident) => incident.category === "sensitive")!;
    const recurring = buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:05:00.000Z"));
    const recurringCandidate = recurring.anomalyCandidates.find(
      (candidate) => candidate.fingerprint === sensitive.fingerprint,
    )!;
    recurringCandidate.category = "availability";
    recurringCandidate.automationClass = "remediation_candidate";
    const updated = updateStateFromSnapshot(promoted, recurring).state;
    expect(updated.incidents.find((incident) => incident.fingerprint === sensitive.fingerprint)).toMatchObject({
      category: "sensitive",
      automationClass: "alert_only",
    });

    const corrupted = JSON.parse(JSON.stringify(updated)) as {
      incidents: Array<{ state: string; resolvedAt?: string }>;
    };
    corrupted.incidents[0]!.state = "resolved";
    delete corrupted.incidents[0]!.resolvedAt;
    expect(() => parseState(corrupted)).toThrow("incident_transition_tail_invalid");
  });

  it("rejects malformed optional monitor fields instead of treating them as absent", () => {
    const initial = createInitialState(new Date("2026-08-09T20:00:00.000Z"), ["database"]);
    for (const [field, value, errorCode] of [
      ["lastRunAt", 123, "lastRunAt_invalid"],
      ["lastDurationMs", "240", "lastDurationMs_invalid"],
    ] as const) {
      const malformed = {
        ...initial,
        monitor: {
          ...initial.monitor,
          [field]: value,
        },
      };

      expect(() => parseState(malformed)).toThrow(errorCode);
    }
  });

  it("requires later fresh complete evidence before resolving a nonsensitive incident", () => {
    const promoted = buildPromotedSuspiciousState();
    const incident = promoted.incidents.find((candidate) => candidate.category !== "sensitive")!;
    expect(incident).toBeDefined();
    const claimed = claimIncident(promoted, incident.fingerprint, "session-a", new Date("2026-08-09T20:06:00.000Z"), 15);

    expect(() => transitionIncident(
      claimed,
      incident.fingerprint,
      "session-a",
      "resolved",
      new Date("2026-08-09T20:07:00.000Z"),
    )).toThrow("incident_transition_invalid_claimed_triage_to_resolved");

    const confirmed = transitionIncident(
      claimed,
      incident.fingerprint,
      "session-a",
      "confirmed",
      new Date("2026-08-09T20:07:00.000Z"),
    );
    expect(() => transitionIncident(
      confirmed,
      incident.fingerprint,
      "session-a",
      "resolved",
      new Date("2026-08-09T20:08:00.000Z"),
    )).toThrow("incident_terminal_evidence_incomplete");

    const cleanSnapshot = buildCompleteSnapshot(new Date("2026-08-09T20:10:00.000Z"));
    const afterCleanEvidence = updateStateFromSnapshot(confirmed, cleanSnapshot).state;
    const resolved = transitionIncident(
      afterCleanEvidence,
      incident.fingerprint,
      "session-a",
      "resolved",
      new Date("2026-08-09T20:11:00.000Z"),
    );
    expect(resolved.incidents.find((candidate) => candidate.fingerprint === incident.fingerprint)).toMatchObject({
      state: "resolved",
      resolvedAt: "2026-08-09T20:11:00.000Z",
    });
    expect(resolved.incidents.find((candidate) => candidate.fingerprint === incident.fingerprint)?.owner).toBeUndefined();
  });

  it("records a current recurrence before the new-incident streak gate permits resolution", () => {
    const first = buildCompleteSnapshotWithDatabase("suspicious", new Date("2026-08-09T20:00:00.000Z"));
    const second = buildCompleteSnapshotWithDatabase("suspicious", new Date("2026-08-09T20:05:00.000Z"));
    let state = createInitialState(
      new Date("2026-08-09T19:55:00.000Z"),
      ["database", "vercel", "cloudflare", "stripe"],
    );
    state = updateStateFromSnapshot(state, first).state;
    state = updateStateFromSnapshot(state, second).state;
    const incident = state.incidents.find((candidate) => (
      candidate.source === "database" && candidate.category !== "sensitive"
    ))!;
    expect(incident).toBeDefined();
    state = claimIncident(state, incident.fingerprint, "session-recurrence", new Date("2026-08-09T20:06:00.000Z"), 30);
    state = transitionIncident(
      state,
      incident.fingerprint,
      "session-recurrence",
      "confirmed",
      new Date("2026-08-09T20:07:00.000Z"),
    );

    state = updateStateFromSnapshot(
      state,
      buildCompleteSnapshot(new Date("2026-08-09T20:10:00.000Z")),
    ).state;
    state = updateStateFromSnapshot(
      state,
      buildCompleteSnapshotWithDatabase("suspicious", new Date("2026-08-09T20:15:00.000Z")),
    ).state;
    expect(state.anomalyStreaks[incident.fingerprint]?.count).toBe(1);
    expect(state.incidents.find((candidate) => candidate.fingerprint === incident.fingerprint)?.lastDetectedAt)
      .toBe("2026-08-09T20:15:00.000Z");
    expect(() => transitionIncident(
      state,
      incident.fingerprint,
      "session-recurrence",
      "resolved",
      new Date("2026-08-09T20:16:00.000Z"),
    )).toThrow("incident_resolution_requires_later_clean_evidence");

    state = updateStateFromSnapshot(
      state,
      buildCompleteSnapshot(new Date("2026-08-09T20:20:00.000Z")),
    ).state;
    expect(transitionIncident(
      state,
      incident.fingerprint,
      "session-recurrence",
      "resolved",
      new Date("2026-08-09T20:21:00.000Z"),
    ).incidents.find((candidate) => candidate.fingerprint === incident.fingerprint)?.state)
      .toBe("resolved");
  });

  it("rejects terminal transitions for sensitive incidents and stale or still-observed evidence", () => {
    const promoted = buildPromotedSuspiciousState();
    const sensitive = promoted.incidents.find((candidate) => candidate.category === "sensitive")!;
    let sensitiveState = claimIncident(
      promoted,
      sensitive.fingerprint,
      "session-sensitive",
      new Date("2026-08-09T20:06:00.000Z"),
      15,
    );
    sensitiveState = transitionIncident(
      sensitiveState,
      sensitive.fingerprint,
      "session-sensitive",
      "confirmed",
      new Date("2026-08-09T20:07:00.000Z"),
    );
    sensitiveState = updateStateFromSnapshot(
      sensitiveState,
      buildCompleteSnapshot(new Date("2026-08-09T20:10:00.000Z")),
    ).state;
    expect(() => transitionIncident(
      sensitiveState,
      sensitive.fingerprint,
      "session-sensitive",
      "resolved",
      new Date("2026-08-09T20:11:00.000Z"),
    )).toThrow("incident_terminal_escalation_only");

    const nonsensitive = promoted.incidents.find((candidate) => candidate.category !== "sensitive")!;
    let nonsensitiveState = claimIncident(
      promoted,
      nonsensitive.fingerprint,
      "session-normal",
      new Date("2026-08-09T20:06:00.000Z"),
      60,
    );
    nonsensitiveState = transitionIncident(
      nonsensitiveState,
      nonsensitive.fingerprint,
      "session-normal",
      "confirmed",
      new Date("2026-08-09T20:07:00.000Z"),
    );
    const stillObserved = buildCompleteSnapshot(new Date("2026-08-09T20:10:00.000Z"));
    stillObserved.anomalyCandidates = [
      buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:10:00.000Z")).anomalyCandidates
        .find((candidate) => candidate.fingerprint === nonsensitive.fingerprint)!,
    ].map((candidate) => ({ ...candidate, observedAt: stillObserved.generatedAt }));
    nonsensitiveState = updateStateFromSnapshot(nonsensitiveState, stillObserved).state;
    expect(() => transitionIncident(
      nonsensitiveState,
      nonsensitive.fingerprint,
      "session-normal",
      "resolved",
      new Date("2026-08-09T20:11:00.000Z"),
    )).toThrow("incident_resolution_requires_later_clean_evidence");

    const clean = updateStateFromSnapshot(
      nonsensitiveState,
      buildCompleteSnapshot(new Date("2026-08-09T20:15:00.000Z")),
    ).state;
    expect(() => transitionIncident(
      clean,
      nonsensitive.fingerprint,
      "session-normal",
      "resolved",
      new Date("2026-08-09T20:25:00.001Z"),
    )).toThrow("incident_terminal_evidence_stale");
  });

  it("allows false-positive classification only from complete current nonsensitive evidence", () => {
    const promoted = buildPromotedSuspiciousState();
    const nonsensitive = promoted.incidents.find((candidate) => candidate.category !== "sensitive")!;
    const claimed = claimIncident(
      promoted,
      nonsensitive.fingerprint,
      "session-false-positive",
      new Date("2026-08-09T20:06:00.000Z"),
      15,
    );
    expect(() => transitionIncident(
      claimed,
      nonsensitive.fingerprint,
      "session-false-positive",
      "false_positive",
      new Date("2026-08-09T20:07:00.000Z"),
    )).toThrow("incident_terminal_evidence_incomplete");

    const complete = updateStateFromSnapshot(
      claimed,
      buildCompleteSnapshot(new Date("2026-08-09T20:10:00.000Z")),
    ).state;
    const degraded = structuredClone(complete);
    degraded.monitor.lastMonitorStatus = "degraded";
    degraded.monitor.lastEvidenceComplete = false;
    expect(() => transitionIncident(
      degraded,
      nonsensitive.fingerprint,
      "session-false-positive",
      "false_positive",
      new Date("2026-08-09T20:11:00.000Z"),
    )).toThrow("incident_terminal_evidence_incomplete");
    expect(transitionIncident(
      complete,
      nonsensitive.fingerprint,
      "session-false-positive",
      "false_positive",
      new Date("2026-08-09T20:11:00.000Z"),
    ).incidents.find((candidate) => candidate.fingerprint === nonsensitive.fingerprint)?.state)
      .toBe("false_positive");

    const sensitive = promoted.incidents.find((candidate) => candidate.category === "sensitive")!;
    const sensitiveClaimed = claimIncident(
      promoted,
      sensitive.fingerprint,
      "session-sensitive-false-positive",
      new Date("2026-08-09T20:06:00.000Z"),
      15,
    );
    const sensitiveComplete = updateStateFromSnapshot(
      sensitiveClaimed,
      buildCompleteSnapshot(new Date("2026-08-09T20:10:00.000Z")),
    ).state;
    expect(() => transitionIncident(
      sensitiveComplete,
      sensitive.fingerprint,
      "session-sensitive-false-positive",
      "false_positive",
      new Date("2026-08-09T20:11:00.000Z"),
    )).toThrow("incident_terminal_escalation_only");
  });
});

describe("production-watch locking and dry-run behavior", () => {
  it("recovers a stale lock but does not steal a live lock", async () => {
    const root = makeTempRoot();
    const stalePath = path.join(root, "stale.lock");
    mkdirSync(stalePath, { recursive: true });
    writeFileSync(path.join(stalePath, "claim-stale.json"), JSON.stringify({
      pid: 99999999,
      runId: "stale",
      startedAt: "2026-08-09T19:00:00.000Z",
    }));

    const recovered = await acquireDirectoryLock({
      lockPath: stalePath,
      runId: "recovered",
      purpose: "test",
      waitMs: 0,
      staleMetadataGraceMs: 0,
    });
    expect(recovered.acquired).toBe(true);
    await recovered.release?.();

    const livePath = path.join(root, "live.lock");
    mkdirSync(livePath, { recursive: true });
    writeFileSync(path.join(livePath, "claim-live.json"), JSON.stringify({
      pid: process.pid,
      runId: "live",
      startedAt: new Date().toISOString(),
    }));
    const blocked = await acquireDirectoryLock({
      lockPath: livePath,
      runId: "contender",
      purpose: "test",
      waitMs: 0,
    });
    expect(blocked).toMatchObject({ acquired: false, ownerRunId: "live" });

    const reusedPidPath = path.join(root, "reused-pid.lock");
    mkdirSync(reusedPidPath, { recursive: true });
    writeFileSync(path.join(reusedPidPath, "claim-reused.json"), JSON.stringify({
      pid: process.pid,
      runId: "reused",
      startedAt: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    }));
    const reclaimed = await acquireDirectoryLock({
      lockPath: reusedPidPath,
      runId: "new-owner",
      purpose: "test",
      waitMs: 0,
    });
    expect(reclaimed.acquired).toBe(true);
    await reclaimed.release?.();
  });

  it("elects exactly one owner when lock contenders start together", async () => {
    const lockPath = path.join(makeTempRoot(), "concurrent.lock");
    const [first, second] = await Promise.all([
      acquireDirectoryLock({ lockPath, runId: "first", purpose: "test", waitMs: 0 }),
      acquireDirectoryLock({ lockPath, runId: "second", purpose: "test", waitMs: 0 }),
    ]);
    const winners = [first, second].filter((claim) => claim.acquired);
    const losers = [first, second].filter((claim) => !claim.acquired);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]?.ownerRunId).toMatch(/^(?:first|second)$/u);
    await winners[0]?.release?.();
  });

  it("records a skipped scheduled run and consumes the overlap marker on recovery", () => {
    const runtimeRoot = makeTempRoot();
    const env = installDatabaseFixtureHelper(runtimeRoot, "healthy");
    const runLockPath = path.join(runtimeRoot, "tmp", "prod-watch", "run.lock");
    mkdirSync(runLockPath, { recursive: true });
    writeFileSync(path.join(runLockPath, "claim-00000000.json"), JSON.stringify({
      pid: process.pid,
      runId: "active-run",
      startedAt: new Date().toISOString(),
    }));

    const skipped = runProdWatch([
      "run",
      "--scheduled",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot, env);
    expect(skipped.status).toBe(0);
    const overlapPath = path.join(runtimeRoot, "operations", "prod-watch", "last-overlap.v1.json");
    expect(JSON.parse(readFileSync(overlapPath, "utf8"))).toMatchObject({ ownerRunId: "active-run" });

    rmSync(runLockPath, { recursive: true, force: true });
    const recovered = runProdWatch([
      "run",
      "--scheduled",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot, env);
    expect(recovered.status).toBe(0);

    const state = JSON.parse(readFileSync(
      path.join(runtimeRoot, "operations", "prod-watch", "state.v1.json"),
      "utf8",
    )) as { monitor: { skippedOverlapCount: number } };
    const snapshot = JSON.parse(readFileSync(
      path.join(runtimeRoot, "projections", "prod-watch", "latest.snapshot.v1.json"),
      "utf8",
    )) as ProductionWatchSnapshot;
    expect(state.monitor.skippedOverlapCount).toBe(1);
    expect(snapshot.run.skippedOverlap).toBe(true);
    expect(existsSync(overlapPath)).toBe(false);
  });

  it("requires the incident lease and narrows drill-down evidence to the claimed incident", () => {
    const runtimeRoot = makeTempRoot();
    const env = installDatabaseFixtureHelper(runtimeRoot, "suspicious");
    expect(runProdWatch(["run", "--settling-delay-seconds", "0"], runtimeRoot, env).status)
      .toBe(0);
    expect(runProdWatch(["run", "--settling-delay-seconds", "0"], runtimeRoot, env).status)
      .toBe(0);

    const state = JSON.parse(readFileSync(
      path.join(runtimeRoot, "operations", "prod-watch", "state.v1.json"),
      "utf8",
    )) as {
      incidents: Array<{ id: string; fingerprint: string; sourceFingerprint?: string }>;
    };
    const incident = state.incidents.find((candidate) => candidate.sourceFingerprint !== undefined);
    expect(incident).toBeDefined();

    const fullResult = runProdWatch([
      "collect",
      "--fixture",
      "suspicious",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot);
    expect(fullResult.status).toBe(0);
    const fullSnapshot = JSON.parse(fullResult.stdout) as ProductionWatchSnapshot;

    const claim = runProdWatch([
      "incident",
      "claim",
      incident!.id,
      "--session-id",
      "session-a",
    ], runtimeRoot);
    expect(claim.status).toBe(0);

    const denied = runProdWatch([
      "drill-down",
      incident!.id,
      "--session-id",
      "session-b",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot, env);
    expect(denied.status).toBe(1);
    expect(denied.stderr).toContain("incident_lease_not_owned");

    const allowed = runProdWatch([
      "drill-down",
      incident!.id,
      "--session-id",
      "session-a",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot, env);
    expect(allowed.status).toBe(0);
    const filtered = JSON.parse(allowed.stdout) as ProductionWatchSnapshot;
    expect(filtered.run.mode).toBe("drill_down");
    expect(filtered.anomalyCandidates.length).toBeGreaterThan(0);
    expect(filtered.anomalyCandidates.length).toBeLessThan(fullSnapshot.anomalyCandidates.length);
    expect(filtered.anomalyCandidates.every((candidate) => (
      candidate.fingerprint === incident!.fingerprint
      || candidate.sourceFingerprint === incident!.sourceFingerprint
    ))).toBe(true);
    expect(filtered.fingerprints.every((fingerprint) => (
      fingerprint.fingerprint === incident!.sourceFingerprint
    ))).toBe(true);
  });

  it("persists local coordination state and projections with private modes", () => {
    const runtimeRoot = makeTempRoot();
    const env = installDatabaseFixtureHelper(runtimeRoot, "healthy");
    const result = runProdWatch([
      "run",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot, env);
    expect(result.status).toBe(0);

    const operationRoot = path.join(runtimeRoot, "operations", "prod-watch");
    const projectionRoot = path.join(runtimeRoot, "projections", "prod-watch");
    expect(statSync(operationRoot).mode & 0o777).toBe(0o700);
    expect(statSync(projectionRoot).mode & 0o777).toBe(0o700);
    for (const targetPath of [
      path.join(operationRoot, "state.v1.json"),
      path.join(projectionRoot, "ACTIVE_INCIDENTS.md"),
      path.join(projectionRoot, "INCIDENT_HISTORY.md"),
      path.join(projectionRoot, "MONITOR_STATUS.md"),
      path.join(projectionRoot, "latest.snapshot.v1.json"),
    ]) {
      expect(statSync(targetPath).mode & 0o777).toBe(0o600);
    }
  });

  it("does not echo rejected provider values into collector failures", () => {
    const runtimeRoot = makeTempRoot();
    const provider = JSON.parse(readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8")) as {
      sources: Array<{ releaseContext: Array<{ runtime: string }> }>;
    };
    const privateValue = "cus_1234567890ABCDEF";
    provider.sources[0]!.releaseContext[0]!.runtime = privateValue;
    const providerPath = path.join(runtimeRoot, "provider.json");
    writeFileSync(providerPath, JSON.stringify(provider));

    const result = runProdWatch([
      "collect",
      "--fixture",
      "healthy",
      "--provider-evidence",
      providerPath,
    ], runtimeRoot);
    expect(result.status).toBe(0);
    const snapshot = JSON.parse(result.stdout) as ProductionWatchSnapshot;
    expect(snapshot.collectorFailures).toContainEqual({
      source: "vercel",
      class: "schema",
      code: "provider_evidence_invalid",
      retryable: false,
    });
    expect(result.stdout).not.toContain(privateValue);
  });

  it("rejects provider evidence supplied through a symbolic link", () => {
    const runtimeRoot = makeTempRoot();
    const providerPath = path.join(runtimeRoot, "provider.json");
    symlinkSync(path.join(fixtureRoot, "healthy.providers.json"), providerPath);

    const result = runProdWatch([
      "collect",
      "--fixture",
      "healthy",
      "--provider-evidence",
      providerPath,
    ], runtimeRoot);
    expect(result.status).toBe(0);
    const snapshot = JSON.parse(result.stdout) as ProductionWatchSnapshot;
    expect(snapshot.collectorFailures).toHaveLength(3);
    expect(snapshot.collectorFailures.every((failure) => failure.code === "provider_evidence_invalid")).toBe(true);
  });

  it("accepts private provider evidence and rejects world-readable evidence", () => {
    const runtimeRoot = makeTempRoot();
    const binRoot = path.join(runtimeRoot, "bin");
    mkdirSync(binRoot, { recursive: true });
    const helperPath = path.join(binRoot, "murph-prod-psql-ro");
    const databaseFixturePath = path.join(fixtureRoot, "healthy.database.json");
    writeFileSync(helperPath, `#!/bin/sh\ntr -d '\n' < '${databaseFixturePath}'\n`, { mode: 0o755 });
    chmodSync(helperPath, 0o755);

    const providerPath = path.join(runtimeRoot, "provider.json");
    writeFileSync(
      providerPath,
      readFileSync(path.join(fixtureRoot, "healthy.providers.json")),
      { mode: 0o600 },
    );
    chmodSync(providerPath, 0o600);
    const env = { PATH: `${binRoot}:${process.env.PATH ?? ""}` };

    const accepted = runProdWatch(["collect", "--provider-evidence", providerPath], runtimeRoot, env);
    expect(accepted.status, "private_provider_collect_failed").toBe(0);
    const acceptedSnapshot = JSON.parse(accepted.stdout) as ProductionWatchSnapshot;
    expect(acceptedSnapshot.sourceHealth
      .filter((source) => source.source !== "database")
      .every((source) => source.status === "ok" && source.coverage === "complete"))
      .toBe(true);
    expect(acceptedSnapshot.collectorFailures.filter((failure) => failure.source !== "database"))
      .toEqual([]);

    chmodSync(providerPath, 0o644);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rejected = runProdWatch(["collect", "--provider-evidence", providerPath], runtimeRoot, env);
      expect(rejected.status, "world_readable_provider_collect_failed").toBe(0);
      const rejectedSnapshot = JSON.parse(rejected.stdout) as ProductionWatchSnapshot;
      expect(rejectedSnapshot.collectorFailures.filter((failure) => failure.source !== "database"))
        .toHaveLength(3);
      expect(rejectedSnapshot.collectorFailures
        .filter((failure) => failure.source !== "database")
        .every((failure) => failure.code === "provider_evidence_invalid"))
        .toBe(true);
    }
  });

  it("keeps the production source universe fixed across environment changes", () => {
    const runtimeRoot = makeTempRoot();
    const first = runProdWatch([
      "collect",
      "--fixture",
      "healthy",
      "--provider-evidence",
      path.join(fixtureRoot, "healthy.providers.json"),
    ], runtimeRoot, { MURPH_PROD_WATCH_SOURCES: "database" });

    expect(first.status).toBe(0);
    const snapshot = JSON.parse(first.stdout) as ProductionWatchSnapshot;
    expect(snapshot.monitor.configuredSources).toEqual(["database", "vercel", "cloudflare", "stripe"]);
    expect(snapshot.sourceHealth.map((source) => source.source))
      .toEqual(["database", "vercel", "cloudflare", "stripe"]);

    const persistedFirst = runProdWatch(
      ["run"],
      runtimeRoot,
      {
        ...installDatabaseFixtureHelper(runtimeRoot, "healthy"),
        MURPH_PROD_WATCH_SOURCES: "database",
      },
    );
    const persistedSecond = runProdWatch(
      ["run"],
      runtimeRoot,
      {
        ...installDatabaseFixtureHelper(runtimeRoot, "healthy"),
        MURPH_PROD_WATCH_SOURCES: "database,vercel",
      },
    );
    expect(persistedFirst.status).toBe(0);
    expect(persistedSecond.status).toBe(0);
  });

  it("rebases checked-in provider fixtures for read-only collection", () => {
    const runtimeRoot = makeTempRoot();
    const result = runProdWatch([
      "collect",
      "--fixture",
      "healthy",
      "--provider-evidence",
      path.join(fixtureRoot, "healthy.providers.json"),
    ], runtimeRoot);

    expect(result.status).toBe(0);
    const snapshot = JSON.parse(result.stdout) as ProductionWatchSnapshot;
    expect(snapshot.monitor).toMatchObject({ status: "healthy", evidenceComplete: true });
    expect(snapshot.anomalyCandidates).toEqual([]);
  });

  it("keeps fixture collection read-only without state or Markdown projections", () => {
    const runtimeRoot = makeTempRoot();
    const result = runProdWatch(["collect", "--fixture", "healthy"], runtimeRoot);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: "prod-watch.snapshot.v1" });
    expect(existsSync(path.join(runtimeRoot, "operations", "prod-watch", "state.v1.json"))).toBe(false);
    expect(existsSync(path.join(runtimeRoot, "projections", "prod-watch", "ACTIVE_INCIDENTS.md"))).toBe(false);
  });

  it("rejects fixtures on stateful commands before state, projection, or lease mutation", () => {
    const runtimeRoot = makeTempRoot();
    const env = installDatabaseFixtureHelper(runtimeRoot, "suspicious");
    expect(runProdWatch(["run"], runtimeRoot, env).status).toBe(0);
    const statePath = path.join(runtimeRoot, "operations", "prod-watch", "state.v1.json");
    const initialState = JSON.parse(readFileSync(statePath, "utf8")) as {
      incidents: Array<{ id: string }>;
    };
    const incidentId = initialState.incidents[0]!.id;
    expect(runProdWatch([
      "incident", "claim", incidentId, "--session-id", "fixture-boundary-session",
    ], runtimeRoot).status).toBe(0);
    const artifactPaths = [
      statePath,
      path.join(runtimeRoot, "projections", "prod-watch", "ACTIVE_INCIDENTS.md"),
      path.join(runtimeRoot, "projections", "prod-watch", "INCIDENT_HISTORY.md"),
      path.join(runtimeRoot, "projections", "prod-watch", "MONITOR_STATUS.md"),
      path.join(runtimeRoot, "projections", "prod-watch", "latest.snapshot.v1.json"),
    ];
    const before = artifactPaths.map((targetPath) => readFileSync(targetPath, "utf8"));

    for (const args of [
      ["run", "--fixture", "healthy"],
      ["run", "--dry-run", "--fixture", "healthy"],
      [
        "drill-down",
        incidentId,
        "--session-id",
        "fixture-boundary-session",
        "--fixture",
        "healthy",
      ],
    ]) {
      const rejected = runProdWatch(args, runtimeRoot, env);
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toContain("fixture_stateful_command_forbidden");
      expect(artifactPaths.map((targetPath) => readFileSync(targetPath, "utf8"))).toEqual(before);
    }
  });

  it("uses the listed incident ID through the real triage command journey", () => {
    const runtimeRoot = makeTempRoot();
    const env = installDatabaseFixtureHelper(runtimeRoot, "suspicious");
    expect(runProdWatch(["run"], runtimeRoot, env).status).toBe(0);
    const listing = runProdWatch(["incident", "list"], runtimeRoot);
    expect(listing.status).toBe(0);
    const incidentId = listing.stdout.match(/\| (pw_[A-Za-z0-9]+) \|/u)?.[1];
    expect(incidentId).toBeDefined();

    expect(runProdWatch([
      "incident", "claim", incidentId!, "--session-id", "session-cli",
    ], runtimeRoot).status).toBe(0);
    expect(runProdWatch([
      "drill-down", incidentId!, "--session-id", "session-cli",
    ], runtimeRoot, env).status).toBe(0);
    expect(runProdWatch([
      "incident", "heartbeat", incidentId!, "--session-id", "session-cli",
    ], runtimeRoot).status).toBe(0);
    expect(runProdWatch([
      "incident", "transition", incidentId!, "--session-id", "session-cli", "--state", "escalated",
    ], runtimeRoot).status).toBe(0);
    expect(readFileSync(
      path.join(runtimeRoot, "projections", "prod-watch", "INCIDENT_HISTORY.md"),
      "utf8",
    )).toContain(incidentId);
  });

  it("keeps every provider incident claim-and-escalate-only without drill-down lease mutation", () => {
    const runtimeRoot = makeTempRoot();
    const providerPath = path.join(runtimeRoot, "provider.json");
    const makeProviderAnomalous = (provider: { sources: Array<AdapterEvidence> }) => {
      const vercel = provider.sources.find((source) => source.source === "vercel")!;
      const errors = vercel.counters.find((counter) => counter.metric === "provider_error_count")!;
      errors.current = 20;
      errors.previous = 1;
      const cloudflare = provider.sources.find((source) => source.source === "cloudflare")!;
      const timeouts = cloudflare.counters.find((counter) => counter.metric === "provider_timeout_count")!;
      timeouts.current = 10;
      timeouts.previous = 1;
      const stripe = provider.sources.find((source) => source.source === "stripe")!;
      const stripeErrors = stripe.counters.find((counter) => counter.metric === "provider_error_count")!;
      stripeErrors.current = 10;
      stripeErrors.previous = 0;
    };
    const firstObservation = new Date();
    writeCurrentProviderFixture(providerPath, makeProviderAnomalous, firstObservation);
    const env = installDatabaseFixtureHelper(runtimeRoot, "healthy");

    const providerRun = [
      "run",
      "--provider-evidence",
      providerPath,
    ];
    expect(runProdWatch(providerRun, runtimeRoot, env).status).toBe(0);
    writeCurrentProviderFixture(
      providerPath,
      makeProviderAnomalous,
      new Date(firstObservation.getTime() + 1_000),
    );
    expect(runProdWatch(providerRun, runtimeRoot, env).status).toBe(0);

    const listing = runProdWatch(["incident", "list"], runtimeRoot);
    expect(listing.status).toBe(0);
    const statePath = path.join(runtimeRoot, "operations", "prod-watch", "state.v1.json");
    type ProviderState = {
      incidents: Array<{
        id: string;
        source: string;
        state: string;
        owner?: { heartbeatAt: string; expiresAt: string };
      }>;
    };
    const promoted = JSON.parse(readFileSync(statePath, "utf8")) as ProviderState;
    for (const source of ["vercel", "cloudflare", "stripe"]) {
      expect(listing.stdout).toContain(`| ${source} |`);
      const incidentId = promoted.incidents.find((incident) => incident.source === source)?.id;
      expect(incidentId).toBeDefined();
      const sessionId = `${source}-session`;
      expect(runProdWatch([
        "incident", "claim", incidentId!, "--session-id", sessionId,
      ], runtimeRoot).status).toBe(0);
      const claimed = JSON.parse(readFileSync(statePath, "utf8")) as ProviderState;
      const claimedIncident = claimed.incidents.find((incident) => incident.id === incidentId)!;

      const rejectedDrillDown = runProdWatch([
        "drill-down", incidentId!, "--session-id", sessionId,
      ], runtimeRoot, env);
      expect(rejectedDrillDown.status).toBe(1);
      expect(rejectedDrillDown.stderr).toContain("provider_incident_drill_down_unavailable_phase_1");
      expect((JSON.parse(readFileSync(statePath, "utf8")) as ProviderState).incidents
        .find((incident) => incident.id === incidentId)).toEqual(claimedIncident);

      for (const target of [
        "investigating",
        "confirmed",
        "monitor_incomplete",
        "false_positive",
        "resolved",
      ]) {
        const rejected = runProdWatch([
          "incident", "transition", incidentId!, "--session-id", sessionId, "--state", target,
        ], runtimeRoot);
        expect(rejected.status).toBe(1);
        expect(rejected.stderr).toContain("provider_incident_escalation_only");
        expect((JSON.parse(readFileSync(statePath, "utf8")) as ProviderState).incidents
          .find((incident) => incident.id === incidentId)).toEqual(claimedIncident);
      }
      expect(runProdWatch([
        "incident", "transition", incidentId!, "--session-id", sessionId, "--state", "escalated",
      ], runtimeRoot).status).toBe(0);
    }

    const firstProvider = promoted.incidents.find((incident) => incident.source === "vercel")!;
    const rejectedHiddenEvidence = runProdWatch([
      "drill-down",
      firstProvider.id,
      "--session-id",
      "vercel-session",
      "--provider-evidence",
      providerPath,
    ], runtimeRoot, env);
    expect(rejectedHiddenEvidence.status).toBe(1);
    expect(rejectedHiddenEvidence.stderr).toContain("drill_down_provider_evidence_forbidden_phase_1");
  });

  it("keeps the Phase 1 remediation command disabled at the CLI boundary", () => {
    const runtimeRoot = makeTempRoot();
    const result = runProdWatch(["remediate"], runtimeRoot);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("automation_disabled_phase_1");
  });

  it("rejects ambiguous database helper stdout instead of selecting one JSON-looking line", () => {
    const runtimeRoot = makeTempRoot();
    const binRoot = path.join(runtimeRoot, "bin");
    mkdirSync(binRoot, { recursive: true });
    const helperPath = path.join(binRoot, "murph-prod-psql-ro");
    const fixturePath = path.join(fixtureRoot, "healthy.database.json");
    writeFileSync(
      helperPath,
      `#!/bin/sh\ncat >/dev/null\ntr -d '\n' < '${fixturePath}'\nprintf '\nuntrusted helper banner\n'\n`,
      { mode: 0o755 },
    );
    chmodSync(helperPath, 0o755);

    const result = runProdWatch(
      ["collect", "--adapter-timeout-ms", "5000"],
      runtimeRoot,
      { PATH: `${binRoot}:${process.env.PATH ?? ""}` },
    );
    expect(result.status).toBe(0);
    const snapshot = JSON.parse(result.stdout) as ProductionWatchSnapshot;
    expect(snapshot.collectorFailures).toContainEqual({
      source: "database",
      class: "schema",
      code: "helper_output_invalid",
      retryable: false,
    });
    expect(result.stdout).not.toContain("untrusted helper banner");
  });

  it("bounds a hung database helper and reports only a redacted timeout code", () => {
    const runtimeRoot = makeTempRoot();
    const binRoot = path.join(runtimeRoot, "bin");
    mkdirSync(binRoot, { recursive: true });
    const helperPath = path.join(binRoot, "murph-prod-psql-ro");
    writeFileSync(helperPath, "#!/bin/sh\nsleep 5\nprintf 'private provider payload' >&2\n", { mode: 0o755 });
    chmodSync(helperPath, 0o755);

    const result = runProdWatch(
      ["collect", "--adapter-timeout-ms", "1000"],
      runtimeRoot,
      { PATH: `${binRoot}:${process.env.PATH ?? ""}` },
    );
    expect(result.status).toBe(0);
    const snapshot = JSON.parse(result.stdout) as ProductionWatchSnapshot;
    expect(snapshot.collectorFailures).toContainEqual({
      source: "database",
      class: "timeout",
      code: "helper_timeout",
      retryable: true,
    });
    expect(result.stdout).not.toContain("private provider payload");
  });

  it("keeps termination ownership when a helper closes stdin and stays alive", () => {
    const runtimeRoot = makeTempRoot();
    const binRoot = path.join(runtimeRoot, "bin");
    mkdirSync(binRoot, { recursive: true });
    const pidPath = path.join(runtimeRoot, "helper.pid");
    const helperScriptPath = path.join(binRoot, "close-stdin.cjs");
    writeFileSync(helperScriptPath, [
      "const { closeSync, writeFileSync } = require('node:fs');",
      "process.on('SIGTERM', () => {});",
      "closeSync(0);",
      "writeFileSync(process.env.TEST_HELPER_PID_PATH, String(process.pid));",
      "setTimeout(() => process.exit(0), 5000);",
      "",
    ].join("\n"), { mode: 0o600 });
    const helperPath = path.join(binRoot, "murph-prod-psql-ro");
    writeFileSync(helperPath, [
      "#!/bin/sh",
      "exec \"$TEST_NODE_EXECUTABLE\" \"$TEST_CLOSE_STDIN_HELPER\"",
      "",
    ].join("\n"), { mode: 0o755 });
    chmodSync(helperPath, 0o755);

    const startedAt = Date.now();
    const result = runProdWatch(
      ["collect", "--adapter-timeout-ms", "1000"],
      runtimeRoot,
      {
        PATH: `${binRoot}:${process.env.PATH ?? ""}`,
        TEST_CLOSE_STDIN_HELPER: helperScriptPath,
        TEST_HELPER_PID_PATH: pidPath,
        TEST_NODE_EXECUTABLE: process.execPath,
      },
    );
    const elapsedMs = Date.now() - startedAt;
    expect(result.status).toBe(0);
    expect(elapsedMs).toBeGreaterThanOrEqual(800);
    expect(elapsedMs).toBeLessThan(3_500);
    const snapshot = JSON.parse(result.stdout) as ProductionWatchSnapshot;
    expect(snapshot.run.durationMs).toBeGreaterThanOrEqual(800);
    expect(snapshot.collectorFailures).toHaveLength(1);
    expect(snapshot.collectorFailures[0]).toMatchObject({ source: "database", retryable: true });
    expect(["helper_failed", "helper_timeout"]).toContain(snapshot.collectorFailures[0]!.code);
    const helperPid = Number(readFileSync(pidPath, "utf8"));
    expect(() => process.kill(helperPid, 0)).toThrow(/ESRCH/u);

    const recovered = runProdWatch(
      ["collect", "--adapter-timeout-ms", "5000"],
      runtimeRoot,
      installDatabaseFixtureHelper(runtimeRoot, "healthy"),
    );
    expect(recovered.status).toBe(0);
    expect((JSON.parse(recovered.stdout) as ProductionWatchSnapshot).sourceHealth
      .find((source) => source.source === "database")?.status).toBe("ok");
  });
});

describe("production-watch static safety contracts", () => {
  it("keeps the database query read-only and excludes private event fields", () => {
    const sql = readFileSync(path.join(repoRoot, "scripts", "prod-watch", "collect-v1.sql"), "utf8");
    const runtimeIssueDomain = readFileSync(
      path.join(repoRoot, "packages", "runtime-state", "src", "assistant-runtime-issues.ts"),
      "utf8",
    );
    const runtimeIssueWriter = readFileSync(
      path.join(repoRoot, "packages", "assistant-engine", "src", "assistant", "issue-reporting.ts"),
      "utf8",
    );
    const runtimeIssueImporter = readFileSync(
      path.join(repoRoot, "apps", "web", "src", "lib", "hosted-execution", "runtime-issues.ts"),
      "utf8",
    );
    expect(sql).toContain("BEGIN TRANSACTION READ ONLY");
    expect(sql).toContain("SET LOCAL statement_timeout");
    expect(sql).toContain("::timestamptz AT TIME ZONE 'UTC' AS previous_start");
    expect(sql).toContain("coalesce(first_seen_at, params.current_start) AT TIME ZONE 'UTC'");
    expect(sql).toContain("md5(concat_ws(E'\\x1f', fingerprint, operation, surface))");
    expect(sql).toContain("~* '(auth|billing|canonical|clinical|consent|corrupt|credential|");
    expect(sql.indexOf("~* '(auth|billing")).toBeLessThan(sql.indexOf("LIMIT 13"));
    expect(sql).toContain("issue.severity IN ('info', 'warning', 'error')");
    expect(runtimeIssueDomain).toContain('AssistantRuntimeIssueEnvironment = "hosted" | "local"');
    expect(runtimeIssueWriter).toContain("operation,");
    expect(runtimeIssueWriter).toContain("surface: input.policy.surface");
    expect(runtimeIssueImporter).toContain("environment: record.environment");
    expect(runtimeIssueImporter).toContain("operation: record.operation");
    expect(runtimeIssueImporter).toContain("surface: record.surface");
    expect(sql).toContain("issue.environment = 'hosted'");
    expect(sql).toContain("coalesce(issue.operation, 'none') AS operation");
    expect(sql).toContain("coalesce(issue.surface, 'none') AS surface");
    expect(sql).toContain("'operation', operation");
    expect(sql).toContain("'surface', surface");
    expect(sql).not.toContain("issue.environment = 'production'");
    expect(sql).not.toContain("release_rows");
    expect(sql).not.toContain("'releaseSha'");
    expect(sql).toContain("'releaseContext', '[]'::jsonb");
    expect(sql).toContain("trace.source IN ('linq', 'telegram')");
    expect(sql).not.toContain("hosted_runtime_log");
    for (const forbidden of [
      "user_id",
      "attempt_id",
      "mailbox_item_id",
      "linq_delivery_id",
      "redacted_json",
      "details_json",
      "summary",
    ]) {
      expect(sql).not.toContain(forbidden);
    }
  });

  it("ships a non-overlapping five-minute launchd template with a resolved executable chain", async () => {
    const template = readFileSync(
      path.join(repoRoot, "scripts", "prod-watch", "com.murph.prod-watch.plist.template"),
      "utf8",
    );
    expect(template).toContain("<key>StartInterval</key>\n  <integer>300</integer>");
    expect(template).toContain("<key>KeepAlive</key>\n  <false/>");
    expect(template).toContain("<string>/dev/null</string>");
    expect(template).toContain("murph-prod-watch-managed:v1");
    expect(template).toContain("__REPO_HOME_RELATIVE__");
    expect(template).toContain("__NODE_EXECUTABLE__");
    expect(template).toContain("__SCHEDULER_PATH__");
    expect(template).toContain("<string>-c</string>");
    expect(template).not.toContain("<string>-lc</string>");
    expect(template).not.toContain("exec pnpm");
    expect(template).not.toContain(os.homedir());

    const fakeHome = path.join(os.tmpdir(), "prod-watch-home");
    const fakeNode = path.join(fakeHome, "tools", "node");
    const rendered = renderLaunchdPlistTemplate(
      template,
      path.join(fakeHome, "project"),
      fakeHome,
      fakeNode,
    );
    expect(rendered).toContain("$HOME/project");
    expect(rendered).toContain("$HOME/tools/node");
    expect(rendered).toContain("$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    expect(rendered).toContain("node_modules/tsx/dist/cli.mjs");
    expect(rendered).toContain("scripts/prod-watch.ts&quot; run --scheduled");
    expect(rendered).not.toContain("exec pnpm");
    expect(rendered).not.toContain(fakeHome);
    expect(() => renderLaunchdPlistTemplate(template, path.join(fakeHome, "..", "project"), fakeHome))
      .toThrow("scheduler_repo_path_unsafe");
    await expect(verifySchedulerExecutableChain(repoRoot, path.join(fakeHome, "missing-node"), fakeHome))
      .rejects.toThrow("scheduler_executable_chain_unavailable");
    await expect(verifySchedulerExecutableChain(repoRoot, process.execPath, fakeHome))
      .rejects.toThrow("scheduler_executable_chain_unavailable");
  });

  it.runIf(process.platform === "darwin")(
    "runs the rendered scheduler command under a minimal launchd environment",
    async () => {
      const testRoot = realpathSync(makeTempRoot());
      const schedulerHome = path.join(testRoot, "home");
      const checkoutRoot = path.join(schedulerHome, "project");
      const runtimeRoot = path.join(testRoot, "runtime");
      const plistPath = path.join(testRoot, "scheduler.plist");
      const helperRoot = path.join(schedulerHome, ".local", "bin");
      mkdirSync(path.join(checkoutRoot, "scripts", "prod-watch"), { recursive: true });
      mkdirSync(path.join(checkoutRoot, "node_modules"), { recursive: true });
      mkdirSync(helperRoot, { recursive: true });
      for (const relativePath of [
        "package.json",
        "tsconfig.base.json",
        "tsconfig.tools.json",
        "scripts/prod-watch.ts",
        "scripts/prod-watch/core.ts",
        "scripts/prod-watch/collect-v1.sql",
      ]) {
        copyFileSync(path.join(repoRoot, relativePath), path.join(checkoutRoot, relativePath));
      }
      cpSync(
        path.join(repoRoot, "node_modules", "tsx"),
        path.join(checkoutRoot, "node_modules", "tsx"),
        { recursive: true, dereference: true },
      );
      const tsxStoreModules = path.dirname(
        realpathSync(path.join(repoRoot, "node_modules", "tsx")),
      );
      for (const dependency of ["esbuild", "get-tsconfig"]) {
        symlinkSync(
          realpathSync(path.join(tsxStoreModules, dependency)),
          path.join(checkoutRoot, "node_modules", dependency),
          "dir",
        );
      }
      const helperScriptPath = path.join(helperRoot, "helper.cjs");
      writeFileSync(helperScriptPath, [
        "const { readFileSync } = require('node:fs');",
        "const evidence = JSON.parse(readFileSync(process.env.TEST_DATABASE_FIXTURE, 'utf8'));",
        "const flags = Object.fromEntries(process.argv.slice(2).filter((value) => value.startsWith('--set=')).map((value) => { const split = value.slice(6).indexOf('='); return [value.slice(6, 6 + split), value.slice(7 + split)]; }));",
        "evidence.collectedAt = flags.window_end;",
        "evidence.freshnessSeconds = 0;",
        "evidence.releaseContext = [];",
        "evidence.fingerprints = [];",
        "process.stdout.write(`${JSON.stringify(evidence)}\\n`);",
        "",
      ].join("\n"), { mode: 0o600 });
      const helperPath = path.join(helperRoot, "murph-prod-psql-ro");
      writeFileSync(helperPath, [
        "#!/bin/sh",
        "cat >/dev/null",
        "exec \"$TEST_NODE_EXECUTABLE\" \"$HOME/.local/bin/helper.cjs\" \"$@\"",
        "",
      ].join("\n"), { mode: 0o755 });
      chmodSync(helperPath, 0o755);
      const template = readFileSync(
        path.join(repoRoot, "scripts", "prod-watch", "com.murph.prod-watch.plist.template"),
        "utf8",
      );
      writeFileSync(
        plistPath,
        renderLaunchdPlistTemplate(template, checkoutRoot, schedulerHome, process.execPath),
      );
      await expect(verifySchedulerExecutableChain(checkoutRoot, process.execPath, schedulerHome))
        .resolves.toBeUndefined();
      const commandResult = spawnSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :ProgramArguments:2", plistPath],
        { encoding: "utf8" },
      );
      expect(commandResult.status).toBe(0);
      const run = spawnSync("/bin/zsh", ["-c", commandResult.stdout.trim()], {
        cwd: path.parse(checkoutRoot).root,
        encoding: "utf8",
        env: {
          HOME: schedulerHome,
          PATH: "/usr/bin:/bin",
          TMPDIR: realpathSync(os.tmpdir()),
          NODE_ENV: "test",
          MURPH_PROD_WATCH_TEST_RUNTIME_ROOT: runtimeRoot,
          TEST_DATABASE_FIXTURE: path.join(fixtureRoot, "healthy.database.json"),
          TEST_NODE_EXECUTABLE: process.execPath,
        },
        timeout: 30_000,
      });
      const schedulerFailureCode = run.stderr
        .replaceAll(os.homedir(), "<HOME_DIR>")
        .trim() || "rendered_scheduler_command_failed";
      expect(run.status, schedulerFailureCode).toBe(0);
      expect(existsSync(path.join(runtimeRoot, "operations", "prod-watch", "state.v1.json")))
        .toBe(true);
      const snapshot = JSON.parse(readFileSync(
        path.join(runtimeRoot, "projections", "prod-watch", "latest.snapshot.v1.json"),
        "utf8",
      )) as ProductionWatchSnapshot;
      expect(snapshot.sourceHealth.find((source) => source.source === "database")).toMatchObject({
        status: "ok",
        coverage: "complete",
      });
      expect(snapshot.collectorFailures.some((failure) => failure.code === "helper_not_found"))
        .toBe(false);
    },
  );

  it.runIf(process.platform === "darwin")(
    "keeps launchd lifecycle acknowledgements proven and retryable",
    () => {
      const testRoot = makeTempRoot();
      const fakeHome = path.join(testRoot, "home");
      const checkoutRoot = path.join(fakeHome, "project");
      const binRoot = path.join(testRoot, "bin");
      const runtimeRoot = path.join(testRoot, "runtime");
      const launchctlLog = path.join(testRoot, "launchctl.log");
      const launchctlState = path.join(testRoot, "launchctl.state");
      const launchAgentsRoot = path.join(fakeHome, "Library", "LaunchAgents");
      const plistPath = path.join(launchAgentsRoot, "com.murph.prod-watch.plist");
      const schedulerHelperRoot = path.join(fakeHome, ".local", "bin");
      const schedulerHelperPath = path.join(schedulerHelperRoot, "murph-prod-psql-ro");
      mkdirSync(fakeHome, { recursive: true });
      mkdirSync(binRoot, { recursive: true });
      mkdirSync(launchAgentsRoot, { recursive: true });
      mkdirSync(schedulerHelperRoot, { recursive: true });
      symlinkSync(repoRoot, checkoutRoot, "dir");
      writeFileSync(schedulerHelperPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      chmodSync(schedulerHelperPath, 0o755);

      const launchctlPath = path.join(binRoot, "launchctl");
      writeFileSync(
        launchctlPath,
        [
          "#!/bin/sh",
          "printf '%s\\n' \"$*\" >> \"$LAUNCHCTL_LOG\"",
          "case \"$1\" in",
          "  bootout)",
          "    if [ \"${LAUNCHCTL_FAIL_BOOTOUT:-0}\" = \"1\" ]; then exit 1; fi",
          "    printf 'absent\\n' > \"$LAUNCHCTL_STATE\"",
          "    ;;",
          "  bootstrap)",
          "    printf 'loaded\\n' > \"$LAUNCHCTL_STATE\"",
          "    ;;",
          "  enable)",
          "    if [ \"${LAUNCHCTL_FAIL_ENABLE:-0}\" = \"1\" ]; then exit 1; fi",
          "    ;;",
          "  print)",
          "    if [ \"${LAUNCHCTL_PRINT_UNKNOWN:-0}\" = \"1\" ]; then printf 'unknown failure\\n' >&2; exit 1; fi",
          "    if [ \"$(cat \"$LAUNCHCTL_STATE\" 2>/dev/null)\" = \"loaded\" ]; then exit 0; fi",
          "    printf 'Could not find service\\n' >&2",
          "    exit 113",
          "    ;;",
          "esac",
          "exit 0",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      chmodSync(launchctlPath, 0o755);
      const sharedEnv = {
        HOME: fakeHome,
        LAUNCHCTL_LOG: launchctlLog,
        LAUNCHCTL_STATE: launchctlState,
        PATH: `${binRoot}:${process.env.PATH ?? ""}`,
      };

      writeFileSync(plistPath, "operator-owned\n", { mode: 0o600 });
      const unmanagedInstall = runProdWatchFromCheckout(
        ["scheduler", "install"],
        runtimeRoot,
        checkoutRoot,
        sharedEnv,
      );
      expect(unmanagedInstall.status).toBe(1);
      expect(unmanagedInstall.stderr).toContain("launchd_plist_unmanaged");
      expect(readFileSync(plistPath, "utf8")).toBe("operator-owned\n");
      expect(existsSync(launchctlLog)).toBe(false);

      writeFileSync(plistPath, "<!-- murph-prod-watch-managed:v1 -->\n", { mode: 0o600 });
      writeFileSync(launchctlState, "loaded\n");
      rmSync(schedulerHelperPath);
      const missingHelperInstall = runProdWatchFromCheckout(
        ["scheduler", "install"],
        runtimeRoot,
        checkoutRoot,
        sharedEnv,
      );
      expect(missingHelperInstall.status).toBe(1);
      expect(missingHelperInstall.stderr).toContain("scheduler_executable_chain_unavailable");
      expect(readFileSync(plistPath, "utf8")).toContain("murph-prod-watch-managed:v1");
      expect(existsSync(launchctlLog)).toBe(false);
      writeFileSync(schedulerHelperPath, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
      chmodSync(schedulerHelperPath, 0o755);
      const replacement = runProdWatchFromCheckout(
        ["scheduler", "install"],
        runtimeRoot,
        checkoutRoot,
        sharedEnv,
      );
      expect(replacement.status).toBe(0);
      const replacementCalls = readFileSync(launchctlLog, "utf8").trim().split("\n");
      expect(replacementCalls).toHaveLength(5);
      expect(replacementCalls[0]).toContain("bootout");
      expect(replacementCalls[1]).toContain("print");
      expect(replacementCalls[2]).toContain("bootstrap");
      expect(replacementCalls[3]).toContain("enable");
      expect(replacementCalls[4]).toContain("print");
      expect(readFileSync(plistPath, "utf8")).toContain("murph-prod-watch-managed:v1");

      writeFileSync(launchctlLog, "");
      const enableFailure = runProdWatchFromCheckout(
        ["scheduler", "install"],
        runtimeRoot,
        checkoutRoot,
        { ...sharedEnv, LAUNCHCTL_FAIL_ENABLE: "1" },
      );
      expect(enableFailure.status).toBe(1);
      expect(enableFailure.stderr).toContain("launchd_enable_failed");
      expect(existsSync(plistPath)).toBe(true);
      const failureCalls = readFileSync(launchctlLog, "utf8").trim().split("\n");
      expect(failureCalls.map((call) => call.split(" ")[0])).toEqual([
        "bootout",
        "print",
        "bootstrap",
        "enable",
        "bootout",
        "print",
      ]);

      writeFileSync(launchctlLog, "");
      writeFileSync(launchctlState, "loaded\n");
      const uncertainUninstall = runProdWatchFromCheckout(
        ["scheduler", "uninstall"],
        runtimeRoot,
        checkoutRoot,
        { ...sharedEnv, LAUNCHCTL_FAIL_BOOTOUT: "1" },
      );
      expect(uncertainUninstall.status).toBe(1);
      expect(uncertainUninstall.stderr).toContain("launchd_service_still_loaded");
      expect(existsSync(plistPath)).toBe(true);

      writeFileSync(launchctlState, "absent\n");
      const confirmedAbsentUninstall = runProdWatchFromCheckout(
        ["scheduler", "uninstall"],
        runtimeRoot,
        checkoutRoot,
        { ...sharedEnv, LAUNCHCTL_FAIL_BOOTOUT: "1" },
      );
      expect(confirmedAbsentUninstall.status).toBe(0);
      expect(existsSync(plistPath)).toBe(false);

      const unknownInstall = runProdWatchFromCheckout(
        ["scheduler", "install"],
        runtimeRoot,
        checkoutRoot,
        { ...sharedEnv, LAUNCHCTL_PRINT_UNKNOWN: "1" },
      );
      expect(unknownInstall.status).toBe(1);
      expect(unknownInstall.stderr).toContain("launchd_service_state_unknown");
      expect(existsSync(plistPath)).toBe(false);

      writeFileSync(launchctlState, "absent\n");
      const failedEnableCleanup = runProdWatchFromCheckout(
        ["scheduler", "install"],
        runtimeRoot,
        checkoutRoot,
        {
          ...sharedEnv,
          LAUNCHCTL_FAIL_ENABLE: "1",
          LAUNCHCTL_FAIL_BOOTOUT: "1",
        },
      );
      expect(failedEnableCleanup.status).toBe(1);
      expect(failedEnableCleanup.stderr).toContain("launchd_enable_cleanup_failed");
      expect(existsSync(plistPath)).toBe(true);
      expect(readFileSync(launchctlState, "utf8").trim()).toBe("loaded");

      const unknownStatus = runProdWatchFromCheckout(
        ["scheduler", "status"],
        runtimeRoot,
        checkoutRoot,
        { ...sharedEnv, LAUNCHCTL_PRINT_UNKNOWN: "1" },
      );
      expect(unknownStatus.status).toBe(0);
      expect(JSON.parse(unknownStatus.stdout)).toMatchObject({
        loaded: null,
        launchdState: "unknown",
      });

      writeFileSync(plistPath, "operator-owned\n", { mode: 0o600 });
      const unmanagedUninstall = runProdWatchFromCheckout(
        ["scheduler", "uninstall"],
        runtimeRoot,
        checkoutRoot,
        sharedEnv,
      );
      expect(unmanagedUninstall.status).toBe(1);
      expect(unmanagedUninstall.stderr).toContain("launchd_plist_unmanaged");
      expect(readFileSync(plistPath, "utf8")).toBe("operator-owned\n");

      writeFileSync(plistPath, "<!-- murph-prod-watch-managed:v1 -->\n", { mode: 0o600 });
      writeFileSync(launchctlState, "loaded\n");
      const managedUninstall = runProdWatchFromCheckout(
        ["scheduler", "uninstall"],
        runtimeRoot,
        checkoutRoot,
        sharedEnv,
      );
      expect(managedUninstall.status).toBe(0);
      expect(existsSync(plistPath)).toBe(false);
    },
  );

  it("keeps Phase 1 resolution authority complete-evidence-only and sensitive incidents escalation-only", () => {
    const skill = readFileSync(
      path.join(repoRoot, ".agents", "skills", "production-watch", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain(
      "A `resolved` transition is record-only and is allowed only after a fresh, complete aggregate evidence pass independently observes an externally applied fix.",
    );
    expect(skill).toContain(
      "Missing, partial, stale, or failed evidence must lead to `monitor_incomplete` or `escalated`, never `resolved`.",
    );
    expect(skill).toContain("Provider and other sensitive incidents permit only `escalated`");
  });

  it("keeps strict JSON schemas executable and fixtures conformant", () => {
    const schemaRoot = path.join(repoRoot, "scripts", "prod-watch", "schemas");
    const snapshotSchema = JSON.parse(readFileSync(path.join(schemaRoot, "snapshot.v1.schema.json"), "utf8")) as object;
    const providerSchema = JSON.parse(readFileSync(path.join(schemaRoot, "provider-evidence.v1.schema.json"), "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    const validateSnapshot = ajv.compile(snapshotSchema);
    const validateProvider = ajv.compile(providerSchema);

    expect(validateSnapshot(buildFixtureSnapshot("healthy", new Date("2026-08-09T20:00:00.000Z"))))
      .toBe(true);
    expect(validateSnapshot.errors).toBeNull();
    expect(validateProvider(JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ))).toBe(true);
    expect(validateProvider.errors).toBeNull();
  });
});

function buildFixtureSnapshot(name: "healthy" | "suspicious", now: Date): ProductionWatchSnapshot {
  return buildFromEvidence(readFixture(name), now);
}

function buildCompleteSnapshot(now: Date): ProductionWatchSnapshot {
  return buildCompleteSnapshotWithDatabase("healthy", now);
}

function buildCompleteSnapshotWithDatabase(
  databaseFixture: "healthy" | "suspicious",
  now: Date,
): ProductionWatchSnapshot {
  const provider = parseProviderEvidence(JSON.parse(
    readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
  ) as unknown);
  return buildSnapshot({
    now,
    runId: "test-complete-run",
    mode: "collect",
    dryRun: true,
    startedAt: new Date(now.getTime() - 100),
    timeoutMs: 240000,
    skippedOverlap: false,
    previousStart: new Date(now.getTime() - 30 * 60 * 1000),
    currentStart: new Date(now.getTime() - 15 * 60 * 1000),
    end: now,
    lookbackMinutes: 15,
    settlingDelaySeconds: 0,
    configuredSources: ["database", "vercel", "cloudflare", "stripe"],
    evidences: [
      rebaseEvidence(readFixture(databaseFixture), now),
      ...provider.sources.map((source) => rebaseEvidence(source, now)),
    ],
    failures: [],
  });
}

function buildPromotedSuspiciousState() {
  const initial = createInitialState(
    new Date("2026-08-09T19:55:00.000Z"),
    ["database", "vercel", "cloudflare", "stripe"],
  );
  const first = updateStateFromSnapshot(
    initial,
    buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:00:00.000Z")),
  ).state;
  return updateStateFromSnapshot(
    first,
    buildFixtureSnapshot("suspicious", new Date("2026-08-09T20:05:00.000Z")),
  ).state;
}

function buildFromEvidence(evidence: AdapterEvidence, now: Date): ProductionWatchSnapshot {
  const rebasedEvidence = rebaseEvidence(evidence, now);
  return buildSnapshot({
    now,
    runId: "test-run",
    mode: "collect",
    dryRun: true,
    startedAt: new Date(now.getTime() - 100),
    timeoutMs: 240000,
    skippedOverlap: false,
    previousStart: new Date(now.getTime() - 30 * 60 * 1000),
    currentStart: new Date(now.getTime() - 15 * 60 * 1000),
    end: now,
    lookbackMinutes: 15,
    settlingDelaySeconds: 0,
    configuredSources: ["database", "vercel", "cloudflare", "stripe"],
    evidences: [rebasedEvidence],
    failures: [],
  });
}

function rebaseEvidence(evidence: AdapterEvidence, now: Date): AdapterEvidence {
  return {
    ...evidence,
    collectedAt: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
    freshnessSeconds: 120,
    releaseContext: evidence.releaseContext.map((release) => ({
      ...release,
      observedAt: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
      ...(release.deployedAt === undefined
        ? {}
        : { deployedAt: new Date(now.getTime() - 20 * 60 * 1000).toISOString() }),
    })),
    fingerprints: evidence.fingerprints.map((fingerprint) => ({
      ...fingerprint,
      firstSeenAt: new Date(now.getTime() - 10 * 60 * 1000).toISOString(),
      lastSeenAt: new Date(now.getTime() - 2 * 60 * 1000).toISOString(),
    })),
  };
}

function readFixture(name: "healthy" | "suspicious"): AdapterEvidence {
  return parseAdapterEvidence(JSON.parse(readFileSync(path.join(fixtureRoot, `${name}.database.json`), "utf8")) as unknown);
}

function makeTempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "murph-prod-watch-test-"));
  tempRoots.push(root);
  return root;
}

function installDatabaseFixtureHelper(
  runtimeRoot: string,
  fixture: "healthy" | "suspicious",
): Record<string, string> {
  const binRoot = path.join(runtimeRoot, "test-bin");
  mkdirSync(binRoot, { recursive: true });
  const helperScriptPath = path.join(binRoot, "database-fixture.cjs");
  writeFileSync(helperScriptPath, [
    "const { readFileSync } = require('node:fs');",
    "const evidence = JSON.parse(readFileSync(process.env.TEST_DATABASE_FIXTURE, 'utf8'));",
    "const flags = Object.fromEntries(process.argv.slice(2).filter((value) => value.startsWith('--set=')).map((value) => { const split = value.slice(6).indexOf('='); return [value.slice(6, 6 + split), value.slice(7 + split)]; }));",
    "evidence.collectedAt = flags.window_end;",
    "evidence.freshnessSeconds = 0;",
    "evidence.fingerprints = evidence.fingerprints.map((entry) => ({ ...entry, firstSeenAt: flags.previous_start, lastSeenAt: flags.window_end }));",
    "process.stdout.write(`${JSON.stringify(evidence)}\\n`);",
    "",
  ].join("\n"), { mode: 0o600 });
  const helperPath = path.join(binRoot, "murph-prod-psql-ro");
  writeFileSync(helperPath, [
    "#!/bin/sh",
    "cat >/dev/null",
    "exec \"$TEST_NODE_EXECUTABLE\" \"$TEST_DATABASE_HELPER_SCRIPT\" \"$@\"",
    "",
  ].join("\n"), { mode: 0o755 });
  chmodSync(helperPath, 0o755);
  return {
    PATH: `${binRoot}:${process.env.PATH ?? ""}`,
    TEST_DATABASE_FIXTURE: path.join(fixtureRoot, `${fixture}.database.json`),
    TEST_DATABASE_HELPER_SCRIPT: helperScriptPath,
    TEST_NODE_EXECUTABLE: process.execPath,
  };
}

function writeCurrentProviderFixture(
  targetPath: string,
  mutate?: (provider: {
    generatedAt: string;
    sources: Array<AdapterEvidence>;
  }) => void,
  observedAt = new Date(),
): void {
  const provider = JSON.parse(
    readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
  ) as { generatedAt: string; sources: Array<AdapterEvidence> };
  provider.generatedAt = observedAt.toISOString();
  provider.sources = provider.sources.map((source) => rebaseEvidence(source, observedAt));
  mutate?.(provider);
  writeFileSync(targetPath, JSON.stringify(provider), { mode: 0o600 });
  chmodSync(targetPath, 0o600);
}

function runProdWatch(
  args: string[],
  runtimeRoot: string,
  env: Record<string, string | undefined> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", prodWatchPath, ...args],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        NODE_ENV: "test",
        MURPH_PROD_WATCH_TEST_RUNTIME_ROOT: runtimeRoot,
      },
      timeout: 30_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runProdWatchFromCheckout(
  args: string[],
  runtimeRoot: string,
  checkoutRoot: string,
  env: Record<string, string | undefined>,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [
      "--preserve-symlinks-main",
      "--experimental-strip-types",
      path.join(checkoutRoot, "scripts", "prod-watch.ts"),
      ...args,
    ],
    {
      cwd: checkoutRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
        NODE_ENV: "test",
        MURPH_PROD_WATCH_TEST_RUNTIME_ROOT: runtimeRoot,
      },
      timeout: 30_000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
