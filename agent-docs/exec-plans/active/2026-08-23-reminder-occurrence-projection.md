# Clarify reminder occurrence projection

Status: active
Created: 2026-08-23

## Product UX

- Outcome: after an active reminder edit, Murph confirms the saved timing without presenting normal in-flight scheduler work as a failed repair.
- Reaches: private members editing recurring reminders while an occurrence is pending, retrying, delivering, or already running.
- Proof: focused tool-response and assistant-turn regressions show a saved active schedule reports a pending occurrence projection as healthy, while genuine readback failures remain explicit and later delivery ownership is unchanged.

## Goal

Replace the overloaded timing-verification boolean with one explicit occurrence-projection status at the existing runtime boundary. Preserve canonical reminder records, in-flight work, scheduler ownership, and delivery behavior.

## Coupled state map

- Canonical reminder timing and active status are durable configuration truth.
- The next deliverable occurrence is a derived scheduler projection.
- Pending occurrence, retry, delivery, or run state may temporarily prevent that projection without invalidating the durable configuration.
- Tool copy must distinguish a transient projection from a configuration/readback failure.

## Scope

- In scope: hosted automation response contract, projection mapping, reminder-edit guidance, focused tests, and the public changelog.
- Out of scope: scheduler semantics, retry policy, reminder persistence, delivery ownership, database schema, and new lifecycle state.

## Tasks

1. Add a focused regression for an idempotent active reminder patch while runtime work is in flight.
2. Replace the ambiguous boolean response with a small explicit status that distinguishes verified, pending, and unverified occurrence projection.
3. Update assistant guidance so pending projection confirms the saved schedule and asks for no member action; retain honest failure wording for true readback errors.
4. Run focused tests, package typechecks, privacy/diff inspection, Product UX walkthrough, and required completion reviews.
5. Commit, push, open a draft PR, run ReviewGPT with CI, and resolve accepted findings before handoff.

## Architecture decision

The runtime already owns both canonical reminder reads and scheduler projection. Keep the distinction there and pass one typed status to the assistant. Do not add a polling loop, retry owner, stored verification flag, queue, or scheduler fallback.

## Verification

- Focused assistant-runtime projection tests.
- Focused assistant-engine scripted-response tests.
- Typechecks for changed workspace packages.
- Exact-head ReviewGPT and required GitHub checks.

## Current evidence

- The regression first failed because the tool result omitted the pending occurrence projection, then passed after the typed response contract was implemented.
- Focused assistant-engine coverage passes 208 tests across scripted turns, hosted domain tools, model behavior, and onboarding continuity; targeted runtime and scheduler checks pass the pending, resolved, delivery-cutoff, and telemetry paths.
- Assistant Engine and Assistant Runtime package typechecks pass.
- Complete first provider-visible requests captured through the pinned Codex App Server with identical direct and group reminder fixtures, `gpt-5.6-terra`, low reasoning, production code mode, and `gpt-tokenizer` 3.4.0 `o200k_harmony` grow by 156 tokens and 819 UTF-8 bytes in each route. Direct changes from 26,890 tokens / 124,124 bytes to 27,046 / 124,943; group changes from 22,751 / 105,397 to 22,907 / 106,216. The delta is entirely the assembled reminder guidance; tool/schema/generated guidance and other provider-visible fields are unchanged after volatile paths and identifiers are normalized.
- Product UX walkthrough: pending projection confirms the saved active reminder and requires no member action; unavailable projection stays honest; resolved, device-triggered, exhausted, scheduler, and delivery behavior remain unchanged.
