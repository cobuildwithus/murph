import { HOSTED_FAMILY_MAX_SEATS } from "./family-plan";

export function parseHostedFamilyInfoChatIntent(text: string | null | undefined): boolean {
  const normalized = normalizeHostedFamilyInfoText(text);
  if (!normalized) {
    return false;
  }

  return /\bmurph family\b/u.test(normalized)
    || /\bfamily plan\b/u.test(normalized)
    || /\bfamily access\b/u.test(normalized)
    || /\bfamily invite\b/u.test(normalized)
    || /\bfamily member\b/u.test(normalized)
    || /\bfamily seat\b/u.test(normalized)
    || /\bfamily subscription\b/u.test(normalized)
    || /\bfamily plan(?:ie|u|em)?\b/u.test(normalized)
    || /\bplan rodzinny\b/u.test(normalized)
    || /\brodzinny plan\b/u.test(normalized)
    || /\bkonto rodzinne\b/u.test(normalized)
    || /\bzapros\w*\b.*\b(mame|mama|tate|tata|brata|siostre|siostra|rodzin)\w*\b/u.test(normalized)
    || /\binvite\b.*\b(mom|mother|dad|father|brother|sister|family)\b/u.test(normalized);
}

export function buildHostedFamilyInfoReplyText(): string {
  return [
    `Murph Family gives one owner access for up to ${HOSTED_FAMILY_MAX_SEATS} people total.`,
    "Each family member gets their own private Murph access. The owner pays for access, but cannot see a member's private Murph conversations, health data, vault data, exports, or deletion controls.",
    "To invite someone from chat, send something like: invite my mom, her phone is +48 600 000 000 and her Telegram is @mom.",
  ].join("\n\n");
}

function normalizeHostedFamilyInfoText(text: string | null | undefined): string | null {
  if (typeof text !== "string") {
    return null;
  }

  const normalized = text
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

  return normalized || null;
}
