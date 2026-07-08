# Group Challenge Referee: skill, scratchpad, and photo authority

Status: completed
Updated: 2026-07-06

## Why

The first live group challenge (June 2026, iMessage, 7-day sleep score)
validated the wedge end to end: one kickoff text produced consent, stakes,
metric negotiation, daily laughing replies, contributed photos, a
participant-commissioned bit, a feature request, and a multi-surface user —
in under three hours. The referee-humor loop held across three consecutive
dispatch formats (comic → voice memo → text sportsbook). Everything below is
field-derived from that run.

What ran manually must now run as product. The gaps are not capability —
`generate_image`, `generate_voice_memo`, `generate_song`, `vault-cli group
shared`, cron automations, and the group runtime's own vault all exist — the
gaps are (a) no skill owns the challenge as a lifecycle, (b) the referee has
no durable state across context resets, and (c) participant photos cannot be
used in generated images after the turn they were sent in.

Organizing constraint (same as the wake-collapse plan): land net-negative
where possible. WS2 below is a strict deletion. WS1/WS3 are markdown skills
plus one registry entry each — no new storage, no new entities, no new
services.

## Architecture: three skill layers over existing primitives

| Layer | Skill | Owns |
| --- | --- | --- |
| Room etiquette | `group-chat` (exists, runtime) | when to reply/react/stay silent, message shape, roster reads |
| Referee voice | `groupchat-comedy` (WS1: promote to runtime) | comedy engine, roast hierarchy, register flips, canon, dispatch formats, hard limits |
| Challenge lifecycle | `group-challenge` (WS3: new) | kickoff → daily loop → close-out; scratchpad; data handling; media rotation |

Verified substrate facts the design leans on:

- A hosted group is its own runtime member with its own vault
  (`HostedGroup.runtimeMemberId`), Durable-Object-hosted and R2-snapshotted —
  anything written into the group vault survives context/container resets and
  is automatically group-scoped.
- `vault-cli knowledge` pages are free-form markdown, slug-keyed,
  `append-section`-able, read on demand (never prompt-injected), and
  snapshot-durable — the only primitive that is simultaneously entity-keyed,
  appendable, runtime-writable, and zero prompt cost.
- `vault-cli capture add --media <path>` stages media as canonical events
  with immutable `raw/captures/**` attachments — outside `raw/inbox/**`, so
  the 14-day inbox retention sweep never touches them.
- `vault-cli group shared [--kind <projection>]` reads members' consented
  projections; the store keeps **≤7 records per grantor per kind** (sliding
  window), so standings must be snapshotted daily, not recomputed
  retroactively.
- Generated images upload to Cloudflare Images with **permanent public
  URLs**, re-attachable any day via `attach_response_media`. Voice memos and
  songs are **single-turn Linq attachments — replay means regenerate**, so
  the scratchpad stores scripts/lyrics, not audio ids.
- A voice memo or song **cannot combine with other response media in the
  same turn** — one format per dispatch is platform-enforced.
- Consent-at-join is the server-owned web join page (checkboxes per share
  kind, auto-grant of `profile-name.v0`). In-chat reaction-to-consent does
  not exist and is explicitly deferred (see Deferred).

## WS1 — Promote `groupchat-comedy` to runtime

Owner: founder (in progress).

- Move `.agents/skills/groupchat-comedy/SKILL.md` →
  `packages/assistant-engine/skills/groupchat-comedy/SKILL.md`.
- Add the `ASSISTANT_SKILLS` entry in
  `packages/assistant-engine/src/assistant-skill-assets.ts` with a
  description that scopes it to composing group-chat messages in a challenge
  or banter context (kickoffs, dispatches, rulings, replies to trash talk,
  comics, voice memos).
- No content changes required to land; WS3 references it by name.

## WS2 — Image reference authority: replace per-turn machinery with a two-prefix rule (net deletion)

### Decision record

