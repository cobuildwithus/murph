"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { BrandContent } from "./brand-content";
import { ComponentsContent } from "./components-content";
import { ConsentContent } from "./consent-content";
import { SectionsContent } from "./sections-content";

const TABS = [
  { id: "brand", label: "Brand" },
  { id: "components", label: "Components" },
  { id: "consent", label: "Consent" },
  { id: "sections", label: "Sections" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function DesignPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTab = (searchParams.get("tab") as TabId) || "brand";

  function setTab(tab: TabId) {
    router.replace(`/design?tab=${tab}`, { scroll: false });
  }

  return (
    <main className="min-h-screen bg-[#f5f0e8] antialiased">
      {/* Tab nav */}
      <div className="sticky top-0 z-30 overflow-x-auto border-b border-[#e5e1d8] bg-[#f5f0e8]/95 backdrop-blur-sm">
        <div
          className={`mx-auto flex min-w-max items-center gap-1 py-3 ${
            activeTab === "sections"
              ? "max-w-7xl px-5 sm:px-8 lg:px-12"
              : "max-w-5xl px-6 sm:px-10 lg:px-16"
          }`}
        >
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-[#1A1F16] text-[#FAF8F4]"
                  : "text-[#5C5A52] hover:bg-[#e5e1d8]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "brand" ? (
        <BrandContent />
      ) : activeTab === "sections" ? (
        <SectionsContent />
      ) : activeTab === "consent" ? (
        <ConsentContent />
      ) : (
        <ComponentsContent />
      )}
    </main>
  );
}
