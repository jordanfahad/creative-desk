/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 / sharp / pdf-parse are native or heavy modules — keep them
  // external to the server bundle so Next doesn't try to bundle the binaries.
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "sharp", "ffmpeg-static"],
  // sharp loads its binary via a dynamic require(`@img/sharp-${platform}`) that
  // Next's file tracer can't follow, so the .node binary is left out of the
  // serverless function ("Could not load the sharp module"). Force-include the
  // platform binaries that npm actually installs (on Vercel: linux-x64 only) plus
  // the ffmpeg-static binary the video path needs.
  outputFileTracingIncludes: {
    "/api/render/submit": ["./node_modules/@img/**", "./node_modules/ffmpeg-static/**"],
    "/api/render/poll": ["./node_modules/@img/**", "./node_modules/ffmpeg-static/**"],
  },
  experimental: {
    // Default is 1MB, which rejects photo/PDF uploads via server actions.
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

module.exports = nextConfig;
