import { GameInviteView } from "@/app/g/[token]/game-invite-view";
import type { GameInvitePreview } from "@/src/lib/game/contract";

const DESIGN_TOKEN = "design_invite_token";

type OpenPreview = Extract<GameInvitePreview, { status: "open" }>;

const OPEN_PREVIEW: OpenPreview = {
  expiresAt: "2026-10-23T15:00:00.000Z",
  inviteeFirstName: "Ava",
  inviterFirstName: "Leo",
  startsOn: null,
  status: "open",
  terms: {
    fromDay: 0,
    n: 1,
    schedule: { days: [0, 2, 4] },
    stakes: [{ item: "Breakfast in bed", key: "stake_design", kind: "winner_gets" }],
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

const STATES: ReadonlyArray<{ id: string; label: string; preview: GameInvitePreview | null }> = [
  { id: "open", label: "Open, set weekdays", preview: OPEN_PREVIEW },
  { id: "open-any-days", label: "Open, any days, per miss", preview: ANY_DAYS_PREVIEW },
  { id: "used", label: "Already accepted", preview: { status: "used" } },
  { id: "expired", label: "Expired", preview: { status: "expired" } },
  { id: "missing", label: "Missing or turned off", preview: null },
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
              <GameInviteView preview={state.preview} token={DESIGN_TOKEN} />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}
