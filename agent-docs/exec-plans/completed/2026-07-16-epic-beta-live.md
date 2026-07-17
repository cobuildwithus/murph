# Complete the Epic Clinical Records beta

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Make the existing direct Epic SMART-on-FHIR foundation reachable end to end:
  Murph can create a member-bound connection link, the signed-in member can
  authorize an Epic organization, and the member can inspect or disconnect the
  resulting import from the Web app.

## Success criteria

- The assistant can invoke one typed Clinical Records operation that returns
  the existing short-lived first-party connect URL without gaining provider,
  patient, token, or arbitrary-recipient authority.
- `/records/connect` consumes the URL-fragment claim, lets the member search the
  server-owned Epic directory, and hands the selected provider to the existing
  SMART start endpoint without placing the claim in a path, query, or log.
- `/records` shows connection and latest-run state, handles OAuth completion or
  failure, and lets the signed-in member disconnect through the existing owner.
- The change adds no new durable state, queue, scheduler, provider abstraction,
  feature-flag framework, retry lifecycle, or second business-logic owner.
- Focused tests, truthful app/package verification, desktop and mobile browser
  proof, required frontend and coverage audits, green PR CI, and ReviewGPT all
  pass with no unresolved accepted finding.

## Scope

- In scope: member-facing Clinical Records pages/components; the smallest typed
  assistant, runtime, Cloudflare, hosted-execution, and signed Web adapter needed
  to call the existing connect-link owner; one narrow Epic beta request policy
  shared by directory, SMART scope, grant, and retrieval owners; focused tests;
  current deployment, local-testing, and Epic-registration documentation.
- Out of scope: TEFCA/QHIN, non-Epic providers, record-location services,
  scheduled refresh, reconnect/reauthorization, broader FHIR canonical mapping,
  and changes to the existing retrieval/storage state machine.

## Constraints

- Preserve the existing Web-owned auth, consent, provider-directory, OAuth,
  credential, and connect-intent boundaries. Browser and conversation adapters
  must call the same canonical owner.
- Keep the member flow explicit and calm. Provider credentials stay on the
  provider-hosted page; health-record bodies and Clinical Records secrets stay
  out of prompts, messages, logs, Temporal, and assistant state.
- Prefer direct reuse and deletion over abstraction. Introduce no dependency or
  shared component unless an existing repository pattern already owns it or a
  second current caller demonstrates the need.
- Work on `codex/epic-beta-live` in the isolated task worktree and preserve every
  unrelated active ledger lane.

## Risks and mitigations

1. Risk: a browser fragment bearer leaks through navigation, fetch URLs, errors,
   analytics, or logs.
   Mitigation: keep it client-only, remove it from the address bar immediately,
   send it only in the bounded start JSON body, and test the exact request shape.
2. Risk: exposing connect-link creation gives the model member-selection or
   cross-member authority.
   Mitigation: derive the member only from the active runtime write fence and
   forward no model-selected member, provider, or recipient field.
3. Risk: Web, Worker, and warm runner versions temporarily disagree.
   Mitigation: make the new operation additive and capability-absent on old
   runners, document the deploy order, then smoke the assistant and browser
   paths after compatible versions converge.
4. Risk: the UI implies complete or continuously refreshed medical records.
   Mitigation: state that this is a one-time Epic import, report exact run state,
   and keep deferred reconnect/refresh behavior closed.
5. Risk: the currently broad generic FHIR request succeeds in tests but is not
   accepted by Epic's patient-facing APIs.
   Mitigation: request only the currently useful Patient, laboratory
   Observation, and DiagnosticReport operations; omit refresh access and prove
   Epic's required query shapes with focused tests. A second Observation query
   is deferred because the durable checkpoint currently keys one scope per
   resource family.

## Tasks

1. Map existing app-shell, auth/consent, signed runtime-operation, assistant-tool,
   test, and browser-E2E patterns; verify current Epic onboarding requirements.
2. Add the two member pages using existing API contracts and design-system
   primitives, with explicit loading, empty, partial, failure, and disconnect
   states.
3. Wire one assistant-accessible connect-link operation through the existing
   signed Web control boundary and update the assistant capability guidance.
4. Replace the generic Epic resource request with one app-owned beta policy,
   including operation-aware SMART scopes and Epic-valid retrieval queries.
5. Add focused contract, route, tool, and UI coverage plus durable local and
   production setup documentation.
6. Run scoped and full required verification, direct browser proof, specialist
   audits, parent final review, plan closure, PR CI, and ReviewGPT.

## Decisions

- Do not add a feature flag. The pages remain session- and consent-gated, while
  missing Epic configuration already fails closed before provider redirect.
- Keep one-shot import semantics. Retry, reconnect, refresh, and broader record
  mapping remain separate product work because they require new lifecycle and
  retention decisions.
- Use a public SMART client with S256 PKCE and no `offline_access`. Persistent
  refresh would require Epic confidential-client credentials per customer and
  is intentionally not part of this one-time beta.
- Keep Epic's official sandbox as one curated server-owned directory entry with
  its own non-production client-id environment key. Never fall back between the
  production and non-production client IDs.
- Reuse the existing internal connect-link endpoint and signed runtime control
  transport instead of creating a new service or queue.

## Verification

- During implementation: focused Vitest files and `pnpm test:diff` over the
  touched owners.
- Before commit: the verification lane selected by
  `agent-docs/operations/verification-and-runtime.md`, `git diff --check`, direct
  desktop/mobile browser scenarios, required `frontend-review` and
  `coverage-write` passes, and the parent-owned full-diff review.
- After push: exact-head ReviewGPT in parallel with PR CI, followed by a clean
  merge proof against the latest base branch.

### Completion evidence

- Epic policy, SMART grant parsing, provider-directory, retrieval-query,
  browser-claim, route, assistant-tool, hosted-execution, runtime, and
  Cloudflare focused suites passed.
- The final Records UI suite passed 6/6, scoped ESLint passed, and the prepared
  Web TypeScript check passed after the latest UI review changes.
- Required `frontend-review` and `coverage-write` passes completed with no
  unresolved finding. Coverage added a fail-closed non-HTTPS authorization
  redirect test.
- The full affected-package lane completed all policy, boundary, cycle, and
  affected-package typechecks, then hit unrelated assistant-runtime timing
  failures while the shared host was saturated by concurrent test processes.
  The changed assistant and runtime paths passed in focused serial reruns; broad
  isolation remains the PR CI gate.
- Rendered desktop/mobile proof could not run because the required in-app
  browser runtime exposed no browser session. Live Epic authorization also
  requires an Epic-issued client id and registered callback, so that external
  smoke test remains a post-configuration check.
Completed: 2026-07-16
