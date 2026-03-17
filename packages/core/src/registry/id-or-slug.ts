interface SluggedRecord {
  slug: string;
}

interface ResolveRecordByIdOrSlugOptions<TRecord extends SluggedRecord> {
  records: readonly TRecord[];
  recordId?: string;
  slug?: string;
  getRecordId: (record: TRecord) => string;
  detectConflict?: boolean;
}

export interface RecordByIdOrSlugResolution<TRecord> {
  match: TRecord | null;
  hasConflict: boolean;
}

export function resolveRecordByIdOrSlug<TRecord extends SluggedRecord>({
  records,
  recordId,
  slug,
  getRecordId,
  detectConflict = false,
}: ResolveRecordByIdOrSlugOptions<TRecord>): RecordByIdOrSlugResolution<TRecord> {
  const byId = recordId ? records.find((record) => getRecordId(record) === recordId) ?? null : null;
  const bySlug = slug ? records.find((record) => record.slug === slug) ?? null : null;

  return {
    match: byId ?? bySlug,
    hasConflict:
      detectConflict && byId !== null && bySlug !== null && getRecordId(byId) !== getRecordId(bySlug),
  };
}
