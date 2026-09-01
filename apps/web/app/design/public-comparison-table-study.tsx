import { ComparisonTable } from "@/src/components/comparisons/comparison-table";
import type { ComparisonEntry } from "@/src/lib/comparisons/types";

const DESIGN_COMPARISON = {
  category: "wearables",
  chooseCompetitor:
    "Choose the wearable when continuous sensing and a daily recovery score are the main job.",
  chooseMurph:
    "Choose Murph when the main job is making sense of several health inputs and carrying a plan into daily life.",
  competitor: {
    clinicalRole: "Consumer wellness product, not medical care.",
    followThrough: "Daily scores, trends, and recovery guidance inside its app.",
    format: "Wearable sensor with a companion mobile app.",
    hardware: "A compatible band is required.",
    inputs: "Signals collected by the wearable and optional app context.",
    insightStyle: "Device-specific scores and trend summaries.",
    platforms: "Mobile companion app.",
    pricing: "Hardware purchase with an optional membership.",
    primaryJob: "Measure sleep, strain, and recovery continuously.",
  },
  competitorEvidence: {
    clinicalRole: [1],
    followThrough: [1],
    format: [1],
    hardware: [1],
    inputs: [1],
    insightStyle: [1],
    platforms: [2],
    pricing: [1],
    primaryJob: [1],
  },
  faqs: [
    {
      answer:
        "No. The wearable measures signals, while Murph works across the context a person chooses to share.",
      question: "Does Murph replace the wearable?",
    },
    {
      answer:
        "They can play complementary roles when the wearable remains the measurement source.",
      question: "Can they be used together?",
    },
    {
      answer:
        "The right choice depends on whether continuous sensing or broader interpretation is the main need.",
      question: "Which product is the better fit?",
    },
  ],
  headline: "Murph vs a recovery wearable",
  lastVerified: "2026-08-30",
  metaDescription:
    "Compare Murph with a representative recovery wearable across inputs, interpretation, follow-through, hardware, platforms, pricing, and clinical role.",
  name: "Recovery wearable",
  quickComparison: [
    {
      capability: "Continuous sensing",
      competitor: "yes",
      evidence: "inputs",
      murph: "no",
    },
    {
      capability: "Recovery score",
      competitor: "yes",
      evidence: "insightStyle",
      murph: "no",
    },
    {
      capability: "Cross source context",
      competitor: "limited",
      evidence: "inputs",
      murph: "yes",
    },
    {
      capability: "Ongoing conversation",
      competitor: "no",
      evidence: "format",
      murph: "yes",
    },
    {
      capability: "Required hardware",
      competitor: "yes",
      evidence: "hardware",
      murph: "no",
    },
    {
      capability: "Longitudinal history",
      competitor: "yes",
      evidence: "inputs",
      murph: "yes",
    },
    {
      capability: "Handles changing priorities",
      competitor: "limited",
      evidence: "primaryJob",
      murph: "yes",
    },
    {
      capability: "Familiar messaging access",
      competitor: "no",
      evidence: "format",
      murph: "yes",
    },
    {
      capability: "Proactive follow up",
      competitor: "limited",
      evidence: "followThrough",
      murph: "yes",
    },
    {
      capability: "No dedicated device",
      competitor: "no",
      evidence: "hardware",
      murph: "yes",
    },
  ],
  relationship: "complement",
  slug: "recovery-wearable",
  sources: [
    { label: "Synthetic product overview", url: "https://example.com/product" },
    { label: "Synthetic product support", url: "https://example.com/support" },
  ],
  tradeoffs: [
    "A wearable adds continuous measurement but requires hardware.",
    "A conversation layer can cover broader context but is not a sensor.",
  ],
  useTogether:
    "Keep the wearable as the measurement source and use Murph to place its signals alongside other relevant context.",
} satisfies ComparisonEntry;

export function PublicComparisonTableStudy() {
  return (
    <div className="grid gap-10">
      <ComparisonTable comparison={DESIGN_COMPARISON} />
      <ol aria-label="Synthetic comparison references" className="sr-only">
        <li id="comparison-recovery-wearable-source-01">
          Murph public product description
        </li>
        <li id="comparison-recovery-wearable-source-02">
          Murph public health boundary
        </li>
        {DESIGN_COMPARISON.sources.map((source, index) => (
          <li
            id={`comparison-recovery-wearable-source-${String(index + 3).padStart(2, "0")}`}
            key={source.url}
          >
            {source.label}
          </li>
        ))}
      </ol>
    </div>
  );
}
