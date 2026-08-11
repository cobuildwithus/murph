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
            kind="Monthly sponsor"
            name={supporters.monthlySponsor.name}
          />
        ) : null}
        {supporters.oneTimeContributions.map((contribution) => (
          <SupporterRow
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
  kind,
  name,
}: {
  kind: string;
  name: string;
}) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <p className="break-words text-sm font-medium text-foreground">
        {name}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{kind}</p>
    </li>
  );
}
