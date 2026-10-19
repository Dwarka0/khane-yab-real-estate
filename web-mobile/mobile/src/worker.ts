/**
 * Serves the installable mobile web build.
 *
 * The build is a single page application; every unknown path is answered
 * with `index.html` by the asset binding, and the service worker is served
 * with a short cache so a new release is picked up immediately.
 */
interface AssetBinding {
  fetch: (request: Request) => Promise<Response>;
}

export default {
  async fetch(request: Request, env: { ASSETS: AssetBinding }): Promise<Response> {
    const url = new URL(request.url);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (url.pathname === "/sw.js") {
      headers.set("Cache-Control", "no-cache");
      headers.set("Service-Worker-Allowed", "/");
    } else if (url.pathname.endsWith(".html") || url.pathname === "/") {
      headers.set("Cache-Control", "no-cache");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
