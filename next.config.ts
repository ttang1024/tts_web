import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Extraction and synthesis pull in native/worker-based packages (pdf.js
  // workers, tesseract's worker threads, msedge-tts's websocket). Bundling
  // them into the server chunk breaks those worker/asset lookups, so leave
  // them as plain runtime requires.
  serverExternalPackages: [
    "msedge-tts",
    "unpdf",
    "mammoth",
    "jszip",
    "tesseract.js",
    "undici",
  ],
};

export default nextConfig;
