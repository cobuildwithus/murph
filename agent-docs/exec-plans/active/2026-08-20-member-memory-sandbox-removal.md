# Remove Redundant Member-Memory Sandbox Profile

Status: active
Updated: 2026-08-21

## Goal

Delete the member-memory-specific filesystem/network permission profile while
preserving the simpler tool-only maintenance boundary and successful overnight
memory consolidation.

## Evidence

- The failed implementation depended on a file-scoped writable sandbox mount;
  Codex treated the writable root as a directory and failed before the model
  turn could run.
- The repaired implementation no longer reads or writes memory through shell or
  filesystem access. The host exposes one canonical `murph.member_memory` tool
  only to the exact managed automation.
- The maintenance thread already disables shell, apps, browser use, plugins,
  web search, environment tools, hosted tool context, artifact materialization,
  progress delivery, and public internet fetch.
- The remaining member-specific permission profile duplicates those denials and
  is not the owner of memory read or write authority.

## Constraints

- Keep the exact managed automation-id authorization check.
- Keep the host-owned canonical memory tool as the only state boundary.
- Do not restore shell mutation, vault-wide reads, network tools, or a second
  memory implementation.
- Preserve the fresh one-shot thread and silent no-delivery behavior.

## Plan

1. Remove the member-memory-specific permission profile and its generated
   hosted config.
2. Leave the shared tool-only thread restriction and host-owned memory tool
   unchanged.
3. Update focused tests and durable security/reliability claims to describe the
   capability boundary instead of the deleted sandbox mechanism.
4. Run focused package tests and typechecks, then exact-head ReviewGPT and CI.
5. Merge, deploy the Cloudflare execution plane with immediate rollout, and
   verify the exact live version plus bounded memory-maintenance error logs.

## Verification

- Focused permission-config, assistant-turn, provider-seam, hosted-config, and
  real App Server memory-boundary tests: passed. The App Server scenario ran
  with `danger-full-access`, advertised exactly `murph.member_memory` on every
  provider request, and completed canonical memory read/write through that
  host-owned function.
- Affected `hosted-execution`, `assistant-runtime`, and `assistant-engine`
  package typechecks: passed.
- Exact-head round-one preliminary review found that the real App Server test
  proved the forbidden shell effect but did not assert the complete advertised
  provider tool inventory. Direct request inspection proved that Responses Lite
  carries provider tools in `additional_tools` and the former Terra target's
  catalog re-enabled collaboration despite generic feature flags. The focused
  first correction pinned the persisted managed seed to hosted OpenAI
  `gpt-5.5`, disabled the remaining process-owned registries, and required every
  provider request to expose exactly the one `member_memory` function.
- Final review then proved that a permanent earlier-seed reconciliation failure
  could leave the pre-correction target hint in place while the same due pass
  continued into the automation lane. It also proved that GPT-5.5 was outside
  the durable usage-pricing table. The first retrospective correction removed
  persisted target authority and added the official GPT-5.5 standard rate to
  the existing allowance owner.
- The next full audit identified that cron's explicit hosted-OpenAI provider
  transition could conflict with an invocation already hydrated only for
  custom inference or Venice. Static tracing and the documented provider
  contract proved the mechanism. Aggregate production inspection found no
  active non-default provider selection, so the incident path remains managed
  OpenAI, but the architecture now preserves the provider boundary generally.
- The final target owner is the existing provider-aware turn route. Cron passes
  no stored target for the exact memory profile. Managed OpenAI derives GPT-5.5
  and low reasoning; verified custom inference retains its opaque revision
  model; a provider catalog that cannot expose the one-tool contract fails
  before provider entry without fallback. No new state, repair loop, provider
  registry, compatibility layer, or sandbox was added.
- Provider-routing, managed-seed, focused cron, final-coverage, and real App
  Server tests pass (346 assertions). The App Server cases cover managed OpenAI
  and custom inference and assert exactly `murph.member_memory` on every
  provider request. Assistant-engine, assistant-runtime, and hosted-execution
  typechecks pass for the provider-aware change.
- The next full audit proved the custom-inference correction could not reach the
  provider-aware route because Cloudflare overloaded the saved
  `HOSTED_ASSISTANT_PROVIDER` field with the internal custom provider. The
  top-level hosted runtime and operator-config bootstrap both reject that value
  before assistant execution. The remediation keeps the dormant OpenAI/Venice
  product fields intact and passes the existing fence-bound custom provider
  plus opaque revision model as separate invocation-local Codex target facts.
  Runtime preparation, target hydration, detached work, and usage attribution
  now derive from that effective pair; the internal provider is never saved as
  an operator preference and no managed fallback was added.
