import { connection } from "next/server";
import { resolveVisionAuth } from "@/lib/router-guard";
import { readImage, runVision } from "@/lib/vision-request";

export async function POST(request: Request) {
  await connection();
  const image = await readImage(request);
  if ("error" in image) return Response.json({ error: image.error }, { status: image.status });
  const auth = resolveVisionAuth("publisher", null, process.env.XAI_API_KEY);
  if ("error" in auth) {
    return Response.json({
      mode: "fallback",
      ingredients: [],
      events: [],
      reason: "No XAI_API_KEY is configured. Add your own key, or enter ingredients by hand.",
    });
  }
  return Response.json(
    await runVision(
      auth.key,
      process.env.XAI_BASE_URL || "https://api.x.ai/v1",
      process.env.XAI_MODEL || "grok-4.7",
      image.dataUrl,
    ),
  );
}
