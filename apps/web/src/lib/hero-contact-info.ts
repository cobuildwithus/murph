"use server";

import { resolveMurphTelegramBotUsername } from "@/src/lib/murph-contact-routing";

export type HeroContactInfo = {
  telegram: string;
  phone: string;
};

const HERO_PHONE_FALLBACK = "+15555550100";

function resolveHeroPhone(): string {
  const raw = process.env.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS;
  if (!raw) return HERO_PHONE_FALLBACK;
  const first = raw.split(",")[0]?.trim();
  return first && first.length > 0 ? first : HERO_PHONE_FALLBACK;
}

export async function fetchHeroContactInfo(): Promise<HeroContactInfo> {
  return {
    telegram: resolveMurphTelegramBotUsername(),
    phone: resolveHeroPhone(),
  };
}
