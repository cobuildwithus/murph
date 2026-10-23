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
    <section className="mt-10 border-t border-border pt-6">
      <h2 className="font-serif text-xl font-semibold leading-tight">
        Supporters
      </h2>
      <ul className="mt-2 divide-y divide-border">
        {supporters.monthlySponsor ? (
          <SupporterRow
            kind="Monthly sponsor"
            name={supporters.monthlySponsor.name}
          />
        ) : null}
        {groupOneTimeContributionsByName(supporters.oneTimeContributions).map(
          (contributor) => (
            <SupporterRow
              key={contributor.id}
              kind={contributor.count > 1
                ? `${contributor.count} one-time contributions`
                : "One-time contribution"}
              name={contributor.name}
            />
          ),
        )}
      </ul>
    </section>
  );
}

// Same-name contributions (usually "Anonymous") collapse into one counted row,
// keeping the first-seen order of the recent list.
function groupOneTimeContributionsByName(
  contributions: HostedGroupFundingSupportersProjection["oneTimeContributions"],
): Array<{ count: number; id: string; name: string }> {
  const byName = new Map<string, { count: number; id: string; name: string }>();
  for (const contribution of contributions) {
    const existing = byName.get(contribution.name);
    if (existing) {
      existing.count += 1;
    } else {
      byName.set(contribution.name, { count: 1, ...contribution });
    }
  }
  return [...byName.values()];
}

function SupporterRow({
  kind,
  name,
}: {
  kind: string;
  name: string;
}) {
  return (
    <li className="flex items-baseline justify-between gap-4 py-3">
      <p className="min-w-0 break-words text-sm font-medium text-foreground">
        {name}
      </p>
      <p className="shrink-0 text-xs text-muted-foreground">{kind}</p>
    </li>
  );
}
