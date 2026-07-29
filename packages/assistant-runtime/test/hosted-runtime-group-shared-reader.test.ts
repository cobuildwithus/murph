import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedGroupParticipantDisplayNameReader,
  createHostedGroupSharedReader,
  resolveHostedGroupParticipantDisplayNameCachePath,
} from "../src/hosted-runtime/group-shared-reader.ts";
import type { HostedRuntimeGroupToolPort } from "../src/hosted-runtime/platform.ts";

const SLEEP_SCOPE = { projectionKind: "sleep-times.v0" } as const;
const STEPS_SCOPE = { projectionKind: "steps-days.v0" } as const;

const testVaultRoots = new Set<string>();

async function createTestVaultRoot(): Promise<string> {
  const vaultRoot = await mkdtemp(
    path.join(tmpdir(), "murph-group-display-name-cache-"),
  );
  testVaultRoots.add(vaultRoot);
  return vaultRoot;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    [...testVaultRoots].map((vaultRoot) => rm(vaultRoot, {
      force: true,
      recursive: true,
    })),
  );
  testVaultRoots.clear();
});

describe("createHostedGroupSharedReader", () => {
  it("does no work until requested and lazily passes each exact scope read through to Web", async () => {
    const response = {
      action: "read_shared",
      result: {
        members: [{
          currentTurnHandles: [],
          displayName: "Ada",
          memberId: "member_a",
          participantId: "participant_a",
          projections: [{
            dataStatus: "available",
            grantStatus: "granted",
            projectionScope: STEPS_SCOPE,
            projectionScopeKey: "steps-days.v0",
            records: [{
              data: {
                date: "2026-07-17",
                metricKey: "steps",
                unit: "count",
                value: 12_345,
              },
              occurredAt: "2026-07-17T00:00:00.000Z",
              recordKey: "2026-07-17",
            }],
          }],
        }],
        requestedProjectionScopeKeys: ["steps-days.v0"],
        status: "ok",
      },
    } satisfies HostedRuntimeGroupToolResponse;
    const request = vi.fn(async () => response);
    const reader = createHostedGroupSharedReader({
      groupToolPort: { request } as HostedRuntimeGroupToolPort,
    });

    expect(request).not.toHaveBeenCalled();
    await expect(reader.request({ projectionScopes: [STEPS_SCOPE] }))
      .resolves.toEqual(response.result);
    expect(request).toHaveBeenCalledWith({
      action: "read_shared",
      projectionScopes: [STEPS_SCOPE],
    });

    await reader.request({ projectionScopes: [SLEEP_SCOPE] });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({
      action: "read_shared",
      projectionScopes: [SLEEP_SCOPE],
    });
  });

  it("rejects empty and duplicate scope requests without Web I/O", async () => {
    const request = vi.fn();
    const reader = createHostedGroupSharedReader({
      groupToolPort: { request } as HostedRuntimeGroupToolPort,
    });

    await expect(reader.request({ projectionScopes: [] })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "group_shared_request_invalid",
    });
    await expect(reader.request({
      projectionScopes: [STEPS_SCOPE, STEPS_SCOPE],
    })).resolves.toEqual({
      status: "unavailable",
      unavailableReason: "group_shared_request_invalid",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("fails closed when the Web tool is absent, throws, or returns another action", async () => {
    const absent = createHostedGroupSharedReader({ groupToolPort: null });
    await expect(absent.request({ projectionScopes: [STEPS_SCOPE] }))
      .resolves.toEqual({
        status: "unavailable",
        unavailableReason: "group_tool_unavailable",
      });

    const failed = createHostedGroupSharedReader({
      groupToolPort: {
        async request(): Promise<HostedRuntimeGroupToolResponse> {
          throw new Error("control plane unavailable");
        },
      },
    });
    await expect(failed.request({ projectionScopes: [STEPS_SCOPE] }))
      .resolves.toEqual({
        status: "unavailable",
        unavailableReason: "group_shared_read_failed",
      });

    const mismatched = createHostedGroupSharedReader({
      groupToolPort: {
        async request(): Promise<HostedRuntimeGroupToolResponse> {
          return {
            action: "read_current",
            result: { group: null, status: "none" },
          };
        },
      },
    });
    await expect(mismatched.request({ projectionScopes: [STEPS_SCOPE] }))
      .resolves.toEqual({
        status: "unavailable",
        unavailableReason: "group_shared_result_invalid",
      });
  });
});

describe("createHostedGroupParticipantDisplayNameReader", () => {
  it("returns exact unique names without persisting a malformed batch", async () => {
    const vaultRoot = await createTestVaultRoot();
    const request = vi.fn(async () => ({
      action: "read_participant_display_names" as const,
      result: {
        participants: [
          {
            displayName: " Alice Example ",
            displayNameSource: "profile-name" as const,
            senderHandle: "+15551110000",
          },
          {
            displayName: "Ambiguous One",
            displayNameSource: "unverified-owner-contact" as const,
            senderHandle: "+15552220000",
          },
          {
            displayName: "Ambiguous Two",
            displayNameSource: "profile-name" as const,
            senderHandle: "+15552220000",
          },
        ],
        status: "ok" as const,
      },
    }));
    const reader = createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request } as HostedRuntimeGroupToolPort,
      routeConversationKey: "linq\0room-exact-current-membership",
      runtimeMemberId: "member-exact-current-membership",
      vaultRoot,
    });

    await expect(reader.read({
      channel: "linq",
      senderHandles: [" +15551110000 ", "+15552220000"],
    })).resolves.toEqual([
      {
        displayName: "Alice Example",
        displayNameSource: "profile-name",
        senderHandle: "+15551110000",
      },
    ]);
    expect(request).toHaveBeenCalledWith({
      action: "read_participant_display_names",
      linqSenderHandles: ["+15551110000", "+15552220000"],
    });
    await expect(access(
      resolveHostedGroupParticipantDisplayNameCachePath(vaultRoot),
    )).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reuses profile and shared-contact positives for 14 days without crossing runtime or room scope", async () => {
    const vaultRoot = await createTestVaultRoot();
    vi.useFakeTimers();
    const startedAtMs = Date.parse("2026-07-29T12:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    let round = 0;
    const request = vi.fn(async (
      input: HostedRuntimeGroupToolRequest,
    ): Promise<HostedRuntimeGroupToolResponse> => {
      if (input.action !== "read_participant_display_names") {
        throw new Error(`unexpected action ${input.action}`);
      }
      round += 1;
      return {
        action: "read_participant_display_names",
        result: {
          participants: input.linqSenderHandles.map((senderHandle, index) => ({
            displayName: `Label ${round}`,
            displayNameSource: index === 0
              ? "profile-name" as const
              : "unverified-owner-contact" as const,
            senderHandle,
          })),
          status: "ok",
        },
      };
    });
    const createReader = (input: {
      routeConversationKey: string;
      runtimeMemberId: string;
    }) => createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      ...input,
      vaultRoot,
    });
    const profileHandle = "+15551112222";
    const sharedContactHandle = "+15553334444";
    const senderHandles = [profileHandle, sharedContactHandle] as const;

    await expect(createReader({
      routeConversationKey: "linq\0room-positive-ttl",
      runtimeMemberId: "member-positive-ttl",
    }).read({ channel: "linq", senderHandles })).resolves.toEqual([
      {
        displayName: "Label 1",
        displayNameSource: "profile-name",
        senderHandle: profileHandle,
      },
      {
        displayName: "Label 1",
        displayNameSource: "unverified-owner-contact",
        senderHandle: sharedContactHandle,
      },
    ]);

    vi.setSystemTime(startedAtMs + 14 * 24 * 60 * 60 * 1_000 - 1);
    vi.resetModules();
    const {
      createHostedGroupParticipantDisplayNameReader: createFreshReader,
    } = await import("../src/hosted-runtime/group-shared-reader.ts");
    const sameScopeReader = createFreshReader({
      groupToolPort: { request },
      routeConversationKey: "linq\0room-positive-ttl",
      runtimeMemberId: "member-positive-ttl",
      vaultRoot,
    });
    await expect(sameScopeReader.read({
      channel: "linq",
      senderHandles: [` ${profileHandle} `, ` ${sharedContactHandle} `],
    })).resolves.toEqual([
      {
        displayName: "Label 1",
        displayNameSource: "profile-name",
        senderHandle: profileHandle,
      },
      {
        displayName: "Label 1",
        displayNameSource: "unverified-owner-contact",
        senderHandle: sharedContactHandle,
      },
    ]);
    expect(request).toHaveBeenCalledTimes(1);

    await createReader({
      routeConversationKey: "linq\0room-positive-ttl-other",
      runtimeMemberId: "member-positive-ttl",
    }).read({ channel: "linq", senderHandles });
    await createReader({
      routeConversationKey: "linq\0room-positive-ttl",
      runtimeMemberId: "member-positive-ttl-other",
    }).read({ channel: "linq", senderHandles });
    expect(request).toHaveBeenCalledTimes(3);

    vi.setSystemTime(startedAtMs + 14 * 24 * 60 * 60 * 1_000);
    await expect(createReader({
      routeConversationKey: "linq\0room-positive-ttl",
      runtimeMemberId: "member-positive-ttl",
    }).read({ channel: "linq", senderHandles })).resolves.toEqual([
      {
        displayName: "Label 4",
        displayNameSource: "profile-name",
        senderHandle: profileHandle,
      },
      {
        displayName: "Label 4",
        displayNameSource: "unverified-owner-contact",
        senderHandle: sharedContactHandle,
      },
    ]);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("batches only true name misses and refreshes a valid unnamed result after six hours", async () => {
    const vaultRoot = await createTestVaultRoot();
    vi.useFakeTimers();
    const startedAtMs = Date.parse("2026-07-29T13:00:00.000Z");
    vi.setSystemTime(startedAtMs);
    const actorA = "+15551110001";
    const actorB = "+15552220002";
    const actorC = "+15553330003";
    let round = 0;
    const request = vi.fn(async (
      input: HostedRuntimeGroupToolRequest,
    ): Promise<HostedRuntimeGroupToolResponse> => {
      if (input.action !== "read_participant_display_names") {
        throw new Error(`unexpected action ${input.action}`);
      }
      round += 1;
      return {
        action: "read_participant_display_names",
        result: {
          nameMissSenderHandles: round === 2 ? [actorC] : [],
          participants: input.linqSenderHandles.flatMap((senderHandle) => {
            if (senderHandle === actorC && round === 2) {
              return [];
            }
            return [{
              displayName: `Name ${senderHandle.slice(-2)}`,
              displayNameSource: senderHandle === actorB
                ? "unverified-owner-contact" as const
                : "profile-name" as const,
              senderHandle,
            }];
          }),
          status: "ok",
        },
      };
    });
    const createReader = () => createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      routeConversationKey: "linq\0room-mixed-cache",
      runtimeMemberId: "member-mixed-cache",
      vaultRoot,
    });

    await createReader().read({ channel: "linq", senderHandles: [actorA] });
    const mixedOperation = createReader();
    await expect(mixedOperation.read({
      channel: "linq",
      senderHandles: [actorA, actorB, actorC],
    })).resolves.toEqual([
      {
        displayName: "Name 01",
        displayNameSource: "profile-name",
        senderHandle: actorA,
      },
      {
        displayName: "Name 02",
        displayNameSource: "unverified-owner-contact",
        senderHandle: actorB,
      },
    ]);
    expect(request).toHaveBeenNthCalledWith(2, {
      action: "read_participant_display_names",
      linqSenderHandles: [actorB, actorC],
    });
    await expect(createReader().read({
      channel: "linq",
      senderHandles: [actorB],
    })).resolves.toEqual([{
      displayName: "Name 02",
      displayNameSource: "unverified-owner-contact",
      senderHandle: actorB,
    }]);
    expect(request).toHaveBeenCalledTimes(2);

    vi.setSystemTime(startedAtMs + 6 * 60 * 60 * 1_000 - 1);
    await expect(createReader().read({
      channel: "linq",
      senderHandles: [actorC],
    })).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);

    vi.setSystemTime(startedAtMs + 6 * 60 * 60 * 1_000);
    await expect(createReader().read({
      channel: "linq",
      senderHandles: [actorC],
    })).resolves.toEqual([{
      displayName: "Name 03",
      displayNameSource: "profile-name",
      senderHandle: actorC,
    }]);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("keeps a successful policy omission operation-local without negative-caching it", async () => {
    const vaultRoot = await createTestVaultRoot();
    const senderHandle = "+15553330004";
    let round = 0;
    const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => {
      round += 1;
      return {
        action: "read_participant_display_names",
        result: {
          ...(round === 1
            ? { participants: [] }
            : {
                participants: [{
                  displayName: "Available Later",
                  displayNameSource: "unverified-owner-contact" as const,
                  senderHandle,
                }],
              }),
          status: "ok",
        },
      };
    });
    const createReader = () => createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      routeConversationKey: "linq\0room-policy-omission",
      runtimeMemberId: "member-policy-omission",
      vaultRoot,
    });
    const firstOperation = createReader();

    await expect(firstOperation.read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([]);
    await expect(firstOperation.read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
    await expect(access(
      resolveHostedGroupParticipantDisplayNameCachePath(vaultRoot),
    )).rejects.toMatchObject({ code: "ENOENT" });

    await expect(createReader().read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([{
      displayName: "Available Later",
      displayNameSource: "unverified-owner-contact",
      senderHandle,
    }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("suppresses an unavailable lookup for one operation without file-caching it", async () => {
    const vaultRoot = await createTestVaultRoot();
    const senderHandle = "+15554440004";
    let round = 0;
    const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => {
      round += 1;
      if (round === 1) {
        return {
          action: "read_participant_display_names",
          result: {
            status: "unavailable",
            unavailableReason: "participant_names_unavailable",
          },
        };
      }
      return {
        action: "read_participant_display_names",
        result: {
          participants: [{
            displayName: "Recovered Name",
            displayNameSource: "profile-name",
            senderHandle,
          }],
          status: "ok",
        },
      };
    });
    const createReader = () => createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      routeConversationKey: "linq\0room-operation-failure",
      runtimeMemberId: "member-operation-failure",
      vaultRoot,
    });
    const firstOperation = createReader();

    await expect(firstOperation.read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([]);
    await expect(firstOperation.read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);
    await expect(access(
      resolveHostedGroupParticipantDisplayNameCachePath(vaultRoot),
    )).rejects.toMatchObject({ code: "ENOENT" });

    await expect(createReader().read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([{
      displayName: "Recovered Name",
      displayNameSource: "profile-name",
      senderHandle,
    }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not promote an ambiguous response into the file negative cache", async () => {
    const vaultRoot = await createTestVaultRoot();
    const senderHandle = "+15555550005";
    let round = 0;
    const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => {
      round += 1;
      return {
        action: "read_participant_display_names",
        result: {
          participants: round === 1
            ? [
                {
                  displayName: "Ambiguous One",
                  displayNameSource: "profile-name",
                  senderHandle,
                },
                {
                  displayName: "Ambiguous Two",
                  displayNameSource: "unverified-owner-contact",
                  senderHandle,
                },
              ]
            : [{
                displayName: "Resolved Later",
                displayNameSource: "profile-name",
                senderHandle,
              }],
          status: "ok",
        },
      };
    });
    const createReader = () => createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      routeConversationKey: "linq\0room-ambiguous-response",
      runtimeMemberId: "member-ambiguous-response",
      vaultRoot,
    });
    const firstOperation = createReader();

    await expect(firstOperation.read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([]);
    await expect(firstOperation.read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);

    await expect(createReader().read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([{
      displayName: "Resolved Later",
      displayNameSource: "profile-name",
      senderHandle,
    }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not promote an unexpected participant response into the file cache", async () => {
    const vaultRoot = await createTestVaultRoot();
    const senderHandle = "+15556660006";
    let round = 0;
    const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => {
      round += 1;
      return {
        action: "read_participant_display_names",
        result: {
          participants: round === 1
            ? [
                {
                  displayName: "Requested Name",
                  displayNameSource: "profile-name",
                  senderHandle,
                },
                {
                  displayName: "Unexpected Name",
                  displayNameSource: "profile-name",
                  senderHandle: "+15556669999",
                },
              ]
            : [{
                displayName: "Resolved Later",
                displayNameSource: "profile-name",
                senderHandle,
              }],
          status: "ok",
        },
      };
    });
    const createReader = () => createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      routeConversationKey: "linq\0room-unexpected-response",
      runtimeMemberId: "member-unexpected-response",
      vaultRoot,
    });
    const firstOperation = createReader();

    await expect(firstOperation.read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([]);
    await expect(firstOperation.read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(1);

    await expect(createReader().read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([{
      displayName: "Resolved Later",
      displayNameSource: "profile-name",
      senderHandle,
    }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("fails soft when presentation lookup is unavailable", async () => {
    const vaultRoot = await createTestVaultRoot();
    const absent = createHostedGroupParticipantDisplayNameReader({
      groupToolPort: null,
      routeConversationKey: "linq\0room-unavailable-absent",
      runtimeMemberId: "member-unavailable-absent",
      vaultRoot,
    });
    await expect(absent.read({
      channel: "linq",
      senderHandles: ["+15551110000"],
    })).resolves.toEqual([]);

    const failed = createHostedGroupParticipantDisplayNameReader({
      groupToolPort: {
        async request(): Promise<HostedRuntimeGroupToolResponse> {
          throw new Error("control plane unavailable");
        },
      },
      routeConversationKey: "linq\0room-unavailable-failed",
      runtimeMemberId: "member-unavailable-failed",
      vaultRoot,
    });
    await expect(failed.read({
      channel: "linq",
      senderHandles: ["+15551110000"],
    })).resolves.toEqual([]);
  });

  it("recovers from a corrupt cache file and reuses the repaired entry", async () => {
    const vaultRoot = await createTestVaultRoot();
    const cacheFilePath = resolveHostedGroupParticipantDisplayNameCachePath(vaultRoot);
    await mkdir(path.dirname(cacheFilePath), {
      mode: 0o700,
      recursive: true,
    });
    await writeFile(cacheFilePath, "{not-json", {
      encoding: "utf8",
      mode: 0o600,
    });

    const senderHandle = "+15557770007";
    const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => ({
      action: "read_participant_display_names",
      result: {
        participants: [{
          displayName: "Recovered From Corruption",
          displayNameSource: "profile-name",
          senderHandle,
        }],
        status: "ok",
      },
    }));
    const createReader = () => createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      routeConversationKey: "linq\0room-corrupt-cache",
      runtimeMemberId: "member-corrupt-cache",
      vaultRoot,
    });

    await expect(createReader().read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([{
      displayName: "Recovered From Corruption",
      displayNameSource: "profile-name",
      senderHandle,
    }]);
    await expect(createReader().read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(1);

    const repaired = JSON.parse(await readFile(cacheFilePath, "utf8")) as {
      schema?: unknown;
      schemaVersion?: unknown;
      value?: { entries?: unknown[] };
    };
    expect(repaired.schema).toBe(
      "murph.hosted-group-participant-display-name-cache.v1",
    );
    expect(repaired.schemaVersion).toBe(1);
    expect(repaired.value?.entries).toHaveLength(1);
  });

  it("uses one private fixed cache file with opaque scoped keys", async () => {
    const vaultRoot = await createTestVaultRoot();
    const senderHandle = "+15558880008";
    const routeConversationKey = "linq\0room-private-cache-route";
    const runtimeMemberId = "member-private-cache-owner";
    const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => ({
      action: "read_participant_display_names",
      result: {
        participants: [{
          displayName: "Private Presentation Label",
          displayNameSource: "unverified-owner-contact",
          senderHandle,
        }],
        status: "ok",
      },
    }));
    const reader = createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      routeConversationKey,
      runtimeMemberId,
      vaultRoot,
    });

    await reader.read({ channel: "linq", senderHandles: [senderHandle] });

    const cacheFilePath = resolveHostedGroupParticipantDisplayNameCachePath(vaultRoot);
    expect(path.relative(vaultRoot, cacheFilePath).split(path.sep).join("/"))
      .toBe(
        ".runtime/cache/assistant-runtime/group-participant-display-names.json",
      );
    const raw = await readFile(cacheFilePath, "utf8");
    expect(raw).not.toContain(senderHandle);
    expect(raw).not.toContain("room-private-cache-route");
    expect(raw).not.toContain(runtimeMemberId);
    const parsed = JSON.parse(raw) as {
      value?: { entries?: Array<{ key?: unknown }> };
    };
    expect(parsed.value?.entries?.[0]?.key).toMatch(/^[a-f0-9]{64}$/u);

    if (process.platform !== "win32") {
      const directoryStats = await stat(path.dirname(cacheFilePath));
      const fileStats = await stat(cacheFilePath);
      expect(directoryStats.mode & 0o777).toBe(0o700);
      expect(fileStats.mode & 0o777).toBe(0o600);
    }
  });

  it("does not persist file cache entries through a symlinked cache ancestor", async () => {
    if (process.platform === "win32") {
      return;
    }

    const vaultRoot = await createTestVaultRoot();
    const externalRoot = await createTestVaultRoot();
    await mkdir(path.join(vaultRoot, ".runtime"), {
      mode: 0o700,
      recursive: true,
    });
    await symlink(externalRoot, path.join(vaultRoot, ".runtime", "cache"), "dir");
    const externalModeBefore = (await stat(externalRoot)).mode & 0o777;
    const senderHandle = "+15559990009";
    const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => ({
      action: "read_participant_display_names",
      result: {
        participants: [{
          displayName: "Symlink Boundary",
          displayNameSource: "profile-name",
          senderHandle,
        }],
        status: "ok",
      },
    }));
    const createReader = () => createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request },
      routeConversationKey: "linq\0room-symlink-cache-boundary",
      runtimeMemberId: "member-symlink-cache-boundary",
      vaultRoot,
    });

    await expect(createReader().read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toEqual([{
      displayName: "Symlink Boundary",
      displayNameSource: "profile-name",
      senderHandle,
    }]);
    await expect(access(path.join(
      externalRoot,
      "assistant-runtime/group-participant-display-names.json",
    ))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await stat(externalRoot)).mode & 0o777).toBe(externalModeBefore);

    await expect(createReader().read({
      channel: "linq",
      senderHandles: [senderHandle],
    })).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry after 2,048 file cache entries without reordering hits", async () => {
    const vaultRoot = await createTestVaultRoot();
    vi.resetModules();
    const {
      createHostedGroupParticipantDisplayNameReader: createFreshReader,
    } = await import("../src/hosted-runtime/group-shared-reader.ts");
    const request = vi.fn(async (
      input: HostedRuntimeGroupToolRequest,
    ): Promise<HostedRuntimeGroupToolResponse> => {
      if (input.action !== "read_participant_display_names") {
        throw new Error(`unexpected action ${input.action}`);
      }
      return {
        action: "read_participant_display_names",
        result: {
          participants: input.linqSenderHandles.map((senderHandle) => ({
            displayName: `Name ${senderHandle}`,
            displayNameSource: "profile-name" as const,
            senderHandle,
          })),
          status: "ok",
        },
      };
    });
    const runtimeMemberId = "member-bounded-cache";
    const createReader = (routeIndex: number) => createFreshReader({
      groupToolPort: { request },
      routeConversationKey: `linq\0room-bounded-cache-${routeIndex}`,
      runtimeMemberId,
      vaultRoot,
    });
    const handlesForRoute = (routeIndex: number) => Array.from(
      { length: 32 },
      (_, handleIndex) => `sender-${routeIndex}-${handleIndex}`,
    );

    for (let routeIndex = 0; routeIndex < 64; routeIndex += 1) {
      await createReader(routeIndex).read({
        channel: "linq",
        senderHandles: handlesForRoute(routeIndex),
      });
    }
    expect(request).toHaveBeenCalledTimes(64);

    const oldestHandle = handlesForRoute(0)[0]!;
    await expect(createReader(0).read({
      channel: "linq",
      senderHandles: [oldestHandle],
    })).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(64);

    await createReader(64).read({
      channel: "linq",
      senderHandles: ["sender-extra"],
    });
    expect(request).toHaveBeenCalledTimes(65);

    await expect(createReader(0).read({
      channel: "linq",
      senderHandles: [oldestHandle],
    })).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(66);
  });
});
