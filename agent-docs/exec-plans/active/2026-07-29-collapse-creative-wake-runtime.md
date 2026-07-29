# Collapse creative wake runtime

Status: active
Created: 2026-07-29
Updated: 2026-07-29

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

- Commands to run: focused assistant-engine Vitest suites, assistant-engine
  typecheck, privacy/diff inspection, product-experience review, preliminary
  specialist ReviewGPT, exact-head GitHub Actions, and final ReviewGPT.
- Expected outcomes: one warm process identity, ephemeral restricted
  notification threads, successful signed song upload, no unrelated failures.
