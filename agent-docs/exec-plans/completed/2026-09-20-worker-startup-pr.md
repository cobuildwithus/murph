# Reduce Worker startup initialization and prepare the PR

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Outcome and invariants

Measure remaining Worker initialization after incorporating the current base. Keep only demonstrated simplifications. Preserve validation, authentication, route behavior, container exports, and package ownership. Open the PR, complete required review, and obtain green exact-head CI; do not merge or deploy.

## Approach and owner

The existing Worker bundle and package entrypoints own initialization. Inspect retained modules and CPU profiles before editing. Prefer deleting unnecessary import reachability over new lazy loaders, services, caches, or dependencies. Compare alternating fresh workerd profiles against the same base.

## Product UX and evidence

Internal initialization optimization; product behavior and provider input are unchanged. Use focused authentication, route, and resource tests, relevant typechecks, and actual emitted Worker smoke proof. Local profiling does not establish production typing latency. Review the full diff and run complexity and docs checks before the PR.

## Completion

The source candidate is complete. PR review and exact-head CI will be tracked on the PR. The prior completed plan remains historical evidence for the initial static-import change.

## Measured result

Merged current main `dc44a822ec` before comparison; its independent WebSocket simplification is present in every candidate. Five alternating fresh workerd profiles, using the same compatibility flags and active CPU calculation excluding idle samples:

| Candidate | Active CPU median | Emitted JavaScript bytes |
| --- | ---: | ---: |
| Current main | 178.708 ms | 3,958,774 |
| Static imports | 138.832 ms | 3,593,146 |
| Static imports plus pure authoring builders | 131.025 ms | 3,578,128 |
| Static imports plus minification experiment | 134.002 ms | 1,798,767 |

The final candidate reduces local startup CPU by 26.68% and emitted bytes by 9.62%. The three pure builder annotations reduce another 5.62% of CPU versus static imports alone. Raw timings vary with the local host, so compare candidates within this run; do not compare absolute values against the previous day's profiles or infer production latency savings.

Discarded a hosted-execution `sideEffects: false` experiment: less than 1 KB saved and no need to broaden package metadata. Discarded minification: the measured CPU saving was smaller than the source-only correction. Broader schema extraction would move substantial validation code; it is unnecessary for this bounded improvement.

## Final shape and verification

The existing card JSON Schema builders only allocate and return authoring objects. Standard pure-call annotations let consumers omit unused exports; they do not change validation or used schema values. No runtime logic, dependency, state, service, public export, or configuration was added.

- Focused Worker authentication, routing, and resource suites: 189 tests passed across five files.
- Operator-config response-card, challenge-card, and assistant CLI contract suites: 51 tests passed across three files.
- Cloudflare and operator-config typechecks passed.
- Real emitted workerd smoke: health 200, unauthenticated wake 401, unknown route 404.
- All eleven Worker exports remain identical; all three unused authoring schema factories are absent from the Worker bundle.
- Independently bundled authoring consumers before and after retain deeply identical JSON for all three exported schemas.
- `pnpm complexity:diff`, `pnpm docs:drift`, privacy scan, and `git diff --check` passed. No source hotspots exceed 20; complexity debt remains zero. Final diff review confirms only import reachability and pure-call hints changed.

Product UX: Ready; existing routes and card consumers retain their behavior. Provider-visible individual and group input is unchanged: no tool, prompt, or schema value changed. No real-Codex journey is needed for unchanged emitted schema objects.

Changelog: not applicable; internal initialization and bundling work with local performance evidence only. A production latency claim requires a separately authorized deployment and trace comparison.

Completed: 2026-09-20
