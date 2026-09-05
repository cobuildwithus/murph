# Collapse repeated Linq callback arguments

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Reduce duplicated authority and receipt wiring in the hosted Linq send callback
without changing delivery, route authority, fallback, or retry behavior.

## Scope and ownership

The existing `createHostedAssistantLinqSendDependency` owner in `callbacks.ts`
remains responsible for each send. Consolidate repeated private Assistant Ask
route-assertion inputs, resolved-route engagement inputs, and outcome inputs.
Keep the Telegram authority and delivery-drain loops outside this bounded task.
Use the isolated `refactor/complexity2-callbacks` branch. No state, schema,
provider/tool contract, prompt, dependency, or deployment change is intended.

## Protected boundaries

- Keep initial and provider-entry private-completion authority checks.
- Preserve the preflight `thread` and resolved-provider `explicit` defaults.
- Read request and invocation values when each helper is called, including after
  intervening awaits; never turn current authority into a cached assertion.
- Keep capability reads separate from provider claims, and preserve optional
  property omission, callback receiver, effect count and call ordering.
- Preserve card-rejection settlement before fallback identity claim, receipt
  write ownership, attachment reservation uncertainty, and partial-send recovery.

## Product UX and proof

Internal mechanical refactor: no product-owned behavior change. Replay normal
and private/reviewed completion sends, participant/thread routes, authority loss,
card fallback, attachment denial, receipt failure and ambiguous provider outcomes
through existing composed callback and Assistant Ask suites. Inspect synthetic
provider requests and owned effects. The real-Codex skill was read; stochastic
reply proof is applicable only if the final diff alters interpretation, tools,
silence, context or prose, rather than mechanically unchanged callback wiring.

## Tasks

- [x] Inspect baseline source, current workflow, domain contracts, Frog and tests.
- [x] Consolidate concrete duplication without adding authority or state owners.
- [x] Run focused tests, package typecheck, complexity guard and source-derived
  base/current differential proof.
- [ ] Review complete diff/privacy; close plan with scoped neutral-identity commit.
- [ ] Open draft PR and obtain parent candidate review before Ready.
- [ ] Run exact-head ReviewGPT alongside CI; hand off the clean open PR.

## Verification

Passed locally:

- `MURPH_VITEST_MAX_WORKERS=2 pnpm --dir packages/assistant-runtime test
  test/hosted-runtime-callbacks.test.ts
  test/hosted-runtime-current-sender-assistant-ask.test.ts
  test/hosted-runtime-assistant-ask-completion.integration.test.ts
  test/hosted-runtime-linq-outbox-regression.test.ts`: 4 files, 306 tests.
- `pnpm --dir packages/assistant-runtime typecheck`.
- `pnpm complexity:diff --base b6454467652310f7abdd63676dab0f769c340ae8 --
  packages/assistant-runtime/src/hosted-runtime/callbacks.ts`: debt 180 to 169;
  send callback 84 to 73. Source change: +73/-120 lines.
- A local source-derived probe executed the complete base/head send factory with
  identical synthetic ports and deterministic dates: 384 traces matched ordered
  owner calls, property presence, arguments, return values and error markers.
  Cases include ordinary/private/reviewed completions, thread/participant/default
  routes, card capability and fallback, revocation, vault attachments, failed and
  ambiguous provider outcomes, partial rich links, and rejected receipt writes.
  Mutations after authority, preload, provider liveness, reviewed preparation and
  fallback awaits change the request payload and input route context/intent/effects
  to prove the helpers preserve live reads instead of capturing stale authority.

The existing callback tests exercise the actual composed delivery owner and
provider-shaped requests; the differential probe isolates the changed wiring.
No prompts, model inputs, tools, replies or decision rules change, so stochastic
real-Codex reply proof does not add coverage for this mechanical refactor.
Required CI and final ReviewGPT remain PR admission/handoff gates.

## Risks and decisions

Every authority check and external effect keeps its existing position. Helpers
only construct existing owner inputs. No broad split is justified solely by file
size or complexity score. No new qualifying Frog friction has occurred.
Completed: 2026-09-04
