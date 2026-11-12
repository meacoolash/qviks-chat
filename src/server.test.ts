import { afterEach, describe, expect, it } from "bun:test";
import { createChatHandler, type Assistant } from "./server";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TURNSTILE_SITE_KEY;
  delete process.env.TURNSTILE_SECRET_KEY;
});

const assistant: Assistant = { system: ({ locale }) => `prompt ${locale ?? "-"}`, replies: { down: "pauza" } };

function chatReq(body: unknown, opts: { origin?: string; ip?: string; cookie?: string } = {}) {
  return new Request("https://example.sk/api/chat", {
    method: "POST",
    headers: {
      host: "example.sk",
      origin: opts.origin ?? "https://example.sk",
      "x-forwarded-for": opts.ip ?? "1.2.3.4",
      "content-type": "application/json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

const ask = { session_id: "abcdefgh-1234", messages: [{ role: "user", content: "Ahoj?" }], locale: "sk", path: "/x" };

/** Fake OpenAI (SSE) + Qviks; records calls. */
function fakeFetch(deltas: string[], openaiStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("openai.com")) {
      if (openaiStatus !== 200) return Response.json({ error: { code: "insufficient_quota", message: "no credit" } }, { status: openaiStatus });
      const sse = deltas.map((d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`).join("") + "data: [DONE]\n\n";
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({ ok: true }, { status: 201 });
  }) as typeof fetch;
  return calls;
}

describe("createChatHandler", () => {
  it("streams the answer and stores the turn in Qviks", async () => {
    const calls = fakeFetch(["Dobrý ", "deň."]);
    const POST = createChatHandler({ assistant, key: "k1", apiUrl: "https://q.test", openaiKey: "sk-test" });
    const res = await POST(chatReq(ask));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("Dobrý deň.");
    const openai = JSON.parse(String(calls[0].init?.body));
    expect(openai.messages[0]).toEqual({ role: "system", content: "prompt sk" });
    expect(calls[1].url).toBe("https://q.test/api/v1/chats");
    const turn = JSON.parse(String(calls[1].init?.body));
    expect(turn).toMatchObject({ session_id: "abcdefgh-1234", question: "Ahoj?", answer: "Dobrý deň.", path: "/x", locale: "sk" });
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe("Bearer k1");
  });

  it("rejects a foreign origin", async () => {
    const POST = createChatHandler({ assistant, openaiKey: "sk-test" });
    expect((await POST(chatReq(ask, { origin: "https://evil.test" }))).status).toBe(403);
  });

  it("404 when the resolver has no assistant", async () => {
    const POST = createChatHandler({ assistant: () => null, openaiKey: "sk-test" });
    expect((await POST(chatReq(ask))).status).toBe(404);
  });

  it("503 + site reply + onError when OpenAI refuses", async () => {
    fakeFetch([], 429);
    const reasons: string[] = [];
    const POST = createChatHandler({ assistant, openaiKey: "sk-test", onError: (r) => void reasons.push(r) });
    const res = await POST(chatReq(ask));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("pauza");
    expect(reasons[0]).toContain("insufficient_quota");
  });

  it("rate limits per IP", async () => {
    fakeFetch(["ok"]);
    const POST = createChatHandler({ assistant, openaiKey: "sk-test", limits: [{ max: 1, windowMs: 60_000 }] });
    expect((await POST(chatReq(ask, { ip: "9.9.9.9" }))).status).toBe(200);
    expect((await POST(chatReq(ask, { ip: "9.9.9.9" }))).status).toBe(429);
  });

  it("asks for the human check (428) when Turnstile is configured", async () => {
    process.env.TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret";
    fakeFetch(["ok"]);
    const POST = createChatHandler({ assistant, openaiKey: "sk-test" });
    const res = await POST(chatReq(ask));
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual({ turnstile: "site-key" });
  });

  it("opted-out visitor: no visitor id sent to Qviks", async () => {
    const calls = fakeFetch(["ok"]);
    const POST = createChatHandler({ assistant, key: "k1", apiUrl: "https://q.test", openaiKey: "sk-test" });
    await (await POST(chatReq({ ...ask, visitor_id: "vid-12345678" }, { cookie: "qviks_no_track=1; qviks_vid=vid-12345678" }))).text();
    const turn = JSON.parse(String(calls[1].init?.body));
    expect(turn.visitor_id).toBeUndefined();
    expect((calls[1].init?.headers as Record<string, string>)["x-qviks-visitor-id"]).toBeUndefined();
  });

  it("per-request Turnstile keys: 428 with that site's key, a valid pass cookie skips the check", async () => {
    const calls = fakeFetch(["ok"]);
    const POST = createChatHandler({
      assistant,
      openaiKey: "sk-test",
      turnstile: (_req, body) => (body.site === "a" ? { siteKey: "key-a", secret: "secret-a" } : null),
    });
    const res = await POST(chatReq({ ...ask, site: "a" }));
    expect(res.status).toBe(428);
    expect(await res.json()).toEqual({ turnstile: "key-a" });
    // Site without keys: no check.
    expect((await POST(chatReq({ ...ask, site: "b" }))).status).toBe(200);
    // Same cookie format as before (chat_pass=<exp>.<hmac of chat:<exp>>), so passes from older code keep working.
    const { createHmac } = await import("node:crypto");
    const exp = Math.floor(Date.now() / 1000) + 600;
    const cookie = `chat_pass=${exp}.${createHmac("sha256", "secret-a").update(`chat:${exp}`).digest("base64url")}`;
    expect((await POST(chatReq({ ...ask, site: "a" }, { cookie, ip: "5.5.5.5" }))).status).toBe(200);
    expect(calls.some((c) => c.url.includes("siteverify"))).toBe(false);
  });

  it("reminder goes last, after the conversation", async () => {
    const calls = fakeFetch(["ok"]);
    const POST = createChatHandler({ assistant: { ...assistant, reminder: ({ locale }) => `reply in ${locale}` }, openaiKey: "sk-test" });
    await (await POST(chatReq(ask, { ip: "6.6.6.6" }))).text();
    const openai = JSON.parse(String(calls[0].init?.body));
    expect(openai.messages.at(-1)).toEqual({ role: "system", content: "reply in sk" });
    expect(openai.messages.at(-2)).toEqual({ role: "user", content: "Ahoj?" });
  });

  it("missing OpenAI key: 503 and onError is awaited outside a request scope", async () => {
    const reasons: string[] = [];
    const POST = createChatHandler({ assistant, openaiKey: "", onError: async (r) => void reasons.push(r) });
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const res = await POST(chatReq(ask, { ip: "7.7.7.7" }));
    if (prev) process.env.OPENAI_API_KEY = prev;
    expect(res.status).toBe(503);
    expect(reasons).toEqual(["OPENAI_API_KEY is not set"]);
  });
});
