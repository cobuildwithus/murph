# Simplify webhook chat classification convergence

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

- Delete duplicated group-roster result construction from the webhook chat-classification resolver while preserving ingress behavior.

## Success criteria

- Preserve provider/route authority, lookup count and ordering, error/retry behavior, and explicit-group event identity.
- Pass composed webhook tests, Web typecheck, complexity guard, parent review, exact-head CI, and ReviewGPT.

## Scope

- In scope: `webhook-service.ts` planning resolver and composed thread-route proof.
- Out of scope: provider planner, admission, delivery, transaction ownership, prompts, and existing PR 444's participant-removal/provider-echo work.

## Constraints

- Technical constraints: no new abstraction, state, query, provider call, transaction, or dependency.
- Product/process constraints: isolated task branch; synthetic fixtures; draft PR until parent candidate review; leave the new PR open.

## Risks and mitigations

1. Explicit groups, canonical groups, and self echoes intentionally take different authority paths.
   Mitigation: preserve classification diagnostics before the shared route read, skip canonical reads for proven groups/routes, preserve early self-message handling, and retain explicit-group event identity.

## Tasks

1. Completed: converge group classification into one roster lookup and result construction.
2. Completed: extend composed handler tests across explicit and inferred group classification and self echoes.
3. Completed: focused verification and candidate inspection; close this implementation plan in the scoped commit and open a draft PR.
4. Obtain parent review, then run ReviewGPT concurrently with exact-head CI; external completion remains tracked on the PR.

## Decisions

- Product UX: internal behavior-preserving cleanup. Replay established group routes, first-group admission, self echoes, direct messages, and unavailable canonical/roster authority. No model-visible input or reply policy changes.
- The inspected old PR 444 patch changes provider-event ingestion outside this resolver.
- Changelog is not applicable because no member-visible behavior changes.

## Verification

- `pnpm --dir apps/web test:prepared -- test/hosted-onboarding-linq-thread-route.test.ts test/hosted-onboarding-linq-dispatch.test.ts`: 368 tests passed.
- The 11 strengthened route/roster/self-echo cases also pass against baseline source. They prove existing routes skip canonical reads, pending groups reuse one provider summary, and unbound self echoes skip provider reads while preserving direct/group planner behavior.
- `pnpm complexity:diff`: pass; resolver 35 to 27, file debt 163 to 155, maximum unchanged at 151. Source deletes 33 net lines; other owner functions are untouched.
- Initial Web typecheck lacked the generated `@murphai/device-syncd/service` declaration in an unrelated existing test. The existing device-syncd build succeeded; `pnpm --dir apps/web typecheck:prepared` now passes.
- `git diff --check`: pass. Product UX replay preserves group-route authority, canonical classification failure, roster failure/retry, and direct/self-message handling without changing model input, delivery policy, or transaction ownership.
- Takeover verification reran both composed suites (368 passing tests), Web typecheck, and complexity guard against the unchanged source/test candidate. Parent review, exact-head CI, and ReviewGPT remain tracked on the PR.
Completed: 2026-09-04
