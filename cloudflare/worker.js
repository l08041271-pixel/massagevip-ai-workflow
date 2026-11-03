/**
 * Cloudflare Worker edge bridge for MassageVIP Automation.
 *
 * This Worker forwards public API traffic to the existing Python service.
 * The Python origin must remain deployed on a runtime that supports its
 * HTTPServer/threading model until a full Durable Objects/Queues migration.
 *
 * Required Worker secrets:
 *   ORIGIN_API_BASE - HTTPS base URL for the Python service
 *   AGENT_CRON_TOKEN - bearer token used by the Python /internal/agent/cycle
 */

const PUBLIC_PATHS = new Set(["/health", "/dashboard", "/metrics", "/webhook"]);

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function normalizedOrigin(value) {
  if (!value) throw new Error("ORIGIN_API_BASE is not configured");
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("ORIGIN_API_BASE must use HTTPS");
  }
  return url.origin + url.pathname.replace(/\/$/, "");
}

export default {
  async fetch(request, env) {
    let origin;
    try {
      origin = normalizedOrigin(env.ORIGIN_API_BASE);
    } catch (error) {
      return jsonResponse(500, { status: "configuration_error", message: error.message });
    }

    const incoming = new URL(request.url);
    const path = incoming.pathname;
    if (!PUBLIC_PATHS.has(path)) {
      return jsonResponse(404, { status: "not_found" });
    }

    const target = new URL(origin + path);
    target.search = incoming.search;

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("cf-connecting-ip");
    headers.set("x-forwarded-proto", "https");

    // Preserve provider signature headers and raw body for webhook validation.
    const forwarded = new Request(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    try {
      return await fetch(forwarded);
    } catch {
      return jsonResponse(502, { status: "origin_unavailable" });
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      const origin = normalizedOrigin(env.ORIGIN_API_BASE);
      if (!env.AGENT_CRON_TOKEN) throw new Error("AGENT_CRON_TOKEN is not configured");
      const response = await fetch(origin + "/internal/agent/cycle", {
        method: "POST",
        headers: { authorization: `Bearer ${env.AGENT_CRON_TOKEN}` },
      });
      if (!response.ok) {
        throw new Error(`Python agent cycle failed with HTTP ${response.status}`);
      }
    })());
  },
};
