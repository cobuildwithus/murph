import { InstallCopyButton } from "./install-copy-button";

export function LocalRunSection({
  installCommandUrl,
}: {
  installCommandUrl: string;
}) {
  const installCommand = `curl -fsSL ${installCommandUrl} | bash`;
  return (
    <section className="bg-[#ede3d0] px-5 pb-16 pt-10 sm:px-10 sm:pb-20 sm:pt-12 lg:px-16 lg:pb-24 lg:pt-14">
      <div className="mx-auto max-w-[1080px]">
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-[#655d4f]">
          Optional · Open source
        </span>
        <h2 className="mt-4 max-w-[18ch] font-serif text-[clamp(1.75rem,3vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-[#2d3436]">
          You can also install it locally.
        </h2>
        <p className="mt-5 max-w-[52ch] text-[0.9375rem] leading-[1.75] text-pretty text-[#5a5244] sm:text-base">
          Murph is open source under Apache 2.0. Self-host it on your own
          machine if you want to own your data, or use the hosted version above
          for zero setup.
        </p>

        <div className="mt-10 overflow-hidden rounded-[1.75rem] border border-[#f5f0e8]/10 bg-[#1f1a16] shadow-[0_20px_60px_rgba(42,37,32,0.18)]">
          <div className="flex items-center gap-2 border-b border-white/8 px-5 py-4">
            <span className="size-2.5 rounded-full bg-[#d27d6a]" />
            <span className="size-2.5 rounded-full bg-[#d4b87a]" />
            <span className="size-2.5 rounded-full bg-[#7a8c6e]" />
            <span className="ml-4 font-mono text-[10px] uppercase tracking-[0.12em] text-[#f5f0e8]/60">
              terminal
            </span>
            <InstallCopyButton value={installCommand} />
          </div>

          <div className="space-y-5 px-5 py-6 font-mono text-[0.8125rem] leading-[1.85] sm:px-7 sm:py-7">
            <div>
              <p className="text-[#f5f0e8]/60">
                # Install Murph and launch setup
              </p>
              <p className="mt-2 break-all text-[#f5f0e8]">
                <span className="select-none text-[#d4b87a]" aria-hidden="true">
                  {"$ "}
                </span>
                curl -fsSL {installCommandUrl} | bash
              </p>
            </div>

            <div className="border-t border-white/8 pt-5">
              <p className="text-[#f5f0e8]/60"># Start chatting</p>
              <p className="mt-2 break-all text-[#f5f0e8]">
                <span className="select-none text-[#d4b87a]" aria-hidden="true">
                  {"$ "}
                </span>
                murph chat
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
