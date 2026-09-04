import type { NextConfig } from "next";

const webMCPOriginTrialToken = process.env.WEBMCP_ORIGIN_TRIAL_TOKEN?.trim();
if (webMCPOriginTrialToken && /[\r\n]/.test(webMCPOriginTrialToken)) {
  throw new Error("WEBMCP_ORIGIN_TRIAL_TOKEN must not contain line breaks.");
}

const securityHeaders = [
  // Native WebMCP requires both permission to use the `tools` feature and an
  // origin-keyed agent cluster. Without Origin-Agent-Cluster, registerTool()
  // may reject with SecurityError before ChatGPT can discover any site tools.
  { key: "Permissions-Policy", value: "tools=(self)" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Preserve the popup relationship required by the ChatGPT sign-in host.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // Chrome 149 public deployments need an origin-bound trial token. ChatGPT
  // Desktop and Chrome's local testing flag do not. Origin-trial tokens are
  // public capability tokens, but they must match this exact deployed origin.
  ...(webMCPOriginTrialToken ? [{ key: "Origin-Trial", value: webMCPOriginTrialToken }] : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ["@schematic/frontend"],
  async headers() {
    // Vinext's matcher does not treat `/:path*` as matching the root URL, so
    // keep an explicit root entry. WebMCP must be permitted on the landing
    // document because that is where the shared app registers its tools.
    return [
      { source: "/", headers: securityHeaders },
      { source: "/:path*", headers: securityHeaders },
    ];
  },
};

export default nextConfig;
