export async function GET(): Promise<Response> {
  return Response.json({
    ok: true,
    service: "hosted-web",
  }, {
    headers: {
      "Cache-Control": "no-store",
    },
    status: 200,
  });
}
