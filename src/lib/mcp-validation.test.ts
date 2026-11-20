import { describe, expect, it } from "vitest";
import { buildDemoHousehold } from "@/lib/household";
import { MAX_BATCH, handleJsonRpc, handleJsonRpcBatch } from "@/lib/mcp-handler";

const today = "2026-11-13";

function call(name: string, args: unknown) {
  return handleJsonRpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, { today });
}

function expectInvalid(name: string, args: unknown) {
  const response = call(name, args);
  expect(response.kind).toBe("json");
  if (response.kind !== "json") return;
  expect(response.status, JSON.stringify(args)).toBe(400);
  const body = response.body as { error?: { code: number; message: string } };
  expect(body.error?.code).toBe(-32602);
}

describe("MCP input validation", () => {
  const demo = buildDemoHousehold(today);

  it("accepts the full demo household the app sends", () => {
    for (const name of ["plan_dinner", "build_shopping_list", "schedule_errands", "check_pantry"]) {
      const response = call(name, { household: demo, today, maxMinutes: name.includes("errand") || name.includes("pantry") ? undefined : 30 });
      expect(response.kind === "json" && response.status, name).toBe(200);
    }
  });

  it("rejects malformed households with -32602, not 500", () => {
    expectInvalid("plan_dinner", { household: { ...demo, members: [null] } });
    expectInvalid("plan_dinner", { household: { ...demo, members: [] } });
    expectInvalid("plan_dinner", { household: { ...demo, members: [{ id: "x", name: 5 }] } });
    expectInvalid("plan_dinner", { household: { ...demo, pantry: [{ ...demo.pantry[0], quantity: -1 }] } });
    expectInvalid("plan_dinner", { household: { ...demo, pantry: [{ ...demo.pantry[0], quantity: Number.NaN }] } });
    expectInvalid("plan_dinner", { household: { ...demo, pantry: [{ ...demo.pantry[0], expiresOn: "soon" }] } });
    expectInvalid("schedule_errands", { household: { ...demo, schedule: [{ ...demo.schedule[0], date: "2026-02-31" }] } });
    expectInvalid("schedule_errands", { household: { ...demo, schedule: [{ ...demo.schedule[0], start: "25:00" }] } });
    expectInvalid("schedule_errands", { household: { ...demo, schedule: "busy" } });
    expectInvalid("check_pantry", { household: "x" });
  });

  it("rejects bad numbers and dates", () => {
    expectInvalid("schedule_errands", { durationMin: -45 });
    expectInvalid("schedule_errands", { durationMin: 0 });
    expectInvalid("schedule_errands", { durationMin: 100000 });
    expectInvalid("plan_dinner", { servings: -3 });
    expectInvalid("plan_dinner", { servings: 1e9 });
    expectInvalid("plan_dinner", { maxMinutes: "30" });
    expectInvalid("check_pantry", { withinDays: -1 });
    expectInvalid("check_pantry", { withinDays: 1e9 });
    for (const bad of ["not-a-date", "2026-13-01", "2026-02-30", "NaN-NaN-NaN", "", "9999-01-01", "2026-1-1"]) {
      expectInvalid("check_pantry", { today: bad });
    }
    expectInvalid("plan_dinner", { scan: [{ name: "x", quantity: -1, unit: "g" }] });
    expectInvalid("plan_dinner", { scan: "eggs" });
  });

  it("never returns a NaN date for a valid request", () => {
    const response = call("schedule_errands", { today: "2026-12-31", durationMin: 45 });
    expect(JSON.stringify(response)).not.toContain("NaN");
  });

  it("rejects bad params, arguments, ids, and unknown tools with 400", () => {
    for (const params of [null, "x", [], { name: 5 }, { name: "nope" }, { name: "plan_dinner", arguments: "x" }, { name: "plan_dinner", arguments: [] }, { name: "plan_dinner", arguments: null }]) {
      const response = handleJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params }, { today });
      expect(response.kind === "json" && response.status, JSON.stringify(params)).toBe(400);
      expect(response.kind === "json" && (response.body as { error: { code: number } }).error.code).toBe(-32602);
    }
    const badId = handleJsonRpc({ jsonrpc: "2.0", id: { x: 1 }, method: "ping" }, { today });
    expect(badId.kind === "json" && badId.status).toBe(400);
  });

  it("caps batch size", () => {
    const one = { jsonrpc: "2.0", id: 1, method: "ping" };
    const ok = handleJsonRpcBatch(Array.from({ length: MAX_BATCH }, () => one), { today });
    expect(ok.kind === "json" && ok.status).toBe(200);
    const big = handleJsonRpcBatch(Array.from({ length: MAX_BATCH + 1 }, () => one), { today });
    expect(big.kind === "json" && big.status).toBe(400);
  });
});
