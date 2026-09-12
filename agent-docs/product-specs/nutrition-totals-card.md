# Logged nutrition cards with optional targets

Date: 2026-09-11.
Execution: `agent-docs/exec-plans/active/2026-09-11-nutrition-totals-card.md`.

## Member outcome

A verified private meal log, including an ordinary reply to a scheduled meal
check-in, normally ends with the owned daily nutrition card when complete
canonical same-date totals, numeric suitability, and routing permit. Explicit
daily summaries and eligible managed closeouts use the same presentation.
Targets are optional. A summary never derives, proposes, accepts, activates,
changes, or abandons a Goal. A meal reply or silence never accepts goals.

Totals-only says **estimated / logged so far**, shows the selected date and
logged meal count, and explains that logged records may not include everything
eaten. It has no goal ring, target judgment colors, or unavailable-target
placeholders. A missing nutrient is unknown, not zero. Equal coverage counts
prove complete stored records, not complete capture of the member's day.

## Authority and eligibility

`packages/query/src/meal-nutrition*.ts` remains the canonical read owner. Before
attachment use one successful selected-date `meal totals --resolve-goals` read,
rerunning after any meal or Goal mutation. Do not recalculate around canonical
records, use another date, reinterpret raw bounds, or invent targets.

| Canonical goal context | Fresh authoring / behavior |
| --- | --- |
| `ready` | Five accepted compatible snapshots, unchanged target values and status semantics. |
| `missing` | Five explicit nulls, including a compatible subset of accepted targets. No derivation or mutations. |
| `conflict`, `incompatible`, `capacity` | Truthful text, no card or target mutation. Never silently relabel as missing or acceptance. |

`packages/contracts/src/assistant.ts` and the operator tool JSON schema accept
exactly all-null or all-five fresh V2 goals. Mixed fresh authoring is invalid.
The historical V1 and nullable/mixed V2 readers remain available for replay.
The existing calorie-target floor remains a target rule, not a minimum amount
that must have been logged before a totals-only card is allowed.

Food-journal owns capture, estimates, suitability and intent. An ordinary meal
reply may not repair or ask about unrelated incomplete meals. If any nutrient's
coverage is incomplete, it returns the existing short truthful fallback. An
explicit daily-summary request retains the existing exact-meal recovery and
single missing-detail question; an informed explicit partial-data request can
still receive a partial card. Partial cards do not receive the introduction.
Number-sensitive, intuitive-eating and eating-disorder contexts retain nonnumeric
behavior. A concern affecting target advice does not alone block benign logged
totals; missing physiology inputs never prompt a universal screening checklist.
Compound requests remain complete ordinary text rather than dropping another
requested answer to fit a card. Private-direct and media exclusivity gates stay.

Automatic meal capture owns occurrence dates, retained-photo cleanup, retries,
historical-only silence and its narrower clarification exception. Complete
current-date totals with missing goals permit totals-only; scheduled turns never
ask about goal setup or initiate/repeat a proposal. An ordinary check-in reply
uses interactive food-journal authority, not scheduled mutation authority.

Only explicit target-setting uses nutrition-strategy's existing evidence-grounded
paused canonical proposal, explanation, acceptance, revision and decline flow.
A combined target-setting/card request can complete on later clear acceptance
under the existing suitability, readback and freshness gates. Unrelated summaries
leave paused/abandoned Goals untouched. Existing conflicts, date windows,
comparators, units, legacy compatibility and explicit target precedence remain.

## One optional introduction, one delivery effect

For the first suitable complete totals-only card, the only allowed companion is:

> Here’s your nutrition card. If you’d like, we can set up goals too.

The model selects that exact copy only when current conversation and canonical
memory/instructions show no decline, number-sensitive preference, sent invitation
or visible pending invitation. Unknown/unreadable optional preference evidence
means omit the invitation, not block the card. Free-text preferences remain the
existing semantic instructions owner's responsibility, not a new keyword parser.
An explicit decline belongs in canonical Instructions/Preferences and is not
permission to abandon unrelated Goals. Explicit engagement hands off to the
existing target-setting owner; there is no automatic reminder to set goals.

