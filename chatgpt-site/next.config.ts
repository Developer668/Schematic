import type { NextConfig } from "next";

const securityHeaders = [
  // WebMCP is exposed through the standard `tools` policy. The old
  // modelContext token was never a recognized Permissions-Policy directive.
  { key: "Permissions-Policy", value: "tools=(self)" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Preserve the popup relationship required by the ChatGPT sign-in host.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
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
