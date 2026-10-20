---
title: 'Vault restart fixture discards its encrypted object-store data'
severity: 'minor'
---

## Expected Behavior

The hosted vault-persistence scenario should retain its encrypted object-store data while restarting the complete local stack, then restore and inspect the exact committed snapshot using the preserved synthetic keys and Worker state.

## Current Behavior

Candidate hosted run 39345272648 passed lost-active-operation steering and the vault scenario's real Codex write, first encrypted snapshot inspection, and exact single reply. After stopping and restarting the stack, snapshot inspection failed with HTTP 404. The fixture retained its explicit Worker persistence directory, but did not set MURPH_DEV_MINIO_DATA_DIR. The unchanged MinIO owner defaults E2E storage to the stack temporary directory, which stack.stop removes. The restarted stack therefore had an empty object store while its retained Worker state still referenced the old object. This lifecycle is identical at the PR base; the previously live-only scenario had skipped without provider credentials.

## Minimal Reproducible Example

Run the vault-persistence scenario in the stub profile with the real candidate binary. Preserve only persistDirOverride across scenario.stop and start a new scenario. The first encrypted snapshot inspection passes and the post-restart inspection returns HTTP 404. Bind MURPH_DEV_MINIO_DATA_DIR to a child of the same scenario-owned persistence directory so Worker and object data share the intended restart lifetime. Preserve all encrypted-checkpoint and reply assertions.

## Context

The fixture now uses the existing explicit MinIO data-directory option; no production code or storage contract changes. MinIO support tests pass 21 and Cloudflare typecheck passes. Native hosted run 39352471410 on head 187a57e8 subsequently passed the complete restart journey: the real Codex 0.163.0 write, initial encrypted snapshot readback, exact one reply, and post-restart encrypted snapshot readback. The earlier 404 run remains the negative proof. The task's afterAll owns removal of the shared synthetic persistence root. No production secrets or objects are used.
