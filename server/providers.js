// Provider adapters for the two backends Coding Buddy supports: Anthropic's Messages
// API and any OpenAI-compatible /chat/completions endpoint. Both are streamed as SSE
// and normalised to plain text deltas, so the browser only ever sees one event shape.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-4-20250514",
  openai: "gpt-4o",
};

function openaiBase(env) {
  return (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

// The server-side ("default AI") credentials. Nothing here is ever sent to the browser —
// /api/config exposes only the provider/model names.
export function serverConfig(env = {}) {
  const anthropicKey = (env.ANTHROPIC_API_KEY || "").trim();
  const openaiKey = (env.OPENAI_API_KEY || "").trim();
  const preferred = (env.DEFAULT_PROVIDER || "").trim().toLowerCase();

  let provider = null;
  if (preferred === "anthropic" && anthropicKey) provider = "anthropic";
  else if (preferred === "openai" && openaiKey) provider = "openai";
  else if (anthropicKey) provider = "anthropic";
  else if (openaiKey) provider = "openai";

  if (!provider) return { defaultAvailable: false, defaultProvider: null, defaultModel: null };

  const model =
    provider === "anthropic"
      ? env.ANTHROPIC_MODEL || DEFAULT_MODELS.anthropic
      : env.OPENAI_MODEL || DEFAULT_MODELS.openai;

  return { defaultAvailable: true, defaultProvider: provider, defaultModel: model };
}

function credentialsFor(provider, apiKey) {
  if (provider === "anthropic") return { provider, key: apiKey, model: DEFAULT_MODELS.anthropic };
  return { provider: "openai", key: apiKey, model: DEFAULT_MODELS.openai };
}

// A custom provider is any OpenAI-compatible /chat/completions endpoint.
function normalizeBaseUrl(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    const err = new Error("Add the custom API endpoint URL in Settings.");
    err.status = 400;
    throw err;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    const err = new Error("That custom API endpoint is not a valid URL.");
    err.status = 400;
    throw err;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    const err = new Error("The custom API endpoint must start with http:// or https://.");
    err.status = 400;
    throw err;
  }
  return raw.replace(/\/+$/, "");
}

export function resolveRequest(env, body) {
  const providerIn = String(body?.provider || "").toLowerCase();
  const modelIn = typeof body?.model === "string" ? body.model.trim() : "";

  if (body?.useDefault !== false) {
    const cfg = serverConfig(env);
    if (!cfg.defaultAvailable) {
      const err = new Error(
        "The default AI is not configured on this server. Add your own API key in Settings to start."
      );
      err.status = 503;
      throw err;
    }
    const apiKey = cfg.defaultProvider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
    return { useDefault: true, provider: cfg.defaultProvider, model: cfg.defaultModel, apiKey: apiKey.trim() };
  }

  const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
  if (!apiKey) {
    const err = new Error("Add your API key in Settings to start.");
    err.status = 400;
    throw err;
  }
  if (providerIn === "custom") {
    const baseUrl = normalizeBaseUrl(body?.baseUrl);
    if (!modelIn) {
      const err = new Error("Add the model name for your custom API in Settings.");
      err.status = 400;
      throw err;
    }
    const name = typeof body?.customName === "string" ? body.customName.trim().slice(0, 40) : "";
    return { useDefault: false, provider: "custom", model: modelIn, apiKey, baseUrl, name: name || "Custom AI" };
  }

  const provider = providerIn === "openai" ? "openai" : "anthropic";
  const fallback = credentialsFor(provider, apiKey);
  return { useDefault: false, provider, model: modelIn || fallback.model, apiKey };
}

// ---------------------------------------------------------------- SSE reader ----

async function* sseData(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index;
    while ((index = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      const data = raw
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (data) yield data;
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith("data:")) {
    const data = tail.slice(5).trim();
    if (data) yield data;
  }
}

// ------------------------------------------------------------------- errors ----

function friendlyError(provider, status, payload, customLabel) {
  const detail =
    payload?.error?.message || payload?.message || payload?.detail?.message || payload?.detail || "";
  const label = customLabel || (provider === "anthropic" ? "Anthropic" : "OpenAI");
  let message;
  if (status === 401 || status === 403) {
    message = `${label} rejected the API key. Check the key in Settings.`;
  } else if (status === 429) {
    message = `${label} is rate limiting these requests. Wait a moment and try again.`;
  } else if (status === 404 || status === 400) {
    message = detail
      ? `${label}: ${detail}`
      : `${label} rejected the model name. Check the model in Settings.`;
  } else if (status >= 500) {
    message = `${label} had a server error (${status}). Try again shortly.`;
  } else {
    message = detail || `${label} returned an error (${status}).`;
  }
  const err = new Error(String(message).slice(0, 400));
  err.status = 502;
  return err;
}

// ------------------------------------------------------------------ streams ----

async function streamAnthropic({ apiKey, model, system, messages }, onDelta, signal) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({ model, max_tokens: 4096, system, messages, stream: true }),
  });

  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null);
    throw friendlyError("anthropic", res.status, payload);
  }

  for await (const data of sseData(res.body)) {
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
      onDelta(event.delta.text);
    } else if (event.type === "error") {
      throw friendlyError("anthropic", 400, event);
    }
  }
}

async function streamOpenAI(env, { apiKey, model, system, messages, baseUrl, name }, onDelta, signal) {
  const base = baseUrl || openaiBase(env);
  const label = name || "OpenAI";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });

  if (!res.ok || !res.body) {
    const payload = await res.json().catch(() => null);
    throw friendlyError("openai", res.status, payload, label);
  }

  for await (const data of sseData(res.body)) {
    if (data === "[DONE]") break;
    let event;
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    const text = event.choices?.[0]?.delta?.content;
    if (text) onDelta(text);
    else if (event.error) throw friendlyError("openai", 400, event, label);
  }
}

export function streamCompletion(env, target, system, messages, onDelta, signal) {
  if (target.provider === "anthropic") {
    return streamAnthropic({ ...target, system, messages }, onDelta, signal);
  }
  return streamOpenAI(env, { ...target, system, messages }, onDelta, signal);
}

// --------------------------------------------------------------------- test ----

export async function testConnection(target, env = {}) {
  const started = Date.now();
  if (target.provider === "anthropic") {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": target.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: target.model,
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      }),
    });
    if (!res.ok) throw friendlyError("anthropic", res.status, await res.json().catch(() => null));
    return { ok: true, message: `Connected to Anthropic (${target.model}).`, latencyMs: Date.now() - started };
  }

  const base = target.baseUrl || openaiBase(env);
  const label = target.name || "OpenAI";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${target.apiKey}` },
    body: JSON.stringify({
      model: target.model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    }),
  });
  if (!res.ok) throw friendlyError("openai", res.status, await res.json().catch(() => null), label);
  return { ok: true, message: `Connected to ${label} (${target.model}).`, latencyMs: Date.now() - started };
}
