"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  GOAL_BROWSE_CARD_CLASS_NAME,
  GOAL_BROWSE_CARD_TITLE_CLASS_NAME,
  GoalBrowseCardIllustration,
} from "@/src/components/goals/goal-browse-card";
import { GoalComposer } from "@/src/components/goals/goal-composer";
import {
  GoalHandoffAction,
  useGoalHandoff,
} from "@/src/components/goals/goal-handoff";
import {
  GOAL_SEARCH_INDEX_PATH,
  isGoalSearchIndexPayload,
} from "@/src/lib/goals/goal-search-index-contract";
import {
  searchGoalItems,
  type GoalSearchItem,
} from "@/src/lib/goals/goal-search";
import {
  DEFAULT_HOMEPAGE_GOAL_PERSONA_ID,
  type HomepageGoalPersona,
} from "@/src/lib/goals/homepage-goal-personas";
import type { MurphContactOption } from "@/src/lib/murph-contact-routing";
import { cn } from "@/src/lib/utils";

const GOAL_RESULT_LIMIT = 8;
// Screen readers hear the match count once the visitor pauses, not per key.
const ANNOUNCE_DELAY_MS = 800;

const PILL_CLASS_NAME =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-black/[0.12] px-4 text-sm font-medium text-[#3a322a] transition-colors hover:border-black/[0.28] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[#f5f0e8]";
const ACTIVE_PILL_CLASS_NAME =
  "border-[#2d3436] bg-[#2d3436] text-[#f5f0e8] hover:border-[#2d3436]";
const GOAL_GRID_CLASS_NAME =
  "mt-8 grid w-full grid-cols-1 gap-2 sm:mt-10 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4";
const NOTE_CLASS_NAME =
  "mt-8 max-w-[44ch] text-center text-[0.9375rem] leading-[1.7] text-[#635a48] sm:mt-10";

interface GoalHandoffTarget {
  guideHref: string;
  illustrationSrc: string | null | undefined;
  phrase: string;
}

type GoalSearchIndexState =
  | { status: "idle" }
  | { status: "loading" }
  | { goals: GoalSearchItem[]; status: "ready" }
  | { status: "error" };

/**
 * The search index is ~100 KB, so the homepage fetches it only once someone
 * touches the field instead of shipping it in the page payload.
 */
function useGoalSearchIndex(): [GoalSearchIndexState, () => void] {
  const [state, setState] = useState<GoalSearchIndexState>({ status: "idle" });
  const load = useCallback(() => {
    setState((current) =>
      current.status === "idle" || current.status === "error"
        ? { status: "loading" }
        : current);
  }, []);

  useEffect(() => {
    if (state.status !== "loading") {
      return;
    }
    const controller = new AbortController();
    fetch(GOAL_SEARCH_INDEX_PATH, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: unknown) => {
        setState(
          isGoalSearchIndexPayload(payload)
            ? { goals: payload.goals, status: "ready" }
            : { status: "error" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [state.status]);

  return [state, load];
}

export function GoalsSection({
  personas,
  startOption,
  totalGoalCount,
}: {
  personas: readonly HomepageGoalPersona[];
  startOption: MurphContactOption;
  totalGoalCount: number;
}) {
  const handoff = useGoalHandoff(startOption);
  const [index, loadIndex] = useGoalSearchIndex();
  const [query, setQuery] = useState("");
  const [personaId, setPersonaId] = useState<string | null>(() =>
    personas.some((persona) => persona.id === DEFAULT_HOMEPAGE_GOAL_PERSONA_ID)
      ? DEFAULT_HOMEPAGE_GOAL_PERSONA_ID
      : personas[0]?.id ?? null);
  const [announcedSignature, setAnnouncedSignature] = useState("");

  const placeholders = useMemo(
    () => personas.flatMap((persona) => persona.goals.map((goal) => goal.phrase)),
    [personas],
  );
  const activeQuery = query.trim();
  const matches = useMemo(
    () =>
      activeQuery && index.status === "ready"
        ? searchGoalItems(index.goals, activeQuery).slice(0, GOAL_RESULT_LIMIT)
        : [],
    [activeQuery, index],
  );
  const activePersona = personas.find((persona) => persona.id === personaId) ?? null;

  const handleQueryChange = useCallback(
    (value: string) => {
      setQuery(value);
      if (value.trim()) {
        loadIndex();
      }
    },
    [loadIndex],
  );

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

  const announcement = activeQuery
    ? index.status === "ready"
      ? matches.length > 0
        ? `${matches.length} matching ${matches.length === 1 ? "goal" : "goals"}.`
        : "No matching guide yet."
      : index.status === "error"
        ? "Guides could not be loaded."
        : ""
    : activePersona
      ? `${activePersona.goals.length} goals for ${activePersona.label}.`
      : "";
  const announcementSignature = `${activeQuery}|${personaId ?? ""}|${announcement}`;

  useEffect(() => {
    const timer = window.setTimeout(
      () => setAnnouncedSignature(announcementSignature),
      ANNOUNCE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [announcementSignature]);

  return (
    <section
      className="bg-[#f5f0e8] px-4 py-28 sm:px-8 sm:py-36 lg:px-16 lg:py-44"
      data-homepage-goals
    >
      <div className="mx-auto flex max-w-[1200px] flex-col items-center">
        <h2 className="text-center font-serif text-[2rem] font-semibold leading-[1.05] tracking-[-0.035em] text-balance text-[#2d3436] sm:text-[clamp(2.25rem,4.5vw,3.5rem)]">
          Hey Murph, help me…
        </h2>

        <GoalComposer
          autoFocusOnView
          className="mt-8 max-w-2xl sm:mt-10"
          onEngage={loadIndex}
          onQueryChange={handleQueryChange}
          placeholders={placeholders}
          query={query}
          startOption={startOption}
        />

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
          {announcedSignature === announcementSignature ? announcement : ""}
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
          index.status === "ready" ? (
            <p className={NOTE_CLASS_NAME} data-homepage-goal-empty>
              Nothing written up for that yet. Send it to Murph anyway.
            </p>
          ) : index.status === "error" ? (
            <p className={NOTE_CLASS_NAME} data-homepage-goal-error>
              The guides didn’t load. Send it to Murph anyway.
            </p>
          ) : (
            <p className={NOTE_CLASS_NAME} data-homepage-goal-loading>
              Looking through the guides…
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}
