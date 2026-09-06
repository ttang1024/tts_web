import type { MetadataRoute } from "next";

// Makes the app installable — a standalone window on a desktop, a home screen
// icon on a phone — which is worth having now that the library, the audio
// cache, and the service worker mean an installed copy keeps working offline.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Document to Speech",
    short_name: "Speech",
    description:
      "Turn documents, images, pasted text, or web links into speech, and read along with word-level highlighting.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    // The blue the app's buttons and highlights use.
    theme_color: "#2563eb",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
