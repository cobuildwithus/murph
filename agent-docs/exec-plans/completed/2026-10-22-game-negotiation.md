# Negotiate challenge rules before play

Status: completed
Created: 2026-10-22
Updated: 2026-10-22

## Outcome and scope

Invitees can submit concrete alternative rules without accepting the original challenge. A negotiating game starts only after the other player approves. Existing players can negotiate tasks for future unstarted days and replace the whole-game wager, including earlier misses, with explicit agreement. The existing game record, row lock, versioned terms, encrypted words and event history remain the owners.

The native editor and chat lifecycle are parallel changes. This PR owns canonical commands, wire contracts, safe term persistence, lifecycle transitions, and focused rule/database/tool proof. It does not own provider sends, kickoff generation, duplicate-room routing, check-in imports, or native rendering. Parent session owns final integration, ReviewGPT, merge and release.

## Product UX

- Entry: invite Suggest changes submits the exact counterproposal from the shared editor. The app shows Agreeing on rules; no Day 1, scores or posting duties accrue.
- Agreement: proposer already consents; only the other actual player can approve. Approval applies precisely those terms and schedules Day 1 from approval time, preserving a chosen later date.
- Recovery: repeated submit/approval is idempotent; another invite claimant cannot take the seat. Decline/cancel leaves negotiation unstarted. Original invite expiry bounds abandoned negotiation and releases the pair reservation.
- Live edits: task changes preserve earlier days; stake changes explicitly replace the entire wager. No photo, caption, ticket or historical check-in is rewritten.
- Compatibility: invite capability gates the new native action. Existing acceptance and schedule/date/duration changes keep their behavior.

## Implementation

1. Add negotiating status, explicit negotiate endpoint and additive task/stake changes.
2. Prepare encrypted proposed words before transaction; compare source ciphertext and terms version under lock. Store structural pending metadata plus sealed next words; apply atomically.
3. Preserve lifecycle and idempotency constraints; expose truthful public pending state with no encryption envelope.
4. Extend assistant contracts and scoped real-model scenario.
5. Verify rules, persistence/concurrency, encryption, expiry, existing duration/schedule paths and typechecks; update owner docs and changelog.

## Verification

Canonical scope complete; parent integration still owns generated chat delivery, native rendering, consumer-first rollout, final review and release.

- 94 focused Web tests passed across negotiation PostgreSQL, existing change PostgreSQL, changes, command, rules, views and changelog. The negotiation database included the new migration-owned status and pair-reservation CHECKs.
- Web and assistant-engine typechecks passed. Eleven assistant tool boundary tests passed. Scoped lint and diff checks passed. Complexity guard passed with no function above 20; changed service maximum decreased from 20 to 17.
- Focused real-Codex journey `game agreement negotiated tasks and stakes activates only after opponent agrees` passed with gpt-6.1-sol via local subscription. Exactly one read and one approval occurred, and the reply accurately confirmed tasks, stake and start. Reply verdict: Ready. Default subscription failed before any provider action; the authorized alternate-home retry succeeded without copying credentials.
- PostgreSQL proof covers idempotent and competing invite claims, other-player-only approval, delayed activation, decline and original-accept rejection, expiry and reservation release, chosen-date preservation/reset, encrypted pending words, canonical weekday normalization, historical tasks, and whole-game stake settlement across earlier misses.
- Existing db-push proof omits migration-owned CHECK constraints; recorded repository friction and applied the owned migration before final persistence proof.
- Consumer schema is isolated in its own commit. Expanded writers/tools require compatible consumers and lifecycle/native integration before release.
Completed: 2026-10-22
