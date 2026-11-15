export type DietFlag =
  | "vegetarian"
  | "no-nuts"
  | "no-shellfish"
  | "no-mushrooms"
  | "no-spicy";

export type Member = {
  id: string;
  name: string;
  role: string;
  diet: DietFlag[];
};

export type PantryItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  staple: boolean;
  lowAt: number;
  expiresOn?: string;
  category: "dairy" | "produce" | "grain" | "pantry" | "protein";
};

export type ScheduleBlock = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  who: string;
  kind: "busy" | "open" | "errand";
};

export type IngredientNeed = {
  name: string;
  quantity: number;
  unit: string;
  estimatedCost: number;
};

export type ScannedIngredient = {
  name: string;
  quantity: number;
  unit: string;
  confidence: number;
};

export type ShoppingLine = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  estimatedCost: number;
  reason: string;
  held: boolean;
};

export type DinnerPlan = {
  id: string;
  title: string;
  minutes: number;
  servings: number;
  why: string;
  steps: string[];
  usesOnHand: { name: string; quantity: number; unit: string }[];
  missing: IngredientNeed[];
  fitsBudget: boolean;
  fitsTime: boolean;
  estimatedCost: number;
  constraints: string[];
  skipped: string[];
};

export type ErrandSlot = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  who: string;
  durationMin: number;
};

export type CommittedDinner = {
  id: string;
  date: string;
  title: string;
  minutes: number;
  missing: IngredientNeed[];
  approvedAt: string;
};

export type Receipt = {
  id: string;
  at: string;
  proposalId: string;
  summary: string;
  verified: boolean;
  outcome: "verified" | "unverified";
  detail: string;
  externalOrderPlaced: false;
};

export type Household = {
  id: string;
  name: string;
  owner: string;
  organization: string;
  weeklyBudget: number;
  spent: number;
  members: Member[];
  pantry: PantryItem[];
  schedule: ScheduleBlock[];
  shoppingList: ShoppingLine[];
  committedDinner: CommittedDinner | null;
  receipts: Receipt[];
};

export type PantryReport = {
  asOf: string;
  low: PantryItem[];
  out: PantryItem[];
  expiring: { item: PantryItem; daysLeft: number }[];
};

export type ShoppingBuild = {
  lines: ShoppingLine[];
  remaining: number;
  estimatedSpend: number;
  heldSpend: number;
};

export type ProposalKind = "use_expiring" | "busy_evening" | "restock";

export type Proposal = {
  id: string;
  kind: ProposalKind;
  title: string;
  detail: string;
  date: string;
  priority: number;
  dinner?: DinnerPlan;
  shopping: ShoppingLine[];
  errand?: ErrandSlot | null;
  requiresApproval: true;
};
