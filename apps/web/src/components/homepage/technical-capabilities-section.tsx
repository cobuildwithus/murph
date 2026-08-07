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
    label: "Computer",
    title: "Its own browser",
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

export function TechnicalCapabilitiesSection() {
  return (
    <section
      aria-labelledby="technical-capabilities-title"
      className="overflow-hidden bg-[#2d3436] px-5 py-20 text-[#f5f0e8] sm:px-10 lg:px-16 lg:py-28"
    >
      <div className="mx-auto max-w-[1160px]">
        <div className="grid items-start gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
          <div>
            <div className="flex items-center gap-4">
              <span
                aria-hidden="true"
                className="h-px w-10 bg-[#d4b87a]/70"
              />
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.18em] text-[#d4b87a]">
                Under the hood
              </p>
            </div>
            <h2
              className="mt-6 max-w-[17ch] text-balance font-serif text-[clamp(2.25rem,5vw,4.25rem)] font-semibold leading-[0.98] tracking-[-0.04em]"
              id="technical-capabilities-title"
            >
              A real agent runtime behind a simple text.
            </h2>
            <p className="mt-7 max-w-[55ch] text-pretty text-base leading-[1.75] text-[#f5f0e8]/70 sm:text-[1.0625rem]">
              Murph can use a browser, place phone calls, operate tools, and
              delegate bounded work. It changes model and reasoning effort to
              fit the task, while you choose who supplies the inference.
            </p>
          </div>

          <RuntimeDossier />
        </div>

        <div className="mt-16 grid gap-px overflow-hidden rounded-[1.25rem] border border-[#d4c4a8]/15 bg-[#d4c4a8]/15 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <article
              className="bg-[#2d3436] p-6 sm:p-7 lg:min-h-[220px] lg:p-8"
              key={capability.title}
            >
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#aebca5]">
                {capability.label}
              </p>
              <h3 className="mt-4 font-serif text-[1.5rem] font-semibold tracking-[-0.025em] text-[#f5f0e8]">
                {capability.title}
              </h3>
              <p className="mt-4 max-w-[34ch] text-pretty text-[0.9375rem] leading-[1.7] text-[#f5f0e8]/62">
                {capability.detail}
              </p>
            </article>
          ))}
        </div>

        <div className="mt-12 border-y border-[#d4c4a8]/18 py-8 lg:mt-16 lg:py-10">
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-[#d4b87a]">
                Inference is a choice
              </p>
              <h3 className="mt-4 max-w-[20ch] text-balance font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.03em]">
                The agent stays. The inference path is yours.
              </h3>
              <Link
                className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-[#f5f0e8] underline decoration-[#d4b87a]/45 underline-offset-4 transition-colors hover:text-[#d4b87a] hover:decoration-[#d4b87a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:[outline-color:#d4b87a]"
                href="/security#model-provider"
              >
                See how provider choice works
                <span aria-hidden="true">→</span>
              </Link>
            </div>

            <dl className="grid gap-px overflow-hidden rounded-xl bg-[#d4c4a8]/18 sm:grid-cols-2">
              {INFERENCE_OPTIONS.map((option) => (
                <div className="bg-[#262c2d] px-5 py-4" key={option.label}>
                  <dt className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-[#f5f0e8]/60">
                    {option.label}
                  </dt>
                  <dd className="mt-2 text-[0.9375rem] font-medium text-[#f5f0e8]">
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
    <div className="rounded-[1.25rem] border border-[#d4c4a8]/18 bg-[#252b2c] p-5 sm:p-7">
      <div className="flex items-center justify-between border-b border-[#d4c4a8]/14 pb-4">
        <div className="flex items-center gap-2" aria-hidden="true">
          <span className="size-2 rounded-full bg-[#b56f5c]" />
          <span className="size-2 rounded-full bg-[#d4b87a]" />
          <span className="size-2 rounded-full bg-[#8fa082]" />
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#f5f0e8]/55">
          murph runtime
        </span>
      </div>

      <dl className="mt-2">
        {RUNTIME_FACTS.map(([label, value]) => (
          <div
            className="grid gap-2 border-b border-[#d4c4a8]/12 py-4 sm:grid-cols-[94px_1fr] sm:gap-5"
            key={label}
          >
            <dt className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#aebca5]">
              {label}
            </dt>
            <dd className="break-words font-mono text-[0.8125rem] leading-[1.65] text-[#f5f0e8]/75">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="pt-5 font-mono text-[0.75rem] leading-[1.75] text-[#f5f0e8]/60">
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
        </p>
      </div>
    </div>
  );
}
