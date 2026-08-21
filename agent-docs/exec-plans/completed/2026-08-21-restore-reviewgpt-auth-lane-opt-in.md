# Restore authenticated ReviewGPT lane default

Status: completed
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Keep automatic ReviewGPT submissions on the four portable, provisioned
  browser lanes unless a host explicitly opts into the additional lanes.

## Success criteria

- The default automatic pool contains Eragon, Phlebas, Hercules, and Mountain.
- Vonneumann and Apollo remain available through an explicit lane selection or
  `REVIEW_GPT_BROWSER_LANE_COUNT=5|6`.
- Focused configuration tests and the CLI release-coverage assertion agree with
  the restored default.
- Current operating guidance again describes the extra lanes as host opt-ins.

## Scope

- In scope: Murph's ReviewGPT lane-count default, its focused tests, and current
  operator documentation.
- Out of scope: browser profile contents, ChatGPT account state, ReviewGPT
  package automation, or changes to the six supported lane definitions.

## Constraints

- Technical constraints: preserve per-invocation and local-config precedence,
  lane ordering, explicit Apollo support, and the accepted count range of 1-6.
- Product/process constraints: keep machine-local authentication and account
  state out of committed evidence; use synthetic fixtures only.

## Risks and mitigations

1. Risk: restoring the portable default could accidentally remove explicit
   access to the fifth and sixth lanes.
   Mitigation: keep the six-lane map and bounds unchanged and cover explicit
   five- and six-lane opt-in behavior.

## Tasks

1. Restore the four-lane default and align focused assertions and docs.
2. Run the focused ReviewGPT configuration and release-coverage tests plus
   shell syntax and typecheck.
3. Inspect the complete diff, commit and push the exact candidate, run the
   required preliminary coverage review with CI, resolve findings, and close
   the plan through the scoped finish helper.

## Decisions

- Revert the default expansion rather than inspect browser cookies in the lane
  selector. Authentication remains machine-local profile state, and the
  existing explicit count is already the intended provisioning boundary.
- Treat the change as internal operator tooling: Product UX, prompt, and
  frontend review are not applicable; the preliminary coverage lens applies.

## Verification

- Commands to run: focused Vitest files for ReviewGPT configuration and CLI
  release coverage, `bash -n scripts/review-gpt.config.sh`, package typecheck,
  `git diff --check`, exact-head CI, and current-base merge-tree proof.
- Expected outcomes: default count/pool assertions report four lanes; explicit
  counts five and six still select the additional lanes; all checks pass.
- Local results: focused ReviewGPT config tests (5 passed), focused CLI release
  coverage (45 passed, 1 skipped), shell syntax, CLI package typecheck, and the
  isolated storage-guard retry all passed. The broader diff lane found two
  unchanged workspace-boundary violations and one unrelated storage-guard
  timeout; the timed-out test passed alone in 3 seconds.

## Completion review

- The exact-head preliminary completion-specialists review applied the coverage
  lens and returned `PASS` with zero findings and no patch artifact. Product UX,
  prompt, and frontend lenses were correctly not applicable.
- Parent diff review confirmed the implementation only restores the fallback
  count. The six-lane map, explicit lane selection, count precedence, validation
  bounds, and five- and six-lane opt-in coverage remain unchanged.
- The preliminary pushed head passed its available repository checks while the
  remaining hosted checks were still running. The plan-closure commit requires
  a fresh exact-head CI read and current-base merge-tree proof before handoff.
Completed: 2026-08-21
