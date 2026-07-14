# Hosted Fresh Input Continuation Repair

## Goal

Ensure a mailbox batch promotes only reply-eligible conversation inputs into the current foreground turn, and keep stale personal reminder targets recoverable when their former chat is now owned by a group route.

## Evidence

- Conversation import currently returns an assistant input ID even when auto-reply eligibility is false.
- The mailbox loop treats every returned conversation input ID as fresh foreground work.
- Foreground selection intentionally chooses one causal input, so an earlier unavailable input can occupy the only slot while a later replyable input remains pending without a continuation wake.
- A route-transition proof is durably queued even when the assistant is unconfigured, but incorrectly classifying it as fresh skips the initial proof-repair path.
- A former personal home chat can later become a group route; current authority rejects that stale target before applying the explicitly requested personal-home fallback.
- The callback test for stale-home recovery fabricates private phone inputs that the real authority service rejects, so it falsely claims a second missing-chat recovery.

## Constraints

- Keep `6e1759b3` foreground-only selection and `a38e9553` system-note classification intact.
- Preserve every staged assistant input event as durable conversation context.
- Preserve route-transition proof enqueueing and bounded repair.
- Never authorize or deliver to a stale group target; resolve only a distinct current personal home and revalidate it under the existing lock.
- Add no new queue, state owner, scheduler, retry loop, dependency, or deployment action.
- Do not deploy or merge this PR.

## Plan

1. Stop exposing non-reply-eligible staged conversation inputs as fresh foreground IDs.
2. Define assistant-phase freshness from those eligible foreground IDs rather than the raw conversation import count.
3. Add focused import-loop coverage for a disabled input followed by a replyable input.
4. Add proof that an unconfigured route-transition item remains durable without being promoted as foreground work.
5. Allow a qualifying stale personal-home request to resolve a distinct current home after the stale chat becomes group-owned, retaining final-target revalidation.
6. Replace the production-invalid callback recovery test with the real null-recipient reroute shape.
7. Run scoped verification, required security/privacy and coverage audits, parent review, then open a PR and start ReviewGPT without deploying.

## Verification

- Focused mailbox conversation import and mailbox import tests.
- Focused maintenance/turn selection tests if the boundary proof requires them.
- Focused web Linq authority and runtime callback tests.
- Truthful `pnpm test:diff` for touched assistant-runtime paths.
- `git diff --check`, mergeability proof, PR CI, and ReviewGPT on the exact pushed head.

## State

Active.
Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
