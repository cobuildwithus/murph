# Collapse creative wake runtime

Status: completed
Created: 2026-07-29
Updated: 2026-07-29
Completed: 2026-07-29

## Goal

- Run detached creative wake turns on the existing resident Codex App Server
  instead of launching a feature-specific one-shot process, while preserving
  the exact song-only model surface and successful native Linq audio delivery.

## Success criteria

- Creative and ordinary assistant turns share one hosted Codex process.
- Native shell, browsing, apps, plugins, memory, and delegation remain disabled
  by thread-local configuration for the ephemeral creative thread.
- The existing application-owned public fetch completes a validated
  Linq-issued signed upload without a second provider-turn transport field.
- Focused runtime tests, assistant-engine typecheck, exact-head CI, product
  review, preliminary specialist review, and final ReviewGPT pass are green.

## Scope

- In scope: creative and detached output-only notification process reuse,
  per-thread capability confinement, media-transport simplification, focused
  tests, owning architecture/security contracts, and PR #1135.
- Out of scope: notification persistence, purchase fulfillment, retry policy,
  delivery/outbox ownership, other named-permission one-shot children, or a new
  Cloudflare service/process abstraction.

## Constraints

- Technical constraints: preserve fresh ephemeral threads, exact dynamic-tool
  projection, no native Internet capability, provider egress write fences,
  signed-upload validation, and ordinary conversation behavior.
- Product/process constraints: preserve the one-attempt optional creative
  notification and text fallback; do not replay the prior failed notification.

## Risks and mitigations

1. Risk: moving restrictions from process launch to thread creation could let a
   wake inherit ordinary native capabilities.
   Mitigation: send the complete deny configuration on every restricted thread
   and prove the exact provider/App Server request.
2. Risk: reusing the application public fetch could be mistaken for
   model-visible browsing.
   Mitigation: keep native browsing disabled in thread config and expose only
   `generate_song`; the fetch stays inside the application-owned tool closure.
3. Risk: warm-process reuse could persist the detached notification thread.
   Mitigation: require a fresh ephemeral thread with resume disabled.

## Tasks

1. Move restricted notification capability settings from launch arguments to
   thread-local App Server configuration.
2. Stop selecting a one-shot process for notification turns and mark their
   fresh threads ephemeral.
3. Delete the upload-only provider field and use the existing application
   public fetch inside the song tool.
4. Update focused regressions and durable architecture/security contracts.
5. Run local verification, required reviews, exact-head CI, and the PR gate.

## Decisions

- Retain one-shot processes only where a named OS permission profile or another
  demonstrated process boundary requires one.
- Treat `publicInternetFetch` as application-owned dynamic-tool transport; native
  Codex Internet capability is controlled independently by thread config.

## Verification

- Focused assistant-engine proof passed: 431 tests across notification
  planning/runtime, media generation, provider transport, and App Server
  lifecycle.
- After preliminary ReviewGPT identified a coverage-only gap, the complete
  thirteen-setting deny object was asserted at provider assembly and
  `thread/start`; the requested 304-test focused suite and assistant-engine
  typecheck passed.
- Direct runtime proof uses one App Server process for an ordinary turn and a
  restricted ephemeral turn, sends the complete deny config on the latter, and
  does not terminate the process.
- Direct media proof generates the song, creates the Linq attachment, and
  completes the validated signed `PUT` through the existing application public
  transport.
- Diff, privacy, and operative-document inspections passed. No
  `voiceMemoUploadFetch` reference or current notification one-shot claim
  remains.
- Product-experience review returned `NO FINDINGS`. Parent final review found no
  remaining correctness, scope, architecture, or proof issue.
- The final archived-plan commit is the candidate for exact-head GitHub Actions
  and the final ReviewGPT gate. A live post-deploy sponsorship remains the
  cross-runtime native-audio proof.
Completed: 2026-07-29
