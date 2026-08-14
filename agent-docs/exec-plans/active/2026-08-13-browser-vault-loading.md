# Remove authenticated dashboard startup stalls

Status: active
Created: 2026-08-13
Updated: 2026-08-13

## Goal

- Make authenticated dashboard navigation render promptly without waiting for
  KMS-backed contact decryption or downloading the complete wearable history.
- Preserve private browser-side health-data decryption, current dashboard
  behavior, replica freshness, and hosted-runtime ownership.

## Success criteria

- `/training` and shared dashboard chrome do not await contact-data KMS work
  before rendering useful page content.
- The initial authenticated browser-vault payload excludes page-specific dense
  wearable metric history.
- Dense wearable data is fetched only by pages that use it and is compressed
  before encryption so transport compression does not depend on ciphertext.
- Mixed Web, Worker, and warm-runner versions fail soft during deployment.
- Focused tests, Web and affected package typechecks, and direct replica
  size/route-latency proof pass.
- Preliminary specialist ReviewGPT, final ReviewGPT, and required PR CI pass on
  the exact pushed head.

## Scope

- In scope: authenticated contact action projection, Browser Vault contracts,
  replica construction/storage/session loading, page-scoped client loading,
  compression/version compatibility, focused docs and tests.
- Out of scope: changing canonical health data, deleting wearable history,
  changing messaging destinations, redesigning dashboard UI, or adding a new
  scheduler, database owner, or third-party dependency without measured need.

## Constraints

- Web remains the owner of member/contact/control facts; Cloudflare remains a
  thin execution and encrypted-object adapter.
- Plaintext health data remains browser-decrypted and must not become a server
  render prop, cache entry, log field, or workflow payload.
- Replica refresh stays normal low-priority hosted runtime work under the active
  write fence and existing source-freshness owner.
- Compression must happen before encryption and must be bounded against both
  compressed and expanded sizes.
- Use the existing replica generation/readability compatibility seams rather
  than route-specific freshness owners.

## Tasks

1. Prove the KMS/contact stall boundary and document why page rendering reaches
   encrypted contact data.
2. Inventory Browser Vault consumers and choose the smallest core-versus-dense
   projection boundary.
3. Define a versioned compressed encrypted payload and mixed-version rollout.
4. Move contact actions and dense wearable loading behind non-blocking,
   page-owned boundaries.
5. Add focused compatibility, auth, freshness, decompression-limit, consumer,
   and route-render tests.
6. Measure the representative replica before and after without persisting
   private fixture contents.
7. Use the measured metric-key distribution and ReviewGPT architecture critique
   to replace the remaining all-metrics detail-page unit with bounded on-demand
   series partitions, or record why a smaller proven boundary is safer.
8. Run focused verification, parent review, PR/CI, specialist ReviewGPT, final
   ReviewGPT, and remediation rounds to a clean pass.

## Risks and mitigations

1. Risk: splitting replicas creates multiple freshness owners.
   Mitigation: retain one source hash/generation/ref owner and atomically
   publish one ref that names all already-encrypted projection parts.
2. Risk: decompression creates a zip-bomb or memory boundary.
   Mitigation: authenticate ciphertext first, enforce encoded and expanded byte
   ceilings, and reject unsupported codecs or size mismatches.
3. Risk: route-specific loading regresses refresh handoff behavior.
   Mitigation: reuse the existing Browser Vault provider and explicit refresh
   ownership while making projection-part demand declarative.
4. Risk: removing eager contact decryption changes available message channels.
   Mitigation: derive generic channel availability from complete opaque
   persisted markers and keep actual private endpoint decryption on the
   settings or delivery paths that consume it.
5. Risk: Web/Worker deployment skew makes current replicas unreadable.
   Mitigation: use additive request capabilities, dual identity/gzip readers,
   and an identity response for clients that do not advertise shard support.

## Verification

- Focused Browser Vault contract, store, route, provider, and dashboard tests.
- Focused hosted-contact and training-page tests.
- Typecheck every affected workspace package and `apps/web`.
- Direct size comparison of serialized, compressed, encrypted, and transferred
  representative replicas using aggregate-only output.
- Production-shaped route proof that useful page content does not await KMS or
  dense wearable data.
- Exact pushed-head PR CI plus both required ReviewGPT stages.

## Decisions

