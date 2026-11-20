import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateNetwork, type AgentNetwork } from "@/lib/runtime";

describe("published agent network", () => {
  it("ships a manifest, resolved networks, links, and an MCP descriptor", () => {
    const manifest = JSON.parse(readFileSync("public/agent-manifest.json", "utf8")) as {
      networks: { name: string; front_man: string; hocon: string }[];
      peer_policy: { mode: string };
      agent_mcp: { available: boolean; url: string };
    };
    const links = JSON.parse(readFileSync("public/links.json", "utf8")) as {
      version: number;
      networks: { hearth: { pantry_watch: string } };
    };
    const mcp = JSON.parse(readFileSync("public/agent-mcp.json", "utf8")) as {
      available: boolean;
      tools: string[];
      url: string;
    };
    expect(manifest.networks.map((network) => network.name)).toEqual(["hearth", "pantry_watch"]);
    expect(manifest.peer_policy.mode).toBe("ask");
    expect(manifest.agent_mcp.available).toBe(true);
    expect(links.networks.hearth.pantry_watch).toBe("/pantry_watch");
    expect(mcp.tools).toEqual([
      "plan_dinner",
      "build_shopping_list",
      "schedule_errands",
      "check_pantry",
    ]);

    for (const entry of manifest.networks) {
      const file = entry.hocon.replace(/^\.\//, "public/");
      const network = JSON.parse(readFileSync(file, "utf8")) as AgentNetwork;
      const peers = entry.name === "hearth" ? ["pantry_watch"] : [];
      const validated = validateNetwork(network, entry.front_man, { peers });
      expect(validated.ok, validated.ok ? "" : validated.error).toBe(true);
      expect(JSON.stringify(network)).not.toContain("${");
    }
  });
});

describe("link slots", () => {
  it("declares every bare peer name as a link slot", () => {
    const network = JSON.parse(readFileSync("public/hearth.network.json", "utf8")) as {
      link_slots?: Record<string, { callers?: string[] }>;
      tools: { name: string; tools?: unknown[] }[];
    };
    const names = new Set(network.tools.map((agent) => agent.name));
    const slots = new Set(Object.keys(network.link_slots ?? {}));
    for (const agent of network.tools) {
      for (const tool of agent.tools ?? []) {
        if (typeof tool !== "string" || /^https?:\/\//.test(tool)) continue;
        expect(names.has(tool) || slots.has(tool), `${agent.name} -> ${tool}`).toBe(true);
      }
    }
    expect(network.link_slots?.pantry_watch?.callers).toEqual(["household_coordinator"]);
    const validated = validateNetwork(network, "household_coordinator");
    expect(validated.ok).toBe(true);
  });

  it("rejects a bad link slot", () => {
    const network = JSON.parse(readFileSync("public/hearth.network.json", "utf8")) as Record<string, unknown>;
    expect(validateNetwork({ ...network, link_slots: [] }, "household_coordinator").ok).toBe(false);
    expect(validateNetwork({ ...network, link_slots: { pantry_watch: { callers: ["ghost"] } } }, "household_coordinator").ok).toBe(false);
    expect(validateNetwork({ ...network, link_slots: {} }, "household_coordinator").ok).toBe(false);
  });
});
