import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";

export async function recordHostedGrowthGroupPrivateRosterConversions(input: {
  prisma: Pick<PrismaClient, "$executeRaw">;
  trackedAt: Date;
}): Promise<number> {
  return await input.prisma.$executeRaw(Prisma.sql`
    WITH candidate_member AS (
      SELECT
        observation.first_observed_at,
        identity.member_id
      FROM hosted_group_participant_observation AS observation
      INNER JOIN hosted_member_identity AS identity
        ON identity.phone_lookup_key = observation.contact_lookup_key
      WHERE observation.expires_at > ${input.trackedAt}

      UNION ALL

      SELECT
        observation.first_observed_at,
        email.member_id
      FROM hosted_group_participant_observation AS observation
      INNER JOIN hosted_member_email_authorization AS email
        ON email.verified_email_lookup_key = observation.contact_lookup_key
      WHERE observation.expires_at > ${input.trackedAt}
        AND email.verified_email_verified_at IS NOT NULL
    ),
    first_observation AS (
      SELECT
        candidate_member.member_id,
        MIN(candidate_member.first_observed_at) AS first_observed_at
      FROM candidate_member
      GROUP BY candidate_member.member_id
    ),
    eligible_member AS (
      SELECT first_observation.member_id
      FROM first_observation
      INNER JOIN LATERAL (
        SELECT activation.created_at
        FROM hosted_mailbox_item AS activation
        WHERE activation.user_id = first_observation.member_id
          AND activation.kind = 'member.activated'
        ORDER BY activation.created_at ASC, activation.id ASC
        LIMIT 1
      ) AS activation
        ON activation.created_at > first_observation.first_observed_at
      WHERE NOT EXISTS (
        SELECT 1
        FROM hosted_group
        WHERE hosted_group.runtime_member_id = first_observation.member_id
      )
        AND NOT EXISTS (
          SELECT 1
          FROM hosted_thread_container
          WHERE hosted_thread_container.member_id = first_observation.member_id
        )
    )
    UPDATE hosted_member AS member
    SET
      group_private_conversion_tracked_at = ${input.trackedAt},
      updated_at = ${input.trackedAt}
    FROM eligible_member
    WHERE member.id = eligible_member.member_id
      AND member.group_private_conversion_tracked_at IS NULL
  `);
}
