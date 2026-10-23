export function GET() {
  return Response.json(
    { ok: true, service: "cleaning-analysis-engine" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
