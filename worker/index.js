// Cloudflare Worker entry: /api/* is handled here, everything else is served from the
// built SPA in env.ASSETS. The provider logic is shared with the Node server so both
// runtimes behave the same.
import { MODE_PROMPTS, sanitizeMessages, systemPromptFor } from "../server/core.js";
import { resolveRequest, serverConfig, streamCompletion, testConnection } from "../server/providers.js";

const RATE_LIMIT_PER_HOUR = 20;
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
};

// Per-isolate meter for the server-funded default AI. A visitor's own key is never metered.
const hits = new Map();

function takeToken(ip) {
  const now = Date.now();
  const windowStart = now - 60 * 60 * 1000;
  const recent = (hits.get(ip) || []).filter((t) => t > windowStart);
  if (recent.length >= RATE_LIMIT_PER_HOUR) {
    hits.set(ip, recent);
    return Math.ceil((recent[0] + 60 * 60 * 1000 - now) / 1000);
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return 0;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function sameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (!origin) return true; // curl / server-to-server: no browser origin to compare
  try {
    return new URL(origin).host === url.host;
  } catch {
    return false;
  }
}

async function handleChat(request, env, url, ctx) {
  if (!sameOrigin(request, url)) return json({ detail: { message: "Cross-origin request refused." } }, 403);
  if (!/application\/json/i.test(request.headers.get("content-type") || "")) {
    return json({ detail: { message: "Expected a JSON body." } }, 415);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ detail: { message: "Invalid JSON body." } }, 422);

  const mode = typeof body.mode === "string" && MODE_PROMPTS[body.mode] !== undefined ? body.mode : "chat";
  const messages = sanitizeMessages(body.messages);
  if (messages.length === 0) return json({ detail: { message: "Send at least one message." } }, 422);

  let target;
  try {
    target = resolveRequest(env, body);
  } catch (err) {
    return json({ detail: { message: err.message } }, err.status || 400);
  }

  if (target.useDefault) {
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    if (takeToken(ip) > 0) {
      return json(
        {
          detail: {
            message: `Default AI limit reached (${RATE_LIMIT_PER_HOUR} requests/hour). Add your own API key in Settings for unlimited use.`,
          },
        },
        429
      );
    }
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event) => writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

  ctx.waitUntil(
    (async () => {
      try {
        await streamCompletion(
          env,
          target,
          systemPromptFor(mode),
          messages,
          (text) => send({ type: "delta", text }),
          request.signal
        );
        await send({ type: "done" });
      } catch (err) {
        // A client that navigated away does not need an error event.
        if (!request.signal.aborted) {
          try {
            await send({ type: "error", message: err?.message || "The AI request failed. Please try again." });
          } catch {
            // stream already closed
          }
        }
      } finally {
        try {
          await writer.close();
        } catch {
          // already closed
        }
      }
    })()
  );

  return new Response(readable, { headers: SSE_HEADERS });
}

async function handleApi(request, env, url, ctx) {
  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, ...serverConfig(env) });
  }
  if (url.pathname === "/api/config" && request.method === "GET") {
    return json({ ...serverConfig(env), rateLimitPerHour: RATE_LIMIT_PER_HOUR });
  }
  if (url.pathname === "/api/test" && request.method === "POST") {
    if (!sameOrigin(request, url)) return json({ detail: { message: "Cross-origin request refused." } }, 403);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return json({ ok: false, message: "Invalid JSON body." }, 422);
    let target;
    try {
      target = resolveRequest(env, { ...body, useDefault: body.useDefault !== false });
    } catch (err) {
      return json({ ok: false, message: err.message }, err.status || 400);
    }
    try {
      const result = await testConnection(target, env);
      return json({ ...result, provider: target.provider, model: target.model });
    } catch (err) {
      return json({ ok: false, message: err?.message || "Connection test failed." });
    }
  }
  if (url.pathname === "/api/chat" && request.method === "POST") {
    return handleChat(request, env, url, ctx);
  }
  return json({ detail: { message: "Not found." } }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env, url, ctx);
    return env.ASSETS.fetch(request);
  },
};
