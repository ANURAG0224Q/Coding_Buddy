// Streaming SSE client for /api/chat, plus friendly error extraction.
// Uses fetch + ReadableStream directly because EventSource cannot POST and the
// JSON helpers in api.ts cannot stream.

export class ChatError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "ChatError";
    this.status = status;
  }
}

export function extractErrorMessage(err) {
  if (err instanceof ChatError) return err.message;
  if (err && err.message) return err.message;
  return "Something went wrong. Please try again.";
}

function detailMessage(body, fallback) {
  const d = body && body.detail;
  if (typeof d === "string") return d;
  if (d && typeof d === "object" && typeof d.message === "string") return d.message;
  if (body && typeof body.message === "string") return body.message;
  return fallback;
}

export async function* streamChat(payload, signal) {
  let res;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (err && err.name === "AbortError") throw err;
    throw new ChatError(0, "Could not reach the server. Check your connection and try again.");
  }

  if (!res.ok) {
    let message = `Request failed (HTTP ${res.status}).`;
    try {
      message = detailMessage(await res.json(), message);
    } catch {
      // non-JSON error body — keep the fallback
    }
    throw new ChatError(res.status, message);
  }

  if (!res.body) throw new ChatError(502, "The server returned an empty stream. Please try again.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err && err.name === "AbortError") throw err;
      throw new ChatError(502, "The connection dropped while streaming. Please try again.");
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });

    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      let event;
      try {
        event = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      yield event;
    }
  }
}
