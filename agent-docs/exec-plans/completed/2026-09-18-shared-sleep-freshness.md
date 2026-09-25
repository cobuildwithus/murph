# Source-aware shared wearable freshness

Status: completed
Created: 2026-09-18
Updated: 2026-09-18

## Outcome and invariant

A mixed historical/current shared wearable read refreshes eligible missing dates,
reports gaps separately for each already shared wearable source, and never treats
unavailable historical evidence as established absence. Existing consent, bounded
member/connection fanout, foreground priority, and one refresh per call remain.

## Owners and evidence

Web owns consent and existing manual reconcile admission; hosted-execution owns
pure freshness derivation; assistant-runtime owns bounded rereads; assistant-engine
owns the model projection and reply instructions. Current code rejects an entire
mixed range, matches dates across unrelated sources, and infers historical absence
from a rolling snapshot. Focused synthetic regressions will prove each correction.
The requested-graph routing correction and live journey already exist on main.

## Design

Filter recoverable requirements at the existing Web and runtime owners. Derive
per-source gaps from public source tags already present in granted records, without
new request fields or stored state. Exclude manual and Murph sources from wearable
expectations; preserve unsourced legacy reads. Positive preceding history remains
usable for any date; an absence without that evidence is unknown for historical or
future dates. The check timestamp anchors current-day classification.

No projection-window or consent changes: the separate history expansion owns those.
No guessed provider/import repair: a specific absent source record requires canonical
or provider evidence. No new queues, schedulers, credentials, or dependencies.

## Product UX

Effort: Patch.
Reaches: mixed date ranges, two wearable sources, manual reports, unknown history,
revoked/pending grants, scheduled updates, and old/new Web/runtime combinations.
Proof: deterministic parser/model/Web/runtime regressions plus a production-derived
real-Codex journey reporting source-specific gaps without source substitution,
reconnection advice, invented sync completion, or an unrequested schedule change.
Disposition: Ready for the local implementation. The live journey also caught
missing participant attribution and an inappropriate timing offer for steps;
the existing group instructions now explicitly cover both cases. Current sleep
recovery and requested graph generation retain their verified behavior.

## Failure and deployment

The existing wire shape and refresh statuses remain unchanged. Old/new peers remain
readable; full corrected behavior requires both Web and runner updates. No migration
or state rollback floor. Historical-only missing reads remain immediate/unavailable;
failed refresh admission preserves available records and does not claim completion.

## Tasks

1. Implement pure source-aware gap and date eligibility derivation.
2. Apply eligibility to Web admission and runtime wait, update model guidance.
3. Add focused regressions and real assistant evidence; verify existing graph proof.
4. Update owner docs/changelog, run typechecks and complexity review, scoped commit.

## Verification

Passed focused Vitest files (185 deterministic tests):

- hosted-execution: `test/group-shared-freshness.test.ts` (25).
- Web: `test/hosted-group-shared-freshness.test.ts` (14), changelog tests (10).
- assistant-runtime: `test/hosted-runtime-group-freshness.test.ts` (14).
- assistant-engine: `test/assistant-codex-group-tool.test.ts` (108) and
  `test/system-prompt.dynamic-context.test.ts` (14).

Passed `pnpm --dir <package> typecheck` for all four changed owners and
`pnpm --dir packages/hosted-execution build`. The final assistant instruction
edits were followed by the prompt tests and assistant-engine typecheck.

Passed three separate `pnpm test:assistant:live -- --test <exact-name>` journeys:

- Selected-source gaps: one shared read, correct named participant and source,
  available value and absent dates, no substituted source or schedule offer.
- Requested group trend graph: generation invoked and completion attached media.
- Scheduled current-sleep missing case: named available/missing participants,
  actual local check time, appropriate optional timing offer, no schedule mutation.

Full first provider-input capture reused the credential-free wearable contract
test with identical fixtures at base and candidate. Direct input stayed at
159,561 UTF-8 bytes; group input grew from 153,180 to 153,851 (+671, +0.438%).
Tool registrations were unchanged. Capture includes the complete decoded request
except `prompt_cache_key`; exact Terra token counts are unavailable because no
target tokenizer is configured. Synthetic provider usage was not substituted.

Parent review covered every authored diff, privacy, consent boundaries, same-source
history, mixed dates, old-Web requested status, and failure behavior. The complexity
guard passes without added debt; unrelated existing hotspots remain unchanged.
No new database queries, provider calls, retry loops, or concurrency budgets were
introduced. Existing admission remains capped at 32 connections/four concurrent
wakes with the existing idempotency bucket; existing bounded rereads now end when
eligible gaps resolve even if historical gaps remain.

Local implementation and commit are the requested delivery scope. No PR was
requested or opened; PR CI and the applicable final ReviewGPT remain release-work
gates. No production repair or deployment is claimed. A specific absent provider
record remains unproven without canonical/provider evidence; this change corrects
shared freshness and reporting, and cannot manufacture that record.
Completed: 2026-09-18
