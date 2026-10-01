# Serialize enrichment source reads with explicit repair

Status: completed
Created: 2026-09-29

The user resumed the accepted round-2 finding and authorized merge/deployment.
The hosted preparer reopened an attested path outside the canonical lock. An
explicit image repair could quarantine that file before publishing replacement,
turning temporary absence into an invalid-document hold and lost queued work.

Pass the existing vault root to preparation. Lock only its bounded source-file
read; render and provider work remain outside the lock. No new retry/state owner.
Controlled tests pause actual core rename after quarantine for first and subsequent
repairs, invoke the real preparer on queued work, prove waiting and unchanged hold
counts, then extract/apply with the retained digest. Genuine missing evidence
still rejects. 31 preparation, Poppler and composed flow cases and runtime
typecheck pass. Final exact-head review and CI are tracked on PR #3767.
Updated: 2026-09-29
Completed: 2026-09-29
