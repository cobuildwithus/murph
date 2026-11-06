import { beforeEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { addMeal, initializeVault } from "@murphai/core";
import { createBrowserVaultCoreQueryClient, parseBrowserVaultCoreShard, splitBrowserVaultReplica } from "@murphai/query/browser-replica-client";
import { createBrowserVaultReplica, readVault } from "@murphai/query/browser-replica-server";
import { NodeNextRequest } from "next/dist/server/base-http/node";
import { NextRequestAdapter } from "next/dist/server/web/spec-extension/adapters/next-request";
import { hostedOnboardingError } from "@/src/lib/hosted-onboarding/errors";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), current: vi.fn(), authority: vi.fn(), workspace: vi.fn(), control: vi.fn(), decode: vi.fn(), submit: vi.fn(), uploadLinks: vi.fn(), thumbnails: vi.fn() }));
vi.mock("@/src/lib/prisma", () => ({ getPrisma: () => ({ $queryRaw: mocks.uploadLinks }) }));
vi.mock("@/src/lib/hosted-onboarding/request-auth", () => ({ requireActiveHostedMemberAuthFromBearerToken: mocks.auth }));
vi.mock("@/src/lib/better-auth/native-auth", () => ({ assertHostedNativeMemberAuthCurrentTx: mocks.current }));
vi.mock("@/src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("@/src/lib/hosted-workspace/store", () => ({ readHostedWorkspace: mocks.workspace }));
vi.mock("@/src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: () => ({ createBrowserVaultSession: mocks.control, mealThumbnailDeliveries: mocks.thumbnails }) }));
vi.mock("@/src/lib/member-actions/submit", () => ({ submitMemberAction: mocks.submit }));
vi.mock("@/src/lib/browser-vault/loader", () => ({ parseBrowserVaultSessionResponse: (value: unknown) => value, decodeReadyBrowserVaultSession: mocks.decode }));
import { GET } from "../app/api/device-sync/companion/meals/route";
import { GET as detail, DELETE } from "../app/api/device-sync/companion/meals/[mealId]/route";

const savedAt = "2026-11-01T12:00:00.000Z";
const replicaRef = {
  byteLength: 128, dataVersion: "d".repeat(64), generatedAt: savedAt, generation: 17,
  keyId: "browser-vault-replica:d", objectKey: "users/browser-vault-replicas/opaque/replica.json",
  replicaSchema: "murph.browser-vault-replica", runtimeRootKeyId: "udrk:runtime:test-root",
  schema: "murph.hosted-browser-vault-replica-ref.v1", sourceBundleHash: "a".repeat(64),
};
const meal = { id: "meal_fixture", eatenAt: savedAt, name: "Synthetic grain bowl", calories: 500, proteinGrams: null, carbsGrams: null, fatGrams: null, uploadId: null };
const days = ["2026-11-01", "2026-10-31", "2026-10-30"].map(date => ({ date, calories: 500, proteinGrams: null, carbsGrams: null, fatGrams: null, mealCount: 1, calorieMealCount: 1, meals: [{ ...meal, id: date === "2026-11-01" ? meal.id : `meal_${date.replaceAll("-", "")}` }] }));
const projection = { schemaVersion: 1, timeZone: "Asia/Tokyo", days };
const request = (query = "", init?: RequestInit & { duplex?: "half" }) => new Request(`https://app.example.test/api/device-sync/companion/meals${query}`, init);
const context = (mealId = meal.id) => ({ params: Promise.resolve({ mealId }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ member: { id: "member_native" } });
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: replicaRef, version: "v1" });
  mocks.control.mockResolvedValue({ state: "ready" });
  mocks.decode.mockResolvedValue({ client: { replica: { displayName: "Avery", generation: 17, generatedAt: savedAt, meals: projection, entities: [], privateNotes: ["must not leave reader"] } } });
  mocks.submit.mockResolvedValue({ accepted: true, actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243" });
});

it("pages whole days using vault timezone, saved timestamp, and native identity", async () => {
  const first = await GET(request("?limit=2"));
  expect(first.status).toBe(200);
  expect(first.headers.get("cache-control")).toContain("no-store");
  expect(await first.json()).toEqual({ timeZone: "Asia/Tokyo", savedAt, days: publicDays(days.slice(0, 2)), nextCursor: "2026-10-31" });
  expect(await (await GET(request("?limit=2&cursor=2026-10-31"))).json()).toEqual({ timeZone: "Asia/Tokyo", savedAt, days: publicDays(days.slice(2)), nextCursor: null });
  expect(mocks.control).toHaveBeenCalledWith(expect.objectContaining({ userId: "member_native", requestedShards: ["core"] }));
  expect(mocks.decode).toHaveBeenCalledWith(expect.objectContaining({ expectedMemberId: "member_native" }));
});

it.each(["", "2026-02-30", "nope", "2026-13-01"])("rejects bad cursor %s distinctly", async cursor => {
  const response = await GET(request(`?cursor=${cursor}`));
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "MEALS_INVALID_CURSOR" } });
});

