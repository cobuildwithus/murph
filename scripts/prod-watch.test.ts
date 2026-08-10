import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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
import { renderLaunchdPlistTemplate } from "./prod-watch.ts";

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
    expect(() => parseProviderEvidence(raw)).toThrow("provider_ok_collection_unproven");

    const zeroAggregate = JSON.parse(
      readFileSync(path.join(fixtureRoot, "healthy.providers.json"), "utf8"),
    ) as { sources: Array<{ counters: Array<{ metric: string; current: number }> }> };
    const requestCount = zeroAggregate.sources[0]!.counters.find(
      (counter) => counter.metric === "provider_request_count",
    );
    requestCount!.current = 0;
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
    unproven.counters = [];
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
    stripeError!.sampleCount = 80;
    stripeError!.previousSampleCount = 78;

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

  it("treats clinical, consent, and integrity code paths as sensitive", () => {
    const evidence = readFixture("healthy");
    evidence.fingerprints[0]!.component = "clinical_record_write";
    evidence.fingerprints[0]!.errorCode = "canonical_write_corrupt";
    const snapshot = buildFromEvidence(evidence, new Date("2026-08-09T20:00:00.000Z"));
    expect(snapshot.anomalyCandidates.find((candidate) => candidate.ruleId === "sensitive_domain_signal"))
      .toMatchObject({ automationClass: "alert_only", severity: "high" });
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
      titleCode: "unrelated_vercel_signal",
    });
    const promoted = buildPromotedSuspiciousState();
    const incident = promoted.incidents.find((candidate) => candidate.fingerprint === primary!.fingerprint);
    expect(incident).toBeDefined();

    const filtered = filterSnapshotForIncident(snapshot, incident!);
    expect(filtered.anomalyCandidates.map((candidate) => candidate.fingerprint))
      .toEqual([primary!.fingerprint]);
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
      "--fixture",
      "healthy",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot);
    expect(skipped.status).toBe(0);
    const overlapPath = path.join(runtimeRoot, "operations", "prod-watch", "last-overlap.v1.json");
    expect(JSON.parse(readFileSync(overlapPath, "utf8"))).toMatchObject({ ownerRunId: "active-run" });

    rmSync(runLockPath, { recursive: true, force: true });
    const recovered = runProdWatch([
      "run",
      "--scheduled",
      "--fixture",
      "healthy",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot);
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
    expect(runProdWatch(["run", "--fixture", "suspicious", "--settling-delay-seconds", "0"], runtimeRoot).status)
      .toBe(0);
    expect(runProdWatch(["run", "--fixture", "suspicious", "--settling-delay-seconds", "0"], runtimeRoot).status)
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
      "--fixture",
      "suspicious",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot);
    expect(denied.status).toBe(1);
    expect(denied.stderr).toContain("incident_lease_not_owned");

    const allowed = runProdWatch([
      "drill-down",
      incident!.id,
      "--session-id",
      "session-a",
      "--fixture",
      "suspicious",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot);
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
    const result = runProdWatch([
      "run",
      "--fixture",
      "healthy",
      "--settling-delay-seconds",
      "0",
    ], runtimeRoot);
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
    expect(accepted.status).toBe(0);
    const acceptedSnapshot = JSON.parse(accepted.stdout) as ProductionWatchSnapshot;
    expect(acceptedSnapshot.sourceHealth
      .filter((source) => source.source !== "database")
      .every((source) => source.status === "ok" && source.coverage === "complete"))
      .toBe(true);
    expect(acceptedSnapshot.collectorFailures.filter((failure) => failure.source !== "database"))
      .toEqual([]);

    chmodSync(providerPath, 0o644);
    const rejected = runProdWatch(["collect", "--provider-evidence", providerPath], runtimeRoot, env);
    expect(rejected.status).toBe(0);
    const rejectedSnapshot = JSON.parse(rejected.stdout) as ProductionWatchSnapshot;
    expect(rejectedSnapshot.collectorFailures.filter((failure) => failure.source !== "database"))
      .toHaveLength(3);
    expect(rejectedSnapshot.collectorFailures
      .filter((failure) => failure.source !== "database")
      .every((failure) => failure.code === "provider_evidence_invalid"))
      .toBe(true);
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
      ["run", "--fixture", "healthy"],
      runtimeRoot,
      { MURPH_PROD_WATCH_SOURCES: "database" },
    );
    const persistedSecond = runProdWatch(
      ["run", "--fixture", "healthy"],
      runtimeRoot,
      { MURPH_PROD_WATCH_SOURCES: "database,vercel" },
    );
    expect(persistedFirst.status).toBe(0);
    expect(persistedSecond.status).toBe(0);
  });

  it("rebases checked-in provider fixtures for executable dry runs", () => {
    const runtimeRoot = makeTempRoot();
    const result = runProdWatch([
      "run",
      "--dry-run",
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

  it("runs fixture dry-run without persisting state or Markdown projections", () => {
    const runtimeRoot = makeTempRoot();
    const result = runProdWatch(["run", "--dry-run", "--fixture", "healthy"], runtimeRoot);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ schemaVersion: "prod-watch.snapshot.v1" });
    expect(existsSync(path.join(runtimeRoot, "operations", "prod-watch", "state.v1.json"))).toBe(false);
    expect(existsSync(path.join(runtimeRoot, "projections", "prod-watch", "ACTIVE_INCIDENTS.md"))).toBe(false);
  });

  it("uses the listed incident ID through the real triage command journey", () => {
    const runtimeRoot = makeTempRoot();
    expect(runProdWatch(["run", "--fixture", "suspicious"], runtimeRoot).status).toBe(0);
    const listing = runProdWatch(["incident", "list"], runtimeRoot);
    expect(listing.status).toBe(0);
    const incidentId = listing.stdout.match(/\| (pw_[A-Za-z0-9]+) \|/u)?.[1];
    expect(incidentId).toBeDefined();

    expect(runProdWatch([
      "incident", "claim", incidentId!, "--session-id", "session-cli",
    ], runtimeRoot).status).toBe(0);
    expect(runProdWatch([
      "drill-down", incidentId!, "--session-id", "session-cli", "--fixture", "suspicious",
    ], runtimeRoot).status).toBe(0);
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
});

describe("production-watch static safety contracts", () => {
  it("keeps the database query read-only and excludes private event fields", () => {
    const sql = readFileSync(path.join(repoRoot, "scripts", "prod-watch", "collect-v1.sql"), "utf8");
    expect(sql).toContain("BEGIN TRANSACTION READ ONLY");
    expect(sql).toContain("SET LOCAL statement_timeout");
    expect(sql).toContain("::timestamptz AT TIME ZONE 'UTC' AS previous_start");
    expect(sql).toContain("coalesce(first_seen_at, params.current_start) AT TIME ZONE 'UTC'");
    expect(sql).toContain("md5(fingerprint)");
    expect(sql).toContain("~* '(auth|billing|canonical|clinical|consent|corrupt|credential|");
    expect(sql.indexOf("~* '(auth|billing")).toBeLessThan(sql.indexOf("LIMIT 13"));
    expect(sql).toContain("issue.severity IN ('info', 'warning', 'error')");
    expect(sql).toContain("trace.source IN ('linq', 'telegram')");
    expect(sql).toContain("'current', false");
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

  it("ships a non-overlapping five-minute launchd template without machine paths", () => {
    const template = readFileSync(
      path.join(repoRoot, "scripts", "prod-watch", "com.murph.prod-watch.plist.template"),
      "utf8",
    );
    expect(template).toContain("<key>StartInterval</key>\n  <integer>300</integer>");
    expect(template).toContain("<key>KeepAlive</key>\n  <false/>");
    expect(template).toContain("<string>/dev/null</string>");
    expect(template).toContain("murph-prod-watch-managed:v1");
    expect(template).toContain("__REPO_HOME_RELATIVE__");
    expect(template).toContain("<string>-c</string>");
    expect(template).not.toContain("<string>-lc</string>");
    expect(template).not.toContain(os.homedir());

    const fakeHome = path.join(os.tmpdir(), "prod-watch-home");
    const rendered = renderLaunchdPlistTemplate(template, path.join(fakeHome, "project"), fakeHome);
    expect(rendered).toContain("$HOME/project");
    expect(rendered).toContain("pnpm --silent prod-watch run --scheduled");
    expect(rendered).not.toContain(fakeHome);
    expect(() => renderLaunchdPlistTemplate(template, path.join(fakeHome, "..", "project"), fakeHome))
      .toThrow("scheduler_repo_path_unsafe");
  });

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
      mkdirSync(fakeHome, { recursive: true });
      mkdirSync(binRoot, { recursive: true });
      mkdirSync(launchAgentsRoot, { recursive: true });
      symlinkSync(repoRoot, checkoutRoot, "dir");

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
    expect(skill).toContain("Use `escalated` for sensitive domains; they remain escalation-only");
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
      rebaseEvidence(readFixture("healthy"), now),
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
