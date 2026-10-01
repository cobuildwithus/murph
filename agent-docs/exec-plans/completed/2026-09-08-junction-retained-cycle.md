# Diagnose retained Junction resource retry cycles

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and invariants

Expose the missing historical retry decision through the existing bounded
runtime-log stream. This is the diagnostic stage of the broader cycle repair:
it does not claim to resolve production cycling. Preserve historical import
obligations, provider retry timing, and foreground behavior. Canonical device
state remains Web-owned; jobs and continuations keep their existing owners.

## Investigation

Trace historical readiness and resource continuation decisions through provider
execution, job recovery, checkpoint recording, and mailbox selection. Existing
successful-pass logs do not distinguish useful import progress from replacement
of a future historical retry. Reproduce the actual gap before changing policy.
If local proof cannot identify the production decision, add bounded metadata-only
diagnostics at the decision owner and inspect them after a protected rollout.
Private operational evidence stays outside repository artifacts.

## Scope and architecture

- Reuse existing provider diagnostic, bounded job, mailbox, checkpoint, and
  deployment surfaces; add no scheduler, queue, credential path, or state owner.
- Preserve failure, unknown readiness, source epoch, consent, disconnect,
  successful empty-history proof, and cold-restore contracts.
- Keep logs free of payloads, resource identities, provider account identifiers,
  raw historical snapshots, and credentials. Use finite classifications/counts.
- Keep unrelated delivery-wake and deployment fixes intact.

## Product UX

- Outcome: Connected-device updates continue while old historical work waits
  safely, and completed work stops generating redundant runtime attempts.
- Reaches: Ordinary connected sources, delayed historical work, active imports,
  disconnected/replaced sources, cold restore, and concurrent foreground work.
- Proof: Real provider and runtime regression paths, focused tests/typechecks,
  exact-head CI/review, protected deployment, and live aggregate progress.

## Tasks

1. Trace current historical resource and mailbox retry paths.
2. Add readiness and proposed follow-up diagnostics without policy changes.
3. Exercise provider decisions, service propagation, log parsing, and retries.
4. Review, commit, open the diagnostic PR, and run ReviewGPT alongside CI.
5. Deploy through the protected private workflow and use the new evidence to
   guide the subsequent cycle correction under the ongoing task.

## Verification

Focused provider/service tests: 251 passed. Hosted maintenance/mailbox tests:
208 passed. Both affected package typechecks passed. Complexity guard passes
with unchanged hotspot debt and maxima. Synthetic upstream-pending history
still fetches no resource data and retries after 24 hours; upstream success
still imports and completes coverage. Hosted log parser accepts all added
fields within its existing 32-key summary budget.

ReviewGPT round 1 passed on `13eefa37029751745f4fd987e2f8e5b0c8cbba37`.
The full snapshot covered all 11 changed files. Exact-turn model evidence
confirmed gpt-6-pro on the Hercules lane; response capture exceeded 270 seconds.
Parent review accepts the substantive provider, service, and log-parser audit:
no accepted findings. All 33 applicable CI checks passed on that authored head.

The diagnostic implementation stage is complete. Protected full runner
deployment remains blocked by Cloudflare account vCPU quota, independently
documented in PR #3071. The failed release stopped before activation. A
Worker-only release cannot ship these runner diagnostics. Live cycle
resolution remains an explicit follow-on requirement after capacity admission.
Completed: 2026-09-08
