Goal (incl. success criteria):
- Make routine hosted billing-plan and Family owner actions completable through normal assistant conversation without weakening payment, confirmation, authorization, or privacy controls.
- Success means one assistant-accessible typed billing operation supports status, paid Pulse start, Edge upgrade, renewal-time Pulse switch, and Customer Portal handoff through existing web-owned services; the existing Family tool also supports invite cancellation, sponsored-member removal, and seat-count changes through existing canonical owners.
- Return truthful applied, scheduled, pending, unchanged, or browser-handoff outcomes and keep payment-method/payment confirmation inside the smallest Stripe/browser step.

Constraints/Assumptions:
- `apps/web` remains the canonical hosted billing and Family control owner; assistant/runtime/Cloudflare remain thin typed adapters.
- Money, subscription, seat-count, invite-cancel, and member-remove mutations require explicit confirmation in the current conversation.
- Model-supplied `confirmed: true` is a prompt/schema precondition, not mutation authority; exact human approval must be TTL-bound and consumed before the canonical mutation.
- Preserve Family member account/data ownership: removal revokes sponsorship only and never deletes the member account or private data.
- Reuse existing member-bound identifiers or fail-closed owner-scoped resolution; add no persisted action-handle or approval state.
- Preserve Stripe idempotency, webhook reconciliation, plan eligibility, and eventual entitlement truth.
- No user-facing frontend changes, dependency changes, commits, pushes, PRs, or ReviewGPT runs in this task lane.

Key decisions:
- Extend the existing signed web-control callback pattern rather than introducing a second billing API, state store, or runner-held Stripe credential.
- Reuse existing web billing and Family service functions; extract only the smallest application-service seam needed to keep browser and conversation behavior aligned.
- Treat Customer Portal and any provider-required payment confirmation as browser handoffs; conversational status and safe surrounding orchestration remain headless.
- Keep cross-plane contracts additive so web/Worker/warm-runner deployment skew fails closed rather than misrouting a mutation.
- Reuse the existing web-owned sensitive-action challenge and single-consumer generation; add no billing/Family approval store, manager, or lifecycle.
- Build exact-action financial presentation and fingerprints from web-owned canonical currency, price/cadence, current and target totals, timing, proration, and immediate-invoice behavior.

State:
- Implementation, required specialist audits, focused verification, and the parent final review are complete. The scoped diff is ready for `scripts/finish-task`, base reconciliation, and the PR-lane ReviewGPT/CI gates.

Done:
- Read required repo architecture, invariant, product, security, reliability, testing, completion, Stripe billing, and Next.js route guidance.
- Confirmed the isolated worktree and task branch are clean before plan creation.
- Added strict billing and additive Family contracts, assistant dynamic tools, runtime/Cloudflare ports, signed member-bound web handlers, and active-attempt write-fence enforcement.
- Reused the canonical plan-change, trial conversion, Family invite/member/seat, Stripe Portal, configured plan-presentation, eligibility, and webhook-reconciled read owners without adding persisted state.
- Added explicit confirmation for every new mutation, server-side sponsorship exclusion, owner-scoped retry truth, generic assistant failure text, configured pricing/cadence projection, and truthful applied/scheduled/pending/unchanged/browser-handoff results.
- Updated architecture, security, deploy, billing, and Family ownership documentation.
- Passed focused typechecks for hosted-execution, assistant-engine, assistant-runtime, hosted web, and Cloudflare; focused contract, assistant, web, signed-route, port, and write-fence suites pass.
- Replaced model-only mutation confirmation with the existing member-bound, 15-minute exact-action approval request/consume flow in the signed web owner; pending/denied/expired states cannot reach canonical mutation owners.
- Added canonical Family per-seat/current-total/timing status, exact source/target seat totals in approval, an expected-source-seat precondition, and no-op replay handling.
- Made model-visible billing and Family schemas action-discriminated and taught both tools to return approval URLs plainly, avoid claiming success, and retry the identical action only after the user approves and replies.
- Gave every approval consumption attempt a fresh per-invocation consume nonce so simultaneous identical calls cannot both pass the approval owner's idempotent same-consumer path; canonical no-op reads still make successful sequential retries harmless.
- Re-ran focused hosted-execution, assistant-engine, and hosted-web suites plus their targeted typechecks after approval hardening; diff whitespace, identifier privacy, and docs-drift checks pass.
- Completed the required security/privacy audit with no unresolved critical, high, or medium findings; the only later change was test-only proof.
- Completed the required coverage-write audit. It added direct proof that approved member removal consumes the exact owner-bound action approval before invoking the canonical sponsorship-removal primitive; the focused Family tool suite passed 16/16 and the broader billing/Family proof set passed 238 tests plus the hosted web typecheck.
- Ran the diff-aware verification lane: all touched-owner and reverse-dependent checks reached by the billing change passed. One setup CLI Venice-wizard case failed transiently after the relevant owners were green and then passed in isolation (1 passed, 5 skipped), so it is classified as unrelated flake evidence rather than a product failure.
- Confirmed no user-facing frontend component or layout changed, so `frontend-review` does not apply.
- Parent final review re-walked the assistant tool, typed runtime, Cloudflare fence, signed web authority, exact-action approval, live Stripe revalidation, canonical Family mutation, and webhook-reconciled state paths. The scope remains proportional and adds no persisted state or speculative compatibility machinery.
- `git diff --check`, forbidden-cast/test-focus/debug-marker scans, privacy review (synthetic example-domain fixtures only), and the docs-drift contract all pass.

Now:
- Close this plan and create the scoped implementation commit with `scripts/finish-task`.

Next:
- Rebase the isolated branch onto current `origin/main`, rerun any conflict-affected proof, push it, and open the draft PR with the required intent and deployment-skew contract.
- Run ReviewGPT to zero accepted findings in parallel with final-head CI, then prove a clean merge against current `main`.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `packages/hosted-execution/src/runtime-control.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- `apps/web/src/lib/hosted-execution/**`
- `apps/web/src/lib/hosted-onboarding/**billing**`
- `apps/web/src/lib/hosted-onboarding/family-plan.ts`
- `apps/cloudflare/src/runner-outbound/{shared-web-control-policy,web-control}.ts`
- Focused tests under the corresponding package/app test directories
- `ARCHITECTURE.md`, `agent-docs/SECURITY.md`, and hosted billing/Family product specs
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
