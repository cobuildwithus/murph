# Remove WhatsApp support entirely

Status: active
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Remove WhatsApp as a supported Murph channel so no live route, runtime
  contract, provider credential, consent flow, family-invite path, assistant
  adapter, or deployment surface advertises or executes WhatsApp behavior.

## Success criteria

- Delete the hosted WhatsApp webhook, consent, provider parsing, and delivery
  implementations instead of leaving disabled shims.
- Remove `whatsapp` from live channel/config/contract unions and every current
  caller, while preserving Telegram, Linq, and email behavior.
- Remove WhatsApp secrets, env forwarding, Cloudflare interception, deploy
  config, family-invite behavior, and current architecture/security/product
  documentation.
- Retain only truthful historical references in immutable completed plans,
  changelogs/release notes, and third-party research/source material.
- Pass the full repo verification required for cross-cutting web/Cloudflare and
  shared-package changes, all required local specialist audits, green PR CI,
  and the exact-head ReviewGPT loop from commit
  `ffefbb210813975c42346d3cf7012b30abc6bb32` through `ROUND_OUTCOME: PASS`.

## Scope

- In scope: live production source, tests, package exports, app routes, env and
  deploy configuration, current product/architecture/security/runtime docs,
  and mechanical stale-surface guards affected by WhatsApp support.
- Out of scope: immutable completed execution plans, historical changelogs and
  release notes, third-party research/source citations, production secret
  deletion in external provider dashboards, and unrelated messaging work.

## Constraints

- Technical constraints: prefer hard deletion; add no compatibility shim,
  alternate channel abstraction, new state owner, migration, or feature flag
  without concrete persisted-state evidence that deletion would violate a live
  invariant.
- Product/process constraints: preserve unrelated dirty work and active lanes;
  work only in `/private/tmp/murph-remove-whatsapp-support` on
  `codex/remove-whatsapp-support`; do not interrupt existing ReviewGPT/browser
  runs; use the new round-aware ReviewGPT prompt and immutable first-head
  baseline.

## Risks and mitigations

1. Risk: deleting one provider branch can leave a stale enum/config/export path
   that still advertises WhatsApp or breaks another channel.
   Mitigation: trace each live reference through its owner, remove support from
   the bottom-up, run stale-reference searches, and exercise owner/reverse-
   dependent verification.
2. Risk: Cloudflare Worker and warm runner/container versions can temporarily
   disagree about removed env/provider surfaces.
   Mitigation: keep deletion backward-safe where old runners only receive
   unused extra env, document deploy order and convergence checks, and avoid
   compatibility machinery unless a reachable irreversible effect is proven.
3. Risk: an active hosted-ingress plan names WhatsApp files.
   Mitigation: treat the ledger row as a non-exclusive overlap notice, do not
   modify that plan, and keep this task on its isolated branch; resolve only
   conflicts present on current `origin/main`.

## Tasks

1. Map all current WhatsApp ownership and distinguish live support from
   historical/reference-only mentions.
2. Delete provider-specific implementations and remove WhatsApp from shared
   channel/config contracts and callers.
3. Remove app/runtime/deploy configuration and update current durable docs.
4. Run stale-surface proof, focused tests, full verification, security/privacy
   and coverage audits, and the parent final review.
5. Close the plan with a scoped commit, push, open the intent-complete PR, then
   run CI and the exact-head ReviewGPT loop concurrently to completion.

## Decisions

- Treat release notes, changelogs, completed execution plans, and third-party
  evidence as historical records rather than live support claims.
- Use hard deletion rather than a disabled WhatsApp feature flag or compatibility
  layer unless inspection proves current persisted data needs a narrow reader.

## Verification

- Commands to run: targeted owner tests during implementation; final
  `pnpm verify:acceptance`; `git diff --check`; a tracked stale-reference scan
  excluding the explicitly historical/reference-only paths; required local
  `security-privacy-review` and `coverage-write` audits; exact-head PR preflight,
  ReviewGPT round(s), CI status, and merge-tree proof against latest `main`.
- Expected outcomes: all commands green; no live WhatsApp support reference or
  reachable support path remains; no unresolved accepted audit or ReviewGPT
  finding remains.
