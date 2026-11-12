import { createHmac, timingSafeEqual } from "node:crypto";
import * as nextServer from "next/server";
import { hasNotrackCookie, visitorFrom, visitorHeaders } from "@qviks/track/server";
/**
 * Work after the response: Next `after()` keeps the function alive until it finished. Outside a request
 * scope (tests, Next without after) it is awaited instead, never left floating.
 */
async function runAfter(fn) {
    const after = nextServer.after;
    const safe = async () => {
        try {
            await fn();
        }
        catch (err) {
            console.error("[qviks-chat] onError failed:", err instanceof Error ? err.message : err);
        }
    };
    if (after) {
        try {
            after(safe);
            return;
        }
        catch { }
    }
    await safe();
}
const EN = {
    rateLimited: "You've sent a lot of messages in a short time. Please leave your details in the form on this page and we'll get back to you.",
    down: "The assistant is taking a break right now. Please leave your details in the form on this page and we'll get back to you.",
    cutOff: "\n\nSorry, I got cut off. Please try again.",
};
const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const QVIKS_TIMEOUT_MS = 5000;
const OPENAI_TIMEOUT_MS = 60_000;
const MAX_TURNS = 20;
const MAX_CHARS = 2000;
// History comes from the client, so cap the whole payload, not just each message.
const MAX_TOTAL_CHARS = 8000;
const SESSION_ID = /^[\w-]{8,64}$/;
const DEFAULT_LIMITS = [
    { max: 30, windowMs: 60 * 60_000 },
    { max: 150, windowMs: 24 * 60 * 60_000 },
];
const text = (body, status, headers = {}) => new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const str = (v, max) => (typeof v === "string" && v ? v.slice(0, max) : undefined);
const hostOf = (req) => (req.headers.get("host") || new URL(req.url).host).toLowerCase();
/* ─── Rate limit ────────────────────────────────────────────────────────── */
function rateLimiter(limits) {
    const hits = new Map();
    const longest = Math.max(...limits.map((l) => l.windowMs));
    return function limited(ip) {
        const now = Date.now();
        const recent = (hits.get(ip) ?? []).filter((t) => now - t < longest);
        if (limits.some((l) => recent.filter((t) => now - t < l.windowMs).length >= l.max)) {
            hits.set(ip, recent);
            return true;
        }
        recent.push(now);
        hits.set(ip, recent);
        if (hits.size > 10_000)
            hits.clear(); // bound memory on a long-lived instance
        return false;
    };
}
/* ─── Human check (invisible Turnstile) ─────────────────────────────────── */
/*
 * The first message of a visitor has no pass, so the handler answers 428 with
 * the site key; the widget gets a Turnstile token and resends. The token is
 * verified once, then an HMAC-signed cookie lets the visitor chat for PASS_TTL.
 * Env: TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY (or the `turnstile` option). Without keys the check is off.
 */
export const HUMAN_COOKIE = "chat_pass";
const PASS_TTL = 6 * 60 * 60; // seconds
function envKeys() {
    const siteKey = process.env.TURNSTILE_SITE_KEY;
    const secret = process.env.TURNSTILE_SECRET_KEY;
    return siteKey && secret ? { siteKey, secret } : null;
}
/** True when the env keys are set (sites with per-request keys pass `turnstile` instead). */
export const humanCheckEnabled = () => !!envKeys();
const sign = (secret, exp) => createHmac("sha256", secret).update(`chat:${exp}`).digest("base64url");
function hasPass(req, secret) {
    const raw = req.headers.get("cookie")?.match(/(?:^|;\s*)chat_pass=(\d+)\.([\w-]+)/);
    if (!raw)
        return false;
    const exp = Number(raw[1]);
    if (!(exp > Date.now() / 1000))
        return false;
    const a = Buffer.from(raw[2]);
    const b = Buffer.from(sign(secret, exp));
    return a.length === b.length && timingSafeEqual(a, b);
}
function passCookie(secret) {
    const exp = Math.floor(Date.now() / 1000) + PASS_TTL;
    return `${HUMAN_COOKIE}=${exp}.${sign(secret, exp)}; Path=/api/chat; Max-Age=${PASS_TTL}; HttpOnly; Secure; SameSite=Strict`;
}
async function verifyToken(secret, token, ip) {
    if (typeof token !== "string" || !token || token.length > 4096)
        return false;
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip)
        form.append("remoteip", ip);
    try {
        const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
            method: "POST",
            body: form,
            signal: AbortSignal.timeout(5000),
        });
        const data = (await res.json());
        return data.success === true;
    }
    catch {
        return false;
    }
}
/**
 * Opens an OpenAI chat completion stream. Throws (with the error code) when OpenAI
 * refuses: no credit, bad key, outage. Awaited BEFORE the Response is built, so such a
 * failure answers 503 and the widget can ask the visitor for an e-mail instead.
 */
