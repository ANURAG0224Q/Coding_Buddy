import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { extractErrorMessage, streamChat } from "@/lib/aiClient";
import {
  loadAppState,
  loadSettings,
  saveActiveChatId,
  saveChats,
  saveSettings,
  uid,
} from "@/lib/storage";
import Markdown from "@/components/Markdown";
import SettingsModal from "@/components/SettingsModal";
import Sidebar from "@/components/Sidebar";
import {
  AlertTriangle,
  Eraser,
  FileText,
  MessageSquarePlus,
  PanelLeft,
  Paperclip,
  Send,
  Settings as SettingsIcon,
  Square,
  Terminal,
  User,
  X,
} from "lucide-react";

const MODES = [
  { id: "chat", label: "Chat" },
  { id: "explain", label: "Explain Code" },
  { id: "debug", label: "Debug" },
  { id: "refactor", label: "Refactor" },
  { id: "write_tests", label: "Write Tests" },
];

const QUICK_PROMPTS = [
  "Debug this React useEffect that loops forever",
  "Write a Python FastAPI route with async streaming",
  "Explain how Docker multi-stage builds work",
  "Refactor a messy JavaScript function into clean modules",
];

const ALLOWED_FILE_RE = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|toml|ini|cfg|conf|env|js|jsx|ts|tsx|mjs|cjs|py|pyi|rb|go|rs|java|kt|kts|c|h|cpp|hpp|cc|cs|php|swift|m|mm|sql|sh|bash|zsh|ps1|bat|html?|css|scss|sass|less|vue|svelte|astro|xml|svg|graphql|prisma|dockerfile|gitignore|makefile)$/i;
const MAX_FILE_BYTES = 200 * 1024;

