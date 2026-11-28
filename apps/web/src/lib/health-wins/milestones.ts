import { retiredAward, type StoredAward } from "../game/progress/awards";
import { medalView } from "../game/progress/view";
import type { CardSpec } from "./engine";

/** Individual achievements only. A friend pass describes another member. */
export function isPersonalMilestone(award: Pick<StoredAward, "kind" | "measureId" | "subjectMemberId">) {
  return !award.subjectMemberId && ["landmark", "time", "total", "days", "route"].includes(award.kind) && !retiredAward(award);
}

export function milestoneCard(award: StoredAward): CardSpec | null {
  if (!isPersonalMilestone(award)) return null;
  const medal = medalView(award, false, "us");
  return {
    id: `milestone:${award.id}`, kind: "milestone", filter: "milestones", theme: "milestones",
    title: { number: "", measure: medal.title }, subtitle: medal.detail, source_note: "",
    chart: { type: "medal", art: "drawing" in medal.face ? medal.face.drawing : medal.kind },
    share: { caption_tips: [] },
  };
}
