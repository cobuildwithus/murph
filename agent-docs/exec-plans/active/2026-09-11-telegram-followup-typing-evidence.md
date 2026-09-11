# Telegram follow-up typing evidence

Status: active
Created: 2026-09-11

## Outcome and invariant

Resume PR #3252 at `6b5f6a3207a2c9d2dac0b6d5c1df222b35d3044f` after the
user accepted the round-2 remediation handoff. Telegram inputs imported during
an active typing session must inherit acceptance for their exact target and
input. Preserve provider calls, asynchronous telemetry, and store scoping.

## Cause and smallest correction

The engine starts typing once per turn. The importer already inherits Linq
acceptance, but Telegram has no equivalent observation. Extend channel-activity's
ephemeral typing evidence and its import handoff; retire observations on stop
and abort. The existing trace and alert ledger remain the durable owners.
No schema, provider policy, prompt, or delivery behavior changes are needed.

## Proof and completion

1. Reproduce the missing milestone through the real Telegram provider wrapper
   and mailbox importer with synthetic HTTP, including later active-turn input.
2. Cover unrelated targets, stop, abort, failed starts, and overlapping handles.
   Keep existing slow/missing acceptance and deduplication SQL proof.
3. Run focused runtime tests, runtime typecheck, complexity and documentation
   guards. Review privacy, lifetime ownership, and unchanged provider calls.
4. Commit and push, mark Ready, and run substantive ReviewGPT round 3 in the
   existing Hercules conversation alongside exact-head CI. Follow finding
   disposition and the three-round cap; merging and deployment are separate.

## Progress

- PR head, clean owning worktree, handoff, and round-2 evidence match.
- The new composed regression failed before the fix: only the first Telegram
  input had acceptance. After remediation, all 192 focused channel/import/workspace
  tests pass; the final nullable-conversation test guard was rechecked in the five
  focused follow-up scenarios.
- Real PostgreSQL alert proof: 4 passed, including inherited pre-receipt Telegram
  acceptance, genuine missing/slow evidence, immutable retries and deduplication.
- Runtime and Web typechecks, complexity guard, docs drift and diff checks pass.
  Existing complexity hotspots are unchanged. Parent candidate review found no
  further issue; provider calls and telemetry scheduling remain unchanged.
- Internal-only change: no changelog or live model journey applies because no
  prompt, tool, reply, or provider-input behavior changed.
- Round 3 on `6c59c0a0549f6dffca07db0ac649751d59237e0d` confirmed the
  pending-start ordering remains uncovered. User resumed the correction and
  explicitly authorized a fourth review on 2026-09-11.
- Retrospective: sampling only resolved timestamps missed an in-flight transition.
  The existing handoff now exposes the pending acceptance promise; staged imports
  observe its result asynchronously. The identical Linq omission was reproduced
  and corrected at the same existing owner. No queue, durable owner or retry loop.
- Both real-provider pending-start regressions failed against the previous head
  (only initial input acceptance), and pass with the correction.
- Final focused proof: 208 runtime tests and 4 PostgreSQL alert tests pass.
  Runtime typecheck, complexity, docs drift and diff checks pass. Pending starts
  resolve at simulated 1,000 ms or 3,001 ms with the original timestamp retained;
  failed/aborted starts and unrelated targets supply no inherited acceptance.
  Pending predecessor completion and stop cannot erase a newer Telegram session.
- Parent candidate review confirms no extra provider call, foreground wait on
  telemetry, persistent owner, queue or retry. Existing Linq cooldown is preserved.
- Previous-head CI failures were unrelated: the canary fixture freshness fix
  landed on main in #3264; private compatibility failed installing Temporal CLI
  with ECONNRESET before any reader proof. New exact-head CI must prove both.
- Round 4 and exact-head CI remain pending on the next pushed candidate.
