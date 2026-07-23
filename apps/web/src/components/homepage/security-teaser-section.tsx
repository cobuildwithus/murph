import Link from "next/link";

const PROMISES = [
  "We do not sell health data.",
  "We do not use Murph-managed health data to train general-purpose AI models.",
  "Access is limited to authorized systems, providers, and personnel.",
] as const;

export function SecurityTeaserSection() {
  return (
    <section className="bg-[#ebdfc6] px-5 py-20 sm:px-10 lg:px-16 lg:py-28">
      <div className="mx-auto grid max-w-[1120px] items-center gap-x-16 gap-y-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="flex items-center gap-4">
            <span aria-hidden="true" className="h-px w-10 bg-[#3a4a1e]/70" />
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#3a4a1e]">
              Security &amp; privacy
            </span>
          </div>
          <h2 className="mt-6 max-w-[18ch] font-serif text-[clamp(2rem,4vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-balance text-[#2d3436]">
            Your health data{" "}
            <span className="italic text-[#8a6a3a]">stays</span> yours.
          </h2>
          <p className="mt-6 max-w-[52ch] text-base leading-[1.7] text-pretty text-[#4d4533] sm:text-[1.0625rem]">
            Your data is encrypted in transit and at rest. Murph and its
            service providers may process it to run, secure, and support the
            service.
          </p>

          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {PROMISES.map((promise) => (
              <li
                className="flex items-start gap-3 text-[0.9375rem] leading-[1.5] text-[#2d3436]"
                key={promise}
              >
                <span
                  aria-hidden="true"
                  className="mt-[0.4rem] h-1.5 w-1.5 shrink-0 rounded-full bg-[#3a4a1e]"
                />
                {promise}
              </li>
            ))}
          </ul>

          <div className="mt-10">
            <Link
              className="inline-flex items-center gap-2 rounded-full bg-[#2d3436] px-5 py-2.5 text-[0.875rem] font-medium text-[#f5f0e8] transition-colors hover:bg-[#3a4044]"
              href="/security"
            >
              See how we protect your data
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>

        <TeaserVaultGlyph className="mx-auto w-full max-w-[360px] text-[#2d3436]" />
      </div>
    </section>
  );
}

function TeaserVaultGlyph({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      viewBox="0 0 340 340"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="0.8">
        <line x1="30" x2="50" y1="30" y2="30" />
        <line x1="30" x2="30" y1="30" y2="50" />
        <line x1="310" x2="290" y1="30" y2="30" />
        <line x1="310" x2="310" y1="30" y2="50" />
        <line x1="30" x2="50" y1="310" y2="310" />
        <line x1="30" x2="30" y1="310" y2="290" />
        <line x1="310" x2="290" y1="310" y2="310" />
        <line x1="310" x2="310" y1="310" y2="290" />
      </g>

      <rect
        height="210"
        rx="12"
        stroke="currentColor"
        strokeWidth="1.2"
        width="220"
        x="60"
        y="65"
      />
      <rect
        height="190"
        rx="10"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="0.6"
        width="200"
        x="70"
        y="75"
      />

      <circle
        cx="170"
        cy="150"
        r="56"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle
        cx="170"
        cy="150"
        r="46"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="0.6"
      />

      <circle cx="170" cy="150" fill="currentColor" r="5" />

      <g stroke="currentColor" strokeWidth="1">
        <line x1="170" x2="170" y1="86" y2="96" />
        <line x1="234" x2="224" y1="150" y2="150" />
        <line x1="170" x2="170" y1="214" y2="204" />
        <line x1="106" x2="116" y1="150" y2="150" />
      </g>
      <g stroke="currentColor" strokeOpacity="0.45" strokeWidth="0.8">
        <line x1="215" x2="209" y1="105" y2="111" />
        <line x1="215" x2="209" y1="195" y2="189" />
        <line x1="125" x2="131" y1="195" y2="189" />
        <line x1="125" x2="131" y1="105" y2="111" />
      </g>

      <line
        stroke="currentColor"
        strokeWidth="2"
        x1="90"
        x2="250"
        y1="240"
        y2="240"
      />
      <circle cx="90" cy="240" fill="currentColor" r="4" />
      <circle cx="250" cy="240" fill="currentColor" r="4" />

      <g stroke="currentColor" strokeOpacity="0.55" strokeWidth="1">
        <line x1="60" x2="50" y1="95" y2="95" />
        <line x1="60" x2="50" y1="205" y2="205" />
      </g>

      <line
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="0.6"
        x1="60"
        x2="280"
        y1="292"
        y2="292"
      />
      <text
        className="font-mono"
        fill="currentColor"
        fillOpacity="0.55"
        fontSize="9"
        letterSpacing="0.24em"
        textAnchor="middle"
        x="170"
        y="308"
      >
        ENCRYPTED &middot; OPEN SOURCE
      </text>
    </svg>
  );
}
