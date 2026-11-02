# Remove dead local residue and retired ChatGPT linking

Status: active
Created: 2026-11-02
Updated: 2026-11-02

## Goal

- Delete the audited unsupported APIs, write-only status projection, obsolete lifecycle helpers, stale support material, and retired member ChatGPT linking consumers. Preserve hosted replies, canonical state, runtime-write locking, startup laziness, and the runner bundle budget.

## Success criteria

- Recheck reachability at base `c04ccc04cc`, including Web/Ops/scripts, Cloudflare, runner entrypoints, hosted prompts/skills, and CLI.
- Make four scoped commits; generate artifacts through their owners; complete the requested builds, typechecks, tests, guards, and prompt measurements.

## Scope

- In scope: audit A slices 1–3 and B1 only. The audit was pinned to `480b53eb1c`; lock acquisition is already absent.
- Out of scope: device/npm retirement, migration machinery, Stripe, Fitbit, other product candidates, completed plans, and other checkouts.

## Constraints

- Technical constraints: no casts suppressing type errors; no sibling source imports; no schema drops; retain hosted config writes and reads.
- Product/process constraints: local commits only, no push/PR/production access, no stash. Use provided zero-population evidence for retired linking, not new production queries.

## Risks and mitigations

1. Hidden status consumer: trace files, events, snapshots, logs, Ops, and projections before deletion.
2. Deployment skew: route retired mailbox items through existing unknown-kind handling and test consumption; document callback rejection and retained schema.
3. Live prompt change: preserve navigation guidance, measure o200k_base tokens and UTF-8 bytes, regenerate hashes, and run focused assistant proof.

## Tasks

1. Prune unsupported exported APIs and their detached tests.
2. Remove status projection and obsolete lifecycle helpers after consumer proof.
3. Remove dashboard wrapper/test scaffolding and update prompt/docs.
4. Remove retired linking consumers and verify unknown mailbox behavior.
5. Complete requested checks, review, record limitations, and close this plan in the fourth commit.

## Decisions

- No member-visible release note: this task removes unsupported internal code and corrects internal navigation wording.
- External review tied to a pushed PR is unavailable under the explicit no-push/no-PR boundary; parent review remains required.

## Verification

- Baseline `pnpm install` and `pnpm build`: passed.
- Required final proof: build; workspace boundaries/cycles; dependencies; source hygiene; CLI; touched package typechecks/tests; Web typecheck/focused tests; Cloudflare typecheck/Node tests/full runner bundle; docs drift; complexity diff.
- Record actual results and any baseline comparison below as work proceeds.

## Slice 1 evidence

- Current gateway production imports are limited to assistant channel routing, operator delivery/CLI contracts, and hosted side effects. Removed RPC, IDs, timestamp validation and errors have no production callers. Retained reply-route inference and its vocabulary.
- Model catalog, display config, conversation-open/session-options, operator setup/self-target writers and equality/header-normalization helpers are detached from Web, Cloudflare, runner, CLI and hosted prompts/skills. Retained hosted config persistence, default-vault reads, strict self-target reads and header redaction/persistence.
- Replaced test-only setup writers with synthetic config fixtures; kept hosted provider-routing tests inside the former mixed catalog suite.
- Build, four touched-owner typechecks, operator-config tests (454), focused engine tests (273), and focused CLI tests passed. Initial deletion-induced missing-export type errors were fixed; gateway test failure was an empty suite left by removed route APIs, confirmed against the nonempty base suite.
