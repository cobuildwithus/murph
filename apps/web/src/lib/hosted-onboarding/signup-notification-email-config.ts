import { parseCommaSeparatedList } from "../primitives";
import {
  readHostedResendPlainTextEmailConfig,
  type HostedResendPlainTextEmailConfig,
} from "./resend-plain-text-email-config";

export type HostedSignupNotificationEmailEnv =
  Readonly<Record<string, string | undefined>>;

export type HostedSignupNotificationEmailConfig = {
  recipients: string[];
  resend: HostedResendPlainTextEmailConfig;
};

export function isHostedSignupNotificationEmailConfigured(
  source: HostedSignupNotificationEmailEnv = process.env,
): boolean {
  return readHostedSignupNotificationEmailConfig(source) !== null;
}

export function readHostedSignupNotificationEmailConfig(
  source: HostedSignupNotificationEmailEnv,
): HostedSignupNotificationEmailConfig | null {
  const resend = readHostedResendPlainTextEmailConfig(source);
  const recipients = readHostedSignupNotificationEmailRecipients(
    source.HOSTED_SIGNUP_NOTIFICATION_EMAILS,
  );

  if (!resend || recipients.length === 0) {
    return null;
  }

  return {
    recipients,
    resend,
  };
}

function readHostedSignupNotificationEmailRecipients(value: string | undefined): string[] {
  const recipients: string[] = [];
  const seen = new Set<string>();

  for (const email of parseCommaSeparatedList(value)) {
    const seenKey = email.toLowerCase();

    if (seen.has(seenKey)) {
      continue;
    }

    seen.add(seenKey);
    recipients.push(email);
  }

  return recipients;
}
