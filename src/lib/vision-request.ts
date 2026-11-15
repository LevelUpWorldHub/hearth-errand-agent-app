import { resilient } from "@/lib/healing";
import { parseIngredientPayload } from "@/lib/vision";
import { RouterError, completeVision } from "@/lib/xai-server";

export async function readImage(
  request: Request,
): Promise<{ dataUrl: string } | { error: string; status: number }> {
  const body = (await request.json().catch(() => null)) as { imageDataUrl?: unknown } | null;
  const dataUrl = body?.imageDataUrl;
  if (typeof dataUrl !== "string" || !/^data:image\/(jpeg|jpg|png);base64,/i.test(dataUrl)) {
    return { error: "Send a JPEG or PNG data URL.", status: 400 };
  }
  if (dataUrl.length > 8_000_000) return { error: "That photo is too large.", status: 413 };
  return { dataUrl };
}

export async function runVision(key: string, baseUrl: string, model: string, imageDataUrl: string) {
  const report = await resilient({
    op: "vision",
    timeoutMs: 20_000,
    retries: 1,
    isRetryable: (error) => error instanceof RouterError && (error.status >= 500 || error.status === 429),
    run: async (_attempt, signal) =>
      parseIngredientPayload(await completeVision({ key, baseUrl, model, imageDataUrl, signal })),
    fallback: () => [] as ReturnType<typeof parseIngredientPayload>,
  });
  const ingredients = report.value ?? [];
  const sawFood = report.outcome === "verified" && ingredients.length > 0;
  return {
    mode: sawFood ? "grok" : "fallback",
    ingredients,
    model,
    events: report.events,
    reason: sawFood
      ? undefined
      : "Grok vision did not return ingredients. Enter them by hand, or load the sample shelf.",
  };
}