The per-turn allowlist (PR #330 rounds 4–9) is a proxy for a wall that lives
elsewhere. The actual confidentiality boundary is the **vault itself**: each
relationship (1:1, each group) is a separate runtime + vault, so cross-vault
leakage is impossible by construction; and within a vault the model already
has full read authority whose context flows to the provider. Per-image,
per-turn authority therefore adds no confidentiality. What it does encode —
"the assistant only remixes actual human-sent media, never document scans,
bank files, or derived artifacts" — is a product invariant that the vault
layout already expresses structurally.

Division of labor going forward: **structure prevents leaks (vault
separation + media-family prefixes); skills prevent bad judgment
(groupchat-comedy hard limits).**

Accepted residual behavior, chosen deliberately: within a vault, any
pipeline-written media image (including a user's own older photos and
captures) is usable as a generation reference on any later day, in that
vault's own conversation. That is the feature, not a leak.

### Change shape

In `packages/assistant-engine/src/assistant-codex/`:

- **Delete** `turn-attachment-image-refs.ts`
  (`collectAuthorizedTurnAttachmentImageRefs`,
  `authorizeReferenceImageEvidence`) and the
  `loadAuthorizedReferenceImageRefs` supplier threading through
  codex-turn-runner → providers/codex-cli → assistant-codex →
  `executeMurphDynamicToolRequest` → `executeGenerateImageTool`.
- **In `image-reference-resolver.ts`**: drop the
  `authorizedReferenceImageRefs` parameter, the allowlist membership check,
  and the per-turn sha256 comparison. Add the structural prefix check to ref
  normalization: refs must be vault-relative paths under
  `RAW_INBOX_DIRECTORY` (`raw/inbox`) or `RAW_CAPTURES_DIRECTORY`
  (`raw/captures`) from `packages/contracts/src/vault-families.ts`. Keep
  path normalization, symlink-escape prevention, byte caps, magic-byte
  sniffing, and neutral filenames unchanged (transport correctness, not
  authority).
- **Tests**: delete the allowlist/authority-unavailable/bytes-swap
  regressions tied to per-turn machinery; keep/extend prefix regressions
  (accept `raw/inbox/**` and `raw/captures/**`; reject `raw/documents/**`,
  `bank/**`, `derived/**`, `journal/**`, out-of-prefix `raw/**`).
- **Tool schema**: update `murph.generate_image`'s
  `referenceImageRefs` description: user-sent media under `raw/inbox/**` or
  captured media under `raw/captures/**`.
- **Docs**: ARCHITECTURE.md never documented the per-turn reference
  authority (verified by sweep), so no doc row changes; the decision record
  above is the durable rationale.

Deletion ledger expectation: this PR removes materially more code than it
adds (an entire module, a threading chain across four layers, and their
tests, replaced by one prefix predicate).

## WS3 — New runtime skill: `group-challenge`

`packages/assistant-engine/skills/group-challenge/SKILL.md` + registry entry
in `assistant-skill-assets.ts`. Read whenever a group chat starts, runs, or
closes a challenge; defers voice/comedy composition to `groupchat-comedy`
and room etiquette to `group-chat`.

### Skill contents (outline)

1. **What a challenge is.** A time-boxed group experiment over consented
   shared data: metric, window, stakes, referee. Scores adherence and
   change-vs-own-baseline; never raw body stats outside the opted-in
   challenge frame (composes with the constitution's no-raw-biomarker-
   leaderboards default — the challenge frame IS the opt-in).
2. **Kickoff protocol.**
   - Metric negotiation is part of the product: participants argue fairness
     (consistency vs overall score); the referee adjudicates with a real
     ruling and converges the group on one metric + window.
   - Consent: mint the join link (`murph.group create_join_link` with the
     challenge's share kinds); members select kinds on the join page.
     Never improvise consent in-chat.
   - Introductions + photos: ask every participant for a short intro and a
     photo of themselves. For each photo: pin it durably with
     `vault-cli capture add --media <inbox path> --collection
     challenge-<slug> --label intro-<name>`, then record the capture id +
     stored path in the scratchpad. These are the reference images for all
     later generated media (WS2 makes them permanently referenceable).
   - Baselines: read pre-challenge shared data where available; record
     per-member baselines in the scratchpad.
   - Stakes: the group invents them; the referee's job is to remember them
     precisely and tease them. Record verbatim in the scratchpad.
   - Confounders: participants declare them naturally at kickoff ("I'm
     traveling next week"); log each one — they are outcome-card material,
     not excuses to relitigate scores.
3. **The scratchpad (durable referee state).** One knowledge page per
   challenge: `vault-cli knowledge upsert --slug challenge-<name>-<start>
   --page-type challenge --status active`. Fixed sections:
   - Rules & metric (as agreed, with the ruling that settled it)
   - Roster & intros (member id ↔ name ↔ photo capture refs)
   - Baselines
   - Stakes (verbatim)
   - Canon (running bits, nicknames, claims, commissioned bits — with dates)
   - Comedy bank (bits saved for future days)
   - Sent log (every dispatch: date, format, one-line summary, image URLs,
     audio scripts/lyrics)
   - Standings snapshots (dated — required because shared data is a ~7-record
     sliding window)
   - Confounders & protected-register notes (who is DOWN and shielded today)
   Also: `vault-cli memory upsert` one pointer record ("active challenge:
   <slug> — read the page before any challenge action") so a fresh session
   finds the page. Read the page before composing anything; append the
   day's section after dispatching.
4. **Daily dispatch loop.** Scheduled via `vault-cli automation save`
   (dailyLocal, `continuityPolicy: preserve`), instructions: read scratchpad
   → read `vault-cli group shared --kind <metric>` fresh (never trust
   remembered numbers; scores must be accurate or the comedy is noise) →
   compose ONE dispatch in ONE format → send → append today's section.
   - Format rotation is part of the act (text bit → comic → voice memo →
     song → sportsbook odds → ruling); one media format per turn is
     platform-enforced. Consult the sent log to avoid repeating a format on
     consecutive days.
   - Images: generate with `referenceImageRefs` pointing at the pinned
     capture paths; store the returned permanent URL in the sent log
     (re-attachable later on request — participants ask for replays).
   - Audio: store the script/lyrics in the sent log; regenerate on replay
     requests (attachments are single-turn).
   - Between dispatches, normal `group-chat` ladder rules apply; rulings on
     rules questions come with canon callbacks.
5. **Register flips.** One datapoint can produce both a group joke about
   the leader and a private check-in for the struggler — same memory, two
   rooms. Protected-register triggers and hard limits are owned by
   `groupchat-comedy`; this skill adds the state: record protected status in
   the scratchpad so a context-reset referee doesn't roast someone shielded
   yesterday.
6. **Close-out.** Final standings from fresh shared data + snapshots;
   winner declared with stakes callback; a closing artifact (comic or
   recap) generated from the pinned photos; scratchpad page flipped to
   `--status archived`; memory pointer removed. Results belong to members —
   point each to their own 1:1 for the private write-up.
7. **Engagement telemetry.** The ladder (react → reply → argue →
   contribute → commission) marks the loop working; sustained silence from
   a member triggers a gentle private check-in, not louder group jokes.

## Deferred (explicitly out of scope now)

- **In-chat reaction-to-consent** ("like this message to share your sleep
  data"). Five missing pieces end to end: inbound reaction ingestion in the
  Linq webhook (only `message.received` is processed today), reactor-handle
  → member resolution, an offer-message ↔ share-kind binding store, a gated
  runtime grant-write seam (grants are web-transaction-only today), and a
  deliberate consent-policy decision about what a tapback may substitute
  for. Until then: web join page, or concierge.
- **Cross-vault anything.** A member's 1:1 assistant referencing group
  challenge state is a real request from the field, but it crosses the vault
  boundary and needs its own consent design.
- **Newsletter integration.** The weekly group newsletter
  (`group-health-newsletter`) stays independent; a challenge-week edition
  can reference the challenge later.

## Verification

- WS1/WS3: skills appear in the runtime skill root; a hosted group runtime
  can read both files; registry descriptions route correctly (kickoff
  message → group-challenge; banter → group-chat only).
- WS2: resolver unit tests (prefix accept/reject matrix); e2e —
  `generate_image` with a `raw/captures/**` ref succeeds on a later turn in
  the same vault; `raw/documents/**` ref fails closed; Cloudflare egress
  regressions unchanged.
- End-to-end dry run before the next real challenge: scripted group with
  two test members — kickoff (intros, photo pin, page created) → simulated
  context reset → day-2 dispatch (page found via memory pointer, format
  rotated, standings fresh, image generated from pinned photo) → close-out
  (archive + final comic).
Completed: 2026-07-06
