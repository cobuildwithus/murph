# Expand the external provider request guard

Status: active
Created: 2026-08-12
Updated: 2026-08-15

## Goal

- Make the external provider guard detect production SDK bypasses instead of
  only validating request objects at a small registered set of SDK call sites.
- Preserve narrow raw transport for presigned byte transfers, internal traffic,
  generic runner proxying, dynamic SMART/FHIR endpoints, providers without a
  verified provider-owned TypeScript SDK, and the existing path-scoped xAI
  `x_search` Responses extension. Generic runner and SMART/FHIR expressions
  need no exception when they carry no registered-provider facts.

## Success criteria

- The guard scans relevant operational JavaScript modules as well as
  TypeScript sources.
- Raw provider fetches, handwritten provider request/response contracts, and
  configurable provider origins are mechanically rejected unless a narrow,
  documented exception applies.
- Focused regression fixtures cover the reported Junction, Linq, OpenAI, and
  operational-script blind spots plus every accepted exception class.
- The guard and its documentation no longer overstate their coverage.
- Focused verification, exact-head CI, preliminary ReviewGPT specialists, and
  the final ReviewGPT loop complete with no unresolved accepted finding.

## Scope

- In scope:
  - `scripts/check-provider-request-boundaries.ts` and its focused tests.
  - The guard's registered provider and exception policy.
  - Durable security/testing documentation that describes the guard.
- Out of scope:
  - Migrating individual provider call sites to SDKs; sibling work owns those
    corrections.
  - Changing provider behavior, credentials, retries, timeouts, or product
    flows.

## Constraints

- ReviewGPT authors the first implementation patch; the parent inspects,
  applies, integrates, and verifies it.
- Prefer one explicit guard policy over a second inventory or detector.
- Exceptions must be path- and purpose-scoped rather than provider-wide.
- Keep direct identifiers, credentials, private provider payloads, and local
  filesystem paths out of durable artifacts.

## Risks and mitigations

1. Risk: broad URL matching flags internal traffic or provider byte transfers.
   Mitigation: prove each allowed transport class with explicit fixtures and
   require narrow exception metadata.
2. Risk: an unavoidable SDK transport adapter drifts beyond the exact reviewed
   request and constructor shape.
   Mitigation: pin the exact runtime SDK or SDK-owner binding, unique raw
   adapter, SDK-construction function, every authority-bearing helper, and the
   exclusive adapter consumer; same-owner callbacks pin the complete file. Require
   mutation fixtures for effects, helpers, imports, wiring, extra consumers,
   duplicate owners, and decoys before deliberately updating a digest.
3. Risk: the guard lands before sibling SDK migrations and makes CI red.
   Mitigation: keep the PR active, rebase only when the sibling migrations are
   available, and require a clean current-base guard run before merge.

## Tasks

1. [x] Inventory the current guard, tests, provider call sites, and exception
   classes.
2. [x] Ask ReviewGPT for a bounded implementation patch and inspect every hunk.
3. [x] Apply the accepted implementation, strengthen focused tests, and update
   truthful documentation.
4. [x] Run focused verification and direct positive/negative guard scenarios.
5. [ ] Push the exact candidate, run preliminary and final ReviewGPT audits
   with CI, remediate accepted findings, and close this plan.

## Decisions

- This is internal-only verification tooling; changelog is not applicable.
- The final guard is expected to fail against unmigrated production bypasses;
  merge readiness requires the sibling SDK migrations to remove those failures
  or a narrowly justified registered exception.
- Accepted the preliminary coverage specialist's three findings: presigned
  transfers now require static credential/header safety plus byte/stream proof,
  fetch aliases resolve at the nearest lexical binding, and SMART/FHIR does not
  exempt explicit registered-provider identifiers or hosts.
- Direct-entry detection compares normalized filesystem paths so the `tsx`
  package script cannot silently skip the guard when its module URL carries
  loader metadata.
- Accepted the first full-patch audit's transport and evidence findings:
  canonical Retell/Composio hosts and imported Node/Undici calls are registered,
  provider evidence accumulates instead of returning on the first label, and
  protocol-relative or backslash network paths are never treated as internal.
- Rejected a temporary baseline or warning mode for the intentionally red draft.
  The branch stays non-mergeable until the sibling provider migrations remove
  every current finding, matching the user-requested sequencing gate.

### ReviewGPT round 2 requirement-level retrospective

- Original requirement: one fail-closed guard must identify low-level requests
  and handwritten wire contracts for SDK-backed providers, while raw transport
  remains possible only through exact, structurally proven exceptions.
- First reviewed head `a55eb238e9cc69def11720b26a901e7489b07488`
  changed 3,097 lines. The round-2 head changed 3,713 lines, an increase of 616
  lines driven mainly by transport/evidence fixes and their regression matrix.
- The growth exposed a repeated mechanism: provider evidence, SMART/FHIR
  admission, presigned-transfer admission, and transport discovery each gained
  syntax-specific walkers or name heuristics. Those parallel owners can
  disagree, so a stronger fact discovered by the main classifier can be lost
  by an exception.
