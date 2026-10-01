# Generated-Image Continuation Continuity

Status: completed
Created: 2026-08-27
Updated: 2026-08-28

## Goal

Keep a trusted generated-image completion on the ordinary warm Codex process
identity so a later approval can use the conversation already stored in the
provider thread, while preserving the existing exact external-effect boundary.

## Root-Cause Evidence

- Production diagnostics kept the affected turns in one assistant session and
  one Codex thread.
- The generated-image completion changed process-launch configuration and
  restarted the warm Codex App Server with
  `previous-launch-identity-change`; the later approval repeated that restart.
- Murph disabled shell, web, apps, memories, steering, provider fetches,
  environments, and ordinary workspace permissions only because the trusted
  completion was asynchronous. The exact generated-image and authorizing-input
  restriction already owned the irreversible effect independently.
- A production-boundary regression failed before the fix because the completion
  received `read-only` / `never` provider settings instead of the ordinary
  conversation settings.

## Affected People And Journeys

1. A person supplies complete task details, receives a generated image later,
   and approves the next step without repeating those recent details.
2. A person gives new input while image generation runs; ordinary steering and
   conversation capabilities remain available when the result returns.
3. A generated image could authorize an external action; only the exact trusted
   media and authorizing input may cross that effect boundary.

## Tasks

1. Replace the earlier transcript-replay candidate with a focused regression at
   the production Codex-turn boundary.
2. Delete the generated-image-completion branch that changes process-wide Codex
   capabilities and launch identity.
3. Preserve the existing hosted image-completion effect restriction and its
   exact media/input binding.
4. Add one synthetic real-Codex journey covering details, asynchronous image
   completion, and a terse approval on the same provider thread.
5. Record the general architecture principle in `AGENTS.md` and the
   member-visible outcome in the changelog.
6. Run focused tests, typecheck, ReviewGPT gates, exact-head CI, and merge proof.

## Constraints

- Never store or reproduce production transcript text, identifiers, names, or
  addresses in source, tests, documentation, reviews, or release notes.
- Add no state owner, transcript replay path, workflow, queue, or effect
  authority.
- Keep output-only, scheduled read-only, maintenance, and group-email
  restrictions unchanged.
- Do not weaken exact generated-media, authorizing-input, recipient, or provider
  effect checks.

## Verification

- Before the production edit, the focused boundary regression failed because
  the trusted completion changed to `read-only` / `never`.
- After deleting the special case, the same regression passed and retained the
  ordinary Codex config, steering, workspace permissions, fetches, and dynamic
  tools together with the exact hosted effect restriction.
- Assistant Engine typecheck passed.
- The hosted image-completion, effect-authority, and Codex-turn-planning suites
  passed: 105 tests across 3 files.
- The focused changelog suite passed: 9 tests.
- Product UX walkthrough: a person can provide the details once, receive the
  asynchronous preview, and approve it on the same ordinary conversation path;
  the exact-media and exact-authorizing-input boundary still owns the send.
- The focused real-Codex journey is present but its default authenticated run
  and one permitted alternate authenticated run both stopped at the account
  usage limit before any provider action. Live verification is therefore Hold,
  not a claimed pass.
- ReviewGPT, exact-head CI, merge proof, and deployment verification remain
  pending.
Completed: 2026-08-28
