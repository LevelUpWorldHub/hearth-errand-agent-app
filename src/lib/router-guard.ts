export function assertRouterUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Router URL is invalid.");
  }
  const host = url.hostname;
  const local = host === "localhost" || host === "127.0.0.1";
  if (url.protocol === "http:" && !local) {
    throw new Error("Router URL must use https, except on localhost.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Router URL must be http or https.");
  }
  if (
    host === "169.254.169.254" ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal")
  ) {
    throw new Error("Router host is blocked.");
  }
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
