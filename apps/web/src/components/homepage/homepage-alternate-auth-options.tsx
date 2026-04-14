"use client";

import { useState } from "react";

import { HomepageEmailAuthButton } from "./homepage-email-auth-button";
import { HomepageTelegramAuthButton } from "./homepage-telegram-auth-button";

const TERMS_HREF = "/legal/terms.pdf";
const PRIVACY_HREF = "/legal/privacy.pdf";

type HomepageAlternateAuthMethod = "telegram" | "email" | null;

export function HomepageAlternateAuthOptions() {
  const [activeMethod, setActiveMethod] =
    useState<HomepageAlternateAuthMethod>(null);

  return (
    <>
      <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-400">
        <span className="h-px flex-1 bg-stone-200" />
        OR
        <span className="h-px flex-1 bg-stone-200" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <HomepageTelegramAuthButton
          isActive={activeMethod === "telegram"}
          onActivate={() => setActiveMethod("telegram")}
        />
        <HomepageEmailAuthButton
          isActive={activeMethod === "email"}
          onActivate={() => setActiveMethod("email")}
        />
      </div>
      <p className="text-xs leading-relaxed text-stone-500">
        By signing up, you agree to our{" "}
        <a href={TERMS_HREF} target="_blank" rel="noreferrer">
          Terms
        </a>{" "}
        and{" "}
        <a href={PRIVACY_HREF} target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        .
      </p>
    </>
  );
}