it.each(["?limit=0", "?limit=32", "?limit=1.5", "?limit=1&limit=2", "?memberId=someone-else"])("rejects invalid request %s", async query => {
  expect(await (await GET(request(query))).json()).toMatchObject({ error: { code: "MEALS_INVALID_REQUEST" } });
});

it("returns only the one member-owned meal without images or provenance", async () => {
  expect(await (await detail(request(), context())).json()).toEqual({ timeZone: "Asia/Tokyo", savedAt, meal: { ...meal, photo: null } });
});

it.each([undefined, null, 0, 6.5])("serves legacy and fiber core replicas through both route presenters: %s", async fiberGrams => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "synthetic-meals-fiber-"));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const replica = await createBrowserVaultReplica({ vault: await readVault(vaultRoot), metricPoints: [], generatedAt: savedAt, sourceBundleHash: "a".repeat(64) });
    const savedMeal = { ...meal, ...(fiberGrams === undefined ? {} : { fiberGrams }) };
    const savedDay = { ...days[0]!, meals: [savedMeal] };
    replica.meals = { schemaVersion: 1, timeZone: "UTC", days: [savedDay] };
    const shards = await splitBrowserVaultReplica(replica);
    const core = parseBrowserVaultCoreShard(JSON.parse(JSON.stringify(shards.core)));
    mocks.decode.mockResolvedValue({ client: createBrowserVaultCoreQueryClient(core) });
    const listing = await GET(request());
    expect(listing.status).toBe(200);
    expect(await listing.json()).toEqual({
      timeZone: "UTC", savedAt, days: [{ ...savedDay, meals: [{ ...savedMeal, photo: null }] }], nextCursor: null,
    });
    const single = await detail(request(), context());
    expect(single.status).toBe(200);
    expect(await single.json()).toEqual({ timeZone: "UTC", savedAt, meal: { ...savedMeal, photo: null } });
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});

it.each(["meal_othermember", "invalid"])("treats missing or foreign IDs alike: %s", async id => {
  for (const route of [detail, DELETE]) {
    const response = await route(request(), context(id));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "MEAL_NOT_FOUND" } });
  }
  expect(mocks.submit).not.toHaveBeenCalled();
});

it.each([null, { ...replicaRef, generation: 16 }])("fails closed on missing/old projection before queuing", async ref => {
  mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: ref });
  const response = await DELETE(request(), context());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "MEALS_PROJECTION_UNAVAILABLE", retryable: true } });
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.control).not.toHaveBeenCalled();
});

it("distinguishes a valid empty snapshot from a missing meals payload or decryption failure", async () => {
  mocks.decode.mockResolvedValueOnce({ client: { replica: { generation: 17, generatedAt: savedAt, entities: [], meals: { ...projection, days: [] } } } });
  expect(await (await GET(request())).json()).toEqual({ timeZone: "Asia/Tokyo", savedAt, days: [], nextCursor: null });
  mocks.decode.mockResolvedValueOnce({ client: { replica: { generation: 17 } } });
  expect((await GET(request())).status).toBe(503);
  mocks.decode.mockRejectedValueOnce(new Error("synthetic decryption failure"));
  expect((await GET(request())).status).toBe(503);
});

