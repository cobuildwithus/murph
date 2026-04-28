import { LandingAuthActions } from "@/app/auth-controls";
import { formatHostedLandingPricingLongSummary } from "@/src/lib/hosted-onboarding/billing-plans";

export function SiteFooter({ authenticated }: { authenticated: boolean }) {
  const launchPricingSummary = formatHostedLandingPricingLongSummary();

  return (
    <footer id="pricing" className="bg-[#2a2520] px-6 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-[1080px]">
        <div className="flex flex-col items-start gap-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
          <p className="text-[0.9375rem] text-[#f5f0e8]/60">
            <span className="font-semibold text-[#f5f0e8]">
              {launchPricingSummary}.
            </span>{" "}
            Private health vault, full experiment library, before and after
            analysis, cancel anytime.
          </p>
          <LandingAuthActions
            authenticated={authenticated}
            context="footer"
            signupLabel="Start your first experiment"
          />
        </div>
        <p className="border-t border-[#f5f0e8]/8 py-4 text-[0.75rem] leading-relaxed text-[#f5f0e8]/60">
          Murph provides educational health information and tools to help you
          understand your data and have better conversations with your
          clinician. It is not intended to diagnose, treat, or prevent diseases
          or other conditions and is not a substitute for professional medical
          advice. If you are or may be pregnant, nursing, have a history of an
          eating disorder, or have another medical condition, please talk to
          your doctor before using Murph.
        </p>
        <div className="flex flex-col gap-3 border-t border-[#f5f0e8]/8 py-4 text-[0.8125rem] text-[#f5f0e8]/50 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Early product, improving fast &middot; Open source &middot; Apache
            2.0
          </p>
          <a
            href="https://github.com/cobuildwithus/murph"
            target="_blank"
            rel="noreferrer"
            className="text-[#f5f0e8]/55 transition-colors hover:text-[#f5f0e8]/70"
          >
            GitHub &middot; Help us build
          </a>
        </div>
      </div>
    </footer>
  );
}
