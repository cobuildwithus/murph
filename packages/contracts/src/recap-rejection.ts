import * as z from "./zod-runtime.ts";

/** Closed diagnostic rule vocabulary. Corrective messages are tool feedback, never telemetry. */
export const recapRejectionRuleSchema = z.enum(["authority_unavailable", "background", "block_count", "block_kind", "chat_line_opening", "chat_line_reuse", "chat_line_stock", "chat_score", "cover_cast", "cover_layout", "draft_file", "draft_json", "draft_schema", "emoji_ban", "entry_authority", "exclamation_ban", "frozen_mismatch", "group_score", "group_shaming", "headline_length", "identity_reference", "media_attempt_limit", "media_integrity", "media_operation_duplicate", "media_receipt_missing", "media_slot", "page_count", "photo_count", "photo_style", "picture_layout", "preview_unconfirmed", "prize_word_ban", "pronoun_ban", "quote_density", "quote_evidence", "quote_length", "quote_speaker", "quote_stack", "reference_photo", "reference_revoked", "scene_cast", "scene_count", "scene_prompt", "score_names", "score_numbers", "score_owing", "score_tie", "second_person_ban", "show_disabled", "song_line", "song_line_count", "song_style", "stat_value", "submission_deadline", "submission_unconfirmed", "superlative_count", "superlative_shape", "text_length", "treatment_length", "treatment_reuse"]);
export type RecapRejectionRule = z.infer<typeof recapRejectionRuleSchema>;
export const recapRejectionSchema = z.object({ rule: recapRejectionRuleSchema, message: z.string() }).strict();
export type RecapRejection = z.infer<typeof recapRejectionSchema>;
export const recapRejectionsSchema = z.array(recapRejectionSchema).max(100);
export class RecapRejectionError extends Error {
  constructor(readonly rejections: RecapRejection[]) {
    super(formatRecapRejections(rejections));
    this.name = 'RecapRejectionError';
  }
}
export function formatRecapRejections(rejections: readonly RecapRejection[]): string {
  return `Not saved. Fix these before submitting:\n${rejections.map(issue => `- [${issue.rule}] ${issue.message}`).join('\n')}`;
}
export function recapRejectionDetails(rejections: readonly RecapRejection[]) {
  const counts: Partial<Record<RecapRejectionRule, number>> = {};
  for (const issue of rejections) counts[issue.rule] = (counts[issue.rule] ?? 0) + 1;
  return { recapRejectionRule: rejections[0]?.rule ?? 'draft_schema', recapRejectionCount: rejections.length, recapRejectionCounts: counts };
}

/** Schema feedback stays actionable even for custom refinements (whose default is just Invalid input). */
export function recapSchemaRejections(issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[]): RecapRejection[] {
  return issues.slice(0, 100).map(issue => {
    const field = issue.path.map(String);
    if (field.includes('superlatives')) return { rule: 'superlative_shape', message: 'Cards: omit the array or use 1–2 unique eligible memberIds and distinct titles. Each title uses 2–6 words, at most 80 characters, without Most likely to or a trailing period; line is 1–160 characters. Do not use null.' };
    if (field.includes('cast')) return { rule: 'scene_cast', message: 'scene.cast must contain 1–2 unique, exact player names from game.json, each at most 200 characters.' };
    if (field.includes('scene')) return { rule: 'scene_prompt', message: 'Scene: use {cast: [exact player names], prompt: 80–700 characters, murph?: true}. No extra fields; omit murph when absent.' };
    if (field.includes('song') && !field.includes('files')) return { rule: 'song_line', message: 'Song: omit when unavailable; otherwise use title (1–30 characters), style (1–220), lyrics (4–6 nonempty lines, each at most 60). Do not use null or extra fields.' };
    if (field.includes('files')) return { rule: 'media_receipt_missing', message: `${receiptSchemaLocation(field)}files must contain at most 5 unique scene-N/song slots, where N is the zero-based authored page index. Copy successful receipts unchanged, including operationId, path, hash, mediaType, byteLength and any width/height/durationMs fields. Omit failed receipts; never invent one. Omit absent optional fields instead of null.` };
    if (field.includes('treatment')) return { rule: 'treatment_length', message: 'Use a nonempty treatment of at most 60 characters.' };
    return { rule: 'draft_schema', message: 'Use the exact {story, files} shape in writing-guide.md with no extra keys or null values. Pages use background and blocks; blocks use kind and the documented fields. Quotes nest {who,text} under quote; cards belong in story.superlatives.' };
  });
}

function receiptSchemaLocation(path: readonly string[]): string {
  const fields = new Set(['files', 'slot', 'receipt', 'operationId', 'path', 'hash', 'mediaType', 'byteLength', 'width', 'height', 'durationMs']);
  return path.filter(part => fields.has(part) || /^[0-9]{1,2}$/u.test(part)).join('.') + ': ';
}
