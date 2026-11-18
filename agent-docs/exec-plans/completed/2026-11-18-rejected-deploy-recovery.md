# Recover from rejected runner admission

A failed isolated smoke can leave its candidate pinned even when the serving
application was never updated. Publish a forward compatibility version that
releases a candidate created by this attempt after the smoke rejects it. Keep
the pin across retries and any failure after native admission begins.

Verify the release configuration and deploy sequence for fresh and resumed
candidates, run the Cloudflare typecheck, and exercise the protected deploy.
Status: completed
Updated: 2026-11-18
Completed: 2026-11-18
