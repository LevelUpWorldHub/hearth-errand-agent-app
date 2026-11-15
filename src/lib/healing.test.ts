import { describe, expect, it } from "vitest";
import { resilient } from "@/lib/healing";

describe("self-healing", () => {
  it("verifies a successful read", async () => {
    const report = await resilient({
      op: "planner",
      timeoutMs: 200,
      retries: 1,
      run: async () => 4,
      verify: (value) => value === 4,
    });
    expect(report.outcome).toBe("verified");
    expect(report.value).toBe(4);
  });

  it("retries a timeout and then succeeds", async () => {
    let calls = 0;
    const report = await resilient({
      op: "mcp",
      timeoutMs: 30,
      retries: 1,
      run: async () => {
        calls += 1;
        if (calls === 1) await new Promise(() => {});
        return "ok";
      },
      verify: (value) => value === "ok",
    });
    expect(calls).toBe(2);
    expect(report.outcome).toBe("verified");
    expect(report.events.some((event) => event.status === "timeout")).toBe(true);
  });

  it("does not retry a write whose outcome is unknown", async () => {
    let calls = 0;
    const report = await resilient({
      op: "approve",
      timeoutMs: 20,
      retries: 3,
      sideEffect: true,
      run: async () => {
        calls += 1;
        await new Promise(() => {});
        return true;
      },
      fallback: () => true,
    });
    expect(calls).toBe(1);
    expect(report.outcome).toBe("unknown");
    expect(report.value).toBeNull();
    expect(report.events.some((event) => event.detail.includes("will not retry"))).toBe(true);
  });

  it("falls back when a read keeps failing", async () => {
    const report = await resilient({
      op: "vision",
      timeoutMs: 50,
      retries: 1,
      run: async () => {
        throw new Error("router down");
      },
      fallback: () => "sample",
      verify: (value) => value.length > 0,
    });
    expect(report.outcome).toBe("fallback");
    expect(report.value).toBe("sample");
  });

  it("fails when the fallback does not verify", async () => {
    const report = await resilient({
      op: "vision",
      timeoutMs: 50,
      retries: 0,
      run: async () => {
        throw new Error("router down");
      },
      fallback: () => "",
      verify: (value) => value.length > 0,
    });
    expect(report.outcome).toBe("failed");
    expect(report.value).toBeNull();
  });
});
