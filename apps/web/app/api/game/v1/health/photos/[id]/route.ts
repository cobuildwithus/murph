import { assertBrowserVaultMemberAuthority } from "@/src/lib/browser-vault/authority";
import { readProgressJpeg } from "@/src/lib/game/progress/jpeg";
import { withHealthRoute } from "@/src/lib/health-wins/http";
import { discardHealthPhoto, readHealthPhoto, uploadHealthPhoto } from "@/src/lib/health-wins/media";
import { healthRowId, type HealthIdContext } from "@/src/lib/health-wins/request";
import { jsonOk } from "@/src/lib/hosted-onboarding/http";
import { getPrisma } from "@/src/lib/prisma";

export const PUT = withHealthRoute(async (request, auth, context: HealthIdContext) => {
  const id = await healthRowId(context);
  await assertBrowserVaultMemberAuthority({ memberId: auth.member.id, prisma: getPrisma() });
  const bytes = await readProgressJpeg(request, { shared: true });
  try {
    await uploadHealthPhoto(auth, id, bytes);
    return jsonOk({ attachmentId: id });
  } finally {
    bytes.fill(0);
  }
});

export const GET = withHealthRoute(async (_request, auth, context: HealthIdContext) => {
  const bytes = await readHealthPhoto(auth, await healthRowId(context));
  try {
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/jpeg", "X-Content-Type-Options": "nosniff" } });
  } finally {
    bytes.fill(0);
  }
});

export const DELETE = withHealthRoute(async (_request, auth, context: HealthIdContext) => {
  await discardHealthPhoto(auth, await healthRowId(context));
  return jsonOk({ ok: true });
});
