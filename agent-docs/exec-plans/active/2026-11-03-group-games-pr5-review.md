# Group games PR 5 parent review and PR lane

Status: active
Created: 2026-11-03
Updated: 2026-11-03

## Goal

Address the parent review of 08b190c2bc, then complete the ready PR, final ReviewGPT and CI gates without merging or deploying.

## Success criteria

- One keyed provider-roster authority for group association, tools, lifecycle and egress; unresolved invitees do not prevent text delivery.
- Invite preparation and association cannot abort ordinary ingestion; association never claims invitees.
- Canonical addressed acceptance, private projection boundaries and pair behavior remain intact.
- Configured-origin invite matching and praise-safe recap validation have direct regression proof.
- Focused tests, isolated PostgreSQL tests, typechecks, lint, complexity, docs and bundle checks pass; the isolated database is removed.
- Full PR template, Web-first deployment and both skew directions documented; final ReviewGPT and required CI pass on the candidate.

## Scope and constraints

- Reuse existing chat owners. No schema change. Group admission remains off in production.
- Provider calls remain bounded and outside transactions. Pair rules remain unchanged.
- No personal identifiers or contact data in authored artifacts or diagnostics.
- Push and draft-to-ready PR publication are authorized by the parent review. Do not merge or deploy.

## Tasks

1. Replace group member-set comparisons with keyed roster authority and make inbound association best-effort.
2. Correct shared projections, addressed acceptance, origin matching and recap validation.
3. Add real webhook, egress and PostgreSQL regressions; update live owner docs and assistant proof.
4. Run required verification, inspect the diff, commit scoped changes and close this plan.
5. Publish the candidate, run ReviewGPT on vonneumann concurrently with CI, and resolve findings to final-head green.

## Decisions

- A provider handle is audience evidence independently of whether its owner has a Murph account.
- Account restrictions cover resolved verified room members plus seated players; invitees remain unclaimed until canonical join.
- Association failure logs contain only a fixed reason code and never error messages or contact data.

## Verification

Local candidate verification complete; external PR gates remain pending.

- Web game, webhook/inbound and egress selection: 32 suites, 909 passing tests; 16 PostgreSQL suites skipped in this non-database lane. Final affected rerun: 391 passing tests.
- All 17 PostgreSQL game suites: 250 tests. An existing locked-preview expectation failed once; the unchanged base already emits that gated reference. The corrected test retains encrypted-payload and media denial checks. The two affected full suites then passed 105 tests, and the final composer selection passed 6 tests.
- Hosted game contracts/notifications plus explicit historical skew: 39 passed, 2 unrelated gated cases skipped. Assistant contracts and complete-input measurement: 45 passed. Cloudflare group-tool port: 11 passed.
- Real Codex: `pnpm test:assistant:live -- --test 'group game addressed acceptance with duplicate first names'` using the available local subscription home, gpt-6.1-sol. One read and one addressed approval; truthful concise reply, no duplicate action or invented universal acceptance. Product UX: Ready.
- Full initial provider-input capture against 3049da7b47522b748834c896b24f66b1bfeef77c: direct 166385 → 166385 bytes; group 163795 → 165347 bytes (+1552, 0.948%). Registered group tools 62407 → 63183 bytes. No exact target-model tokenizer is configured; token counts are unavailable, not estimated.
- Typechecks: Web, hosted-execution, assistant-engine and Cloudflare passed. Web lint and touched package lint passed (existing warnings only).
- `pnpm complexity:diff`, `pnpm docs:drift`, `pnpm docs:gardening` passed. Existing Web webhook/engagement hotspots remain at or below baseline debt; group authority and new helpers stay below 20.
- `pnpm --dir apps/cloudflare runner:bundle` passed: entry 77854 bytes, static closure 1998423 bytes across 22 chunks, total 12222913 bytes. CI owns the exact-base Linux relative budget.
- Isolated migrated database removed; catalog count confirmed zero.
- Refreshed main explicitly and proved mergeability. No schema change, production flag change, merge or deploy.

## Parent review corrections

- `chat-membership.ts`: one keyed route/roster/seat/restriction authority; unresolved contacts allowed, verified resolved identities used for actors; best-effort preparation and savepoint-isolated bind-only association; configured public origin and www/apex alias.
- `chat-access.ts`, `chat-tool.ts`, `chat-delivery*.ts`, `chat-lifecycle.ts`, `service.ts`, engagement route: replace group member-set assertions and all-invitees-claimed requirements; carry prepared provider evidence into database-only revalidation.
- Shared contracts/tools: seated names/tasks/statuses and anonymous pending count, verified-contact addressed approval, single seated starter edit preserving private unjoined overrides. Pair rules and old strict consumers remain supported.
- `recap.ts`: reject clearly negative shame labels and allow positive missed-day phrasing. Recap sealing checks actual eligible seated identities. Existing lifecycle and recap-link messages are text only.
- Focused real webhook, egress, PostgreSQL, assistant and privacy tests plus owner documentation updated. The stale pre-existing preview assertion is recorded in Frog and corrected without changing pair product behavior.

## Deployment and publication

Web first, then Cloudflare runner. Old bundles against new Web remain pair-only; new bundles accept old Web pair responses and the ignored query capability. Group admission stays off. No schema change. Publish as draft, mark the candidate Ready, and run ReviewGPT pinned to vonneumann concurrently with CI. Do not merge or deploy.

## Final ReviewGPT round 1

- PR #4498, head ea764e128d0e9f04fd961ce477dfc5c6d18e760b; sensitive full snapshot, 48 changed blobs verified by the review. Pinned vonneumann, sent model verified as GPT-6 Pro, attachment confirmed, exact accepted turn and completed `REVIEW_COMPLETE` response captured. The accepted response remained pending beyond 11 minutes, exceeding the wrapper's 80-second marked-response gate; the exported UI exposes no separate reasoning-duration label.
- Result: FINDINGS. Both accepted. The capable tool's post-mutation member-ID comparison discarded contrary complete handle evidence. Preserve fresh keyed audience evidence, compare it before projection, and retain legacy pair behavior. The lifecycle notice context passed an empty room to group projection. Pass the known bound room and constrain roomless candidate discovery to pairs. No new provider call, queue or state owner.
- Proof: Added update/photo regressions for unresolved additions/replacements, unchanged rosters and key rotation. Added a PostgreSQL composition across canonical join, lifecycle instructions, shared projection, real receipt updates and replay, with one unjoined relative and roomless pair controls.
- CI also exposed stale capability-parameter and pair-only skill expectations. Updated those tests and shortened redundant skill prose to preserve the existing size budget and rules. Web route and Cloudflare platform suites pass 370 tests; assistant deterministic selection passes 49.
- Remediation verification: all 17 PostgreSQL game suites pass, 251 tests. Web selection: 939 pass initially plus the corrected roomless-pair query expectation (12-test suite passes). Hosted historical skew/contracts: 39 pass, 2 gated skips. Web/assistant typechecks, Web lint, complexity and runner bundle pass. The new composed regression proves both notices and replay while an addressed relative remains unjoined.
- Focused real Codex rerun passed with one read and one approval; reply review Ready. Docs drift/gardening passed. The isolated database was dropped and catalog absence confirmed again.
- Round 2 and final-head CI remain pending. The PR is Draft during remediation.
