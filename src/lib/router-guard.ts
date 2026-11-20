/**
 * BYOK router guard. The proxy forwards a visitor key to an OpenAI-compatible
 * router, so the router host must be a known AI provider. Anything else is
 * refused before a request is made. This blocks SSRF to private, loopback,
 * link-local, and metadata addresses, and stops the proxy acting as an open relay.
 */
export const ALLOWED_ROUTER_HOSTS: readonly string[] = [
  "api.x.ai",
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "openrouter.ai",
  "api.groq.com",
  "api.together.xyz",
  "api.fireworks.ai",
  "api.otari.ai",
];

const ALLOWED = new Set(ALLOWED_ROUTER_HOSTS);

export type RouterUrlErrorCode =
  | "router_invalid"
  | "router_scheme"
  | "router_credentials"
  | "router_port"
  | "router_ip_literal"
  | "router_private_host"
  | "router_not_allowed";

export class RouterUrlError extends Error {
  readonly code: RouterUrlErrorCode;
  constructor(code: RouterUrlErrorCode, message: string) {
    super(message);
    this.name = "RouterUrlError";
    this.code = code;
  }
}

function isIpLiteral(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6, including IPv4-mapped
  if (/^[0-9.]+$/.test(host)) return true; // dotted or shortened IPv4 (the URL parser normalizes decimal and hex forms)
  if (/^0x[0-9a-f]+$/i.test(host)) return true;
  return false;
}

function isPrivateName(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    host === "metadata" ||
    !host.includes(".")
  );
}

export function assertRouterUrl(raw: string): URL {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    throw new RouterUrlError("router_invalid", "Router URL is invalid.");
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new RouterUrlError("router_invalid", "Router URL is invalid.");
  }
  if (url.protocol !== "https:") {
    throw new RouterUrlError("router_scheme", "Router URL must use https.");
  }
  if (url.username || url.password) {
    throw new RouterUrlError("router_credentials", "Put the key in the key field, not in the URL.");
  }
  if (url.port !== "" && url.port !== "443") {
    throw new RouterUrlError("router_port", "Router URL cannot use a custom port.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIpLiteral(host)) {
    throw new RouterUrlError("router_ip_literal", "Router URL must be a provider hostname, not an IP address.");
  }
  if (isPrivateName(host)) {
    throw new RouterUrlError("router_private_host", "Router host is blocked.");
  }
  if (!ALLOWED.has(host)) {
    throw new RouterUrlError(
      "router_not_allowed",
      `Router host is not on the allowlist. Allowed: ${ALLOWED_ROUTER_HOSTS.join(", ")}.`,
    );
  }
  url.hash = "";
  url.search = "";
  return url;
}

export function bearerToken(header: string | null): string | null {
  if (!header) return null;
  const match = header.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] ?? null;
}

export function resolveVisionAuth(
  mode: "publisher" | "visitor",
  visitorKey: string | null,
  publisherKey: string | undefined,
): { key: string } | { error: string } {
  if (mode === "visitor") {
    if (!visitorKey) {
      return {
        error: "Add a key in BYOK. This request will not use a key configured on the server.",
      };
    }
    return { key: visitorKey };
  }
  if (!publisherKey) return { error: "no-publisher-key" };
  return { key: publisherKey };
}

/** Model ids are short tokens like "grok-4.7" or "alibaba/qwen-3.5-35b-a3b". Anything else falls back. */
export function safeModel(header: string | null, fallback = "grok-4.7"): string {
  if (!header) return fallback;
  return /^[A-Za-z0-9._:/-]{1,80}$/.test(header) ? header : fallback;
}
