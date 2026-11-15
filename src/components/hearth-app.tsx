"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Flame, KeyRound, ShieldCheck } from "lucide-react";
import { applyProposal, noticeNeeds } from "@/lib/autonomy";
import { callHearthMcp } from "@/lib/browser-mcp";
import { DIET_LABEL, formatQty, money, stepFor } from "@/lib/format";
import type { HealEvent } from "@/lib/healing";
import { resilient } from "@/lib/healing";
import {
  BYOK_KEY,
  SAMPLE_SCAN,
  STORAGE_KEY,
  buildDemoHousehold,
  daysBetween,
  isoDate,
  parseHousehold,
  remainingBudget,
} from "@/lib/household";
import { planDinner, buildShoppingList, checkPantry, scheduleErrands } from "@/lib/planner";
import {
  probeBudget,
  probeCycle,
  probeDeniedOrigin,
  probeInvalidNetwork,
  runInquiry,
  splitPeerUrl,
  type AgentNetwork,
  type LlmClient,
  type TraceEvent,
} from "@/lib/runtime";
import type { PantryItem, Proposal, ScannedIngredient } from "@/lib/types";
import { registerHouseholdWebMcp } from "@/lib/webmcp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type ByokProfile = { baseUrl: string; model: string; apiKey: string };
type VisionPayload = {
  mode: "grok" | "fallback";
  ingredients: ScannedIngredient[];
  reason?: string;
  events: HealEvent[];
};
type HealthRow = { name: string; status: "ok" | "fallback" | "fail" | "unknown"; detail: string };
type ChatLine = { role: "you" | "hearth"; text: string };
type Prompt = { title: string; body: string; confirmLabel: string };
type Bundle = { network: AgentNetwork; links: Record<string, string> };

const PRESETS = [
  { label: "xAI Grok", baseUrl: "https://api.x.ai/v1", model: "grok-4.7" },
  { label: "Otari", baseUrl: "https://api.otari.ai/api/v1", model: "alibaba/qwen-3.5-35b-a3b" },
];

export function HearthApp() {
  const today = useSyncExternalStore(subscribeNothing, clientToday, serverToday);
  if (!today) return <Opening />;
  return <HearthShell today={today} />;
}

function subscribeNothing() {
  return () => {};
}

function clientToday() {
  return isoDate(new Date());
}

function serverToday() {
  return "";
}

function Opening() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
      <p className="text-[11px] font-medium tracking-[0.18em] text-muted-foreground uppercase">Level Up Inc.</p>
      <h1 className="mt-3 font-heading text-5xl text-foreground">Hearth</h1>
      <p className="mt-3 text-muted-foreground">Opening the household board…</p>
    </main>
  );
}

