# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Region Position Engine

The optional room-detection mode keeps the existing raw flow unchanged:

```text
POST http://localhost:3000/api/tracking/ingest
  -> raw SSE http://localhost:3000/api/tracking/ingest
```

When **Oda Tespit Modu** is enabled from the Regions panel, the backend reads
`config/regions.json` once, builds world-coordinate polygon indexes, consumes
the same raw events in memory, and publishes resolved positions over a separate
SSE endpoint:

```text
processed SSE http://localhost:3001/api/tracking/ingest
```

The browser closes its previous EventSource before switching between raw and
processed feeds. Raw coordinates remain unchanged in persistence; a vehicle
confirmed inside a room is represented at `roomCenter.world` only in the
processed message. Added fields (`positionSource`, `regionInference`,
`rawPosition`, and `lastRawDataTimestamp`) are optional extensions to the
existing `tagCode`, `x`, `y`, `timestamp` schema.

Copy the values from `.env.example` into `.env.local` as needed. Defaults are:

- `RAW_POSITION_PORT=3000`
- `REGION_POSITION_PORT=3001`
- `REGION_BROADCAST_INTERVAL_MS=1000`
- `REGION_POSITION_ALLOWED_ORIGIN=*`

In local vinext development the lightweight SSE output listener reserves the
processed port at startup, so an occupied port fails fast with a clear error;
it runs no scheduler until a processed client connects. In a regular Node
runtime the controller binds it on activation and enabling returns HTTP 409 if
the port is occupied. Region inference, vehicle state, and periodic broadcasts
run only while the mode is active. Status is controlled through:

```http
GET /api/region-engine/status
PUT /api/region-engine/status
Content-Type: application/json

{"enabled":true}
```

Region inference tuning lives at the top level of `config/regions.json`:

```json
{
  "engine": {
    "entryConfirmationCount": 2,
    "exitConfirmationCount": 2,
    "exitMarginMeters": 0.5
  }
}
```

Run the raw-ingest, engine state-machine, scheduler, and port-conflict tests
with `npm run test:tracking`.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
