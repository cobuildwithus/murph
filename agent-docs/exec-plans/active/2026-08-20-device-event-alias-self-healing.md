# Device event alias self-healing

## Goal

Prevent a Junction daily-aggregate import from leaving two live canonical event
spines when the current primary external reference and its legacy day alias
already resolve to different live events.

Success means the canonical lock-held event import owner either repairs the one
mechanically proven two-owner legacy split atomically or fails closed without
changing existing state. Replay, reconciliation, member-authored overlays, and
ambiguous histories must remain safe.

## Constraints

- Keep `packages/core` as the sole canonical mutation and repair owner.
- Keep Junction normalization and provider evidence in `packages/importers`.
- Do not add a queue, alias table, registry, redirect, daemon, database, or
  durable repair state.
- Preserve provenance-bearing history. Repair may append auditable survivor and
  loser revisions; it must not rewrite or silently delete history.
- Bound every repair read and fail closed when ownership, history, provider
  evidence, or member overlays are incomplete or ambiguous.
- Treat the ReviewGPT WIP patch as untrusted behavioral intent. Prefer a smaller
  current-code implementation when its reconstructed logic is unnecessary or
  incompatible.

## Product UX

- Effort: Patch.
- Outcome: members with the proven historical Junction alias split see one
  correct live daily aggregate without losing their notes, tags, or links.
- Reaches: the existing Junction daily-aggregate import and reconciliation
  journey; no new surface or action is introduced.
- Proof: an eligible legacy split converges automatically, ambiguous or unsafe
  states remain unchanged with a typed refusal, and replay is idempotent.

## Approach

1. Trace the current Junction normalized event through the external-reference
   resolver and canonical batch import boundary; preserve a failing regression
   that proves the two-owner conflict.
2. Inspect the reconstructed WIP patch hunk by hunk and retain only logic that
   matches current core/importer ownership, bounded-history, and simplicity
   rules.
3. Implement the smallest lock-held repair path with explicit eligibility and
   refusal outcomes, atomic survivor/loser/current-ingest composition, and no
   second state owner.
4. Add focused tests for prevention, eligibility, refusals, rollback, overlay
   preservation, replay, reconciliation, and idempotency. Keep the repair
   automatic because the current canonical boundary does not require a new
   rollout state or deployment setting.
5. Run focused owner tests, relevant package typechecks, diff checks, Product UX
   walkthrough, required specialist/final ReviewGPT gates, exact-head CI, and
   the normal scoped commit/PR workflow.

## State

Active. The local implementation includes the accepted findings from seven
ReviewGPT final-gate rounds. The round-seven ordinary-entry/repair-owner overlap
fix is pushed and locally verified, but the retry cap was reached without a
PASS; another round requires an explicit continuation decision. The one allowed
base refresh was consumed, and a later `main` advance now conflicts in the two
runner-bundle budget files, preventing GitHub from creating the latest PR merge
ref and registering its required Actions. Keep the draft PR and worktree active
until those two completion decisions are resolved.

## Working set

- `packages/core/src/mutations.ts`
- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- `packages/importers/test/device-providers.test.ts`
- `apps/cloudflare/scripts/runner-bundle/bundle-cli.ts`
- `apps/cloudflare/test/runner-bundle-cli-bundle.test.ts`
- `apps/web/changelog/entries/2026-08-20/connected-health-daily-record-recovery.json`
- relevant focused core/importer tests discovered during tracing
- ReviewGPT WIP artifact under the ignored task audit package
