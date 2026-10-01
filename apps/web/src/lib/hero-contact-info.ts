"use server";

import { resolveMurphTelegramBotUsername } from "@/src/lib/murph-contact-routing";

export type HeroContactInfo = {
  telegram: string;
  phone: string;
  phoneConfigured: boolean;
};

const HERO_PHONE_FALLBACK = "+15555550100";

function resolveHeroPhone(): Pick<HeroContactInfo, "phone" | "phoneConfigured"> {
  const raw = process.env.HOSTED_ONBOARDING_LINQ_CONVERSATION_PHONE_NUMBERS;
  if (!raw) {
    return { phone: HERO_PHONE_FALLBACK, phoneConfigured: false };
  }
  const first = raw.split(",")[0]?.trim();
  return first
    ? { phone: first, phoneConfigured: true }
    : { phone: HERO_PHONE_FALLBACK, phoneConfigured: false };
}

export async function fetchHeroContactInfo(): Promise<HeroContactInfo> {
  return {
    telegram: resolveMurphTelegramBotUsername(),
    ...resolveHeroPhone(),
  };
}
