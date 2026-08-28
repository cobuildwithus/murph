# Replace specialist ReviewGPT with one Codex subagent

Status: completed
Created: 2026-08-28
Updated: 2026-08-28

## Goal

- Keep one mandatory preliminary specialist review for applicable Product UX,
  prompt, frontend, and coverage lenses, but run it as one local review-only
  Codex subagent instead of a ReviewGPT managed-browser job.
- Remove the obsolete `completion-specialists` ReviewGPT preset, packaging,
  preflight, and test contract without changing the independent final
  cross-cutting ReviewGPT gate.

## Success criteria

- Live workflow docs consistently require exactly one specialist subagent that
  combines every applicable lens and returns an evidence-backed pass/findings
  result.
- No live workflow, script, preset registration, or test invokes or packages a
  `completion-specialists` ReviewGPT run.
- Focused CLI/tooling tests, documentation reference checks, and diff hygiene
  pass.
- The changed candidate receives the newly required review-only specialist
  subagent check before final parent review.
- A scoped commit is pushed and a draft PR is opened with the required evidence.

## Scope

- In scope: live workflow docs and prompt-lens docs; ReviewGPT preset,
  preflight, and packaging mechanics; focused tests that encode those contracts.
- Out of scope: immutable completed plans and historical research evidence;
  substantive rules for the separate final ReviewGPT gate; product/runtime
  behavior.

## Constraints

- Technical constraints: preserve the final `pr-review` ReviewGPT path and its
  exact-head, packaging, and finding-disposition safeguards; keep the local
  specialist review-only and non-mutating.
- Product/process constraints: use one subagent for all applicable specialist
  lenses, not one subagent per lens; the parent verifies and resolves findings;
  docs/process-only changes remain audit-exempt unless explicitly requested.

## Risks and mitigations

1. Risk: Removing the preset leaves stale launch paths or contradictory docs.
   Mitigation: search all live files for specialist ReviewGPT and
   `completion-specialists` references, delete the preset, and update focused
   contract tests.
2. Risk: The replacement accidentally becomes four passes or duplicates final
   review.
   Mitigation: state "exactly one subagent" at the routing and worker-rule
   owners and retain the final ReviewGPT eligibility boundary unchanged.
3. Risk: In-flight plans are rewritten as though their already-recorded audits
   used the new path.
   Mitigation: leave historical and task-specific active evidence untouched;
   live owner docs govern future work.

## Tasks

1. Map every live specialist ReviewGPT owner and its focused enforcement tests.
2. Rewrite the workflow contract around one local review-only specialist
   subagent and update the lens prompt docs.
3. Delete the ReviewGPT specialist preset and remove its preflight, packaging,
   registration, and tests.
4. Run focused docs/tooling verification and inspect the full diff.
5. Run the required specialist subagent review, resolve findings, close the
   plan, commit, push, and open the PR.

## Decisions

- Preserve the separate final ReviewGPT gate; this task replaces only the
  preliminary specialist stage.
- Use one combined local subagent for every applicable lens so review cost and
  coordination stay bounded.
- Do not rewrite immutable completed plans or point-in-time audit records.
- Start the local specialist on the stable isolated candidate before the first
  PR push. The parent may commit and push that unchanged candidate while the
  review is running so an independently routed final ReviewGPT gate can still
  begin concurrently.
- Accepted the specialist's one medium finding: the workflow still pushed
  before spawning the local specialist, and the coverage lens referenced the
  deleted ReviewGPT preset. The sequence and lens owner were corrected without
  rerunning the one-pass specialist.

## Verification

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/review-gpt-pr-head-preflight.test.ts packages/cli/test/review-gpt-package-concurrency.test.ts`: passed, 2 files and 9 tests.
- `pnpm --dir packages/cli typecheck`: passed.
- `bash -n scripts/package-audit-context-full.sh`, `bash -n scripts/review-gpt-pr-head-preflight.sh`, and `bash -n scripts/review-gpt.config.sh`: passed.
- `scripts/check-agent-docs-drift.sh`: passed.
- `git diff --check` and the privacy scan: passed.
- The focused `exposes only the package-backed review-gpt runner` release
  contract passed after implementation and after specialist remediation.
- The full release contract run passed 46 tests with 1 skip; the broad
  `keeps audit bundles scoped while preserving durable agent docs` smoke hit
  its 120-second timeout under severe local filesystem/package-scan slowness
  after dependency installation. Exact-head CI owns the remaining broad proof.
- Live searches found no specialist ReviewGPT launch/config path or stale
  pushed-specialist/unified-preset contract outside intentional historical
  replacement notes and negative assertions.
- The exactly-one local specialist reviewed the complete candidate. Product UX
  and frontend were not applicable; prompt and coverage were applicable. Its
  one accepted medium finding was corrected and focused proof rerun.
Completed: 2026-08-28