it("returns accepted only after typed mailbox admission with session revalidation", async () => {
  const response = await DELETE(request("", { method: "DELETE" }), context());
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: true, actionId: "2f1c1fdc-c7b0-4d90-b902-8e6295959243" });
  const submitted = mocks.submit.mock.calls[0]![0];
  expect(submitted).toMatchObject({ memberId: "member_native", request: { action: { kind: "meal.delete", version: 1, mealId: meal.id }, schemaVersion: 1 } });
  await submitted.assertCurrentAuthorityTx({ transaction: true });
  expect(mocks.current).toHaveBeenLastCalledWith({ member: { id: "member_native" } }, { transaction: true });
});

it("reports failed admission and does not accept request bodies", async () => {
  mocks.submit.mockRejectedValue(new Error("synthetic mailbox failure"));
  expect(await (await DELETE(request(), context())).json()).toMatchObject({ error: { code: "MEAL_REMOVAL_UNAVAILABLE" } });
  mocks.submit.mockClear();
  expect((await DELETE(request("", { method: "DELETE", body: "{}" }), context())).status).toBe(400);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it.each(["omitted", "empty string", "empty stream"])("accepts a DELETE with %s body", async kind => {
  const body = kind === "omitted" ? undefined : kind === "empty string" ? ""
    : new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });
  const response = await DELETE(request("", { method: "DELETE", body, duplex: "half", headers: { "content-length": "0" } }), context());
  expect(response.status).toBe(202);
  expect(mocks.submit).toHaveBeenCalledTimes(1);
});

it.each(["one byte", "oversized stream"])("rejects a DELETE with %s before submission", async kind => {
  const body = kind === "one byte" ? "x" : new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1024)); controller.close(); },
  });
  const response = await DELETE(request("", { method: "DELETE", body, duplex: "half" }), context());
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "MEALS_INVALID_REQUEST", retryable: false } });
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("accepts body-free HTTP DELETE through Next's Node request adapter", async () => {
  let streamPresent = false;
  const server = createServer(async (incoming, outgoing) => {
    try {
      const adapted = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), new AbortController().signal);
      streamPresent = adapted.body !== null;
      const response = await DELETE(adapted, context());
      outgoing.writeHead(response.status);
      outgoing.end(await response.text());
    } catch {
      outgoing.writeHead(500).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Synthetic server address missing.");
    const response = await fetch(`http://127.0.0.1:${address.port}/api/device-sync/companion/meals/${meal.id}`, {
      method: "DELETE", headers: { "content-length": "0", connection: "close" },
    });
    expect(streamPresent).toBe(true);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ accepted: true });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it.each([401, 403])("preserves existing access error %s without loading health data", async httpStatus => {
  mocks.auth.mockRejectedValue(hostedOnboardingError({ code: "ACCESS_DENIED", message: "Access denied.", httpStatus }));
  expect((await GET(request())).status).toBe(httpStatus);
  expect(mocks.workspace).not.toHaveBeenCalled();
});

it("withholds health data if session or consent is revoked during decryption", async () => {
  mocks.current.mockRejectedValueOnce(hostedOnboardingError({ code: "UNAUTHORIZED", message: "Sign in required.", httpStatus: 401 }));
  expect((await GET(request())).status).toBe(401);
  mocks.authority.mockResolvedValueOnce(undefined).mockRejectedValueOnce(hostedOnboardingError({ code: "HOSTED_CONSENT_REQUIRED", message: "Consent required.", httpStatus: 403 }));
  const response = await DELETE(request(), context());
  expect(response.status).toBe(403);
  expect(mocks.submit).not.toHaveBeenCalled();
});


it.each(["2f1c1fdc-c7b0-4d90-b902-8e6295959243", "a".repeat(64), null])("returns the saved upload ID in list and detail (%s)", async uploadId => {
  const linkedMeal = { ...meal, uploadId, photo: null };
  mocks.decode.mockResolvedValue({ client: { replica: { entities: [], generation: 17, generatedAt: savedAt, meals: { ...projection, days: [{ ...days[0], meals: [linkedMeal] }] } } } });
  expect(await (await GET(request())).json()).toMatchObject({ days: [{ meals: [linkedMeal] }] });
  expect(await (await detail(request(), context())).json()).toEqual({ timeZone: "Asia/Tokyo", savedAt, meal: linkedMeal });
  expect((await DELETE(request("", { method: "DELETE" }), context())).status).toBe(202);
});


it("serves upload IDs from real canonical projection records and keeps typed/texted photos null", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "synthetic-meals-api-"));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const photoPath = path.join(vaultRoot, "synthetic.jpg");
    await writeFile(photoPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const expected = new Map<string, string | null>();
    for (const uploadId of ["2f1c1fdc-c7b0-4d90-b902-8e6295959243", "a".repeat(64), undefined]) {
      const imported = await addMeal({ vaultRoot, photoPath, occurredAt: savedAt, uploadId });
      expected.set(imported.mealId, uploadId ?? null);
    }
    const typed = await addMeal({ vaultRoot, occurredAt: savedAt, note: "Synthetic typed meal" });
    expected.set(typed.mealId, null);
    const replica = await createBrowserVaultReplica({ vault: await readVault(vaultRoot), metricPoints: [], generatedAt: savedAt, sourceBundleHash: "a".repeat(64) });
    mocks.decode.mockResolvedValue({ client: { replica } });
    const listing = await (await GET(request())).json();
    expect(listing.days[0].meals).toHaveLength(4);
    for (const [id, uploadId] of expected) {
      expect(listing.days[0].meals).toContainEqual(expect.objectContaining({ id, uploadId }));
      expect(await (await detail(request(), context(id))).json()).toMatchObject({ meal: { id, uploadId } });
    }
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});