- Redesign decision: continue this PR because the guard, its executable matrix,
  and its policy documentation are one verification owner, but shrink and
  centralize the implementation before further tactical fixes. Provider
  migrations remain separate.
- One expression-fact collector will own resolved provider identities and
  explicit provider signals. Candidate classification and every exception will
  consume that same result. Delete the separate explicit-provider walker.
- Internal traffic will be limited to a statically known single-slash relative
  path or an exact trusted same-origin base. Dynamic template composition is not
  internal proof.
- Transport bindings will cover scoped ESM and CommonJS forms, including direct
  imports/requires, destructuring, namespace destructuring, and shadowing, for
  every scanned extension the guard advertises.
- Presigned transfers will accept only literal safe headers or the result of an
  explicit audited transfer-header factory, together with an opaque URL and an
  exact byte/stream method and payload shape. Variable-name and source-text
  heuristics will be deleted; stream piping will be established through AST
  bindings.
- xAI will no longer have a provider-wide exception. The only admitted raw xAI
  operation will be the existing path-scoped Responses request whose method and
  request body structurally prove the single `x_search` extension shape.
- Retell and Composio host ownership will be asserted directly, and composed
  fixtures will cross transport syntax, provider evidence, and exception shape
  so isolated helper tests cannot conceal disagreements.
- Accepted all round-2 implementation findings above. The intentionally red
  repository scan remains an accepted sequencing gate rather than a guard
  defect. If remediation needs another policy owner or materially exceeds this
  central-facts/exact-exception design, pause for a new requirement-level
  retrospective instead of layering another heuristic.
- Implemented the redesign with one provider-expression fact collector shared
  by candidate classification and every exception, scoped ESM/CommonJS
  transport bindings, static-only internal paths, registered transfer-header
  factories, AST-bound stream piping, and one exact xAI request exception.
- The correction head changes 4,332 lines, 619 more than the reviewed round-2
  head. That increase is the retrospective's declared scoped-binding, exact-xAI,
  and composed-fixture redesign; the parallel provider walker, dynamic-header
  name heuristic, and source-text stream proof were deleted rather than
  extended.
- ReviewGPT round 3 accepted three bounded bypasses inside that same design:
  effective-value overrides in the xAI object literals, direct CommonJS
  transport invocations that skipped binding discovery, and text-only trust in
  `request.url`/`input.request.url` as same-origin bases. The correction rejects
  open or custom-serialized xAI objects, reuses the existing transport module
  and method classifiers for direct `require(...)` calls, and deletes the two
  unproven origin spellings. Parent review also bound each registered transfer
  header factory call to its unique audited top-level declaration instead of
  trusting a same-named local function. No new policy owner or compatibility
  path was introduced.
- ReviewGPT round 4 accepted two remaining coverage gaps within the existing
  design. The lexical census now includes TypeScript import-equals declarations
  and every name bound by destructured function parameters, so provider SDKs,
  transports, and shadows cannot disappear through those forms. The shared
  expression facts now follow computed origin maps and merge provider evidence
  from explicitly transport-shaped call targets such as an injected
  `openAiFetch`, while root-relative traffic cannot erase that explicit target
  evidence. Parent review kept static response-member reads and project-owned
  provider handlers outside that target rule, preserving presigned byte
  transfers and internal handler composition without adding an exception.
- The first round-5 attempt was diagnostic because its required model
  self-attestation was `UNKNOWN`; it did not advance the substantive-round
  counter. Its three reachable findings were accepted within the existing
  retrospective design. Assigned CommonJS namespaces now compare the nearest
  declaration identity and fail after reassignment; destructured property types,
  exact fetch-compatible provider targets, and array-backed origins stay in the
  shared binding/fact pipeline. Presigned admission rejects spread call init and
  uses only AST/global-binding or exact type proof for byte bodies. Incoming
  runner pass-through requires exactly one non-spread `Request` argument. Loose
  `Request` handlers remain outside provider-target evidence, so no exception or
  second resolver was added.
- The valid round-5 retry accepted two remaining fact-flow gaps and one
  complexity collapse. The shared fact collector now retains nested
  destructured property provenance, follows exact properties only through
  closed local object/array literals, and inspects provider-bearing fetch tuple
  spreads before exception matching. Opaque spreads cannot enter any structural
  exception. Incoming-Request and SMART/FHIR exception owners were deleted:
  production-path fixtures prove the actual generic runner and clinical SMART
  calls carry no registered-provider facts, while provider-bearing lookalikes
  fail normally. Parent production-path review also removed the real Linq
  presigned byte `PUT` from the migration inventory by binding its provider-named
  URL to the unique audited owner-path normalizer, alongside the already bound
  header factory. Parent review then deleted the remaining transfer URL/source
  naming heuristics: every retained production byte or stream operation now
  resolves to a unique registered owner, and the streamed direct-R2 smoke must
  additionally prove the exact request binding and pipe target. This is not a
  provider-wide allowance.
