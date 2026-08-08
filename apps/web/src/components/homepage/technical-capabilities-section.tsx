import Link from "next/link";

const CAPABILITIES = [
  {
    detail:
      "Codex CLI and App Server provide the execution substrate, native thread continuity, tools, and agent work.",
    label: "Runtime",
    title: "Codex-native",
  },
  {
    detail:
      "Murph can research, compare options, fill forms, and complete web tasks in a real browser.",
    label: "Workspace",
    title: "Its own computer",
  },
  {
    detail:
      "Message Murph where you already talk, then let it place calls, wait on hold, and report back.",
    label: "Voice",
    title: "A real phone number",
  },
  {
    detail:
      "Independent work can continue in bounded subagents while the main conversation stays responsive.",
    label: "Parallel work",
    title: "Bounded subagents",
  },
  {
    detail:
      "Choose Luna, Terra, or Sol and scale reasoning from low to xhigh instead of spending the same compute on every task.",
    label: "Compute",
    title: "Reasoning on demand",
  },
  {
    detail:
      "Use managed models, choose Venice when its privacy model fits you better, connect your own compatible model endpoint and key, or run an open-source model locally.",
    label: "Inference",
    title: "No model lock-in",
  },
] as const;

const INFERENCE_DETAIL_WITHOUT_VENICE =
  "Use managed models, connect your own compatible model endpoint and key, or run an open-source model locally.";

const RUNTIME_FACTS = [
  ["runtime", "Codex CLI + App Server"],
  ["tools", "browser · phone · integrations"],
  ["workers", "root · bounded subagents"],
  ["reasoning", "low · medium · high · xhigh"],
] as const;

const INFERENCE_OPTIONS = [
  {
    detail: "OpenAI",
    label: "Managed",
  },
  {
    detail: "Venice",
    label: "Privacy choice",
  },
  {
    detail: "Endpoint + key",
    label: "Bring your own",
  },
  {
    detail: "Local OSS",
    label: "Run it yourself",
  },
] as const;

export function TechnicalCapabilitiesSection({
  veniceAvailable,
}: {
  veniceAvailable: boolean;
}) {
  // Venice and the provider-choice security anchor render behind the same flag
  // that gates the FAQ and the /security#model-provider section, so the
  // homepage never claims a provider path the rest of the site hides.
  const capabilities = veniceAvailable
    ? CAPABILITIES
    : CAPABILITIES.map((capability) =>
        capability.label === "Inference"
          ? { ...capability, detail: INFERENCE_DETAIL_WITHOUT_VENICE }
          : capability,
      );
  const inferenceOptions = veniceAvailable
    ? INFERENCE_OPTIONS
    : INFERENCE_OPTIONS.filter((option) => option.detail !== "Venice");
  return (
    <section
      aria-labelledby="technical-capabilities-title"
      className="bg-[#2a2520] px-5 py-20 text-[#f5f0e8] sm:px-10 lg:px-16 lg:py-28"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="grid items-center gap-x-16 gap-y-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="h-px w-10 bg-[#c4a882]/70"
              />
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c4a882]">
                Under the hood
              </p>
            </div>
            <h2
              className="mt-6 max-w-[16ch] text-balance font-serif text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.03em]"
              id="technical-capabilities-title"
            >
              You send a text. A whole computer goes to work.
            </h2>
            <p className="mt-6 max-w-[46ch] text-pretty text-base leading-[1.75] text-[#f5f0e8]/70 sm:text-[1.0625rem]">
              Murph can use a browser, place phone calls, operate tools, and
              delegate bounded work. It changes model and reasoning effort to
              fit the task, while you choose who supplies the inference.
            </p>
          </div>

          <RuntimeDossier />
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-[1.25rem] border border-[#c4a882]/20 bg-[#c4a882]/20 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {capabilities.map((capability, index) => (
            <article
              className="bg-[#2a2520] p-6 sm:p-7 lg:p-8"
              key={capability.title}
            >
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#c4a882]">
                  {capability.label}
                </p>
                <span
                  aria-hidden="true"
                  className="font-mono text-[10px] text-[#f5f0e8]/30"
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mt-4 font-serif text-[1.375rem] font-semibold tracking-[-0.02em] text-[#f5f0e8]">
                {capability.title}
              </h3>
              <p className="mt-3 max-w-[36ch] text-pretty text-[0.9375rem] leading-[1.7] text-[#f5f0e8]/60">
                {capability.detail}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-14 border-t border-[#c4a882]/20 pt-12 lg:mt-20 lg:pt-14">
          <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#c4a882]">
                Inference is a choice
              </p>
              <h3 className="mt-5 max-w-[22ch] text-balance font-serif text-[clamp(1.625rem,3vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.02em]">
                The agent stays. The inference path is yours.
              </h3>
              {veniceAvailable ? (
                <Link
                  className="-my-2 mt-4 inline-flex items-center gap-2 py-2 text-sm font-medium text-[#f5f0e8] underline decoration-[#d4b87a]/45 underline-offset-4 transition-colors hover:text-[#d4b87a] hover:decoration-[#d4b87a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:[outline-color:#d4b87a]"
                  href="/security#model-provider"
                >
                  See how provider choice works
                  <span aria-hidden="true">→</span>
                </Link>
              ) : null}
            </div>

            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-[#c4a882]/20 bg-[#c4a882]/20">
              {inferenceOptions.map((option) => (
                <div
                  className="bg-[#1f1a16] px-4 py-4 odd:last:col-span-2 sm:px-5 sm:py-5"
                  key={option.label}
                >
                  <dt className="font-mono text-[9px] font-medium uppercase tracking-[0.16em] text-[#c4a882]/85">
                    {option.label}
                  </dt>
                  <dd className="mt-2 font-serif text-base font-semibold tracking-[-0.01em] text-[#f5f0e8] sm:text-[1.125rem]">
                    {option.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}

function RuntimeDossier() {
  return (
    <div className="overflow-hidden rounded-[1.25rem] border border-[#f5f0e8]/10 bg-[#1f1a16] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]">
      <div className="flex items-center gap-2 border-b border-white/8 px-5 py-4">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-[#d27d6a]" />
        <span aria-hidden="true" className="size-2.5 rounded-full bg-[#d4b87a]" />
        <span aria-hidden="true" className="size-2.5 rounded-full bg-[#7a8c6e]" />
        <span className="ml-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[#f5f0e8]/35">
          murph runtime
        </span>
      </div>

      <div className="px-5 py-5 sm:px-7 sm:py-6">
        <dl>
          {RUNTIME_FACTS.map(([label, value]) => (
            <div
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 first:pt-0"
              key={label}
            >
              <dt className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#c4a882]">
                {label}
              </dt>
              <span
                aria-hidden="true"
                className="relative -top-[3px] min-w-6 flex-1 border-b border-dotted border-[#f5f0e8]/20"
              />
              <dd className="text-right font-mono text-[0.8125rem] leading-[1.6] text-[#f5f0e8]/80">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 border-t border-white/8 pt-4 font-mono text-[0.75rem] leading-[1.9] text-[#f5f0e8]/60">
          <p>
            <span className="select-none text-[#d4b87a]" aria-hidden="true">
              {"> "}
            </span>
            select the lightest capable path
          </p>
          <p>
            <span className="select-none text-[#d4b87a]" aria-hidden="true">
              {"> "}
            </span>
            keep the member in control
            <span
              aria-hidden="true"
              className="ml-1.5 inline-block h-[0.85em] w-[0.5ch] translate-y-[0.15em] rounded-[1px] bg-[#d4b87a]/80"
            />
          </p>
        </div>
      </div>
    </div>
  );
}
