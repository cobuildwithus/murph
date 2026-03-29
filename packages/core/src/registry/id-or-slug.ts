interface ResolveRecordByIdOrSlugOptions<TRecord> {
  records: readonly TRecord[];
  recordId?: string;
  slug?: string;
  getRecordId: (record: TRecord) => string;
  getRecordSlug: (record: TRecord) => string;
  detectConflict?: boolean;
}

export interface RecordByIdOrSlugResolution<TRecord> {
  match: TRecord | null;
  hasConflict: boolean;
}

export function resolveRecordByIdOrSlug<TRecord>({
  records,
  recordId,
  slug,
  getRecordId,
  getRecordSlug,
  detectConflict = false,
}: ResolveRecordByIdOrSlugOptions<TRecord>): RecordByIdOrSlugResolution<TRecord> {
  const byId = recordId ? records.find((record) => getRecordId(record) === recordId) ?? null : null;
  const bySlug = slug ? records.find((record) => getRecordSlug(record) === slug) ?? null : null;

  return {
    match: byId ?? bySlug,
    hasConflict:
      detectConflict && byId !== null && bySlug !== null && getRecordId(byId) !== getRecordId(bySlug),
  };
}
