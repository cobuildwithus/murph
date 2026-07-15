Goal (incl. success criteria):
- Replace owner-facing Family seat management with a small per-member management dialog.
- The owner can upgrade a member to Edge or downgrade them to Pulse with one confirmation, while web safely coordinates Stripe capacity, webhook reconciliation, and the member assignment.
- Success means no visible seat quantity controls, retry-safe billing transitions, focused production-path coverage, browser proof on desktop and mobile, required audits with no unresolved findings, green CI, and a passing exact-head ReviewGPT round.

Constraints/Assumptions:
- Preserve one Family Stripe subscription with at most one Pulse item and one Edge item.
- Preserve webhook-only ownership of the local paid-capacity projection and serialized Stripe mutations.
- Add only one nullable pending tier on the existing membership; do not add a transition table, queue, lifecycle enum, reconciliation loop, or second capacity writer.
- Active members and pending invites must never exceed the webhook-confirmed paid capacity for their assigned tier.
- Existing Family plans and pending invites remain valid; this changes owner UX and member-tier orchestration only.
- A member-tier move keeps total paid Family capacity constant and prorates the tier difference on the next invoice.

Key decisions:
- Hide capacity quantity controls and expose one familiar Manage action per active member.
- With only Pulse and Edge, the dialog presents one contextual action: Upgrade to Edge or Downgrade to Pulse.
- The request records a pending tier while current access remains unchanged, then atomically swaps the two Stripe quantities.
- The existing Stripe webhook recognizes that one pending intent and commits the member tier plus paid capacities in the same database transaction.
- The nullable pending tier is the smallest durable bridge across Postgres and Stripe and is required for full six-person plans, where a temporary seventh seat is invalid.
- The Stripe swap uses normal prorations so the tier difference appears as a charge or credit on the next invoice.

State:
- Complete locally: implementation, focused proof, specialist audits, and the
  final hosted-web verification are green. PR publication, CI, and ReviewGPT
  remain.

Done:
- Confirmed current mixed-tier architecture, webhook-only capacity ownership, and owner-row Stripe mutation serialization.
- Confirmed Stripe subscription item and quantity changes can use a shared proration date and create prorations for the next invoice.
- Loaded product/design context and selected the existing settings Dialog, Button, Badge, and token system.
- Created an isolated branch from current origin/main.
- Replaced visible seat quantity controls with one Manage action per active
  member and a contextual upgrade/downgrade confirmation dialog.
- Added the nullable pending-plan migration and the retry-safe Stripe/webhook
  transition without adding another capacity writer or lifecycle service.
- Exposed the existing pending intent to Settings so delayed transitions show
  `Updating to …` and block conflicting member actions.
- Accepted and fixed all frontend-review findings: durable pending status,
  in-flight dialog locking, unique accessible action names, owner-specific error
  copy, and hiding the close affordance while submitting.
- Coverage-write added direct proof for retry idempotency, one pending change per
  group, exact six-seat downgrade, pending/manual-capacity exclusion, and exact
  Stripe item swaps.
- Focused final tests pass (169 Family/UI tests), changed-file lint passes, web
  typecheck passes, migration guards pass (36 tests), and `apps/web verify`
  passes with 5,115 tests, dev smoke, lint, and a production build. A final
  post-audit component test, typecheck, and production build also pass.
- Full `pnpm verify:acceptance` completed repo guards, typechecks, docs,
  scenarios, Cloudflare verification, and package coverage; its remaining red
  results were two unrelated CLI timeouts. The read-model timeout passed 7/7 in
  isolation; the release-smoke retry remained non-responsive and was stopped
  through the exact owned session only.
- Browser setup was attempted against a temporary local preview, but no browser
  backend was available. The preview was deleted; rendered desktop/mobile proof
  remains an explicitly reported tooling gap.

Now:
- Commit the final scoped diff and open the PR.

Next:
- Run CI and exact-head ReviewGPT concurrently, triage every finding, and prove
  the final PR remains conflict-free.

Open questions (UNCONFIRMED if needed):
- None.

Working set:
- apps/web/src/lib/hosted-onboarding/family-plan.ts
- apps/web/src/lib/hosted-onboarding/family-plan-capacity.ts
- apps/web/app/api/settings/billing/family/members/[memberId]/route.ts
- apps/web/src/components/settings/hosted-family-settings-actions.tsx
- apps/web/test/settings-billing-family-management-routes.test.ts
- apps/web/test/settings-hosted-family-manager.test.tsx
- focused Family billing service tests
- agent-docs/product-specs/hosted-family-plan.md
Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
