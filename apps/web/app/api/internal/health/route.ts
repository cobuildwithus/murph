export async function GET(): Promise<Response> {
  return Response.json({
    computerUse: {
      profileMode: "member",
    },
    ok: true,
    service: "hosted-web",
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
    status: 200,
  });
}
