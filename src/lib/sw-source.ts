// The service worker's code, served at /sw.js with this deployment's id filled in (src/app/sw.js/route.ts).
// Plain JS in a string: it runs in the worker, not through the app's bundler. No template literals inside.
export const SW_SOURCE = String.raw`// ZECKED service worker (deployment __BUILD__).
//  - Opens the app instantly: the app's screens (static HTML) and their scripts, styles and fonts are kept
//    on the device for this deployment, so a launch paints the splash without waiting on the network.
//  - A new deployment ships a new /sw.js: it installs in the background (fetching the new screens), takes
//    over, and the next launch opens the new version. The previous deployment's files stay, so a tab that
//    is still open keeps working (and Next reloads it onto the new version on its next navigation).
//  - Shows push notifications and, when one is tapped, opens the right screen.
const BUILD = "__BUILD__";
const CACHING = BUILD !== "dev";
const SHELL = "zk-shell-" + BUILD;
const ASSETS = "zk-assets-" + BUILD;
// Static screens, cached whole. Everything else (stash pages, profiles, API) always goes to the network.
const PAGES = ["/feed", "/leaderboard", "/wallet", "/me", "/hide", "/practice", "/signin", "/how", "/sounds", "/install"];
const ASSET_RE = /\/_next\/static\/[^"'\s\\)<>]+/g;
const isHtml = (res) => res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html");

async function precache() {
  const shell = await caches.open(SHELL);
  const assets = await caches.open(ASSETS);
  const urls = new Set();
  await Promise.all(
    PAGES.map(async (p) => {
      try {
        const res = await fetch(p, { cache: "reload", credentials: "same-origin" });
        if (!isHtml(res)) return;
        const html = await res.clone().text();
        await shell.put(p, res);
        for (const m of html.matchAll(ASSET_RE)) urls.add(m[0]);
      } catch (e) {}
    }),
  );
  await Promise.all(
    [...urls].map(async (u) => {
      try {
        if (await caches.match(u)) return; // already kept from the last deployment (same file, same hash)
        const res = await fetch(u);
        if (res.ok) await assets.put(u, res);
      } catch (e) {}
    }),
  );
}

self.addEventListener("install", (e) => {
  self.skipWaiting();
  if (CACHING) e.waitUntil(precache());
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      await self.clients.claim();
      // Keep this deployment's caches and the one before it; drop older ones.
      const meta = await caches.open("zk-meta");
      const last = await meta.match("/builds");
      const before = last ? await last.json().catch(() => []) : [];
      const builds = CACHING ? [BUILD, ...before.filter((b) => b !== BUILD)].slice(0, 2) : [];
      await meta.put("/builds", new Response(JSON.stringify(builds)));
      const keep = new Set(["zk-meta"]);
      for (const b of builds) keep.add("zk-shell-" + b).add("zk-assets-" + b);
      for (const k of await caches.keys()) if (k.startsWith("zk-") && !keep.has(k)) await caches.delete(k);
    })(),
  );
});

async function page(req, path) {
  const shell = await caches.open(SHELL);
  const hit = await shell.match(path);
  if (hit) return hit;
  const res = await fetch(req);
  if (isHtml(res)) {
    const copy = res.clone();
    shell.put(path, copy).catch(() => {});
  }
  return res;
}

async function asset(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const copy = res.clone();
    caches.open(ASSETS).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  if (!CACHING) return;
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    if (PAGES.includes(url.pathname)) e.respondWith(page(req, url.pathname).catch(() => fetch(req)));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) e.respondWith(asset(req).catch(() => fetch(req)));
});

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (err) {
    d = { body: e.data ? e.data.text() : "" };
  }
  e.waitUntil(
    self.registration.showNotification(d.title || "ZECKED", {
      body: d.body || "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: d.tag,
      renotify: !!d.tag,
      vibrate: [60, 40, 120],
      data: { url: d.url || "/feed" },
    }),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/feed", self.location.origin).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        if ("navigate" in w) await w.navigate(url).catch(() => {});
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
`;
