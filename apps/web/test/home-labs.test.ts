import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authority: vi.fn(), workspace: vi.fn(), control: vi.fn(), configured: vi.fn(),
  keys: vi.fn(), parseRef: vi.fn(), parseSession: vi.fn(), decode: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@murphai/hosted-execution", () => ({
  assessBrowserVaultReplicaFreshness: () => ({ freshness: "stale" }),
}));
vi.mock("@murphai/hosted-execution/parsers", () => ({ parseHostedBrowserVaultReplicaRef: mocks.parseRef }));
vi.mock("@murphai/runtime-state", () => ({ generateHostedUserRecipientKeyPair: mocks.keys }));
vi.mock("../src/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("../src/lib/browser-vault/authority", () => ({ assertBrowserVaultMemberAuthority: mocks.authority }));
vi.mock("../src/lib/hosted-workspace/store", () => ({ readHostedBrowserVaultReplicaState: mocks.workspace }));
vi.mock("../src/lib/hosted-execution/control", () => ({ readHostedExecutionControlClientIfConfigured: mocks.configured }));
vi.mock("../src/lib/browser-vault/loader", () => ({
  decodeReadyBrowserVaultSession: mocks.decode,
  parseBrowserVaultSessionResponse: mocks.parseSession,
}));
import { readHomeLabBiomarkers } from "../src/lib/browser-vault/home-labs";

const replicaRef = { generation: 18 };
const privateKeyJwk = { kty: "EC" };
const publicKeyJwk = { kty: "EC" };

describe("Home's bounded lab-presence projection", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.authority.mockResolvedValue(undefined);
    mocks.workspace.mockResolvedValue({ browserVaultReplicaRef: replicaRef, version: "1" });
    mocks.parseRef.mockImplementation((value) => value);
    mocks.configured.mockReturnValue({ createBrowserVaultSession: mocks.control });
    mocks.keys.mockResolvedValue({ privateKeyJwk, publicKeyJwk });
    mocks.control.mockResolvedValue({ state: "ready" });
    mocks.parseSession.mockImplementation((value) => value);
    mocks.decode.mockResolvedValue({ client: { replica: { hasLabBiomarkers: false } } });
  });
  afterEach(() => vi.useRealTimers());

  it("does no private work for a signed-out visitor", async () => {
    expect(await readHomeLabBiomarkers(null)).toBe(false);
    expect(mocks.authority).not.toHaveBeenCalled();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it.each([true, false])("returns only the authorized core's confirmed lab presence: %s", async (hasLabBiomarkers) => {
    mocks.decode.mockResolvedValue({ client: { replica: { hasLabBiomarkers } } });
    expect(await readHomeLabBiomarkers({ id: "member-synthetic" })).toBe(hasLabBiomarkers);
    expect(mocks.authority).toHaveBeenCalledWith({ memberId: "member-synthetic", prisma: {} });
    expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith({ userId: "member-synthetic" });
    expect(mocks.configured).toHaveBeenCalledExactlyOnceWith(2_000);
    expect(mocks.control).toHaveBeenCalledExactlyOnceWith({
      browserPublicKeyJwk: publicKeyJwk, replicaRef, requestedShards: ["core"], userId: "member-synthetic",
    });
    expect(mocks.decode).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      expectedMemberId: "member-synthetic", privateKeyJwk, requestedShards: ["core"],
    }));
  });

  it("does no replica work without current access and consent", async () => {
    mocks.authority.mockRejectedValue(new Error("Denied"));
    expect(await readHomeLabBiomarkers({ id: "member-synthetic" })).toBeNull();
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(mocks.control).not.toHaveBeenCalled();
  });

  it.each([null, { browserVaultReplicaRef: null, version: "1" }])("preserves empty-session onboarding before the first replica is published", async (workspace) => {
    mocks.workspace.mockResolvedValue(workspace);
    expect(await readHomeLabBiomarkers({ id: "member-synthetic" })).toBe(false);
    expect(mocks.control).not.toHaveBeenCalled();
  });

  it.each(["empty", "not_modified"])("does not guess lab presence from a %s response", async (state) => {
    mocks.control.mockResolvedValue({ state });
    expect(await readHomeLabBiomarkers({ id: "member-synthetic" })).toBeNull();
    expect(mocks.decode).not.toHaveBeenCalled();
  });

  it.each(["workspace", "parseRef", "control", "decode"] as const)("keeps %s failures unknown", async (boundary) => {
    mocks[boundary].mockImplementation(() => { throw new Error("Unreadable projection"); });
    expect(await readHomeLabBiomarkers({ id: "member-synthetic" })).toBeNull();
  });

  it("does not decode a late response after Home's read deadline", async () => {
    vi.useFakeTimers();
    let release!: (value: { state: string }) => void;
    mocks.control.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const result = readHomeLabBiomarkers({ id: "member-synthetic" });
    await vi.waitFor(() => expect(mocks.control).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await result).toBeNull();
    release({ state: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.decode).not.toHaveBeenCalled();
  });
});
