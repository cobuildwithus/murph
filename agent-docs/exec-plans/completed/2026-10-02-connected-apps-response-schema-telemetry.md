# Connected-app response-schema telemetry

Status: completed
Created: 2026-10-02
Updated: 2026-10-02
Completed: 2026-10-02
Implementation: complete; validation and final review passed at the evidence snapshot.
Evidence snapshot: `ac3bd8e59c5adf0fa681896e8bb8d2727724a9be` (PR #3984).

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

An enumerable code would change RPC recovery. Descriptor and exact-wire checks
passed. The actual-port/actual-adapter synthetic probes closed the composition
gap left by the mirrored engine fixture. Completion and classification records
remain separate, not additive.

## Tasks

- [x] Recover the original five-file diff unchanged and author the plan/index.
- [x] Local agent: run focused owner tests, relevant typechecks and doc checks.
- [x] Local agent: run the composed synthetic probe and persistence/reader checks.
- [x] Local agent: show the focused base negative control fails only for the new
  diagnostic assertions and the patched candidate passes.
- [x] Local agent: complete final ReviewGPT and required exact-head CI at the
  evidence snapshot.
- [x] Record the supplied evidence, move this plan to completed and update its
  index row without changing production, tests or other documentation.

## Verification at the evidence snapshot

The parent reported the following verified results for
`ac3bd8e59c5adf0fa681896e8bb8d2727724a9be`; they were not rerun during this
closeout authoring. Only synthetic/local validation and review/CI results are
recorded here, not production data or operational counts.

- Base controls: 6 engine failures solely for `unknown` versus `invalid_result`,
  and 1 real-port missing-code failure; the valid neighbor passed.
- Patched candidate: 46 engine tests and 6 Cloudflare tests passed. All 3
  actual-port/actual-adapter synthetic probes passed with exact RPC bytes and
  one-call parity.
- Both typechecks passed; Cloudflare passed after ordinary ignored Prisma client
  generation. Docs drift/gardening and whitespace checks passed. Complexity was
  unchanged, with maxima 4/14 and zero hotspots.
- Independent full-snapshot final ReviewGPT round 1 on this exact head returned
  `ROUND_OUTCOME: PASS` with no findings.
- All 4 required exact-head CI checks were green: macOS CLI, Ubuntu CLI, Release
  checks and Stripe boundary.

No live-model journey was run: deterministic synthetic checks established exact
model-visible byte/effect parity for this strictly private diagnostics change.

## Closeout boundary

This documentation-only closeout changes only the plan location/content and its
index row. The closing commit still needs its own required exact-head CI; the
recorded green checks cover only the evidence snapshot, not that later commit.
No merge, deployment or future natural diagnostic emission is asserted here.
