# Remove redundant workspace startup work

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Outcome and invariant

Reduce work before a hosted reply without changing accepted inputs, conversation continuity, consent, or canonical data. Existing owners should pass already-read facts and perform recovery only where needed.

## Owners and deletion evidence

- Hosted operator configuration currently rereads its own output. Return and pass the resolved result through existing invocation context; preserve standalone bootstrap and provider-change semantics.
- Initial mailbox bootstrap recomputes an existing plan. Pass the plan into the import owner.
- Hosted startup scans every integration archive before any reply. Move interrupted-shard recovery into existing canonical source resolution, using the existing lock and validator only when a duplicate closed shard is encountered. Idle maintenance retains global cleanup.
- Web sidecar admission already reads the immutable item. Pass that row to payload storage and remove its second item query; keep live payload retention and authorization predicates.
- Collapse duplicate Cloudflare fence validation implementations without removing live fence checks.
- Codex home validation repeats one stat; resume callers never request returned history. Delete those unused operations/options while preserving native resume and execution-context validation.

## Boundaries and rejected alternatives

Lazy mailbox decryption remains necessary: a fetched prefix can contain 102 items by default and up to 200 items at the Web limit that the runtime may skip, defer, or reject for lane gaps. Eager whole-page decryption would move unrelated work ahead of a reply. Do not add a streaming protocol, cache, configuration, or another selection owner to remove that callback.

## Product UX

Outcome: ordinary messages start without a blanket historical archive repair pass.
Reaches: current-format workspaces, interrupted closed archives, first-turn archive reads and amendments, inline and sidecar mailbox input, individual and group conversation continuity.
Proof: ordinary startup has no archive recovery scan; exact duplicate shards recover on demand; conflicting shards remain rejected; current input and sidecar failure semantics remain unchanged.

## Failure and rollout

Re-enumerate exact shard representations under the existing canonical write lock before repair. Preserve current-month protection, hash/newline/stat checks, and conflict failures. No persistent shape or mailbox protocol changes; old and new bundles retain their existing public boundaries. Configuration reuse is invocation-local and must not mask provider handoff or standalone callers.

## Verification and completion

Run focused core archive/read/amendment, hosted startup/config, Web sidecar/route, Cloudflare fence, and Codex preparation/resume tests with relevant typechecks. Parent reviews complexity, privacy, final data flow, and the actual outcome. Add an evidence-backed changelog item, open a draft PR, then start required ReviewGPT concurrently with exact-head CI on the stable candidate. Close this plan before handoff. Merge and deployment are outside this task.

## Evidence

Implementation and parent candidate review are complete. Production rows and identifiers are excluded from artifacts.

- Core/operator-config/assistant-runtime: 109 focused tests pass, all three package typechecks pass, and operator-config public build passes.
- Codex: 12 selected tests pass across four files; assistant-engine typecheck and public build pass. Production provider request fields are unchanged.
- Mailbox/fence: 318 Cloudflare tests and 244 Web tests pass; Web and Cloudflare typechecks pass. Sidecar item lookup occurs once, with live payload retention checked separately.
- Initial bootstrap/readiness reuses the already-resolved result with zero further config reads in focused proof. Later wake configuration and existing provider handoff tests pass.
- Archive proof covers untouched duplicate files at mailbox admission, first public read, concurrent readers, amendment under the reentrant canonical lock, current-month refusal, and existing invalid/conflicting/ZIP cases.
- Complexity guard passes with no increase in debt or maximum function complexity. Existing untouched provider/lifecycle hot spots do not warrant unrelated refactors. The new shard resolver stays below the threshold.
- Initial draft checks found a missing explicit undefined argument and outdated fixture expectations; those were corrected and affected typechecks/tests passed.
- PR review and exact-head CI remain external completion gates. No production deployment or measured seconds-saved claim is included.
Completed: 2026-09-10
