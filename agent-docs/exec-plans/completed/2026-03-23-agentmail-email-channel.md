# AgentMail email channel

Status: completed
Created: 2026-03-23
Updated: 2026-03-23

## Goal

- Add AgentMail-backed email as a first-class Healthy Bob inbox and assistant delivery channel.
- Let setup/onboarding provision or reuse an AgentMail inbox and enable direct-thread auto-reply.
- Preserve the current iMessage and Telegram behavior while threading the inbound email inbox identity through assistant session bindings.

## Success criteria

- `vault-cli inbox source add email` can configure an existing AgentMail inbox or provision a new one.
- `packages/inboxd` exports an email poll connector and AgentMail API poll driver that normalize text plus attachments into inbox captures.
- `vault-cli assistant ask|deliver|run` can send outbound email and reply in-thread using the same AgentMail inbox identity that received the message.
- Setup/onboarding can offer email as a channel and enable email auto-reply only when AgentMail readiness checks pass.
- Focused tests cover AgentMail outbound delivery, inbox CLI schema changes, and email-thread assistant binding behavior.

## Scope

- In scope:
  - AgentMail API client/runtime helpers in `packages/cli`
  - inbox source contracts, services, and connector instantiation for `email`
  - inboxd email connector, normalization, and exports
  - assistant delivery/binding/auto-reply wiring for email
  - setup/onboarding/email-channel provisioning and readiness probes
  - targeted docs and tests required by the repo process docs
- Out of scope:
  - mailing-list or group-thread auto-reply
  - non-AgentMail email providers
  - web UI for email channel management

## Constraints

- Keep auto-reply limited to direct email threads.
- Do not expose API keys, Authorization headers, or private mailbox identifiers in docs, logs, fixtures, or handoff.
- Preserve adjacent in-flight assistant and inbox worktree edits.
- Port the supplied patch behavior onto the current tree instead of forcing stale hunks.

## Risks and mitigations

1. Risk: current assistant runtime drift breaks session binding or outbound delivery reuse.
   Mitigation: thread email identity through the shared conversation/binding layer and cover it with focused assistant-channel/runtime tests.
2. Risk: AgentMail connector behavior diverges from inboxd’s poll connector contracts.
   Mitigation: implement the email connector against the current inboxd `PollConnector`/capture normalization interfaces and export it from `packages/inboxd/src/index.ts`.
3. Risk: setup enables email auto-reply without a valid inbox or API key.
   Mitigation: reuse the inbox doctor readiness path and gate enablement on successful AgentMail probe checks.

## Tasks

1. Add the AgentMail API runtime/client and the inboxd email connector/normalizer/types.
2. Extend inbox CLI contracts and services to configure or provision email connectors and optionally enable auto-reply.
3. Wire email through assistant bindings, outbound delivery, and auto-reply session resolution.
4. Add setup/onboarding email-channel support plus required docs and generated CLI updates.
5. Run focused tests, completion audits, required repo checks, and commit the exact touched files.

## Verification

- Focused commands:
  - `pnpm exec vitest run packages/cli/test/assistant-channel.test.ts packages/cli/test/inbox-incur-smoke.test.ts packages/cli/test/setup-cli.test.ts packages/cli/test/setup-channels.test.ts packages/cli/test/assistant-runtime.test.ts packages/inboxd/test/email-connector.test.ts --no-coverage --maxWorkers 1`
  - Result: passed
- Required commands:
  - `pnpm typecheck`
    - Result: failed in pre-existing `packages/cli` typecheck baseline outside the AgentMail slice (`@healthybob/contracts` resolution plus existing descriptor typing errors).
  - `pnpm test`
    - Result: package-level suites reached the root Vitest stage; the focused AgentMail/assistant/setup suites passed, but the root non-coverage Vitest invocation did not produce a clean completion signal in this workspace during this turn.
  - `pnpm test:coverage`
    - Result: failed in pre-existing `packages/contracts` packaging baseline (`packages/contracts/dist/index.js` missing for `dist/scripts/verify.js`).
Completed: 2026-03-23
