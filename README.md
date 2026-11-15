# Hearth

Hearth is an autonomous household errand agent for the Yukhimets home. It notices a low staple, a crowded evening, or food that expires tomorrow, drafts a plan, and waits for one tap before it writes anything down. It does not place orders or send messages.

Built by Mark Yukhimets, Level Up Inc., for the [Cognizant Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/).

## Run it

```shell
npm install
npm test
npm run dev
```

Open the URL Next prints. The demo board is the Yukhimets household on the current evening: Mira's pickup, Mark's review, spinach that expires tomorrow, and milk and oats under the staple line.

```shell
npm run dev -- --port 43123
```

## What a visitor can do

- Read the household board: people and diets, weekly budget, pantry, schedule.
- Upload a fridge photo. With `XAI_API_KEY` or a key saved in the browser, Grok vision (`XAI_MODEL`, default `grok-4.7`) names ingredients. `plan_dinner` then lists only what is still missing.
- Leave the key blank. The deterministic planner still cooks, shops, and schedules, and the sample shelf stands in for a photo.
- Save a Bring Your Own Key profile. The key stays in `localStorage` and is forwarded only to the router you name. The proxy does not substitute a server key.
- Approve or dismiss a notice. Approval updates the board and leaves a receipt. A second tap does not duplicate the errand.
- Ask the in-browser agent network, which calls the same tools over MCP and falls back to the local planner if MCP fails.
- Open House status to see health checks, timeouts, retries, fallbacks, and the last write.

## Public agent files

| File | Role |
| --- | --- |
| `/agent-manifest.json` | Networks, front agents, peer policy, BYOK router |
| `/hearth.network.json` | Resolved household network |
| `/pantry_watch.network.json` | Pantry specialist another page can load |
| `/links.json` | `pantry_watch` → `/pantry_watch` |
| `/agent-mcp.json` | Streamable HTTP facade at `/mcp` |

`POST /mcp` speaks MCP Streamable HTTP (`initialize`, `tools/list`, `tools/call`) for `plan_dinner`, `build_shopping_list`, `schedule_errands`, and `check_pantry`. The tools are read-only. Send `Accept: application/json, text/event-stream`.

## Environment

Copy `.env.example`. `XAI_API_KEY` is optional. `XAI_MODEL` defaults to `grok-4.7`. `XAI_BASE_URL` defaults to `https://api.x.ai/v1`. Vision uses the [chat completions image input](https://docs.x.ai/developers/model-capabilities/images/understanding).

## Deploy

The app is a Next.js project and deploys on Vercel with no extra services. Set the three env vars if you want publisher-funded fridge reads. Visitors can still bring a key when those vars are empty.

```shell
npx vercel
```

## Tests

```shell
npm test
```

Vitest covers the planner, autonomy rules, self-healing, the browser runtime, the MCP handler, vision parsing, and the published JSON. The suite does not call the network.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Two-minute demo](docs/DEMO_SCRIPT.md)
- [Submission notes](docs/SUBMISSION.md)
