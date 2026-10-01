# Patterns on iOS Home

## Outcome and ownership

Members read the existing Personal Patterns report on iOS Home, including comparison evidence. The query and Browser Vault remain canonical; native renders a bounded in-memory report. No native calculation or persistence. Existing setup, Health sync, consent recovery, Meals, and Settings remain available.

## Implementation

- Add a bearer-authenticated companion reader using existing member/consent authority and Browser Vault decoding. Return only the saved report and freshness. No refresh wake or database write.
- Render factors, outcomes, grades, and evidence details natively after initial setup on Home.
- Fence native reads at the session epoch and clear private presentation on teardown.

## Journeys and proof

Established member with results; sparse/empty report; missing replica; loading and retry; stale report; consent/access loss and delayed completion after sign-out; first-run setup; light/dark and large text. Focused route/decoder tests, native session/API/model tests, Swift simulator build/tests and screenshots, parent review. Backend must deploy before native release; older backend returns a retryable unavailable state. Product UX remains Hold until composed proof is available.

## Progress

- Implemented backend reader and native Home matrix/evidence sheet in isolated branches.
- Backend: 24 Browser Vault decoder tests and 5 route tests pass; Web typecheck, focused ESLint, complexity guard, and diff whitespace pass.
- Native: simulator build/typecheck, 43 API/session tests, 3 presentation model tests, and 2 simulator UI journeys pass. SwiftFormat lint passes.
- Independent local review found one null-grade/no-clear-pattern presentation issue; corrected and independently verified with a focused regression test.
- Simulator journeys cover populated Home, comparison sheet, empty state, and retry. Final dark/accessibility-large captures inspected; matrix, evidence, empty, and retry states remain usable.
- Product UX: local native flows are Ready. Production-authenticated native-to-backend integration and release remain unverified; deploy the additive backend reader before the native consumer. No schema migration or Worker rollout is required.
- Changelog decision: this local implementation has not shipped. Do not claim App Store availability. Native release wording: “Explore your personal patterns from Home. See how your activities relate to sleep and recovery, with the evidence behind each result.”
- Complexity: shared decoder extraction reduces the existing loader complexity by one; remaining loader hotspots are unchanged owners. No native calculation, persistence, dependencies, or extra tab.

Status: completed
Updated: 2026-09-06
Completed: 2026-09-06
