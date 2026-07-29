import type {
  HostedRuntimeGroupToolRequest,
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHostedGroupParticipantDisplayNameReader,
  createHostedGroupSharedReader,
} from "../src/hosted-runtime/group-shared-reader.ts";
import type { HostedRuntimeGroupToolPort } from "../src/hosted-runtime/platform.ts";

const SLEEP_SCOPE = { projectionKind: "sleep-times.v0" } as const;
const STEPS_SCOPE = { projectionKind: "steps-days.v0" } as const;

afterEach(() => {
  vi.useRealTimers();
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
  it("returns only exact unique current Linq membership names", async () => {
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
  });

  it("reuses positive entries for one fixed hour without crossing runtime or room scope", async () => {
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
          participants: input.linqSenderHandles.map((senderHandle) => ({
            displayName: `Label ${round}`,
            displayNameSource: "profile-name" as const,
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
    });
    const senderHandle = "+15551112222";
    const senderHandles = [senderHandle] as const;

    await expect(createReader({
      routeConversationKey: "linq\0room-positive-ttl",
      runtimeMemberId: "member-positive-ttl",
    }).read({ channel: "linq", senderHandles })).resolves.toEqual([{
      displayName: "Label 1",
      displayNameSource: "profile-name",
      senderHandle,
    }]);

    vi.setSystemTime(startedAtMs + 59 * 60 * 1_000);
    const sameScopeReader = createReader({
      routeConversationKey: "linq\0room-positive-ttl",
      runtimeMemberId: "member-positive-ttl",
    });
    await expect(sameScopeReader.read({
      channel: "linq",
      senderHandles: [` ${senderHandle} `],
    })).resolves.toEqual([{
      displayName: "Label 1",
      displayNameSource: "profile-name",
      senderHandle,
    }]);
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

    vi.setSystemTime(startedAtMs + 60 * 60 * 1_000);
    await expect(createReader({
      routeConversationKey: "linq\0room-positive-ttl",
      runtimeMemberId: "member-positive-ttl",
    }).read({ channel: "linq", senderHandles })).resolves.toEqual([{
      displayName: "Label 4",
      displayNameSource: "profile-name",
      senderHandle,
    }]);
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("batches only cache misses and refreshes a valid unnamed result after five minutes", async () => {
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
    });

    const firstOperation = createReader();
    await firstOperation.read({ channel: "linq", senderHandles: [actorA] });
    await expect(firstOperation.read({
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

    vi.setSystemTime(startedAtMs + 4 * 60 * 1_000);
    await expect(createReader().read({
      channel: "linq",
      senderHandles: [actorC],
    })).resolves.toEqual([]);
    expect(request).toHaveBeenCalledTimes(2);

    vi.setSystemTime(startedAtMs + 5 * 60 * 1_000);
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

  it("suppresses a failed lookup for one operation without process-caching the failure", async () => {
    const senderHandle = "+15554440004";
    let round = 0;
    const request = vi.fn(async (): Promise<HostedRuntimeGroupToolResponse> => {
      round += 1;
      if (round === 1) {
        throw new Error("control plane unavailable");
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
      displayName: "Recovered Name",
      displayNameSource: "profile-name",
      senderHandle,
    }]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not promote an ambiguous response into the process negative cache", async () => {
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

  it("does not promote an unexpected participant response into the process cache", async () => {
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
    const absent = createHostedGroupParticipantDisplayNameReader({
      groupToolPort: null,
      routeConversationKey: "linq\0room-unavailable-absent",
      runtimeMemberId: "member-unavailable-absent",
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
    });
    await expect(failed.read({
      channel: "linq",
      senderHandles: ["+15551110000"],
    })).resolves.toEqual([]);
  });

  it("evicts the oldest entry after 2,048 process-local cache entries without reordering hits", async () => {
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
