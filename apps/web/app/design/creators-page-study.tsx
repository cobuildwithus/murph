import { CreatorsPageContent } from "@/src/components/creators/creators-page-content";
import { buildCreatorProgramMailto } from "@/src/lib/creator-program-contact";

export function CreatorsPageStudy() {
  return (
    <section
      className="mx-auto flex max-w-7xl flex-col gap-6 px-5 pt-12 sm:px-8 lg:px-12"
      data-design-section="creators-marketing-page-study"
      id="creators-marketing-page-study"
    >
      <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-muted-foreground">
        Health creators page · expertise into personal guidance
      </h2>
      <div
        className="-mx-5 overflow-hidden sm:-mx-8 lg:-mx-12"
        data-design-state="founding-creator-partnership"
        data-design-study="creators-marketing-page"
        inert
      >
        <CreatorsPageContent
          creatorMailto={buildCreatorProgramMailto({
            body: "Design study only",
            subject: "Design study only",
          })}
        />
      </div>
    </section>
  );
}
