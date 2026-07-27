import type {
  HostedRuntimeGroupToolResponse,
} from "@murphai/hosted-execution/runtime-control";
import { describe, expect, it, vi } from "vitest";

import {
  createHostedGroupParticipantDisplayNameReader,
  createHostedGroupSharedReader,
} from "../src/hosted-runtime/group-shared-reader.ts";
import type { HostedRuntimeGroupToolPort } from "../src/hosted-runtime/platform.ts";

const SLEEP_SCOPE = { projectionKind: "sleep-times.v0" } as const;
const STEPS_SCOPE = { projectionKind: "steps-days.v0" } as const;

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
            senderHandle: "+15551110000",
          },
          {
            displayName: "Ambiguous One",
            senderHandle: "+15552220000",
          },
          {
            displayName: "Ambiguous Two",
            senderHandle: "+15552220000",
          },
        ],
        status: "ok" as const,
      },
    }));
    const reader = createHostedGroupParticipantDisplayNameReader({
      groupToolPort: { request } as HostedRuntimeGroupToolPort,
    });

    await expect(reader.read({
      channel: "linq",
      senderHandles: [" +15551110000 ", "+15552220000"],
    })).resolves.toEqual([
      {
        displayName: "Alice Example",
        senderHandle: "+15551110000",
      },
    ]);
    expect(request).toHaveBeenCalledWith({
      action: "read_participant_display_names",
      linqSenderHandles: ["+15551110000", "+15552220000"],
    });
  });

  it("fails soft when presentation lookup is unavailable", async () => {
    const absent = createHostedGroupParticipantDisplayNameReader({
      groupToolPort: null,
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
    });
    await expect(failed.read({
      channel: "linq",
      senderHandles: ["+15551110000"],
    })).resolves.toEqual([]);
  });
});
