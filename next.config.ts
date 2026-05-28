import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["catomz"],
  serverExternalPackages: [
    "officeparser",
    "@mariozechner/pi-ai",
    "@mariozechner/pi-agent-core",
    "@aws-sdk/client-bedrock-runtime",
  ],
};

export default nextConfig;
