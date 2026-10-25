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
export declare function ChatWidget({ site, name, greeting, suggestions: all, accent, labels, links, rewriteLink, buttonStyle, icon, endpoint, }: ChatWidgetProps): import("react/jsx-runtime").JSX.Element;
export {};
