# Bluetooth wearable connection help

Status: active
Created: 2026-10-23
Updated: 2026-10-23

## Goal

- Help a member recover WHOOP live heart rate in the Murph iPhone app from chat, with short truthful guidance based only on their report.

## Success criteria

- Existing skill registration and composed prompt select Bluetooth help for the app handoff and natural connection requests.
- Real local-subscription journeys prove short replies, supported models, state-specific recovery, and no cloud-link or remote-diagnostic claims.
- Focused checks, requested deep review, eragon ReviewGPT and exact-head CI pass; merged Web admission and protected runtime convergence are verified.

## Scope

- In scope: one skill, existing registry/router, focused synthetic proof, changelog and deployment.
- Out of scope: iOS changes, Bluetooth tools/log ingestion, new dependencies, other-band support and cloud-sync behavior changes.

## Constraints

- Use the existing assistant-engine bundled skill owner and runtime packaging. No new state, tool, network read, or abstraction is needed.
- No remote Bluetooth visibility. Pairing lives on the phone; successful heart-rate receipt is the app's completion boundary.
- Fix forward only. Skills ship in the runner image; Web carries the changelog. Old runners retain old guidance until normal rollout converges; no protocol/schema changes.

## Risks and mitigations

1. Generic WHOOP/goal setup advice can route this request to cloud sync or Apple Health.
   Mitigation: explicitly distinguish local live-heart-rate help in the composed router and relay heading, then prove selection with the production prompt.
2. App labels may differ from the design; no member-facing Forget control exists in the reviewed source.
   Mitigation: follow reported labels, condition re-pair advice on an actual control, and hand off instead of inventing navigation.

## Tasks

1. Trace shipped skills, iOS connection states and support ownership.
2. Add the smallest skill and router change; add selection/reply proof and changelog.
3. Run focused checks and local-subscription journeys; inspect replies and complete parent review.
4. Commit with committer, push/Ready, run eragon ReviewGPT with CI and requested read-only Astra review.
5. Close plan with finish-task, satisfy final-head gates, merge and deploy through the existing protected owners; update the external status file with exact-SHA evidence.

## Decisions

- The existing registry plus compact system-prompt router both need the new skill; there is no deterministic keyword selector to extend.
- Human support reuses the existing Support/Product feedback contract; the skill grants no new effect authority.

## Product UX

- Effort: Product change. Entry is the app's prefilled message or a natural WHOOP connection question.
- Journeys: missing model/state, ambiguous Bluetooth versus sync, permission denied, missing first heart rate, older unsupported band, exhausted recovery/support. Known facts should not be asked again.
- Promise: one useful question or one or two checks per reply; no invented screens, diagnosis, successful connection or support delivery.
- Done when: real synthetic replies and action assertions are Ready. Physical band recovery remains member-observed; no live member/device access is part of this proof.

## Verification

- Focused skill/asset tests and assistant-engine typecheck, focused live Bluetooth journeys, changelog rendering, complete provider-input capture for direct/group fixtures.
- `pnpm complexity:diff`, `pnpm logs:guard`, `pnpm docs:drift`.
- Expected: skill selection and truthful short replies with no Bluetooth/cloud mutations; exact-head CI/reviews and Web/runtime deployment receipts.

## Progress

- Implemented the bundled skill and compact route, retaining separate cloud-sync ownership. No dependency, tool, schema or persisted-state changes.
- Passed 9 skill/asset tests, 57 existing model-behavior tests, 4 changelog rendering tests, assistant-engine typecheck, and complexity/log/docs guards.
- Complete first-provider-request capture on identical direct/group fixtures passed: direct 155923 to 156238 bytes (+315, +0.2020%); group 130696 to 130960 (+264, +0.2020%). Tool schemas unchanged. Exact target tokenizer unavailable; no estimated token claim.
- Requested read-only GPT-6 Astra review found no production bugs or meaningful simplifications. Its noted successful-support proof gap is being closed with the existing synthetic recorder; no runtime changes were needed.
- Real GPT-6.1 Sol local-subscription selection, permission and missing-heart-rate replies are concise and truthful. Remaining journeys, final parent review and external gates are pending.
