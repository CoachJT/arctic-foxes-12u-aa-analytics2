# Arctic Foxes 12U AA Analytics

Arctic Foxes 12U AA Analytics is a Windows Electron application for local hockey video analysis and coaching workflows. This repository now also contains a **separate local web prototype** for the future cloud/team-facing experience.

## Web prototype

Open `web/index.html` in a browser, or serve the repository with any static file server and visit `/web/`. The prototype includes:

- Command Center with next game, season record, team performance, leaders, recent games, and trends
- Schedule, Team Stats, and Player Profiles views
- Game Center, Scouting, Coach Reports, Admin, and Settings surfaces
- Responsive layouts for desktop, iPad, and iPhone
- A visual Accounts, Roles & Permissions model, including future Player/Parent access

All displayed team data is clearly **sample placeholder data**. It is not authoritative player or team information, and there is no real authentication or cloud synchronization yet.

### Accounts, roles & permissions prototype

The Admin screen includes three sample staff records: Justin Kostosky (Owner / Head Coach), Austin Koposko (Assistant Coach / Goalie Coach), and Chris Skwortz (Assistant Coach). A clearly labeled **Prototype role** switcher can exercise their capability-based UI views locally.

This switcher is testing-only, not authentication. The frontend contains no passwords, secrets, sessions, or production credentials. UI hiding and section guards are not a security boundary; real backend authorization, user management, and audit logging remain future work.

### GitHub Pages prototype deployment

The workflow in `.github/workflows/deploy-web-pages.yml` publishes only the contents of `web/` as a static GitHub Pages artifact. It runs for changes to `web/` or the workflow itself, and can also be started manually.

To enable it in the repository:

1. In **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Push this workflow to the repository's `main` branch, or start **Deploy web prototype to GitHub Pages** from the Actions tab.
3. After the workflow succeeds, open the Pages URL shown in the `github-pages` deployment environment. For a project repository, it will normally be `https://<owner>.github.io/<repository>/`.

The prototype uses relative `./styles.css` and `./app.js` paths, so those assets resolve correctly from the repository Pages subpath. It remains explicitly marked as prototype/sample-data mode; this workflow does not add authentication, cloud synchronization, or backend behavior.

## Long-term architecture

```text
Windows Analytics App ⇄ Cloud Backend/API ⇄ Website/iPad/iPhone
```

The Windows app should initially remain responsible for full game video processing. The cloud layer and clients should eventually synchronize analytics results, stats, shifts, scouting data, reports, schedules, and player information rather than raw full-game video.

## Existing Windows app

The Electron application remains the repository root application. Existing Windows commands and packaging are unchanged:

```bash
npm install
npm start
npm test
```

See `AI_CONTEXT.md`, `ROADMAP.md`, and `NEXT_TASKS.md` for the handoff and evolution plan.
