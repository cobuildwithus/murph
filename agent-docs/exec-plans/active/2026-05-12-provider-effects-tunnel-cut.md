# Delete legacy Worker provider-effect delivery routes

Status: active
Created: 2026-05-12
Updated: 2026-05-12

## Goal

- Remove the legacy Worker provider-effect delivery tunnel methods for Linq, Telegram, and WhatsApp now that hosted runtime provider egress uses direct provider fetch through Cloudflare interception.

## Success criteria

- `buildHostedExecutionRuntimePlatform()` no longer exposes `sendLinq`, `sendLinqChatAction`, `markLinqRead`, `deleteLinqMessages`, `sendTelegram`, `sendTelegramChatAction`, or `sendWhatsApp` on the Worker effects port.
- `results.worker` no longer routes those legacy provider-effect paths.
- Worker-owned effects such as raw email reads, email send binding, artifact, browser-vault, mailbox, usage, and web-control behavior remain intact.
- Focused Cloudflare tests prove the removed routes are absent and the remaining effects still work.

## Scope

- In scope: `apps/cloudflare` runtime platform, provider-effect route contract/handler, and focused tests.
- Out of scope: assistant-runtime direct provider clients, Cloudflare egress interception policy, Telegram file fetch handling, and unrelated hosted-runner dirty work.

## Constraints

- Technical constraints: preserve direct `providerFetch` egress as the active provider path; avoid changing hosted email/raw-email effects; do not remove unrelated Telegram attachment file lookup until a separate direct path exists.
- Product/process constraints: preserve existing dirty worktree changes; avoid leaking local identifiers in docs, logs, or commits.

## Risks and mitigations

1. Risk: removing the tunnel could accidentally remove remaining Worker-owned effects.
   Mitigation: keep the effects port object and only remove the legacy provider delivery methods/routes named in the task.
2. Risk: stale tests may continue asserting the old tunnel.
   Mitigation: update focused tests to assert the removed methods are absent and routes return not found.

## Tasks

1. Remove legacy provider delivery methods from `createCloudflareRunnerProviderEffectsPort()`.
2. Remove the corresponding provider-effect route constants, parsers, and dispatch cases.
3. Update focused Cloudflare tests.
4. Run scoped verification and privacy/diff checks.

## Decisions

- Keep Telegram file lookup/download effects for now because hosted Telegram attachment import still depends on `effectsPort.getTelegramFile` and `effectsPort.downloadTelegramFile`.

## Verification

- Commands to run: focused `apps/cloudflare` Vitest for runtime platform/outbound provider effects, plus `pnpm typecheck` and `pnpm test:diff` when scoped verification is stable.
- Expected outcomes: removed methods/routes fail closed without affecting remaining Worker-owned effects.
