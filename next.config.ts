import type { NextConfig } from "next";

const cors = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type, Accept" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async headers() {
    return [
      { source: "/agent-manifest.json", headers: cors },
      { source: "/hearth.network.json", headers: cors },
      { source: "/pantry_watch.network.json", headers: cors },
      { source: "/links.json", headers: cors },
      { source: "/agent-mcp.json", headers: cors },
      {
        source: "/mcp",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, DELETE, OPTIONS" },
          {
            key: "Access-Control-Allow-Headers",
            value: "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version",
          },
          { key: "Access-Control-Expose-Headers", value: "Mcp-Session-Id" },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