- ReviewGPT round 6 accepted two review-induced bypass classes. The existing
  lexical resolver now retains untyped parameter defaults and chronological
  simple assignment expressions, and it restores only exact one-hop positional
  forwarding rather than another global fetch-name inventory. Reassignments
  away from a transport and wrappers that alter or reorder arguments remain
  non-transports. The xAI exception was reduced: its production owner now calls
  the direct static Responses literal with the direct closed request object, so
  declaration-time URL or init state cannot conceal later mutation. The shared
  fact owner and exception registry remain unchanged.
- Merged the sibling official-SDK migration from current `main` without
  adopting its comment-based raw-HTTP suppression. Comments cannot authorize a
  provider request, and SDK imports do not excuse a handwritten transport or
  contract. Fetch `.call` and closed `.apply` tuples are now classified through
  the same transport and provider-fact pipeline, so adapters retained by the
  migration remain findings until their operation can use the official client
  directly or a separately proven unavoidable transport class is approved.
- ReviewGPT round 7 accepted three remaining effective-value and provenance
  gaps without changing the round-2 architecture. Opaque exact fetch calls now
  inherit provider evidence only from their enclosing provider-specific SDK
  fetch adapter or unambiguous provider file, so the actual Junction and OpenAI
  adapter effects are findings while provider-neutral callbacks remain clean.
  The AgentMail transport was moved from its single generic cross-file retry
  helper into the AgentMail owner instead of adding interprocedural analysis.
  Identifier reads now resolve the nearest chronological declaration or simple
  assignment, presigned init and header proof requires direct immutable syntax,
  and the retained Linq upload invokes its audited frozen header factory at the
  fetch call. `.call` facts come from the underlying transport target; `.apply`
  admits exceptions only for direct closed array literals, while identifier,
  spread, and sparse tuples fail closed. No baseline, warning mode, comment
  suppression, SDK-import exemption, or new provider exception was added.
- The implementation follow-up accepted three high-confidence guard findings:
  provider identity could disappear at SDK/import helper boundaries, declared
  values could be trusted after a later effective-value override, and aliased
  `.call`/mutable `.apply` forwarding could lose transport provenance. The
  correction retains provider identity through exact lexical boundaries,
  resolves chronological effective values, derives `.call` provenance from its
  underlying target, and admits `.apply` only for immutable closed tuples.
- Current `main` now contains the sibling official-SDK migrations. The guard
  recognizes only exact, path-scoped SDK transport hooks whose provider, import,
  raw target, unique adapter implementation, and unique SDK-construction owner
  match pinned audited source spans. Composio, Lob, Junction, Linq, ElevenLabs,
  OpenAI, Resend, and Exa approvals are operation-specific; mutation fixtures
  prove that URL, init, cache/redirect, duplicate effects or owners, decoy or
  changed wiring, and mutable request shapes fail closed. This does not create
  an SDK-import exemption or authorize another handwritten provider operation.
- Accepted the later ReviewGPT authority-closure and dynamic-import findings.
  SDK bridge approval now requires the exact runtime SDK or SDK-owner import
  binding, one exclusive adapter consumer inside the pinned SDK-construction
  owner, and digests for every authority-bearing helper; complex same-owner
  Junction callbacks pin the complete file. Presigned transfer owner, header, and URL
  helper implementations are pinned as well. Literal dynamic imports of Node
  HTTP/HTTPS and Undici are recognized in `.mjs`, `.mts`, and `.cts`, with
  computed and unrelated imports remaining provider-neutral.
- The trusted round-10 full-snapshot Deep Research audit reviewed exact head
  `6e52240fd047ead4fe965e372e9ab225d71ceee6` with ReviewGPT `0.5.126` and
  returned `PASS`. It independently rechecked every registered SDK bridge,
  handwritten provider contracts, dynamic imports, presigned transfers, Node
  bootstrap/audit packaging, and the three prior High mechanisms; it found no
  reachable Critical or High failure, complexity collapse, purpose drift, or
  material UX failure.
- The first exact-head CI attempt exposed two integration-fixture failures from
  the newly merged current-sender work, not a guard exception. The stale docs
  index now points to the completed PR #1705 plan. Assistant runtime tests now
  build event-backed accepted input through the existing canonical helper,
  preserving the fail-closed accepted-event timestamp check, and the mocked
  successful provider turn supplies a valid final response. No production
  invariant, provider request rule, or provider exception was relaxed.
- The bounded post-acceptance base update merged current `main` through
  `250941b1eb9cf7a12c605b1140e9135202cc5e57`. Its only conflict accepted
  upstream's deletion of the obsolete completed PR #1705 index row; provider
  policy and executable guard ownership merged without conflict.
- A round-11 exact-head normal-Pro contingency returned four High mechanisms
  after more than five minutes, but its required model self-attestation was
  `UNKNOWN`, so it remains diagnostic rather than a substantive round. All four
  mechanisms were nevertheless accepted and reproduced: object destructuring
  could erase global fetch provenance, pre-bound `.bind` arguments were omitted
  from the effective call shape, generically named low-level wire contracts
  could lose unambiguous provider ownership, and literal dynamic imports of
  default-export fetch packages were treated as CommonJS callables.
