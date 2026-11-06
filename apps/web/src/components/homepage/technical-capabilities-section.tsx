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
      "Choose an OpenAI model and scale reasoning from low to xhigh instead of spending the same compute on every task.",
    label: "Compute",
    title: "Reasoning on demand",
  },
  {
    detail: "Murph uses OpenAI models for its core assistant replies.",
    label: "Inference",
    title: "Powered by OpenAI",
  },
] as const;

const RUNTIME_FACTS = [
  ["runtime", "Codex CLI + App Server"],
  ["tools", "browser · phone · integrations"],
  ["workers", "root · bounded subagents"],
  ["reasoning", "low · medium · high · xhigh"],
] as const;

export function TechnicalCapabilitiesSection() {
  return (
    <section
      aria-labelledby="technical-capabilities-title"
      className="bg-[#2a2520] px-5 py-20 text-[#f5f0e8] sm:px-10 lg:px-16 lg:py-28"
    >
      <div className="mx-auto max-w-[1120px]">
        <div className="grid items-center gap-x-16 gap-y-12 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <h2
              className="max-w-[16ch] text-balance font-serif text-[clamp(2rem,4.5vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.03em]"
              id="technical-capabilities-title"
            >
              Built on Codex, with&nbsp;a&nbsp;computer of&nbsp;its&nbsp;own.
            </h2>
            <p className="mt-6 max-w-[46ch] text-pretty text-base leading-[1.75] text-[#f5f0e8]/70 sm:text-[1.0625rem]">
              Murph can use a browser, place phone calls, operate tools, and
              delegate bounded work. You choose the OpenAI model and reasoning
              effort.
            </p>
          </div>

          <RuntimeDossier />
        </div>

        <div className="mt-14 grid gap-px overflow-hidden rounded-[1.25rem] border border-[#c4a882]/20 bg-[#c4a882]/20 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {CAPABILITIES.map((capability) => (
            <article
              className="bg-[#2a2520] p-6 sm:p-7 lg:p-8"
              key={capability.title}
            >
              <h3 className="font-serif text-[1.375rem] font-semibold tracking-[-0.02em] text-[#f5f0e8]">
                {capability.title}
              </h3>
              <p className="mt-3 max-w-[36ch] text-pretty text-[0.9375rem] leading-[1.7] text-[#f5f0e8]/60">
                {capability.detail}
              </p>
            </article>
          ))}
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
        <span className="ml-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[#f5f0e8]/55">
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
          <p className="-indent-[2ch] pl-[2ch]">
            <span className="select-none text-[#d4b87a]" aria-hidden="true">
              {"> "}
            </span>
            be the most capable health agent in the world
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
