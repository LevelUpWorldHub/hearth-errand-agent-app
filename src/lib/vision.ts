import type { ScannedIngredient } from "@/lib/types";

const UNITS = new Set(["bunch", "g", "kg", "ml", "L", "can", "head", "count", "cup", "box"]);

export function parseIngredientPayload(text: string): ScannedIngredient[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]) as { ingredients?: unknown };
    if (!Array.isArray(parsed.ingredients)) return [];
    return parsed.ingredients.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const quantity = typeof record.quantity === "number" ? record.quantity : Number(record.quantity);
      const unit = typeof record.unit === "string" ? record.unit.trim() : "";
      const confidence =
        typeof record.confidence === "number" ? record.confidence : Number(record.confidence);
      if (!name || !Number.isFinite(quantity) || quantity < 0 || !UNITS.has(unit)) return [];
      return [
        {
          name,
          quantity,
          unit,
          confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
        },
      ];
    });
  } catch {
    return [];
  }
}
