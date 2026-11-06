import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostedRuntimeOwnerCommand, HostedRuntimeOwnerSnapshot } from "@murphai/hosted-execution/runtime-owner";
import { parseHostedRuntimeHealthDataAdmissionResponse } from "@murphai/hosted-execution/parsers";
import { POST as companionConsent } from "../app/api/device-sync/companion/legal-consent/route";
import { GET as admission } from "../app/api/internal/hosted-runtime/health-data-admission/route";
import { claimHostedRuntime, type HostedRuntimeIdentity, type HostedRuntimeOwner } from "@/src/lib/hosted-execution/runtime-owner";
import { executeHostedRuntimeOwnerCommand } from "@/src/lib/hosted-execution/runtime-owner-control";
import { redriveHostedHealthDataConsentStops } from "@/src/lib/hosted-privacy/health-data-consent-withdrawal";
import { buildCurrentHostedConsentDocumentVersions, HOSTED_HEALTH_DATA_CONSENT_SCOPE, recordHostedLaunchRequiredConsent, revokeHostedConsentScope } from "@/src/lib/legal/consent";
import { createPrismaClient } from "@/src/lib/prisma";

const mocks = vi.hoisted(() => ({ getPrisma: vi.fn(), control: vi.fn() }));
vi.mock("@/src/lib/prisma", async importOriginal => ({
  ...await importOriginal<typeof import("@/src/lib/prisma")>(), getPrisma: mocks.getPrisma,
}));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: mocks.control }));
vi.mock("@/src/lib/hosted-execution/cloudflare-callback-auth", () => ({
  requireHostedCloudflareCallbackRequest: async (request: Request) => request.headers.get("x-synthetic-bound-user"),
}));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({
  requireHostedMemberAuthFromBearerToken: async (request: Request) => ({ member: { id: request.headers.get("x-synthetic-bound-user") } }),
}));

const databaseUrl = process.env.DATABASE_URL ?? "";
const enabled = process.env.MURPH_TEST_POSTGRES_CONCURRENCY === "1";
if (enabled) {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || url.searchParams.has("host")) {
    throw new Error("Consent stop proof requires a loopback PostgreSQL database.");
  }
}

type Hook = (memberId: string, owner: HostedRuntimeOwnerSnapshot | null) => Promise<void>;
type Step = "beforeReconcile" | "afterSnapshot" | "afterAdmission" | "beforeStop" | "afterRetire" | "beforeNativeStop" | "afterNativeStop" | "afterRelease";
type Shape = "active" | "starting" | "cold" | "warm" | "retained" | "idle" | "absent";

function identity(owner: HostedRuntimeOwner): HostedRuntimeIdentity {
  if (!owner.attemptId) throw new Error("Expected a claimed runtime.");
  return { userId: owner.userId, attemptId: owner.attemptId, generation: owner.generation.toString() };
}

