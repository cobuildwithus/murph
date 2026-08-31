# Bounded Ops stalled-runtime rechecks

Status: active
Created: 2026-08-31
Updated: 2026-08-31

## Goal

- Give an authorized operator a reusable bounded control on
  `/ops/runtime-maintenance` that accepts member ids and sends one payload-free
  runtime recheck to each selected runtime. Seed the control from a discovery
  list using the proven legacy device-sync stall signature. Reuse the existing
  progress-health predicate and Temporal signal; add no mailbox item,
  scheduler, queue, schema, or durable recovery owner.

## Success criteria

- The page shows the current active legacy device-sync stall cohort with its
  aggregate count, per-runtime pending count, and stall start time.
- The operator can paste comma- or newline-separated member ids. One explicit
  action rechecks at most three normalized, deduplicated ids sequentially,
  stops on the first signal failure, and removes only acknowledged ids so a
  failed or unsent id remains retryable.
- Candidate selection uses the runtime-progress monitor's existing 15-minute,
  retention, mailbox-high-water, and active-access rules.
- The operation sends `runtime_recheck_requested` only. It never appends work,
  resets usage, or changes canonical workspace/mailbox state.
- Focused service, route, selector, UI, typecheck, lint, and rendered proof pass.

## Scope

- In scope: the existing runtime-maintenance page and API, reusable legacy
  device-sync stall candidate selection, focused tests, and a synthetic design
  representation.
- Out of scope: automatic fleet recovery, new monitoring state, mailbox repair,
  usage changes, direct production mutation during development, or changes to
  Temporal/Cloudflare runtime behavior.

## Constraints

- Technical constraints: keep scans bounded by the existing progress monitor;
  keep provider calls outside database work; signal sequentially; preserve the
  current ops allowlist and same-origin mutation gate; return only the minimum
  operator diagnostics; tolerate recovery between selection and signal.
- Product/process constraints: Feature-level Product UX because this adds an
  operator action surface. The user explicitly approved adding it to this page.
  Keep the action visually and semantically distinct from maintenance wakes,
  which append mailbox work.

## Risks and mitigations

1. Risk: a duplicated predicate targets the wrong runtimes after the monitor
   evolves.
   Mitigation: factor and reuse the monitor's active alertable-row reader.
2. Risk: repeated clicks create noisy duplicate wake signals.
   Mitigation: cap each batch at three, advance only past successful signals,
   and clearly show the current queue and result; the signal itself is
   payload-free and creates no work authority.
3. Risk: a discovered runtime recovers before the operator sends the signal.
   Mitigation: the payload-free recheck only asks the workflow to reread
   canonical facts; manually entered ids pass the existing active-access gate.
4. Risk: a failing signal hides untouched ids.
   Mitigation: stop on the first failure and remove only acknowledged ids from
   the operator's input.

## Tasks

1. Extract one bounded active alertable-row reader from the current progress
   monitor without changing alert semantics.
2. Add a legacy device-sync stall overview and a generic bounded member-id
   recheck operation to the existing authenticated route and service, reusing
   the payload-free signal.
3. Add the distinct stalled-runtime section and result states to the existing
   page, plus a production-component design study.
4. Add focused selector, service, route, and UI-facing contract tests.
5. Run focused verification, Product UX walkthrough, rendered/browser proof,
   final cross-cutting review, exact-head CI, merge, deploy, and live aggregate
   verification.

## Decisions

- Keep the existing mailbox-appending maintenance wake untouched. A strict
  operation discriminator on the existing route/service prevents the new
  action from falling through to that different authority.
- Keep candidate discovery separate from effect authority. The read path finds
  the incident cohort; the mutation accepts at most three explicit ids and the
  existing signal path independently revalidates active runtime access.
- Target only valid active stalled `system` lanes whose pending head is
  `device-sync.wake`, whose overdue wake reason is `device-sync.reconcile`, and
  whose default-processing wake and system-progress generation remain absent.
  These durable facts identify the proven legacy projection without a brittle
  deployment timestamp or `updated_at` cutoff.
- Sort the operator cohort by runtime id for a simple stable cursor. The
  selector still reports the canonical progress origin for diagnosis.

## Product UX plan

- Outcome: an authorized operator can identify the proven legacy device-sync
  stalls or paste ids for another incident, then safely request runtime
  rechecks without manually searching unrelated workspaces.
- Entry and promise: the operator opens Runtime maintenance, loads the freshly
  generated legacy device-sync cohort or pastes comma/newline-separated ids,
  and explicitly sends up to three rechecks. The page reports accepted/failed
  signals immediately; actual recovery remains observable only after a later
  checkpoint/progress refresh.
- Affected people: an operator with candidates, an operator after the cohort
  drains, and an operator whose batch partially fails. Members see no new
  surface, message, mailbox work, or usage change.
- Recovery: failed signals remain retryable; recovered runtimes disappear on a
  fresh read; scan truncation is visible and does not claim a complete fleet.
- Done when: all states are truthful, the control cannot imply that signal
  acceptance equals runtime recovery, and the operator can work through the
  current bounded cohort without repeating successful rows in one session.

## Verification

- Passed: 71 focused Vitest cases covering the progress selector, generic
  recheck service and route, payload-free signal boundary, and UI states.
- Passed: the six-case PostgreSQL progress-monitor boundary suite against an
  isolated migrated development database; the database was removed afterward.
- Passed: Hosted Web typecheck, scoped ESLint, `git diff --check`, and the
  changed-file privacy/identifier scan.
- Ready: desktop and 390px browser walkthroughs of the production-component
  design study, including populated and partial-failure states. The mobile
  result has no horizontal overflow; the empty and pending/error states are
  covered by focused rendered tests.
- Pending: required exact-head GitHub Actions, final ReviewGPT, merge, deploy,
  and live read-only verification.
