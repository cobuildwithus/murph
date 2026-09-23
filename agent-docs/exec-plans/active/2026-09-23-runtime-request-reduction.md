# Reduce unnecessary runtime HTTP requests

Status: active
Created: 2026-09-23
Updated: 2026-09-23

## Outcome and protected invariants

Reduce avoidable hosted HTTP requests from ineligible scheduled outreach,
repeated startup reconciliation, telemetry, and redundant ownership checks.
Preserve authorized reminders, foreground replies, silent maintenance, device
sync, exact runtime authority, diagnostic failures, and recoverable scheduling.

## Ownership and approach

The engine owns canonical cron eligibility and its derived wake projection;
Web owns current delivery policy; Temporal owns durable timers; the Worker
owns execution admission and callback transport. Extend those boundaries.
Do not add a scheduler, durable pause, cache, queue, or independent authority.

Existing code proves that wake projection omits some deterministic gates while
execution checks them later, startup retries use a fixed short delay inside a
longer preserved-start window, and effect transport performs separate ownership
callbacks. Existing log and latency batching must be reused before adding work.
Use synthetic regression scenarios; retain no private diagnostic evidence here.

## Tasks

1. Trace wake suppression and reactivation through existing policy and projection.
2. Derive startup retries from the existing owner deadline.
3. Remove or consolidate redundant callbacks at their current owners without
   weakening stale-attempt rejection or diagnostic delivery.
4. Add focused composed regression and request-count proof, run typechecks,
   review the diff and complexity, update owner documentation, and commit.
5. Complete the applicable external review and exact-head verification lane.

## Product UX

Outcome: identical useful deliveries and silence with less background work.
Reaches: engagement-paused outreach, active recurring and one-shot reminders,
reactivation by inbound input, silent maintenance, startup delay and recovery.
Proof: production scheduling/transport boundaries with synthetic fixtures;
focused real-assistant proof. Verdict: Ready after deterministic and live replay.

## Failure and evolution

Unknown eligibility retains its timer. Running claims, pending delivery and
retries retain recovery authority. New inbound work must refresh eligibility.
Time never proves a runtime stopped. Callback consolidation keeps transaction
and exact-attempt validation at the canonical effect owner. Reader/writer skew
and retained warm containers require explicit compatibility proof if contracts
change. No production mutation is included in implementation verification.

## Verification

Select focused engine/runtime/Worker/Web tests after tracing the touched seams.
Run affected typechecks, complexity diff, documentation and privacy checks.
Record commands, results, deployment boundaries, and remaining evidence here.

## Implementation and candidate review

- Derived recurring Linq wake eligibility from the existing authority-only
  delivery preflight. Shared the existing idle/recovery predicate; deduplicated
  targets within one status read and capped new reads at four, serially. Excess
  targets and uncertain results keep their ordinary wake. No durable pause.
- Preserved startup ownership until the existing 30-second deadline, with an
  earlier independent wake still able to reach a ready child.
- Reused settled `complete` for receipt recovery: two Web owner commands become
  one, after the same exact receipt and inactive-fence proofs.
- Extended the existing bounded milestone envelope to runtime milestones.
  Three simultaneous checkpoint-source requests become one; timestamps,
  per-event persistence, attempt fencing and best-effort failure semantics stay
  with their existing owners. Existing log batching and write-fence checks stay
  intact because removing them would weaken diagnostic or effect authority.
- Source review found no new state owner, schema, queue, timer, dependency or
  background loop. Complexity guard passes with no increased debt. Existing
  large orchestration functions are unchanged except callback extraction;
  broad refactoring would obscure this bounded behavior change.
- Changelog: internal-only request reduction. Existing delivery policy and
  member-visible reminder behavior are preserved.

Focused proof covers engagement-paused and reactivated recurring outreach;
one-shot, other-channel, running, pending-delivery, retry, silent-maintenance,
provider-health/opt-out, transient-policy and excess-target paths; earlier ready wakes; lost completion
and stale authority; milestone batch counts and attempt validation. The hosted
phase test proves recipient policy remains after foreground delivery.

