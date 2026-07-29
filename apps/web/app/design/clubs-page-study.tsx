import { ClubsPageContent } from "@/src/components/clubs/clubs-page-content";
import { StickyNav } from "../sticky-nav";

export function ClubsPageStudy() {
  return (
    <div
      className="-mx-5 scroll-mt-20 overflow-hidden sm:-mx-8 lg:-mx-12"
      data-design-study="clubs-marketing-page"
      id="clubs-marketing-page-study"
      inert
    >
      <div
        className="relative h-[72px] bg-[#f5f0e8] [&>nav]:!absolute"
        data-design-state="clubs-navigation"
      >
        <StickyNav authenticated={false} />
      </div>
      <ClubsPageContent animatePhoneDemo={false} />
    </div>
  );
}
