import { describe, expect, it } from "vitest";
import { assertRouterUrl, resolveVisionAuth } from "@/lib/router-guard";
import { parseIngredientPayload } from "@/lib/vision";

describe("vision parsing and key routing", () => {
  it("parses a fenced ingredient payload and drops bad rows", () => {
    const text = `Here is what I see:\n\`\`\`json\n{"ingredients":[{"name":"garlic","quantity":1,"unit":"head","confidence":0.8},{"name":"mystery","quantity":1,"unit":"pinch"},{"name":"spinach","quantity":1,"unit":"bunch","confidence":2}]}\n\`\`\``;
    expect(parseIngredientPayload(text)).toEqual([
      { name: "garlic", quantity: 1, unit: "head", confidence: 0.8 },
      { name: "spinach", quantity: 1, unit: "bunch", confidence: 1 },
    ]);
    expect(parseIngredientPayload("no json here")).toEqual([]);
  });

  it("never substitutes a publisher key for a visitor request", () => {
    expect(resolveVisionAuth("visitor", null, "publisher-secret")).toEqual({
      error: "Add a key in BYOK. This request will not use a key configured on the server.",
    });
    expect(resolveVisionAuth("visitor", "visitor-secret", "publisher-secret")).toEqual({
      key: "visitor-secret",
    });
    expect(resolveVisionAuth("publisher", null, undefined)).toEqual({ error: "no-publisher-key" });
    expect(resolveVisionAuth("publisher", null, "publisher-secret")).toEqual({ key: "publisher-secret" });
  });

  it("blocks unsafe router URLs", () => {
    expect(assertRouterUrl("https://api.x.ai/v1").hostname).toBe("api.x.ai");
    expect(() => assertRouterUrl("http://api.x.ai/v1")).toThrow(/https/);
    expect(() => assertRouterUrl("https://169.254.169.254/latest")).toThrow(/blocked/);
    expect(assertRouterUrl("http://127.0.0.1:11434/v1").protocol).toBe("http:");
  });
});
