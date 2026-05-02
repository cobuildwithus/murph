Goal (incl. success criteria):
- Land the supplied hosted ingress robustness patch intent.
- Provider-facing Linq/Telegram/email ingress should not fail after a durable mailbox append solely because the post-commit runner nudge workflow failed to start.
- Bound Linq webhook body reads and hosted email metadata fields before append.
- Add focused tests for the new post-commit best-effort semantics.

Constraints/Assumptions:
- Preserve unrelated dirty work in the current checkout.
- Supplied patch file is behavioral intent; it is not mechanically applyable as-is.
- No DB-backed pending-handoff reconciler in this slice.
- If durable architecture docs still describe provider errors after post-append workflow-start failure, update them with the new current behavior and residual reconciliation gap.

Key decisions:
- Treat post-append workflow start as best-effort and log/return structured status instead of throwing to provider ingress.
- Use bounded request/metadata parsing at ingress boundaries.
- Use current checkout only; no separate worktree.

State:
- Ready to close after scoped final commit.

Done:
- Read required routing, verification, security, reliability, and testing docs.
- Confirmed supplied patch is corrupt for `git apply`.
- Added bounded Linq webhook raw-body read scaffolding; current follow-up adjusts the cap to 256 KiB and adds Linq message-parts payload bounds.
- Moved Linq message part-count/serialized-size validation to the shared `message.received` entry point so first-contact and redirect paths fail before side effects.
- Added focused coverage for oversized first-contact iMessage and non-home-line redirect payloads rejecting before signup, routing, quota, reply, read receipt, or mailbox side effects.
- Added focused route coverage for oversized bodies without declared `content-length` so the streaming accumulator cap is exercised.
- Focused Linq route/dispatch tests passed after adding body/parts limit coverage (36 tests).
- Root `pnpm typecheck` passed before unrelated tunnel-dev changes appeared; rerun is currently blocked by unrelated dirty `scripts/dev-hosted-local/*` type errors.
- `pnpm --dir apps/web typecheck` passed after the focused route test addition.
- `pnpm --dir apps/web lint` passed with one unrelated warning in `apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx`.
- Scoped `bash scripts/workspace-verify.sh test:diff ...` reached `apps/web verify`; lint and `next build` passed, but app-wide Vitest remains red on unrelated UI expectation drift in `hosted-legal-consent-card.test.ts` and `page.test.ts`.
- Ported the supplied hosted Linq mailbox robustness patch onto current `main` after `git apply` hit a corrupt hunk and adjacent drift.
- Active-member Linq conversation wakes now compact oversized/too-many parts instead of rejecting, measure the full mailbox envelope against the inline target, omit signed attachment URLs from canonical mailbox payloads, and keep attachment descriptors when possible.
- Hosted mailbox inline payload storage now targets 128 KiB so normal conversation wakes avoid sidecar fetches.
- Generic hosted mailbox import retryable blockers now remain pending, schedule a fast mailbox retry wake, and propagate that wake through checkpoint/runtime invocation results instead of aging into retry-exhausted quarantine.
- Assistant prompt construction now adds staged-input context when inbox/parser projection is pending or failed and no attachment enrichment is available.
- Focused Linq/mailbox store, assistant-runtime mailbox import/entrypoint, and assistant-engine prompt-builder tests passed.
- Completion reviews ran. Coverage review requested no edits. Security/privacy and final reviews found missing durable retry wake persistence for no-state-change retryable blocks and non-retryable web missing-sidecar responses; both were fixed.
- Added coverage for web missing sidecar payload rows returning retryable unavailable responses, mailbox-checkpoint retry wake checkpointing without watermark advance, and workspace-entrypoint pure retryable sidecar blocks checkpointing a mailbox retry wake.
- Latest focused verification passed: web hosted-mailbox/Linq dispatch tests (47 tests), assistant-runtime mailbox import/checkpoint/workspace-entrypoint tests (38 tests), assistant-engine prompt-builder test (15 tests), scoped diff-check, focused lint, and scoped privacy/leakage diff scan.

Now:
- Close the plan and commit only the remaining scoped hosted-runtime test diff plus plan archival.

Next:
- Report the mixed-commit caveat and verification results.

Open questions (UNCONFIRMED if needed):
- Full durable pending-handoff reconciler remains a follow-up hardening step, not part of this patch.

Working set (files/ids/commands):
- `agent-docs/references/hosted-runtime-protocol.md`
- `ARCHITECTURE.md`
- `apps/web/src/lib/hosted-onboarding/webhook-service-wake.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/app/api/hosted-onboarding/linq/webhook/route.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/src/index.ts`
- `packages/hosted-execution/src/email-ingress.ts`
- `packages/assistant-runtime/src/hosted-runtime/mailbox-import.ts`
- Focused tests under `apps/web/test`, `apps/cloudflare/test`, and package tests if already present.
Status: completed
Updated: 2026-05-02
Completed: 2026-05-02
