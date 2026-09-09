import assert from 'node:assert/strict'

// Narrow synthetic-journey oracle, not a general prose validator. Duration
// limits are legitimate; explicit failure claims about attached media are not.
// The parent still reviews the complete reply for meaning and useful phrasing.
export function assertNoSongAttachmentFailure(reply: string): void {
  const media = String.raw`(?:audio(?:\s+(?:attachments?|output))?|attachments?|voice\s+memo|song|track|file)`
  for (const failure of [
    /\b(?:cannot|can['’]t|could\s+not|couldn['’]t|unable\s+to|failed\s+to)\s+(?:attach|upload)\b/iu,
    new RegExp(String.raw`\b(?:cannot|can['’]t|could\s+not|couldn['’]t|unable\s+to|failed\s+to)\s+(?:send|deliver|provide|complete)\b[^.!?;\n]*\b${media}\b`, 'iu'),
    new RegExp(String.raw`\b${media}\s+(?:(?:is|are|was|were|has|have|been|still|currently)\s+)*(?:fail(?:ed|ure)?|unavailable|unsupported)\b`, 'iu'),
    new RegExp(String.raw`\b${media}\s+(?:(?:is|are|was|were|could|can|still|currently)\s+)*(?:not|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|can['’]t|couldn['’]t)\s+(?:be\s+)?(?:attached|uploaded|sent|delivered|provided|completed|available|supported)\b`, 'iu'),
    /\b(?:do\s+not|don['’]t|cannot|can['’]t)\s+support\s+(?:audio|attachments?|voice\s+memos?)\b/iu,
  ]) {
    assert.doesNotMatch(reply, failure, 'An attached song must not be reported as an attachment failure.')
  }
}
