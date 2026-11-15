import { describe, expect, it } from "vitest";
import { buildDemoHousehold } from "@/lib/household";
import { handleJsonRpc, handleJsonRpcBatch } from "@/lib/mcp-handler";
import type { DinnerPlan } from "@/lib/types";

const today = "2026-11-13";

describe("MCP handler", () => {
  it("initializes and lists the household tools", () => {
    const init = handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
      },
      { today },
    );
    expect(init.kind).toBe("json");
    if (init.kind !== "json") return;
    const body = init.body as { result: { serverInfo: { name: string }; protocolVersion: string } };
    expect(body.result.serverInfo.name).toBe("hearth");
    expect(body.result.protocolVersion).toBe("2025-06-18");

    const list = handleJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { today });
    if (list.kind !== "json") throw new Error("expected json");
    const tools = (list.body as { result: { tools: { name: string }[] } }).result.tools.map((tool) => tool.name);
    expect(tools).toEqual(["plan_dinner", "build_shopping_list", "schedule_errands", "check_pantry"]);
  });

  it("plans dinner from the demo household with no network", () => {
    const response = handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: "dinner",
        method: "tools/call",
        params: { name: "plan_dinner", arguments: { today, maxMinutes: 30 } },
      },
      { today },
    );
    if (response.kind !== "json") throw new Error("expected json");
    const result = (response.body as { result: { isError: boolean; structuredContent: DinnerPlan } }).result;
    expect(result.isError).toBe(false);
    expect(result.structuredContent.title).toBe("Spinach tomato pasta");
    expect(result.structuredContent.missing.map((item) => item.name)).toEqual(["garlic"]);
  });

  it("uses a caller-supplied household and rejects unknown tools", () => {
    const household = buildDemoHousehold(today);
    household.pantry = household.pantry.map((item) =>
      item.name === "garlic" ? { ...item, quantity: 2 } : item,
    );
    const response = handleJsonRpc(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "plan_dinner", arguments: { today, household, maxMinutes: 30 } },
      },
      { today },
    );
    if (response.kind !== "json") throw new Error("expected json");
    const plan = (response.body as { result: { structuredContent: DinnerPlan } }).result.structuredContent;
    expect(plan.missing).toEqual([]);

    const missing = handleJsonRpc(
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "order_groceries", arguments: {} } },
      { today },
    );
    if (missing.kind !== "json") throw new Error("expected json");
    expect((missing.body as { result: { isError: boolean } }).result.isError).toBe(true);
  });

  it("accepts a notification and a batch", () => {
    const note = handleJsonRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, { today });
    expect(note).toEqual({ kind: "empty", status: 202 });
    const batch = handleJsonRpcBatch(
      [
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 1, method: "ping" },
      ],
      { today },
    );
    expect(batch.kind).toBe("json");
  });
});
