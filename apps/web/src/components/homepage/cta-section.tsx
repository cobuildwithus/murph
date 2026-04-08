import { HomepageCtaContent } from "./homepage-cta-content";

export function CtaSection() {
  return (
    <section className="border-t border-stone-200 bg-olive">
      <div className="mx-auto max-w-7xl px-6 py-20 text-center text-white md:px-12 md:py-28 lg:px-16">
        <HomepageCtaContent />
      </div>
    </section>
  );
}
