# murph-dials

Status: completed
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Let a member ask Murph for its Humor, Push, or Detail score, set an exact
  integer from 0 through 10 in conversation, receive a truthful same-reply
  acknowledgement that demonstrates the new setting when safe, and have the
  setting persist across later private turns and runtime restarts.

## Success criteria

- Canonical typed preferences own sparse per-member Humor, Push, and Detail
  overrides; no second state owner or free-form prompt text is introduced.
- Agent-visible `assistant style show|set|reset` commands read and mutate those
  preferences through the existing core-owned locked and audited write path.
- Private-turn prompt construction applies effective settings with explicit
  safety, truth, authorization, and current-turn precedence.
- A successful set result governs the acknowledgement in that same turn; failed
  or no-op writes are described truthfully.
- Existing tone, voice, workout-unit, and wearable preferences remain intact.
- Focused and full required verification, specialist completion audits, a clean
  pushed PR head, green PR CI, and a valid ReviewGPT `REVIEW_COMPLETE` round with
  zero accepted findings all pass.

## Scope

- In scope: shared contracts/default resolution, canonical core mutation,
  vault-usecase and CLI surfaces, private-turn preference resolution and prompt
  guidance, generated CLI/schema artifacts, focused regression coverage, and
  durable contract/product documentation.
- Out of scope: `apps/web` settings UI or Postgres projection, onboarding,
  group-scoped personality, automation cadence/send decisions, arbitrary prompt
  text, adaptive inference, relative adjustment commands, and future Directness
  or Initiative dials.

## Constraints

- Technical constraints: extend `bank/preferences.json` and the existing core
  preference owner; keep sparse strict integer overrides; preserve no-op,
  locking, audit, and partial-merge behavior; do not add a service, table,
  queue, generic recursive patcher, or runtime state.
- Product/process constraints: Humor and Push alter expression only; protected
  health, grief, crisis, privacy, auth, billing, consent, and real-action
  contexts override them; Push never becomes shame or coercion; private settings
  never control a group; keep the shared checkout untouched; use this isolated
  branch, scoped plan closure, PR, and full ReviewGPT loop.

## Risks and mitigations

1. Older strict preference readers reject the optional personality key after a
   new writer persists it.
   Mitigation: keep the additive v1 schema explicit, document a reader-first
   rollout/rollback floor, and avoid compatibility machinery for an unshipped
   producer.
2. The setting changes after the current turn's prompt is already assembled.
   Mitigation: make the successful command result authoritative for the final
   acknowledgement; subsequent turns use the normal canonical preference read.
3. High Humor or Push could weaken safety or imply real side effects.
   Mitigation: centralize fixed precedence in the prompt contract and add
   boundary/sensitive-context behavior tests without granting new authority.
4. Existing prompt/planning work may overlap these files.
   Mitigation: stay on current `origin/main`, keep changes narrow, rebase/merge
   only through ordinary Git history, and verify the final PR head against the
   current base.

## Tasks

1. Add failing contract/core/usecase/CLI tests for defaults, strict scores,
   sparse set/reset, no-op behavior, and unrelated-preference preservation.
2. Implement the smallest typed preference and command path through existing
   owners; regenerate checked-in schemas and CLI metadata.
3. Add prompt/planning behavior plus same-turn command guidance and focused
   tests for bands, precedence, and fresh-thread behavior.
4. Update the durable assistant-style, record-schema, and command-surface docs.
5. Run direct scenario proof, focused checks, full verification, required
   security/privacy and coverage audits, and the parent final diff review.
6. Close this plan through `scripts/finish-task`, push, open the PR, complete
   ReviewGPT rounds, resolve accepted findings minimally, and prove final CI and
   mergeability.

## Decisions

- Launch three numeric dials: Humor default 3, Push default 3, Detail default 5.
- Persist only explicit overrides under `assistant.personality`; setting a
  default explicitly records intent, while reset removes that override.
- Use one generic `assistant style` CLI group rather than one command per dial.
- Apply the dials only to private interactive conversation in v1; existing
  group and automated-notification policy remains authoritative and unchanged.
- Keep conversation as the initial settings surface; web projection/UI is a
  separate convergence task rather than a second source of truth in this PR.

## Verification

- Commands to run: focused package tests during development; generated artifact
  checks; a built CLI show/set/reset scenario against a temporary vault;
  `pnpm verify:acceptance`; `pnpm test:smoke`; `git diff --check`; required
  security/privacy and coverage audit passes; PR checks; ReviewGPT PR-head
  preflight and rounds through `REVIEW_COMPLETE`.
- Expected outcomes: every command is green on the final pushed head, the direct
  scenario proves canonical persistence and reset, no unresolved accepted audit
  finding remains, the PR merges cleanly with current `main`, and ReviewGPT plus
  CI cover the same final head.

## Completion evidence

- Direct built-CLI proof covered default display, exact set, no-op set,
  canonical persistence, validation failure, individual reset, and reset-all
  against a disposable vault.
- Focused contract, core, vault-usecase, assistant CLI, prompt/planning, schema,
  smoke-manifest, and typed agent-input tests passed. The final model-behavior
  lane passed 55 tests and kept the stable prompt within its size budget.
- The affected package, app, hosted-local, built-package boundary, and smoke
  lanes passed; smoke covered 204 scenarios.
- Final CLI coverage passed 114 files and 1,047 tests with all configured
  thresholds satisfied. Final repository typecheck and architecture guards
  passed across the workspace.
- Generated contract and CLI schema artifacts were regenerated under the
  workspace artifact lock. Doc drift, doc gardening, `git diff --check`, and
  the redacted identifier scan passed.
- Required security/privacy and coverage audits reported no medium-or-higher
  findings or missing coverage. The final independent simplicity review found
  and then verified fixes for the durable-doc catalog entries and Humor-only
  acknowledgement-joke boundary; its updated-diff result had no findings.
Completed: 2026-07-10
