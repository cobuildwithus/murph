# Memory read failure diagnostics

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Goal and protected invariant

Distinguish an expected missing memory record from an invalid canonical memory
document in existing finite telemetry. Preserve errors, statuses, exits,
model-visible messages, reads, writes, retries and timing behavior exactly.
**The production cause remains unproven.** This is a deterministic classification
gap, not evidence of a member-facing behavior or argument/recovery defect.

## Evidence and decision

Base: `85f58ecd8214a43270a10c5e6d0f4ffd110db155` (supplied main snapshot).
The task's aggregate-only sweep reports one `memory show` error in 11 calls in
the latest 12-hour window, at `unknown/read`. Its independent Node 24 reproduction
used the real CLI entry, isolated synthetic files and fake provider ports; it
reported one datagram per process and unchanged output/exits. No member content
or original arguments were inspected. Local direct execution of the unmodified
portable normalizer also confirmed both codes collapse to `unknown/read`.

| Synthetic read | Existing CLI exit / result | Before timing | Required after timing |
| --- | --- | --- | --- |
| Empty vault, no id | 0 / empty document | Success, no failure | Unchanged |
| Missing record | 1 / `memory_not_found`, `read` | `unknown/read` | `memory_not_found/read` |
| Invalid canonical document | 1 / `memory_document_invalid`, `read` | `unknown/read` | `memory_document_invalid/read` |
| Valid record | 0 / exact synthetic record | Success, no failure | Unchanged |

## Scope and ownership

Extend only `runtime-state/src/cli-timing.ts`'s finite code list and the
assistant's existing `tool-failure-diagnostics.ts` category map. Use existing
`not_found` and `invalid_result` categories; no new parser, state owner, labels,
logs, transport, awaited hot-path work, configuration or dependency. Keep the
protocol schema unchanged. Memory persistence codes and all other observed
clusters, provider transport loss, replay, prompts and performance work are out
of scope. No member-facing change means no changelog entry or index repurposing.

## Tasks and proof

- [x] Trace real memory errors through CLI capture, portable normalization and
  the action runtime-issue reader; add only the two missing classifications.
- [x] Add real subprocess cases for empty/missing/invalid/valid reads, exactly one
  report, byte-identical telemetry-on/off output and exits, zero provider calls,
  unchanged filesystem, and forbidden-data exclusion. Reuse the existing child
  fixture; fake only its wall-clock Date so empty-document defaults are stable.
- [x] Add capture/normalization and actual action-issue regression assertions for
  exact admission, unknown variants, privacy, unchanged completions/deduplication,
  and an actual older-reader test (no copied production parser).
- [x] Update the durable vocabulary/rollout owner in
  `docs/hosted-runtime-log-database.md`.
- [ ] Parent: run focused verification/typechecks, review and commit the patch,
  open the PR, complete final review/CI and close this plan mechanically.

## Verification

Run in the parent checkout with Node >=24.14.1, the installed locked dependencies
and the named base available locally (no external/provider execution required):

```sh
MURPH_CLI_MEMORY_FAILURE_COMPAT_BASE=85f58ecd8214a43270a10c5e6d0f4ffd110db155 \
  pnpm exec vitest run --config packages/runtime-state/vitest.config.ts --no-coverage packages/runtime-state/test/cli-timing.test.ts
pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-timing-subprocess.test.ts packages/cli/test/cli-timing.test.ts packages/cli/test/memory.test.ts
pnpm exec vitest run --config packages/assistant-engine/vitest.config.ts --no-coverage packages/assistant-engine/test/assistant-tool-failure-diagnostics.test.ts packages/assistant-engine/test/cli-timing-profile.test.ts
pnpm --dir packages/runtime-state typecheck
pnpm --dir packages/assistant-engine typecheck
pnpm --dir packages/cli typecheck
pnpm complexity:diff
pnpm docs:drift
```

Author verification: baseline/current portable-source checks passed. A local
Node v22.16.0 test adapter ran the actual runtime-state assertion file: 20 passed,
1 history-gated test skipped (not a Vitest run). Direct loading of the original
archive reader proved new-code coalescing preserves counts/outcomes/phases;
original-versus-patched assistant classification preserved RPC content and rejected
13 unknown variants. Whitespace-strict patch application, byte-identical readback
and reverse-application checks passed. Date-only fixture clock and TypeScript syntax checks
passed, as did the portable source's standalone typecheck with available TypeScript.
Full Node 24 Vitest, CLI subprocess/action suites, Git-history compatibility,
package typechecks and repository guards have not run here: the snapshot lacks
installed dependencies and Git history, and pnpm is unavailable. No installation
or external system was invoked. The Frog wrapper likewise reports its missing
installation; no entry was created. Parent verification remains required.

## Reader-before-writer rollout and rollback

Deploy compatible portable normalization/usage/profile readers and the assistant
category reader before CLI writers. The older failure-aware reader must preserve
all counts, outcomes and phases while coalescing the two new `read` codes into
`unknown/read`; newer readers keep old reports readable without backfilling detail.
Warm old readers or a reader rollback lose specificity only, not timing/usage
validity. No authority rollback floor or protocol migration is introduced. Parent
owns rollout and any subsequent aggregate-only check; no production cause or
post-deploy outcome is claimed by this patch. Leave this plan active for that handoff.
Completed: 2026-09-13
