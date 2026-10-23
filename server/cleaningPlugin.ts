import { diagnoseDataset, type CleaningRequest } from "./cleaningEngine";

function registerCleaningApi(middlewares: { use: (handler: (request: any, response: any, next: () => void) => void) => void }) {
  middlewares.use((request, response, next) => {
    const path = String(request.url || "").split("?")[0];
    if (path === "/api/cleaning/health" && request.method === "GET") {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(JSON.stringify({ ok: true, service: "local-cleaning-engine" }));
      return;
    }
    if (path !== "/api/cleaning/diagnose" || request.method !== "POST") {
      next();
      return;
    }

    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) request.destroy();
    });
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      try {
        const payload = JSON.parse(body) as CleaningRequest;
        if (!Array.isArray(payload.rows) || !Array.isArray(payload.fields) || !Array.isArray(payload.dimensions)) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "请求缺少 rows、fields 或 dimensions。" }));
          return;
        }
        response.statusCode = 200;
        response.end(JSON.stringify(diagnoseDataset(payload)));
      } catch (error) {
        response.statusCode = 400;
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : "无法解析诊断请求。" }));
      }
    });
    request.on("error", () => {
      if (!response.headersSent) response.statusCode = 500;
      response.end(JSON.stringify({ error: "读取诊断请求失败。" }));
    });
  });
}

export function cleaningApiPlugin() {
  return {
    name: "local-cleaning-api",
    configureServer(server: any) {
      registerCleaningApi(server.middlewares);
    },
    configurePreviewServer(server: any) {
      registerCleaningApi(server.middlewares);
    },
  };
}
