export type ChatReplies = {
    /** Too many messages from one IP. */
    rateLimited: string;
    /** OpenAI down, out of credit or no key. */
    down: string;
    /** Appended when the stream broke mid-answer. */
    cutOff: string;
};
export type Assistant = {
    /** System prompt (knowledge + rules), built per request so it can use today's date or the page locale. */
    system: (ctx: {
        locale?: string;
    }) => string;
    /** Server replies in the site's language; missing ones fall back to English. */
    replies?: Partial<ChatReplies>;
};
type KeyOption = string | undefined | ((req: Request, body: Record<string, unknown>) => string | null | undefined);
export type ChatHandlerOptions = {
    /** The assistant, or a resolver (one app serving many sites, per-locale prompts). null = 404. */
    assistant: Assistant | ((req: Request, body: Record<string, unknown>) => Assistant | null | undefined);
    /** Qviks API v1 key of the site's org, for the chat history. Missing = answer still works, no history. */
    key?: KeyOption;
    /** Qviks base URL. Default: process.env.QVIKS_API_URL. */
    apiUrl?: string;
    /** Default: process.env.OPENAI_API_KEY. */
    openaiKey?: string;
    /** Default: gpt-4.1-mini. */
    model?: string;
    /** Default: 600. */
    maxTokens?: number;
    /** Per-IP limits, in memory per warm instance. Default: 30/hour and 150/day. */
    limits?: {
        max: number;
        windowMs: number;
    }[];
    /**
     * Called when OpenAI fails (missing key, no credit, outage), e.g. to send an alert mail.
     * Not awaited by the visitor's answer; throttle on your side.
     */
    onError?: (reason: string) => void | Promise<void>;
};
export declare const HUMAN_COOKIE = "chat_pass";
export declare const humanCheckEnabled: () => boolean;
/**
 * Body from the widget: { session_id, messages: [{ role, content }], path?, locale?,
 * referrer?, utm_source?, utm_medium?, utm_campaign?, visitor_id?, wd?, turnstile?, site? }.
 * Answers: 200 text stream, 403 foreign origin, 404 no assistant, 413, 400,
 * 428 { turnstile: siteKey } (human check needed), 429 / 503 with the site's reply text.
 */
export declare function createChatHandler(opts: ChatHandlerOptions): (req: Request) => Promise<Response>;
export {};
