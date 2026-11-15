import { describe, expect, it } from "vitest";
import { applyProposal, noticeNeeds, verifyApplied } from "@/lib/autonomy";
import { buildDemoHousehold } from "@/lib/household";

const today = "2026-11-13";

describe("autonomy rules", () => {
  it("notices an expiring ingredient and low staples without mutating the board", () => {
    const household = buildDemoHousehold(today);
    const before = structuredClone(household);
    const proposals = noticeNeeds(household, today);
    expect(household).toEqual(before);
    expect(proposals.map((proposal) => proposal.kind)).toEqual(["use_expiring", "restock"]);
    const dinner = proposals[0];
    expect(dinner.dinner?.title).toBe("Spinach tomato pasta");
    expect(dinner.shopping.map((line) => line.name)).toEqual(["garlic"]);
    expect(dinner.requiresApproval).toBe(true);
    expect(proposals[1].shopping.map((line) => line.name)).toEqual(["milk", "oats"]);
    expect(proposals[1].errand?.start).toBe("09:00");
  });

  it("drops the dinner notice after a fridge read covers the only gap, and still does not write", () => {
    const household = buildDemoHousehold(today);
    const proposals = noticeNeeds(household, today, [
      { name: "garlic", quantity: 1, unit: "head", confidence: 0.9 },
    ]);
    expect(proposals[0].shopping).toEqual([]);
    expect(proposals[0].detail).toMatch(/Nothing else has to be bought/);
    expect(household.shoppingList).toEqual([]);
    expect(household.committedDinner).toBeNull();
  });

  it("approves onto the board and never places an order", () => {
    const household = buildDemoHousehold(today);
    const proposal = noticeNeeds(household, today)[0];
    const applied = applyProposal(household, proposal, "2026-11-13T18:00:00.000Z");
    expect(applied.household).not.toBe(household);
    expect(household.committedDinner).toBeNull();
    expect(applied.household.committedDinner?.title).toBe("Spinach tomato pasta");
    expect(applied.household.shoppingList.map((line) => line.name)).toEqual(["garlic"]);
    expect(applied.household.pantry).toEqual(household.pantry);
    expect(applied.receipt.externalOrderPlaced).toBe(false);
    expect(applied.receipt.verified).toBe(true);
    expect(applied.receipt.detail).toMatch(/No order was placed/);
    expect(verifyApplied(applied.household, proposal)).toBe(true);
  });

  it("does not duplicate a second approval", () => {
    const household = buildDemoHousehold(today);
    const [dinner, restock] = noticeNeeds(household, today);
    const once = applyProposal(household, restock, "2026-11-13T18:00:00.000Z");
    const twice = applyProposal(once.household, restock, "2026-11-13T18:05:00.000Z");
    expect(twice.household.schedule.filter((block) => block.kind === "errand")).toHaveLength(1);
    expect(twice.household.shoppingList).toHaveLength(once.household.shoppingList.length);
    const withDinner = applyProposal(twice.household, dinner, "2026-11-13T18:06:00.000Z");
    expect(withDinner.household.committedDinner?.id).toBe(dinner.dinner?.id);
  });

  it("stops repeating a notice that is already on the board", () => {
    const household = buildDemoHousehold(today);
    const [dinner, restock] = noticeNeeds(household, today);
    const applied = applyProposal(
      applyProposal(household, dinner, "2026-11-13T18:00:00.000Z").household,
      restock,
      "2026-11-13T18:01:00.000Z",
    ).household;
    expect(noticeNeeds(applied, today)).toEqual([]);
  });

  it("reports an unverified write instead of pretending it landed", () => {
    const household = buildDemoHousehold(today);
    const proposal = noticeNeeds(household, today)[1];
    expect(verifyApplied(household, proposal)).toBe(false);
  });
});
