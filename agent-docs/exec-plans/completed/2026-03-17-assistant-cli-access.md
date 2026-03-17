# Assistant CLI access after setup

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Make the provider-backed Healthy Bob assistant chat able to discover and invoke the raw Healthy Bob CLI immediately after `healthybob setup` / `pnpm onboard`, using the existing Incur-backed command surface instead of only manual file reads.

## Success criteria

- The assistant chat provider receives an environment where the Healthy Bob shim directory is available on `PATH` right after setup has installed it.
- The assistant’s first-turn prompt explicitly tells Codex that `vault-cli` and `healthybob` are available, and clarifies that the raw data-plane surface is `vault-cli`.
- The change preserves current assistant session storage, provider-session resume behavior, and vault-root working-directory semantics.
- Focused tests cover both provider env propagation and the assistant-facing CLI guidance.

## Scope

- In scope:
- assistant runtime/provider prompt and environment wiring
- narrow helper(s) for Healthy Bob CLI discovery/hints
- focused assistant/provider tests
- Out of scope:
- redesigning the assistant chat UI
- adding a full structured tool catalog to interactive assistant chat
- changing inbox-routing model tools

## Constraints

- Keep the current vault-root working directory for assistant chat turns.
- Preserve current assistant provider defaults (`read-only`, `never`) unless the user overrides them.
- Avoid relying on shell-profile reloads for the same-process auto-launched chat after setup.

## Risks and mitigations

1. Risk: Advertising CLI commands without guaranteeing resolution would still leave the assistant unable to execute them.
   Mitigation: pair prompt guidance with explicit provider env PATH augmentation.
2. Risk: Overlapping assistant-runtime work may already be modifying nearby files.
   Mitigation: keep the change narrowly scoped to provider/runtime helper seams and avoid the active Ink UI lane.

## Tasks

1. Add a helper that resolves the Healthy Bob CLI shim directory and user-facing command hints for assistant chat.
2. Thread an env override through the Codex adapter so provider subprocesses inherit the shim path reliably.
3. Update the assistant system prompt to mention the raw `vault-cli` surface and the setup-oriented `healthybob` alias.
4. Add focused tests and run the required verification workflow.
Completed: 2026-03-17
