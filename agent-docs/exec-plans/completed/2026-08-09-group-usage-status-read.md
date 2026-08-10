# Hosted group usage-status read reliability

Status: completed
Created: 2026-08-09
Updated: 2026-08-10

## Goal

- Make a hosted group's usage-status read return a useful, authoritative answer
  when a participant asks how much included usage the room has consumed.
- Preserve Web as the sole usage-projection owner and keep payer identity,
  payment state, internal accounting, and other private funding facts out of
  the assistant response.
- Restore one bounded, authoritative aggregate for an explicit group usage
  question: the integer percentage of the room's included allowance already
  used within its current period. This is not total effective capacity. Do not
  infer or expose raw accounting.

## Incident evidence

- The affected hosted group turn completed and delivered its reply; the sole
  application failure was one `murph.group` dynamic-tool call.
- The failure occurred during a proven production interval in which Web emitted
  the current funding-only response while the serving runner still required the
  immediately preceding sponsorship-status field.
- The documented runner-first order was not executable from the single public
  change: Cloudflare production resolved public `main`, while Web deployed the
  merged producer automatically.
- Current typed runtime logs preserve only an aggregate failed-action count for
  this failure class. The control-plane issue projection identified the group
  tool failure, but neither durable surface retained a safe underlying parser or
  transport category.
- The current funding-only projection also cannot answer the reported question
  after a successful read. An included-usage percentage that is monotone within
  one period answers it without revealing credits, refill timing, payment
  setup, payer identity, or period start/end timestamps.
- The product owner explicitly accepts short-lived `read_usage` failures while
  Web and Cloudflare run different strict schemas. Do not add a reader-only
  compatibility phase for this field.
- A successful current Web usage projection already proves a positive included
  limit. The percentage is therefore required on the current success shape;
  accepting a funding-only current response would recreate the rejected
  compatibility phase. Existing sponsorship-era legacy branches are unchanged.

## Success criteria

- The Web projection, hosted parser, runtime contract, and assistant policy ship
  the bounded aggregate as one direct product change.
- The strict response remains fail-closed on unknown or private fields.
- An ordinary group-tool failure remains recoverable inside the provider turn
  and emits only bounded, metadata-only diagnostics.
- Focused tests, relevant package typechecks, exact-head CI, ReviewGPT gates,
  privacy review, and mergeability all pass.

## Scope

- In scope: `murph.group read_usage` Web/runtime response contract, focused
  parser/Web/runtime tests, metadata-only diagnostics if they close the proven
  observability gap, and directly affected durable docs.
- In scope: one room-public `includedUsageUsedPercent` aggregate, calculated
  from included spend and limit and independent of purchased or referred
  credit. Assistant disclosure policy limits it to explicit usage questions;
  the transport does not infer intent.
- Out of scope: allowance accounting, purchase settlement, sponsorship state,
  payer or contributor identity, exact currency values, a new scheduler, a new
  queue, or a second usage owner.

## Constraints

- Web remains the sole owner of usage and funding projections.
- Hosted readers remain strict and reject unknown accounting or identity fields.
- Do not add a rollout-only parser mode, feature flag, state owner, or release
  negotiation path for this field.
- Production evidence and identifiers stay out of committed artifacts.
- The foreground reply path must not wait on optional observability.

## Tasks

1. Complete the runtime/security/reliability contract read and map active-plan
   overlap.
2. Reproduce the exact response-shape mismatch from repository history and add
   a metadata-only parser-failure category for future diagnosis.
3. Update the canonical product/privacy contracts, then land
   `includedUsageUsedPercent` in the Web projection, explicit-question
   assistant disclosure policy, and end-to-end regression coverage.
4. Add metadata-only failure categorization only through the existing
   runtime issue/log owner without adding latency or state.
5. Remove the reader-only compatibility phase and document the explicitly
   accepted mixed-version failure window.
6. Keep the explicit-question contract resident on group email, where the
   filesystem-backed low-usage skill is intentionally unavailable, and define
   target-model scenarios for chat and email success, at-least-100, and
   unavailable results.
7. Run focused tests, typechecks, privacy/diff review, required specialist and
   ReviewGPT gates, exact-head CI, and a direct scenario proof.
8. Close this plan with `scripts/finish-task`, push the exact head, and complete
   the PR and mergeability handoff.

## Verification

- Hosted parser and durable deploy-contract coverage passed: 67 tests.
- Web group-tool and funding coverage passed: 175 tests.
- Assistant group-tool and low-usage policy coverage passed: 112 tests.
- Assistant prompt assembly and model-scenario definitions passed: 86 tests;
  40 real-provider cases were collected and skipped by the credential gate,
  including the six new chat/email usage-progress scenarios.
- Cloudflare group-tool adapter/replay coverage passed: 18 tests. The four new
  direct/proxy stalled-body deadline and caller-cancel regressions failed before
  the transport correction and passed afterward; each proves one request and
  no replay.
- Relevant hosted-execution, Cloudflare, assistant-engine, and prepared Web
  typechecks passed.
- Runner bundle budget coverage passed 42 tests, and the full production runner
  bundle assembled within the ratcheted byte limits.
- Complete first-provider-request capture passed for matching base/head
  individual-chat, group-chat, and group-email turns. The only measured prompt
  delta was +2 tokens and -8 bytes for the required group-email resident rule;
  the temporary harness was removed.
- Final ReviewGPT round 5 audited the full exact-head snapshot with the requested
  Pro model and returned `ROUND_OUTCOME: PASS` with no qualifying findings.
- Exact-head GitHub Actions passed, including release build/typecheck, app and
  fixture verification, assistant/platform/CLI coverage, macOS/Linux host
  matrices, runner permission sandbox, billing, Vercel, hygiene, frontend
  proof, and viewport overflow.
- `git diff --check`, privacy review, and the PR change-shape reconciliation
  passed. No secrets, direct identifiers, environment files, build artifacts,
  generated artifacts, or binaries are part of the patch.
- Additional local Vitest expansion was stopped after unrelated shared-host
  saturation prevented one-file runs from advancing past startup; it emitted no
  assertion failure. The exact-head isolated CI suite supplied the required
  broad completion proof.
Completed: 2026-08-10
