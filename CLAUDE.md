# qviks-chat

Package `@qviks/chat`: website AI assistant (chat widget + streaming `/api/chat` handler), history stored in Qviks.
README.md is the full spec; read it first. Sibling of `../qviks-track` (`@qviks/track`, analytics + forms), which it
depends on for the visitor id and visitor headers. One repo = one package (installed from GitHub by tag).

- Source: `src/client.tsx` (widget, Turnstile loader), `src/server.ts` (handler, rate limit, human check, OpenAI SSE).
  Tests: `src/server.test.ts`. Build: `bun run build` (output in `dist/`, committed).
- Consumers (installed from GitHub by tag, `github:meacoolash/qviks-chat#vX.Y.Z`): `../sites` (own look via `useChat` in
  `src/components/ChatWidget.tsx`, anka + dagmar use `ChatWidget`), `../mikistec` (own look via `useChat`), `../kocakova`.
  `../naskoc` still vendors `vendor/qviks-chat-1.2.0.tgz`. joymeseci.com runs on `sites`: never ship a breaking change.
- Release: bump version, build, commit, tag `vX.Y.Z`, push tag, then bump the tag in each consumer.
- Qviks side: `../qviks` `/api/v1/chats` (keeps history only; prompt, model and limits live here and in the sites).
