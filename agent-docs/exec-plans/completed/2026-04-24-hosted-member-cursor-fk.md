# Fix hosted signup notification observability

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Make paid hosted signup debugging reliable: skipped signup welcome notifications must expose redacted provider-stage diagnostics without bypassing the provider turn.

## Success criteria

- Hosted assistant notification skip logs include redacted provider-stage failure diagnostics that are enough to separate provider auth/model/base-url errors from Linq delivery failures.
- Focused regression tests cover provider-stage failure details and the preserved provider-turn route.
- Cloudflare and web deploy paths are run after verification so a fresh signup can be tested live.

## Scope

- In scope:
  - `packages/assistant-engine`, `packages/assistant-runtime`, and `packages/hosted-execution` hosted assistant notification failure observability.
  - Directly coupled focused tests and deployment commands.
- Out of scope:
  - Stripe billing semantics beyond the already-paid activation flow.
  - Linq provider implementation changes or manual message sends.
  - Hosted-run acquire protocol changes for deleted members.

## Constraints

- Technical constraints:
  - Web/Postgres remains the hosted cursor/run source of truth.
  - Do not resurrect missing hosted members just to satisfy a cursor FK.
  - Do not persist raw SMS text, provider payloads, secrets, or user identifiers in new logs/tests.
- Product/process constraints:
  - Preserve unrelated active ledger rows and dirty-tree work.
  - Keep the patch narrow enough for immediate deploy and live retry.

## Risks and mitigations

1. Risk: Notification failure logs expose provider payloads or personal data.
   Mitigation: Add only coarse redacted status/category/message summaries and keep raw payloads, tokens, message bodies, and user identifiers out of persisted logs.

## Tasks

1. Trace notification failure detail propagation.
2. Patch notification observability.
3. Add focused regression coverage.
4. Run scoped tests/typecheck plus deployment commands.
5. Watch live logs after the next signup attempt.

## Decisions

- Exact-text onboarding welcome still goes through the assistant-provider decision path; do not hardcode or manually send around a provider failure.
- Missing-member cursor acquisition is a separate hardening/noise issue caused here by manual DB deletion; leave it loud for now rather than hiding a real production data-loss bug.

## Verification

- Commands to run:
  - Focused hosted notification observability tests.
  - Package/app typecheck as scoped proof.
  - Deployment commands for hosted web and Cloudflare if local verification is green.
- Expected outcomes:
  - Focused tests pass.
  - Typecheck for touched owners passes or any unrelated blocker is recorded.
  - Live logs expose the provider-stage reason if a fresh signup welcome is skipped again.
Completed: 2026-04-24
