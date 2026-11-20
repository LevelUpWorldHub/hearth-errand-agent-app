import { afterEach, describe, expect, it, vi } from "vitest";
import { RouterError, completeChat } from "@/lib/xai-server";

function stubFetch(response: Response) {
  const spy = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

async function failure(): Promise<RouterError> {
  try {
    await completeChat({ key: "k", baseUrl: "https://api.x.ai/v1", model: "grok-4.7", messages: [] });
  } catch (error) {
    if (error instanceof RouterError) return error;
    throw error;
  }
  throw new Error("expected a RouterError");
}

afterEach(() => vi.unstubAllGlobals());

describe("router responses", () => {
  it("never follows redirects", async () => {
    const spy = stubFetch(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
    const error = await failure();
    expect(error.code).toBe("router_redirect");
    expect(spy.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });

  it("never echoes an HTML or text body", async () => {
    stubFetch(new Response("<html><title>Example Domain</title>secret internal page</html>", { status: 404 }));
    const error = await failure();
    expect(error.message).toBe("The router returned 404.");
    expect(error.message).not.toMatch(/Example|secret|html/i);
    expect(error.status).toBe(400);
  });

  it("rejects a 200 response that is not JSON without echoing it", async () => {
    stubFetch(new Response("ami-id\nhostname\ninstance-id", { status: 200 }));
    const error = await failure();
    expect(error.code).toBe("router_bad_response");
    expect(error.message).not.toMatch(/ami-id|hostname/);
  });

  it("passes on a short JSON error message but drops markup", async () => {
    stubFetch(Response.json({ error: { message: "Model not found" } }, { status: 404 }));
    expect((await failure()).message).toBe("The router returned 404. Model not found");
    stubFetch(Response.json({ error: "<script>alert(1)</script>" }, { status: 500 }));
    const error = await failure();
    expect(error.message).toBe("The router returned 500.");
    expect(error.status).toBe(502);
  });

  it("maps a rejected key and network errors to codes", async () => {
    stubFetch(Response.json({ error: "bad key" }, { status: 401 }));
    expect((await failure()).code).toBe("router_rejected_key");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed: connect ECONNREFUSED 10.0.0.1:443"); }));
    const error = await failure();
    expect(error.code).toBe("router_unreachable");
    expect(error.message).not.toMatch(/10\.0\.0\.1|ECONNREFUSED/);
  });
});
