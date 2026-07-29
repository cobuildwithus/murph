import { ClubsPageContent } from "@/src/components/clubs/clubs-page-content";

export function ClubsPageStudy() {
  return (
    <div
      className="-mx-5 scroll-mt-20 overflow-hidden sm:-mx-8 lg:-mx-12"
      data-design-study="clubs-marketing-page"
      id="clubs-marketing-page-study"
      inert
    >
      <ClubsPageContent animatePhoneDemo={false} />
    </div>
  );
}
