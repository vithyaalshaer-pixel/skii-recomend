import { createRuntimeService, readBody, sendJson } from "./_service.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "不支持的请求方法" });
    return;
  }

  try {
    await readBody(req);
    const service = await createRuntimeService();
    const payload = await service.refresh({ force: true, reason: "manual" });
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, {
      error: "服务内部错误",
      details: error.message
    });
  }
}
