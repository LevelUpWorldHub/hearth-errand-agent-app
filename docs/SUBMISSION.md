# Submission notes

- Project: Hearth
- Owner: Mark Yukhimets, Level Up Inc.
- Contest: [Cognizant Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/)
- Deadline: Monday, January 11, 2027, 8:00 AM PT
- License: MIT (`LICENSE`)
- Spec: [Worldwide Agentic Web MVP](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md), profile 0.2

## What this entry demonstrates

Hearth is a public household site whose agent network is data, not a hidden prompt. A normal browser runs it. The default inference path needs no key. A visitor can point the same graph at Grok or another OpenAI-compatible router and pay for that call themselves.

| MVP check | Where Hearth does it |
| --- | --- |
| Publish a multi-agent network and a manifest | `/agent-manifest.json`, `/hearth.network.json`, `/pantry_watch.network.json` |
| Run that network in the browser | `src/lib/runtime.ts`, mounted from the household page |
| Call an internal agent and a grounded tool | Coordinator delegates to dinner, errand, and pantry agents. Tools run through `POST /mcp` and as in-browser site actions |
| Load a named peer network | `links.json` points `pantry_watch` at `/pantry_watch`. The loader selects that exact name |
| A visitor key is not sent to the peer and does not change the caller's router | Peer requests receive only `sessionId`. BYOK posts to `/api/byok/*` on this origin |
| Private context stays home unless named | `allow.to_downstream.sly_data` is `sessionId` only |
| Invalid network, cycle, over-budget call, and denied origin stop in view | House status runs `probeInvalidNetwork`, `probeCycle`, `probeBudget`, and `probeDeniedOrigin` |

The theme of the entry is autonomy with a hard stop. Hearth notices low staples, a busy evening, and an expiring ingredient. The board changes only after Approve. Receipts record that no order was placed. Timeouts on a write are unknown outcomes and are not retried.

Grok is the optional vision and phrasing model (`XAI_MODEL`, default `grok-4.7`, `XAI_BASE_URL`, default `https://api.x.ai/v1`). The product still works when that key is absent.

## A person still has to

- Register the team on Devpost and submit before the deadline.
- Deploy this Next.js app to a public HTTPS host. Vercel works with `npx vercel`. Put that URL in the Devpost submission. Loopback HTTP is only for local development.
- Record the video from [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Keep it under two minutes and show the live site, including one approval and the public JSON.
- Optionally set `XAI_API_KEY`, `XAI_MODEL`, and `XAI_BASE_URL` on the host so a fridge photo works without BYOK. Otherwise use Bring a key during the recording, or the sample shelf.
- Optionally open a pull request on [cognizant-ai-labs/agentic-web](https://github.com/cognizant-ai-labs/agentic-web) to list the deployed URL in `docs/agentic_websites.md`.

## Honest limits

- The grocery run and the dinner stay on this board. Hearth does not call a store, a delivery service, or a messaging API.
- The peer demo packaged here is the same-origin `pantry_watch` network. The runtime can load another origin after approval, and it refuses origins the visitor denies. A second deployed site is not included in this repository.
- Publisher vision runs only when the host sets `XAI_API_KEY`. The BYOK routes never fall back to that key.
- Background autonomy lives for the life of the page. Closing the tab stops it, which matches the MVP's tab-scoped runtime.
