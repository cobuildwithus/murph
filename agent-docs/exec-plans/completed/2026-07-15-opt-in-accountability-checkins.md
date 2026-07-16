# Opt-in accountability check-ins

## Goal

Teach Murph to distinguish a simple reminder from an explicitly authorized
accountability check-in, and require every check-in to reconcile current
completion evidence before it asks whether the behavior happened.

## Scope

- Extend the existing `behavior-followthrough` prompt owner.
- Keep the assembled scheduled-notification and experiment-support bridges
  aligned with the skill-owned occurrence roles.
- Keep simple reminders cue-only by default.
- Require explicit agreement before adding a later accountability check-in.
- Define completion reconciliation for current conversation, canonical records,
  and relevant connected data.
- Add focused prompt-contract coverage in the existing assistant skill test.
- Add assembled scheduled-prompt and experiment-bridge regression coverage.

## Invariants

- Missing or stale evidence is unknown, not proof that the user missed the
  behavior.
- Confirmed completion suppresses the check-in.
- An outcome the user already reported suppresses the check-in.
- A plan, reminder, or statement of intent is not completion evidence.
- One authorized check-in does not become an open-ended follow-up chain.
- Scheduled turns keep their existing `skip` or `send_message` authority and do
  not mutate automation lifecycle.
- No new persistence, scheduler abstraction, or behavior state machine.

## Verification

- Run the focused assistant skill-asset test.
- Run the repository-selected diff verification for the touched owner.
- Run the required prompt-review pass and parent final review.
- Open a PR, run CI, and complete the explicitly requested ReviewGPT loop.

## Outcome

- Simple reminder requests remain cue-only by default.
- An accountability check-in is a separately authorized automation occurrence.
- Scheduled check-ins reconcile conversation and matching canonical or
  connected evidence for the action window before choosing `skip` or one
  neutral question.
- Complete and already-reported outcomes skip; unavailable, delayed, stale, or
  missing evidence remains unknown.
- No persistence, schema, scheduler, or lifecycle owner was added.

## Local proof

- Focused prompt-contract tests: 100 passed.
- Final assistant-engine owner suite: 2,255 passed and 5 skipped.
- Diff-aware verification completed green before the final prompt-only
  clarification. Final reruns kept all guards and typechecks green but each hit
  a different unrelated intermittent reverse-dependent test; both exact files
  passed immediately when rerun in isolation.
- Fresh prompt review: pass with zero actionable findings.
- Parent scope, privacy, stale-string, and diff checks: clean.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
