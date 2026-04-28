export function splitBulletLead(item: string): { lead: string; rest: string } {
  const trimmed = item.trim();
  const sentenceEnd = trimmed.match(/^[^.!?]{6,80}?[.!?:](?:\s|$)/);
  if (sentenceEnd) {
    const lead = sentenceEnd[0].trim();
    const rest = trimmed.slice(sentenceEnd[0].length).trim();
    if (rest) return { lead, rest };
  }
  const commaEnd = trimmed.match(/^[^,]{6,70}?,\s/);
  if (commaEnd) {
    const lead = commaEnd[0].replace(/,\s$/, "").trim();
    const rest = trimmed.slice(commaEnd[0].length).trim();
    if (rest) return { lead, rest };
  }
  return { lead: "", rest: trimmed };
}
