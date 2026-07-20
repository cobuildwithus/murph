# Enable Scheduled Consented-Answer Actions

Status: active
Created: 2026-07-20
Updated: 2026-07-20

## Goal

- Let a scheduled group automation continue from reviewed private answers through the existing normal group notification/action path instead of an isolated exact-skip turn.
- Preserve the private-vault boundary: the downstream group turn receives only the reviewed result and never receives personal workspace access.

## Success criteria

- Scheduled consented-answer completions recover and revalidate the canonical automation's current group route, then reuse the ordinary scheduled notification turn and its existing delivery/tool controls.
- The blanket internal-turn bans on messaging, connected apps, calls, and follow-up actions are removed; each existing capability still enforces its own authority contract.
- `cannot_answer` completions are normalized to `answer: null` before durable completion so unreviewed candidate text cannot reach the group runtime.
- No new queue, scheduler, route store, side-effect service, or persisted lifecycle is introduced.
- Focused tests, diff coverage, exact-head CI, and ReviewGPT pass.

## Scope

- Scheduled `consented_member` completion handling, normal notification routing/tool composition, the result normalization boundary, focused tests, and matching durable docs/prompts.
- Current-main reconciliation needed to make PR #750 mergeable while preserving unrelated main behavior.

## Decisions

- Reuse the canonical automation record and ordinary scheduled notification path as the sole route and side-effect authority.
- Keep the personal candidate and outgoing reviewer one-shot, read-only, and unable to access delivery or the group turn's tools.
- Treat reviewed answer bytes as untrusted data in the downstream prompt; disclosure consent authorizes the answer's information, not instructions embedded in it.
- Do not broaden any individual side-effect tool beyond its existing authority contract unless direct proof shows the normal scheduled group path still cannot satisfy the requested behavior.

## Tasks

1. Reconcile current `origin/main` and preserve current-main Assistant Ask reader behavior only on the legacy joined-group path.
2. Replace the scheduled internal exact-skip completion with the existing canonical scheduled group notification/action composition.
3. Normalize cannot-answer results before completion and add focused privacy regression proof.
4. Update product, security, protocol, prompt/tool-description, and deployment docs to match the new behavior.
5. Run focused verification, coverage-write, parent final review, exact-head CI, and ReviewGPT through a pass.

## Verification

- Pending.
