import { useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";
import { AlertTriangle, CheckCircle2, Eye, EyeOff, PlugZap, X } from "lucide-react";

export const PROVIDERS = [
  { value: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-20250514" },
  { value: "openai", label: "OpenAI", defaultModel: "gpt-4o" },
  {
    value: "custom",
    label: "Custom API",
    defaultModel: "",
    hint: "Any OpenAI-compatible endpoint: Groq, Together, OpenRouter, Ollama, a self-hosted gateway…",
  },
];

export default function SettingsModal({ open, config, settings, onClose, onSave }) {
  const [useDefault, setUseDefault] = useState(true);
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [customName, setCustomName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const dialogRef = useRef(null);

  // Re-initialise the form from the saved settings each time the modal opens.
  useEffect(() => {
    if (open) {
      setUseDefault(settings.useDefault);
      setProvider(settings.provider);
      setModel(settings.model);
      setApiKey(settings.apiKey);
      setCustomName(settings.customName || "");
      setBaseUrl(settings.baseUrl || "");
      setShowKey(false);
      setTesting(false);
      setTestResult(null);
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const providerMeta = PROVIDERS.find((p) => p.value === provider) || PROVIDERS[0];
  const isCustom = provider === "custom";
  const providerLabel = isCustom ? customName.trim() || "Custom API" : providerMeta.label;
  const effectiveModel = model.trim() || providerMeta.defaultModel;
  const customReady = !isCustom || Boolean(customName.trim() && baseUrl.trim() && effectiveModel);

  const switchMode = (next) => {
    setUseDefault(next === "default");
    setTestResult(null);
    if (next === "custom" && !model.trim()) setModel(providerMeta.defaultModel);
  };

  const changeProvider = (value) => {
    setProvider(value);
    const meta = PROVIDERS.find((p) => p.value === value);
    if (meta) setModel(meta.defaultModel);
    setTestResult(null);
  };

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const payload =
        useDefault || !apiKey.trim()
          ? { useDefault: true }
          : {
              useDefault: false,
              provider,
              model: effectiveModel,
              apiKey: apiKey.trim(),
              customName: isCustom ? customName.trim() : undefined,
              baseUrl: isCustom ? baseUrl.trim() : undefined,
            };
      const res = await apiPost("/test", payload);
      setTestResult(res);
    } catch (err) {
      const detail = err && err.body && err.body.detail;
      const serverMessage =
        typeof detail === "string" ? detail : detail && detail.message ? detail.message : null;
      setTestResult({ ok: false, message: serverMessage || "Could not reach the server to test the connection." });
    } finally {
      setTesting(false);
    }
  };

  const save = () => {
    onSave({
      useDefault,
      provider,
      model: useDefault ? settings.model || providerMeta.defaultModel : effectiveModel,
      apiKey: apiKey.trim(),
      customName: isCustom ? customName.trim() : settings.customName || "",
      baseUrl: isCustom ? baseUrl.trim() : settings.baseUrl || "",
    });
  };

  const hasKey = apiKey.trim().length > 0;

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="settings-modal"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <h2>Settings</h2>
          <button type="button" className="btn-icon" aria-label="Close settings" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <fieldset className="settings-section">
            <legend className="settings-legend">AI source</legend>
            <label
              className={`settings-mode-option${useDefault ? " selected" : ""}`}
              data-testid="settings-ai-toggle-default"
            >
              <input
                type="radio"
                name="ai-mode"
                value="default"
                checked={useDefault}
                onChange={() => switchMode("default")}
              />
              <span className="settings-mode-text">
                <strong>Use default AI</strong>
                <small>Server-configured key. Limited to {20} requests/hour.</small>
              </span>
            </label>
            <label
              className={`settings-mode-option${!useDefault ? " selected" : ""}`}
              data-testid="settings-ai-toggle-custom"
            >
              <input
                type="radio"
                name="ai-mode"
                value="custom"
                checked={!useDefault}
                onChange={() => switchMode("custom")}
              />
              <span className="settings-mode-text">
                <strong>Use my own API key</strong>
                <small>Stored only in this browser (localStorage) and sent per request. Never stored on the server.</small>
              </span>
            </label>
          </fieldset>

          {useDefault ? (
            <div className="settings-default-info">
              {config && config.defaultAvailable ? (
                <p>
                  Default AI is ready: <strong>{config.defaultProvider}</strong> / <strong>{config.defaultModel}</strong>.
                  No key needed — just start chatting.
                </p>
              ) : (
                <p className="warning">
                  <AlertTriangle size={15} /> The default AI is not configured on this server. Enter your own API key
                  below to start.
                </p>
              )}
            </div>
          ) : (
            <div className="settings-section">
              <div className="field">
                <label htmlFor="cb-provider">Provider</label>
                <select
                  id="cb-provider"
                  data-testid="settings-provider-select"
                  value={provider}
                  onChange={(e) => changeProvider(e.target.value)}
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>

              {isCustom && (
                <>
                  <div className="field">
                    <label htmlFor="cb-custom-name">Custom AI name</label>
                    <input
                      id="cb-custom-name"
                      type="text"
                      data-testid="settings-custom-name-input"
                      value={customName}
                      onChange={(e) => {
                        setCustomName(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder="e.g. Groq, My Local LLM"
                      maxLength={40}
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <small className="field-hint">Shown in the header badge. Anything you like.</small>
                  </div>

                  <div className="field">
                    <label htmlFor="cb-base-url">API endpoint</label>
                    <input
                      id="cb-base-url"
                      type="url"
                      data-testid="settings-custom-base-url-input"
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        setTestResult(null);
                      }}
                      placeholder="https://api.groq.com/openai/v1"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <small className="field-hint">{providerMeta.hint}</small>
                  </div>
                </>
              )}

              <div className="field">
                <label htmlFor="cb-model">Model</label>
                <input
                  id="cb-model"
                  type="text"
                  data-testid="settings-model-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={isCustom ? "e.g. llama-3.3-70b-versatile" : providerMeta.defaultModel}
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              <div className="field">
                <label htmlFor="cb-key">{providerLabel} API key</label>
                <div className="key-row">
                  <input
                    id="cb-key"
                    type={showKey ? "text" : "password"}
                    data-testid="settings-api-key-input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={isCustom ? "Your API key" : provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    className="btn-icon"
                    data-testid="settings-api-key-toggle-visibility"
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                    onClick={() => setShowKey((v) => !v)}
                  >
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <small className="field-hint">
                  {isCustom
                    ? "It stays in your browser and is sent only with your own requests."
                    : `Get a key at ${provider === "anthropic" ? "console.anthropic.com" : "platform.openai.com"}. It stays in your browser and is used only for your own requests.`}
                </small>
              </div>
            </div>
          )}

          <div className="settings-test-row">
            <button
              type="button"
              className="btn"
              data-testid="settings-test-connection-button"
              onClick={runTest}
              disabled={testing || (!useDefault && !hasKey) || !customReady}
            >
              <PlugZap size={15} />
              {testing ? "Testing…" : "Test connection"}
            </button>
            {testResult && (
              <p
                className={`test-result ${testResult.ok ? "ok" : "bad"}`}
                data-testid="settings-test-connection-result"
                role="status"
              >
                {testResult.ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                <span>
                  {testResult.message}
                  {testResult.ok && testResult.latencyMs != null ? ` (${testResult.latencyMs} ms)` : ""}
                </span>
              </p>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="settings-save-button"
            onClick={save}
            disabled={!useDefault && (!hasKey || !customReady)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
