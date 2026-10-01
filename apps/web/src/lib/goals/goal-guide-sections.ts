export interface GoalGuideSection {
  body: string;
  id: string;
  title: string;
}

export interface GoalGuideOutline {
  intro: string;
  sections: GoalGuideSection[];
}

export const GOAL_GUIDE_SAFETY_SECTION_TITLE = "A quick note";
export const GOAL_GUIDE_SOURCES_SECTION_TITLE = "Sources";
export const GOAL_GUIDE_RELATED_SECTION_TITLE = "Related goals";

const GOAL_GUIDE_SECTION_HEADING = /^##\s+(?<title>.+?)\s*$/u;

export function splitGoalGuideBody(body: string): GoalGuideOutline {
  const introLines: string[] = [];
  const sections: { id: string; lines: string[]; title: string }[] = [];
  const usedIds = new Map<string, number>();

  for (const line of body.split(/\r?\n/u)) {
    const heading = GOAL_GUIDE_SECTION_HEADING.exec(line);
    if (heading?.groups) {
      const title = heading.groups.title.replace(/\s+#+$/u, "").trim();
      sections.push({ id: uniqueSectionId(title, usedIds), lines: [], title });
      continue;
    }

    const current = sections.at(-1);
    if (current) {
      current.lines.push(line);
    } else {
      introLines.push(line);
    }
  }

  return {
    intro: introLines.join("\n").trim(),
    sections: sections.map(({ id, lines, title }) => ({
      body: lines.join("\n").trim(),
      id,
      title,
    })),
  };
}

export function isGoalGuideSafetySection(
  section: Pick<GoalGuideSection, "title">,
): boolean {
  return section.title === GOAL_GUIDE_SAFETY_SECTION_TITLE;
}

export function isGoalGuideRelatedSection(
  section: Pick<GoalGuideSection, "title">,
): boolean {
  return section.title === GOAL_GUIDE_RELATED_SECTION_TITLE;
}

export function isGoalGuideSourcesSection(
  section: Pick<GoalGuideSection, "title">,
): boolean {
  return section.title === GOAL_GUIDE_SOURCES_SECTION_TITLE;
}

function uniqueSectionId(title: string, usedIds: Map<string, number>): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    || "section";
  const seen = usedIds.get(base) ?? 0;
  usedIds.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}
