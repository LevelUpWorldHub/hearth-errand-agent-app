import { describe, expect, it } from "vitest";
import { buildDemoHousehold } from "@/lib/household";
import {
  buildShoppingList,
  checkPantry,
  planDinner,
  scheduleErrands,
} from "@/lib/planner";

const today = "2026-11-13";

describe("planDinner", () => {
  it("lists only what is missing and respects the household", () => {
    const household = buildDemoHousehold(today);
    const plan = planDinner(household, { today, maxMinutes: 30 });
    expect(plan.title).toBe("Spinach tomato pasta");
    expect(plan.minutes).toBeLessThanOrEqual(30);
    expect(plan.missing.map((item) => item.name)).toEqual(["garlic"]);
    expect(plan.usesOnHand.map((item) => item.name)).toEqual(
      expect.arrayContaining(["pasta", "canned tomatoes", "spinach", "olive oil"]),
    );
    expect(plan.skipped.join(" ")).toMatch(/chicken thighs/);
    expect(plan.skipped.join(" ")).toMatch(/mushrooms/);
    expect(plan.fitsBudget).toBe(true);
    const onHand = new Set(plan.usesOnHand.map((item) => item.name));
    for (const missing of plan.missing) expect(onHand.has(missing.name)).toBe(false);
  });

  it("drops garlic from the missing list when a fridge read sees it", () => {
    const household = buildDemoHousehold(today);
    const plan = planDinner(household, {
      today,
      maxMinutes: 30,
      scan: [{ name: "garlic", quantity: 1, unit: "head", confidence: 0.8 }],
    });
    expect(plan.missing).toEqual([]);
    expect(plan.usesOnHand.map((item) => item.name)).toContain("garlic");
  });
});

describe("shopping, errands, and pantry", () => {
  it("restocks low staples without relisting food already on hand", () => {
    const household = buildDemoHousehold(today);
    const list = buildShoppingList(household, today, { includeLowStaples: true });
    const names = list.lines.map((line) => line.name);
    expect(names).toEqual(["milk", "oats"]);
    expect(names).not.toContain("pasta");
    expect(names).not.toContain("spinach");
    expect(list.lines.every((line) => line.held === false)).toBe(true);
    expect(list.estimatedSpend).toBeLessThan(list.remaining);
  });

  it("holds lines that would break the weekly budget", () => {
    const household = buildDemoHousehold(today);
    household.weeklyBudget = 73;
    household.spent = 72.5;
    const list = buildShoppingList(household, today, { includeLowStaples: true });
    expect(list.lines.length).toBeGreaterThan(0);
    expect(list.lines.every((line) => line.held)).toBe(true);
    expect(list.estimatedSpend).toBe(0);
  });

  it("schedules the grocery run after a busy evening", () => {
    const household = buildDemoHousehold(today);
    const errand = scheduleErrands(household, today);
    expect(errand.slot).not.toBeNull();
    expect(errand.slot?.date).toBe("2026-11-14");
    expect(errand.slot?.start).toBe("09:00");
    expect(errand.reason).toMatch(/Tonight is already full/);
  });

  it("does not book over a busy block", () => {
    const household = buildDemoHousehold(today);
    household.schedule.push({
      id: "morning",
      date: "2026-11-14",
      start: "09:00",
      end: "12:00",
      title: "Dentist",
      who: "Mark",
      kind: "busy",
    });
    const errand = scheduleErrands(household, today);
    expect(errand.slot?.date).toBe("2026-11-14");
    expect(errand.slot?.start).toBe("14:00");
  });

  it("flags low staples and food that expires soon", () => {
    const report = checkPantry(buildDemoHousehold(today), today, 2);
    expect(report.low.map((item) => item.name)).toEqual(["milk", "oats"]);
    expect(report.expiring.map((entry) => entry.item.name)).toEqual(
      expect.arrayContaining(["spinach", "yogurt"]),
    );
    expect(report.expiring.find((entry) => entry.item.name === "spinach")?.daysLeft).toBe(1);
  });
});
