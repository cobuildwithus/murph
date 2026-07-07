# Homepage group-chat morph + social features reframe

Date: 2026-07-06
Status: completed
Branch: `feat/homepage-group-morph`
Worktree: `/private/tmp/murph-homepage-group-morph`

Our utmost priority is clean, simple, long term maintainable and composable
architecture with minimal complexity.

## Why

The locked positioning (`agent-docs/product-marketing-context.md`, 2026-06-10)
made group health challenges the wedge ("Murph is the AI referee for group
health challenges") and demoted the personal assistant to substrate. Two social
features shipped recently: group health challenges with friends and the weekly
group health newsletter. The homepage still tells only the personal-assistant
story. Founder decision (2026-07-06): the hero phone mock should morph into a
group chat mid-demo (faces fly in from the page like the existing topic
floaters), the left hero copy should crossfade in sync, and the page must
communicate challenges + newsletter even to visitors who never watch the
animation.

## User-visible goal

A visitor to `/` learns, within the first screen and within the first paint,
that Murph is (a) a personal health assistant and (b) the referee for health
challenges with friends plus a weekly family/friends health newsletter. Lingering
visitors watch the 1:1 demo become a group chat that demonstrates both social
features.

## Invariants to preserve

- Never rank bodies. Challenge scoring copy is adherence and change vs your
  own baseline, never raw body stats or "best HRV". No "leaderboard",
  "crush it", "optimize", "level up" language anywhere.
- Consent framing: joining is the explicit act that shares scoped data.
- No em dashes and no " - " clause separators in any user-facing copy.
- Existing hero behavior stays intact: topic floaters clickable, composer send
  cancels the demo and shows the contact card, reduced-motion gets a static
  seed, auto-scroll pauses when the user scrolls up, mobile (< lg) hides
  floaters but plays the in-phone demo.
- First-paint/SSR copy (SEO + LCP) remains the act-1 copy; act-2 copy swap is
  client-side and must not cause layout shift.
- Design system: Tailwind v4 arbitrary values in the existing homepage palette
  (`#f5f0e8`, `#5a6e32`, `#c4a882`, `#2d3436`, `#736a58`); match the existing
  card idioms in `hero-clocks-in.tsx`. No new dependencies. No @radix-ui.

## Files to touch

- `apps/web/src/components/homepage/hero-clocks-in.tsx` (morph timeline, group
  rendering, person floaters, copy crossfade)
- `apps/web/src/components/homepage/group-chat-cards.tsx` (NEW: `GROUP_MEMBERS`,
  `ChallengeCard`, `NewsletterCard`; shared by hero + section)
- `apps/web/src/components/homepage/together-section.tsx` (NEW: static
  below-the-fold social section)
- `apps/web/app/page.tsx` (insert section, update metadata descriptions)
- `apps/web/src/components/homepage/faq-section.tsx` (two new entries)
- `apps/web/test/homepage-together-section.test.tsx` (NEW)
- `apps/web/test/homepage-group-chat-cards.test.tsx` (NEW)
- `apps/web/test/hero-clocks-in.test.tsx` (NEW: light render smoke under
  mocked `matchMedia` reduced-motion, asserts group seed renders)

Do not touch other homepage sections, auth controls, pricing helpers, or
anything outside `apps/web`.

## Cast

```ts
const GROUP_MEMBERS = [
  { id: "theo", name: "Theo", avatarSrc: "/personas/sleeper.jpg" },
  { id: "maya", name: "Maya", avatarSrc: "/personas/athlete.jpg" },
  { id: "sam",  name: "Sam",  avatarSrc: "/personas/founder.jpg" },
] as const;
```

Group name: `The Crew`. Reuse the existing persona images; do not add assets.

## Hero storyboard

### Act 1: personal assistant (unchanged mechanics, trimmed auto-run)

Auto-run plays only the first 3 scripted exchanges (Magnesium card, LDL
bloodwork, Dentist order); pick by an explicit `AUTO_RUN_TOPICS` list rather
than deleting exchanges. All 14 topic floaters stay mounted and clickable
exactly as today (clicking runs that exchange once and cancels the auto
timeline, current behavior). Keep `EXCHANGES` data intact.

### Act 2: the group forms

Three person floaters (avatar chip: 22px round image + first name, same mono
label styling family as topic floaters but with the image) are mounted from
load alongside topic floaters, positioned in the top strip and right edge
without crowding hero text. They wobble with the same `hero-float` animation.

When the 3 auto-run exchanges finish (or when a person floater is clicked),
the group sequence starts:

1. Members fly into the phone one at a time (~1.8s apart) reusing the
   `hero-coalesce` animation, each followed by a centered gray iMessage-style
   system line in the thread: `Theo joined the conversation`, then Maya, then
   Sam.
2. On the first join, the chat header crossfades from the solo Murph avatar to
   a group header: overlapping stacked avatars (Murph headshot + 3 members)
   and the name pill reading `The Crew`, back-count badge stays.
3. The left copy crossfades (see Copy below) at the moment the first member
   flies in.
4. Person floaters are consumed as they fly in (same `usedFloaters` idea).
   Topic floaters stay mounted and clickable; a topic exchange run during
   group mode simply plays in the thread (that is realistic in a group chat).

Rules: clicking a person floater when the group sequence has not started
starts it (skipping any unplayed act-1 exchanges). During or after the
sequence, remaining person floaters fly in as part of it; clicks are no-ops
(disabled while active, same as topic floaters today). Composer send keeps
today's behavior in any act: cancel timeline, contact card reply.

### Act 3: social features (scripted group beats, ~6.5s apart)

Group messages render iMessage-group style: gray left bubble with a small
avatar (18px) and name label (9px, muted) above the first bubble of a sender
run. Murph keeps its existing white bubble + no label (header identifies it) or
reuse the member treatment with the Murph headshot; pick whichever reads
cleaner with minimal new code.

Beat 1 (Theo): `ok who's actually winning this thing`

Beat 2 (Murph): `ChallengeCard`, then text bubble:
`Standings, day 5 of 7. Maya is one sunrise walk from taking the lead. Theo, bold words for a man who logged 11 minutes yesterday.`

Beat 3 (Maya): `😂 not the sunrise walk pressure`

Beat 4 (user, green): `how does everyone keep up with this?`
then (Murph): `NewsletterCard`, then text bubble:
`Weekly recap lands in everyone's inbox on Sunday morning. Family included, no app needed.`

Then the demo settles (no loop), matching today's end-state behavior.

### New cards (in `group-chat-cards.tsx`)

`ChallengeCard`, matching the visual language of `ExperimentCard`/
`BloodworkCard` (rounded 18px, `border-[#c4a882]/25`, `bg-white/75`, mono
eyebrow):

- Eyebrow: `Walk challenge · Day 5 of 7`
- Rows (name, days done, thin progress bar, own-baseline delta):
  - `You` `5/5 days` bar 1.0 `+31% steps vs baseline`
  - `Maya` `4/5 days` bar 0.8 `+22 min avg walk`
  - `Sam` `4/5 days` bar 0.8 `+12% steps vs baseline`
  - `Theo` `3/5 days` bar 0.6 `+4% steps vs baseline`
- Footer line (9px mono muted): `Scored on adherence and change vs your own baseline`

`NewsletterCard`, styled as a compact email preview (white card, subject line
serif semibold, small rows):

- Header row: envelope glyph (inline SVG or existing `email-icon.tsx`) +
  mono eyebrow `Weekly newsletter · Sunday 8:02 AM`
- Subject: `The Crew: week 3 in health`
- Preview rows (name + one-liner):
  - `Theo · best sleep week since May`
  - `Maya · 4 sunrise walks logged`
  - `Sam · steps up 12% on baseline`
- Footer (9px mono muted): `Emailed to everyone who opted in`

### Copy crossfade (left column)

Render both copy variants stacked in the same CSS grid cell (both
`col-start-1 row-start-1`), inactive layer `opacity-0` + `aria-hidden` +
`pointer-events-none`, 500ms opacity transition, so block height is the max of
both variants and there is zero layout shift. The server renders act-1 visible
(SEO/LCP unchanged).

Act 1 (current, paragraph gains a final sentence):

- H1 line 1: `Health is overwhelming.`
- H1 line 2 (green): `Murph makes it easy.`
- Paragraph: `Murph is your personal health assistant. Wearables, bloodwork,
  doctor visits, supplements, blood pressure, sleep. Murph runs it all and
  helps you figure out what actually makes you healthier, then build habits
  that stick. And it gets your friends and family in on it.`

Act 2/3 (after morph starts):

- H1 line 1: `Health is a team sport.`
- H1 line 2 (green): `Murph is the referee.`
- Paragraph: `Start a health challenge with your friends in a group chat.
  Murph sets fair baselines, keeps score, calls the winner, and sends everyone
  a weekly newsletter on how the crew is doing.`

The CTA button and channel icon stay unchanged.

### Reduced motion

When `prefers-reduced-motion: reduce`: seed the group end-state statically
(group header, one member question, `ChallengeCard`, Murph referee reply,
`NewsletterCard`) and show the act-2 copy variant, no animations. This replaces
the current single magnesium seed because the social story is now the headline
story.

## Together section (NEW, rendered between `HeroClocksIn` and `AsksGridSection`)

Static two-panel section on the `#f5f0e8` background, matching existing
section rhythm (`px-5 py-16 sm:px-10 lg:px-16 lg:py-24`, max-w 1080 to 1280):

- Eyebrow (mono, `#736a58`): `Better together`
- H2 (serif): `Do it with your people.`
- Body: `Habits stick when someone else is watching. Start a challenge with
  friends, or set up a weekly newsletter so the whole family knows how
  everyone is doing.`
- Panel A `Group challenges`: reuse `ChallengeCard` (same data) at a slightly
  larger, readable scale inside a soft card frame, plus one referee quote line
  under it in a chat-bubble style: `Theo, bold words for a man who logged 11
  minutes yesterday.` Caption copy: `Murph is the referee. It sets fair
  baselines across different devices, keeps score, nudges the slackers, and
  calls the winner at the end.`
- Panel B `The weekly newsletter`: reuse `NewsletterCard`, caption copy:
  `Every Sunday the group gets an email recap of the week. Wins, trends, and
  gentle callouts. Grandparents included.`
- Consent footnote (small, muted, under both panels): `Everyone opts in when
  they join. Scores are adherence and change against your own baseline, never
  raw body stats.`

## FAQ additions (`faq-section.tsx`, insert after the wearable-app item)

- `Can I do challenges with friends and family?` /
  `Yes. Start a group with Murph and invite your people. Murph referees the
  challenge: fair baselines across different devices, scoring, reminders, and
  a winner at the end. Scoring is adherence and change against your own
  baseline, never raw body stats.`
- `What does the group actually see?` /
  `Only what each person agrees to share when they join a challenge or
  newsletter. The weekly newsletter is a short recap of how everyone's week
  went. Everything else stays private by default.`

## Metadata (`apps/web/app/page.tsx`)

- `description`: `Your health assistant for you and your people. Run health
  challenges with friends, get a weekly family health newsletter, and discover
  what actually makes you healthier.`
- OpenGraph + Twitter descriptions: `Text Murph over iMessage. Run health
  challenges with friends, get a weekly family health newsletter, and see what
  actually makes you healthier.`
- Title unchanged.

## Implementation notes

- Extend the existing `StreamItem` union rather than adding a parallel state
  system: `TextItem` gains an optional `sender` (member ref) used when
  `from: "member"`; add `SystemItem` (join lines), `ChallengeItem`,
  `NewsletterItem`. Keep `MAX_ITEMS` trimming.
- Drive acts with the existing queue/timer pattern (one `queue` helper, one
  cancellation ref); do not introduce a state-machine library or reducer
  framework. A single `groupMode` boolean state (set when the morph starts) is
  enough for header + copy swap.
- Person floaters extend the existing `Floater` shape with an optional member
  ref instead of a second floater system.
- Keep all new copy strings as module-level consts.
- Prefer deleting/refactoring inside `hero-clocks-in.tsx` over adding files;
  only `group-chat-cards.tsx` and `together-section.tsx` are new because both
  hero and section share the cards.

## Verification

- `pnpm typecheck` (repo root or `apps/web`).
- `pnpm test:diff apps/web` (or `vitest run` on the touched test files from
  repo root; vitest must run from repo root in fresh worktrees).
- Lint if repo-standard (`pnpm lint` scoped to apps/web) when quick.
- Browser check happens post-implementation by the supervising agent (desktop
  + mobile widths): act transitions, no layout shift on copy swap, reduced
  motion seed, floater clicks, composer send.

## Out of scope

- Personas section fourth column ("The ringleader"): fast follow.
- Asks-grid social prompts.
- Any backend, pricing, or onboarding change.
Updated: 2026-07-06
Completed: 2026-07-06
