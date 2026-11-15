import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildDemoHousehold } from "@/lib/household";
import {
  probeBudget,
  probeCycle,
  probeDeniedOrigin,
  probeInvalidNetwork,
  runInquiry,
  validateNetwork,
  type AgentNetwork,
  type RuntimeContext,
} from "@/lib/runtime";

const today = "2026-11-13";

function ctx(extra: Partial<RuntimeContext> = {}): RuntimeContext {
  return {
    household: buildDemoHousehold(today),
    today,
    scan: [],
    networkName: "hearth",
    origin: "http://localhost:43123",
    links: { pantry_watch: "/pantry_watch" },
    peerPolicy: { mode: "ask" },
    ...extra,
  };
}

const network = JSON.parse(readFileSync("public/hearth.network.json", "utf8")) as AgentNetwork;
const pantry = JSON.parse(readFileSync("public/pantry_watch.network.json", "utf8")) as AgentNetwork;

describe("browser runtime", () => {
  it("plans dinner with the deterministic fallback and no network", async () => {
    const result = await runInquiry({
      network,
      frontMan: "household_coordinator",
      inquiry: "What should we cook tonight?",
      ctx: ctx(),
    });
    expect(result.ok).toBe(true);
    expect(result.source).toBe("deterministic");
    expect(result.answer).toMatch(/Spinach tomato pasta/);
    expect(result.answer).toMatch(/garlic/);
    expect(result.answer).not.toMatch(/pasta, canned tomatoes/);
    expect(result.household.committedDinner).toBeNull();
  });

  it("uses an MCP payload and falls back when MCP fails", async () => {
    const failed = await runInquiry({
      network,
      frontMan: "household_coordinator",
      inquiry: "What should we cook tonight?",
      ctx: ctx({
        callMcp: async () => {
          throw new Error("connection reset");
        },
      }),
    });
    expect(failed.ok).toBe(true);
    expect(failed.trace.some((event) => event.action === "fallback")).toBe(true);
    expect(failed.answer).toMatch(/Spinach tomato pasta/);

    const fromMcp = await runInquiry({
      network,
      frontMan: "household_coordinator",
      inquiry: "What should we cook tonight?",
      ctx: ctx({
        callMcp: async () => ({
          id: "mcp-special",
          title: "From MCP",
          minutes: 15,
          servings: 3,
          why: "The MCP server planned this.",
          steps: ["Serve it."],
          usesOnHand: [],
          missing: [],
          fitsBudget: true,
          fitsTime: true,
          estimatedCost: 0,
          constraints: [],
          skipped: [],
        }),
      }),
    });
    expect(fromMcp.answer).toMatch(/From MCP/);
    expect(fromMcp.trace.some((event) => event.detail.includes("MCP"))).toBe(true);
  });

  it("refuses a write unless the person approves it", async () => {
    const denied = await runInquiry({
      network,
      frontMan: "household_coordinator",
      inquiry: "Approve the plan",
      ctx: ctx({ confirmWrite: () => false }),
    });
    expect(denied.answer).toMatch(/Approval denied/);
    expect(denied.household.committedDinner).toBeNull();
    expect(denied.household.shoppingList).toEqual([]);

    const allowed = await runInquiry({
      network,
      frontMan: "household_coordinator",
      inquiry: "Approve the plan",
      ctx: ctx({ confirmWrite: () => true }),
    });
    expect(allowed.household.committedDinner?.title).toBe("Spinach tomato pasta");
    expect(allowed.household.receipts[0].externalOrderPlaced).toBe(false);
  });

  it("keeps private context off the peer request", async () => {
    let seen: { inquiry: string; sly: Record<string, unknown> } | null = null;
    const result = await runInquiry({
      network,
      frontMan: "household_coordinator",
      inquiry: "What is running low?",
      ctx: ctx({
        slyData: { byokKey: "sk-secret", sessionId: "s1" },
        confirmPeer: () => true,
        onPeerInvocation: (info) => {
          seen = { inquiry: info.inquiry, sly: info.sly };
        },
        resolvePeer: async () => ({
          network: pantry,
          frontMan: "pantry_sentinel",
          name: "pantry_watch",
        }),
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.answer).toMatch(/milk/);
    expect(seen).toEqual({ inquiry: "What is running low?", sly: { sessionId: "s1" } });
    expect(JSON.stringify(seen)).not.toContain("sk-secret");
  });

  it("falls back to the deterministic planner when the model fails", async () => {
    const result = await runInquiry({
      network,
      frontMan: "household_coordinator",
      inquiry: "What should we cook tonight?",
      ctx: ctx({
        llmTimeoutMs: 200,
        llm: async () => {
          throw new Error("model unavailable");
        },
      }),
    });
    expect(result.source).toBe("deterministic-fallback");
    expect(result.answer).toMatch(/Spinach tomato pasta/);
    expect(result.heal.some((event) => event.status === "fallback")).toBe(true);
  });

  it("stops invalid networks, cycles, over-budget calls, and denied origins", async () => {
    expect(await probeInvalidNetwork()).toMatch(/Duplicate agent name/);
    expect(await probeCycle()).toMatch(/composition cycle/);
    expect(await probeBudget()).toMatch(/over-budget/);
    expect(await probeDeniedOrigin()).toMatch(/Denied origin/);
    const broken = validateNetwork(
      { tools: [{ name: "guide", instructions: "Use ${KEY}", tools: [] }] },
      "guide",
    );
    expect(broken.ok).toBe(false);
  });
});
