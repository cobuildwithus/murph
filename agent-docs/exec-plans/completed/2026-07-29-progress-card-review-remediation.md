# Progress card delivery review remediation

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Close the two accepted final-review gaps in private-image recovery without
  adding state, queues, or a second delivery owner.
- Ensure a failed replacement cannot leak stale response media and that an
  unresolved visible-reply obligation survives later steer contexts.

## Success criteria

- Every failed `attach_response_media` attempt clears the current media batch
  and requires a visible reply.
- A later ordinary `finish_without_reply` cannot override an earlier unresolved
  `reply-required` action, while the existing same-context vault-file approval
  completion remains available.
- Focused regressions fail before the correction and pass afterward.
- Canonical verification and acceptance pass, and the resulting exact
  remediation head is ready for the PR's ReviewGPT, CI, merge, and deployment
  gates.

## Scope

- Dynamic response-media failure handling.
- The existing final-action patch owner across steer contexts.
- Focused assistant runtime and hosted provider-delivery coverage.
- Directly affected owner documentation.

## Constraints

- Preserve private-byte verification and the current successful media path.
- Preserve intentional no-reply when no visible-reply obligation exists.
- Reuse the existing response-media and final-action patch owners; introduce no
  new lifecycle state.

## Evidence

- Final ReviewGPT showed that a failed replacement currently leaves an earlier
  media batch intact.
- Schema-invalid attachment arguments currently neither clear media nor require
  a visible response.
- A later steer context can currently submit an ordinary no-reply action after
  an earlier context required a reply.

## Tasks

1. [x] Add focused failing regressions for stale media, malformed attachment
   arguments, and cross-context no-reply suppression.
2. [x] Correct the existing media and final-action patch owners.
3. [x] Extend hosted provider proof and update owner documentation.
4. [x] Run focused and canonical verification.
5. [x] Complete the parent scope/shape review and prepare the exact remediation
   head for the PR's remaining ReviewGPT and delivery gates.

## Decisions

- Use the existing empty `replace` media patch to clear stale media on both
  schema-invalid and unreadable replacements.
- Keep `reply-required` as the sole recovery obligation. No new lifecycle state
  is needed: ordinary no-reply eligibility now reads all requirements through
  the candidate context.
- Preserve the existing vault-file owner's same-context override, which closes
  an approved file send. It cannot override a requirement from an earlier
  context.
- Serialize schema-invalid response-media calls with the other media mutations
  so their clearing and final-action patches cannot race a following tool call.

## Verification

- Pre-fix focused proof reproduced stale media retention, the absent clearing
  patch, and malformed arguments that allowed the turn to stall.
- Focused assistant-engine suites passed 253/253; after adding an explicit
  same-context vault-file regression, the full assistant runtime suite passed
  228/228. The adjacent voice-memo dynamic-tool suite passed 20/20.
- Hosted-local image-media delivery E2E passed 3/3. The recovery case attached
  an earlier image, rejected an unavailable private replacement, delivered
  fallback text only, uploaded no attachment, and ended with no runtime or
  mailbox error.
- Canonical `pnpm test:diff` passed every affected package/app typecheck and
  suite, including assistant engine, assistant CLI/runtime/daemon, CLI, setup
  CLI, and Cloudflare Node/Workers verification.
- `pnpm verify:acceptance` passed all package coverage, web tests/lint/smoke and
  production build, Cloudflare verification, package boundaries, typechecks,
  and repository guards.
- The required product-experience review returned no findings and made no
  changes.
- ReviewGPT round 2 must retain first/previous reviewed head
  `6eb3ed88cbbdb9a736b0ff6ac931ddfd113ae25d`, then exact-head CI, merge,
  deployment proof, and worktree retirement complete the PR lane.
Completed: 2026-07-29