- The representative current replica is 7,027,801 JSON bytes. Metric rows are
  5.77 MB (82%). gzip level 6 is 637,463 bytes (9.1% of JSON). gzip before
  encryption materially reduces transfer size, but it is secondary to route
  sharding because it does not remove decoded JSON parse/allocation cost.
  Tuple and dictionary-tuple trials reduce raw metric JSON by 29% and 44%, but
  reduce gzip bytes by only 3.0% and 5.9%; that small transfer gain does not
  justify a custom codec. New physical shards still omit derived search rows
  and the constant metric row schema, while logical clients reconstruct the
  complete versioned replica. Do not claim gzip alone solves the mobile cost.
- Keep one existing workspace replica ref and source/generation owner. At the
  existing plaintext build boundary, publish already-encrypted `core`, `labs`,
  and `metrics-index` children plus 32 deterministic metric buckets, then
  atomically expose their shared ref. Each child chooses gzip or identity before
  encryption. During the mixed-version window, the ref also names the existing
  identity monolith; request-serving code selects ciphertext and never decrypts
  health data.
- `core` owns metadata, entities, experiment outcomes, bounded experiment run
  cards, personal patterns, derived search, timeline, and weekly summaries.
  `metrics-index` owns metric selections, goal progress, source health, and the
  exact metric-key-to-bucket directory. `labs` owns lab-result rows. Metric
  history exists only in the 32 bucket children; there is no all-row metrics
  child.
- `/home` and the exact `/experiments` list now use bounded producer-owned run
  card summaries in `core`, preserving current status, cadence, results, and
  public-protocol decoration without raw metric history. `/training`,
  `/environment`, `/overview`, `/patterns`, and `/history` are also core-only.
  Experiment and biomarker detail surfaces request only the metric buckets
  declared by their public bindings or encrypted core run projection.
- A client request that omits `requestedShards` is a legacy request and receives
  the identity JSON replica. New clients accept both the legacy monolith and
  encrypted sharded responses. Ref identity stays logical.
- Generic contact controls use opaque completeness/authority markers plus
  Murph-owned destinations; they do not decrypt member phone, Telegram, or
  email values. True private endpoint access remains encrypted and KMS-backed.
- Production timing proves the latency class predates the latest KMS SDK
  migration. The actionable defect is optional private projection work on the
  render critical path, not a proven single KMS operation regression.
- Aggregate-only replica replay found 6,884 semantic metric/date/unit/value
  groups and 902 provenance-distinct duplicates (11.6%). Every duplicate group
  has distinct record IDs and 232 cross source families, so deletion or
  deduplication would discard evidence. Metric definitions added immediately
  before the incident contributed zero rows; the size is retained wearable
  history plus verbose provenance, not a recent catalog/training code jump.
- The final dense-metric boundary is 32 deterministic SHA-256 buckets plus one
  encrypted metrics index under the existing atomic replica ref. The measured
  largest decoded bucket is 636,100 bytes, versus 5,451,482 bytes for the
  intermediate all-metrics object; total bucket gzip is 511,997 bytes, about
  2.8% above the single-object gzip body. Per-metric objects would create 129
  object/ref/cache/cleanup cases and add roughly 20% encrypted-body/ref
  overhead, so they are rejected.
- Metric provenance remains semantically lossless. Physical bucket rows may
  derive constant row schema and a grouped metric key, but record IDs, point
  IDs, context, source facts, timestamps, confidence, comparator, grain,
  statistic, unit, value, and labels are not deleted. A custom tuple or global
  provenance dictionary is deferred because it saves little compressed
  transfer and would require a second lazy object model to reduce heap.
- Public metric routes declare finite metric-key demand, normal private-route
  navigation reuses bucket IDs from encrypted core run projections, and only a
  cold private/custom experiment deep link may perform a bounded core-first
  follow-up. Do not add a server-visible experiment-routing manifest without
  production evidence that this rare extra round trip is a material bottleneck.
- Interactive clients retain only current route bucket demand and distinguish
  `unloaded`, `loaded-empty`, and `loaded` metric coverage. Complete export is
  the sole all-bucket consumer and processes buckets sequentially without
  constructing the interactive full-metrics query indexes.
- Final generation-10 archive replay measured a 586,645-byte core compressed to
  70,498 bytes and a core-only encrypted session response of 104,833 bytes. The
  32 metric buckets total 5,185,025 decoded bytes and 511,269 gzip bytes; the
  largest current bucket is 971,199 decoded bytes and 92,591 gzip bytes.
  Interactive decrypt/decompress work is capped at four concurrent children.
  The all-bucket export response is about 871 KB and retains at most one parsed
  metric bucket at a time.
