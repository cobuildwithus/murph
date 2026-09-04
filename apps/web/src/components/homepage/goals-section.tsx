"use client";

import { ArrowUp } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  GOAL_BROWSE_CARD_CLASS_NAME,
  GOAL_BROWSE_CARD_TITLE_CLASS_NAME,
  GoalBrowseCardIllustration,
} from "@/src/components/goals/goal-browse-card";
import type { HeroMessengerChannel } from "@/src/components/homepage/hero-clocks-in";
import { useAuth } from "@/src/components/hosted-onboarding/auth-dialog-provider";
import {
  searchGoalItems,
  type GoalSearchItem,
} from "@/src/lib/goals/goal-search";
import {
  DEFAULT_HOMEPAGE_GOAL_PERSONA_ID,
  type HomepageGoalPersona,
} from "@/src/lib/goals/homepage-goal-personas";
import type { HeroContactInfo } from "@/src/lib/hero-contact-info";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import {
  buildMurphSmsHref,
  buildMurphTelegramTextHref,
} from "@/src/lib/murph-contact-routing";
import { Input } from "@/src/components/ui/input";
import { cn } from "@/src/lib/utils";

const GOAL_RESULT_LIMIT = 8;
const PLACEHOLDER_INTERVAL_MS = 2800;
const GOAL_QUERY_MAX_LENGTH = 100;
// How long after the last keystroke the send button starts inviting a send.
const SEND_READY_DELAY_MS = 1000;
// Platforms whose sms: links open a real messaging app. Everything else
// (Windows, Linux, ChromeOS desktops) gets the signup dialog instead.
const NATIVE_MESSAGING_PLATFORM_PATTERN = /Macintosh|iPhone|iPad|iPod|Android/u;

