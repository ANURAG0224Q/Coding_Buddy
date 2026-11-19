// Request shaping shared by the Node server (server/app.js) and the Cloudflare Worker
// (worker/index.js): system prompts per mode and message validation.

const MAX_HISTORY = 20;

const BASE_PROMPT = [
  "You are Coding Buddy, an AI pair programmer.",
  "Answer with complete, runnable code and short explanations.",
  "Use markdown fenced code blocks with a language tag. Keep prose tight: no filler,",
  "no restating the question, no apologies. If a request is ambiguous, make the",
  "smallest reasonable assumption and say which one you made.",
].join(" ");

export const MODE_PROMPTS = {
  chat: "",
  explain:
    "Mode: EXPLAIN CODE. Walk through what the code does, why it works that way, and the parts that are easy to get wrong. Quote only the lines that matter.",
  debug:
    "Mode: DEBUG. Identify the root cause, not just the symptom. Show the corrected code, then say what the fix changes and any other bug you noticed nearby.",
  refactor:
    "Mode: REFACTOR. Preserve behaviour exactly. Return the refactored code in full, then list the changes and why each one is an improvement.",
  write_tests:
    "Mode: WRITE TESTS. Produce a complete, runnable test file including edge cases and failure paths. Use the test framework already present in the code, and say how to run the file.",
};

export function systemPromptFor(mode) {
  const extra = MODE_PROMPTS[mode];
  return extra ? `${BASE_PROMPT}\n\n${extra}` : BASE_PROMPT;
}

export function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const cleaned = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
    const content = typeof item.content === "string" ? item.content : "";
    if (!role || !content.trim()) continue;
    cleaned.push({ role, content });
  }
  // Drop a leading assistant turn; both providers require a user message first.
  while (cleaned.length && cleaned[0].role !== "user") cleaned.shift();
  return cleaned.slice(-MAX_HISTORY);
}
