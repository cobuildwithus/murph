# Group sleep live diagnostics

Status: active
Created: 2026-08-10
Updated: 2026-08-10

## Goal

- Make group sleep-challenge answers reflect the current consented shared read.
- Keep device-source status fields coherent when historical and current
  connections use the same public label.
- Treat an already reported same-day Deep or REM sleep value as scoreable while
  continuing to reject future-dated rows.

## Proven production symptom

- A live shared device diagnostic combined the newest sync timestamp with an
  older disconnected status for the same public source label.
- The shared sleep-stage projection marked a reported current-local-day value
  provisional solely because the calendar day had not ended.
- An explicit freshness question was answered without a new shared read, so the
  assistant relied on older conversation context instead of current authority.
- The provider wake and hosted import lanes completed, while the consented
  source-aware Deep sleep snapshot remained an observed empty set. Live
  container inspection is tracked separately because local Wrangler OAuth is
  currently unavailable.

## Success criteria

- Duplicate public device labels select one complete observation; status,
  observation time, and connection-wide sync time cannot come from different
  connection generations.
- Current-local-day Deep and REM rows are available without a provisional flag;
  future-dated rows remain excluded.
- A user asking whether shared data is visible now or yet causes one fresh
  `read_shared` call for the exact relevant scope at the group-authorized answer
  model before Murph answers, including a detached group consultation requested
  from the user's private Murph conversation.
- Product and protocol docs describe the same behavior as code.
- Focused regressions, package typechecks, preliminary specialist review, final
  ReviewGPT, exact-head CI, and parent final review complete with no unresolved
  accepted findings.

## Constraints

- Preserve consent and current exact-scope authority; no pre-model group read.
- Keep raw provider payloads, health values, identifiers, transcript wording,
  and screenshots out of repository artifacts.
- Add no state owner, queue, service, dependency, or compatibility layer.
- Keep live-container debugging read-only and do not redeploy merely to add an
  SSH key.

## Tasks

1. [x] Trace production control-plane, projection, and runtime evidence to the
   current code owners.
2. [x] Add focused failing regressions for coherent source selection,
   same-day sleep scoring, and explicit freshness reads.
3. [x] Implement the smallest owner-local fixes and align durable docs.
4. [x] Run focused tests, package typechecks, and direct diff/privacy review.
5. [x] Push the exact candidate, open the PR, and start specialist/final
   ReviewGPT concurrently with CI.
6. [ ] Resolve accepted findings, close this plan through `scripts/finish-task`,
   merge the green PR, verify deployment behavior, and retire the worktree.

## Verification log

- Before implementation, the focused regressions failed on the hybrid
  disconnected/current source record, the calendar-only provisional flag, and
  the missing explicit-freshness prompt contract.
- Web group shared-read, store, and tool suites: 247 tests passed.
- Assistant Engine group-tool and capability-prompt suites: 114 tests passed.
- Assistant Runtime vault-share projection and shared-reader suites: 103 tests
  passed, including aggregate/source-aware current-day scoring and future-date
  rejection.
- Web, Assistant Engine, and Assistant Runtime typechecks passed.
- Scoped Web ESLint and `pnpm docs:drift` passed.
- `git diff --check` and a current-diff confidential-evidence scan passed.
- Live Wrangler SSH remains blocked by expired local OAuth; the no-browser
  authorization window expired without a callback, and no container command or
  production mutation ran.
- Final ReviewGPT round 2 required a retrospective after proving that the
  detached joined-group Assistant Ask child was a second answer owner without
  the freshness rule. The recorded continuation decision keeps one shared
  instruction at both group-authorized model boundaries, leaves the private
  root on `ask`, and replaces admission-only coverage with target-owner proof.