const PILL_CLASS_NAME =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-black/[0.12] px-4 text-sm font-medium text-[#3a322a] transition-colors hover:border-black/[0.28] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8]";
const ACTIVE_PILL_CLASS_NAME =
  "border-[#2d3436] bg-[#2d3436] text-[#f5f0e8] hover:border-[#2d3436]";
const GOAL_GRID_CLASS_NAME =
  "mt-8 grid w-full grid-cols-1 gap-2 sm:mt-10 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4";
const ASK_CLASS_NAME =
  "absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-[#f5f0e8] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdf8]";
const ASK_IDLE_CLASS_NAME = "bg-[#2d3436] hover:bg-[#1f1c18]";
const ASK_READY_CLASS_NAME = "bg-[#5a6e32] hover:bg-[#3d5028]";
const COMPOSER_STYLE = `
@keyframes homepage-goal-placeholder-in {
  from { opacity: 0; transform: translateY(70%); }
  to { opacity: 1; transform: translateY(0); }
}
[data-homepage-goal-placeholder] {
  animation: homepage-goal-placeholder-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes homepage-goal-ready-pulse {
  0% { box-shadow: 0 0 0 0 rgba(90, 110, 50, 0.45); }
  70% { box-shadow: 0 0 0 14px rgba(90, 110, 50, 0); }
  100% { box-shadow: 0 0 0 0 rgba(90, 110, 50, 0); }
}
@keyframes homepage-goal-ready-in {
  from { opacity: 0; transform: scale(0.5) rotate(-90deg); }
  to { opacity: 1; transform: none; }
}
[data-homepage-goal-ready="true"] {
  animation: homepage-goal-ready-pulse 1.8s ease-out infinite;
}
[data-homepage-goal-ready-icon] {
  animation: homepage-goal-ready-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  [data-homepage-goal-placeholder],
  [data-homepage-goal-ready="true"],
  [data-homepage-goal-ready-icon] { animation: none; }
}
`;

interface GoalHandoffTarget {
  guideHref: string;
  illustrationSrc: string | null | undefined;
  phrase: string;
}

/**
 * Where a goal click goes. Members and uncertain sessions open the guide,
 * whose CTA resolves their own Murph line. Anonymous visitors text Murph
 * directly when the platform can, and otherwise open the signup dialog.
 */
type GoalHandoff =
  | { kind: "guide" }
  | { external: boolean; hrefFor: (prompt: string) => string; kind: "message" }
  | { kind: "signup"; open: () => void; prepare: () => void };

function useGoalHandoff(
  contactInfo: HeroContactInfo,
  messengerChannel: HeroMessengerChannel,
): GoalHandoff {
  const auth = useAuth();
  const [nativeMessaging, setNativeMessaging] = useState<boolean | null>(null);

  useEffect(() => {
    setNativeMessaging(
      NATIVE_MESSAGING_PLATFORM_PATTERN.test(window.navigator.userAgent),
    );
  }, []);

  if (auth.authenticated || auth.authenticationStatus === "unavailable") {
    return { kind: "guide" };
  }
  if (messengerChannel === "telegram") {
    return {
      external: true,
      hrefFor: (prompt) =>
        buildMurphTelegramTextHref({ body: prompt, username: contactInfo.telegram }),
      kind: "message",
    };
  }
  // Before mount the platform is unknown; render the text link so the server
  // and first client render agree, then swap on desktops that cannot text.
  if (nativeMessaging !== false) {
    return {
      external: false,
      hrefFor: (prompt) =>
        buildMurphSmsHref({ body: prompt, murphPhoneNumber: contactInfo.phone }),
      kind: "message",
    };
  }
  return { kind: "signup", open: auth.openAuthDialog, prepare: auth.prepareAuth };
}

export function GoalsSection({
  contactInfo,
  goals,
  messengerChannel,
  personas,
  totalGoalCount,
}: {
  contactInfo: HeroContactInfo;
  goals: readonly GoalSearchItem[];
  messengerChannel: HeroMessengerChannel;
  personas: readonly HomepageGoalPersona[];
  totalGoalCount: number;
}) {
  const inputId = useId();
  const askRef = useRef<HTMLElement>(null);
  const handoff = useGoalHandoff(contactInfo, messengerChannel);
  const [query, setQuery] = useState("");
  const [personaId, setPersonaId] = useState<string | null>(() =>
    personas.some((persona) => persona.id === DEFAULT_HOMEPAGE_GOAL_PERSONA_ID)
      ? DEFAULT_HOMEPAGE_GOAL_PERSONA_ID
      : personas[0]?.id ?? null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [sendReady, setSendReady] = useState(false);

  const placeholders = useMemo(
    () => personas.flatMap((persona) => persona.goals.map((goal) => goal.phrase)),
    [personas],
  );
  const activeQuery = query.trim();
  const matches = useMemo(
    () =>
      activeQuery
        ? searchGoalItems(goals, activeQuery).slice(0, GOAL_RESULT_LIMIT)
        : [],
    [activeQuery, goals],
  );
  const activePersona = personas.find((persona) => persona.id === personaId) ?? null;

  useEffect(() => {
    if (activeQuery || placeholders.length < 2) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    const timer = window.setInterval(() => {
      setPlaceholderIndex((index) => (index + 1) % placeholders.length);
    }, PLACEHOLDER_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [activeQuery, placeholders.length]);

  useEffect(() => {
    setSendReady(false);
    if (!activeQuery) {
      return;
    }
    const timer = window.setTimeout(() => setSendReady(true), SEND_READY_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [activeQuery]);

  const prompt = activeQuery
    ? `Hey Murph, help me ${activeQuery}`
    : "Hey Murph, I have a goal in mind.";
  const placeholder = placeholders[placeholderIndex % Math.max(placeholders.length, 1)]
    ?? "sleep through the night";

  const results: GoalHandoffTarget[] = activeQuery
    ? matches.map((goal) => ({
        guideHref: `/goals/${goal.routeId}`,
        illustrationSrc: goal.illustrationSrc,
        phrase: goal.goalPhrase,
      }))
    : activePersona
      ? activePersona.goals.map((goal) => ({
          guideHref: goal.href,
          illustrationSrc: goal.illustrationSrc,
          phrase: goal.phrase,
        }))
      : [];

  return (
    <section
      className="bg-[#f5f0e8] px-4 py-28 sm:px-8 sm:py-36 lg:px-16 lg:py-44"
      data-homepage-goals
    >
      <div className="mx-auto flex max-w-[1200px] flex-col items-center">
        <h2 className="text-center font-serif text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] text-balance text-[#2d3436] sm:text-[clamp(2.25rem,4.5vw,3.5rem)]">
          Hey Murph, help me…
        </h2>

        <form
          className="mt-8 w-full max-w-2xl sm:mt-10"
          onSubmit={(event) => {
            event.preventDefault();
            askRef.current?.click();
          }}
          role="search"
        >
          <style>{COMPOSER_STYLE}</style>
          <label className="sr-only" htmlFor={inputId}>
            Your goal
          </label>
          <div className="relative">
            <Input
              autoCapitalize="none"
              autoComplete="off"
              className="border-border bg-card pl-5 pr-14 text-foreground"
              data-homepage-goal-input
              enterKeyHint="go"
              id={inputId}
              inputSize="xl"
              maxLength={GOAL_QUERY_MAX_LENGTH}
              onChange={(event) => setQuery(event.currentTarget.value)}
              spellCheck={false}
              type="text"
              value={query}
            />
            {activeQuery || query ? null : (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-5 right-14 flex items-center overflow-hidden text-base text-muted-foreground"
              >
                <span
                  className="block truncate"
                  data-homepage-goal-placeholder
                  key={placeholderIndex}
                >
                  {placeholder}
                </span>
              </span>
            )}
            <GoalHandoffAction
              className={cn(
                ASK_CLASS_NAME,
                sendReady ? ASK_READY_CLASS_NAME : ASK_IDLE_CLASS_NAME,
              )}
              data-homepage-goal-ask
              data-homepage-goal-ready={sendReady}
              guideHref={HOSTED_APP_HOME_PATH}
              handoff={handoff}
              label={`Text Murph: ${prompt}`}
              prompt={prompt}
              ref={askRef}
            >
              {sendReady ? (
                <Image
                  alt=""
                  aria-hidden="true"
                  className="h-4 w-auto brightness-0 invert"
                  data-homepage-goal-ready-icon
                  height={24}
                  src="/icons/murph-mark.svg"
                  width={36}
                />
              ) : (
                <ArrowUp aria-hidden="true" className="size-5" />
              )}
            </GoalHandoffAction>
          </div>
        </form>

        <div
          aria-label="Who this is for"
          className="mt-6 flex flex-wrap justify-center gap-2 sm:mt-7"
          role="group"
        >
          {personas.map((persona) => {
            const active = persona.id === personaId;
            return (
              <button
                aria-pressed={active}
                className={cn(PILL_CLASS_NAME, active && ACTIVE_PILL_CLASS_NAME)}
                key={persona.id}
                onClick={() => setPersonaId(persona.id)}
                type="button"
              >
                {persona.label}
              </button>
            );
          })}
          <Link className={PILL_CLASS_NAME} href="/goals">
            All {totalGoalCount} goals
          </Link>
        </div>

        <span aria-live="polite" className="sr-only" role="status">
          {activeQuery
            ? matches.length > 0
              ? `${matches.length} matching ${matches.length === 1 ? "goal" : "goals"}.`
              : "No matching guide yet."
            : activePersona
              ? `${activePersona.goals.length} goals for ${activePersona.label}.`
              : ""}
        </span>

        {results.length > 0 ? (
          <ul
            className={GOAL_GRID_CLASS_NAME}
            data-homepage-goal-persona={activeQuery ? undefined : activePersona?.id}
            data-homepage-goal-results={activeQuery ? "visible" : undefined}
          >
            {results.map((goal) => (
              <li className="min-w-0" key={goal.guideHref}>
                <GoalHandoffAction
                  className={cn(GOAL_BROWSE_CARD_CLASS_NAME, "h-full w-full text-left")}
                  guideHref={goal.guideHref}
                  handoff={handoff}
                  label={`Text Murph: help me ${goal.phrase}`}
                  prompt={`Hey Murph, help me ${goal.phrase}`}
                >
                  <GoalBrowseCardIllustration src={goal.illustrationSrc} />
                  <span className={cn("min-w-0", GOAL_BROWSE_CARD_TITLE_CLASS_NAME)}>
                    {goal.phrase}
                  </span>
                </GoalHandoffAction>
              </li>
            ))}
          </ul>
        ) : activeQuery ? (
          <p
            className="mt-8 max-w-[44ch] text-center text-[0.9375rem] leading-[1.7] text-[#635a48] sm:mt-10"
            data-homepage-goal-empty
          >
            Nothing written up for that yet. Send it to Murph anyway.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function GoalHandoffAction({
  children,
  className,
  guideHref,
  handoff,
  label,
  prompt,
  ref,
  ...dataProps
}: {
  children: ReactNode;
  className: string;
  guideHref: string;
  handoff: GoalHandoff;
  label: string;
  prompt: string;
  ref?: React.Ref<HTMLElement>;
  "data-homepage-goal-ask"?: boolean;
  "data-homepage-goal-ready"?: boolean;
}) {
  if (handoff.kind === "guide") {
    return (
      <Link
        {...dataProps}
        className={className}
        href={guideHref}
        prefetch={false}
        ref={ref as React.Ref<HTMLAnchorElement>}
      >
        {children}
      </Link>
    );
  }
  if (handoff.kind === "message") {
    return (
      <a
        {...dataProps}
        aria-label={label}
        className={className}
        href={handoff.hrefFor(prompt)}
        ref={ref as React.Ref<HTMLAnchorElement>}
        {...(handoff.external ? { rel: "noreferrer", target: "_blank" } : {})}
      >
        {children}
      </a>
    );
  }
  return (
    <button
      {...dataProps}
      aria-label={label}
      className={className}
      onClick={handoff.open}
      onFocus={handoff.prepare}
      onPointerEnter={handoff.prepare}
      ref={ref as React.Ref<HTMLButtonElement>}
      type="button"
    >
      {children}
    </button>
  );
}
