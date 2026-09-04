"use client";

import { ArrowUp } from "lucide-react";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import {
  GoalHandoffAction,
  useGoalHandoff,
} from "@/src/components/goals/goal-handoff";
import { Input } from "@/src/components/ui/input";
import { HOSTED_APP_HOME_PATH } from "@/src/lib/hosted-onboarding/app-routes";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

export const GOAL_COMPOSER_QUERY_MAX_LENGTH = 100;
const PLACEHOLDER_INTERVAL_MS = 2800;
// How long after the last keystroke the send button starts inviting a send.
const SEND_READY_DELAY_MS = 1000;
// The field takes focus once this much of it is on screen, desktop only, so a
// visitor can start typing the moment they arrive without the page jumping.
const AUTOFOCUS_VISIBLE_RATIO = 0.6;

const SEND_CLASS_NAME =
  "absolute right-2 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full text-[#f5f0e8] transition-colors duration-300 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffdf8]";
const SEND_IDLE_CLASS_NAME = "bg-[#2d3436] hover:bg-[#1f1c18]";
const SEND_READY_CLASS_NAME = "bg-[#5a6e32] hover:bg-[#3d5028]";
const COMPOSER_STYLE = `
@keyframes goal-composer-placeholder-in {
  from { opacity: 0; transform: translateY(70%); }
  to { opacity: 1; transform: translateY(0); }
}
[data-goal-composer-placeholder] {
  animation: goal-composer-placeholder-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes goal-composer-ready-pulse {
  0% { box-shadow: 0 0 0 0 rgba(90, 110, 50, 0.45); }
  70% { box-shadow: 0 0 0 14px rgba(90, 110, 50, 0); }
  100% { box-shadow: 0 0 0 0 rgba(90, 110, 50, 0); }
}
@keyframes goal-composer-ready-in {
  from { opacity: 0; transform: scale(0.5) rotate(-90deg); }
  to { opacity: 1; transform: none; }
}
[data-goal-composer-ready="true"] {
  animation: goal-composer-ready-pulse 1.8s ease-out infinite;
}
[data-goal-composer-ready-icon] {
  animation: goal-composer-ready-in 420ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@media (prefers-reduced-motion: reduce) {
  [data-goal-composer-placeholder],
  [data-goal-composer-ready="true"],
  [data-goal-composer-ready-icon] { animation: none; }
}
`;

function mediaMatches(query: string): boolean {
  return typeof window.matchMedia === "function"
    && window.matchMedia(query).matches;
}

export function goalComposerPrompt(query: string): string | null {
  const activeQuery = query.trim();
  return activeQuery ? `Hey Murph, help me ${activeQuery}` : null;
}

/**
 * The "Hey Murph, help me…" field shared by the homepage and the goal
 * library: one input whose placeholder cycles through goal phrases, and a
 * send control that messages Murph the typed goal (or opens signup where the
 * platform cannot text). The parent owns the query so it can show matches.
 */
export function GoalComposer({
  autoFocusOnView = false,
  className,
  inputRef,
  memberHref = HOSTED_APP_HOME_PATH,
  onQueryChange,
  placeholders,
  query,
  startOption,
}: {
  autoFocusOnView?: boolean;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  memberHref?: string;
  onQueryChange: (query: string) => void;
  placeholders: readonly string[];
  query: string;
  startOption: MurphContactOption;
}) {
  const inputId = useId();
  const sendRef = useRef<HTMLElement>(null);
  const ownInputRef = useRef<HTMLInputElement | null>(null);
  const handoff = useGoalHandoff(startOption);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [sendReady, setSendReady] = useState(false);
  const activeQuery = query.trim();
  const prompt = goalComposerPrompt(query);

  const setInputNode = useCallback(
    (node: HTMLInputElement | null) => {
      ownInputRef.current = node;
      if (inputRef) {
        inputRef.current = node;
      }
    },
    [inputRef],
  );

  useEffect(() => {
    if (activeQuery || placeholders.length < 2) {
      return;
    }
    if (mediaMatches("(prefers-reduced-motion: reduce)")) {
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

  useEffect(() => {
    const input = ownInputRef.current;
    if (!autoFocusOnView || !input || !mediaMatches("(pointer: fine)")) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.intersectionRatio >= AUTOFOCUS_VISIBLE_RATIO)) {
          return;
        }
        observer.disconnect();
        const active = document.activeElement;
        if (active && active !== document.body && active !== input) {
          return;
        }
        input.focus({ preventScroll: true });
      },
      { threshold: AUTOFOCUS_VISIBLE_RATIO },
    );
    observer.observe(input);
    return () => observer.disconnect();
  }, [autoFocusOnView]);

  const placeholder = placeholders[placeholderIndex % Math.max(placeholders.length, 1)]
    ?? "sleep through the night";

  return (
    <div
      className={cn("w-full", className)}
      data-goal-composer
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
          data-goal-composer-input
          enterKeyHint="go"
          id={inputId}
          inputSize="xl"
          maxLength={GOAL_COMPOSER_QUERY_MAX_LENGTH}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          // Some DOM environments deliver the native input event without a
          // React change event; both call the same setter so either works.
          onInput={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              sendRef.current?.click();
            }
          }}
          ref={setInputNode}
          spellCheck={false}
          type="text"
          value={query}
        />
        {query ? null : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-5 right-14 flex items-center overflow-hidden text-base text-muted-foreground"
          >
            <span
              className="block truncate"
              data-goal-composer-placeholder
              key={placeholderIndex}
            >
              {placeholder}
            </span>
          </span>
        )}
        <GoalHandoffAction
          className={cn(
            SEND_CLASS_NAME,
            sendReady ? SEND_READY_CLASS_NAME : SEND_IDLE_CLASS_NAME,
          )}
          data-goal-composer-ready={sendReady}
          data-goal-composer-send
          guideHref={memberHref}
          handoff={handoff}
          label={prompt ? `Text Murph: ${prompt}` : "Text Murph about a goal"}
          prompt={prompt}
          ref={sendRef}
        >
          {sendReady ? (
            <Image
              alt=""
              aria-hidden="true"
              className="h-4 w-auto brightness-0 invert"
              data-goal-composer-ready-icon
              height={24}
              src="/icons/murph-mark.svg"
              width={36}
            />
          ) : (
            <ArrowUp aria-hidden="true" className="size-5" />
          )}
        </GoalHandoffAction>
      </div>
    </div>
  );
}
