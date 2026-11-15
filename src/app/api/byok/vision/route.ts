import { connection } from "next/server";
import { assertRouterUrl, bearerToken, resolveVisionAuth } from "@/lib/router-guard";
import { readImage, runVision } from "@/lib/vision-request";

export async function POST(request: Request) {
  await connection();
  const auth = resolveVisionAuth(
    "visitor",
    bearerToken(request.headers.get("authorization")),
    process.env.XAI_API_KEY,
  );
  if ("error" in auth) return Response.json({ error: auth.error }, { status: 401 });
  let router: URL;
  try {
    router = assertRouterUrl(request.headers.get("x-hearth-router") || "https://api.x.ai/v1");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Bad router." }, { status: 400 });
  }
  const image = await readImage(request);
  if ("error" in image) return Response.json({ error: image.error }, { status: image.status });
  const model = request.headers.get("x-hearth-model") || "grok-4.7";
  return Response.json(await runVision(auth.key, router.toString(), model, image.dataUrl));
}