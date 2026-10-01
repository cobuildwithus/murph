# Immediate manual meal estimation and incomplete meal recovery

Status: completed
Created: 2026-09-14
Updated: 2026-09-14

## Goal

- Explicit app meal submissions promptly enrich their existing canonical meal or ask for essential missing detail. Meal-related turns resolve incomplete meals for the selected date instead of refusing a daily card without attempting recovery.

## Success criteria

- One upload remains one meal through replay, with immediate model work only for manual submissions.
- Clear evidence produces an estimated, read-back meal; insufficient identity or amount produces one useful clarification and no invented values.
- Existing numeric-suppression preferences, private delivery, AI admission, foreground priority, closeout and photo cleanup remain intact.

## Scope

- In scope: runtime import-to-notification handoff, trusted estimation instructions and capabilities, meal recovery guidance, focused deterministic and real-model proof, durable owner docs and changelog.
- Out of scope: native UI changes, production data repair, deployment, changing automatic background capture timing, new queues or schemas.

## Constraints

- Reuse the canonical import, durable system mailbox and notification/outbox owners; derive manual intent only from the server-owned manual event identity.
- Preserve exact item identity, post-checkpoint staging cleanup, bounded reads and in-place edits. No private incident contents in artifacts.

## Risks and mitigations

1. Duplicate work after restore: retain the original mailbox item and delivery idempotency; prove replay and consumed-item behavior.
2. Wrong audience or unauthorized model work: use the admitted private route and existing model-capable notification lane; test automatic capture stays import-only.
3. Unsupported estimates: inspect actual evidence first, ask for essential missing detail, and preserve numeric-suppression rules.

## Tasks

1. Extend manual import to enqueue immediate estimation through existing runtime owners.
2. Reconcile meal instructions and add deterministic boundary and real-Codex regression journeys.
3. Run focused tests, relevant typechecks, live journeys and candidate review; update docs/changelog and commit the scoped result.

## Decisions

- Product UX: a manual app send promises prompt estimation in the existing private conversation. Automatic captures keep nightly closeout. Clear, ambiguous, duplicate/retry and number-sensitive paths need distinct proof. No additional setup or confirmation step.
- Persisted state: canonical meals stay in the vault; execution stays in the existing system mailbox and outbox. No new product state or external protocol fields.

## Verification

- Focused runtime meal import/event tests, assistant notification and skill tests; package typechecks; focused real-Codex meal recovery/clarification journeys; complexity and docs checks.
- Expected: deterministic boundaries pass, real replies are Ready, and no duplicate meals, invented nutrition, unnecessary permission questions or private identifiers appear.

## Results

- Implemented the same-item import-to-notification handoff, private runtime capability, and selected-date recovery instructions. No production data or deployment changed.
- Parent review: Ready. Traced upload event identity, canonical import, pending system selection, model-free exclusion, bound member and private destination, isolated provider tools, stable outbox delivery identity, and post-checkpoint staging cleanup. No new schema, queue, dependency, or canonical record type.
- Runtime regression suite: 82 passed across meal-photo import and mailbox event tests. Covers repeated import, consumed replay, automatic capture, model admission, private Linq/Telegram/email delivery, and wrong-member rejection.
- Assistant regression suite: 128 passed across food-journal, automatic-meal-capture, response-card tool, and notification runtime tests. Covers composed instructions, group rejection, ordinary notification isolation, and required private delivery.
- Changelog archive: 10 passed after existing fragment generation, using repository-root Vitest. The app-directory command is already documented as friction; no duplicate entry created.
- Typechecks: assistant-engine, assistant-runtime, and Web passed. The assistant-runtime project-reference build passed, including the new assistant-engine export.
- Complexity guard, documentation drift, whitespace and direct-identifier checks passed.

### Real assistant proof

Model: `gpt-5.6-terra`. Auth: local subscription. Each scenario ran separately through `pnpm test:assistant:live -- --test '<exact scenario name>'` with an authenticated local home. Local authentication failures occurred before provider work; the successful home was retained for behavioral runs.

| Scenario | Owned effects | Reply review |
| --- | --- | --- |
| estimates a manual app photo without another meal record | One saved meal, one nutrition write, same-meal readback, fresh totals and card | Ready |
| asks for essential missing information on a manual app photo | Original photo meal retained; no invented nutrition or card; one clarification | Ready |
| preserves nonnumeric tracking on a manual app photo | One meal, no numeric writes or card, no estimate-enabling question | Ready |
| estimates an incomplete earlier meal during ordinary meal logging | One new meal, one existing-meal nutrition write, readback and fresh totals/card | Ready |
| asks about an incomplete earlier meal during ordinary meal logging | One new meal, earlier incomplete record retained, one portion clarification | Ready |

Live assertions use the production notification decision resolver because a successful card can replace the provider's final text. Canonical nutrition writes are counted separately from metadata edits and CLI help. Ordinary recovery may inspect the full selected-date list; manual photo recovery additionally requires the exact saved meal read. These checks preserve the user outcome without requiring incidental command choices. Actual synthetic replies were reviewed; private incident material was not used.

## Handoff

- Local scoped implementation and commit only. PR, external review, CI, merge and deployment are outside this task's current completion boundary. A future PR needs its source number added to the authored changelog fragment and the routed final review/CI evidence.
- Existing producers remain compatible. New runtime snapshots containing pending manual estimation require a compatible runtime until drained. Warm containers must converge before the behavior is fully available; old consumed imports are not retroactively replayed.
- Live evidence uses synthetic delivery and local canonical vaults. It does not claim a physical-iPhone upload, production model admission, or real messaging-provider delivery.
Completed: 2026-09-14