function HearthShell({ today }: { today: string }) {
  const [household, setHousehold] = useState(() => buildDemoHousehold(today));
  const [ready, setReady] = useState(false);
  const [scan, setScan] = useState<ScannedIngredient[]>([]);
  const [scanNote, setScanNote] = useState("No fridge read yet.");
  const [autonomy, setAutonomy] = useState(true);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [byok, setByok] = useState<ByokProfile | null>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [draft, setDraft] = useState<ByokProfile>({
    baseUrl: "https://api.x.ai/v1",
    model: "grok-4.7",
    apiKey: "",
  });
  const [chat, setChat] = useState<ChatLine[]>([
    {
      role: "hearth",
      text: "I can plan tonight, list only what is missing, and find a grocery window. I will not order anything.",
    },
  ]);
  const [inquiry, setInquiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [heal, setHeal] = useState<HealEvent[]>([]);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [checking, setChecking] = useState(false);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [manual, setManual] = useState({ name: "", quantity: "1", unit: "count" });
  const resolver = useRef<((answer: boolean) => void) | null>(null);
  const settled = useRef(false);
  const stateRef = useRef({ household, today, scan });
  stateRef.current = { household, today, scan };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = parseHousehold(saved, today);
        if (parsed) setHousehold(parsed);
      }
      const storedKey = localStorage.getItem(BYOK_KEY);
      if (storedKey) {
        try {
          const parsed = JSON.parse(storedKey) as ByokProfile;
          if (parsed.baseUrl && parsed.model) {
            setByok(parsed);
            setDraft(parsed);
          }
        } catch {
          localStorage.removeItem(BYOK_KEY);
        }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [today]);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ anchor: today, household }));
  }, [household, ready, today]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [manifestRes, linksRes] = await Promise.all([fetch("/agent-manifest.json"), fetch("/links.json")]);
        if (!manifestRes.ok) throw new Error("The agent manifest did not load.");
        const manifest = (await manifestRes.json()) as {
          networks: { name: string; hocon: string }[];
        };
        const links = linksRes.ok
          ? ((await linksRes.json()) as { networks?: { hearth?: Record<string, string> } })
          : {};
        const entry = manifest.networks.find((network) => network.name === "hearth");
        if (!entry) throw new Error("The hearth network is not in the manifest.");
        const network = (await fetch(entry.hocon).then((response) => response.json())) as AgentNetwork;
        if (!cancelled) setBundle({ network, links: links.networks?.hearth ?? {} });
      } catch (error) {
        if (!cancelled) setBundleError(error instanceof Error ? error.message : "The agent network did not load.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    registerHouseholdWebMcp(async (name) => {
      const current = stateRef.current;
      if (name === "plan_dinner") {
        return planDinner(current.household, { today: current.today, scan: current.scan, maxMinutes: 30 });
      }
      if (name === "build_shopping_list") {
        const dinner = planDinner(current.household, { today: current.today, scan: current.scan, maxMinutes: 30 });
        return buildShoppingList(current.household, current.today, {
          extras: dinner.missing,
          includeLowStaples: true,
          scan: current.scan,
        });
      }
      if (name === "schedule_errands") return scheduleErrands(current.household, current.today);
      return checkPantry(current.household, current.today, 2);
    });
  }, []);

  const proposals = useMemo(
    () => (autonomy ? noticeNeeds(household, today, scan) : []),
    [autonomy, household, today, scan],
  );
  const visible = proposals.filter((proposal) => !dismissed.includes(proposal.id));
  const plannerLabel = byok?.apiKey ? `Grok via BYOK · ${byok.model}` : "Deterministic planner";

  function settle(answer: boolean) {
    if (settled.current) return;
    settled.current = true;
    const resolve = resolver.current;
    resolver.current = null;
    setPrompt(null);
    resolve?.(answer);
  }

  function askPerson(title: string, body: string, confirmLabel: string) {
    settled.current = false;
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPrompt({ title, body, confirmLabel });
    });
  }

  function approve(proposal: Proposal) {
    const applied = applyProposal(household, proposal, new Date().toISOString());
    setHousehold(applied.household);
    setBanner(applied.receipt.detail);
  }

  function resetBoard() {
    localStorage.removeItem(STORAGE_KEY);
    setHousehold(buildDemoHousehold(today));
    setScan([]);
    setScanNote("No fridge read yet.");
    setDismissed([]);
    setBanner("The demo board is back to this evening.");
  }

  function adjustPantry(item: PantryItem, direction: 1 | -1) {
    const step = stepFor(item.unit);
    setHousehold({
      ...household,
      pantry: household.pantry.map((entry) =>
        entry.id === item.id
          ? { ...entry, quantity: Math.max(0, Math.round((entry.quantity + direction * step) * 100) / 100) }
          : entry,
      ),
    });
  }

  async function readPhoto(file: File) {
    setScanNote("Reading the shelf…");
    setBusy(true);
    try {
      const dataUrl = await fileToJpeg(file);
      const report = await resilient<VisionPayload>({
        op: "vision",
        timeoutMs: 22_000,
        retries: 0,
        run: async (_attempt, signal) => postVision(dataUrl, byok, signal),
        fallback: () => ({
          mode: "fallback",
          ingredients: [],
          reason: "Vision is unavailable. Add ingredients by hand, or load the sample shelf.",
          events: [],
        }),
      });
      const payload = report.value;
      if (payload && payload.ingredients.length > 0) {
        setScan(payload.ingredients);
        setScanNote(
          payload.mode === "grok"
            ? "Grok read this photo. Dinner planning uses it alongside the pantry."
            : payload.reason || "Used a fallback read.",
        );
      } else {
        setScanNote(payload?.reason || "No ingredients came back. Try another photo or add them by hand.");
      }
      setHeal(payload?.events?.length ? payload.events : report.events);
    } catch (error) {
      setScanNote(error instanceof Error ? error.message : "The photo could not be read.");
    } finally {
      setBusy(false);
    }
  }

  async function ask(text: string) {
    const inquiryText = text.trim();
    if (!inquiryText || busy) return;
    setInquiry("");
    setChat((lines) => [...lines, { role: "you", text: inquiryText }]);
    if (!bundle) {
      setChat((lines) => [...lines, { role: "hearth", text: bundleError || "The agent network is still loading." }]);
      return;
    }
    setBusy(true);
    try {
      const result = await runInquiry({
        network: bundle.network,
        frontMan: "household_coordinator",
        inquiry: inquiryText,
        ctx: {
          household,
          today,
          scan,
          networkName: "hearth",
          origin: window.location.origin,
          links: bundle.links,
          peerPolicy: { mode: "ask" },
          slyData: { sessionId: "browser" },
          confirmWrite: (summary) => askPerson("Approve this write", summary, "Approve"),
          confirmPeer: (origin, purpose) =>
            askPerson("Allow this network", `${purpose}. Origin: ${origin}. Your key stays in this browser.`, "Allow"),
          resolvePeer: (url) => loadPeer(url),
          callMcp: callHearthMcp,
          llm: byok?.apiKey ? makeLlm(byok) : null,
        },
      });
      setHousehold(result.household);
      setTrace(result.trace);
      setHeal(result.heal);
      setChat((lines) => [...lines, { role: "hearth", text: result.ok ? result.answer : result.error || result.answer }]);
    } catch (error) {
      setChat((lines) => [
        ...lines,
        { role: "hearth", text: error instanceof Error ? error.message : "Hearth could not answer." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function runHealth() {
    setChecking(true);
    const rows: HealthRow[] = [];
    const mcp = await resilient({
      op: "mcp",
      timeoutMs: 4000,
      retries: 1,
      run: async (_attempt, signal) => {
        const response = await fetch("/mcp", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
          signal,
        });
        if (!response.ok) throw new Error(`MCP returned ${response.status}.`);
        const json = (await response.json()) as { result?: { tools?: { name: string }[] } };
        const names = json.result?.tools?.map((tool) => tool.name) ?? [];
        if (!names.includes("plan_dinner")) throw new Error("plan_dinner is missing.");
        return names.join(", ");
      },
      fallback: () => "in-browser tools",
    });
    rows.push({
      name: "MCP",
      status: mcp.outcome === "verified" ? "ok" : mcp.outcome === "fallback" ? "fallback" : "fail",
      detail:
        mcp.outcome === "verified"
          ? `Streamable HTTP tools: ${mcp.value}.`
          : "The MCP endpoint did not answer. Planning still runs in the browser.",
    });
    const manifest = await resilient({
      op: "manifest",
      timeoutMs: 4000,
      retries: 1,
      run: async (_attempt, signal) => {
        const response = await fetch("/agent-manifest.json", { signal });
        if (!response.ok) throw new Error("Manifest missing.");
        const json = (await response.json()) as { networks?: unknown[] };
        return json.networks?.length ?? 0;
      },
      fallback: () => 0,
      verify: (count) => count >= 2,
    });
    rows.push({
      name: "Manifest",
      status: manifest.outcome === "verified" ? "ok" : "fail",
      detail:
        manifest.outcome === "verified"
          ? "hearth and pantry_watch are published."
          : "The public manifest could not be validated.",
    });
    const vision = await fetch("/api/health")
      .then((response) => response.json())
      .catch(() => null);
    rows.push({
      name: "Vision",
      status: byok?.apiKey || vision?.publisherVision ? "ok" : "fallback",
      detail: byok?.apiKey
        ? `BYOK ${byok.model}. The key stays in this browser.`
        : vision?.publisherVision
          ? `Server vision is configured with ${vision.model}.`
          : "No server key. Photos wait for BYOK, or use the sample shelf.",
    });
    const guards = await Promise.all([
      probeInvalidNetwork(),
      probeCycle(),
      probeBudget(),
      probeDeniedOrigin(),
    ]);
    rows.push({
      name: "Guards",
      status: guards.every(Boolean) ? "ok" : "fail",
      detail: guards.join(" · "),
    });
    setHealth(rows);
    setChecking(false);
  }

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void runHealth();
    }, 0);
    return () => window.clearTimeout(timer);
    // Health runs once the saved board is restored, and again from the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const hero = visible[0];
  const livePlan = planDinner(household, { today, scan, maxMinutes: 30 });
  const plannerOverlap = livePlan.missing.some((item) =>
    livePlan.usesOnHand.some((used) => used.name === item.name),
  );

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/80 bg-card/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Flame className="size-5" />
            </span>
            <div>
              <p className="font-heading text-2xl leading-none">Hearth</p>
              <p className="text-sm text-muted-foreground">
                {household.name} · {household.organization}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{plannerLabel}</Badge>
            <Badge variant="secondary">{prettyDate(today)}</Badge>
            <Button variant="outline" onClick={() => setByokOpen(true)}>
              <KeyRound />
              {byok?.apiKey ? "Key saved" : "Bring a key"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.86fr)]">
        <section className="order-2 space-y-6 lg:order-1">
          <Card className="bg-[linear-gradient(135deg,rgba(196,73,29,0.12),transparent_42%),var(--card)]">
            <CardHeader>
              <p className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">Tonight</p>
              <CardTitle className="font-heading text-3xl">
                {hero ? hero.title : autonomy ? "The board is quiet" : "Autonomous notices are paused"}
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm leading-6 text-foreground/80">
                {hero
                  ? "Hearth drafted this from the board. One tap writes it down. Nothing is ordered."
                  : "Ask Hearth when you want a plan. Approvals stay on this device, and nothing is ordered."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3 text-sm">
              <span>{money(remainingBudget(household))} left of {money(household.weeklyBudget)} this week</span>
              <span className="text-muted-foreground">Two events already sit on this evening.</span>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>People</CardTitle>
                <CardDescription>A meal has to work for everyone at the table.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {household.members.map((member) => (
                  <div key={member.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">{member.name}</p>
                      <p className="text-xs text-muted-foreground">{member.role}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {member.diet.map((flag) => (
                        <Badge key={flag} variant="outline">
                          {DIET_LABEL[flag]}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Weekly grocery budget</CardTitle>
                <CardDescription>Held items stay off a run that would go over.</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Label className="flex-col items-start gap-1.5">
                  Cap
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    value={household.weeklyBudget}
                    onChange={(event) =>
                      setHousehold({ ...household, weeklyBudget: Number(event.target.value) || 0 })
                    }
                  />
                </Label>
                <Label className="flex-col items-start gap-1.5">
                  Spent
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={household.spent}
                    onChange={(event) => setHousehold({ ...household, spent: Number(event.target.value) || 0 })}
                  />
                </Label>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pantry</CardTitle>
              <CardDescription>Staples under the line, and anything about to turn.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y divide-border">
              {household.pantry.map((item) => {
                const expiry = expiryLabel(today, item);
                const low = item.staple && item.quantity <= item.lowAt;
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="font-medium capitalize">{item.name}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {low ? <Badge variant="destructive">Low staple</Badge> : null}
                        {expiry ? <Badge variant="outline">{expiry}</Badge> : null}
                        {item.quantity <= 0 ? <Badge variant="secondary">Out</Badge> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon-sm" aria-label={`Decrease ${item.name}`} onClick={() => adjustPantry(item, -1)}>
                        −
                      </Button>
                      <span className="w-16 text-center text-sm tabular-nums">
                        {formatQty(item.quantity)} {item.unit}
                      </span>
                      <Button variant="outline" size="icon-sm" aria-label={`Increase ${item.name}`} onClick={() => adjustPantry(item, 1)}>
                        +
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fridge read</CardTitle>
              <CardDescription>
                A photo goes to Grok vision when a key is available. Without one, use the sample shelf or type what you see.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Label className="cursor-pointer">
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void readPhoto(file);
                      event.target.value = "";
                    }}
                  />
                  <span className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                    Upload a photo
                  </span>
                </Label>
                <Button
                  variant="outline"
                  onClick={() => {
                    setScan(SAMPLE_SCAN);
                    setScanNote("Sample shelf read. This did not come from a photo.");
                  }}
                >
                  Load sample shelf
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">{scanNote}</p>
              {scan.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {scan.map((item) => (
                    <Badge key={`${item.name}-${item.unit}`} variant="secondary">
                      {formatQty(item.quantity)} {item.unit} {item.name}
                      <span className="text-muted-foreground"> {Math.round(item.confidence * 100)}%</span>
                    </Badge>
                  ))}
                </div>
              ) : null}
              <form
                className="grid gap-2 sm:grid-cols-[1fr_5rem_7rem_auto]"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!manual.name.trim()) return;
                  setScan((current) => [
                    ...current.filter((item) => item.name.toLowerCase() !== manual.name.trim().toLowerCase() || item.unit !== manual.unit),
                    {
                      name: manual.name.trim(),
                      quantity: Number(manual.quantity) || 1,
                      unit: manual.unit,
                      confidence: 1,
                    },
                  ]);
                  setScanNote("Added by hand. Dinner planning will treat this as seen.");
                  setManual({ name: "", quantity: "1", unit: manual.unit });
                }}
              >
                <Input
                  aria-label="Ingredient name"
                  placeholder="garlic"
                  value={manual.name}
                  onChange={(event) => setManual({ ...manual, name: event.target.value })}
                />
                <Input
                  aria-label="Quantity"
                  type="number"
                  min={0}
                  step="0.1"
                  value={manual.quantity}
                  onChange={(event) => setManual({ ...manual, quantity: event.target.value })}
                />
                <Input
                  aria-label="Unit"
                  value={manual.unit}
                  onChange={(event) => setManual({ ...manual, unit: event.target.value })}
                />
                <Button type="submit" variant="secondary">
                  Add
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Schedule</CardTitle>
                <CardDescription>Busy blocks stay blocked. Errands appear only after approval.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {household.schedule.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing is on the calendar.</p>
                ) : (
                  household.schedule.map((block) => (
                    <div key={block.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium">{block.title}</p>
                        <p className="text-muted-foreground">
                          {block.date === today ? "Today" : block.date} · {block.start}–{block.end} · {block.who}
                        </p>
                      </div>
                      <Badge variant={block.kind === "busy" ? "destructive" : "outline"}>{block.kind}</Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Shopping list</CardTitle>
                <CardDescription>Empty until you approve a plan.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {household.shoppingList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nothing approved yet. Hearth will not add items on its own.</p>
                ) : (
                  household.shoppingList.map((line) => (
                    <div key={line.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium capitalize">
                          {formatQty(line.quantity)} {line.unit} {line.name}
                        </p>
                        <p className="text-muted-foreground">{line.reason}</p>
                      </div>
                      <Badge variant={line.held ? "destructive" : "secondary"}>
                        {line.held ? "Held" : money(line.estimatedCost)}
                      </Badge>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
          <div className="flex justify-end">
            <Button variant="ghost" onClick={resetBoard}>
              Reset the demo evening
            </Button>
          </div>
        </section>

        <aside className="order-1 space-y-4 lg:sticky lg:top-4 lg:order-2 lg:self-start">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle>Noticed</CardTitle>
                <Label className="text-xs text-muted-foreground">
                  Autonomy
                  <Switch checked={autonomy} onCheckedChange={setAutonomy} aria-label="Autonomous notices" />
                </Label>
              </div>
              <CardDescription>One tap updates the board. It does not order food or send a message.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {banner ? (
                <p className="rounded-lg bg-accent px-3 py-2 text-sm" aria-live="polite">
                  {banner}
                </p>
              ) : null}
              {!autonomy ? (
                <p className="text-sm text-muted-foreground">Notices are paused. The board stays as you left it.</p>
              ) : visible.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing new. The things Hearth already wrote down are on the board.</p>
              ) : (
                visible.map((proposal) => (
                  <article key={proposal.id} className="rounded-xl border border-border p-3">
                    <p className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{proposal.kind.replace("_", " ")}</p>
                    <h3 className="mt-1 font-heading text-xl">{proposal.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{proposal.detail}</p>
                    {proposal.dinner ? (
                      <ol className="mt-3 list-decimal space-y-1 pl-4 text-sm">
                        {proposal.dinner.steps.map((step) => (
                          <li key={step}>{step}</li>
                        ))}
                      </ol>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={() => approve(proposal)}>Approve</Button>
                      <Button variant="ghost" onClick={() => setDismissed((ids) => [...ids, proposal.id])}>
                        Dismiss
                      </Button>
                    </div>
                  </article>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ask Hearth</CardTitle>
              <CardDescription>
                {bundle ? "The browser is running the published network." : bundleError || "Loading the agent network…"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="max-h-64 space-y-2 overflow-auto pr-1">
                {chat.map((line, index) => (
                  <p
                    key={`${line.role}-${index}`}
                    className={line.role === "you" ? "text-sm font-medium" : "text-sm leading-6 text-muted-foreground"}
                  >
                    {line.role === "you" ? "You" : "Hearth"}: {line.text}
                  </p>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {["What should we cook tonight?", "What is running low?", "Schedule a grocery run"].map((suggestion) => (
                  <Button key={suggestion} variant="outline" size="sm" onClick={() => void ask(suggestion)} disabled={busy}>
                    {suggestion}
                  </Button>
                ))}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask(inquiry);
                }}
              >
                <Input
                  aria-label="Ask Hearth"
                  value={inquiry}
                  placeholder="Plan dinner for three"
                  onChange={(event) => setInquiry(event.target.value)}
                />
                <Button type="submit" disabled={busy}>
                  {busy ? "Working" : "Send"}
                </Button>
              </form>
              {trace.length > 0 ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {trace.map((event, index) => (
                    <li key={`${event.action}-${index}`}>
                      {event.agent} · {event.action} · {event.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2">
                  <ShieldCheck className="size-4" />
                  House status
                </CardTitle>
                <Button variant="outline" size="sm" onClick={() => void runHealth()} disabled={checking}>
                  {checking ? "Checking" : "Check again"}
                </Button>
              </div>
              <CardDescription>Timeouts, retries, fallbacks, and write checks stay visible.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {health.length === 0 ? <p className="text-sm text-muted-foreground">Checking the house…</p> : null}
              <StatusRow
                name="Planner"
                status={livePlan.id !== "none" && !plannerOverlap ? "ok" : "fail"}
                detail={
                  plannerOverlap
                    ? "A missing ingredient was also counted as on hand."
                    : `${livePlan.title}. Missing: ${livePlan.missing.map((item) => item.name).join(", ") || "nothing"}.`
                }
              />
              {health.map((row) => (
                <div key={row.name}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{row.name}</p>
                    <Badge variant={row.status === "fail" ? "destructive" : row.status === "ok" ? "secondary" : "outline"}>
                      {row.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{row.detail}</p>
                </div>
              ))}
              <StatusRow
                name="Last write"
                status={!household.receipts[0] ? "ok" : household.receipts[0].verified ? "ok" : "unknown"}
                detail={
                  household.receipts[0]
                    ? household.receipts[0].detail
                    : "No approval yet. Writes wait for a tap."
                }
              />
              {heal.length > 0 ? (
                <ul className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                  {heal.map((event, index) => (
                    <li key={`${event.op}-${event.status}-${index}`}>
                      {event.op} · {event.status} · {event.detail}
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      </main>

      <footer className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-2 px-4 py-8 text-xs text-muted-foreground">
        <span>Mark Yukhimets · Level Up Inc.</span>
        <a className="underline" href="/agent-manifest.json">agent-manifest.json</a>
        <a className="underline" href="/hearth.network.json">hearth.network.json</a>
        <a className="underline" href="/pantry_watch.network.json">pantry_watch.network.json</a>
        <a className="underline" href="/links.json">links.json</a>
        <a className="underline" href="/agent-mcp.json">agent-mcp.json</a>
        <a className="underline" href="/mcp">/mcp</a>
      </footer>

      <Dialog open={byokOpen} onOpenChange={setByokOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Bring your own key</DialogTitle>
            <DialogDescription>
              The key stays in this browser and is sent only to the router you name, through a same-origin proxy. Hearth does not swap in a server key.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.label}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDraft({ ...draft, baseUrl: preset.baseUrl, model: preset.model })}
              >
                {preset.label}
              </Button>
            ))}
          </div>
          <Label className="flex-col items-start gap-1.5">
            Router
            <Input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
          </Label>
          <Label className="flex-col items-start gap-1.5">
            Model
            <Input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
          </Label>
          <Label className="flex-col items-start gap-1.5">
            API key
            <Input
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              placeholder="xai-…"
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            />
          </Label>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                localStorage.removeItem(BYOK_KEY);
                setByok(null);
                setDraft({ ...draft, apiKey: "" });
              }}
            >
              Clear
            </Button>
            <Button
              onClick={() => {
                const next = { ...draft, apiKey: draft.apiKey.trim() };
                if (!next.apiKey) return;
                localStorage.setItem(BYOK_KEY, JSON.stringify(next));
                setByok(next);
                setByokOpen(false);
              }}
            >
              Save on this device
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(prompt)} onOpenChange={(open) => { if (!open) settle(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{prompt?.title}</DialogTitle>
            <DialogDescription>{prompt?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              Not now
            </Button>
            <Button onClick={() => settle(true)}>{prompt?.confirmLabel ?? "Allow"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusRow({
  name,
  status,
  detail,
}: {
  name: string;
  status: HealthRow["status"];
  detail: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{name}</p>
        <Badge variant={status === "fail" ? "destructive" : status === "ok" ? "secondary" : "outline"}>
          {status}
        </Badge>
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function prettyDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function expiryLabel(today: string, item: PantryItem): string | null {
  if (!item.expiresOn || item.quantity <= 0) return null;
  const days = daysBetween(today, item.expiresOn);
  if (days < 0) return "Expired";
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days <= 3) return `Expires in ${days} days`;
  return null;
}

async function fileToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not read the photo.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function postVision(dataUrl: string, byok: ByokProfile | null, signal: AbortSignal): Promise<VisionPayload> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  let url = "/api/vision";
  if (byok?.apiKey) {
    url = "/api/byok/vision";
    headers.authorization = `Bearer ${byok.apiKey}`;
    headers["x-hearth-router"] = byok.baseUrl;
    headers["x-hearth-model"] = byok.model;
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ imageDataUrl: dataUrl }),
    signal,
  });
  const json = (await response.json()) as {
    mode?: "grok" | "fallback";
    ingredients?: ScannedIngredient[];
    reason?: string;
    events?: HealEvent[];
    error?: string;
  };
  if (!response.ok) throw new Error(json.error || "Vision failed.");
  return {
    mode: json.mode ?? "fallback",
    ingredients: json.ingredients ?? [],
    reason: json.reason,
    events: json.events ?? [],
  } satisfies VisionPayload;
}

function makeLlm(profile: ByokProfile): LlmClient {
  return async ({ messages, tools, signal }) => {
    const response = await fetch("/api/byok/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${profile.apiKey}`,
        "x-hearth-router": profile.baseUrl,
        "x-hearth-model": profile.model,
      },
      body: JSON.stringify({
        messages,
        tools: tools.map((tool) => ({
          type: "function",
          function: { name: tool.name, description: tool.description, parameters: tool.parameters },
        })),
      }),
      signal,
    });
    const json = (await response.json()) as {
      error?: string;
      message?: { content: string | null; toolCalls: { id: string; name: string; arguments: string }[] };
    };
    if (!response.ok) throw new Error(json.error || "The router rejected the request.");
    return { content: json.message?.content ?? null, toolCalls: json.message?.toolCalls ?? [] };
  };
}

async function loadPeer(url: string) {
  const resolved = splitPeerUrl(url, window.location.origin);
  const base = resolved.absolute.replace(/[^/]+$/, "");
  const manifestResponse = await fetch(new URL("agent-manifest.json", base));
  if (!manifestResponse.ok) throw new Error(`Could not load the manifest for ${resolved.name}.`);
  const manifest = (await manifestResponse.json()) as {
    networks: { name: string; front_man: string; hocon: string }[];
  };
  const entry = manifest.networks.find((network) => network.name === resolved.name);
  if (!entry) throw new Error(`No published network named ${resolved.name}.`);
  const network = (await fetch(new URL(entry.hocon, base)).then((response) => {
    if (!response.ok) throw new Error(`Could not load ${entry.hocon}.`);
    return response.json();
  })) as AgentNetwork;
  return { network, frontMan: entry.front_man, name: entry.name };
}
