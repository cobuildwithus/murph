# Hosted image pending-state honesty

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Keep hosted image generation non-blocking while ensuring Murph accurately tells a user that the original image is still pending and does not start an unnecessary replacement.

## Success criteria

- The initial hosted image-tool result requires an honest separate-delivery acknowledgement.
- An intervening foreground turn receives trusted invocation-local image-pending context.
- A follow-up question about the unresolved image cannot start a redundant provider call.
- The original completion still wakes the assistant and produces exactly one image-bearing delivery.
- Focused tests, canonical verification, required product/specialist review, final ReviewGPT, and CI pass.

## Scope

- In scope: hosted image controller state, assistant hosted-tool context, image-tool response behavior, and focused assistant-engine/runtime tests.
- Out of scope: durable image jobs, database schema, Cloudflare Images APIs, the existing blocked hosted-local image E2E lane, and unrelated latency-alert routing.

## Constraints

- Preserve foreground reply priority and the existing trusted completion-input path.
- Keep pending state invocation-local; add no queue, scheduler, table, or fallback owner.
- Do not block a genuinely new image request in a different conversation.
- Failure or restart language requires trusted failure evidence.

## Tasks

1. Reproduce the cross-turn visibility and duplicate-operation gaps in focused tests.
2. Implement the smallest scoped pending-state projection and duplicate guard.
3. Verify the original completion and failure paths remain intact.
4. Run product review, preliminary specialist ReviewGPT, parent final review, canonical verification, final ReviewGPT, and CI.
5. Close the plan with a scoped final commit and push the reviewed PR head.

## Decisions

- Reuse the live hosted image controller as the only pending-state owner.
- Scope duplicate prevention to the current assistant session and retain it
  through `pending` and `queued` states until the exact completion input has
  complete terminal reply evidence.
- Limit each live session to one image at a time; a concurrent distinct request
  is explicitly not started or queued.
- Distinguish provider work that is still `pending` from a completed result that
  is `queued` for trusted assistant handling; never borrow that status for an
  older replayed operation ID.
- Treat terminal-evidence reads as fail-closed cleanup: retain queued state on a
  transient read error, retry retained completion IDs before the next phase,
  and release exact proven completions from the phase `finally` path.
- Trust image-completion contents only when the durable input has the exact
  system-lane schema and deterministic completion identity. Parse that envelope
  into a typed projection, remove its raw body from ordinary message text, and
  expose the normalized result only through trusted turn context.
- Avoid the blocked Cloudflare image E2E file and prove the exact exchange at the engine/runtime owner boundaries.

## Verification

- ReviewGPT owned the implementation re-review and returned a seven-file
  remediation patch with SHA-256
  `c10c973088530f860370b05b26aeb471e9d89e0179b6b3f3e08f2951bdb41d01`.
  The checksum matched, the patch applied cleanly, and its focused changes are
  included in this head.
- After the ReviewGPT remediation, focused engine tests passed 67/67, focused
  runtime/workspace tests passed 241/241, and both owning package typechecks
  passed.
- Preliminary completion-specialists ReviewGPT found and resolved a prompt
  provenance gap plus missing live-runtime cleanup coverage. Its coverage patch
  checksum matched
  `4248b748b7db4f30d7e3913a7f8c745f9f67bf7d555f5685af750d71a4f7ce25`;
  the parent narrowed one global mock-call assertion after the executable suite
  proved unrelated terminal-evidence checks are expected.
- After preliminary remediation, focused engine tests passed 104/104, focused
  runtime/workspace tests passed 241/241, and both owning package typechecks
  passed.
- Parent final review aligned the queued duplicate-tool fallback with the same
  trusted-turn-context provenance marker; its focused test passed 7/7 and the
  engine typecheck remained green.
- The exact-head `pnpm test:diff <changed paths>` passed repository guards,
  affected and reverse-dependent typechecks, and all 6,028 affected package
  tests. Per the ten-minute local-admission rule, it was stopped while waiting
  for the exclusive Cloudflare slot after the required Crabbox fallback had
  already failed before Testbox creation: the installed provider rejects the
  dispatcher-required `--stop-after` option. Cloudflare verification remains
  for PR CI or a later available local slot.
- Before the ReviewGPT remediation, the same canonical command passed all 6,028
  package tests and 2,015 Cloudflare Node/Workers tests. The production-faithful
  hosted-local image scenario also passed all 3 cases on that head.
- After the remediation, the hosted-local retry was blocked during harness
  startup by a runner shell-smoke timeout (`vault-cli-llms`, exit 124), so all
  3 image assertions were skipped rather than failed.
- Required product-experience review findings were fixed and the final rerun
  returned `PASS` with no findings.
