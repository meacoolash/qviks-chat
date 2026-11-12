# @qviks/chat

AI assistant for our Next.js sites: a chat bubble + a streaming route handler. Conversations are stored in
[Qviks](https://www.qviks.com) (Chats), tied to the visitor's visits when the site also uses `@qviks/track`.

- **Answer**: OpenAI (default `gpt-4.1-mini`) streamed as plain text. Knowledge + rules = the site's own `system` prompt.
- **History**: each finished turn goes to Qviks `POST /api/v1/chats` with the org key. Best-effort: Qviks down =
  the visitor still gets the answer.
- **Bots**: same-origin check, per-IP limits (30/hour, 150/day per warm instance), invisible Cloudflare Turnstile
  once per visitor, then a signed cookie for 6 hours.
- **Owner opt-out**: with the `qviks_no_track` cookie (switch at www.qviks.com/notrack) the chat is not tied to visits.
- **Widget**: own styles (no Tailwind needed), conversation kept in sessionStorage, suggestions, optional
  `[label](url)` links, Slovak labels ready (`SK_LABELS`).

No secrets live here: keys come from each project's environment.

## Install

```sh
bun add github:meacoolash/qviks-chat#v1.3.0
```

Env (server only): `OPENAI_API_KEY`, `QVIKS_API_URL` + the org key (e.g. `QVIKS_API_KEY`) for history,
`TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` for the human check (both empty = off).

## Wire up

```ts
// app/api/chat/route.ts
import { createChatHandler } from "@qviks/chat/server";
import { assistant } from "./assistant"; // { system: ({ locale }) => string, replies?: { rateLimited, down, cutOff } }
export const runtime = "nodejs";
export const POST = createChatHandler({ assistant, key: process.env.QVIKS_API_KEY });
```

```tsx
// any page (client component)
import { ChatWidget, SK_LABELS } from "@qviks/chat";
<ChatWidget site="mysite" name="Jana" greeting="Dobrý deň..." suggestions={["..."]} accent="#2f6f5e" labels={SK_LABELS} links />
```

One app serving many sites: `assistant: (req, body) => ASSISTANTS[body.site]`, `key: (req, body) => ...` and, when
each site has its own Turnstile widget, `turnstile: (req, body) => ({ siteKey, secret })` (default: the env keys).
Alerts when OpenAI fails: `onError: (reason) => sendMail(...)` (runs after the response via Next `after()`; throttle
on your side). `assistant.reminder: ({ locale }) => "..."` is sent once more as the last system message.

## When the assistant is down

OpenAI refused (no credit, bad key, outage) = `503` + the site's `down` reply, before any stream; rate limit = `429`.
On both the widget shows a name + e-mail card under the reply and posts the visitor's questions to `leadEndpoint`
(default `/api/lead`, e.g. `@qviks/track` `createLeadHandler`) as `{ site, name, email, message, topic: leadTopic
("AI chat"), source: "lead_form", hp_url, locale, elapsedMs, turnstile? }`; a `428` or `400 { error: "turnstile",
turnstile }` answer is retried once with a Turnstile token. Labels: `leadName`, `leadEmail`, `leadSend`, `leadSent`,
`leadError` (in `SK_LABELS`). Write the `down` / `rateLimited` replies so they point at the card ("Nechajte tu svoje
meno a e-mail..."), not at a form elsewhere on the page.

## When the assistant does not know (since 1.2.0)

Pass `leadMarker` (e.g. `"[[kontakt]]"`) and tell the model in the prompt to end a reply with it when it does not know
the answer or the visitor wants to be contacted. The widget hides the marker (also while it streams in) and shows the
same name + e-mail card. The saved Qviks history still contains the marker.

## Lead linked to the chat (since 1.3.0)

The card's lead carries `chat_session_id` (the chat's session id). A site relay that forwards it to Qviks
`POST /api/v1/leads` lets Qviks put the lead's contact on the chat (admin Chats shows who wrote) and mail the owner
the whole conversation (questions and answers) instead of only the questions. Older Qviks ignore the field.

## Own look (since 1.3.0)

`useChat({ site, suggestions, labels?, endpoint?, leadEndpoint?, leadTopic?, leadMarker?, locale?, persist?, sendLead? })`
is the widget without markup: `{ open, setOpen, toggle, openChat, messages, input, setInput, busy, send, suggestions,
lead, sendLead(form), listRef }`. A site with its own design renders its markup on top of it, so the logic (stream,
human check, card, marker, session) stays here. `sendLead` replaces the built-in POST (e.g. a site's form relay).

## Exports

| Path | |
|---|---|
| `@qviks/chat` (client) | `ChatWidget`, `useChat`, `SK_LABELS`, types `ChatWidgetProps`, `ChatLabels`, `ChatLead`, `UseChatOptions` (props `leadEndpoint`, `leadTopic` since 1.1.0, `leadMarker` since 1.2.0, `useChat` + `sendLead` since 1.3.0) |
| `@qviks/chat/server` | `createChatHandler`, `humanCheckEnabled`, `HUMAN_COOKIE`, types `Assistant`, `ChatReplies`, `ChatHandlerOptions`, `TurnstileKeys` (options `turnstile`, `reminder` since 1.3.0) |

## Develop

`bun test`, then `bun run build` and commit `dist/` (installed from git, no build on install).
Release: bump `version`, tag `vX.Y.Z`, push the tag, bump the `#vX.Y.Z` in each project.
