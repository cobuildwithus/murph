# PR 570 Percentage Usage Follow-up

## Outcome

PR #570 communicates monthly allowance consumption consistently as a percentage
across member-facing conversation/outbound messages and hosted web UI. Exact
currency amounts remain internal billing inputs and do not appear as usage
progress copy.

## Scope

- Merge current `origin/main` into the PR head and resolve conflicts
  semantically.
- Inventory every member-facing usage string and formatter in the PR patch.
- Derive one bounded percentage from the existing usage/allowance owner data.
- Render the same percentage semantics in assistant tool output, outbound
  notices, the home limit banner, and hosted billing settings.
- Update focused tests and durable hosted-plan-usage documentation.
- Run scoped/full verification, mandatory specialist audits, exact-head CI,
  and ReviewGPT before returning the PR to ready state.

## Invariants

- Currency-denominated usage and allowance data remain available only to the
  internal metering/billing owners that require them.
- Percentages are finite, non-negative, and understandable at zero allowance
  and overage boundaries.
- Usage gating, sponsorship authority, and billing-period ownership do not
  change.
- iMessage/SMS copy remains conversational and does not become broadcast-shaped.

## Completion

- [x] Latest `origin/main` merged and conflicts resolved.
- [x] UI and conversation/outbound usage progress use percentage language.
- [x] Focused tests and direct stale-string checks pass.
- [x] Required local audits have no accepted findings.
- [x] Scoped/full verification passes.
- [ ] Commit is pushed to PR #570 and exact-head CI plus ReviewGPT are green.
- [ ] PR is merge-ready but remains unmerged under the current user instruction.

## Local Completion Evidence

- Focused percentage proof: 144 web tests, 6 assistant-engine tests, 4
  hosted-execution tests, and 2 Cloudflare port tests passed.
- `pnpm --dir apps/web verify` passed dev smoke, lint with warnings only,
  4,922 tests, TypeScript, and the production build.
- The diff-aware lane passed repository guards and reverse-dependent typechecks.
  Its parallel package phase exposed one unrelated `origin/main` CLI workflow-doc
  assertion and a warm-process timeout cascade; the affected assistant file
  passed all 177 tests in isolation.
- Security/privacy review found no medium-or-higher findings. Coverage review
  found the existing proof sufficient and made no edits. One low frontend
  concern about the deliberately uncertainty-qualified usage forecast was
  rejected because the durable product contract requires the bounded forecast,
  it appears only after enough observed usage, and it does not imply cutoff,
  shame, or unauthorized upgrade pressure.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