- The correction stays inside the existing owners. Transport bindings now
  preserve lexical shadows while resolving direct, aliased, computed,
  defaulted, and rest destructuring from exact web globals or transport
  namespaces. Static transport module facts retain `require` versus dynamic
  `import` provenance, including exact default exports. Bound transport calls
  compose immutable pre-bound and invocation arguments across direct, aliased,
  member, `.call`, and closed `.apply` forms; opaque bound spreads fail closed.
  Strong generic request/response wire shapes inherit a provider only from one
  unambiguous transport-evidence provider, while provider-neutral fetch
  callable aliases and ambiguous files remain clean. No exception, suppression,
  baseline, or handwritten production request was added.
- Final mergeability required one bounded integration of current `main` through
  `c9e26b3398d42790f6ee4941efb8d94a17f36bef`. The guard implementation and
  focused tests merged without conflict. The testing map retains the expanded
  provider-guard contract alongside upstream's Frog verification row, and the
  assistant-runtime fixture keeps canonical event-backed accepted inputs while
  adopting upstream's valid recorded no-reply provider-turn shape. ReviewGPT
  `0.5.127` arrived from that base; the live registry, manifest, lockfile, and
  installed executable all identify `0.5.127` as latest.
- Exact-head CI for merge head `c5c469be553cdebdb54bb579fd576eab935c6d7b`
  passed the complete required matrix on retry after one upstream GitHub
  Markdown request returned a transient `403`. The focused guard remained
  green during that infrastructure failure.
- A fresh exact-head ReviewGPT audit then found three concrete High bypasses
  and one disclosure drift. Exact aliases of web globals or imported transport
  namespaces could lose transport identity; pre-bound transports stored in
  closed local object/array members could execute without composing their
  provider request arguments; and the Linq URL normalizer could act as a
  file-wide presigned-transfer capability outside its pinned owner. The PR body
  also omitted the Node bootstrap and full-audit `.nvmrc` packaging surfaces.
- The correction extends the existing lexical and closed-origin owners rather
  than adding an exception. Namespace aliases retain exact web, fetch-package,
  Node HTTP/HTTPS, and Undici identity until shadowed or reassigned. Closed
  member calls compose bound and invocation arguments across direct, `.call`,
  and closed `.apply` forms; spreads, conditional roots, direct member writes,
  and `Object.assign` retain all possible provider transports. A URL normalizer
  is now metadata on one exact digest-pinned transfer owner and cannot authorize
  a second owner. Production-owner duplicate-effect and adjacent mutation
  fixtures fail closed. The live PR disclosure is updated before the next
  exact-head audit.
- The final current-base merge advanced Junction timeseries response
  normalization without changing `requestSdkResource`, its one raw
  `this.fetchImpl` effect, SDK import, or same-owner wiring. Because that
  deliberately conservative approval pins the complete Junction client file,
  the unrelated response-normalization delta invalidated its authority digest.
  Parent audit confirmed the transport boundary was unchanged before updating
  only the whole-file digest; the existing URL/init/effect/import/wiring
  mutation matrix still rejects request-boundary drift.
- ReviewGPT round 12 returned one accepted High against exact current-base head
  `80b80058f90e3a2aa7ac2ed006ee412ab5054e46`: the direct member-mutation fix
  still compared root spellings, provider facts retained a declaration-time
  container fallback, and ordinary destructured local values were absent from
  the chronological binding census. Together, those paths could lose a bound
  provider transport or provider URL through a definitive container alias or
  destructuring refactor.
- The correction consolidates those paths into existing owners. Member
  mutations canonicalize definitive alias chains back to one lexical root
  binding; provider facts consume the same possible member initializers as
  transport analysis; and declaration/assignment destructuring, nested paths,
  array indices, and defaults are represented in the existing variable
  bindings. The competing declaration-time container fallback is deleted.
  Focused fixtures cover aliased direct writes and `Object.assign`, nested and
  array aliases, direct and aliased provider URL mutation, nested/defaulted
  destructuring, web/dynamic-import namespace destructuring assignments, and
  negative shadow/reassignment cases. No exception or provider request was
  added.

### ReviewGPT round 13 requirement-level retrospective

- Exact full-snapshot head `32292f89b4d6bae2c511f3293937d67fe53316e1`
  changed 9,853 lines versus 3,097 at the immutable first-reviewed head.
  ReviewGPT returned `RETROSPECTIVE_REQUIRED` because a conditional alias
  assignment repeats round 12's effective-value ownership seam: the variable
  resolver is set-valued, but member-mutation root canonicalization remained
  definitive-only.
- Requirement decision: local effective-value provenance is set-valued. One
  resolver must follow every chronologically possible lexical root for
  provider facts, transport targets, member reads, and member mutations.
  A conditional alias such as `alias = other` inside a branch therefore keeps
  both the prior and branch roots; neither may erase a provider transport.
