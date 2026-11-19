import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { resolveRequest, serverConfig, streamCompletion, testConnection } from "./providers.js";
import { MODE_PROMPTS, sanitizeMessages, systemPromptFor } from "./core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, "../dist");

const RATE_LIMIT_PER_HOUR = 20;
const MAX_BODY = "12mb";

// ------------------------------------------------------------------ rate limit ----
// Only the server-funded default AI is metered; a visitor's own key is their own quota.
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

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", true);
app.use(express.json({ limit: MAX_BODY }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, ...serverConfig(process.env) });
});

app.get("/api/config", (_req, res) => {
  const cfg = serverConfig(process.env);
  res.set("cache-control", "no-store");
  res.json({ ...cfg, rateLimitPerHour: RATE_LIMIT_PER_HOUR });
});

app.post("/api/test", async (req, res) => {
  let target;
  try {
    target = resolveRequest(process.env, { ...req.body, useDefault: req.body?.useDefault !== false });
  } catch (err) {
    res.status(err.status || 400).json({ ok: false, message: err.message });
    return;
  }

  try {
    const result = await testConnection(target, process.env);
    res.json({ ...result, provider: target.provider, model: target.model });
  } catch (err) {
    res.status(200).json({ ok: false, message: err?.message || "Connection test failed." });
  }
});

app.post("/api/chat", async (req, res) => {
  const body = req.body || {};
  const mode = typeof body.mode === "string" && MODE_PROMPTS[body.mode] !== undefined ? body.mode : "chat";
  const messages = sanitizeMessages(body.messages);

  if (messages.length === 0) {
    res.status(422).json({ detail: { message: "Send at least one message." } });
    return;
  }

  let target;
  try {
    target = resolveRequest(process.env, { ...body, mode });
  } catch (err) {
    res.status(err.status || 400).json({ detail: { message: err.message } });
    return;
  }

  if (target.useDefault) {
    const retryAfter = takeToken(req.ip || "unknown");
    if (retryAfter > 0) {
      res.status(429).json({
        detail: {
          message: `Default AI limit reached (${RATE_LIMIT_PER_HOUR} requests/hour). Add your own API key in Settings for unlimited use.`,
        },
      });
      return;
    }
  }

  res.status(200).set({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders?.();

  const write = (event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  try {
    await streamCompletion(
      process.env,
      target,
      systemPromptFor(mode),
      messages,
      (text) => write({ type: "delta", text }),
      controller.signal
    );
    write({ type: "done" });
  } catch (err) {
    if (!controller.signal.aborted) {
      write({ type: "error", message: err?.message || "The AI request failed. Please try again." });
    }
  } finally {
    res.end();
  }
});

// ------------------------------------------------------------------ frontend ----
if (fs.existsSync(path.join(DIST, "index.html"))) {
  app.use(
    express.static(DIST, {
      index: false,
      setHeaders(res, filePath) {
        if (/\.(js|css|woff2?|svg|png|jpg|jpeg|webp|ico)$/.test(filePath)) {
          res.setHeader("cache-control", "public, max-age=31536000, immutable");
        }
      },
    })
  );
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api/")) return next();
    res.set("cache-control", "no-store");
    res.sendFile(path.join(DIST, "index.html"));
  });
}

export default app;
