# Stream Team Spotlight Extension

Unified Twitch Extension product containing:

- Panel Extension (Team Hub)
- Overlay Extension (On-Stream Spotlight)
- Config/Dashboard surface for broadcasters
- Shared backend for triggers, shared-team computation, and payload delivery

## Workspace Layout

- `apps/backend` API + trigger orchestration
- `apps/panel` Panel Extension frontend
- `apps/overlay` Overlay Extension frontend
- `apps/config` Broadcaster configuration frontend
- `packages/shared` Shared contracts and domain types

## Quick Start

1. `npm install`
2. `npm run dev`

## First-Time Onboarding (Any Broadcaster)

1. Open the Config app and enter:
	- Broadcaster ID (Twitch login)
	- Display name
	- Primary team name
2. Click **Activate Extension**.
3. The app stores the active broadcaster in local storage under `st-active-broadcaster`.
4. Open Panel/Overlay with `?b=<broadcasterId>` (or rely on stored broadcaster) to load that channel.

Example URLs during local development:

- `http://localhost:5173/?b=streamerone` (Config)
- `http://localhost:5174/?b=streamerone` (Panel)
- `http://localhost:5175/?b=streamerone` (Overlay)

## MVP Progress

- [x] Unified monorepo scaffold
- [x] Manual spotlight trigger end-to-end
- [x] Shoutout event ingestion path (backend webhook scaffold)
- [x] Shared team detection UI surfaces
- [x] Broadcaster self-serve onboarding flow

## Legal

- Terms of Service: `TERMS_OF_SERVICE.md`
- Privacy Policy: `PRIVACY_POLICY.md`

For Twitch Extension submission, publish hosted URLs for both legal documents.

### Host Legal Docs on GitHub Pages

This repo includes a ready-to-deploy static legal site in `legal-site/` and a workflow in `.github/workflows/deploy-legal-pages.yml`.

1. Push this repository to GitHub.
2. In GitHub, go to **Settings -> Pages**.
3. Set **Build and deployment** to **GitHub Actions**.
4. Push to `main` (or run the workflow manually from **Actions**).

After deploy, your legal URLs will be:

- `https://<github-username>.github.io/<repo-name>/terms-of-service.html`
- `https://<github-username>.github.io/<repo-name>/privacy-policy.html`

Use those two URLs in your Twitch Extension listing.