- Supported bounded syntax is explicit: identifier/member aliases, closed
  object and array origins, property/array destructuring and defaults,
  chronological simple assignments, conditional/logical/sequence alternatives,
  direct member writes, and `Object.assign`. Scope identity, later definitive
  reassignment, and lexical shadows remain authoritative negative controls.
- Unsupported alias-producing calls, opaque computed roots, or spreads do not
  prove safety. When such a member mutation carries a provider-bound transport,
  the existing raw-boundary analysis must reject it conservatively rather than
  inventing a second scanner, exception, baseline, or compatibility path.
- Redesign decision: replace the single-result member-path canonicalizer with
  a set-valued resolver built on `resolvePossibleBindings` and the same binding
  value/path decomposition already used by provider and transport facts.
  Mutation matching consumes that set. The existing mutation candidate census
  remains only an AST index; it does not become a policy or provenance owner.
  If implementation requires another registry, walker, or exception, pause for
  a new retrospective instead of extending the patch.
- Implemented that redesign without a new census or policy owner. The
  member-path resolver now returns the deduplicated set of roots obtained from
  `resolvePossibleBindings` and decomposes identifier/member,
  conditional/logical/sequence, destructured, and closed local values through
  the shared binding values. Mutation matching compares every source/target
  root pair. Call-produced opaque roots stay marked; the existing mutation
  candidate index and bound-call/provider-fact analysis reject a provider
  transport stored through such a member at the mutation boundary.
- The new regression extends the round-12 matrix with both conditional simple
  assignment and conditional-expression aliases plus opaque direct-write and
  `Object.assign` targets. Scope shadows and later unconditional reassignment
  remain clean. The combined guard and Node-bootstrap suite passes 116 tests;
  production provider scan, repo-tools TypeScript compilation, docs drift, and
  doc gardening pass on the retrospective implementation.
- ReviewGPT round 14 accepted two remaining consumers outside the retrospective
  authority. Identifier transport analysis returned from the single latest
  transport-expression binding before earlier chronological possibilities,
  and property projection for destructuring or `Object.assign` read only
  declaration-time properties rather than indexed member mutations.
- The correction deletes the single-latest early return. Identifier transport
  analysis evaluates every `resolvePossibleBindings` value and its transport
  leaf, retaining prior web-global, Node, and Undici transports after a
  conditional benign substitution while allowing a definitive benign
  reassignment to close the set. One effective property-path reader now merges
  closed declaration values with the existing indexed member mutations; both
  destructured bindings and `Object.assign` source projection use it, including
  nested objects and arrays. An uninitialized assignment retains the prior
  bounded fallback only when the shared variable census has no accessible
  binding. Lexical shadows remain negative controls. No new registry,
  exception, scanner, or provider request was added.
- Exact full-snapshot round 15 at
  `33bfd94e0a922f379a7d83ca030eb1222f89d2cd` ran for 11 minutes 10 seconds
  with confirmed `gpt-5.6-sol` metadata and found one review-induced High:
  a closed object or array containing a reference-valued member remained a
  terminal textual mutation root instead of sharing the referenced object's
  runtime identity.
- The production-faithful reproduction proved that mutating
  `holder.current.send` can execute through `transport.send` without a guard
  violation. The correction keeps the round-13 one-owner design: the existing
  set-valued member-root resolver projects reference-valued closed members
  through the effective property-path reader before declaring the aggregate a
  terminal root. The existing mutation-candidate index is only a bounded
  relevance filter; declaration and effective member values remain the single
  authority. Separate alias-capture and member-observation positions preserve
  object identity while admitting later writes through an alias.
- Regressions cover closed objects and arrays, nested containers, direct writes
  and `Object.assign`, aliased aggregate writes, conditional alternatives,
  lexical shadows, and later definitive reassignment. The resulting mutation
  is visible from both aggregate and referenced-object call paths. No scanner,
  registry, exception, compatibility path, second provenance owner, or
  provider request was added.
- Exact full-snapshot round 16 at
  `3be2572f7963d69559eeb26960140126e4cc1036` ran with confirmed
  `gpt-5.6-sol` metadata and found one High in the existing fail-closed
  mutation boundary. A nested opaque segment such as `holder[key].send`
  caused the complete member path, including its live lexical root, to be
  discarded before the provider-bound value was inspected.
- The correction changes only the existing opaque-target predicate. It
  recovers the live lexical root and member depth independently from whether
  every segment is statically named, marks any non-literal computed segment as
  opaque, and sends both direct writes and `Object.assign` through the existing
  provider-bound transport fact reader. Focused regressions cover both bypass
  shapes plus shadowed, provider-neutral, and literal-computed controls. No
  scanner, registry, exception, compatibility path, second provenance owner,
  or provider request was added.
- Exact full-snapshot round 17 at
  `71ac237f0ad89a78ea8e50e3e60388dca9c62f0f` found one review-induced High:
  the round-16 predicate still required a variable binding before failing
  closed, so parameter-rooted, direct call-produced, and `this`-rooted opaque
  targets could discard provider-bound mutation evidence.
