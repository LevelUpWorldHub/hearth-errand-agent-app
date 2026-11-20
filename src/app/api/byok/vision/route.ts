import { connection } from "next/server";
import { RouterUrlError, assertRouterUrl, bearerToken, resolveVisionAuth, safeModel } from "@/lib/router-guard";
import { readImage, runVision } from "@/lib/vision-request";

export async function POST(request: Request) {
  await connection();
  const auth = resolveVisionAuth(
    "visitor",
    bearerToken(request.headers.get("authorization")),
    process.env.XAI_API_KEY,
  );
  if ("error" in auth) return Response.json({ error: auth.error, code: "byok_key_required" }, { status: 401 });
  let router: URL;
  try {
    router = assertRouterUrl(request.headers.get("x-hearth-router") || "https://api.x.ai/v1");
  } catch (error) {
    const code = error instanceof RouterUrlError ? error.code : "router_invalid";
    const message = error instanceof RouterUrlError ? error.message : "Router URL is invalid.";
    return Response.json({ error: message, code }, { status: 400 });
  }
  const image = await readImage(request);
  if ("error" in image) return Response.json({ error: image.error }, { status: image.status });
  const model = safeModel(request.headers.get("x-hearth-model"));
  return Response.json(await runVision(auth.key, router.toString(), model, image.dataUrl));
}