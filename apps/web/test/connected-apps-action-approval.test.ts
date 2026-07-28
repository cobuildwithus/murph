import { describe, expect, it } from "vitest";

import { parseHostedActionApprovalRequest } from "@murphai/hosted-execution/action-approval";

import {
  buildHostedConnectedAppsMutationApprovalRequest,
  prepareHostedConnectedAppsMutation,
} from "@/src/lib/connected-apps/action-approval";
import {
  resolveHostedActionApprovalContinuation,
} from "@/src/lib/action-approvals";

const GOOGLE_ACCOUNT = {
  alias: "calendar",
  id: "ca_calendar",
  toolkit: { name: "Google Calendar", slug: "googlecalendar" },
  wordId: "quiet-calendar",
};

function calendarApproval(overrides: {
  accountAlias?: string;
  accountId?: string;
  accountToolkit?: string;
  accountWordId?: string;
  arguments?: Record<string, unknown>;
  memberId?: string;
  providerVersion?: string;
  toolSlug?: string;
} = {}) {
  return buildHostedConnectedAppsMutationApprovalRequest({
    account: {
      ...GOOGLE_ACCOUNT,
      alias: overrides.accountAlias ?? GOOGLE_ACCOUNT.alias,
      id: overrides.accountId ?? GOOGLE_ACCOUNT.id,
      toolkit: {
        ...GOOGLE_ACCOUNT.toolkit,
        slug: overrides.accountToolkit ?? GOOGLE_ACCOUNT.toolkit.slug,
      },
      wordId: overrides.accountWordId ?? GOOGLE_ACCOUNT.wordId,
    },
    arguments: overrides.arguments ?? {
      calendar_id: "primary",
      create_meeting_room: false,
      event_duration_hour: 0,
      event_duration_minutes: 30,
      start_datetime: "2026-07-01T10:00:00-04:00",
      summary: "Annual physical",
      timezone: "America/New_York",
    },
    memberId: overrides.memberId ?? "hbm_member",
    operation: "calendar-create",
    providerVersion: overrides.providerVersion ?? "20260429_00",
    toolSlug: overrides.toolSlug ?? "GOOGLECALENDAR_CREATE_EVENT",
  });
}

function renameApproval(overrides: {
  accountAlias?: string;
  accountId?: string;
  accountToolkit?: string;
  accountWordId?: string;
  alias?: string;
  memberId?: string;
} = {}) {
  return buildHostedConnectedAppsMutationApprovalRequest({
    account: {
      ...GOOGLE_ACCOUNT,
      alias: overrides.accountAlias ?? GOOGLE_ACCOUNT.alias,
      id: overrides.accountId ?? GOOGLE_ACCOUNT.id,
      toolkit: {
        ...GOOGLE_ACCOUNT.toolkit,
        slug: overrides.accountToolkit ?? GOOGLE_ACCOUNT.toolkit.slug,
      },
      wordId: overrides.accountWordId ?? GOOGLE_ACCOUNT.wordId,
    },
    alias: overrides.alias ?? "clinic",
    memberId: overrides.memberId ?? "hbm_member",
    operation: "rename",
  });
}

