import { describe, expect, it } from "vitest";

import { describeGoalSourcePublisher } from "@/src/lib/goals/goal-source-labels";

describe("describeGoalSourcePublisher", () => {
  it("labels the common publishers in the goal corpus", () => {
    expect(describeGoalSourcePublisher("https://pubmed.ncbi.nlm.nih.gov/37917155/")).toBe("PubMed");
    expect(describeGoalSourcePublisher("https://www.who.int/publications/i/item/9789240015128")).toBe("World Health Organization");
    expect(describeGoalSourcePublisher("https://odphp.health.gov/our-work/nutrition")).toBe("HHS");
    expect(describeGoalSourcePublisher("https://jcsm.aasm.org/doi/10.5664/jcsm.4758")).toBe("Journal of Clinical Sleep Medicine");
    expect(describeGoalSourcePublisher("https://professional.heart.org/en/guidelines")).toBe("American Heart Association");
    expect(describeGoalSourcePublisher("https://www.niddk.nih.gov/health-information")).toBe("NIDDK");
    expect(describeGoalSourcePublisher("https://nccih.nih.gov/health/x")).toBe("NCCIH");
  });

  it("falls back to the bare hostname and never throws", () => {
    expect(describeGoalSourcePublisher("https://www.example-society.org/guide")).toBe("example-society.org");
    expect(describeGoalSourcePublisher("not a url")).toBe("not a url");
  });
});
