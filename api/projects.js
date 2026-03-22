import { createRuntimeService, sendJson } from "./_service.js";

export default async function handler(req, res) {
  try {
    const service = await createRuntimeService();
    const requestUrl = new URL(req.url || "/api/projects", "http://localhost");
    const payload = service.getProjectDashboard({
      window: requestUrl.searchParams.get("window") || "7d",
      query: requestUrl.searchParams.get("q") || "",
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
