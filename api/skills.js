import { createRuntimeService, sendJson } from "./_service.js";

export default async function handler(req, res) {
  try {
    const service = await createRuntimeService();
    const requestUrl = new URL(req.url || "/api/skills", "http://localhost");
    const payload = service.getDashboard({
      period: requestUrl.searchParams.get("period") || "day",
      query: requestUrl.searchParams.get("q") || "",
      source: requestUrl.searchParams.get("source") || "all",
      limit: requestUrl.searchParams.get("limit") || "24"
    });
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, {
      error: "服务内部错误",
      details: error.message
    });
  }
}