- The correction remains inside the same mutation owner. Call traversal marks
  the recovered chain opaque, `this` uses the existing root representation,
  and opacity is checked before any variable-binding proof. Only fully static
  targets continue into variable/static-member resolution. Direct-write and
  `Object.assign` regressions cover parameter, direct-call, and dynamic `this`
  roots, with provider-neutral and literal-computed controls. No scanner,
  registry, exception, compatibility path, second provenance owner, or
  provider request was added.
- Exact full-snapshot round 18 at
  `f456daebd2b2e521129fdc5550a40ad06a30d416` returned
  `RETROSPECTIVE_REQUIRED`. The round-17 local root grammar did not recognize
  awaited calls or conditional/logical/sequence target expressions, so the
  same call-produced mutation mechanism could still discard a provider-bound
  transport.
- Requirement decision: mutable local member transport storage remains a
  required bounded capability because closed object/array members, aliases,
  destructuring, direct writes, and `Object.assign` are already explicit guard
  contract. The repeated failure came from a second target-expression grammar,
  not from that requirement. Delete the duplicate root reader and make one
  resolver own target syntax, root binding, mutation matching, and the
  fail-closed opacity result.
- Implemented that decision with one target-expression resolver shared by the
  opaque mutation boundary, mutation relevance checks, and effective member
  initializer matching. Identifier/static-member and
  conditional/logical/sequence alternatives are the bounded supported syntax;
  computed segments remain conservative wildcard matches. Parameters, `this`,
  immediate or awaited calls, and every other unsupported target are opaque.
  Provider-bound transports fail at that mutation boundary, while
  provider-neutral values remain clean. Scope shadows and later definitive
  reassignment remain authoritative. No scanner, registry, exception,
  compatibility path, second provenance owner, or provider request was added.
- The direct-write and `Object.assign` regression matrix now covers immediate
  and awaited calls, parameters, `this`, conditional/logical/sequence
  alternatives, provider-neutral values, lexical shadows, and definitive
  reassignment. The focused guard suite passes 126 tests and the production
  provider scan passes on the retrospective implementation.
- Exact full-snapshot round 19 at
  `487606c116884773b5501234d4023050847afbb5` ran for 37 minutes with confirmed
  `gpt-5.6-sol` metadata and found two High gaps. Conditional, logical, or
  sequence aliases could retain an imported HTTP namespace without copying its
  transport provenance, and an exact `fetch` URL could come from a uniquely
  resolved same-file helper whose direct return was never inspected.
- The correction stays inside the existing owners. Namespace propagation now
  records every possible transport kind at one binding point and all consumers
  read that set, preserving lexical shadows and definitive reassignment. The
  shared provider-expression facts reader now follows direct returns from one
  unshadowed local function declaration, skips nested functions and recursive
  cycles, and disables only file-level fallback hints inside the callee so a
  generic returned `Request` cannot inherit unrelated provider evidence.
  `.mjs`/`.mts`, mixed-namespace, copied-alias, internal-only, shadow,
  definitive-reassignment, nested-function, recursive, and generic-Request
  controls are executable. No scanner, registry, exception, compatibility
  path, second provenance owner, or provider request was added.
- A non-Eragon full-snapshot round-20 diagnostic at
  `b616a818e7a7aa13514be1568802805e0d52da1e` ran for about 52 minutes on
  Phlebas. Captured response metadata identified the compatible
  `gpt-5-6-pro` backend, but the response's required self-attestation remained
  `MODEL_CONFIRMATION: UNKNOWN`; the run is therefore diagnostic evidence and
  cannot close the final review gate. It found two review-induced High gaps:
  same-file URL helpers did not map omitted or explicitly undefined arguments
  to parameter defaults, and a conditionally executed benign transport
  assignment could erase an earlier possible Node/Undici namespace.
- The correction maps call-site arguments, parameter defaults, destructured
  property defaults, and bounded conditional/logical alternatives into the
  existing direct-return provider-fact traversal. Call context is carried
  through nested same-file helpers so an explicit internal override remains
  authoritative. Transport consumers now use the shared set-valued variable
  chronology, retaining an earlier namespace only when a later assignment may
  be skipped. Copied aliases, destructuring, logical assignments, switches,
  loops, mixed Node/Undici possibilities, lexical shadows, and definitive
  reassignment are executable controls. No scanner, registry, exception,
  compatibility path, second provenance owner, or provider request was added.
- At the user's request, the repository's package-backed ReviewGPT runner and
  release-contract fixture were upgraded from `0.5.127` to `0.5.132`. The
  exact minimum-release-age allowlist and lockfile now identify the same
  version, including the package's configurable marked-response trust
  threshold contract. Eragon is excluded from subsequent review routing
  because its rate limit is silent.

### ReviewGPT round 20 requirement-level retrospective

