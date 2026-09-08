# Focus PR review on realistic serious bugs

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Make the PR review gate identify serious, realistically reachable bugs without
creating speculative edge-case, refactoring, or disclosure remediation loops.

## Scope and decisions

- Simplify the PR and follow-up prompts; preserve guarded evidence, ancestry,
  scope selection, prior-fix verification, and completion markers.
- Align the review runbook and completion references with the serious-bug bar.
- Keep the targeted exploratory presets and current model selection.
- Remove narrative wording assertions; retain protocol and executable routing,
  packaging, and response validation proof.
- Internal developer workflow only; no member-facing Product UX, runtime,
  provider-input, deployment, or changelog change.
- Final ReviewGPT is exempt under the docs/process and low-risk tooling route.

## Tasks

1. Rewrite and inspect prompts and their workflow owner.
2. Update focused contract tests and durable proof references.
3. Run focused CLI review-tool tests, package typecheck, and docs checks.
4. Review the complete candidate, archive this plan, commit, and open a PR.
5. Confirm required CI on the candidate and report the result.

## Risks and mitigation

- Avoid suppressing realistic rare security or destructive bugs: accept
  production-faithful code-path proof without requiring a prior incident.
- Avoid weakening artifact authority: keep exact-head, scope/ancestry, untrusted
  input, and output-marker contracts.
- Tests do not prove model judgment; read back both prompts against serious
  normal-path failures, practical exploits, and unsupported hypothetical cases.

## Verification

- Focused review-tool suite: 8 passed, covering preset contracts, config,
  browser/correction routing, and full/delta round packaging.
- CLI package typecheck: passed; no workspace import/build boundary changed.
- Docs drift and gardening: passed, zero issues. Shell syntax: passed.
- Complexity guard: passed; no authored production JS/TS changes.
- Parent readback: realistic normal-path failures and practical security/data
  loss remain eligible; unsupported compound failures, optional UX, refactoring,
  disclosure gaps, and size/round-only escalation are excluded.
- Response attestation/too-fast capture checks: 2 passed. Final readback: passed.
- Required exact-head CI will run after the PR is Ready.
Completed: 2026-09-04
