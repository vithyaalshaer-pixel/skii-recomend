import { createRuntimeService, sendJson } from "./_service.js";

export default async function handler(req, res) {
  try {
    const service = await createRuntimeService();
    sendJson(res, 200, service.getStatus());
  } catch (error) {
    sendJson(res, 500, {
      error: "服务内部错误",
      details: error.message
    });
  }
}