const MAX_HISTORY_MESSAGES = 20;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function ChatPage() {
  const initial = useRef(loadAppState());
  const [chats, setChats] = useState(initial.current.chats);
  const [activeChatId, setActiveChatId] = useState(initial.current.activeChatId);
  const [settings, setSettings] = useState(loadSettings);
  const [mode, setMode] = useState("chat");
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);

  const abortRef = useRef(null);
  const scrollRef = useRef(null);
  const stickRef = useRef(true);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // ------------------------------ server config (non-sensitive only) ----
  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: () => apiGet("/config"),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
  const config = configQuery.data || null;

  const usingDefault = settings.useDefault || !settings.apiKey.trim();
  const defaultMissing = Boolean(config && !config.defaultAvailable);
  const canChat = usingDefault ? config ? config.defaultAvailable : true : true;

  const activeChat = chats.find((c) => c.id === activeChatId) || null;
  const messages = activeChat ? activeChat.messages : [];

  // ------------------------------------------------------- persistence ----
  useEffect(() => {
    saveChats(chats);
  }, [chats]);
  useEffect(() => {
    saveActiveChatId(activeChatId);
  }, [activeChatId]);

  // ------------------------------------------------------ auto-scroll ----
  const lastContent = messages.length ? messages[messages.length - 1].content : "";
  useEffect(() => {
    if (stickRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lastContent, messages.length, streaming]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // ------------------------------------------------------ chat helpers ----
  const updateChat = useCallback((chatId, updater) => {
    setChats((prev) => prev.map((c) => (c.id === chatId ? updater(c) : c)));
  }, []);

  const startNewChat = useCallback(() => {
    setChats((prev) => {
      const current = prev.find((c) => c.id === activeChatId);
      if (current && current.messages.length === 0) {
        return prev;
      }
      const now = Date.now();
      const chat = { id: uid(), title: "New chat", messages: [], createdAt: now, updatedAt: now };
      setActiveChatId(chat.id);
      return [chat, ...prev];
    });
    setInput("");
    setAttachments([]);
    setErrorBanner(null);
    setSidebarOpen(window.innerWidth > 900);
    textareaRef.current?.focus();
  }, [activeChatId]);

  const clearChat = useCallback(() => {
    if (!activeChatId) return;
    const now = Date.now();
    updateChat(activeChatId, (c) => ({ ...c, messages: [], title: "New chat", updatedAt: now }));
    setErrorBanner(null);
  }, [activeChatId, updateChat]);

  const deleteChat = useCallback(
    (chatId) => {
      setChats((prev) => {
        const remaining = prev.filter((c) => c.id !== chatId);
        if (chatId === activeChatId) {
          if (remaining.length > 0) {
            setActiveChatId(remaining[0].id);
          } else {
            const now = Date.now();
            const fresh = { id: uid(), title: "New chat", messages: [], createdAt: now, updatedAt: now };
            setActiveChatId(fresh.id);
            return [fresh];
          }
        }
        return remaining;
      });
    },
    [activeChatId]
  );

  const clearAllChats = useCallback(() => {
    const now = Date.now();
    const fresh = { id: uid(), title: "New chat", messages: [], createdAt: now, updatedAt: now };
    setChats([fresh]);
    setActiveChatId(fresh.id);
    setErrorBanner(null);
  }, []);

  // -------------------------------------------------------- streaming ----
  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (textOverride) => {
      const text = (typeof textOverride === "string" ? textOverride : input).trim();
      if (!text || streaming || !canChat) return;

      const attached = attachments;
      let content = text;
      if (attached.length > 0) {
        const fileBlocks = attached
          .map((a) => `Attached file: ${a.name}\n\`\`\`\n${a.content}\n\`\`\``)
          .join("\n\n");
        content = `${text}\n\n${fileBlocks}`;
      }

      const now = Date.now();
      const userMessage = {
        id: uid(),
        role: "user",
        content,
        attachments: attached.map(({ name, size }) => ({ name, size })),
        createdAt: now,
      };
      const assistantMessage = { id: uid(), role: "assistant", content: "", createdAt: now + 1 };

      const chatId = activeChatId || uid();
      let historyPayload = [];
      setChats((prev) => {
        const existing = prev.find((c) => c.id === chatId);
        const priorMessages = existing ? existing.messages : [];
        const nextMessages = [...priorMessages, userMessage, assistantMessage];
        historyPayload = nextMessages
          .slice(-MAX_HISTORY_MESSAGES)
          .map((m) => ({ role: m.role, content: m.content }));
        const title = priorMessages.length === 0 ? text.slice(0, 60) : existing ? existing.title : text.slice(0, 60);
        if (existing) {
          return prev.map((c) =>
            c.id === chatId ? { ...c, messages: nextMessages, title, updatedAt: now } : c
          );
        }
        const fresh = {
          id: chatId,
          title,
          messages: nextMessages,
          createdAt: now,
          updatedAt: now,
        };
        return [fresh, ...prev];
      });
      if (!activeChatId) setActiveChatId(chatId);

      setInput("");
      setAttachments([]);
      setErrorBanner(null);
      setStreaming(true);
      stickRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;
      let streamError = null;

      try {
        for await (const event of streamChat(
          {
            useDefault: usingDefault,
            provider: settings.provider,
            model: settings.model,
            apiKey: usingDefault ? null : settings.apiKey.trim(),
            customName: usingDefault ? null : settings.customName || "",
            baseUrl: usingDefault ? null : settings.baseUrl || "",
            messages: historyPayload.length > 0 ? historyPayload : [{ role: "user", content }],
            mode,
          },
          controller.signal
        )) {
          if (event.type === "delta" && event.text) {
            const delta = event.text;
            updateChat(chatId, (c) => ({
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantMessage.id ? { ...m, content: m.content + delta } : m
              ),
              updatedAt: Date.now(),
            }));
          } else if (event.type === "error") {
            streamError = event.message || "The AI returned an error. Please try again.";
          }
        }
      } catch (err) {
        if (!err || err.name !== "AbortError") {
          streamError = extractErrorMessage(err);
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        if (streamError) setErrorBanner(streamError);
        textareaRef.current?.focus();
      }
    },
    [activeChatId, attachments, canChat, input, mode, settings, streaming, updateChat, usingDefault]
  );

  // ------------------------------------------------------ attachments ----
  const addFiles = async (fileList) => {
    const accepted = [];
    const rejected = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} (over 200 KB)`);
        continue;
      }
      if (!ALLOWED_FILE_RE.test(file.name)) {
        rejected.push(`${file.name} (not a text or code file)`);
        continue;
      }
      try {
        const content = await file.text();
        accepted.push({ name: file.name, size: file.size, content });
      } catch {
        rejected.push(`${file.name} (could not be read)`);
      }
    }
    if (rejected.length > 0) {
      setErrorBanner(`Skipped: ${rejected.join(", ")}. Only text/code files up to 200 KB are supported.`);
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
      setErrorBanner(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  // ------------------------------------------------------- keyboard ----
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        startNewChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [startNewChat]);

  const onInputKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const autoResize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };

  // -------------------------------------------------------- settings ----
  const saveSettingsAndClose = (next) => {
    setSettings(next);
    saveSettings(next);
    setSettingsOpen(false);
    setErrorBanner(null);
  };

  const openSettingsFromBanner = () => {
    setErrorBanner(null);
    setSettingsOpen(true);
  };

  // ---------------------------------------------------------- render ----
  const inputPlaceholder = streaming
    ? "Generating…"
    : !canChat
      ? "Add your API key in Settings to start"
      : mode === "chat"
        ? "Ask Coding Buddy anything about code…"
        : `${MODES.find((m) => m.id === mode)?.label}: paste code or describe your task…`;

  return (
    <div className="app">
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        open={sidebarOpen}
        onSelect={(id) => {
          setActiveChatId(id);
          setErrorBanner(null);
          if (window.innerWidth <= 900) setSidebarOpen(false);
        }}
        onNew={startNewChat}
        onRename={(id, title) => updateChat(id, (c) => ({ ...c, title }))}
        onDelete={deleteChat}
        onClearAll={clearAllChats}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="main">
        <header className="header">
          <div className="header-left">
            <button
              type="button"
              className="btn-icon"
              aria-label={sidebarOpen ? "Hide chat history" : "Show chat history"}
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <PanelLeft size={18} />
            </button>
            <div className="logo">
              <Terminal size={18} aria-hidden="true" />
              <span className="logo-name">
                Coding Buddy<span className="logo-cursor" aria-hidden="true" />
              </span>
            </div>
          </div>
          <div className="header-right">
            <span
              className={`badge ${usingDefault ? "badge-default" : "badge-custom"}`}
              data-testid="ai-status-badge"
            >
              <span className="badge-dot" aria-hidden="true" />
              {usingDefault
                ? "Using: Default AI"
                : settings.provider === "custom"
                  ? `Using: ${(settings.customName || "").trim() || "Custom AI"}`
                  : "Using: Your key"}
            </span>
            <button type="button" className="btn" onClick={startNewChat} aria-label="Start a new chat">
              <MessageSquarePlus size={15} />
              <span className="btn-label">New chat</span>
            </button>
            <button type="button" className="btn" onClick={clearChat} aria-label="Clear the current chat">
              <Eraser size={15} />
              <span className="btn-label">Clear chat</span>
            </button>
            <button
              type="button"
              className="btn-icon"
              data-testid="settings-modal-button"
              aria-label="Open settings"
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon size={17} />
            </button>
          </div>
        </header>

        {errorBanner && (
          <div className="banner" data-testid="error-banner" role="alert">
            <AlertTriangle size={16} aria-hidden="true" />
            <span className="banner-text">{errorBanner}</span>
            <button type="button" className="btn btn-sm" onClick={openSettingsFromBanner}>
              Open Settings
            </button>
            <button
              type="button"
              className="btn-icon"
              data-testid="error-banner-dismiss"
              aria-label="Dismiss error"
              onClick={() => setErrorBanner(null)}
            >
              <X size={15} />
            </button>
          </div>
        )}

        <div className="chat-scroll" ref={scrollRef} onScroll={onScroll}>
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">
                <Terminal size={30} />
              </div>
              <h1>Coding Buddy</h1>
              <p>
                Your AI pair programmer. Ask anything, paste code, or attach a file — it answers with complete,
                runnable code and short explanations.
              </p>
              <div className="quick-prompts">
                {QUICK_PROMPTS.map((prompt) => (
                  <button key={prompt} type="button" className="quick-prompt" onClick={() => send(prompt)}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => {
                const isUser = message.role === "user";
                const isLast = index === messages.length - 1;
                const showCursor = !isUser && isLast && streaming;
                return (
                  <article
                    key={message.id}
                    className={`msg ${isUser ? "msg-user" : "msg-assistant"}`}
                    data-testid={isUser ? "message-bubble-user" : "message-bubble-assistant"}
                  >
                    <div className="msg-avatar" aria-hidden="true">
                      {isUser ? <User size={15} /> : <Terminal size={15} />}
                    </div>
                    <div className="msg-body">
                      <div className="msg-meta">
                        <span className="msg-role">{isUser ? "You" : "Coding Buddy"}</span>
                        <span className="msg-time">{formatTime(message.createdAt)}</span>
                      </div>
                      {message.attachments && message.attachments.length > 0 && (
                        <div className="msg-attachments">
                          {message.attachments.map((a, i) => (
                            <span key={i} className="chip">
                              <FileText size={12} aria-hidden="true" />
                              {a.name} · {formatBytes(a.size)}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className={`bubble ${isUser ? "bubble-user" : "bubble-assistant"}`}>
                        {isUser ? (
                          <p className="msg-user-text">{message.content}</p>
                        ) : (
                          <>
                            <Markdown content={message.content} />
                            {showCursor && <span className="stream-cursor" aria-hidden="true" />}
                            {!message.content && !streaming && <p className="msg-empty">(no response)</p>}
                          </>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="composer-wrap">
          <div className="mode-selector" data-testid="mode-selector" role="tablist" aria-label="Assistant mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                className={`mode-chip${mode === m.id ? " active" : ""}`}
                data-testid={`mode-option-${m.id.replace("_", "-")}`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {!canChat && (
            <p className="composer-note" role="status">
              Add your API key in Settings to start.{" "}
              <button type="button" className="link-btn" onClick={() => setSettingsOpen(true)}>
                Open Settings
              </button>
            </p>
          )}

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            {attachments.length > 0 && (
              <div className="attachment-row">
                {attachments.map((a, i) => (
                  <span key={`${a.name}-${i}`} className="chip chip-file" data-testid="file-attachment-chip">
                    <FileText size={12} aria-hidden="true" />
                    {a.name} · {formatBytes(a.size)}
                    <button
                      type="button"
                      className="chip-x"
                      data-testid="file-attachment-remove-button"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => removeAttachment(i)}
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="composer-row">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                data-testid="file-upload-input"
                className="file-input"
                aria-hidden="true"
                tabIndex={-1}
                accept=".txt,.md,.markdown,.json,.csv,.tsv,.log,.yml,.yaml,.toml,.ini,.cfg,.conf,.env,.js,.jsx,.ts,.tsx,.mjs,.cjs,.py,.pyi,.rb,.go,.rs,.java,.kt,.kts,.c,.h,.cpp,.hpp,.cc,.cs,.php,.swift,.m,.mm,.sql,.sh,.bash,.zsh,.ps1,.bat,.html,.htm,.css,.scss,.sass,.less,.vue,.svelte,.astro,.xml,.svg,.graphql,.prisma"
                onChange={(e) => addFiles(e.target.files)}
              />
              <button
                type="button"
                className="btn-icon"
                data-testid="file-upload-button"
                aria-label="Attach a text or code file (max 200 KB)"
                title="Attach a text or code file (max 200 KB)"
                onClick={() => fileInputRef.current?.click()}
                disabled={!canChat}
              >
                <Paperclip size={17} />
              </button>

              <textarea
                ref={textareaRef}
                data-testid="chat-input-textarea"
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={onInputKeyDown}
                placeholder={inputPlaceholder}
                rows={1}
                aria-label="Message Coding Buddy"
                disabled={!canChat}
              />

              {streaming ? (
                <button
                  type="button"
                  className="btn btn-stop"
                  data-testid="chat-stop-button"
                  onClick={stopStreaming}
                  aria-label="Stop generating"
                >
                  <Square size={14} />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary btn-send"
                  data-testid="chat-send-button"
                  aria-label="Send message"
                  disabled={!input.trim() || !canChat}
                >
                  <Send size={16} />
                </button>
              )}
            </div>

            <p className="composer-hint">
              <kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · text and code files up to
              200 KB
            </p>
          </form>
        </div>
      </main>

      <SettingsModal
        open={settingsOpen}
        config={config}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onSave={saveSettingsAndClose}
      />
    </div>
  );
}