Focused suites passed: engine cron (256 plus the new bound case), runtime
milestone/delivery/managed automation (135), Worker processing (33), shared
protocol (43), and Web callback routes (122): 690 distinct deterministic cases.
The extended post-delivery wiring case also passed separately. Fresh-worktree
Web tests required the existing
`pnpm --dir apps/web prisma:generate` preparation. All four affected package
typechecks passed, including the final engine/runtime rerun and Web typecheck.
`pnpm complexity:diff`, `pnpm docs:drift`, diff whitespace and added-content
privacy checks passed.

The focused real-Codex canonical reminder journey passed with gpt-6-sol and
local subscription auth, covering suppression, reactivation, one queued send,
reconciliation and cancellation. Command: `pnpm test:assistant:live -- --test
'real model canonical reminder create fire and cancel' --model gpt-6-sol`
with the supported alternate-profile option. Three model turns created the
saved reminder, produced one concise delivery, and cancelled it; canonical
state and outbox assertions passed. The actual synthetic replies were reviewed:
truthful confirmation, one reminder, clear cancellation; UX verdict Ready.

Initial local profiles failed authentication or quota before producing a model
response. The first authenticated run then exposed missing built CLI artifacts
in the fresh worktree. After `pnpm --filter @murphai/murph...
--workspace-concurrency=1 build` and `node scripts/assemble-assistant-cli-surface.mjs`,
the same profile passed. No credentials were copied. The missing CLI preflight
is recorded in `.agents/friction-log/20260923093310-canonical-live-assistant/friction.md`.
It is a proof-preparation issue, independent of the production change.

Candidate: PR #3669. Initial exact-head CI passed (36 successful checks, three
skipped); the draft-only guard failures were resolved by readying the candidate.
The corrected candidate requires round 2 review and fresh exact-head CI.

Parent recovery review narrowed suppression to inactivity. Provider opt-out is
derived from chat health; `syncHostedLinqChatHealthInventory` can replace that
status without an inbound message or cron wake. A timer removed while opted out
could therefore remain absent after recovery. Retain its existing timer instead
of adding a health-to-cron signaling owner. The regression checks that opt-out
keeps the canonical next run visible. This removes one suppression condition;
inactivity reactivation still uses the existing foreground projection refresh.
The new opt-out regression failed against the first candidate (missing next run)
and passed after removing that condition. All 11 focused wake cases, the engine
typecheck and complexity guard passed after correction. The live inactivity
journey remains applicable: its gate and model-facing path did not change.

Rollout: deploy the additive Web milestone parser before the runtime producer;
retain that consumer until new producers retire. Old singleton/assistant-batch
producers remain compatible with the new reader. Reverse skew can drop only
best-effort runtime telemetry. Completion uses the already-shipped settled
command; retained containers keep their existing callback. Production request
counts and latency still require post-deploy measurement. No deployment here.

ReviewGPT round 1 reviewed `1054993a6bb8c82c27bb23e0639cd053f1ac4801`
with verified gpt-6-pro and found one High issue: optional policy reads in the
normal timer preflight ignored foreground yield, potentially waiting for four
transport timeouts before admitting an inbound turn. Accepted. Forward the
existing status yield predicate and reuse the existing cron foreground
preemption lifetime, disposing it after projection. Abort the active read,
stop further reads and retain ordinary wakes when foreground work arrives.
This removes the unowned lookup lifetime without adding a cancellation owner.
Engine before/during-yield cases, real-engine ordinary hosted timer preflight,
and concurrent mailbox-import regression pass. The latter proves the actual
importer predicate aborts the active policy request. No prompt or reply change.

After remediation, the full engine cron suite passed (259 cases), along with
both hosted managed-automation and workspace-runner suites (200 cases). Engine
and runtime typechecks validate the final callback and fixture contracts.