describe("connected-app action approval identity", () => {
  it("canonicalizes the complete provider request into one exact action", () => {
    const first = calendarApproval({
      arguments: {
        timezone: "America/New_York",
        summary: "Annual physical",
        start_datetime: "2026-07-01T10:00:00-04:00",
        event_duration_minutes: 30,
        event_duration_hour: 0,
        create_meeting_room: false,
        calendar_id: "primary",
      },
    });
    const reordered = calendarApproval();

    expect(first).toEqual(reordered);
    expect(parseHostedActionApprovalRequest(first)).toEqual(first);
    expect(first.actionKind).toBe("connected-app.calendar-create.v1");
    expect(resolveHostedActionApprovalContinuation(first.actionId))
      .toBe("return-to-conversation");
    expect(resolveHostedActionApprovalContinuation("vault-file-send:example"))
      .toBe("automatic");
    expect(first.presentation.body).toContain(
      "Account: Google Calendar — alias \"calendar\" — word ID \"quiet-calendar\"",
    );
    expect(first.presentation.body).toContain("Event: Annual physical");
    expect(first.presentation.body).toContain(
      "Starts: 2026-07-01T10:00:00-04:00",
    );
    expect(first.presentation.body).toContain("Duration: 30 minutes");
    expect(first.presentation.body).toContain("Time zone: America/New_York");
  });

  it("binds every calendar authority field into identity and fingerprint", () => {
    const exact = calendarApproval();
    const changedRequests = [
      ["account alias", calendarApproval({ accountAlias: "personal" })],
      ["account id", calendarApproval({ accountId: "ca_other" })],
      ["account toolkit", calendarApproval({ accountToolkit: "outlook" })],
      ["account word id", calendarApproval({ accountWordId: "other-calendar" })],
      ["member", calendarApproval({ memberId: "hbm_other" })],
      ["provider version", calendarApproval({ providerVersion: "20260430_00" })],
      ["tool slug", calendarApproval({ toolSlug: "OTHER_CALENDAR_CREATE_EVENT" })],
      [
        "arguments",
        calendarApproval({
          arguments: {
            calendar_id: "primary",
            create_meeting_room: false,
            event_duration_hour: 0,
            event_duration_minutes: 30,
            start_datetime: "2026-07-01T10:00:00-04:00",
            summary: "Follow-up visit",
            timezone: "America/New_York",
          },
        }),
      ],
    ] as const;

    for (const [field, changed] of changedRequests) {
      expect(changed.actionId, field).not.toBe(exact.actionId);
      expect(changed.actionFingerprint, field).not.toBe(
        exact.actionFingerprint,
      );
    }
  });

  it("binds rename target and operation into identity and fingerprint", () => {
    const rename = renameApproval();
    const changedAlias = renameApproval({ alias: "home" });
    const disconnect = buildHostedConnectedAppsMutationApprovalRequest({
      account: GOOGLE_ACCOUNT,
      memberId: "hbm_member",
      operation: "disconnect",
    });

    expect(changedAlias.actionId).not.toBe(rename.actionId);
    expect(changedAlias.actionFingerprint).not.toBe(rename.actionFingerprint);
    expect(disconnect.actionId).not.toBe(rename.actionId);
    expect(disconnect.actionFingerprint).not.toBe(rename.actionFingerprint);
  });

  it("rejects overlong provider-bound values instead of approving a truncation", () => {
    expect(() => calendarApproval({
      accountId: "a".repeat(257),
    })).toThrow("Connected-app account id must contain 1 to 256 characters");
    expect(() => calendarApproval({
      arguments: {
        description: "x".repeat(121),
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual physical",
        timezone: "America/New_York",
      },
    })).toThrow("Connected-app provider value must contain 1 to 120 characters");
  });

  it("keeps exact bounded Outlook event details and account identity visible", () => {
    const request = buildHostedConnectedAppsMutationApprovalRequest({
      account: {
        alias: "work calendar",
        id: "ca_outlook",
        toolkit: { name: "Outlook", slug: "outlook" },
        wordId: "steady-forest",
      },
      arguments: {
        body: "Bring the prior test results.",
        end_datetime: "2026-07-01T15:30:00Z",
        is_online_meeting: false,
        location: "Clinic",
        start_datetime: "2026-07-01T15:00:00Z",
        subject: "Follow-up visit",
        time_zone: "UTC",
      },
      memberId: "hbm_member",
      operation: "calendar-create",
      providerVersion: "20260508_00",
      toolSlug: "OUTLOOK_CALENDAR_CREATE_EVENT",
    });

    expect(parseHostedActionApprovalRequest(request)).toEqual(request);
    expect(request.presentation.body.length).toBeLessThanOrEqual(1_000);
    expect(request.presentation.body).toContain(
      "Outlook — alias \"work calendar\" — word ID \"steady-forest\"",
    );
    expect(request.presentation.body).toContain("Event: Follow-up visit");
    expect(request.presentation.body).toContain("Starts: 2026-07-01T15:00:00Z");
    expect(request.presentation.body).toContain("Ends: 2026-07-01T15:30:00Z");
    expect(request.presentation.body).toContain("Time zone: UTC");
  });

  it("rejects control characters before approval or execution", () => {
    expect(() => calendarApproval({
      arguments: {
        description: "Line one\nLine two\u0000hidden",
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual\rphysical",
        timezone: "America/New_York",
      },
    })).toThrow("unsupported whitespace or control characters");
  });

  it("rejects directional formatting controls before approval or execution", () => {
    expect(() => calendarApproval({
      accountAlias: "cal\u202Eendar\u2066",
      arguments: {
        description: "Routine \u202Dnote\u2069",
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual \u202Ephysical\u2067",
        timezone: "America/\u200ENew_York",
      },
    })).toThrow("unsupported whitespace or control characters");
  });

  it("rejects fact-row separators and unpaired surrogates", () => {
    expect(() => calendarApproval({
      accountAlias: "calendar · Time zone: forged",
      arguments: {
        description: "Routine note · Account: forged",
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual physical · Starts: tomorrow",
        timezone: "America/New_York",
      },
    })).toThrow("unsupported whitespace or control characters");
    expect(() => calendarApproval({
      arguments: {
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual \uD800physical",
        timezone: "America/New_York",
      },
    })).toThrow("unsupported whitespace or control characters");
  });

  it("uses a stable account fingerprint only when word id cannot disambiguate", () => {
    const withoutWordId = buildHostedConnectedAppsMutationApprovalRequest({
      account: {
        alias: "calendar",
        id: "ca_calendar",
        toolkit: { name: "Google Calendar", slug: "googlecalendar" },
        wordId: null,
      },
      includeAccountIdFingerprint: true,
      memberId: "hbm_member",
      operation: "disconnect",
    });
    const withWordId = buildHostedConnectedAppsMutationApprovalRequest({
      account: GOOGLE_ACCOUNT,
      memberId: "hbm_member",
      operation: "disconnect",
    });

    expect(withoutWordId.presentation.body).toMatch(
      /account ID fingerprint [0-9a-f]{16}/u,
    );
    expect(withWordId.presentation.body).not.toContain(
      "account ID fingerprint",
    );
  });

  it("returns the same prepared values for approval identity and provider execution", () => {
    const prepared = prepareHostedConnectedAppsMutation({
      account: GOOGLE_ACCOUNT,
      arguments: {
        timezone: "America/New_York",
        summary: "Annual physical",
        start_datetime: "2026-07-01T10:00:00-04:00",
        event_duration_minutes: 30,
        event_duration_hour: -0,
        create_meeting_room: false,
        calendar_id: "primary",
      },
      memberId: "hbm_member",
      operation: "calendar-create",
      providerVersion: "20260429_00",
      toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
    });

    expect(prepared.execution).toEqual({
      accountId: "ca_calendar",
      arguments: {
        calendar_id: "primary",
        create_meeting_room: false,
        event_duration_hour: 0,
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual physical",
        timezone: "America/New_York",
      },
      operation: "calendar-create",
      providerVersion: "20260429_00",
      toolSlug: "GOOGLECALENDAR_CREATE_EVENT",
    });
    expect(prepared.approvalRequest.presentation.body).toContain(
      "Event: Annual physical",
    );
  });
});