- A trusted non-Eragon full-snapshot review of exact head
  `a0eddd83a93af27edbdf52ec4f9a1b3667a80b03` returned
  `RETROSPECTIVE_REQUIRED`. The same-file helper mechanism added after round 19
  had three facets of the same ownership gap: container defaults on nested
  object or array patterns were discarded, opaque or spread-produced inputs
  did not retain reachable defaults, and callable resolution excluded local
  arrow functions and function expressions.
- Requirement decision: retain bounded same-file helper inference. Deleting it
  would reopen the exact helper-return bypass that round 19 required the guard
  to close. Every call value not proven present and non-`undefined` must retain
  the applicable parameter or destructuring default as a possible value.
  Statically resolvable local callable declarations, arrow functions, and
  function expressions are the same supported contract; lexical shadows and
  definitive later assignments remain authoritative negative controls.
- Redesign decision: parameter-path projection owns default activation at each
  object or array step, while the existing set-valued variable chronology owns
  local callable selection. Direct-return provider inference consumes both;
  there will be no second syntax scanner, helper registry, provenance table,
  exception, or compatibility path. Unknown calls, computed properties, and
  spreads remain conservative rather than proving a default unreachable.
- The executable proof matrix must cover a nested object container default,
  array-element default, opaque inputs that may produce `{}` or an explicitly
  `undefined` property, object and array spread equivalents, direct-return
  arrows and function expressions, lexical shadows, explicit internal
  overrides after opaque spreads, and definitive internal reassignment.
- Implemented the redesign without a new registry or scanner. Parameter
  binding entries now retain an ordered object/array path whose individual
  steps own their defaults. Projection preserves a default whenever a step is
  absent, opaque, spread-produced, or not proven non-`undefined`; a later exact
  internal property remains definitive. The callable resolver reads function
  declarations and every chronologically possible function-valued variable
  binding through the existing lexical binding authority.
- The expanded `.mjs`/`.mts` regression matrix passes 132 focused guard tests.
  Repo-tools TypeScript compilation, the production provider scan, doc
  gardening, and the full 39-file/763-test repo-tools aggregate pass. A repeated
  diff-aware aggregate encountered two untouched native worktree-hook timeouts
  under shared-host contention after all earlier gates passed; both exact cases
  passed together in the immediate isolated retry.

### ReviewGPT round 21 requirement-level retrospective

- Exact full-snapshot head `5a898b4f9dceccf289f37b10d914f0434a12b5ec`
  grew from 3,097 changed lines at the immutable first-reviewed head to 12,018
  changed lines across 41 files. ReviewGPT returned `RETROSPECTIVE_REQUIRED`
  because the round-20 correction still split same-file helper values across
  variable-before-parameter lookup, a direct-function callable filter, and a
  computed-property exclusion.
- Requirement decision: retain bounded same-file helper inference because
  deleting it would reopen the exact helper-return bypass accepted in round 19.
  One set-valued helper-value resolver must own lexical variables, mapped caller
  parameters, callable alternatives, function declarations, and destructuring
  projection. A mapped parameter shadows an outer variable; a genuinely nested
  local binding shadows that parameter, while a conditional local assignment
  retains the parameter as an earlier possible value.
- The bounded expression grammar is identifier aliases, assignment and await
  wrappers, conditional and logical alternatives, the effective last sequence
  value, direct function declarations, arrows, function expressions, and copied
  values composed from those forms. Statically named computed destructuring
  keys use the same exact property step as ordinary keys. A dynamic computed
  key is an unsupported wildcard: it retains the complete source value and all
  reachable defaults as possible facts instead of silently dropping the bound
  name. Opaque calls and spreads likewise cannot prove a default unreachable.
- Design decision: continue with consolidation, not another syntax-specific
  patch. Delete the separate `resolveProviderCallables` grammar and make call
  inference consume the same value alternatives used for argument forwarding
  and property projection. Property steps become input to that authority rather
  than an independent admission gate. No scanner, callable registry,
  provenance table, exception, compatibility path, or parallel resolver is
  permitted.
- Review-driven growth is concentrated in same-file return inference and its
  regression matrix. The correction must reduce owners even if its focused
  fixtures grow: variable/parameter precedence, callable selection, and
  computed destructuring are proved through the one value resolver, with
  nested forwarding, conditional and copied callables, static and dynamic
  computed keys, lexical shadows, conditional writes, and definitive
  reassignment as executable controls.
- Implemented that consolidation by deleting both the standalone callable
  resolver and the separate property-path value resolver. The remaining
  set-valued helper-value resolver consumes mapped parameters, actual write
  scopes, chronological bindings, function declarations, expression-valued or
  copied callables, and exact or wildcard property steps. The binding census
  records conditional execution and the write's lexical scope as facts; it does
  not gain another syntax walk or policy decision. Nested caller values survive
  into closures, while each callee parameter replaces an equally named caller
  parameter. No scanner, registry, exception, compatibility path, or provider
  request was added.
