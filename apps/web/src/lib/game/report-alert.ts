import "server-only";

import { GAME_REPORT_REASONS, type GameEntryKind, type GameReportAbout, type GameReportReason } from "./contract";
import { hostedOnboardingError } from "../hosted-onboarding/errors";
import { readHostedOperationalAlertEmailConfig } from "../hosted-onboarding/operational-alert-email-config";
import { sendHostedResendPlainTextEmail } from "../hosted-onboarding/resend-plain-text-email";

/**
 * Tells a person about a game report on the operational alert email, so they
 * review it within a day at /ops/game-reports. Recipients come from
 * `HOSTED_GAME_REPORT_ALERT_EMAILS`, else the ops list. One email per report,
 * keyed by its id, so a retried report sends once. It names the reason, what
 * kind of content, the report and the game: never the reported words or
 * photos, health values, or who reported.
 */

/** A burst from one reporter can't flood the inbox; every report is still stored. */
export const GAME_REPORT_ALERTS_PER_REPORTER_DAY = 10;

const REASONS: Record<GameReportReason, string> = {
  harassment: "Harassment or bullying",
  hate: "Hate",
  money: "Money or a scam",
  other: "Something else",
  self_harm: "Self-harm or a dangerous dare",
  sexual: "Sexual content",
  violence: "Threats or violence",
};

const KINDS: Record<GameEntryKind, string> = {
  excuse: "missed-day excuse",
  heart_rate: "heart rate card",
  photo: "photo",
  reps: "rep tape card",
  route: "route card",
  words: "words",
};

export interface GameReportAlert {
  reportId: string;
  gameId: string | null;
  about: GameReportAbout;
  entryKind: GameEntryKind | null;
  fromInvite: boolean;
  reason: GameReportReason;
  blocked: boolean;
  createdAt: Date;
}

export async function sendGameReportAlert(alert: GameReportAlert, input: {
  env?: Readonly<Record<string, string | undefined>>;
  sendEmail?: typeof sendHostedResendPlainTextEmail;
} = {}): Promise<void> {
  const env = input.env ?? process.env;
  const config = readHostedOperationalAlertEmailConfig(env, env.HOSTED_GAME_REPORT_ALERT_EMAILS?.trim()
    ? "HOSTED_GAME_REPORT_ALERT_EMAILS" : "HOSTED_LINQ_ALERT_EMAILS");
  if (!config) {
    // Local stacks have no alert email; the stored report is the record.
    console.warn("Game report alert email is not configured.", { reportId: alert.reportId });
    return;
  }
  try {
    await (input.sendEmail ?? sendHostedResendPlainTextEmail)({
      config: config.resend,
      idempotencyKey: `murph/game-report/${alert.reportId}`,
      subject: `Murph game report: ${REASONS[alert.reason]}`,
      text: formatGameReportAlert(alert),
      to: config.recipients,
    });
  } catch {
    // The report is stored; the app retries the same id, which sends this once.
    throw hostedOnboardingError({
      code: "GAME_REPORT_ALERT_FAILED",
      httpStatus: 503,
      message: "Couldn't send the report. Try again.",
      retryable: true,
    });
  }
}

export function gameReportContentLabel(alert: Pick<GameReportAlert, "about" | "entryKind" | "fromInvite">): string {
  if (alert.about === "post") return alert.entryKind ? KINDS[alert.entryKind] : "post";
  const what = alert.about === "player" ? "their name and photo" : "the task and prize or dare they wrote";
  return alert.fromInvite ? `${what}, on an invite` : what;
}

export function formatGameReportAlert(alert: GameReportAlert): string {
  return [
    "A weekly game player reported something. Review it within 24 hours:",
    `https://www.withmurph.ai/ops/game-reports#${alert.reportId}`,
    "",
    `Reason: ${REASONS[alert.reason]}`,
    `Content: ${gameReportContentLabel(alert)}`,
    `They blocked the other player too: ${alert.blocked ? "yes" : "no"}`,
    "",
    `Report ID: ${alert.reportId}`,
    `Game ID: ${alert.gameId ?? "(none)"}`,
    `Reported at: ${alert.createdAt.toISOString()}`,
  ].join("\n");
}

export function gameReportReasonLabel(reason: string): string {
  const known = GAME_REPORT_REASONS.find((candidate) => candidate === reason);
  return known ? REASONS[known] : reason;
}
