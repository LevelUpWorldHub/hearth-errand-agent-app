import { describe, expect, it } from "vitest";
import { ALLOWED_ROUTER_HOSTS, RouterUrlError, assertRouterUrl, safeModel } from "@/lib/router-guard";

function codeOf(raw: string): string {
  try {
    assertRouterUrl(raw);
    return "allowed";
  } catch (error) {
    return error instanceof RouterUrlError ? error.code : "other";
  }
}

describe("router allowlist", () => {
  it("allows each known provider over https", () => {
    for (const host of ALLOWED_ROUTER_HOSTS) {
      expect(codeOf(`https://${host}/v1`)).toBe("allowed");
    }
    expect(codeOf("https://api.otari.ai/api/v1")).toBe("allowed");
    expect(codeOf("https://API.X.AI:443/v1")).toBe("allowed");
    expect(codeOf("https://api.x.ai./v1")).toBe("allowed");
  });

  it("rejects hosts that are not on the allowlist", () => {
    for (const raw of [
      "https://example.com/v1",
      "https://api.x.ai.evil.com/v1",
      "https://evil.com/api.x.ai",
      "https://xapi.x.ai/v1",
      "https://openai.com/v1",
      "https://api.openai.com@evil.com/v1",
    ]) {
      expect(["router_not_allowed", "router_credentials"]).toContain(codeOf(raw));
    }
  });

  it("rejects IPv4 and IPv6 literals, including mapped and encoded forms", () => {
    for (const raw of [
      "https://10.0.0.1/v1",
      "https://127.0.0.1/v1",
      "https://169.254.169.254/latest/meta-data",
      "https://2130706433/v1",
      "https://0x7f000001/v1",
      "https://0177.0.0.1/v1",
      "https://127.1/v1",
      "https://[::1]/v1",
      "https://[::ffff:a9fe:a9fe]/v1",
      "https://[::ffff:169.254.169.254]/v1",
      "https://[fd00:ec2::254]/v1",
      "https://[fe80::1]/v1",
      "https://[0:0:0:0:0:ffff:7f00:1]/v1",
    ]) {
      expect(codeOf(raw), raw).toBe("router_ip_literal");
    }
  });

  it("rejects local names, metadata hosts, other schemes, ports, and credentials", () => {
    expect(codeOf("https://localhost/v1")).toBe("router_private_host");
    expect(codeOf("https://api.localhost/v1")).toBe("router_private_host");
    expect(codeOf("https://metadata.google.internal/computeMetadata/v1")).toBe("router_private_host");
    expect(codeOf("https://printer.local/v1")).toBe("router_private_host");
    expect(codeOf("https://metadata/v1")).toBe("router_private_host");
    expect(codeOf("http://api.x.ai/v1")).toBe("router_scheme");
    expect(codeOf("file:///etc/passwd")).toBe("router_scheme");
    expect(codeOf("gopher://api.x.ai/")).toBe("router_scheme");
    expect(codeOf("https://api.x.ai:8443/v1")).toBe("router_port");
    expect(codeOf("https://user:pass@api.x.ai/v1")).toBe("router_credentials");
    expect(codeOf("not a url")).toBe("router_invalid");
    expect(codeOf("")).toBe("router_invalid");
  });

  it("drops query strings and fragments", () => {
    const url = assertRouterUrl("https://api.x.ai/v1?x=1#frag");
    expect(url.toString()).toBe("https://api.x.ai/v1");
  });

  it("accepts only plain model ids", () => {
    expect(safeModel("grok-4.7")).toBe("grok-4.7");
    expect(safeModel("alibaba/qwen-3.5-35b-a3b")).toBe("alibaba/qwen-3.5-35b-a3b");
    expect(safeModel('x"}\n')).toBe("grok-4.7");
    expect(safeModel(null)).toBe("grok-4.7");
  });
});
