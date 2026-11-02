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

## Slice 2 evidence

- No production reads of `status.json`, status service methods, or `status.snapshot.refreshed` remain in Web/Ops/scripts, Cloudflare, hosted runtime projections, logs, CLI or hosted instructions. Web workspace `redacted_status_json` comes from the hosted invocation/mailbox progress projection, not the removed file.
- Removed portable status descriptor, writer/read API, service status members, and status-only schemas. Retained hot-snapshot exclusion and historical runtime-event/quarantine vocabulary so old logs remain readable; retained live outbox summary type.
- Automation lock has no producer after the stacked removal; runtime-write lock remains the sole maintained lock. Generic process identity/kill helpers, polling wait and old auto-reply reconciliation have no production callers.
- Full snapshots also used a broad assistant continuity copy; added the retired file to its existing exclusion list and proved omission on restore. Portability and warning assertions initially failed because they expected the deleted behavior, confirmed against the base assertions.
- Slice 2 build and five touched-owner typechecks passed. Runtime-state (297 passed, 21 skipped), inboxd (194 passed, 3 skipped), operator-config, 13 focused engine files (519 tests after targeted correction), and two focused CLI files (34 tests) passed.

## Slice 3 evidence

- Removed the legacy dashboard replica wrapper and package/TypeScript aliases after finding no production importer. Removed unused inbox read-test daemon/connector mocks, preserving current read behavior.
- Corrected only the live direct-conversation navigation sentence. Other non-hosted prompt branches are not certified dead and remain. Updated stale seam-audit scopes and feature ledger rows against the current routes and files.
- `gpt-tokenizer` 3.4.0 with `o200k_base`: the sentence changes from 19 to 14 tokens and 95 to 64 UTF-8 bytes. Full hosted direct prompt changes from 19,723 to 19,718 tokens and 98,603 to 98,572 bytes; retained non-hosted direct changes from 20,687 to 20,682 tokens and 103,772 to 103,741 bytes. Group prompts are unchanged. Navigation is in the stable route-capability layer; static-core hashes are unchanged. Vitest regenerated hash snapshots.
- Build, three owner typechecks, hosted-execution and inbox-services suites, and 57 prompt tests passed. The focused real-Codex event-list journey passed with subscription auth and the configured gpt-6.1-sol; its production prompt assertions prove navigation remains and the obsolete wording is absent.
