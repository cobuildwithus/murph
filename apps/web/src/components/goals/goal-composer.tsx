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
// Someone paging down with the keyboard is scrolling, not arriving: taking
// focus would turn their next Space into a typed character.
const KEYBOARD_SCROLL_GRACE_MS = 1500;
// Focus only once the page has stopped moving with the field on screen, so a
// fling or smooth scroll past the section never grabs focus off-screen.
const AUTOFOCUS_SETTLE_MS = 300;
const AUTOFOCUS_SETTLE_ATTEMPTS = 10;

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
[data-goal-composer-ready="true"]:not(:focus-visible) {
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

function visibleRatio(element: HTMLElement): number {
  const rect = element.getBoundingClientRect();
  if (rect.height === 0) {
    return 0;
  }
  const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return Math.max(0, visibleHeight) / rect.height;
}

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
  onEngage,
  onQueryChange,
  placeholders,
  query,
  startOption,
}: {
  autoFocusOnView?: boolean;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  memberHref?: string;
  /** Fires when the visitor focuses or hovers the field: a good time to prepare search data. */
  onEngage?: () => void;
  onQueryChange: (query: string) => void;
  placeholders: readonly string[];
  query: string;
  startOption: MurphContactOption;
}) {
  const inputId = useId();
  const hintId = useId();
  const sendRef = useRef<HTMLElement | null>(null);
  const ownInputRef = useRef<HTMLInputElement | null>(null);
  const handoff = useGoalHandoff(startOption);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  // The query that has sat unchanged long enough to invite a send.
  const [settledQuery, setSettledQuery] = useState("");
  const activeQuery = query.trim();
  const prompt = goalComposerPrompt(query);
  const sendReady = activeQuery !== "" && settledQuery === activeQuery;

  const setSendNode = useCallback((node: HTMLElement | null) => {
    sendRef.current = node;
  }, []);
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
    if (!activeQuery) {
      return;
    }
    const timer = window.setTimeout(
      () => setSettledQuery(activeQuery),
      SEND_READY_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [activeQuery]);

  useEffect(() => {
    const input = ownInputRef.current;
    if (!autoFocusOnView || !input || !mediaMatches("(pointer: fine)")) {
      return;
    }
    let lastKeyDownAt = 0;
    let settleTimer: number | null = null;
    const noteKeyDown = () => {
      lastKeyDownAt = Date.now();
    };
    const stop = () => {
      observer.disconnect();
      window.removeEventListener("keydown", noteKeyDown, true);
      if (settleTimer !== null) {
        window.clearTimeout(settleTimer);
        settleTimer = null;
      }
    };
    const settle = (scrollYAtArrival: number, attempt: number) => {
      settleTimer = window.setTimeout(() => {
        settleTimer = null;
        if (visibleRatio(input) < AUTOFOCUS_VISIBLE_RATIO) {
          return;
        }
        if (Math.abs(window.scrollY - scrollYAtArrival) > 2) {
          if (attempt < AUTOFOCUS_SETTLE_ATTEMPTS) {
            settle(window.scrollY, attempt + 1);
          }
          return;
        }
        stop();
        const active = document.activeElement;
        if (active && active !== document.body && active !== input) {
          return;
        }
        if (Date.now() - lastKeyDownAt < KEYBOARD_SCROLL_GRACE_MS) {
          return;
        }
        input.focus({ preventScroll: true });
      }, AUTOFOCUS_SETTLE_MS);
    };
    window.addEventListener("keydown", noteKeyDown, true);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.intersectionRatio >= AUTOFOCUS_VISIBLE_RATIO);
        if (!visible) {
          if (settleTimer !== null) {
            window.clearTimeout(settleTimer);
            settleTimer = null;
          }
          return;
        }
        if (settleTimer === null) {
          settle(window.scrollY, 1);
        }
      },
      { threshold: AUTOFOCUS_VISIBLE_RATIO },
    );
    observer.observe(input);
    return stop;
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
      <p className="sr-only" id={hintId}>
        Finish the sentence, for example: {placeholders[0] ?? "sleep better"}
        {placeholders[1] ? ` or ${placeholders[1]}` : ""}.
      </p>
      <div className="relative" onPointerEnter={onEngage}>
        <Input
          aria-describedby={hintId}
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
            // Enter while an IME is composing commits the text, not the goal.
            if (
              event.key !== "Enter"
              || event.nativeEvent.isComposing
              || event.keyCode === 229
            ) {
              return;
            }
            event.preventDefault();
            sendRef.current?.click();
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
          data-goal-composer-ready={sendReady ? true : undefined}
          data-goal-composer-send
          guideHref={memberHref}
          handoff={handoff}
          labels={{
            guide: "Open Murph",
            message: prompt ? `Text Murph: ${prompt}` : "Text Murph about a goal",
            signup: prompt
              ? `Get started with Murph: ${prompt}`
              : "Get started with Murph",
          }}
          prompt={prompt}
          ref={setSendNode}
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