async function openOpenai(opts) {
    const res = await fetch(OPENAI_URL, {
        method: "POST",
        signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${opts.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: opts.model, max_tokens: opts.maxTokens, stream: true, messages: opts.messages }),
    });
    if (!res.ok || !res.body) {
        let reason = `${res.status}`;
        try {
            const err = (await res.json());
            reason = [err.error?.code, res.status, err.error?.message].filter(Boolean).join(" · ");
        }
        catch { }
        throw new Error(reason);
    }
    return res.body.getReader();
}
/** Yields the text deltas of an opened OpenAI stream (SSE). */
async function* readDeltas(reader) {
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
            const data = line.startsWith("data:") ? line.slice(5).trim() : "";
            if (!data || data === "[DONE]")
                continue;
            try {
                const delta = JSON.parse(data).choices?.[0]?.delta?.content;
                if (delta)
                    yield delta;
            }
            catch { }
        }
    }
}
/* ─── POST /api/chat ────────────────────────────────────────────────────── */
/**
 * Body from the widget: { session_id, messages: [{ role, content }], path?, locale?,
 * referrer?, utm_source?, utm_medium?, utm_campaign?, visitor_id?, wd?, turnstile?, site? }.
 * Answers: 200 text stream, 403 foreign origin, 404 no assistant, 413, 400,
 * 428 { turnstile: siteKey } (human check needed), 429 / 503 with the site's reply text
 * (on both the widget shows a name + e-mail card and posts the question to its lead endpoint).
 */