it("recovers legacy exact automatic upload links in list and detail, then rechecks authority", async () => {
  const captureId = "a".repeat(64);
  const oldProjection = structuredClone(projection);
  const entities = [{ family: "event", kind: "meal", attributes: {
    mealId: meal.id, source: "device",
    externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: captureId },
  } }];
  mocks.decode.mockImplementation(async () => ({ client: { replica: {
    generation: 17, generatedAt: savedAt, meals: structuredClone(oldProjection), entities,
  } } }));
  mocks.uploadLinks.mockResolvedValue([{ captureId }]);
  const list = await (await GET(request())).json();
  expect(list.days[0].meals[0]).toEqual({ ...meal, uploadId: captureId, photo: null });
  expect(await (await detail(request(), context())).json()).toEqual({ timeZone: projection.timeZone, savedAt, meal: { ...meal, uploadId: captureId, photo: null } });
  expect(mocks.uploadLinks).toHaveBeenCalledTimes(2);
  expect(mocks.uploadLinks.mock.calls[0]![0].values).toEqual(["member_native", [captureId]]);
  expect(mocks.current.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.uploadLinks.mock.invocationCallOrder[0]!);
  expect(JSON.stringify(list)).not.toContain("externalRef");
  mocks.uploadLinks.mockResolvedValue([]);
  expect((await (await detail(request(), context())).json()).meal.uploadId).toBeNull();
  mocks.uploadLinks.mockClear();
  expect((await DELETE(request(), context())).status).toBe(202);
  expect(mocks.uploadLinks).not.toHaveBeenCalled();
  mocks.uploadLinks.mockResolvedValue([{ captureId }]);
  mocks.current.mockRejectedValueOnce(hostedOnboardingError({ code: "AUTH_REQUIRED", httpStatus: 401, message: "Sign in again." }));
  expect((await GET(request())).status).toBe(401);
});

it("recovers an edited capture's upload link from its capture reference", async () => {
  const captureId = "c".repeat(64);
  const entities = [{ family: "event", kind: "meal", attributes: {
    mealId: meal.id, source: "manual",
    externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: captureId },
  } }];
  mocks.decode.mockImplementation(async () => ({ client: { replica: {
    generation: 17, generatedAt: savedAt, meals: structuredClone(projection), entities,
  } } }));
  mocks.uploadLinks.mockResolvedValue([{ captureId }]);
  expect((await (await GET(request())).json()).days[0].meals[0].uploadId).toBe(captureId);
});

