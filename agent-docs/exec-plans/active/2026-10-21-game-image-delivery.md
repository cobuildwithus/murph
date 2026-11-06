# Private Cloudflare Images delivery

Status: active
Created: 2026-10-21
Updated: 2026-10-22

## Goal

Game images load promptly through a private CDN while current game/profile
visibility remains authoritative and account deletion removes uploaded images.

## Scope and decisions

- User approved private Cloudflare Images, backend changes, separate checkouts
  and loss of existing images. No legacy-image migration or new dependency.
- New image bytes are provider-readable; other private records remain encrypted.
- Existing content keys and owner-bound Web/Worker authorization are reused.
  Opaque R2 pointers preserve retry identity; five-minute signed URLs are transient.
- Six concurrent native loads, independent cache hits and progressive publication
  are implemented in the companion `perf/game-image-loading` branch.
- Upload receipts and a permanent deletion guard close the observed race between
  an in-flight external upload and account cleanup. Ambiguous results fail closed.

## Verification and journeys

- Cover private upload, conditional retry election, owner isolation, signing,
  incorrect origin rejection, old-client byte delivery and viewer denial before
  capability creation. Cover deletion of referenced/orphaned images and upload drain.
- Run Cloudflare/Web/control-package focused tests and typechecks, complexity guard,
  parent diff/privacy review and applicable final review.
- Product UX: signed-in member saves/replaces/removes photo; another player sees
  only authorized content; locked media returns missing; an expired ticket retries;
  deletion waits for uncertain provider operations. Local composed proof is required.
- Live Images plan, private variants, expiry/unsigned rejection and deployment smoke
  remain release gates. No live credentials, deployment or billing changes performed.

## Rollout

Provision private variants, deploy additive Worker, then Web, then native. Preserve
old-Web control routes and old-native byte responses during skew. No migration;
rollback Web cannot read new Images pointers. Detailed procedure: Cloudflare DEPLOY.

## Local evidence

- Cloudflare: 26 tests, control client: 90 tests, Web: 22 tests passed.
- Cloudflare, control package and Web typechecks passed; complexity guard passed
  with only two unchanged transport/parser hotspots above 20.
- Parent traced OIDC owner binding, viewer authorization before signing, content
  identity, concurrent upload election, deletion receipt ordering and error privacy.
- Native counterpart: cobuildwithus/murph-ios#211; backend review: #4298.
- Release note covers resized delivery only, without claiming measured latency.
- Live setup and smoke remain pending; no production mutation performed.

## Security review and remediation

- User requested removal of the automatic ReviewGPT finding/resume pause. The
  workflow now continues accepted corrections within existing authority; genuine
  scope and external-action authority boundaries remain.
- Round 1 accepted one high-severity deployment finding at `8008416`: the scaffold
  binding was omitted by production/local config generators. Both generators now
  include it; regression checks cover preparation/staging and local fidelity.
- Three user-requested independent subagents reviewed native, Web/control, and
  Worker/storage security. Follow-up corrects native sign-out teardown and bounded
  response streaming, validates image metadata before upload admission, and scopes
  provider creator tags by stable deployment origin to isolate preview cleanup.
- Deployment admission now rejects any account-wide signature bypass and checks
  required private rendition dimensions/metadata before upload and activation.
- Read-only Cloudflare inspection found a signature-bypass variant and missing
  game renditions. No live configuration or billing was changed. Production rollout
  remains blocked until private configuration and synthetic live smoke are proven.
- No evidence-backed cross-member authorization, credential-forwarding, or SSRF
  bypass was found. Provider creator-list consistency and live image privacy are
  external proof gaps; metadata inspection is not exhaustive decoding, and
  ambiguous provider outcomes intentionally keep account deletion pending.

## Follow-up verification

- Generator/preparation/local-fidelity checks passed: 74 tests across four files.
- New deployment privacy admission and deploy entrypoint checks passed: 92 tests.
- Image inspection, environment isolation, deletion races and composed account
  cleanup passed: 37 tests. Hosted-local environment checks passed: 98 tests.
- Cloudflare and hosted-local-harness typechecks passed. Documentation drift and
  whitespace checks passed. Independent security review found no further proven
  authorization, credential, SSRF or activation-order issue after these fixes.
- Final exact-head review and CI will be recorded in PR evidence. Live private
  configuration and deployment smoke remain an explicit rollout hold.
