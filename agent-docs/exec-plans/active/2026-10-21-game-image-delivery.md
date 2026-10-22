# Private Cloudflare Images delivery

Status: active
Created: 2026-10-21
Updated: 2026-10-21

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
