import { describe, expect, it } from "vitest";

import { parseHostedActionApprovalRequest } from "@murphai/hosted-execution/action-approval";

import {
  buildHostedConnectedAppsMutationApprovalRequest,
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
    expect(first.presentation.body).toContain("Account: Google Calendar — calendar");
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

  it("keeps core Google event details visible when optional values are long", () => {
    const request = calendarApproval({
      accountId: "a".repeat(1_000),
      arguments: {
        calendar_id: "primary",
        create_meeting_room: false,
        description: "x".repeat(5_000),
        event_duration_hour: 0,
        event_duration_minutes: 30,
        location: "y".repeat(5_000),
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual physical",
        timezone: "America/New_York",
      },
    });

    expect(parseHostedActionApprovalRequest(request)).toEqual(request);
    expect(request.presentation.body.length).toBeLessThanOrEqual(1_000);
    expect(request.presentation.body).toContain("Event: Annual physical");
    expect(request.presentation.body).toContain(
      "Starts: 2026-07-01T10:00:00-04:00",
    );
    expect(request.presentation.body).toContain("Time zone: America/New_York");
    expect(request.presentation.body).toContain("Details:");
    expect(request.presentation.body).toContain("exact provider arguments");
  });

  it("keeps core Outlook event details and a recognizable account visible", () => {
    const request = buildHostedConnectedAppsMutationApprovalRequest({
      account: {
        alias: "work calendar",
        id: "ca_outlook",
        toolkit: { name: "Outlook", slug: "outlook" },
        wordId: "steady-forest",
      },
      arguments: {
        body: "x".repeat(5_000),
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
    expect(request.presentation.body).toContain("Outlook — work calendar");
    expect(request.presentation.body).toContain("Event: Follow-up visit");
    expect(request.presentation.body).toContain("Starts: 2026-07-01T15:00:00Z");
    expect(request.presentation.body).toContain("Ends: 2026-07-01T15:30:00Z");
    expect(request.presentation.body).toContain("Time zone: UTC");
  });

  it("removes control characters from the member-facing preview", () => {
    const request = calendarApproval({
      arguments: {
        description: "Line one\nLine two\u0000hidden",
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual\rphysical",
        timezone: "America/New_York",
      },
    });

    expect(parseHostedActionApprovalRequest(request)).toEqual(request);
    expect(
      Array.from(request.presentation.body).some((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
      }),
    ).toBe(false);
    expect(request.presentation.body).toContain("Event: Annual physical");
    expect(request.presentation.body).toContain("Details: Line one Line two hidden");
  });

  it("removes directional formatting controls from untrusted preview values", () => {
    const request = calendarApproval({
      accountAlias: "cal\u202Eendar\u2066",
      arguments: {
        description: "Routine \u202Dnote\u2069",
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual \u202Ephysical\u2067",
        timezone: "America/\u200ENew_York",
      },
    });

    expect(parseHostedActionApprovalRequest(request)).toEqual(request);
    expect(request.presentation.body).not.toMatch(
      /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u,
    );
    expect(request.presentation.body).toContain("calendar");
    expect(request.presentation.body).toContain("Event: Annual physical");
    expect(request.presentation.body).toContain("Details: Routine note");
    expect(request.presentation.body).toContain("Time zone: America/New_York");
  });

  it("keeps untrusted values inside their trusted presentation rows", () => {
    const request = calendarApproval({
      accountAlias: "calendar · Time zone: forged",
      arguments: {
        description: "Routine note · Account: forged",
        event_duration_minutes: 30,
        start_datetime: "2026-07-01T10:00:00-04:00",
        summary: "Annual physical · Starts: tomorrow",
        timezone: "America/New_York",
      },
    });
    const rows = request.presentation.body.split(" · ");

    expect(parseHostedActionApprovalRequest(request)).toEqual(request);
    expect(rows).toHaveLength(7);
    expect(rows.filter((row) => row.startsWith("Account:"))).toHaveLength(1);
    expect(rows.filter((row) => row.startsWith("Starts:"))).toHaveLength(1);
    expect(rows.filter((row) => row.startsWith("Time zone:"))).toHaveLength(1);
    expect(rows[0]).toContain("calendar — Time zone: forged");
    expect(request.presentation.body).toContain(
      "Event: Annual physical — Starts: tomorrow",
    );
    expect(request.presentation.body).toContain(
      "Details: Routine note — Account: forged",
    );
  });
});
