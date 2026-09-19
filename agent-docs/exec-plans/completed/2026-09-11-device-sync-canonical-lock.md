# Preserve device imports through canonical write contention

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Outcome and scope

Outcome: a temporary competing canonical writer must not discard an accepted device import.
Reaches: existing local and hosted device import jobs; no new provider requests or member messages.
Proof: synthetic real lock conflict through service failure transition, release and bounded retry to completion, with permanent failures and lock ownership preserved.

## Owner and evidence

Core owns canonical locking. The device service owns job failure classification and bounded durable retries. A core lock error currently reaches the generic non-retryable failure arm. Read-only production aggregate evidence supports pursuing this boundary; no private scenarios or raw evidence belong in this plan.

## Constraints

ReviewGPT authors production code and substantive revisions. Parent authors diagnostics, reviews and applies an accepted exact patch, validates and manages the PR. Preserve canonical writes, foreground priority, connection epochs, stale-lock protection, privacy and existing retry budgets. No lock stealing, deletion, new queue, production replay, bug-fix merge or deployment.

## Tasks

1. Reproduce an actual core contention error and service terminalization with synthetic state.
2. Ask ReviewGPT for the smallest typed correction at existing owners; assess active versus stale lock distinctions.
3. Apply accepted patch exactly; verify retry, exhaustion, deterministic failure, ownership and normal import success.
4. Complete parent review, changelog, scoped commit, draft then Ready PR, exact-head ReviewGPT and CI.

## Verification

Baseline: the new real-contention service test fails at dead versus queued, with no import and the competing lock still active. Existing core lock tests: 7 passed. Baseline core and device-syncd typechecks passed. Existing source staleness/recovery policy tests: 17 passed. Planned after the accepted patch: focused device service and core lock tests, affected typechecks, complexity and docs guards. Confirm no duplicate active patch. Current worktree created through the sanctioned primary helper; existing Frog #2662 covers supplied-checkout rejection.

## Risk

A retry must not hide stale or invalid locks, weaken writer authority, or preserve work without bound. Existing durable queue remains the only retry owner. No claim that fixing failure classification proves why another writer held the lock.

## Candidate outcome

ReviewGPT authored the accepted eight-file patch. Core supplies a closed active/stale discriminator and a public predicate, exposed through the existing importer facade. Device job classification uses that predicate with a fixed metadata-free diagnostic; existing backoff, attempt limits and ownership remain unchanged. Production changes were applied exactly from the recovered artifact. The artifact downloader required same-conversation recovery covered by existing Frog #2588; exact original user/assistant turn identities, model and substantive response were independently verified.

Focused proof: 14 contention service scenarios passed, including real canonical stress readback after release, terminal unsupported errors, three-attempt exhaustion, connection/disconnect/lease fencing, and foreground abort precedence. Core locking and parallel ownership: 11 tests passed. Core, importers and device-syncd typechecks passed. Complexity guard passed: unchanged existing service hotspots (81 and 46); the classifier adds no asynchronous work or new owner. Documentation index now routes the new reliability contract.

Product UX: Patch; Ready. Accepted updates survive temporary active contention and commit after normal release within the existing attempt budget. Persistent contention still exhausts; stale and unknown failures retain prior behavior. Existing dead jobs are not replayed. No provider API, prompt, permission or member-message behavior changes. Final PR review and exact-head CI remain pending.

## Local completion and PR handoff

PR #3325 contains the exact accepted production patch. Full device-service regression: 163 passed; core locking and parallel ownership: 11 passed; source recovery policy: 17 passed. Changelog production-component rendering: 10 passed. Affected three-package typechecks, complexity, docs drift, docs gardening and whitespace checks passed. Parent review found no additional production changes necessary. No new Frog entry was needed; existing entries #2662 and #2588 cover observed tooling friction.

Implementation and local proof are complete. The original session owns final ReviewGPT on the stable pushed head concurrently with required CI and will record their disposition in the PR and automation evidence. This historical plan does not claim those still-pending gates passed. No merge, deployment, production replay or provider action is authorized by this completion.
Completed: 2026-09-11
