# Group Managed Automations

Last verified: 2026-07-26

## Purpose

This specification defines the ownership, eligibility, delivery, and privacy
boundaries for Murph-owned automations in authenticated hosted group runtimes.
It covers the implemented Sunday superlatives recap and the deliberately
deferred weekly one-person check-in.

## Managed ownership

Built-in managed automations have one immutable owner scope:

- `member` runs only in a personal/direct member runtime.
- `authenticated-group` runs only in a synthetic group runtime with a live,
  non-direct Linq/iMessage or Telegram route.

A built-in seed without an explicit scope defaults to `member`. Group email and
unsupported non-direct routes match neither owner. Caller-supplied custom seeds
with no scope retain their existing compatibility behavior; tags, slugs,
titles, and instructions never establish managed identity or hidden authority.

Reconciliation archives every nonterminal built-in record whose current route
no longer matches the seed's exact owner scope, including paused records.
Already archived records remain archived. At execution, the canonical
`automationId` must resolve to the current immutable built-in seed and the live
route must still match its owner before lifecycle hooks, evidence reads,
provider/model work, tools, or outbox creation. The runtime rechecks that same
authority before provider admission, tools, delivery, and commit.

Dynamically generated experiment-lifecycle seeds retain their existing behavior
in this release. Their source is a separately coordinated working set and does
not expose an independent exact-identity owner resolver. They must not be
classified from tags, slugs, prompts, or broad casts.

## Sunday superlatives

The implemented seed is:

- ID: `automation_01K55N7S9X4Q2M6P8R3T0V1WYZ`
- Slug: `group-sunday-superlatives`
- Owner: `authenticated-group`
- Runtime: hosted only
- Nominal schedule: Sunday 18:00 in the group vault timezone
- Stable spread: one Sunday slot from 16:00 through 19:30 local, in 30-minute
  increments
- Delivery: the ordinary scheduled notification and group outbox path

The feature may post at most one compact recap celebrating two to four concrete
moments, recurring bits, or room dynamics. It is warm, specific, human-first,
and socially aware. Murph is a light host, not the protagonist. It does not
invent people or events, output internal aliases or identifiers, rank people,
shame anyone, pressure the room to reply, or make sensitive judgments. When the
bounded evidence does not support a safe, concrete post, it skips.

### Deterministic activity gate

Web owns the closed `group-sunday-superlatives-v1` activity policy. The model
cannot invoke or inspect it. The signed hosted control response contains only
`eligible`, `ineligible`, or `unavailable`.

Eligibility requires at least 100 canonical committed inbound human message
envelopes in the exact occurrence route during:

```text
[same local wall clock seven calendar dates before occurrenceAt, occurrenceAt)
```

The immutable scheduled occurrence and the group vault's IANA timezone define
the interval. Calendar arithmetic preserves the local wall clock across DST, so
the elapsed duration may be 167, 168, or 169 hours. Retries evaluate the same
occurrence window.

One admitted, deduplicated `HostedMailboxItem` conversation envelope is one
unit. Distinct messages batched into one assistant turn count separately;
multipart content in one envelope counts once. Consumption state is irrelevant.
The proof admits only exact synthetic-group-runtime, `conversation.message`,
`conversation`-lane Linq/iMessage or Telegram group rows whose occurrence and
commit timestamps are before `occurrenceAt` and whose embedded route authority
matches the live route.

The proof excludes Murph-authored Linq messages, reaction-only affirmative Linq
inputs, participant-addition events, direct or inexact-route input, blank or
empty input, and malformed or unreadable rows. It uses a bounded indexed scan,
stops when the threshold is proven, and fails closed as `unavailable` when the
bounded evidence cannot prove a result. It never returns, logs, persists, or
prompts message content, handles, route identifiers, participant identifiers,
or a count.

### Composition evidence

Only after Web returns `eligible`, the engine reads a separate bounded,
occurrence-anchored projection from the existing structured assistant
input-event owner. This evidence is for composition, not eligibility. It admits
only conversation-lane, non-self, route-authorized Linq/iMessage or Telegram
group input whose reply target exactly matches the live group route and whose
`occurredAt` is inside the same occurrence window. The projection reads the
event's original text field directly; rendered provider prompts and assistant
transcripts are never parsed for authority.

Composition is deliberately text-only in this release. Any event with an
attachment descriptor, parsed attachment evidence, or multimodal message
content is excluded rather than attempting to recover message boundaries from
mixed presentation text. Attachment filenames, stored paths, extracted text,
parser state, source metadata, route and actor identifiers, reactions, replies,
and message references never enter recap evidence. Delimiter-like human text
remains one JSON-quoted untrusted message and cannot create another sender or
record.

Transient authoritative senders are replaced with per-run aliases such as
`Participant 1`, including inside selected message text; names and handles are
not persisted, and the immutable seed forbids outputting the aliases. Missing,
unreadable, over-cap, empty, or attachment-only structured evidence consumes
the occurrence as a silent gate skip before lifecycle hooks, provider/model
work, or outbox creation. The room model may provide ordinary advisory social
context but is never activity, identity, membership, or participant authority.

No counter table, scheduler, queue, cursor, parser protocol, migration,
dependency, or new durable state owner is introduced.

## Future weekly one-person check-in

This product slice is specified but not active. It has no automation ID, seed,
schedule, persisted selector state, or implementation.

A future occurrence may select exactly one provider-current, active, linked
human participant or skip. It requires a safe current display label and asks one
natural, low-pressure question about how their week is going. It must not say or
imply that the person has been quiet, inactive, absent, monitored, or selected
because of message volume, and it must not infer a health, emotional, work,
relationship, or other problem. Delivery uses the ordinary group outbox.

Selection must be deterministic for an occurrence, must never expose or persist
a raw handle, and should avoid choosing the immediately preceding delivered
participant when another current eligible person exists. Any minimal rotation
evidence must live in an existing appropriate canonical runtime owner and update
only after accepted delivery; it must not create another durable owner.

The feature remains blocked because Telegram does not yet provide an
authoritative provider-current participant-membership source, and scheduled Linq
group-tool context does not yet provide the complete safe selector boundary.
Room-model aliases, historical senders, recent speech, and stale participant
projections are not identity or current-membership authority. When that
authority or a safe label is unavailable, the only valid outcome is skip.

## Non-goals

- No second scheduler, queue, durable object, or persisted activity counter.
- No person ranking, activity leaderboard, participation score, or engagement
  optimization.
- No model-visible activity threshold, count, raw transcript scan, or roster.
- No use of mutable automation metadata as policy authority.
- No compatibility migration for custom or dynamically generated automations.
- No active weekly check-in until both supported group channels have current,
  privacy-safe participant authority.

## Deployment and rollback

Deploy the status-only Web handler and route-authority proof before the
Cloudflare/runtime port, then deploy assistant-engine with the new seed last.
After all consumers can read the closed response, run ordinary managed
reconciliation so eligible group runtimes install the seed and wrong-owner
records archive. A pre-Web runner must never receive the seed because its
missing reader resolves to `unavailable` and skips, but consumer-first order
avoids unnecessary Sunday skips during rollout.

Rollback archives or removes the Sunday seed first and leaves the restrictive
managed-owner gate in place. The unused backward-compatible Web endpoint may
remain until old runners drain. No migration, backfill, feature flag, or state
repair is required.
