# Foreground checkpoint interruption and mailbox request timing

Status: active
Created: 2026-09-21
Updated: 2026-09-21

## Goal

- Foreground messages interrupt background workspace checkpoint construction and
  continue in the same warm workspace without losing dirty state. Mailbox fetch
  diagnostics distinguish Web admission/database work from Worker transport and
  inline payload decoding without logging private content.

## Success criteria

- A blocked system checkpoint is cancelled on qualified foreground work; the
  foreground assistant starts before a replacement checkpoint.
- Shutdown durability, completed-publication reconciliation, replay safety,
  usage denial, and spurious wake behavior retain their existing owners.
- Bounded numeric request timings are visible in deployed diagnostic logs.
- Focused regression tests, owner typechecks, candidate review, required CI,
  final ReviewGPT, and deployment verification pass.

## Scope

- In scope: system-work checkpoint interruption; mailbox Web/Worker timings;
  synthetic regression proof, owner documentation, changelog, and release.
- Out of scope: new schedulers, changing access/usage authority, logging message
  payloads, or speculative database optimizations.

## Constraints

- Reuse the existing checkpoint interruption, foreground prefetch, snapshot
  cancellation, write-fence/CAS, and structured logging owners.
- Keep authoritative progress local until acknowledged publication; aborted
  construction never marks state clean or releases durability-gated effects.
- No new network calls or awaited telemetry on the reply path. Optional timing
  headers must tolerate old/new Web and Worker combinations.
- Product UX (Patch): Outcome: prompt typing/replies during background saves.
  Reaches: foreground arrival during save, spurious wake, shutdown, and save
  completion races. Proof: deterministic composed runtime and transport tests.

## Risks and mitigations

1. Cancelling a publication after it has committed can lose version knowledge.
   Preserve the existing publication acknowledgement boundary and test the race.
2. Background effects could escape an interrupted durability barrier.
   Propagate interruption to the existing in-place foreground upgrade and retain
   pending effects and dirty-state ownership.
3. Diagnostic headers could contain private or malformed values.
   Emit only fixed metric names and bounded numbers; allowlist parsed fields.

## Tasks

1. Recheck deployed request diagnostics and trace all checkpoint entry paths.
2. Add failing synthetic checkpoint cancellation proof and implement the narrow
   existing-owner correction.
3. Add missing mailbox request phase timings with bounded transport proof.
4. Verify and review, update durable docs and changelog, commit and open PR.
5. Complete exact-head CI and ReviewGPT, merge and deploy through protected
   release owners, then verify version and diagnostic field presence.

## Decisions

- Production evidence is inspected in memory only; no private rows, identifiers,
  exact incidents, or logs are copied into task artifacts.
- The mailbox fetch route currently has no internal phase timing. Existing
  outbound logs record only total Worker request duration.

## Verification

- Focused assistant-runtime system-preemption/checkpoint tests; Web mailbox
  internal-route tests; Worker outbound/decode tests; relevant owner typechecks.
- Test cancellation before publication and arrival after publication, with no
  duplicate delivery or lost dirty work. Confirm timing parse ignores unknown,
  malformed, and oversized data. Record exact commands/results as completed.

## Implementation evidence

- Composed runtime system-preemption and checkpoint-race suites: 61 tests pass.
  A blocked synthetic snapshot aborts before mailbox qualification; foreground
  imports once and runs before a replacement save. Spurious wakes and shutdown
  retain dirty progress; system-only wakes do not cancel snapshots. Existing
  publication/wake races preserve the committed result.
- Worker fetch/decode and timing parser suites: 24 tests pass. One Web fetch and
  at most one ingress context resolution remain; unknown and malformed timing
  values are ignored. Web internal routes: 120 tests pass, including precise
  timing attribution with unchanged member/projection call counts.
- Assistant-runtime, Cloudflare, and Web typechecks pass. Fresh-worktree Web
  preparation generated Prisma before dependent Web tests/Worker typecheck.
- Complexity guard passes: Worker handler debt decreases by one and runtime
  file debt by six; existing system execution is isolated from interruption
  handling. New timing helpers own only numeric header parsing and mailbox
  response completion, with no new durable state or transport.
- Parent candidate review checked cancellation propagation, retained dirty
  state/effects, shutdown, publication acknowledgement, and optional-header
  compatibility. Provider instructions, tools, and input assembly are unchanged.
- Remaining release gates: changelog archive proof, exact-head CI, ReviewGPT,
  protected deployment, and observation of numeric fields in production.
