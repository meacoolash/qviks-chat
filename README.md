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
bun add github:meacoolash/qviks-chat#v1.0.0
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

One app serving many sites: `assistant: (req, body) => ASSISTANTS[body.site]` and `key: (req, body) => ...`.
Alerts when OpenAI fails: `onError: (reason) => sendMail(...)` (throttle on your side).

## When the assistant is down

OpenAI refused (no credit, bad key, outage) = `503` + the site's `down` reply, before any stream; rate limit = `429`.
On both the widget shows a name + e-mail card under the reply and posts the visitor's questions to `leadEndpoint`
(default `/api/lead`, e.g. `@qviks/track` `createLeadHandler`) as `{ site, name, email, message, topic: leadTopic
("AI chat"), source: "lead_form", hp_url, locale, elapsedMs, turnstile? }`; a `428` or `400 { error: "turnstile",
turnstile }` answer is retried once with a Turnstile token. Labels: `leadName`, `leadEmail`, `leadSend`, `leadSent`,
`leadError` (in `SK_LABELS`). Write the `down` / `rateLimited` replies so they point at the card ("Nechajte tu svoje
meno a e-mail..."), not at a form elsewhere on the page.

## Exports

| Path | |
|---|---|
| `@qviks/chat` (client) | `ChatWidget`, `SK_LABELS`, types `ChatWidgetProps`, `ChatLabels` (props `leadEndpoint`, `leadTopic` since 1.1.0) |
| `@qviks/chat/server` | `createChatHandler`, `humanCheckEnabled`, `HUMAN_COOKIE`, types `Assistant`, `ChatReplies`, `ChatHandlerOptions` |

## Develop

`bun test`, then `bun run build` and commit `dist/` (installed from git, no build on install).
Release: bump `version`, tag `vX.Y.Z`, push the tag, bump the `#vX.Y.Z` in each project.
