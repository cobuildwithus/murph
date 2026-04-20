import { createHostedLinqControlPlane } from "@/src/lib/linq/control-plane";
import { jsonOk, postOnlyJson, readOptionalJsonObject, withJsonError } from "@/src/lib/linq/http";

export function GET() {
  return postOnlyJson("Hosted Linq agent pair routes only allow POST.");
}

export const POST = withJsonError(async (request: Request) => {
  const controlPlane = createHostedLinqControlPlane(request);
  const body = await readOptionalJsonObject(request);
  return jsonOk(await controlPlane.pairAgent(body));
});
