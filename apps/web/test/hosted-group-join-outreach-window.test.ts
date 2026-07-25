import { describe, expect, it } from "vitest";

import { HOSTED_PHONE_COUNTRY_OPTIONS } from "@/src/components/hosted-onboarding/hosted-phone-country-options";
import {
  decideHostedGroupJoinOutreachSendWindow,
  resolveHostedGroupJoinOutreachSendWindowCoverage,
} from "@/src/lib/hosted-groups/group-join-outreach-window";

// Plausible civil-zone offsets each supported calling code can represent. A
// window is only safe if it stays outside quiet hours for every one of them.
const CALLING_CODE_UTC_OFFSETS: Record<string, readonly number[]> = {
  "+1": [-4, -5, -6, -7, -8, -9, -10],
  "+1670": [10],
  "+1671": [10],
  "+1684": [-11],
  "+234": [1],
  "+27": [2],
  "+33": [1, 2],
  "+34": [1, 2],
  "+39": [1, 2],
  "+44": [0, 1],
  "+49": [1, 2],
  "+52": [-6, -7, -8],
  "+54": [-3],
  "+55": [-3, -4, -5],
  "+61": [8, 9.5, 10, 11],
  "+64": [12, 13],
  "+81": [9],
  "+82": [9],
  "+86": [8],
  "+91": [5.5],
};

describe("hosted group join outreach recipient window", () => {
  it("never permits a send inside recipient quiet hours for any supported code", () => {
    const violations: string[] = [];

    for (const row of resolveHostedGroupJoinOutreachSendWindowCoverage()) {
      const spanHours = ((row.endHourUtc - row.startHourUtc) % 24) || 24;
      for (const callingCode of row.callingCodes) {
        const offsets = CALLING_CODE_UTC_OFFSETS[callingCode];
        expect(offsets, `${callingCode} needs declared offsets`).toBeDefined();
        for (const offset of offsets ?? []) {
          const firstLocal = (row.startHourUtc + offset + 24) % 24;
          const lastLocal =
            (row.startHourUtc + spanHours - 1 / 60 + offset + 24) % 24;
          if (
            firstLocal < 5 || firstLocal >= 23
            || lastLocal < 5 || lastLocal >= 23
          ) {
            violations.push(
              `${callingCode} at UTC${offset}: ${firstLocal.toFixed(2)}-${lastLocal.toFixed(2)}`,
            );
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("matches the longest calling code, not the first row that happens to fit", () => {
    // A NANP Pacific territory must not inherit the Americas window, whatever
    // order the table rows are written in.
    const guamAtAmericasMidnight = decideHostedGroupJoinOutreachSendWindow({
      now: new Date("2026-07-24T16:00:00.000Z"),
      participantPhoneNumber: "+16715550123",
    });

    expect(guamAtAmericasMidnight).toEqual({
      kind: "defer",
      nextAttemptAt: new Date("2026-07-24T19:00:00.000Z"),
      reason: "recipient_quiet_hours",
    });
    expect(decideHostedGroupJoinOutreachSendWindow({
      now: new Date("2026-07-24T16:00:00.000Z"),
      participantPhoneNumber: "+15555550123",
    })).toEqual({ kind: "send_now" });
  });

  it("uses a conservative safe window for a supported non-NANP calling code", () => {
    expect(decideHostedGroupJoinOutreachSendWindow({
      now: new Date("2026-07-24T12:00:00.000Z"),
      participantPhoneNumber: "+445550123456",
    })).toEqual({ kind: "send_now" });
  });

  it("terminalizes an unsupported region instead of retrying identical inputs", () => {
    // A deferral here would re-evaluate the same phone number and clock forever:
    // the participant would never be texted and the row would never resolve.
    expect(decideHostedGroupJoinOutreachSendWindow({
      now: new Date("2026-07-24T16:00:00.000Z"),
      participantPhoneNumber: "+9795550123",
    })).toEqual({ kind: "unsupported_region" });
  });
});
