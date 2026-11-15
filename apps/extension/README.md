# StudyVault Focus Blocker

This standalone Chrome Manifest V3 extension blocks main-frame navigations to a user-managed list of domains. It uses `declarativeNetRequest` dynamic rules and `chrome.storage.local`; it does not read page contents or block subresources.

## Build and load

Run `npm test` for the Node built-in unit tests. Load the `apps/extension` directory in `chrome://extensions` with Developer mode enabled for a local development build. The source manifest allows web messaging from `http://localhost` and `http://127.0.0.1` on any port. Block rules are installed only while a focus session is active and are removed on completion or expiration.

To enable web-to-extension focus syncing locally, copy the extension ID shown in `chrome://extensions` into `NEXT_PUBLIC_STUDYVAULT_EXTENSION_ID` in `apps/web/.env.local`, then restart the web dev server. Set the same variable to the published extension ID in the production web environment.

For a production build, pass a comma-separated list of exact HTTPS origins. Each origin may include a non-default port, and must not include a path. Production builds include only those origins; loopback matches are omitted:

```powershell
$env:EXTENSION_ALLOWED_ORIGINS = 'https://studyvault.example,https://study.example:8443'
npm run build
```

Load `dist/` as the unpacked extension. The build writes the configured hosts into `externally_connectable.matches` and embeds the same production origin list for exact runtime checks. Chrome match patterns can cover all ports when no port is specified, so the service worker also compares the sender's normalized origin against that exact list. Leave `EXTENSION_ALLOWED_ORIGINS` unset for a development-only build, which allows loopback origins. Do not use wildcard hosts.

## Web focus-session message

The web app may send the following message to the installed extension with `chrome.runtime.sendMessage(extensionId, message)`. Only messages whose `sender.url` origin is allowlisted are considered. Every message includes a `sentAt` epoch-millisecond timestamp; the extension validates the exact type, version, UUID session id when present, active flag, and an end time no more than four hours ahead. Persisted update timestamps prevent delayed messages from an older tab from overriding newer focus state.

Start or restore a running session:

```js
{
  type: 'studyvault.focus-session.v1',
  version: 1,
  sessionId: '<focus session UUID>',
  active: true,
  expectedEndAt: '<server expected_end_at ISO timestamp>',
  sentAt: Date.now()
}
```

End the currently locked session early:

```js
{
  type: 'studyvault.focus-session.v1',
  version: 1,
  sessionId: '<same focus session UUID>',
  active: false,
  expectedEndAt: null,
  sentAt: Date.now()
}
```

A server-confirmed snapshot with no running session uses `sessionId: null` and the same inactive shape. Its newer `sentAt` clears an old persisted lock; an older snapshot cannot overwrite a later one.

An end message only clears the lock when its session id matches. The extension persists the lock and schedules expiration from the server-provided end time, so worker suspension or a missed completion message does not leave the list locked forever. While active, popup add/remove operations are rejected in the service worker as well as disabled visually.

Blocking is a study nudge, not enforcement: a user can disable or remove an extension, and a first-party origin check does not prove that a web app message reflects a real server session. The web app remains authoritative for session and reward state.

## Browser smoke test

`npm run smoke` builds the development manifest, launches Chromium with `dist/` loaded, adds `localhost` through the popup, sends a focus start from a local web page, verifies a main-frame navigation is blocked, sends the matching end message, and verifies the navigation succeeds. It uses the repository's installed Playwright package at `apps/web/node_modules/@playwright/test`.
