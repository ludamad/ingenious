// Where the realtime server lives. Same-origin by default — the bundled
// `npm start` serves the web app and the WS server together. Set VITE_SERVER_URL
// (e.g. https://my-host:8787) to point a static build, like the GitHub Pages
// deploy, at a separately self-hosted server.
const BASE = (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

// WebSocket endpoint for online play.
export function wsUrl(): string {
  if (BASE) return `${BASE.replace(/^http/, "ws")}/ws`;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

// Probe whether the server is reachable. Resolves true only on a 2xx /api/health.
export async function pingServer(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal, cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}
