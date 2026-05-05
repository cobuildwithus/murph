Goal (incl. success criteria):
Fix follow-up issues in hosted AI usage allowance gating: restrict/guard priced hosted models for launch, explicitly document no one-time backfill, produce deterministic user-facing quota messages, avoid infinite gate-unavailable retry loops, improve Stripe plan inference, preserve useful redacted observability, and keep runtime free of pricing/quota logic.

Constraints/Assumptions:
- Launch models are gpt-5.5 and gpt-5.4-mini; no gpt-4.1-mini allowance support is required.
- Existing usage is not backfilled; allowances start from deployed accounting going forward.
- Quota messages are deterministic and non-AI generated.
- Runtime stays out of plan/dollar/quota logic.
- Preserve unrelated dirty work in current checkout.

Key decisions:
- Add a web-owned quota message helper and return the message from the gate.
- Let Cloudflare return the deterministic blocked notice in redacted invocation status without invoking the container.
- Treat gate unavailable as an invocation failure attempt, not a pending nudge reset.
- Add deploy/config guards that reject unpriced hosted assistant models.

State:
Ready for handoff; scoped commit uses partial staging because this checkout has unrelated overlapping dirty work.

Done:
- Read repo routing, architecture, security, reliability, verification, and completion workflow docs.
- Added shared launch priced-model list for `gpt-5.5` and `gpt-5.4-mini`; web pricing now uses it and deploy preflight rejects unpriced `HOSTED_ASSISTANT_MODEL`.
- Required worker deploys to set an explicit priced `HOSTED_ASSISTANT_MODEL` so unset model defaults cannot strand allowance imports.
- Added deterministic quota notices for Pulse and Edge denial responses and Cloudflare redacted invocation status.
- Changed gate-unavailable handling to increment runner retry failure count and respect max attempts.
- Fixed Stripe plan inference to scan all subscription item prices with base price ids before usage price fallback.
- Changed allowance period `last_usage_at` increments to keep the max timestamp.
- Documented no one-time current-period backfill.
- Focused tests/typechecks passed; full `pnpm verify:acceptance` failed in contracts coverage orchestration, while the same contracts coverage/artifact command passed in isolation.
- Security/privacy audit found no issues. Coverage audit added a focused max-preserving `last_usage_at` SQL assertion. Final review findings for explicit model requirement and route serialization proof were fixed.

Now:
- Run required completion audits and create a scoped commit if partial staging remains clean.

Next:
- Report the acceptance verifier race and deploy ordering.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-execution/usage-allowance.ts
- apps/web/app/api/internal/hosted-execution/usage/gate/route.ts
- apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts
- apps/cloudflare/src/user-runner.ts
- apps/cloudflare/src/user-runner/runner-state-store.ts
- apps/cloudflare/scripts/deploy-preflight.ts
- apps/cloudflare/test/user-runner-alarm.test.ts
- apps/cloudflare/test/deploy-preflight.test.ts
- apps/cloudflare/test/node-runner-hosted-assistant.test.ts
- apps/cloudflare/.dev.vars.example
- apps/cloudflare/DEPLOY.md
- apps/web/README.md
- apps/web/test/hosted-execution-usage-allowance.test.ts
- apps/web/test/hosted-onboarding-stripe-billing-events.test.ts
- packages/hosted-execution/src/runtime-control.ts
- scripts/dev-hosted-local/stack.test.ts
