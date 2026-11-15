import {
  buildShoppingList,
  checkPantry,
  isBusyEvening,
  planDinner,
  scheduleErrands,
} from "@/lib/planner";
import { money } from "@/lib/format";
import type {
  Household,
  Proposal,
  Receipt,
  ScannedIngredient,
} from "@/lib/types";

export function noticeNeeds(
  household: Household,
  today: string,
  scan: ScannedIngredient[] = [],
): Proposal[] {
  const proposals: Proposal[] = [];
  const busy = isBusyEvening(household, today);
  const maxMinutes = busy ? 30 : 45;
  const dinner = planDinner(household, { today, scan, maxMinutes });
  const expiringSoon = checkPantry(household, today, 1).expiring.filter(
    (entry) => entry.item.quantity > 0,
  );
  const dinnerUsesExpiring = expiringSoon.some((entry) =>
    dinner.usesOnHand.some((used) => used.name === entry.item.name),
  );
  const alreadyCommitted = household.committedDinner?.date === today;

  if (!alreadyCommitted && dinner.id !== "none" && (dinnerUsesExpiring || busy)) {
    const missing = dinner.missing
      .map((item) => `${item.quantity} ${item.unit} ${item.name}`)
      .join(", ");
    const expiringName = expiringSoon.find((entry) =>
      dinner.usesOnHand.some((used) => used.name === entry.item.name),
    )?.item.name;
    const kind = dinnerUsesExpiring ? "use_expiring" : "busy_evening";
    const title = expiringName ? `Cook the ${expiringName} tonight` : "Keep tonight's dinner short";
    const busyClause = busy
      ? "Mira's pickup and Mark's review already fill the evening, so this stays under 30 minutes."
      : "The evening is open enough for a normal dinner.";
    const missingClause = dinner.missing.length
      ? `Missing for this meal: ${missing}.`
      : "Nothing else has to be bought for this meal.";
    proposals.push({
      id: `dinner-${dinner.id}-${today}`,
      kind,
      title,
      detail: `${busyClause} ${dinner.why} ${missingClause} Approving writes the meal onto the board and adds only those missing items to the list.`,
      date: today,
      priority: 1,
      dinner,
      shopping: dinner.missing.map((item) => ({
        id: `shop-${item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        estimatedCost: item.estimatedCost,
        reason: "Missing for the planned dinner",
        held: false,
      })),
      errand: null,
      requiresApproval: true,
    });
  }

  const staples = buildShoppingList(household, today, {
    includeLowStaples: true,
    scan,
  });
  const newLines = staples.lines.filter(
    (line) => !household.shoppingList.some((existing) => existing.id === line.id),
  );
  if (newLines.length > 0) {
    const errand = scheduleErrands(household, today);
    const actionable = newLines.filter((line) => !line.held);
    const names = newLines.map((line) => line.name).join(" and ");
    const spend = money(staples.estimatedSpend);
    const window = errand.slot
      ? `${errand.slot.date} ${errand.slot.start}–${errand.slot.end}`
      : "no open window";
    proposals.push({
      id: `restock-${today}`,
      kind: "restock",
      title: `${names} ${newLines.length === 1 ? "is" : "are"} below the staple line`,
      detail: `${errand.reason} The run would be ${window}. Estimated spend ${spend}, with ${money(staples.remaining)} left in the weekly budget before this list. Approving adds the list and the errand. It does not place an order.`,
      date: today,
      priority: 2,
      shopping: newLines,
      errand: actionable.length > 0 ? errand.slot : null,
      requiresApproval: true,
    });
  }

  return proposals.sort((a, b) => a.priority - b.priority);
}

export function verifyApplied(household: Household, proposal: Proposal): boolean {
  if (proposal.dinner) {
    if (household.committedDinner?.id !== proposal.dinner.id) return false;
    if (household.committedDinner.date !== proposal.date) return false;
  }
  if (proposal.errand) {
    const found = household.schedule.some((block) => block.id === proposal.errand?.id);
    if (!found) return false;
  }
  for (const line of proposal.shopping) {
    if (line.held) continue;
    if (!household.shoppingList.some((existing) => existing.id === line.id)) return false;
  }
  return true;
}

export function applyProposal(
  household: Household,
  proposal: Proposal,
  at: string,
): { household: Household; receipt: Receipt } {
  const existing = household.receipts.find(
    (receipt) => receipt.proposalId === proposal.id && receipt.verified,
  );
  if (existing) return { household, receipt: existing };

  const next = structuredClone(household);
  if (proposal.dinner) {
    next.committedDinner = {
      id: proposal.dinner.id,
      date: proposal.date,
      title: proposal.dinner.title,
      minutes: proposal.dinner.minutes,
      missing: proposal.dinner.missing,
      approvedAt: at,
    };
  }
  for (const line of proposal.shopping) {
    if (!next.shoppingList.some((existingLine) => existingLine.id === line.id)) {
      next.shoppingList.push(structuredClone(line));
    }
  }
  if (proposal.errand && !next.schedule.some((block) => block.id === proposal.errand?.id)) {
    next.schedule.push({
      id: proposal.errand.id,
      date: proposal.errand.date,
      start: proposal.errand.start,
      end: proposal.errand.end,
      title: proposal.errand.title,
      who: proposal.errand.who,
      kind: "errand",
    });
  }

  const verified = verifyApplied(next, proposal);
  const receipt: Receipt = {
    id: `rcpt-${proposal.id}`,
    at,
    proposalId: proposal.id,
    summary: proposal.title,
    verified,
    outcome: verified ? "verified" : "unverified",
    detail: verified
      ? "Recorded on the board. No order was placed and no message was sent."
      : "The board does not match the approved plan. The outcome is unverified, and Hearth did not retry the write.",
    externalOrderPlaced: false,
  };
  next.receipts = [receipt, ...next.receipts];
  return { household: next, receipt };
}
