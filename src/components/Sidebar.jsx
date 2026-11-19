import { useMemo, useState } from "react";
import { Check, MessageSquare, MessageSquarePlus, Pencil, Search, Trash2, X } from "lucide-react";

function formatWhen(ts) {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function Sidebar({
  chats,
  activeChatId,
  open,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClearAll,
  onClose,
}) {
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chats
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [chats, query]);

  const startRename = (chat) => {
    setRenamingId(chat.id);
    setRenameValue(chat.title);
    setConfirmDeleteId(null);
  };

  const commitRename = (event) => {
    event.preventDefault();
    if (renamingId) {
      const title = renameValue.trim();
      if (title) onRename(renamingId, title);
    }
    setRenamingId(null);
  };

  const handleDelete = (chat) => {
    if (confirmDeleteId !== chat.id) {
      setConfirmDeleteId(chat.id);
      return;
    }
    setConfirmDeleteId(null);
    onDelete(chat.id);
  };

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}
      <aside className={`sidebar${open ? " sidebar-open" : ""}`} data-testid="chat-sidebar" aria-label="Chat history">
        <div className="sidebar-head">
          <button type="button" className="btn btn-primary sidebar-new" data-testid="new-chat-button" onClick={onNew}>
            <MessageSquarePlus size={16} />
            New chat
          </button>
          <button type="button" className="btn-icon sidebar-close" aria-label="Close sidebar" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="sidebar-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search chats"
          />
        </div>

        <nav className="sidebar-list">
          {filtered.length === 0 && <p className="sidebar-empty">{query ? "No matching chats" : "No chats yet"}</p>}
          {filtered.map((chat) => (
            <div
              key={chat.id}
              className={`sidebar-item${chat.id === activeChatId ? " active" : ""}`}
              data-testid="chat-history-item"
            >
              {renamingId === chat.id ? (
                <form className="sidebar-rename" onSubmit={commitRename}>
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    aria-label="Chat name"
                    maxLength={80}
                  />
                  <button type="submit" className="btn-icon" aria-label="Save name">
                    <Check size={14} />
                  </button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    className="sidebar-item-main"
                    onClick={() => onSelect(chat.id)}
                    title={chat.title}
                  >
                    <MessageSquare size={14} aria-hidden="true" />
                    <span className="sidebar-item-title">{chat.title}</span>
                    <span className="sidebar-item-when">{formatWhen(chat.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-icon"
                    data-testid="chat-item-rename-button"
                    aria-label={`Rename ${chat.title}`}
                    onClick={() => startRename(chat)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className={`btn-icon danger${confirmDeleteId === chat.id ? " confirming" : ""}`}
                    data-testid="chat-item-delete-button"
                    aria-label={confirmDeleteId === chat.id ? `Click again to delete ${chat.title}` : `Delete ${chat.title}`}
                    title={confirmDeleteId === chat.id ? "Click again to delete" : "Delete"}
                    onClick={() => handleDelete(chat)}
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          {confirmClear ? (
            <div className="sidebar-confirm">
              <span>Delete all chats?</span>
              <div className="sidebar-confirm-actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    setConfirmClear(false);
                    onClearAll();
                  }}
                >
                  Delete all
                </button>
                <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost danger-text"
              data-testid="clear-all-chats-button"
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 size={14} />
              Clear all chats
            </button>
          )}
          <p className="sidebar-count">
            {chats.length} chat{chats.length === 1 ? "" : "s"} · stored in this browser
          </p>
        </div>
      </aside>
    </>
  );
}
