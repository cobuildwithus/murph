Goal (incl. success criteria):
- Remove the fully drained PR #608 newsletter runner version-negotiation surface.
- Success means the shared newsletter contract accepts only `prepare` and `send`, no source or live current doc references `read_stats`, `includeAuthorizationProof`, `includeAuthorizationSnapshot`, or `newsletter_runner_upgrade_required`, and current preparation still returns the address-free live authorization snapshot plus proof used by filtering and delivery revalidation.
- Preserve scheduled-occurrence retry, delivery idempotency, immutable occurrence manifests, proof-required provider entry, and the unrelated missing-email nudge flow.

Constraints/Assumptions:
- Keep the signed, member-bound Web callback and strict current request/response parsing.
- Do not change the actual authorization proof, exact share-id/scope filtering, repeatable-read authority resolution, one-shot prepare/send capability, outbox parent/child lifecycle, or recipient re-resolution.
- Do not add a compatibility shim, schema change, state owner, route, retry path, or dependency.
- Use a separate ReviewGPT-eligible PR lane; do not run local deep-review for the completed patch.
- Preserve unrelated active work and resolve the separate WhatsApp test-file hunk by ordinary rebase if needed.

Key decisions:
- Delete the old request action, fail-closed legacy response, and rollout marker fields together instead of retaining no-op version flags.
- Treat the marker fields as version negotiation only: they carry no member identity, grant, proof, or recipient authority and are checked only before the real preparation owner is called.
- Deploy Web first, then Cloudflare/runner with immediate rollout. Current retry ownership preserves any newsletter occurrence that observes the short incompatible window.
- After both planes deploy, the cleanup head is the independent rollback floor; a coordinated rollback may return both planes to the #608 contract, Cloudflare first and then Web, but never to a pre-#608 runner.

State:
- Implementation and focused verification complete; uncommitted for parent handoff.

Done:
- Verified current model-facing schemas expose only `prepare` and `send`.
- Verified current ready Web deployments and successful immediate Cloudflare deployments descend PR #608, and runner fingerprint admission rejects stale bundles.
- Traced the rollout markers to request parsing/routing only and separately traced the real proof/filter/outbox/provider-entry protections that must remain.
- Removed the retired request action, rollout marker fields, fail-closed compatibility response, Web route gate, and forwarding branches without changing the live authorization owner or delivery protections.
- Added direct proof that a rejected Web newsletter request becomes a closed capability plus an unavailable send result; the existing cron proof verifies that result preserves the exact pending occurrence and schedules retry.
- Passed focused parser (51), assistant/newsletter/cron (149), Web route (2), scenario-integrity (204 scenarios), stale-reference, and `git diff --check` verification.
- Ran the unscoped diff-aware lane truthfully. After preparing the documented runtime artifacts and lowering host concurrency, all affected typechecks and the full assistant-engine (2,233), assistant-runtime (1,692), assistant CLI (128), and assistantd (40) suites passed; the parent requested handoff while the unrelated CLI breadth was still running, so that owned verifier was stopped and must be rerun by the parent/PR lane.

Now:
- Hand the isolated, uncommitted diff and verification evidence to the parent agent.

Next:
- Complete coverage-write, parent final review, final unscoped diff-aware verification, scoped plan-closing commit, PR/CI, and ReviewGPT in the parent workflow.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/hosted-execution/src/runtime-control.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/test/parsers.test.ts
- packages/assistant-engine/src/assistant/newsletter-outbox.ts
- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
- packages/assistant-engine/test/assistant-codex-group-tool.test.ts
- apps/web/app/api/internal/hosted-execution/groups/newsletter-tool/route.ts
- apps/web/test/hosted-group-newsletter-route.test.ts
- agent-docs/product-specs/group-health-newsletter.md
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