it("recovers a real legacy import from the frozen production core client without changing its snapshot", async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), "synthetic-meals-frozen-"));
  try {
    await initializeVault({ vaultRoot, timezone: "UTC" });
    const captureId = "b".repeat(64);
    const imported = await addMeal({ vaultRoot, occurredAt: savedAt, source: "device", note: "Synthetic imported meal",
      externalRef: { system: "meal-photo-capture", resourceType: "photo", resourceId: captureId } });
    const typed = await addMeal({ vaultRoot, occurredAt: "2026-10-31T12:00:00Z", note: "Synthetic typed meal" });
    const replica = await createBrowserVaultReplica({ vault: await readVault(vaultRoot), metricPoints: [], generatedAt: savedAt, sourceBundleHash: "a".repeat(64) });
    const shards = await splitBrowserVaultReplica(replica);
    const client = createBrowserVaultCoreQueryClient(shards.core);
    mocks.decode.mockResolvedValue({ client });
    mocks.uploadLinks.mockResolvedValue([{ captureId }]);
    expect(Object.isFrozen(client.replica.meals!.days[0]!.meals[0])).toBe(true);
    expect(await (await GET(request())).json()).toMatchObject({ days: [{ meals: [{ id: imported.mealId, uploadId: captureId }] }, { meals: [{ id: typed.mealId, uploadId: null }] }] });
    expect(await (await detail(request(), context(imported.mealId))).json()).toMatchObject({ meal: { uploadId: captureId } });
    expect(await (await GET(request("?cursor=2026-11-01"))).json()).toMatchObject({ days: [{ meals: [{ id: typed.mealId, uploadId: null }] }] });
    expect(await (await detail(request(), context(typed.mealId))).json()).toMatchObject({ meal: { uploadId: null } });
    expect(client.replica.meals!.days[0]!.meals[0]!.uploadId).toBeNull();
  } finally { await rm(vaultRoot, { recursive: true, force: true }); }
});

function publicDays(input: typeof days) { return input.map(day => ({ ...day, meals: day.meals.map(item => ({ ...item, photo: null })) })); }

it.each(["thumbnail.jpg", "thumbnail-v2-synthetic-operation.jpg"])("signs selected owner meals without storage metadata: %s", async filename => {
  const thumbnail = { relativePath: `raw/meals/2026/11/meal_fixture/${filename}`, sha256: "b".repeat(64), byteSize: 100, width: 640, height: 480 };
  const saved = structuredClone(projection);
  Object.assign(saved.days[0]!.meals[0]!, { thumbnail });
  Object.assign(saved.days[1]!.meals[0]!, { thumbnail: { ...thumbnail, sha256: "c".repeat(64) } });
  mocks.decode.mockResolvedValue({ client: { replica: { generation: 17, generatedAt: savedAt, meals: saved, entities: [] } } });
  mocks.thumbnails.mockImplementation(async ({ photos }) => photos.map((photo: { mediaId: string }) => ({ mediaId: photo.mediaId, url: "https://media.example.test/private-thumbnail?exp=123" })));
  const response = await GET(request("?limit=1"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.days[0].meals[0].photo).toEqual({ url: "https://media.example.test/private-thumbnail?exp=123", width: 640, height: 480 });
  expect(body.days[0].meals[0].thumbnail).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain("raw/meals");
  expect(mocks.thumbnails).toHaveBeenCalledWith({ userId: "member_native", photos: [expect.objectContaining({ sha256: "b".repeat(64), byteSize: 100 })] });
  expect(mocks.current).toHaveBeenCalledTimes(2);
  mocks.thumbnails.mockImplementationOnce(async () => {
    mocks.current.mockRejectedValueOnce(hostedOnboardingError({ code: "NATIVE_AUTH_INVALID", httpStatus: 401, message: "Session unavailable." }));
    return [];
  });
  expect((await detail(request(), context())).status).toBe(401);
});


it("preserves the meal-removal unavailable response on an action identity collision", async () => {
  mocks.submit.mockResolvedValueOnce({ accepted: true, actionId: "synthetic-action", dedupeConflict: true });
  const response = await DELETE(request(), context());
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ error: { code: "MEAL_REMOVAL_UNAVAILABLE", retryable: true } });
});
