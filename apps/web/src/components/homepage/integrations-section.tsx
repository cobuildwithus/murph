import Image from "next/image";

import { LandingAuthActions } from "@/app/auth-controls";
import { LabReportIcon } from "@/src/components/icons/home-icons";

type Integration = {
  label: string;
  src: string;
};

const INTEGRATIONS: ReadonlyArray<Integration | "murph" | "lab"> = [
  { label: "Whoop", src: "/brand-logos/connect/whoop.svg" },
  { label: "Oura", src: "/brand-logos/connect/oura.png" },
  { label: "Apple Health", src: "/brand-logos/connect/apple-health.png" },
  { label: "Garmin", src: "/brand-logos/connect/garmin.png" },
  { label: "Fitbit", src: "/brand-logos/connect/fitbit.svg" },
  "lab",
  { label: "Dexcom", src: "/brand-logos/connect/dexcom.png" },
  "murph",
  { label: "Eight Sleep", src: "/brand-logos/connect/eight-sleep.svg" },
  { label: "Withings", src: "/brand-logos/connect/withings.png" },
  { label: "Peloton", src: "/brand-logos/connect/peloton.svg" },
  { label: "Cronometer", src: "/brand-logos/connect/cronometer.png" },
  { label: "Gmail", src: "/brand-logos/connect/gmail.svg" },
  { label: "Google Calendar", src: "/brand-logos/connect/google-calendar.svg" },
  { label: "Polar", src: "/brand-logos/connect/polar.svg" },
];

export function IntegrationsSection({
  authenticated,
}: {
  authenticated: boolean;
}) {
  return (
    <section className="bg-[#f5f0e8] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="mx-auto max-w-[960px]">
        <div className="text-center">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#736a58]">
            Connected data
          </span>
          <h2 className="mx-auto mt-5 max-w-[22ch] font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-[#2d3436]">
            Plugs into everything that knows your body.
          </h2>
          <p className="mx-auto mt-5 max-w-[56ch] text-base leading-[1.7] text-pretty text-[#736a58]">
            Your wearables, your labs, your inbox, your calendar. Murph reads
            it all and helps you build the habits that actually make you
            healthier.
          </p>
        </div>

        <div className="mt-16 grid grid-cols-3 gap-x-4 gap-y-10 sm:grid-cols-5 sm:gap-x-6 sm:gap-y-12">
          {INTEGRATIONS.map((item, index) => {
            if (item === "lab") {
              return (
                <div key="lab" className="flex flex-col items-center gap-3">
                  <div className="flex aspect-square w-full items-center justify-center text-[#2d3436]">
                    <LabReportIcon
                      aria-hidden="true"
                      className="h-10 w-auto sm:h-12"
                    />
                  </div>
                  <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#736a58]">
                    Lab reports
                  </span>
                </div>
              );
            }

            if (item === "murph") {
              return (
                <div key="murph" className="flex flex-col items-center justify-center">
                  <div className="flex aspect-square w-full items-center justify-center">
                    <Image
                      src="/icons/murph-mark.svg"
                      alt="Murph"
                      width={128}
                      height={128}
                      className="h-16 w-auto max-w-full object-contain sm:h-20"
                    />
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`${item.label}-${index}`}
                className="flex flex-col items-center gap-3"
              >
                <div className="flex aspect-square w-full items-center justify-center">
                  <Image
                    src={item.src}
                    alt={item.label}
                    width={96}
                    height={96}
                    className="h-10 w-auto max-w-full object-contain sm:h-12"
                  />
                </div>
                <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#736a58]">
                  {item.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-14 flex justify-center">
          <LandingAuthActions
            authLabel="Get started"
            authenticated={authenticated}
            context="footer"
            preloadAuthPanel
            signupLabel="Get started"
          />
        </div>
      </div>
    </section>
  );
}
