# Connected-app response-schema telemetry

Status: active
Created: 2026-10-02
Updated: 2026-10-02
Implementation: authored; validation and final review pending.

## Goal

Distinguish the connected-app port's known response-envelope rejection as private
`invalid_result`, without changing model-visible bytes or runtime behavior.
This does not attribute any earlier production failure to a schema rejection.

## Scope and constraints

Preserve the recovered five-file source/test/doc patch unchanged. Add only this
plan and its index entry. Keep the existing TypeError name/message and enumerable
properties; add only the fixed own non-enumerable data code and its exact mapping
to the already-supported private category. No new telemetry field or DB schema.

The local agent owns investigation, synthetic validation, Git and PR work. Use
public-safe synthetic evidence only. No provider calls, member data, prompts,
behavior changes, merges or deployments are authorized by this handoff.

## Success criteria

- The real port rejects malformed successful-HTTP envelopes once with the same
  TypeError and no response/payload/identifier properties; its fixed code is an
  own non-enumerable data property. A nearby valid response succeeds once with
  no failure metadata.
- Through the actual port and dynamic adapter, only the schema rejection becomes
  `invalid_result`. Plain transport Error stays `unknown` with preserved identity,
  result and recovery. Request arguments, RPC bytes and one-call counts remain
  unchanged; no retry, provider write or delivery occurs.
- Calendar/email ambiguous writes retain exact no-retry recovery. Issue
  persistence and historical readers accept `invalid_result`; wire and telemetry
  contain no synthetic private sentinel, response content or raw error code.

## Risks and mitigations

An enumerable code would change RPC recovery: assert the descriptor and exact
wire bytes. The engine fixture mirrors the port contract rather than composing
both owners: require the actual-port/actual-adapter synthetic probe before final
review. Keep completion and classification records separate, not additive.

## Tasks

- [x] Recover the original five-file diff unchanged and author the plan/index.
- [ ] Local agent: run focused owner tests, relevant typechecks and doc checks.
- [ ] Local agent: run the composed synthetic probe and persistence/reader checks.
- [ ] Local agent: show the focused base negative control fails only for the new
  diagnostic assertion and the patched candidate passes.
- [ ] Local agent: complete candidate/final review and exact-head required CI;
  record evidence and close this active plan under `agent-docs/PLANS.md`.

## Verification (pending)

Run from the repository root using its prepared local test environment:

```sh
pnpm --dir packages/assistant-engine test test/connected-apps-tool-failure-diagnostics.test.ts
pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/connected-apps-web-control-policy.test.ts
pnpm --dir packages/assistant-engine typecheck
pnpm --dir apps/cloudflare typecheck
pnpm docs:drift
pnpm complexity:diff
```

All execution and final-review results remain pending; artifact recovery is not
runtime validation. No real-model journey or member-facing changelog is planned
because this patch is strictly private diagnostics with unchanged RPC output.
