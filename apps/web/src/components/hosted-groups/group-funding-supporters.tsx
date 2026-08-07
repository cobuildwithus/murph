import type {
  HostedGroupFundingSupportersProjection,
} from "@/src/lib/hosted-groups/group-sponsorship-store";

export function GroupFundingSupporters({
  supporters,
}: {
  supporters: HostedGroupFundingSupportersProjection;
}) {
  if (
    supporters.monthlySponsor === null
    && supporters.oneTimeContributions.length === 0
  ) {
    return null;
  }

  return (
    <section
      aria-labelledby="group-funding-supporters-heading"
      className="mt-8 border-t border-border pt-6"
    >
      <h2
        className="font-serif text-xl font-semibold leading-tight"
        id="group-funding-supporters-heading"
      >
        Supporters
      </h2>
      <ul className="mt-3 divide-y divide-border">
        {supporters.monthlySponsor ? (
          <SupporterRow
            detail={`Up to ${formatUsdMinor(supporters.monthlySponsor.monthlyCapMinor)}/month`}
            id={supporters.monthlySponsor.id}
            kind="Monthly sponsor"
            name={supporters.monthlySponsor.name}
          />
        ) : null}
        {supporters.oneTimeContributions.map((contribution) => (
          <SupporterRow
            detail={`${formatUsdMinor(contribution.amountMinor)} one time`}
            id={contribution.id}
            key={contribution.id}
            kind="One-time contribution"
            name={contribution.name}
          />
        ))}
      </ul>
    </section>
  );
}

function SupporterRow({
  detail,
  id,
  kind,
  name,
}: {
  detail: string;
  id: string;
  kind: string;
  name: string;
}) {
  return (
    <li
      className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
      key={id}
    >
      <div className="min-w-0">
        <p className="break-words text-sm font-medium text-foreground">
          {name}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">{kind}</p>
      </div>
      <p className="shrink-0 text-sm text-muted-foreground">{detail}</p>
    </li>
  );
}

function formatUsdMinor(amountMinor: number): string {
  const wholeDollars = Math.floor(amountMinor / 100);
  const cents = amountMinor % 100;
  return cents === 0
    ? `$${wholeDollars}`
    : `$${wholeDollars}.${String(cents).padStart(2, "0")}`;
}
