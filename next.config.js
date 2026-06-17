/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 / sharp / pdf-parse are native or heavy modules — keep them
  // external to the server bundle so Next doesn't try to bundle the binaries.
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "sharp", "ffmpeg-static"],
  experimental: {
    // Default is 1MB, which rejects photo/PDF uploads via server actions.
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

module.exports = nextConfig;
