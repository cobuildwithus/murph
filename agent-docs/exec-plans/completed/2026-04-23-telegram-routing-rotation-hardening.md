# Harden hosted Telegram routing across contact-privacy key rotation

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Preserve one logical hosted Telegram routing binding per raw Telegram user even while contact-privacy blind-index keys rotate, and make inbound Telegram routing fail closed instead of choosing an arbitrary member when cross-version duplicates exist.

## Success criteria

- Telegram routing writes reject attempts to bind a raw Telegram user when any configured read-version candidate already belongs to a different member.
- Rebinding the same member during or after rotation updates that member's canonical stored lookup key to the current write version instead of creating a second logical binding.
- Inbound Telegram lookup never uses nondeterministic `findFirst` behavior across multi-version blind-index candidates.
- Ambiguous multi-row Telegram matches fail closed before webhook wake materialization.
- Focused regression coverage exists for the rotation conflict, same-member refresh, and inbound ambiguous-routing cases.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/{hosted-member-routing-store,hosted-member-routing-telegram,webhook-provider-telegram}.ts`
- directly coupled `apps/web/test/**` coverage for hosted member routing and Telegram webhook dispatch
- `agent-docs/exec-plans/active/{2026-04-23-telegram-routing-rotation-hardening.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broad contact-privacy redesign, new parallel lookup columns, or generic rotation tooling across every hosted blind-index surface
- unrelated hosted auth, billing, ingress, or Cloudflare work already active in the tree
- schema changes unless they are strictly required for the narrow Telegram invariant

## Constraints

- Technical constraints:
- Keep the existing hosted contact-privacy model of one canonical stored lookup key plus multi-version reads.
- Do not widen raw Telegram identifier storage in Postgres or introduce permanent dual-write lookup columns.
- Treat ambiguous multi-version matches as an error path, not as an ordering problem to smooth over.
- Product/process constraints:
- Preserve unrelated dirty-tree edits, especially the active hosted billing and hosted auth rows already touching `apps/web`.
- Treat this as a high-risk hosted routing change: run the required `apps/web` verification lane, capture direct scenario proof, and complete the required `coverage-write` plus `task-finish-review` audits.

## Risks and mitigations

1. Risk: new conflict detection could block legitimate same-member rebinds after a key rotation.
   Mitigation: group matches by member id and allow the write only when every candidate row belongs to the same member being updated.
2. Risk: inbound Telegram traffic could silently stop for members with already-corrupted duplicate bindings.
   Mitigation: fail closed with an explicit ignored/error path instead of misrouting to the wrong member, and cover that ambiguity in tests.
3. Risk: touching the routing store could overlap active `apps/web` dirty-tree work.
   Mitigation: keep the diff limited to the Telegram routing seam plus directly coupled tests, and avoid unrelated schema or ingress churn.

## Tasks

1. Completed: register the task in the ledger and create this active plan.
2. Completed: inspect the Telegram routing write and read paths plus the current focused tests.
3. Completed: implement cross-version uniqueness checks on write and deterministic fail-closed lookup behavior on read.
4. Completed: add focused regression tests for same-member refresh, cross-member conflicts, and ambiguous inbound lookup handling.
5. Completed with external blocker: run required verification, capture direct scenario proof, and attempt the required `coverage-write` plus `task-finish-review` audit passes. Focused local proof is green; both required audit agents failed immediately because of account usage limits.
6. Completed: assess scoped commit viability. Exact staging is not safe in the current dirty tree because the touched Telegram routing files and coupled tests also carry overlapping active edits from other lanes.

## Decisions

- Keep the existing one-column Telegram blind-index storage model and harden uniqueness in application logic by checking every configured read-version candidate before write.
- Treat cross-version multi-row Telegram matches as ambiguous and fail closed rather than restoring deterministic-but-wrong ordering over `findFirst`.
- Reuse the existing advisory-lock seam for Telegram routing writes so cross-version conflict checks do not race concurrent bind attempts.
- Do not widen this fix into schema changes or a generic contact-privacy redesign because the narrow Telegram routing seam can be fixed without changing persisted shape.

## Verification

- Focused green proof:
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/settings-telegram-sync-route.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-member-store.test.ts -t "raw Telegram user id|upserts Telegram bindings|refreshes the same member's Telegram lookup key|rejects Telegram binding"`
- `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts -t "fails closed when Telegram lookup resolves to multiple members across rotated blind-index candidates"`
- `git diff --check -- apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-telegram.ts apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts agent-docs/exec-plans/active/2026-04-23-telegram-routing-rotation-hardening.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Broader required checks attempted:
- `pnpm --dir apps/web typecheck` failed for unrelated pre-existing errors in Stripe billing and hosted auth tests outside this Telegram routing slice.
- `pnpm test:diff apps/web/src/lib/hosted-onboarding/hosted-member-routing-store.ts apps/web/src/lib/hosted-onboarding/hosted-member-routing-telegram.ts apps/web/src/lib/hosted-onboarding/webhook-provider-telegram.ts apps/web/test/hosted-onboarding-member-store.test.ts apps/web/test/hosted-onboarding-telegram-dispatch.test.ts` was not a truthful isolated lane in the current dirty tree because unrelated workspace and `apps/web` failures already make it red.

## Outcome

- Telegram routing writes now reject cross-member conflicts across all configured read-version blind-index candidates while still allowing same-member refresh to the current write version.
- Telegram raw-user reads now fetch all candidate rows, collapse duplicates by member id, and return ambiguity instead of picking an arbitrary first row.
- The Telegram webhook path now ignores ambiguous bindings with reason `ambiguous-telegram-binding`, preventing misrouting or incorrect entitlement selection.
- Focused regression coverage exists for same-member rotation refresh, cross-member rotation conflict, and inbound ambiguous-routing fail-closed behavior.

## Audits

- Required `coverage-write` audit agent attempt failed immediately due account usage limits.
- Required `task-finish-review` audit agent attempt failed immediately due account usage limits.
- Local manual review completed before handoff; no additional functional issue was found in the narrowed Telegram routing diff.

## Commit note

- No scoped commit was created. The touched Telegram routing files and directly coupled tests overlap active dirty-tree edits from the broader blind-index hardening and Telegram thread-target lanes, so path-based staging would have absorbed unrelated work.
Completed: 2026-04-24
