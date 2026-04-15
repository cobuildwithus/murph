# Hosted Channel Sync Architecture

## Goal

Replace hosted Linq auto-reply bootstrap/readback behavior with an explicit hosted member channel-state model that covers activation and later settings changes, while keeping `automation-state.json` as the single persisted effective auto-reply source of truth.

## Scope

- hosted execution contracts/builders/parsers
- hosted runtime channel reconciliation and summaries
- hosted-web activation/settings dispatch plumbing
- targeted regression coverage for activation replay and settings-driven channel updates

## Constraints

- Do not add a second persisted enabled-channel document.
- Preserve explicit welcome/bootstrap behavior from `firstContact`.
- Keep settings-driven updates on the existing hosted outbox/dispatch path.
- Avoid unrelated hosted onboarding, billing, or device-sync behavior changes.

## Verification

- `pnpm typecheck`
- `pnpm exec vitest run packages/hosted-execution/test/parsers.test.ts packages/hosted-execution/test/outbox-payload.test.ts packages/assistant-runtime/test/hosted-runtime-context.test.ts packages/assistant-runtime/test/hosted-runtime-summary.test.ts apps/cloudflare/test/node-runner.test.ts`
- `pnpm --dir apps/web test -- test/settings-email-sync-route.test.ts test/settings-phone-sync-route.test.ts test/settings-telegram-sync-route.test.ts test/hosted-execution-control.test.ts test/hosted-onboarding-member-activation.test.ts`
- `pnpm --dir apps/cloudflare test:workers -- test/workers/runtime.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/node-runner-abort.test.ts apps/cloudflare/test/user-runner.test.ts`
- `pnpm --dir apps/web test -- test/hosted-execution-control.test.ts test/hosted-onboarding-member-channel-sync.test.ts test/settings-phone-sync-route.test.ts test/settings-telegram-sync-route.test.ts test/settings-sync-helpers.test.ts`
- `pnpm test:diff`

## Notes

- Treat this as a hosted control-plane/runtime contract cleanup plus regression fix for Linq auto-reply and future Telegram/email settings sync.
- Final review follow-ups landed in the same slice: activation now seeds email channel state from server-truth when available, settings sync no longer trusts a client-provided email hint, and `member.channels.updated` ids are occurrence-scoped so repeat enable/disable cycles redrive correctly.
- Production logs for the incident window showed inbound Linq webhook handling and hosted dispatch invocation without a matching outbound Linq send, which matches the missing-enabled-channel failure mode.
- Local Cloudflare smoke did not catch the bug because the current smoke/e2e coverage exercises activation/manual-run plumbing, not settings-driven `member.channels.updated` propagation.
- `apps/cloudflare/vitest.node.workspace.ts` now excludes all `*e2e.test.ts` from the normal node workspace so those longer-running cases stay on the dedicated e2e config.
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
