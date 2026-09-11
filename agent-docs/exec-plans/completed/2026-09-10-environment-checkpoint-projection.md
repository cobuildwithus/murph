# Settle Environment completion before clean runtime return

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Preserve concurrent Environment completion when the foreground pass is already clean, so canonical Habitat changes reach durable mailbox handling and browser publication.

## Success criteria

- Synthetic regression proves the actual completion path before and after the change.
- Successful Environment work reaches a durable handled watermark and browser publication.
- Real projection failures retain their existing mailbox retry.
- Focused tests, package typecheck, complexity, and documentation checks pass.

## Scope

- Runtime clean-return ordering, deterministic regression, and the runtime owner documentation.
- No deployment, production mutation, fixture changes owned by other tasks, new scheduling, or durable state.

## Cause and decision

A fast clean foreground pass can return while independent Environment work is still completing. The finalizer then settles that work after the return result has already been chosen. The baseline regression applies Habitat and leaves its item recording, while returning idle without a wake or durable handled watermark.

The existing final clean-return block now quiesces the system-work owner after closing detached work and before choosing the dirty checkpoint loop. Late writes and completion callbacks can therefore mark the runtime dirty in time for its ordinary checkpoint, recording, and browser publication path. This happens after initial foreground work, so the hot reply start path is unchanged.

Missing projection results during handoff or shutdown are legitimate deferral and were not changed. A real projection error still retains the recording item with a 60-second retry; the combined runtime wake may be earlier. No extra state or retry owner was added.

## Verification

- Baseline regression failed with Environment recording, no handled watermark, no idle checkpoint, and an idle/null-wake result.
- The repaired regression passes with canonical Habitat data, durable handling, and one real browser publication.
- The negative regression preserves recording and the existing projection-failure retry.
- Focused adjacent concurrency, checkpoint-wake, scheduling, and preemption tests: 97/97 passed across five files. The final two-case regression also passes after adding an explicit no-model-call assertion.
- Assistant-runtime package typecheck: passed on the final source placement.
- Complexity and documentation checks: passed. Complexity debt and maximum function complexity are unchanged.

## Handoff boundaries

Root owns final candidate review, PR, changelog fragment, and release. The member-visible reliability change warrants a changelog entry in that PR. No live-model proof is needed: Environment processing and checkpoint completion here are deterministic and model-free. The prior managed-run failure attribution remains unproven; this commit fixes the independently reproduced clean-return race.

## Developer friction

Existing Frog entries cover previously observed stale skill guidance. No new repository tooling workaround was required.

## Commands

- `pnpm install --frozen-lockfile --prefer-offline`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-environment-completion.integration.test.ts test/hosted-runtime-concurrent-device-import.integration.test.ts test/hosted-runtime-workspace-entrypoint-checkpoint-wakes.test.ts test/hosted-runtime-workspace-entrypoint-scheduling.test.ts test/hosted-runtime-workspace-entrypoint-system-preemption.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm complexity:diff --base 4e57ffdbfcea757b50de0c7ed4215e6dffe53253 -- packages/assistant-runtime/src/hosted-runtime.ts`
- `bash scripts/check-agent-docs-drift.sh`
- `git diff --cached --check`
Completed: 2026-09-10