describe.skipIf(!enabled)("Postgres consent stop redrive", () => {
  let prisma: PrismaClient;
  const members = new Set<string>();
  const slots = new Map<string, "bound" | "retired">();
  const destructions: string[] = [];
  const commands: Array<{ memberId: string; command: HostedRuntimeOwnerCommand; status: string }> = [];
  let hooks: Partial<Record<Step, Hook>>;
  const reconcile = vi.fn(workerReconcile);
  const tick = () => redriveHostedHealthDataConsentStops({ prisma });
  const row = (userId: string) => prisma.hostedRuntimeOwner.findUniqueOrThrow({ where: { userId } });
  const grant = (memberId: string) => recordHostedLaunchRequiredConsent({ memberId, prisma, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE });
  const revoke = (memberId: string) => revokeHostedConsentScope({ memberId, prisma, scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE });
  const operations = (memberId: string) => commands.filter(c => c.memberId === memberId).map(c => c.command.operation);
  /** The real native renewal: its stop and its grant are not a test's ordering choice. */
  const renew = async (memberId: string) => {
    const response = await companionConsent(new Request("https://app.example.test/api/device-sync/companion/legal-consent", {
      method: "POST", headers: { "content-type": "application/json", "x-synthetic-bound-user": memberId },
      body: JSON.stringify({ scope: HOSTED_HEALTH_DATA_CONSENT_SCOPE, acceptedDocumentVersions: buildCurrentHostedConsentDocumentVersions(HOSTED_HEALTH_DATA_CONSENT_SCOPE) }),
    }));
    expect(response.status).toBe(200);
  };

  beforeAll(() => {
    prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
    mocks.getPrisma.mockReturnValue(prisma);
  });
  beforeEach(() => {
    hooks = {};
    reconcile.mockClear();
    mocks.control.mockReturnValue({ reconcileRuntimeHealthDataConsent: reconcile });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    const ids = [...members];
    await prisma.hostedRuntimeOwner.deleteMany({ where: { userId: { in: ids } } });
    await prisma.hostedConsentEvent.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.hostedConsentGrant.deleteMany({ where: { memberId: { in: ids } } });
    await prisma.hostedMember.deleteMany({ where: { id: { in: ids } } });
    members.clear();
    slots.clear();
    destructions.length = 0;
    commands.length = 0;
    vi.restoreAllMocks();
  });
  afterAll(async () => { await prisma?.$disconnect(); });

  async function send(memberId: string, command: HostedRuntimeOwnerCommand) {
    const result = await executeHostedRuntimeOwnerCommand({ prisma, userId: memberId, command });
    commands.push({ memberId, command, status: result.status });
    return result;
  }

  // Section B in runtime-user-control-postgres.test.ts pins the real Worker to this sequence.
  async function workerReconcile(memberId: string) {
    // Unrelated database fixtures must never be mutated by this synthetic Worker.
    if (!members.has(memberId)) throw new Error("Synthetic Worker only owns its fixtures.");
    await hooks.beforeReconcile?.(memberId, null);
    const { owner } = await send(memberId, { operation: "reconcile" });
    await hooks.afterSnapshot?.(memberId, owner);
    const response = await admission(new Request("https://app.example.test/api/internal/hosted-runtime/health-data-admission", {
      headers: { "x-synthetic-bound-user": memberId },
    }));
    expect(response.status).toBe(200);
    const current = parseHostedRuntimeHealthDataAdmissionResponse(await response.json());
    expect(current.userId).toBe(memberId);
    await hooks.afterAdmission?.(memberId, owner);
    const stopped = { activeInvocationPreempted: false, runnerContainerDestroyAttempted: false, runnerContainerDestroyOk: true };
    if (!current.processingAllowed && owner) {
      await hooks.beforeStop?.(memberId, owner);
      if (owner.attemptId) {
        const retired = await send(memberId, { operation: "retire", attemptId: owner.attemptId, generation: owner.generation, completed: false });
        if (retired.status !== "updated") throw new Error("Runtime changed during user-control retirement.");
        stopped.activeInvocationPreempted = true;
        await hooks.afterRetire?.(memberId, owner);
      }
      if (owner.runnerContainerName) {
        stopped.runnerContainerDestroyAttempted = true;
        await hooks.beforeNativeStop?.(memberId, owner);
        if (!slots.has(owner.runnerContainerName)) throw new Error("Synthetic slot is unavailable.");
        destructions.push(owner.runnerContainerName);
        slots.set(owner.runnerContainerName, "retired");
        if (slots.get(owner.runnerContainerName) !== "retired") throw new Error("Runtime stop was not confirmed.");
        await hooks.afterNativeStop?.(memberId, owner);
        await send(memberId, { operation: "target_retired", runnerContainerName: owner.runnerContainerName });
      } else if (owner.attemptId) {
        const released = await send(memberId, { operation: "release", attemptId: owner.attemptId, generation: owner.generation, runnerContainerName: null });
        if (released.status !== "updated") throw new Error("Runtime allocation retirement was not confirmed.");
      }
      await hooks.afterRelease?.(memberId, owner);
    }
    return { ...current, ...stopped };
  }

  async function launch(memberId: string, starting = false) {
    expect(await send(memberId, { operation: "claim", processingMode: "default" })).toMatchObject({ status: "claimed" });
    const claimed = await claimHostedRuntime({ prisma, userId: memberId, processingMode: "default" });
    if (claimed.status === "blocked") throw new Error("Unexpected admission rejection.");
    expect(claimed.status).toBe("existing");
    const runtime = identity(claimed.owner);
    const target = `synthetic-consent-slot-${randomUUID()}`;
    if (!starting) {
      expect(await send(memberId, { operation: "prepare_launch", ...runtime, runnerContainerName: target,
        workspaceVersion: "0", providerEgressTokenHash: null, platformAiUsageAllowed: true, processingMode: "default" })).toMatchObject({ status: "updated" });
      expect(await send(memberId, { operation: "accepted", ...runtime })).toMatchObject({ status: "updated" });
      slots.set(target, "bound");
    }
    return { memberId, runtime, target, allocationId: claimed.owner.allocationId };
  }

  async function fixture(shape: Shape = "active", consent: "granted" | "revoked" | "missing" = "revoked") {
    const memberId = `consent_stop_proof_${randomUUID()}`;
    members.add(memberId);
    await prisma.hostedMember.create({ data: { id: memberId, billingStatus: "active" } });
    if (consent !== "missing") await grant(memberId);
    const runtime = shape === "absent" ? null : await launch(memberId, shape === "starting");
    if (runtime && ["warm", "retained"].includes(shape)) {
      expect(await send(memberId, { operation: "complete", ...runtime.runtime,
        settledRunnerContainerName: shape === "retained" ? runtime.target : null, immediateRecheckRequested: false })).toMatchObject({ status: "updated" });
    }
    if (runtime && ["cold", "idle"].includes(shape)) {
      expect(await send(memberId, { operation: "retire", ...runtime.runtime, completed: false })).toMatchObject({ status: "updated" });
      if (shape === "idle") {
        slots.set(runtime.target, "retired");
        expect(await send(memberId, { operation: "target_retired", runnerContainerName: runtime.target })).toMatchObject({ status: "updated" });
      }
    }
    if (consent === "revoked") await revoke(memberId);
    return { memberId, runtime: runtime?.runtime, target: runtime?.target, allocationId: runtime?.allocationId };
  }

  async function tickSelecting(memberId: string) {
    for (let i = 0; i < 40; i++) {
      const start = reconcile.mock.calls.length;
      const result = await tick();
      if (reconcile.mock.calls.slice(start).some(([id]) => id === memberId)) return result;
    }
    throw new Error("Synthetic candidate was not selected within the bounded rotation.");
  }

  it("selects every explicit revoked owner or retained target regardless of age or eligibility", async () => {
    const included = [];
    for (const shape of ["active", "starting", "cold", "warm", "retained"] as const) included.push(await fixture(shape));
    const old = await fixture();
    await prisma.hostedConsentGrant.updateMany({ where: { memberId: old.memberId }, data: { revokedAt: new Date("2001-01-01T00:00:00Z") } });
    const paused = await fixture();
    await prisma.hostedMember.update({ where: { id: paused.memberId }, data: { billingStatus: "paused" } });
    const suspended = await fixture();
    await prisma.hostedMember.update({ where: { id: suspended.memberId }, data: { suspendedAt: new Date() } });
    included.push(old, paused, suspended);
    const excluded = [await fixture("active", "granted"), await fixture("active", "missing"), await fixture("idle"), await fixture("absent")];
    const expected = new Set(included.map(f => f.memberId));
    const seen = new Set<string>();
    for (let i = 0; i < 40 && seen.size < expected.size; i++) {
      await tick();
      for (const [id] of reconcile.mock.calls) if (members.has(id)) seen.add(id);
    }
    expect(seen).toEqual(expected);
    for (const f of included) expect(await row(f.memberId)).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
    for (const f of excluded) expect(seen.has(f.memberId)).toBe(false);
  });

  it("bounds each tick to eight calls", async () => {
    for (let i = 0; i < 11; i++) await fixture();
    const result = await tick();
    expect(reconcile.mock.calls).toHaveLength(8);
    expect(result.reconciled + result.failed).toBe(8);
  });

  it.each([
    ["active", "beforeStop"], ["active", "afterRetire"], ["active", "afterNativeStop"], ["active", "afterRelease"],
    ["retained", "beforeStop"], ["retained", "beforeNativeStop"], ["retained", "afterNativeStop"], ["retained", "afterRelease"],
    ["starting", "beforeStop"], ["starting", "afterRetire"], ["starting", "afterRelease"],
  ] as const)("recovers %s interrupted at %s", async (shape, step) => {
    const f = await fixture(shape);
    const before = await row(f.memberId);
    hooks[step] = async id => { if (id === f.memberId) throw new Error("Synthetic process killed."); };
    expect(await tickSelecting(f.memberId)).toMatchObject({ configured: true, failed: 1 });
    const interrupted = await row(f.memberId);
    if (step === "afterRelease") {
      expect(interrupted).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
    } else if (step === "beforeStop" || shape === "retained") {
      expect(interrupted).toEqual(before);
    } else {
      expect(interrupted).toMatchObject({ phase: "retiring", completedAt: null, platformAiUsageAllowed: false,
        runnerContainerName: before.runnerContainerName, allocationId: before.allocationId, attemptId: before.attemptId });
    }
    if (shape !== "starting") expect(slots.get(f.target!)).toBe(["afterNativeStop", "afterRelease"].includes(step) ? "retired" : "bound");
    hooks = {};
    reconcile.mockClear();
    if (step === "afterRelease") {
      await tick();
      expect(reconcile.mock.calls.some(([id]) => id === f.memberId)).toBe(false);
    } else await tickSelecting(f.memberId);
    expect(await row(f.memberId)).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
    if (shape === "starting") expect(destructions).toEqual([]);
    reconcile.mockClear();
    await tick();
    expect(reconcile.mock.calls.some(([id]) => id === f.memberId)).toBe(false);
  });

  it("retries the retained target when settled completion wins before retire", async () => {
    const f = await fixture();
    hooks.afterSnapshot = async id => {
      if (id !== f.memberId) return;
      expect(await send(id, { operation: "complete", ...f.runtime!, settledRunnerContainerName: f.target!, immediateRecheckRequested: false })).toMatchObject({ status: "updated" });
    };
    expect(await tickSelecting(f.memberId)).toMatchObject({ failed: 1 });
    expect(commands.at(-1)).toMatchObject({ command: { operation: "retire" }, status: "stale" });
    expect(await row(f.memberId)).toMatchObject({ phase: "idle", runnerContainerName: f.target, allocationId: f.allocationId });
    expect(destructions).toEqual([]);
    hooks = {};
    await tickSelecting(f.memberId);
    expect(destructions).toEqual([f.target]);
    expect(await row(f.memberId)).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
  });

  it("makes early completion cold so delayed release_completed cannot retain its target", async () => {
    const f = await fixture("warm");
    hooks.afterRetire = async id => {
      if (id !== f.memberId) return;
      const cold = await row(id);
      expect(cold).toMatchObject({ phase: "retiring", completedAt: null });
      expect(await send(id, { operation: "release_completed", ...f.runtime!, runnerContainerName: f.target! })).toMatchObject({ status: "stale" });
      expect(await row(id)).toEqual(cold);
    };
    await tickSelecting(f.memberId);
    expect(await row(f.memberId)).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
  });

  it("rereads a regrant after selection without touching ownership or the slot", async () => {
    const f = await fixture();
    const before = await row(f.memberId);
    commands.length = 0;
    hooks.beforeReconcile = async id => { if (id === f.memberId) await grant(id); };
    await tickSelecting(f.memberId);
    expect(operations(f.memberId)).toEqual(["reconcile"]);
    expect(destructions).toEqual([]);
    expect(await row(f.memberId)).toEqual(before);
    reconcile.mockClear();
    await tick();
    expect(reconcile.mock.calls.some(([id]) => id === f.memberId)).toBe(false);
  });

  it.each(["active", "retained"] as const)("preserves a new generation after an in-flight %s stop read revoked", async shape => {
    const f = await fixture(shape);
    let successor: Awaited<ReturnType<typeof launch>> | undefined;
    let renewed: Awaited<ReturnType<typeof row>> | undefined;
    hooks.afterAdmission = async id => {
      if (id !== f.memberId) return;
      delete hooks.afterAdmission;
      await renew(id);
      expect(await row(id)).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
      successor = await launch(id);
      expect(successor.target).not.toBe(f.target);
      expect(successor.allocationId).not.toBe(f.allocationId);
      renewed = await row(id);
    };
    const result = await tickSelecting(f.memberId);
    expect(result.failed).toBe(shape === "active" ? 1 : 0);
    expect(commands.at(-1)).toMatchObject({ command: { operation: shape === "active" ? "retire" : "target_retired" }, status: "stale" });
    expect(await row(f.memberId)).toEqual(renewed);
    expect(destructions).not.toContain(successor!.target);
    expect(slots.get(successor!.target)).toBe("bound");
    expect(slots.get(f.target!)).toBe("retired");
  });

  it("allows a clean renewed generation and stops it after another explicit revoke", async () => {
    const f = await fixture("retained");
    await renew(f.memberId);
    const successor = await launch(f.memberId);
    const before = await row(f.memberId);
    commands.length = 0;
    destructions.length = 0;
    expect(await workerReconcile(f.memberId)).toMatchObject({ processingAllowed: true });
    expect(operations(f.memberId)).toEqual(["reconcile"]);
    expect(await row(f.memberId)).toEqual(before);
    expect(destructions).toEqual([]);
    reconcile.mockClear();
    await tick();
    expect(reconcile.mock.calls.some(([id]) => id === f.memberId)).toBe(false);
    await revoke(f.memberId);
    await tickSelecting(f.memberId);
    expect(destructions).toEqual([successor.target]);
    expect(await row(f.memberId)).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
  });

  it("lets healthy stops finish while one rejects and another hangs until rejection", async () => {
    const failing = await fixture();
    const hanging = await fixture();
    const healthy = [await fixture(), await fixture()];
    let rejectHang!: (error: Error) => void;
    let hangStarted = false;
    const held = new Promise<void>((_, reject) => { rejectHang = reject; });
    void held.catch(() => undefined);
    hooks.beforeReconcile = async id => {
      if (id === failing.memberId) throw new Error("Synthetic rejection.");
      if (id === hanging.memberId) { hangStarted = true; await held; }
    };
    let settled = false;
    const pending = Promise.allSettled([tick()]).then(results => { settled = true; return results; });
    try {
      await vi.waitFor(() => expect(hangStarted).toBe(true));
      await vi.waitFor(async () => {
        for (const f of healthy) expect(await row(f.memberId)).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
      });
      expect(settled).toBe(false);
    } finally {
      rejectHang(new Error("Synthetic client timeout."));
      await pending;
    }
    expect(await pending).toEqual([{ status: "fulfilled", value: { configured: true, reconciled: 2, failed: 2 } }]);
    expect(await row(failing.memberId)).toMatchObject({ phase: "active" });
    expect(await row(hanging.memberId)).toMatchObject({ phase: "active" });
  });

  it("rotates past eight persistent failures to converge a healthy candidate", async () => {
    const failing = new Set<string>();
    for (let i = 0; i < 8; i++) failing.add((await fixture()).memberId);
    const healthy = await fixture();
    hooks.beforeReconcile = async id => { if (failing.has(id)) throw new Error("Synthetic persistent failure."); };
    await tickSelecting(healthy.memberId);
    expect(await row(healthy.memberId)).toMatchObject({ phase: "idle", runnerContainerName: null, allocationId: null });
  });

  it("does not query when the control client is unconfigured", async () => {
    mocks.control.mockReturnValue(null);
    const query = vi.spyOn(prisma, "$queryRaw");
    expect(await tick()).toEqual({ configured: false, reconciled: 0, failed: 0 });
    expect(query).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});
