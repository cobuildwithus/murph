# Recover unsupported clinical extraction dates

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome

Automatically recover missing or contradictory extracted event dates before
freezing proposals, without losing valid records or adding member steps.

## Scope and decisions

- Share the canonical date consistency check with extraction.
- One read-only correction turn per affected family, within the existing page
  deadline and cancellation boundary; no new queue or durable state owner.
- Corrections may change date fields only, at host-selected invalid indices.
- Preserve supported siblings and original facts if correction fails. Retain
  unresolved holds; never invent a date or infer a secondary event's date.
- Keep source attestation, canonical admission and cache replay authoritative.
- Account for correction separately using the existing review usage stage.
- No historical vault repair, deployment or PR in this task.

## Product UX

Reaches: members importing historical, same-day, partially supported or ambiguous
records; recovery under provider failure and cancellation.
Proof: focused extraction and runtime tests, canonical admission regressions,
package typechecks and one real-model correction journey. Confirm no extra user
prompt, duplicated fact, unrelated change or loss of a valid sibling.
Verdict: Ready. Recovery is automatic and date-only; no member-facing prompt or
new step. Unresolved dates preserve the source and do not discard valid siblings.

## Tasks

1. Share date checks, carry vault timezone, add one bounded date-only correction.
2. Prove repair, failed repair, cancellation, confinement, authority and usage.
3. Review the live recovery, update contract/changelog, run scoped checks, commit.

## Verification

- Passed 159 focused tests: clinical-records date/schema (33), canonical
  enrichment/parent/labs (61), extraction/recovery (21), hosted runner/flow (32),
  checkpoint cancellation (2), and changelog rendering (10).
- Passed typechecks for clinical-records, vault-usecases, assistant-engine and
  assistant-runtime. Updated a synthetic checkpoint fixture for required timezone.
- Regenerated ignored changelog fragments before the rendering check; initial
  direct run saw stale generated copy.
- Live command: `pnpm test:assistant:live -- --test "clinical extraction live
  recovers unsupported dates without rewriting valid siblings"` with the already
  selected local subscription home, model `gpt-5.6-terra`.
- Live result: one synthetic initial proposal and one actual correction provider
  call; repaired contradictory historical and missing same-day provenance,
  preserved the valid sibling, returned three records with literal date evidence,
  and left source bytes and canonical writes unchanged. Actual call used 7,264
  tokens. Ready after reviewing the emitted synthetic result.
- Parent review: same bound source and read-only permissions on both calls;
  member timezone shared with canonical admission; correction can touch only
  invalid indices and date fields. Malformed, duplicate, unsupported and failed
  corrections preserve valid output. Parent cancellation/authority loss propagate;
  correction timeout returns the partial extraction. Usage stages do not collide.
- Complexity guard passed: six changed source files across the task branch,
  no functions above 20. Docs drift and whitespace checks passed.
- No production mutation, deployment, pushed branch or PR in this task.
Completed: 2026-09-21
