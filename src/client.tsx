"use client";

import { useEffect, useRef, useState } from "react";
import { getOrCreateVisitorId } from "@qviks/track";
import { hasNotrackCookie } from "@qviks/track/cookie";

/*
 * Website AI chat bubble. Talks to the site's own /api/chat (createChatHandler
 * from @qviks/chat/server), which streams the answer and stores the turn in
 * Qviks. The conversation (session id + messages) lives in sessionStorage, so a
 * reload or another page of the same site continues it; a new tab starts fresh.
 * Styles are its own (class prefix qc-), so the site needs no Tailwind setup.
 */

type Msg = { role: "user" | "assistant"; content: string };
type Stored = { sid: string; messages: Msg[] };

/** UI strings; a site passes its own language. Defaults: English. */
export type ChatLabels = {
  /** Header, "{name}" is replaced by the `name` prop. */
  header: string;
  close: string;
  closeChat: string;
  open: string;
  placeholder: string;
  send: string;
  typing: string;
  offline: string;
};

const EN: ChatLabels = {
  header: "{name} assistant",
  close: "Close",
  closeChat: "Close chat",
  open: "Ask our AI assistant",
  placeholder: "Ask a question...",
  send: "Send",
  typing: "Typing...",
  offline: "Sorry, I couldn't connect. Please try again.",
};

/** Slovak labels, ready to pass as `labels`. */
export const SK_LABELS: ChatLabels = {
  header: "{name}",
  close: "Zavrieť",
  closeChat: "Zavrieť chat",
  open: "Opýtajte sa AI asistenta",
  placeholder: "Napíšte otázku...",
  send: "Poslať",
  typing: "Píšem...",
  offline: "Prepáčte, nepodarilo sa pripojiť. Skúste to prosím znova.",
};

export type ChatWidgetProps = {
  /** Sent as `site` to /api/chat (an app serving many sites picks the assistant by it). */
  site: string;
  name: string;
  /** First bubble, UI only (never sent to the model). */
  greeting: string;
  /** Example questions offered as bubbles. */
  suggestions: string[];
  /** Accent colour (button, own messages, links). */
  accent?: string;
  labels?: Partial<ChatLabels>;
  /** Render [label](url) in replies as links (the site's prompt must ask for that format). */
  links?: boolean;
  /** Maps a link from a reply before it is used (e.g. add the page's locale prefix to "/pricing"). */
  rewriteLink?: (url: string) => string;
  /** Style of the floating open/close button (default: accent background, white text). */
  buttonStyle?: React.CSSProperties;
  /** Icon-only open button (the label becomes its aria-label; open = a close cross). */
  icon?: React.ReactNode;
  /** Default: /api/chat. */
  endpoint?: string;
};

const CSS = `
.qc-panel{position:fixed;bottom:6rem;left:1rem;right:1rem;z-index:2147483000;display:flex;flex-direction:column;height:28rem;max-height:70vh;border:1px solid #e4e2dc;border-radius:1rem;background:#fff;color:#1f2328;box-shadow:0 20px 25px -5px rgba(0,0,0,.1),0 8px 10px -6px rgba(0,0,0,.1);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:left}
@media (min-width:640px){.qc-panel{left:auto;width:24rem}}
.qc-head{display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid #e4e2dc;font-weight:500}
.qc-x{background:none;border:0;padding:0;font:inherit;font-size:13px;color:#5b616b;cursor:pointer}
.qc-list{flex:1;display:flex;flex-direction:column;gap:.75rem;overflow-y:auto;padding:1rem}
.qc-msg{max-width:85%;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:1rem;padding:.5rem .75rem}
.qc-user{align-self:flex-end;background:var(--qc-accent);color:#fff}
.qc-bot{align-self:flex-start;background:#eef3f1}
.qc-bot a{color:var(--qc-accent);font-weight:600;text-decoration:underline;text-underline-offset:2px}
.qc-dim{opacity:.6}
.qc-sugs{display:flex;flex-direction:column;align-items:flex-end;gap:.5rem;padding-top:.25rem}
.qc-sug{background:none;border:1px solid var(--qc-accent);border-radius:1rem;padding:.375rem .75rem;font:inherit;color:var(--qc-accent);cursor:pointer;text-align:right}
.qc-sug:hover{background:#eef3f1}
.qc-form{display:flex;gap:.5rem;padding:.75rem;border-top:1px solid #e4e2dc}
.qc-in{flex:1;min-width:0;border:1px solid #e4e2dc;border-radius:.5rem;padding:.5rem .75rem;font:inherit;font-size:16px;color:inherit;background:#fff;outline:none}
.qc-in:focus{border-color:var(--qc-accent)}
.qc-send{border:0;border-radius:.5rem;background:var(--qc-accent);color:#fff;padding:0 1rem;font:inherit;cursor:pointer}
.qc-send:disabled{opacity:.5;cursor:default}
.qc-btn{position:fixed;bottom:1.5rem;right:1rem;z-index:2147483000;display:flex;align-items:center;justify-content:center;border:0;border-radius:9999px;background:var(--qc-accent);color:#fff;padding:.75rem 1.25rem;font:500 15px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 15px -3px rgba(0,0,0,.15);cursor:pointer}
`;