- The composed Cloudflare projection, real Codex preparation, and hosted target
  hydration regression passes while proving saved product defaults stay
  unchanged. The hosted runtime entrypoint admits the custom target (339 tests),
  config/target regressions pass (51 tests), Cloudflare projection tests pass
  (19 tests), provider routing passes (12 tests), and both real App Server memory
  scenarios pass with the exact one-tool inventory. Assistant-runtime and
  Cloudflare typechecks pass for this remediation.
- Exact-head CI and next full final review gate: pending.
- Production deploy and bounded runtime-log verification: pending.

## Provider-Authority Retrospective

- Trigger: the fifth full audit proved that the custom-inference correction
  treated an invocation write fence as provider-selection authority. A member
  could deselect, replace, or delete revision R, successfully wake the still
  warm invocation, and then have a later provider turn continue through the
  fence-bound R envelope because the custom path skipped the live authority
  read. This repeats the earlier split-target mechanism and is a privacy and
  consent failure, so another local guard is not acceptable.
- Product decision: the durable provider selection and custom connection
  revision govern the next bounded provider turn. A warm invocation never
  extends consent to a deselected, replaced, deleted, or unverifiable custom
  endpoint.
- Single authority owner: the existing Web-owned
  `readHostedMemberAssistantModelPreference` read, reached through the existing
  assistant-configuration tool port, resolves live provider authority. The
  Cloudflare write fence remains execution and egress ownership only.
- Single authority fact: live provider authority is one discriminated value:
  managed provider identity or selected custom revision. Invocation transport
  may still carry the prepared Codex model and sealed endpoint needed to run,
  but neither is selection authority.
- Complexity decision: delete the custom-only authority bypass. Compare the
  invocation's effective provider identity/custom revision with the one live
  authority value at wake admission and immediately before provider-accepted
  inputs. A mismatch hands off before provider entry; an unavailable read fails
  closed. Add no registry, copied Cloudflare selection state, lease, queue,
  compatibility state, or reconciliation loop.
- Required proof: a composed warm custom invocation at revision R must admit an
  unchanged R, but after managed selection, replacement, deletion, or an
  unverifiable selected connection it must send no new request to R and hand
  off for a fresh invocation. Existing no-fallback behavior remains.
- Implementation: the existing assistant-configuration callback now has one
  control-only authority-read action. It reuses the existing Web preference
  query and projects either the live managed provider or selected custom
  revision. The model-facing tool parser and schema do not admit this action.
  The runtime uses the same comparison at warm-wake admission, provider entry,
  and detached-provider admission; the custom-only bypass is deleted.
- Rolling deployment: existing configuration-read responses remain byte-shape
  compatible. Deploy the additive Web control action first, then its
  Worker/runner caller with immediate rollout; roll back the caller first. This
  adds no state owner, background process, or reconciliation path.
- Focused proof: strict control contracts, Web authority projection, the
  Cloudflare transport, and the hosted runtime entrypoint pass. Runtime cases
  admit selected revision 7 and block replacement revision 8, managed/deleted
  state, and unverifiable custom state before provider entry; a composed warm
  custom invocation also hands off immediately after the live authority becomes
  managed. Affected hosted-execution, assistant-runtime, Cloudflare, and Web
  typechecks pass.

## State-Inconsistency Matrix

Invariant: the next provider boundary may use a custom target only when the
invocation's revision-derived model alias still equals Web's live selected,
verified custom revision. The write fence and sealed envelope never substitute
for that selection fact.

| Durable mutation | Live Web authority | Warm revision R result |
| --- | --- | --- |
| No selection change | custom R | admitted |
| Managed provider selected | managed provider | handoff before provider |
| Connection replaced | managed provider until explicit reselection, then custom R+1 | handoff before provider |
| Connection deleted | managed provider | handoff before provider |
| Selected connection requires reverification | custom revision unavailable | fail closed before provider |
| Authority read unavailable | unavailable | wake hint defers; provider entry fails closed |

The only durable state owner is the existing Web preference/connection read.
Invocation target facts and the Cloudflare fence remain ephemeral consumers;
the correction adds no copied selector, registry, lease, queue, or repair loop.
