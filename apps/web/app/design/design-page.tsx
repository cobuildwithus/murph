import Link from "next/link";
import { BrandContent } from "./brand-content";
import { ComponentsContent } from "./components-content";
import { ConsentContent } from "./consent-content";
import { ExperimentCadenceStudy } from "./experiment-cadence-study";
import { SectionsContent } from "./sections-content";

const TABS = [
  { id: "brand", label: "Brand" },
  { id: "components", label: "Components" },
  { id: "consent", label: "Consent" },
  { id: "sections", label: "Sections" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function DesignPage({
  activeTab = "brand",
  designFocus,
}: {
  activeTab?: string;
  designFocus?: string;
}) {
  const selectedTab: TabId =
    TABS.find((tab) => tab.id === activeTab)?.id ?? "brand";

  return (
    <main className="min-h-screen bg-[#f5f0e8] antialiased">
      {/* Tab nav */}
      <div className="sticky top-0 z-30 overflow-x-auto border-b border-[#e5e1d8] bg-[#f5f0e8]/95 backdrop-blur-sm">
        <div
          className={`mx-auto flex min-w-max items-center gap-1 py-3 ${
            selectedTab === "sections"
              ? "max-w-7xl px-5 sm:px-8 lg:px-12"
              : "max-w-5xl px-6 sm:px-10 lg:px-16"
          }`}
        >
          {TABS.map((tab) => (
            <Link
              aria-current={selectedTab === tab.id ? "page" : undefined}
              href={`/design?tab=${tab.id}`}
              key={tab.id}
              replace
              scroll={false}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                selectedTab === tab.id
                  ? "bg-[#1A1F16] text-[#FAF8F4]"
                  : "text-[#5C5A52] hover:bg-[#e5e1d8]"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {selectedTab === "brand" ? (
        <BrandContent />
      ) : selectedTab === "sections" ? (
        <SectionsContent sectionFocus={designFocus} />
      ) : selectedTab === "consent" ? (
        <ConsentContent />
      ) : (
        <>
          <ExperimentCadenceStudy />
          <ComponentsContent />
        </>
      )}
    </main>
  );
}