- The resulting focused provider-guard suite passes 135 tests in both `.mjs`
  and `.mts` modes. Repo-tools TypeScript compilation, the production provider
  scan, doc gardening, diff integrity, and the diff-aware verifier pass. The
  full repository-tools matrix passed twice at 39 files and 766 tests.

## Verification

- `pnpm provider-requests:guard`
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-provider-request-boundaries.test.ts`
- `pnpm test:repo-tools`
- `pnpm test:diff scripts/check-provider-request-boundaries.ts scripts/check-provider-request-boundaries.test.ts agent-docs/SECURITY.md agent-docs/references/testing-ci-map.md`
- `git diff --check`
- Exact-head CI and routed ReviewGPT passes.

Current evidence:

- Round-21 consolidation focused provider-guard suite: 135 tests passed.
  Repo-tools TypeScript compilation, the production provider scan, doc
  gardening, and `git diff --check` pass. The full repository-tools matrix and
  the diff-aware verifier's repeated matrix each pass 39 files and 766 tests.
- Round-20 correction focused provider-guard suite: 131 tests passed across
  `.mjs` and `.mts` fixtures. Repo-tools TypeScript compilation, the production
  provider scan, frozen lockfile installation, doc gardening, and the focused
  ReviewGPT release-contract test pass. The full workspace command completed
  every package/app typecheck; its independent workspace-boundary phase still
  reports the unchanged CLI-test relative import into `apps/web`.
- The global affected-change verifier passed all 387 CLI tests and 759 of 762
  repo-tool tests. Three unrelated process-heavy fixtures reached their fixed
  local timeouts under shared-host contention; isolated retries remained
  resource-bound, so exact-head CI remains authoritative for those fixtures.
- A fresh exact-head non-Eragon ReviewGPT round remains required after the
  correction is committed and pushed.
- Round-19 correction focused provider-guard suite: 129 tests passed.
- Full repository-tool suite after the round-19 correction: 39 files and 760
  tests passed.
- Repo-tools TypeScript compilation and the production provider scan pass on
  the round-19 correction.
- The full workspace command completed every package/app typecheck on the
  round-19 correction. Its independent workspace-boundary phase still reports
  the unchanged CLI-test relative import into `apps/web`; this PR does not
  touch that file or boundary.
- Round-18 focused provider-guard suite: 126 tests passed.
- Full repository-tool suite after the round-18 redesign: 39 files and 757
  tests passed.
- Repo-tools TypeScript compilation, production provider scan, doc gardening,
  and `git diff --check` pass on the round-18 redesign. The full workspace
  command also completed every package/app typecheck, but its independent
  workspace-boundary phase reports an unchanged relative app import in
  `packages/cli/test/release-script-coverage-audit.test.ts`; exact-head CI owns
  that unrelated gate.
- Focused guard suite: 124 tests passed on the current merged base, including
  direct ReviewGPT reproductions and negative controls for unrelated objects,
  imports, namespace aliases, closed member origins and mutations, callables,
  ambiguous provider evidence, and domain models.
- Full repository-tool suite: 36 files and 650 tests passed.
- Repo-tools TypeScript compilation passes with `tsconfig.tools.json`.
- The combined guard and Node-bootstrap suite passes 125 tests after the final
  base merge.
- `pnpm provider-requests:guard`: passes on the current merged base containing
  the sibling SDK migrations and exact registered SDK hooks.
- Repo-tools TypeScript compilation and the production provider scan pass after
  the three latest ReviewGPT mechanisms and adjacent mutation closure.
- `bash scripts/doc-gardening.sh --fail-on-issues`: passes with zero issues.
- Exact-head CI on `41fc0d55d8d9a78d130cc4b35e34f847dcfe67d4`
  passed release build/typecheck, all assistant/CLI/platform package coverage,
  app verification, both CLI host matrices, frontend, billing, sandbox,
  fixture, overflow, and tracked-artifact gates before the bounded base update.
- Exact-head CI on bounded-base head
  `e6c52ea3cf102973b575792cb3e298eaa73da183` passed the same complete required
  matrix, including the final release aggregate, before the round-11 diagnostic
  findings were remediated.
- The corrected assistant local-service runtime file passes all 103 tests with
  the CI-owned heap. The package-wide coverage run passed 238 files and 3,722
  tests before one unrelated 513-receipt stress fixture timed out under local
  machine contention; that fixture passed independently both without coverage
  and with coverage instrumentation in about five seconds.
- The trusted round-10 full-snapshot ReviewGPT audit returned `PASS`; a fresh
  exact-head review remains required after the final candidate is pushed.
- The first round-11 exact-head Deep Research attempt produced no verdict or
  response artifact after its managed-browser capture failed. It does not count
  as a substantive review round; the current-base head requires a fresh retry.
- Full affected integration evidence includes Cloudflare 2,435 tests, web
  branch-owned SDK clusters 113 tests, assistant engine 317 tests,
  assistant-runtime Linq 30 tests, hosted-local Linq 25 tests, device-sync
  1,070 tests, operator configuration 318 tests, and contracts 280 tests.
- Exact-head CI remains the authoritative broad PR gate for the authored patch.