`assistant/nutrition-card-introduction.ts` rechecks canonical sent memory and
all-status managed-proposal evidence before final rendering. Any existing
`murph-daily-nutrition-starting-targets` Goal (including abandoned) suppresses the
intro. The renderer accepts only the exact fixed copy, or its own deterministic
card text followed by that exact copy. Prefixes, suffixes, duplicate analysis,
goal-aware/partial-card companions and arbitrary prose are discarded. The
introduction stays in the single existing card/outbox effect and deterministic
text fallback, not another send or an expanded general companion facility.

The outbox writes one idempotent canonical Context note only after successful
send evidence. Attachment, staging and attempts do not write a delivered marker.
Definitive card-to-text fallback retains the frozen copy; confirmation failures
use existing confirmation retry without sending again. Replaying an existing
intent preserves its exact semantic message and delivery identity rather than
rewriting it after the memory note appears. Failed or ambiguous delivery does
not assert a successful invitation. Provider acceptance is not proof of reading.

**Bounded tradeoff:** this uses existing memory and delivery evidence, without a
new reservation store, workflow or history scan on every reply. Two independent
turns can choose the invitation before either reaches sent confirmation; visible
pending evidence asks the model to defer, but it is not an atomic member-wide
reservation. Once the canonical sent note exists, later turns suppress the copy.
If that note is deleted or confirmation recovery cannot persist it, a later offer
may recur. Do not claim strict globally exactly-once invitation delivery or mark
pending copy delivered to hide this window. Existing outbox dedupe still prevents
retries of one intent from creating a second send.

## Channel presentation, privacy and skew

Text, Telegram Rich Message, and the Web static image share totals-only meaning.
Telegram omits the Daily goals section and includes date, estimated/logged-so-far
coverage and the fixed introduction when selected. The production `/design`
nutrition study includes a synthetic lentil-lunch totals-only card beside the
existing historical goal-aware specimen at desktop and narrow widths.

Swift source is not in this repository snapshot and is not changed. V2 nullable
wire decoding alone would not remove a shipping native goal ring or prove its
presentation. Totals-only therefore sends Linq `interactive:false`, using the
owned static image/caption/subcaption even when the app is installed. Other
cards retain the existing interactive setting. Linq documents this installed-app
static behavior at https://docs.linqapp.com/channel/imessage/guides/messaging/imessage-apps/ .
Actual provider composition, image failure, VoiceOver and handset rendering still
require release proof; an HTTP acceptance fixture is not that proof.

The wire version, bounded identity-free envelope, queryless image path,
no-store/no-index/no-log image-route policy, private audience checks, value-free
notification fallback, capability timeout and definitive-versus-ambiguous send
recovery rules are unchanged. No new dependency, store, scheduler, public/group
sharing or production data is introduced.

Deploy the new renderer and adapters before enabling new authoring. Old authoring
validators reject null goals and old renderers may show target placeholders, so
server-version skew is not product-compatible despite wire compatibility. Drain
old producers; keep the updated static renderer available for sent URLs. Rollback
must preserve V2 readers and this static presentation for already-sent cards.

## Verification ownership

Deterministic suites cover fresh all-null/all-five authoring, legacy replay,
canonical target authority, fixed companion validation, text/Telegram/static
rendering, private audience and media gates, sent-memory suppression, and outbox
failure/confirmation/fallback recovery. Focused real-Codex journeys use production
instructions and synthetic canonical vaults. Select one exact journey name with
`pnpm test:assistant:live -- --test "<exact journey name>"`.

The execution plan records actual checks and unavailable external proof. Before
rollout, verify the received Linq and Telegram cards, including installed-app
static behavior, image failure, date/coverage labels and accessibility.
