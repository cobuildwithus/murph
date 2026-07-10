# Restore Linq typing after progress updates

Status: active
Created: 2026-07-10
Updated: 2026-07-10

## Goal

- Keep Murph's Linq/iMessage typing indicator visible after a model-authored
  progress update by restarting it after Linq's asynchronous message auto-clear
  window without blocking the foreground assistant turn.
- Add an opt-in, secret-safe live Linq E2E that exercises the production ordering
  against a real one-to-one chat and fails unless the recipient-visible indicator
  returns after the progress message.

## Success criteria

- Progress delivery remains best-effort and never delays the model turn or final
  reply on typing-indicator work.
- Linq schedules one bounded post-message typing restart after its message-send
  settle window; ordinary 45-second refresh cadence, five-minute cap, cleanup,
  serialization, and non-Linq behavior remain intact.
- Deterministic tests reproduce Linq's send/auto-clear ordering and prove stop and
  overlapping-refresh behavior.
- The opt-in live E2E uses only env-provided credentials/identifiers, emits only
  redacted metadata, sends only after explicit confirmation, and records a
  positive recipient observation after the progress update.
- Required scoped verification, security/privacy review, coverage-write audit,
  parent final review, PR CI, and the PR ReviewGPT loop all complete with no
  unresolved accepted findings.

## Scope

- In scope:
  - `packages/assistant-engine` typing activity semantics and progress integration.
  - Focused assistant-engine regression coverage.
  - The existing secret-safe live Linq typing repro/E2E harness and its tests.
  - Verification documentation whose current live-Linq coverage claim changes.
- Out of scope:
  - New persisted state, queues, webhook-to-runtime coordination, or message-status
    polling.
  - Group-chat typing support, which Linq does not provide.
  - Changes to progress-update copy, frequency, final delivery, or provider
    credentials.

## Constraints

- Technical constraints:
  - Linq message sends return asynchronously and Linq clears typing when the
    message is actually sent; `204` from typing is acceptance, not device proof.
  - The restart must be cancelable by normal typing teardown so it cannot appear
    after the final reply.
  - Preserve existing package ownership and avoid a new provider lifecycle owner.
- Product/process constraints:
  - Preserve progress updates and the foreground reply critical path.
  - Never log or commit raw chat/message ids, phone numbers, tokens, message text,
    local account identifiers, or home paths.
  - Work only in the isolated task worktree and preserve all unrelated active
    lanes.

## Risks and mitigations

1. Risk: a fixed settle delay is too short or adds unnecessary provider traffic.
   Mitigation: keep one provider-specific bounded restart, calibrate it with the
   live E2E, and retain the existing low-volume cadence afterward.
2. Risk: a delayed restart races final typing teardown.
   Mitigation: schedule it through the existing activity-session timer/abort owner
   and add fake-timer cancellation coverage.
3. Risk: live proof leaks identifiers or sends unexpectedly.
   Mitigation: keep all sensitive inputs in env, require explicit live/send flags,
   redact output, and require a direct-chat recipient observation.

## Tasks

1. Trace the current deployed progress-send and typing activity paths plus Linq's
   current documented semantics.
2. Add the smallest post-message restart semantic at the existing channel activity
   owner and wire progress delivery to it.
3. Add deterministic ordering/cancellation/serialization tests.
4. Extend the live Linq harness into an assertion-bearing progress-update E2E and
   execute it against the configured direct test chat.
5. Run scoped verification, required audits, and parent final review; resolve all
   accepted findings.
6. Close the plan with `scripts/finish-task`, push, open the PR, then run CI and the
   PR ReviewGPT loop to zero accepted findings.

## Decisions

- Reuse the existing channel activity session as the single timer/cleanup owner;
  do not add webhook state or a second scheduler.
- Keep the live proof opt-in and human-observed because Linq exposes no API that
  proves recipient-device rendering; HTTP `204` alone is explicitly insufficient.

## Verification

- Passed focused assistant-engine Vitest: 3 files, 159 tests.
- Passed focused live-harness Vitest: 1 file, 9 tests.
- Passed assistant-engine typecheck and `git diff --check`.
- Passed exact `pnpm test:diff` coverage, including all affected package checks and
  Cloudflare verification (93 files, 1,702 tests).
- Security/privacy review and coverage-write audit found no accepted findings or
  missing deterministic proof.
- Parent final review found and fixed one stale-scheduler race; the added test
  proves an older in-flight cadence refresh cannot replace the newer one-second
  post-message restart. Follow-up coverage review found no remaining proof gap.
- Remaining: credentialed recipient-visible Linq E2E, final privacy review, PR CI,
  and ReviewGPT.
