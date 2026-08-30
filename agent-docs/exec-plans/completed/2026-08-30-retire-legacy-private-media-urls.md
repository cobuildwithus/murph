# Retire legacy private media URLs

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Goal

- Retire expired private-media URL compatibility so every producer, validator,
  and Worker route uses only the canonical extension-bearing R2 capability
  path.

## Success criteria

- The Worker accepts only
  `/private-media/v1/<capability>/group-avatar.<jpg|png|webp>?exp=...`.
- Hosted-execution validators reject extensionless Worker capabilities and old
  Cloudflare Images delivery URLs while retaining canonical URLs.
- All touched consumer fixtures use the canonical URL shape, and focused tests
  cover both current acceptance and legacy rejection.
- Durable architecture, security, and deploy docs no longer describe an active
  compatibility window whose one-day capabilities and warm runners have
  already drained.
- Focused tests, touched-owner typechecks/builds, documentation checks, negative
  searches, and diff/privacy review succeed.

## Scope

- In scope: the private-media path matcher and route handler in
  `apps/cloudflare`, the shared hosted-runtime validator, direct fixtures and
  focused tests, and exact compatibility prose in the current owner docs.
- Out of scope: generated-image tombstones, avatar generation/upload behavior,
  R2 object lifecycle, capability duration, unrelated media transports, and
  PR #2584's hosted-runtime latency diagnostics.

## Constraints

- Technical constraints: preserve signed-capability validation, expiration,
  filename/content-type binding, and current path/query semantics; prefer
  deletion over replacement machinery.
- Product/process constraints: the July 28 extension-bearing rollout is older
  than the 24-hour capability lifetime and 10-minute warm-runner window; do not
  push or open a PR from this worktree; commit with the authenticated GitHub
  no-reply identity and preserve privacy.

## Risks and mitigations

1. Risk: a still-supported producer emits an extensionless or Cloudflare Images
   URL.
   Mitigation: trace every production caller of the shared validator and the
   sole Worker producer, then retain negative regression assertions for the
   retired shapes.
2. Risk: Web and Cloudflare deploy skew creates a new compatibility need.
   Mitigation: remove only inputs whose producer was already deleted and whose
   bounded artifacts have drained; document the current canonical contract and
   call out the normal tandem-deploy review in the handoff.
3. Risk: overlap with open PR #2584 in `runtime-control.ts` complicates landing.
   Mitigation: keep the validator edit near lines 1290–1365; #2584's exact
   hunks are latency diagnostics around lines 2345–3407 with no shared symbols
   or call graph.

## Tasks

1. Re-prove the current producer/reader call graph, bounded drain, active-plan
   exclusions, and open-PR hunk independence.
2. Delete legacy path and Cloudflare Images acceptance while simplifying the
   current matcher and route handler.
3. Replace legacy consumer fixtures, retain focused negative coverage, and
   update only current owner documentation.
4. Run focused tests, touched-owner typechecks/builds, scenario/docs guards,
   and negative searches; inspect the complete diff for privacy and scope.
5. Close this plan and create the scoped task commit. Preserve exact-head
   ReviewGPT eligibility for the PR owner after push.

## Decisions

- Treat the rollout as fully drained: the current producer has emitted only the
  extension-bearing R2 capability since July 28, capabilities expire after 24
  hours, and production warm runners idle out after 10 minutes.
- Retain the existing exported validator name to avoid unrelated consumer churn;
  narrow only its accepted value set.
- PR #2584 shares one file but no exact hunk, symbol, or behavior with this
  cleanup, so it is an ordinary low-risk rebase rather than an ownership
  collision.
- The PR owner selected the PR-bound ReviewGPT route, so this worktree uses the
  ordinary local diff/privacy review and does not invoke the mutually exclusive
  formal local deep-review command.

## Verification

- Passed: Cloudflare private-media (12 tests) and runner-outbound (218 tests),
  hosted-execution parsers (67 tests), Web Linq/group-tool files (234 tests),
  and assistant-runtime Linq-context (34 tests).
- Passed: Cloudflare and hosted-execution typechecks and emitted builds,
  scenario-manifest integrity, agent-docs drift, doc gardening with zero issues,
  `git diff --check`, scoped negative searches, and diff/privacy review.
- Outcome: canonical URLs remain accepted and served with their bound extension;
  extensionless capabilities and both old Images URL shapes are rejected before
  provider egress; no generated or unrelated tracked changes remain.
Completed: 2026-08-30
