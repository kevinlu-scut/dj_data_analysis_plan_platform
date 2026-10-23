import { diagnoseDataset, type CleaningRequest } from "../../server/cleaningEngine";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CleaningRequest;

    if (!Array.isArray(payload.rows) || !Array.isArray(payload.fields) || !Array.isArray(payload.dimensions)) {
      return json({ error: "请求缺少 rows、fields 或 dimensions。" }, 400);
    }

    return json(diagnoseDataset(payload));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "无法解析诊断请求。" }, 400);
  }
}

export function GET() {
  return json({ error: "请使用 POST 提交数据质量诊断请求。" }, 405);
}
