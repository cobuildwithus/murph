# Labs Discovery

Status: Implemented

Last verified: 2026-07-16

## Member outcome

A hosted member can browse the current lab catalog on the authenticated,
unlinked `/labs` page or ask private Murph what tests are available. Both paths
read the catalog live and expose the same bounded facts about available panels,
individual biomarkers, current catalog prices, and ZIP-based collection
locations.

This is discovery only. Murph cannot order, pay for, book, or determine
eligibility for a test. The page has no navigation entry, map, or commerce
control, and a returned location does not reserve an appointment or prove that
a particular offering can be collected there.

## Discovery behavior

`murph.labs` is one read-only tool with three actions:

- `search` finds live provider-declared panels and biomarkers by a bounded
  query.
- `show` returns the current normalized detail for one offering selected from
  search.
- `locations` checks a five-digit ZIP and returns Junction's general home
  collection availability plus a bounded list of nearby patient service
  centers when it reports coverage.

The authenticated `POST /api/labs` browser API and signed
`POST /api/internal/hosted-execution/labs/tool` callback use the same stateless
service. The page makes no initial provider request; catalog and ZIP lookups are
separate submit-driven actions with independent state. Search results preserve
provider facts rather than adding a Murph popularity rank, medical
recommendation, or custom panel. Prices are labeled as current catalog prices,
may be unavailable, and are not final quotes.

## Murph guidance

For a broad interest such as heart health, whole-body health, or longevity,
Murph should search for relevant panels, compare the returned panels and their
included marker coverage, and present a few meaningfully different choices.
For a named analyte or tightly scoped question, Murph should search the exact
term and prefer the matching biomarker or a narrow panel. It should not dump the
full catalog into a reply.

Murph may explain what the provider catalog contains, but must not claim that a
test is medically necessary, eligible for the member, orderable through Murph,
booked, or available at a final quoted price. It must not promise an ordering
launch date.

Member-facing pages and assistant replies describe this as Murph lab test
discovery. The provider name, provider identifiers, catalog source, and
integration plumbing stay internal. When ordering is relevant, Murph may say
that it can help explore tests now and that ordering through Murph is planned
for later, without promising timing.

## Ownership and data lifecycle

`apps/web` is the sole Junction credential and provider-egress owner for this
feature. It reads the canonical `JUNCTION_API_KEY`, targets the code-owned
production US provider origin, and converts provider responses into strict,
bounded Labs contracts. The browser API is bound to the hosted app session; the
assistant path is bound to the existing signed Cloudflare-to-Web callback.

Cloudflare is an optional transport port only. Assistant runtime carries the
semantic request and normalized response, and assistant-engine advertises
`murph.labs` only when that port is present and the conversation is a verified
private direct context. Group and unverified audiences do not receive the
capability.

There is no Murph catalog database, sync job, cache, search index, popularity
projection, search history, or ZIP persistence. Queries, ZIP codes, provider
payloads, and tool results remain transient apart from normal encrypted
provider-thread continuity. The API key, authorization headers, raw provider
bodies, and raw provider errors must not enter logs, diagnostics, fixtures, or
client responses. Queries and ZIP codes must not enter Murph logs, diagnostics,
analytics, fixtures, or persisted state.

The browser and hosted-runtime boundaries accept those values only in POST
bodies. Junction's documented read APIs for [catalog
markers](https://docs.junction.com/api-reference/lab-testing/biomarkers), [area
coverage](https://docs.junction.com/api-reference/lab-testing/area-info), and
[patient service centers](https://docs.junction.com/api-reference/lab-testing/psc-info)
are GET-only and require the catalog term or ZIP as a query parameter. The Web
owner therefore sends the bounded value in a TLS-protected URL only to the fixed
Junction origin and exact allowlisted paths. Murph must never log or persist the
full outbound URL; controlled HTTP telemetry may include method, origin, path,
status, timing, and size only. Junction receives the value, and provider-side
URL handling or retention is governed by the Junction account and contract,
not Murph's no-persistence guarantee.

## Failure and freshness semantics

Every successful result includes a check time.
Requests are bounded by input length, result count, response bytes, time, and
location fanout, and propagate caller cancellation. Provider calls are not
retried automatically.

A provider timeout, rate limit, or server failure is temporary unavailability;
it must not be rendered as an empty catalog or an unsupported ZIP. A clean
provider response that reports no local coverage is `not_served`. Invalid
provider data fails closed behind a sanitized error rather than leaking a raw
body or inventing a fact.

## Explicit non-goals

This slice does not add ordering, payment, booking, eligibility, requisitions,
results, custom or composed panels, an address search, a map, navigation
exposure, public access, or a copied provider catalog. Those capabilities need
their own approved commerce, clinical, privacy, and persistence contracts.

## Deployment and proof

The callback and contracts are additive. Deploy Web first so the signed Labs
route and provider configuration exist, then Cloudflare and the hosted runner.
Missing or incompatible capability fails closed as unavailable. For rollback,
remove the runtime capability before removing the Web route.

Direct proof covers strict contracts, provider normalization and failures,
browser-session and signed-callback authorization, Cloudflare transport,
assistant registration/audience policy/prompt guidance, runtime wiring, and UI
states. Final UI proof includes authenticated renders at each viewport where
the result can differ, then the required frontend, coverage, Fable-or-Opus UI,
and ReviewGPT reviews.
