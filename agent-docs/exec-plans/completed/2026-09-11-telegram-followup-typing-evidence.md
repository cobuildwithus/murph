# Telegram follow-up typing evidence

Status: completed
Created: 2026-09-11

## Outcome and invariant

Resume PR #3252 at `6b5f6a3207a2c9d2dac0b6d5c1df222b35d3044f` after the
user accepted the round-2 remediation handoff. Telegram inputs imported during
an active typing session must inherit acceptance for their exact target and
input. Preserve provider calls, asynchronous telemetry, and store scoping.

## Cause and smallest correction

Round 4 exposed an earlier ordering: an import during receipt preparation occurs
before any typing tracker exists. The user resumed work and requested complexity
collapse, explicitly continuing remediation and the next review round.

Move accepted typing evidence to the engine's existing turn handle and accepted
input journal. Admission observes the handle's readiness promise without waiting
on telemetry. The provider handle exposes its existing active state so stop,
abort, expiry and refresh failure remain authoritative. Hosted code only translates
this callback into existing trace milestones. Remove global typing telemetry,
pending-acceptance state and the mailbox importer handoff; preserve Linq's original
provider cooldown. No new durable state, timers, provider calls or database reads.

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

- Round 4 on `693e05ab9215a1e3d0940a1b12efffb4943a1f82` confirmed
  pre-start imports lack evidence; all required CI passed on that head.
- Retrospective: successive import-time samples followed timing cases instead
  of canonical turn membership. The correction collapses ownership into the
  engine handle and journal; focused proof now exercises actual pre-provider
  admission after an input is staged during receipt preparation.

- Complexity collapse removes 65 net production lines: both global telemetry
  readers, Telegram target tracking, pending-acceptance state and import handoff
  are gone. Linq's pre-existing provider cooldown map remains unchanged.
- Four pre-start regressions fail without the journal-to-handle wiring and pass
  with it. The live-steering test observes evidence before provider completion.
- Focused proof: 186 hosted runtime tests, 158 engine tests, and 29 provider
  helper tests pass; final observer-lifetime cases and changed admission probes
  are rechecked after the last edits. Engine, runtime and operator-config
  typechecks pass. Complexity guard reports no added debt across 19 source files;
  existing hotspots remain unchanged. Documentation drift and diff checks pass.
- Parent review confirms canonical admission and provider lifecycle ownership,
  exact opaque IDs/source/attempt scoping, and no additional provider call, timer,
  foreground wait or durable owner. Prior local PostgreSQL threshold, missing
  evidence, retry and deduplication proof is unchanged by this producer-only edit.
- User continuation authorizes substantive round 5 after the prior cap pause.
  Start on the stable pushed candidate alongside exact-head CI.

- Round 5 passed on `ca7707051ec728fa607ce1a0e69e28c1ac7f563e`.
  Requested/captured model: `gpt-6-pro`; exact committed user turn and response
  hash match. The 45-file full snapshot and attachment were confirmed. Capture
  completed after 680 seconds; the reviewer independently exercised 26 telemetry
  scenarios and 9 provider lifetime scenarios, and verified all postimage hashes.
  Response SHA-256: `f70aa0bd4e6a47b13e1c4b8fbd7adb9b46ce04a06381155a5e46ba6b675bf3df`.
  All prior accepted findings are resolved; parent triage has zero open findings.
- Necessary base reconciliation imports `99bb576ece91494a766eaf49c8a8bfa228d7995b`.
  RELIABILITY retains both independent sections; the index retains both sets of
  owner descriptions. The cron route mechanically combines this PR's typing
  monitor with main's starter-abuse monitor, preserving both calls, result slots,
  error checks and response fields; its test retains both mocks. No new behavior
  is authored by conflict resolution. Both sides were compared hunk by hunk.
- Base-update proof: all 5 cron tests and 72 mailbox-import tests pass; Web and
  runtime typechecks pass. The reviewed typing implementation is unchanged.
  The base-update-only exception applies; no further substantive review is needed.
- Updated the explanatory reliability text to describe the reviewed turn owner
  and removed references to the deleted telemetry maps. Implementation and review
  are complete; final exact-head CI is tracked in the PR evidence before handoff.
Updated: 2026-09-11
Completed: 2026-09-11
