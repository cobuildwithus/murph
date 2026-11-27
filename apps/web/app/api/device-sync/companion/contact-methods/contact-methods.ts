import { formatMaskedPhoneNumber } from "@/src/components/settings/hosted-settings-utils";
import type { HostedAccountSettingsPageSnapshot } from "@/src/lib/hosted-onboarding/account-settings-snapshot";
import { normalizePhoneNumber } from "@/src/lib/hosted-onboarding/phone";
import {
  buildMurphEmailHref,
  buildMurphSmsHref,
  MURPH_TELEGRAM_BOT_USERNAME,
  MURPH_TELEGRAM_URL,
} from "@/src/lib/murph-contact-routing";

export function projectCompanionContactMethods({ account, routing }: HostedAccountSettingsPageSnapshot) {
  const phone = account.phone.verifiedAt ? account.phone.number : null;
  const murphNumber = normalizePhoneNumber(routing?.linqRecipientPhone ?? routing?.pendingLinqRecipientPhone);
  const email = account.email.verifiedAt ? account.email.address : null;
  const replyAddress = account.email.murphEmailAddress?.trim();
  const telegram = account.telegram;

  return {
    schemaVersion: 1,
    methods: [
      {
        id: "text",
        you: phone ? formatMaskedPhoneNumber(phone) : null,
        murph: phone && murphNumber ? {
          label: murphNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/u, "+1 ($1) $2-$3"),
          href: buildMurphSmsHref({ murphPhoneNumber: murphNumber }),
        } : null,
      },
      {
        id: "telegram",
        you: telegram.telegramUserId ? (telegram.username ? `@${telegram.username}` : "Connected") : null,
        murph: telegram.telegramUserId ? {
          label: `@${MURPH_TELEGRAM_BOT_USERNAME}`,
          href: MURPH_TELEGRAM_URL,
        } : null,
      },
      {
        id: "email",
        you: email,
        murph: email && replyAddress ? {
          label: replyAddress,
          href: buildMurphEmailHref({ address: replyAddress }),
        } : null,
      },
    ],
  };
}
