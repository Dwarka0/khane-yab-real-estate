/**
 * Serves the built web client.
 *
 * The client is a single page application, so every request that does not
 * match a file is answered with `index.html` by the asset binding.
 */
interface AssetBinding {
  fetch: (request: Request) => Promise<Response>;
}

export default {
  async fetch(request: Request, env: { ASSETS: AssetBinding }): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    // The client is served fresh; the API is always called from the browser.
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (new URL(request.url).pathname.endsWith(".html") || new URL(request.url).pathname === "/") {
      headers.set("Cache-Control", "no-cache");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
