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
    /** Name + e-mail card shown when the assistant is down (503) or the visitor is rate limited (429). */
    leadName: string;
    leadEmail: string;
    leadSend: string;
    leadSent: string;
    leadError: string;
};
/** Slovak labels, ready to pass as `labels`. */
export declare const SK_LABELS: ChatLabels;
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
    /**
     * Where the name + e-mail card posts when the assistant is down or rate limited. Default: /api/lead
     * (@qviks/track createLeadHandler or the site's own lead relay). Body: { site, name, email, message (the
     * visitor's questions), topic, source: "lead_form", hp_url, locale, elapsedMs, turnstile? }; a 428 or
     * 400 { error: "turnstile", turnstile: siteKey } answer is retried once with a Turnstile token.
     */
    leadEndpoint?: string;
    /** `topic` of that lead (goes into the owner's e-mail subject). Default: "AI chat". */
    leadTopic?: string;
    /**
     * Optional token (e.g. "[[kontakt]]") the site's prompt tells the model to put at the end of a reply when it does not
     * know the answer or the visitor wants to be contacted. The widget hides it and shows the same name + e-mail card.
     */
    leadMarker?: string;
};
type Turnstile = {
    render: (el: HTMLElement, opts: Record<string, unknown>) => string;
    remove: (id: string) => void;
};
declare global {
    interface Window {
        turnstile?: Turnstile;
    }
}
export declare function ChatWidget({ site, name, greeting, suggestions: all, accent, labels, links, rewriteLink, buttonStyle, icon, endpoint, leadEndpoint, leadTopic, leadMarker, }: ChatWidgetProps): import("react/jsx-runtime").JSX.Element;
export {};