export function createChatHandler(opts) {
    const limited = rateLimiter(opts.limits ?? DEFAULT_LIMITS);
    return async function POST(req) {
        const len = Number(req.headers.get("content-length") || 0);
        if (len > 32_768)
            return text("Too large", 413);
        // Browsers always send Origin on a fetch POST; plain scripts usually don't.
        let originHost = null;
        try {
            originHost = new URL(req.headers.get("origin") ?? "").host.toLowerCase();
        }
        catch { }
        if (originHost !== hostOf(req))
            return text("Forbidden", 403);
        const body = (await req.json().catch(() => null));
        if (!body || typeof body !== "object" || Array.isArray(body))
            return text("Bad request", 400);
        const assistant = typeof opts.assistant === "function" ? opts.assistant(req, body) : opts.assistant;
        if (!assistant)
            return text("Not found", 404);
        const replies = { ...EN, ...assistant.replies };
        const history = (Array.isArray(body.messages) ? body.messages : [])
            .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
            .slice(-MAX_TURNS)
            .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
        let total = history.reduce((n, m) => n + m.content.length, 0);
        while (history.length > 1 && total > MAX_TOTAL_CHARS)
            total -= history.shift().content.length;
        const question = history.at(-1);
        if (question?.role !== "user")
            return text("Bad request", 400);
        const visitor = visitorFrom(req);
        if (visitor.ip && limited(visitor.ip))
            return text(replies.rateLimited, 429);
        const openaiKey = opts.openaiKey ?? process.env.OPENAI_API_KEY;
        if (!openaiKey) {
            if (opts.onError)
                await runAfter(() => opts.onError("OPENAI_API_KEY is not set"));
            return text(replies.down, 503);
        }
        // Invisible Turnstile once per visitor, then a signed cookie (bots burning OpenAI credit).
        const headers = {};
        const keys = opts.turnstile ? opts.turnstile(req, body) : envKeys();
        if (keys && !hasPass(req, keys.secret)) {
            if (!(await verifyToken(keys.secret, body.turnstile, visitor.ip))) {
                return Response.json({ turnstile: keys.siteKey }, { status: 428, headers: { "Cache-Control": "no-store" } });
            }
            headers["Set-Cookie"] = passCookie(keys.secret);
        }
        const locale = str(body.locale, 16);
        const sessionId = typeof body.session_id === "string" && SESSION_ID.test(body.session_id) ? body.session_id : null;
        const optedOut = hasNotrackCookie(req.headers.get("cookie"));
        // Best-effort history in Qviks. Awaited before the stream closes: a serverless
        // function freezes once the response ends.
        async function logTurn(answer) {
            const key = typeof opts.key === "function" ? opts.key(req, body) : opts.key;
            const base = (opts.apiUrl ?? process.env.QVIKS_API_URL)?.replace(/\/+$/, "");
            if (!sessionId || !key || !base)
                return;
            try {
                const res = await fetch(`${base}/api/v1/chats`, {
                    method: "POST",
                    signal: AbortSignal.timeout(QVIKS_TIMEOUT_MS),
                    cache: "no-store",
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                        // Opted out of tracking: the chat is not tied to past visits either.
                        ...visitorHeaders(optedOut ? { ...visitor, id: null } : visitor),
                        Authorization: `Bearer ${key}`,
                    },
                    body: JSON.stringify({
                        session_id: sessionId,
                        question: question.content,
                        answer: answer || undefined,
                        path: str(body.path, 512),
                        locale,
                        referrer: str(body.referrer, 512),
                        utm_source: str(body.utm_source, 128),
                        utm_medium: str(body.utm_medium, 128),
                        utm_campaign: str(body.utm_campaign, 128),
                        visitor_id: optedOut ? undefined : str(body.visitor_id, 64),
                        wd: body.wd === true,
                    }),
                });
                if (!res.ok)
                    console.error(`[qviks-chat] history not saved: ${res.status} ${await res.text()}`);
            }
            catch (err) {
                console.error("[qviks-chat] history failed:", err instanceof Error ? err.message : err);
            }
        }
        const reminder = assistant.reminder?.({ locale });
        const messages = [
            { role: "system", content: assistant.system({ locale }) },
            ...history,
            ...(reminder ? [{ role: "system", content: reminder }] : []),
        ];
        const openai = { key: openaiKey, model: opts.model ?? "gpt-4.1-mini", maxTokens: opts.maxTokens ?? 600, messages };
        // OpenAI refused (no credit, bad key, outage): 503 + the site's `down` reply. The widget
        // then asks for name + e-mail and sends the question as a lead, so it is not lost.
        let reader;
        try {
            reader = await openOpenai(openai);
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            console.error("[qviks-chat] OpenAI:", reason);
            if (opts.onError)
                await runAfter(() => opts.onError(reason));
            await logTurn("");
            return text(replies.down, 503, headers);
        }
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                let answer = "";
                try {
                    for await (const delta of readDeltas(reader)) {
                        answer += delta;
                        controller.enqueue(encoder.encode(delta));
                    }
                }
                catch (err) {
                    const reason = err instanceof Error ? err.message : String(err);
                    console.error("[qviks-chat] OpenAI stream:", reason);
                    controller.enqueue(encoder.encode(answer ? replies.cutOff : replies.down));
                    // Still inside the response (the stream is open), so awaiting keeps the function alive.
                    try {
                        await opts.onError?.(reason);
                    }
                    catch { }
                }
                finally {
                    await logTurn(answer);
                    controller.close();
                }
            },
        });
        return new Response(stream, {
            headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
        });
    };
}
