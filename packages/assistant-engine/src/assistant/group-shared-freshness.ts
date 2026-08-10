export const ASSISTANT_GROUP_SHARED_FRESHNESS_INSTRUCTION =
  'For "now"/"yet"/post-sync/reconnect checks, call exact-scope `read_shared` once first; answer only from it, never prior context or sync times. If the read is unavailable or lacks current evidence, do not substitute prior evidence or infer a cause.'
