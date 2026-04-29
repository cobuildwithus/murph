# Hosted Device Connect Assistant

## Goal

Make hosted assistant turns create supported wearable OAuth connection links from
the hosted device-connect helper instead of telling iMessage/Telegram users that
links are unavailable after the backend helper is configured.

Success criteria:

- When a hosted user asks to connect a configured provider such as WHOOP, the
  assistant can call the hosted helper and reply with the returned authorization
  URL.
- The helper stays server-owned; provider credentials are not forwarded to the
  runner environment or exposed through local CLI commands.
- Unsupported providers and helper failures produce bounded user-facing messages
  without leaking state, OAuth secrets, callback signing details, or local paths.
- Prompt guidance no longer contradicts the actual hosted capability.
- Focused assistant-engine/runtime tests and a direct scenario proof cover the
  behavior.

## Constraints

- Do not route hosted connect requests through local `device connect` CLI calls.
- Do not expose OAuth state, provider credentials, callback tokens, or local
  runtime paths in tests, logs, prompts, docs, or handoff.
- Keep provider matching narrow and explicit; do not infer unsupported wearable
  providers.
- Preserve the existing hosted web control-plane route and runtime platform
  boundary.

## State

Implemented and verified; completion audits are in progress. Reproduction showed:

- Local configured device sync is healthy and can create a WHOOP OAuth URL.
- Missing provider credentials still fail daemon startup in an isolated vault.
- Hosted platform smoke can create a signed WHOOP link while keeping credentials
  out of forwarded runner env.
- Assistant prompt guidance still says the hosted helper is unavailable, and no
  assistant-engine production path invokes `issueDeviceConnectLink`.

Implementation:

- Added a deterministic hosted assistant pre-model connect-link handler for
  explicit configured wearable connect requests and compact onboarding wearable
  answers.
- Routed supported hosted connect requests through the server-owned
  `issueDeviceConnectLink` helper, including iMessage/Telegram return-target
  metadata.
- Kept unsupported providers and helper failures bounded without leaking backend
  details.
- Updated hosted prompt capability guidance so it no longer contradicts the
  runtime capability.
- Forwarded messaging return-target metadata from hosted runtime helper wiring
  to the web-owned device-connect link route.
- Tightened the pre-model matcher after simplify/security review so wearable
  sync-status or integration-info questions fall through to the normal assistant
  turn instead of creating an OAuth link.
- Derive OAuth return-target metadata only from the active input channel; omit it
  when the active channel is absent.
- Tightened final-review gaps so experiment setup prompts that mention a wearable
  provider fall through to the model, and mixed unsupported-provider connect
  targets never call a configured provider helper.

## Verification

- `pnpm exec vitest run packages/assistant-engine/test/assistant-hosted-device-connect.test.ts packages/assistant-engine/test/assistant-prompt-capability-availability.test.ts packages/assistant-engine/test/model-behavior.test.ts packages/assistant-engine/test/assistant-provider-final-coverage.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts --no-coverage`
  passed.
- `pnpm exec vitest run packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts -t "exposes hosted device connect providers" --no-coverage`
  passed.
- `pnpm --filter @murphai/assistant-engine typecheck` passed.
- `pnpm --filter @murphai/assistant-runtime typecheck` passed.
- Direct sanitized scenario proof showed hosted WHOOP + iMessage context calls
  the helper with provider `whoop`, return target `imessage`, and returns a
  link-bearing response without printing OAuth state; the same proof confirms a
  WHOOP sync-status question, a WHOOP-to-Apple-Health integration question, and
  a WHOOP experiment-setup request remain `not_applicable`, and a mixed
  unsupported-provider connect request is handled without helper work.
- `pnpm test:diff <touched paths>` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.
Status: completed
Updated: 2026-04-30
Completed: 2026-04-30
