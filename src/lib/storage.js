// localStorage persistence for chats, settings, and the active chat id.

const CHATS_KEY = "codingbuddy.chats.v1";
const ACTIVE_KEY = "codingbuddy.activeChat.v1";
const SETTINGS_KEY = "codingbuddy.settings.v1";

export const DEFAULT_SETTINGS = {
  useDefault: true,
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  apiKey: "",
  // Only used when provider is "custom": a display name and an OpenAI-compatible endpoint.
  customName: "",
  baseUrl: "",
};

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createChat() {
  const now = Date.now();
  return { id: uid(), title: "New chat", messages: [], createdAt: now, updatedAt: now };
}

function safeParse(raw, fallback) {
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function loadChats() {
  try {
    const chats = safeParse(localStorage.getItem(CHATS_KEY), []);
    if (!Array.isArray(chats)) return [];
    return chats.filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages));
  } catch {
    return [];
  }
}

export function saveChats(chats) {
  try {
    localStorage.setItem(CHATS_KEY, JSON.stringify(chats));
  } catch {
    // storage full or unavailable — chats simply won't persist
  }
}

export function loadActiveChatId(chats) {
  try {
    const saved = localStorage.getItem(ACTIVE_KEY);
    if (saved && chats.some((c) => c.id === saved)) return saved;
  } catch {
    // fall through
  }
  return chats.length ? chats[0].id : null;
}

export function saveActiveChatId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}

export function loadSettings() {
  try {
    const stored = safeParse(localStorage.getItem(SETTINGS_KEY), {});
    const merged = {
      ...DEFAULT_SETTINGS,
      ...(stored && typeof stored === "object" ? stored : {}),
    };
    if (typeof merged.useDefault !== "boolean") merged.useDefault = DEFAULT_SETTINGS.useDefault;
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

export function loadAppState() {
  const chats = loadChats();
  if (chats.length === 0) {
    const first = createChat();
    return { chats: [first], activeChatId: first.id };
  }
  return { chats, activeChatId: loadActiveChatId(chats) };
}
