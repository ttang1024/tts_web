"use client";

import { useEffect } from "react";

// Registers public/sw.js, which caches the app itself so a document already in
// the local library — with its audio already cached — can be read with no
// network at all.
//
// Production only. A service worker in front of the dev server serves yesterday's
// chunks after a hot reload, so development registers nothing and actively
// removes a worker left behind by a production build served from the same
// localhost origin.
export default function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => registrations.forEach((r) => void r.unregister()))
        .catch(() => {});
      return;
    }

    // Registering during load competes with the page's own requests for
    // bandwidth; wait until it has settled.
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") {
      register();
      return;
    }
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
