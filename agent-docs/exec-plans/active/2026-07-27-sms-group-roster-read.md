# SMS group roster read

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Let route-authorized non-direct SMS groups use the existing read-only live participant lookup.

## Success criteria

- `read_chat_participants` receives the current SMS thread context when exactly one authenticated non-direct route is present.
- Effectful chat actions remain limited to authenticated non-direct iMessage routes.
- Direct, unauthenticated, and multi-thread ambiguous contexts still fail closed.
- Focused and canonical verification, preliminary specialist review, final review, CI, and the final cross-cutting ReviewGPT gate complete.

## Scope

- In scope: hosted runtime current-turn Linq thread resolution, focused assistant-runtime regression tests, and the current address-book advisory-names product spec.
- Out of scope: SMS delivery behavior, message targeting, contact-card sharing, group mutations, Linq provider contracts, and persisted state.

## Constraints

- Treat route authority and `threadIsDirect === false` as mandatory.
- Admit SMS only for `read_chat_participants`; keep every effectful action iMessage-only.
- Preserve ambiguity fail-closed behavior and the existing bounded result contract.
- Add no state, dependency, queue, compatibility shim, or provider-specific fallback.

## Risks and mitigations

1. Risk: widening the shared resolver could accidentally authorize SMS mutations.
   Mitigation: make the allowed service scope explicit at the call site and cover read-only versus effectful actions in one regression.
2. Risk: mixed authorized threads could select the wrong chat.
   Mitigation: keep exact route deduplication and reject every candidate set whose size is not one.
3. Risk: an SMS direct conversation could be treated as a group.
   Mitigation: retain the positive non-direct check and cover it in the focused resolver test.

## Tasks

1. Register the isolated task and document the narrow authority boundary.
2. Extend current-turn thread resolution for read-only participant lookup only.
3. Add focused positive and negative regression coverage.
4. Run canonical verification and a direct request-shape scenario.
5. Complete the required ReviewGPT, CI, final review, plan closure, commit, and PR gates.

## Decisions

- The prior SMS exclusion was inherited from an iMessage-focused bundle of chat actions, not required by the participant-read security model.
- Use one explicit service-scope parameter rather than a second resolver or duplicated filtering logic.

## Verification

- Focused Vitest: passed (1 file, 17 tests).
- `pnpm test:diff <touched assistant-runtime and docs paths>`: passed.
  - assistant-runtime typecheck passed.
  - assistant-runtime tests passed (1,898 passed, 2 skipped).
  - Cloudflare reverse-dependent verification passed (2,012 Node tests and 2 Workers tests).
- Direct production-helper scenario: passed; one synthetic route-authorized non-direct SMS context attached its exact thread to `read_chat_participants` and did not attach it to `share_contact_card`.
- `pnpm docs:drift`: passed.
- `git diff --check`: passed.
- `product-experience-review`: `NO FINDINGS`; no material evidence gaps.
- Preliminary `completion-specialists` ReviewGPT:
  - prompt and frontend lenses not applicable.
  - coverage lens reported one accepted test gap: the success fixture used normalized lowercase `sms`, and no explicit route-authorized `RCS` denial was covered.
  - the returned artifact was inspected in full, touched only the focused test, and passed `git apply --check`.
  - accepted test hunks now use provider-shaped `SMS` and prove `RCS` remains unavailable; focused Vitest passed (17 tests).
- Post-remediation canonical rerun:
  - repository guards, assistant-runtime typecheck, and assistant-runtime tests passed (1,898 passed, 2 skipped).
  - the Cloudflare reverse-dependent step waited ten minutes for the shared-host slot and was stopped through the exact task-owned process.
  - the required Crabbox fallback failed before Testbox creation because the installed Blacksmith Testbox provider rejected the canonical dispatcher's required `--stop-after` lifecycle option.
  - the unchanged production source had already completed the full local canonical lane before the test-only remediation, including Cloudflare verification (2,012 Node tests and 2 Workers tests).
