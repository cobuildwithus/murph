export function ModelProviderSecuritySection() {
  return (
    <section
      aria-labelledby="security-model-provider-title"
      className="bg-[#efe7d8] px-6 py-20 sm:px-10 sm:py-24 lg:px-16 lg:py-28"
      id="model-provider"
    >
      <div className="mx-auto max-w-[1080px]">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#5a6e32]">
          Model provider
        </p>
        <h2
          className="mt-6 max-w-[22ch] text-balance font-serif text-[clamp(1.75rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.03em] text-[#2d3436]"
          id="security-model-provider-title"
        >
          Choose who runs Murph&apos;s core AI.
        </h2>
        <p className="mt-6 max-w-[60ch] text-pretty text-[1rem] leading-[1.7] text-[#4d4533]">
          In Settings, you can choose OpenAI or Venice for Murph&apos;s core
          assistant replies. Murph sends the information needed for each reply
          to the provider you select.
        </p>

        <dl className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[#c4a882]/30 bg-[#c4a882]/30 md:grid-cols-2">
          <div className="bg-[#fffcf6] p-6 sm:p-8">
            <dt className="font-serif text-[1.25rem] font-semibold tracking-[-0.015em] text-[#2d3436]">
              Your choice
            </dt>
            <dd className="mt-3 text-pretty text-[0.9375rem] leading-[1.65] text-[#635a48]">
              OpenAI remains the default. Choose Venice whenever you want, and
              the change applies to future core assistant replies.
            </dd>
          </div>
          <div className="bg-[#fffcf6] p-6 sm:p-8">
            <dt className="font-serif text-[1.25rem] font-semibold tracking-[-0.015em] text-[#2d3436]">
              What stays protected
            </dt>
            <dd className="mt-3 text-pretty text-[0.9375rem] leading-[1.65] text-[#635a48]">
              Provider API keys stay outside your short-lived runner.
              Specialized tools can still use their own managed providers, so
              this setting does not reroute every external service.
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
