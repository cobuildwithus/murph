import { GameInviteView } from "@/app/g/[token]/game-invite-view";
import { GameInviteShareCard } from "@/app/g/[token]/invite-share-card";
import { gameInviteAppUrl } from "@/src/lib/game/access";
import type { GameInvitePreview } from "@/src/lib/game/contract";

import { ScaledSharePreview } from "./scaled-share-preview";

import "./share-preview-fonts.css";

// The study links to the Murph app the way production does.
const DESIGN_APP_URL = gameInviteAppUrl("design_invite_token", {});

type OpenPreview = Extract<GameInvitePreview, { status: "open" }>;

const OPEN_PREVIEW: OpenPreview = {
  expiresAt: "2026-10-23T15:00:00.000Z",
  inviterFirstName: "Leo",
  startsOn: null,
  status: "open",
  terms: {
    fromDay: 0,
    n: 1,
    schedule: { days: [0, 2, 4] },
    stakes: [{ item: "Breakfast in bed", key: "stake_design", kind: "prize" }],
    tasks: [
      { seat: 0, text: "100 pushups" },
      { seat: 1, text: "10 min abs" },
    ],
  },
};

const ANY_DAYS_PREVIEW: OpenPreview = {
  ...OPEN_PREVIEW,
  terms: {
    ...OPEN_PREVIEW.terms,
    schedule: { count: 5 },
    stakes: [{ item: "One massage", key: "stake_design", kind: "per_miss" }],
  },
};

const DARE_PREVIEW: OpenPreview = {
  ...OPEN_PREVIEW,
  lengthDays: 75,
  terms: { ...OPEN_PREVIEW.terms, schedule: { count: 50 }, stakes: [{ kind: "dare", item: "sing at karaoke", key: "stake_dare" }] },
};

const STATES: ReadonlyArray<{ id: string; label: string; preview: GameInvitePreview | null }> = [
  { id: "any-artifact", label: "Open, free artifact choice", preview: { ...OPEN_PREVIEW, terms: { ...OPEN_PREVIEW.terms, checkInKind: "any", schedule: { days: [0, 1, 2, 3, 4] } } } },
  { id: "dare", label: "Open, 75 days, dare", preview: DARE_PREVIEW },
  { id: "open", label: "Open, set weekdays", preview: OPEN_PREVIEW },
  { id: "open-any-days", label: "Open, any days, per miss", preview: ANY_DAYS_PREVIEW },
  { id: "heart-rate", label: "Open, heart-rate check-in", preview: { ...OPEN_PREVIEW, terms: { ...OPEN_PREVIEW.terms, checkInKind: "heart_rate" } } },
  { id: "used", label: "Already accepted", preview: { status: "used" } },
  { id: "expired", label: "Expired", preview: { status: "expired" } },
  { id: "missing", label: "Missing or turned off", preview: null },
];

// The link preview Messages shows for the same invite: the production card.
const LINK_PREVIEWS: ReadonlyArray<{ id: string; label: string; preview: GameInvitePreview | null }> = [
  { id: "link-dare", label: "Link preview, 75 days, dare", preview: DARE_PREVIEW },
  { id: "link-open", label: "Link preview, open", preview: OPEN_PREVIEW },
  { id: "link-open-any-days", label: "Link preview, any days, picked start", preview: { ...ANY_DAYS_PREVIEW, startsOn: "2026-10-19" } },
  { id: "link-closed", label: "Link preview, used, expired, or missing", preview: { status: "used" } },
];

export function GameInviteStudy() {
  return (
    <div className="flex flex-col gap-8" data-design-study="game-invite" id="game-invite">
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        The production <code>/g/[token]</code> page a texted weekly-game challenge opens. It shows both
        tasks, the days, and the stake, then hands off to the app. Preview only; the buttons are inert here.
      </p>
      <div className="grid items-start gap-6 md:grid-cols-2">
        {STATES.map((state) => (
          <figure className="flex flex-col gap-3" key={state.id}>
            <figcaption className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {state.label}
            </figcaption>
            <div
              className="overflow-hidden rounded-3xl border border-border bg-background px-6 py-7 text-foreground sm:px-10 sm:py-9"
              data-design-state={state.id}
              id={`game-invite-${state.id}`}
              inert
            >
              <GameInviteView appUrl={DESIGN_APP_URL} preview={state.preview} />
            </div>
          </figure>
        ))}
      </div>
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
        The 1200x630 link preview from <code>/g/[token]/opengraph-image</code>. An open invite shows the challenger
        against &ldquo;You&rdquo; with the tasks, days, and stake the page shows to anyone holding the link; the
        name the challenger typed for the invitee stays private. A closed one names nobody.
      </p>
      <div className="grid items-start gap-6 md:grid-cols-2">
        {LINK_PREVIEWS.map((state) => (
          <figure className="flex flex-col gap-3" data-design-state={state.id} id={`game-invite-${state.id}`} key={state.id}>
            <figcaption className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
              {state.label}
            </figcaption>
            <div inert>
              <ScaledSharePreview frameId={`game-invite-${state.id}`}>
                <GameInviteShareCard preview={state.preview} />
              </ScaledSharePreview>
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