/* ─── Turnstile (only when /api/chat asks for it with a 428) ───────────── */

type Turnstile = { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let turnstileLoading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  turnstileLoading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      turnstileLoading = null;
      reject(new Error("turnstile script"));
    };
    document.head.appendChild(s);
  });
  return turnstileLoading;
}

/** Runs the invisible widget once and returns its token ("" on failure). */
async function getTurnstileToken(siteKey: string): Promise<string> {
  try {
    await loadTurnstile();
  } catch {
    return "";
  }
  const ts = window.turnstile;
  if (!ts) return "";
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(el);
  return new Promise<string>((resolve) => {
    let id = "";
    const done = (token: string) => {
      clearTimeout(timer);
      if (id) ts.remove(id);
      el.remove();
      resolve(token);
    };
    const timer = setTimeout(() => done(""), 15_000);
    id = ts.render(el, {
      sitekey: siteKey,
      callback: (token: string) => done(token),
      "error-callback": () => done(""),
      "expired-callback": () => done(""),
    });
  });
}

/* ─── Widget ────────────────────────────────────────────────────────────── */

function pickSuggestions(all: string[], asked: string[], n: number) {
  const pool = all.filter((q) => !asked.includes(q));
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}

function newSessionId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const MD_LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|\/)[^)\s]*)\)/g;

