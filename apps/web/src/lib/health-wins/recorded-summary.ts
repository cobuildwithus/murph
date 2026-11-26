import "server-only";
import type { HealthActivity } from "@prisma/client";
import { openHealthTexts } from "./crypto";
import type { RecordedActivitySummary } from "./engine/types";
import { saveActivityBody } from "./request";

type SealedSummary = Pick<HealthActivity, "id" | "memberId" | "summaryEncrypted">;

export function activitySummaryTarget(memberId: string, rowId: string) {
  return { memberId, rowId, table: "health_activity", field: "summary" } as const;
}

export async function openRecordedActivitySummaries(rows: readonly SealedSummary[], signal?: AbortSignal): Promise<RecordedActivitySummary[]> {
  const opened = await openHealthTexts(rows.map(row => ({
    ...activitySummaryTarget(row.memberId, row.id), value: row.summaryEncrypted,
  })), signal);
  return opened.map((text, index) => {
    let activity: unknown;
    try {
      activity = JSON.parse(text);
    } catch {
      // JSON parser errors can quote health data.
      throw new Error("Invalid sealed activity summary.");
    }
    const parsed = saveActivityBody.safeParse({ activity });
    if (!parsed.success || parsed.data.activity.id !== rows[index].id) throw new Error("Invalid sealed activity summary.");
    return parsed.data.activity;
  });
}
