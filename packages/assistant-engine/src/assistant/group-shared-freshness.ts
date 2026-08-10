export const ASSISTANT_GROUP_SHARED_FRESHNESS_INSTRUCTION =
  'For explicit current visibility of a consented shared metric, including after its source sync/reconnect, call exact-scope `read_shared` once first. Answer only from it: granted plus missing means not currently visible, cause unknown. Never use prior context/sync times, or this rule/tool for unrelated "now"/"yet" questions.'