/** [label](url) -> link. Same-site paths stay in the tab and close the chat; other sites open in a new tab. */
function Linkified({ text, rewrite, onNavigate }: { text: string; rewrite?: (url: string) => string; onNavigate: () => void }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MD_LINK)) {
    const [whole, label, url] = m;
    const internal = url.startsWith("/");
    parts.push(text.slice(last, m.index));
    parts.push(
      <a
        key={m.index}
        href={rewrite ? rewrite(url) : url}
        {...(internal ? { onClick: onNavigate } : { target: "_blank", rel: "noopener noreferrer" })}
      >
        {label}
      </a>,
    );
    last = m.index + whole.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

export function ChatWidget({
  site,
  name,
  greeting,
  suggestions: all,
  accent = "#2f6f5e",
  labels,
  links = false,
  rewriteLink,
  buttonStyle,
  icon,
  endpoint = "/api/chat",
}: ChatWidgetProps) {
  const t = { ...EN, ...labels };
  const storageKey = `qviks-chat-${site}`;
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  // Picked on open, not on render, so server and client markup never differ.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const sidRef = useRef<string | null>(null);

  // Restore the conversation after mount (sessionStorage is browser-only).
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as Stored;
      if (stored?.sid && Array.isArray(stored.messages)) {
        sidRef.current = stored.sid;
        setMessages(stored.messages);
      }
    } catch {}
  }, [storageKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, suggestions, open]);

  function save(next: Msg[]) {
    if (!sidRef.current) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ sid: sidRef.current, messages: next } satisfies Stored));
    } catch {}
  }

  function toggle() {
    if (!open && suggestions.length === 0) {
      setSuggestions(pickSuggestions(all, messages.filter((m) => m.role === "user").map((m) => m.content), 3));
    }
    setOpen((o) => !o);
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;

    sidRef.current ??= newSessionId();
    const history: Msg[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    let answer = "";
    const append = (chunk: string) => {
      answer += chunk;
      setMessages([...history, { role: "assistant", content: answer }]);
    };

    try {
      const params = new URLSearchParams(window.location.search);
      const optedOut = hasNotrackCookie(document.cookie);
      const post = (turnstile?: string) =>
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            site,
            session_id: sidRef.current,
            messages: history,
            path: window.location.pathname,
            locale: document.documentElement.lang || undefined,
            referrer: document.referrer || undefined,
            utm_source: params.get("utm_source") ?? undefined,
            utm_medium: params.get("utm_medium") ?? undefined,
            utm_campaign: params.get("utm_campaign") ?? undefined,
            visitor_id: optedOut ? undefined : getOrCreateVisitorId(),
            wd: navigator.webdriver === true,
            turnstile,
          }),
        });
      let res = await post();
      // First message: the server asks for an invisible human check, then we resend once.
      if (res.status === 428) {
        const { turnstile: key } = (await res.json()) as { turnstile?: string };
        const token = key ? await getTurnstileToken(key) : "";
        if (!token) throw new Error("human check");
        res = await post(token);
      }
      if (!res.body || res.status === 428) throw new Error("no body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        append(decoder.decode(value, { stream: true }));
      }
    } catch {
      append(t.offline);
    } finally {
      setBusy(false);
      save([...history, { role: "assistant", content: answer }]);
      setSuggestions(pickSuggestions(all, history.filter((m) => m.role === "user").map((m) => m.content), 2));
    }
  }

  const shown: Msg[] = [{ role: "assistant", content: greeting }, ...messages];

  return (
    <div style={{ "--qc-accent": accent } as React.CSSProperties}>
      <style>{CSS}</style>
      {open && (
        <div className="qc-panel" role="dialog" aria-label={t.header.replace("{name}", name)}>
          <div className="qc-head">
            <span>{t.header.replace("{name}", name)}</span>
            <button type="button" onClick={() => setOpen(false)} className="qc-x" aria-label={t.closeChat}>
              {t.close}
            </button>
          </div>
          <div ref={listRef} className="qc-list" aria-live="polite">
            {shown.map((m, i) => (
              <div key={i} className={`qc-msg ${m.role === "user" ? "qc-user" : "qc-bot"}`}>
                {m.content ? (
                  links && m.role === "assistant" ? (
                    <Linkified text={m.content} rewrite={rewriteLink} onNavigate={() => setOpen(false)} />
                  ) : (
                    m.content
                  )
                ) : (
                  <span className="qc-dim">{t.typing}</span>
                )}
              </div>
            ))}
            {!busy && suggestions.length > 0 && (
              <div className="qc-sugs">
                {suggestions.map((q) => (
                  <button type="button" key={q} onClick={() => send(q)} className="qc-sug">
                    {q}
                  </button>
                ))}
              </div>
            )}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="qc-form"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t.placeholder}
              maxLength={2000}
              className="qc-in"
              aria-label={t.placeholder}
            />
            <button disabled={busy} className="qc-send">
              {t.send}
            </button>
          </form>
        </div>
      )}
      <button
        type="button"
        onClick={toggle}
        className="qc-btn"
        style={buttonStyle}
        aria-label={icon ? (open ? t.closeChat : t.open) : undefined}
        title={icon ? (open ? t.closeChat : t.open) : undefined}
      >
        {icon ? (
          open ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          ) : (
            icon
          )
        ) : open ? (
          t.closeChat
        ) : (
          t.open
        )}
      </button>
    </div>
  );
}
