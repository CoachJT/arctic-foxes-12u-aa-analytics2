Hockey Ice Time Engine

Open index.html in any modern browser.

Features:
- Game-clock countdown
- Tap players ON/OFF ice
- Automatic shift duration, total TOI, average shift, longest shift
- EV / PP / PK split
- F1/F2/F3 and D1/D2/D3 line-change buttons
- Undo
- Active-player warnings
- CSV export
- Local browser autosave
- Add/edit players (double-click a player to edit)

Important:
This is a browser prototype. It stores data in localStorage on that device/browser.

- Local game-film picker and embedded video player
- Pause/seek video while tracking
- Optional exact video-timestamp mode
- ±1 second and ±5 second video controls

Video privacy:
The selected video is opened locally in the browser with an object URL. The prototype does not upload the video to a remote server.

- Video-to-scoreboard game clock sync points
- Automatic interpolation/extrapolation from video timestamp to game clock
- Shift records can now use synced hockey period + scoreboard time

- Guided film workflow: select who is getting OFF and who is getting ON
- Records both sides of the line change at the same exact synced timestamp

- Analytics dashboard with team TOI, total shifts, average shift, players used
- Ice-time leader bars
- Strength-state TOI summary
- Period TOI summary
- Live leader cards

- Game event tracking: shots, goals, scoring chances, zone entries, takeaways, giveaways
- Automatic on-ice +/- from goal events
- Player analytics table with event totals and game grade
- Event log with synced game clock and video timestamp
- CSV export now includes shift data and event data

QA fixes:
- Synced film shift durations now use hockey game-clock elapsed time instead of raw video time.
- New Game clears prior events, sync points, and guided-change selections.
- Goal events count as shots on goal automatically.
- Standard +/- logic excludes our PP goals and opponent PP goals against us.
- Event CSV now records strength state.

- Blocked Shots event added
- Player blocked-shot totals added to analytics table
- Team blocked-shot KPI added to dashboard
- Blocked shots contribute modestly to player game grade

- Automatic Game MVP selection added
- MVP score uses goals, shots, scoring chances, entries, takeaways, blocked shots, giveaways, +/-, TOI, and game grade
- Dashboard explains the winning player's main contributions

- Goalie tracking added
- Track saves and goals against from film
- Automatic shots against and save percentage
- Goalie W/L/T/OTL decision
- Goalie analytics dashboard table
- Goalie stats included in CSV export

- Saved Games system added
- Save stats-only games and reopen them later to add ice time
- Open / Continue preserves existing stats, goalie data, shifts, and sync points
- Game status labels show whether stats and/or ice time are complete
- Save As New Game creates a separate game record
- New Game starts fresh without deleting previously saved games

- Dashboard can now switch between one selected saved game and all saved games combined
- All-games mode aggregates skater TOI, shifts, events, player stats, blocked shots, turnovers, and goalie totals
- Single-game dashboard selector can analyze any previously saved game without opening/editing it

- Season Backup / Restore added
- Backup Season downloads one JSON file containing roster, saved games, shifts, events, goalie stats, sync points, and dashboard settings
- Restore Season validates the backup and asks before replacing current app data
- Active/running shift state is safely reset during backup/restore

- Default roster updated with the Foxes player names and jersey numbers supplied for the team.

- Film Review Mode added
- Centers/enlarges the video in a two-column workspace on desktop
- Line Change, Game Events, and Goalie Tracking stay beside the film in a sticky tool column
- Responsive layout returns to one column on smaller screens
- Quick navigation buttons added for Film, Line Change, Events, Goalie, and Dashboard

- Arctic Foxes BY14 2026-2027 visual branding added
- Red Foxes theme applied across buttons, focus states, cards, and dashboard highlights
- Foxes header/logo treatment added for a more team-branded desktop experience

- Player display updated so jersey number and full player name appear together on roster/player controls.

- Film Review controls redesigned into a compact sticky tabbed dock
- Line Change, Events, and Goalie controls now occupy one right-side panel instead of stacking vertically
- Right-side dock scrolls internally so the main page does not need constant scrolling
- Quick Film bar added directly below the video for Line Change, Events, Goalie, Shot, Goal, and Block

- Faceoff Win and Faceoff Loss tracking added
- Faceoff buttons available in Game Events and directly below the film in the quick bar
- Faceoff wins/losses are assigned to the selected player
- Player analytics now support FO W, FO L, and FO%
- Faceoff results are saved with the game and included in event exports/backups

- v1.6.1 repair: fixed JavaScript syntax error introduced by faceoff tracking
- Verified app JavaScript with Node syntax check before packaging
- Added Foxes roster-name migration for older locally saved data that may contain jersey numbers without names
- Faceoff Win/Loss tracking retained

- v1.6.2 roster repair: removed remaining generic sample players
- Detects old sample roster cached by previous versions and automatically replaces it with the Foxes roster
- Old sample line presets cleared so they cannot bring generic jersey numbers back

- v1.8 Full Stats Import
- Added all official skater categories from the 2026-27 PlayerStats sheet: GP, G, A, PTS, S, S%, PIM, +/-, Blocks, FO, FOW, FO%, PPG, PPP, SHG, SHP, GWG, GTG
- Added all official goalie categories: GP, MIN, SA, GA, SV%, GAA, W, L, T, SO, G, A, PTS, PPG, PPP, SHG, SHP
- Added team Power Play, Penalty Kill, Face-Off, scoring-by-period, and shots-by-period categories
- Import CSV/TSV or paste copied Excel cells
- Official stats are saved with each game and included in Backup/Restore and CSV export
- Ice time is never overwritten by an official-stats import
- Fixed Shift Assist Confirm & Track to use the existing Record Line Change engine

- v1.9 MVP engine upgraded
- Skater MVP uses official goals, assists, points, shots, PIM, +/-, blocks, faceoffs, PPG/PPP, SHG/SHP, GWG/GTG plus film chances, entries, takeaways, giveaways, TOI and game grade
- Goalies can win MVP using saves, save percentage, goals against, wins, shutouts, minutes and goalie points
- All-games dashboard uses Season MVP Leader wording

- v1.10 Film Review Simplification
- Film Review Mode is now shift/ice-time focused only
- Removed Shot, Goal, Block, Faceoff, Events and Goalie quick controls from the film workspace
- Line Change and Shift Assist remain directly beside the film
- Imported official stats, dashboards, MVP calculations, goalie data and exports remain available elsewhere in the app

- v1.11 Tag Assist beta
- Assign a machine-readable QR/tag ID to each skater
- Draw a bench-change zone directly over the loaded game video
- Uses the Chromium BarcodeDetector API when available to watch only the bench zone
- A tagged player appearing in the zone generates an ON/OFF suggestion based on current shift state
- Suggestions must be confirmed before a shift is written
- Tag Assist falls back cleanly to manual Shift Assist when BarcodeDetector is unavailable
- Tag setup, bench zone and pending suggestions save with each game

- v1.12 Tag Fullscreen Mode
- Fullscreen Video + Tags button enlarges the film while keeping the bench-zone overlay active
- Tag Assist status and latest tag suggestions stay visible over fullscreen video
- Confirm ON/OFF and Reject work directly from fullscreen
- Escape or Exit Fullscreen returns to normal layout
- Bench-zone overlay compensates for letterboxing/object-fit in fullscreen

- v1.13 Editable Game Stats
- Imported skater and goalie stats can now be corrected directly in the app.
- Click/tap a stat box, enter the corrected number, and the game saves the edit locally.
- Derived PTS, shooting %, faceoff %, goalie save %, goalie GAA, and goalie points recalculate automatically.
- Dashboard/MVP refresh after each correction.

- v1.14 Goalie Stats Fix
- Corrected PlayerStats goalie interpretation: source column S means Saves, not Shots Against.
- Official goalie table now shows editable Saves and GA, with Shots Against derived as Saves + GA.
- SV% is calculated as Saves / (Saves + GA).
- GAA continues to use the 36-minute game basis.
- Existing imported goalie records from older app versions are migrated when loaded.
- Goalie MVP calculations now use the corrected Saves/SA values.

- v1.15 Full Goalie Stats Repair
- Goalie dashboard now prefers imported official goalie stats instead of showing only manually clicked Save/GA events.
- Saved-game goalie dashboards use that saved game's official goalie stats.
- All-Games goalie dashboard aggregates Saves, GA and SA correctly across games and recalculates season SV%.
- Goalie W/L/T display now comes from official stats when available.
- Selected-game MVP now uses that game's own official stats instead of whichever game is currently open.
- Season MVP aggregates official goalie statistics across saved games.

- v1.16 Update-Safe Season Storage
- Desktop season data now saves to a stable file in the user's Windows AppData folder, outside the versioned app/exe folder.
- Every future build using this app package reads the same stable data file automatically.
- The first v1.16 launch migrates existing localStorage data into the stable file when no stable file exists yet.
- Before each save, the previous stable data file is copied to foxes-season-data.previous.json as an additional recovery point.
- Backup Season / Restore Season remain available as manual backups.

- v1.17 Save Location Controls
- Added Choose Auto-Save Folder.
- Changing the auto-save folder copies the current season data into the new folder before future saves continue there.
- Added Open Save Folder to open the current storage location in Windows Explorer.
- Added Save Season Copy As... to create a manual JSON copy anywhere (Desktop, Documents, OneDrive, USB drive, etc.).
- Automatic update-safe saving remains enabled.

- v1.18 Simple Game Manager
- Replaced Save Current Game / Save As New Game workflow with one Create Game action.
- New game setup only asks for Date and Opponent.
- Created/open games auto-save whenever stats, shifts, goalie data, or other game data changes.
- Top Add Game button now jumps to the Games section instead of immediately clearing the current game.
- My Games shows the current game, status and shift count with a single Open Game action.
- Backup and save-location controls are moved into a collapsed Season backup & save location section.

- v1.19 Multi-Clip Film
- One saved game can contain multiple LiveBarn clips.
- Add one clip or select several clips at once.
- Previous Clip / Next Clip navigation.
- Each clip stores its own label, filename, duration, playback position, and scoreboard sync points.
- Shift tracking remains combined in the same game's player totals across all clips.
- Shift records now retain start/end clip IDs and video timestamps for traceability.
- Desktop file paths are retained so clips can be reopened when the saved game is opened again, as long as the files have not been moved.
- Older single-clip games are migrated without deleting their existing sync data.

- v1.20 Player Value Page
- Added a dedicated full-page Player Value view accessible from the app.
- Player Value Index is color-coded: 85-100 Elite Impact, 70-84 Strong, 55-69 Solid, 40-54 Needs More, below 40 Low Impact.
- Skater value considers Production, Two-Way impact, Special Teams/Clutch, Discipline, available Usage/TOI, and Faceoffs when applicable.
- Missing TOI or faceoff data is reweighted out rather than automatically hurting the player.
- Goalie value is evaluated separately using Save %, GAA, results, and workload.
- Supports Full Season, Current Game, or Selected Game views plus position filtering and player search.
- Shows team leader, average value, top three contributors, key stats, and each player's biggest statistical value driver.
- Value Index is intended as a coaching comparison tool and not an absolute scouting grade.

- v1.21 Player Value Trends
- Added trend arrows to the Player Value page.
- Up arrow = latest saved-game Value improved by at least 3 points versus previous game.
- Down arrow = latest saved-game Value dropped by at least 3 points.
- Right arrow = within 3 points / holding steady.
- Trend is based on each player's two most recent saved games, so season ranking and short-term direction can be viewed together.
- Players without two rated games show a neutral arrow with 'Not enough games'.

- v1.22 Player Development Profiles
- Click a player name on Player Value to open a dedicated individual development dashboard.
- Player profile includes Value Index, current trend, season/last-5/last-3 selector, game-by-game Value chart, category breakdown, strengths, development-focus areas, and recent-game history.
- Skater profile includes G/A/PTS, tracked TOI, shifts, +/- and shots.
- Goalie profile switches automatically to Save %, Saves/SA, GAA, W-L-T and shutouts.
- Statistical strengths/development focus are relative to available team data and are labeled as coaching aids rather than scouting conclusions.
- Previous/Next buttons allow fast player-to-player review.

- v1.22.1 Roster/Profile Fix
- Player Development Profiles now always start from the complete Foxes roster, even when a player has no imported stats yet.
- Main current roster is also repaired on load if saved data is missing one or more default Foxes players.
- Existing shifts and player data are preserved by jersey number when the roster is repaired.
- Manually added non-default players are preserved.
- Players with no stats now remain selectable and show a clear message that game stats are needed to populate development sections.

- v1.22.2 Freeze / Modal Mount Fix
- Fixed Confirm Line Change overlay becoming stranded/frozen.
- Shift Assist modal, Player Value page, and Player Development Profile markup now loads before JavaScript event listeners are attached.
- Confirm & Track is protected with an error-safe close so an unexpected tracking error cannot leave the whole app blocked.
- Cancel remains available through the same safe-close path.
- This also restores reliable event binding for Player Value/Profile controls introduced in recent versions.

- v1.22.3 Clean Workspaces
- Reorganized the app into Home, Film, Shift Tracking, Stats, and Analytics pages.
- Film and Shift Tracking are now separate workspaces to reduce visual crowding.
- Film page: LiveBarn clips, video controls, scoreboard sync, Tag Assist.
- Shift Tracking page: game clock, line buttons, Shift Assist, guided line changes, roster, line setup, live TOI.
- Stats page: official stat import/editing, goalie tracking, manual game events.
- Analytics page: main analytics dashboard plus direct Player Value access.
- Home: Games, backup/save-location controls, Quick Start buttons.
- Switching pages preserves the loaded film and current tracking state.

- v1.22.4 Straight-Line Bench Boundary
- Replaced new Tag Assist bench-zone drawing with a one-drag straight bench line.
- Click Draw Bench Line, then drag from one end of the bench/change area to the other.
- The line may be horizontal, diagonal, or any angle needed for the LiveBarn camera view.
- Tag Assist watches a narrow invisible/visualized band around the line rather than requiring a large rectangle.
- The video overlay shows a crisp red bench line, endpoint handles, and a faint detection band.
- Live line preview appears while dragging.
- Existing saved rectangle bench zones remain readable and functional for backward compatibility; redraw them to switch to the new line format.

- v1.22.5 Simple F/D Live Shift Controls
- Added four large Shift Tracking controls: F ON, F OFF, D ON, D OFF.
- Each control shows only eligible players for that position/action.
- Select only the players changing and Apply; their individual shift timers start/end at the same current tracking timestamp.
- Opening faceoff workflow: F ON for the starting forwards, then D ON for the starting defensemen at puck drop.
- Existing individual player ON/OFF, line buttons, Guided Line Change, and Shift Assist remain available.
- Updated individual shift starts to retain current film clip/video timestamp metadata.

- v1.22.6 Confirmed Roster Positions
- Defense: #21 Logan Madura, #84 Eric Rosswog, #20 Jace Rieger, #29 Noah Chiodo, #78 Logan Heffern.
- Forward correction: #6 Zac Seech.
- Goalies confirmed: #35 Hudson Bouchard and #30 Jacob/Jake Cypher.
- Existing saved roster data is repaired on load so the F ON/F OFF/D ON/D OFF controls use the corrected positions.


============================================================
ARCTIC FOXES HOCKEY ANALYTICS 2.0
============================================================

2.0 is the coach-first visual redesign.

NEW APP SHELL
- Left-side desktop navigation and compact bottom navigation on smaller screens.
- Workflow is now: Coach Center -> Film -> Track -> Stats -> Analyze -> Develop.
- New startup splash screen and 2.0 branding.
- Cleaner cards, spacing, typography and game-day hierarchy.

COACH CENTER
- Season Games
- Roster count
- Tracked Shifts
- Current On-Ice count / game clock
- Live/current-game status
- Game-Day Workflow shortcuts
- Recent Games panel

TRACKING
- Existing F ON / F OFF / D ON / D OFF live controls are preserved and visually emphasized.
- Existing individual ON/OFF, line changes, Guided Line Change and Shift Assist remain available.
- Confirmed roster positions from v1.22.6 remain preserved.

WINDOWS APP
- Build now produces both a portable EXE and a standard Windows Setup EXE.
- Run BUILD_WINDOWS_3_0.bat.
- Outputs are created in the dist folder.

DATA SAFETY
- The stable season storage folder remains EXACTLY:
  ArcticFoxesBY14HockeyAnalytics
- Existing saved games and season data remain compatible.
- User-selected auto-save folders remain compatible.

NOTE
- 2.0 changes the app shell and workflow without replacing the underlying season data.
- Experimental automatic tag line-crossing is intentionally not enabled by default in this build; existing manual Tag Assist remains available.

- v2.0.1 Team Branding Update
- Team designation standardized to Arctic Foxes 12U AA.
- Season standardized to 2026–2027 Season.
- Updated app title, header, Coach Center, splash branding, Windows product name and installer shortcut.

- v2.0.2 Auto Update Framework
- Added an Updates panel and startup update checks.
- Added manual Check for Updates, download progress, Download Update, and Restart & Install.
- Uses electron-updater + Windows NSIS, with GitHub Releases as the release channel.
- Added PUBLISH_WINDOWS_UPDATE.bat and SETUP_AUTO_UPDATES.txt.
- A one-time GitHub repository owner setup is required before live updates can work.
- The existing stable season data location remains unchanged.

- v2.1.0 Coach Suite
- Added Scouting Center workspace.
- Added opponent scout library with reusable player watchlists and goalie reports.
- Added one-page printable Opponent Scout Sheet for film sessions and game-day locker-room posting.
- Print button supports normal Windows print and Save as PDF.
- Added Playing Time & Usage dashboard.
- Added Team Trends workspace.
- Added organized Video Library references without duplicating large source files.
- Added expanded Settings page with team/season/period/save location/tag-assist/update controls.
- Existing updater framework and stable season-data directory preserved.

- v2.9.0 Complete 2.x Build
- 2.2 Scout + Film: clip tags, opponent history, player-facing game plan.
- 2.3 Usage 2.0: TOI, shift count/length, EV/PP/PK and load flags.
- 2.4 Team Trends 2.0: recent game scoring and shot trends.
- 2.5 Line & Pair Analytics: tracked overlap for same-position combinations.
- 2.6 Postgame Reports: coach and simplified team/parent versions.
- 2.7 Coach Insights: evidence-based usage and shift-length observations.
- 2.8 Auto Tracking: Off/Suggest/Auto controls, stable-crossing timing, bench-line readiness and undo. Uses the existing visual-tag detection pipeline.
- 2.9 Stability: validated backup import, export, save-folder and updater access, while preserving the stable data directory.

- v2.9.1 BUGFIX
- Fixed Usage 2.0 EV/PP/PK time calculations to use the actual shift elapsed-time model.
- Fixed Coach Lab Undo Last Shift button.
- Fixed line/pair overlap calculations for active shifts and period separation.
- Postgame Reports now sync the current game snapshot before generating.
- Hardened 2.9 startup so a Coach Lab initialization error cannot stop the rest of the app.
- Existing saved-data path and 2.1 printable scouting sheet remain unchanged.

- v2.9.2 BUGFIX
- Fixed a critical Tag Assist confirmation bug that called obsolete startShift/endShift functions.
- Tag suggestions now create/end real player shifts with clip/video metadata preserved.
- Auto Track mode now uses the existing visual-tag detector instead of only saving a preference.
- Suggest / Auto / Off modes now control the existing Tag Assist workflow.
- Auto Track uses the selected 0.5 / 0.75 / 1.0 second stable-crossing setting.
- Postgame reports now fall back to recorded game events when official team stats are not available.
- Existing data path, scouting sheets, 2.9 Coach Lab, backups and updater framework remain preserved.

- v2.9.3 STATS-ONLY ANALYTICS
- Added automatic Stats-Only Analytics mode when no completed shift data exists.
- Missing ice time is excluded from analysis instead of treated as zero.
- Usage, shift length, workload, and line/pair deployment show Not Tracked / N/A without TOI.
- Postgame reports switch between Stats-Only and Stats + TOI modes.
- Coach Insights still run from recorded game/team stats without requiring ice time.
- Existing scouting, goalie analytics, trends, reports, backups, updater framework, and saved-data path remain preserved.

- v2.9.4 ICE-TIME ANALYTICS TOGGLE
- Added a Coach Lab switch: Include Ice Time in Analytics.
- ON: uses TOI/usage/shift/line-pair analytics when shift data exists.
- OFF: keeps all tracked ice-time data saved, but excludes it from analytics and reports.
- OFF does not delete shifts or stop ice-time tracking; it only changes analytics calculations.
- If ON but no TOI is recorded, the app safely falls back to Stats-Only Analytics.
- Existing scouting, stats, goalie analytics, reports, backups, updater framework and stable data path are preserved.

- v2.9.6 FILM ANALYSIS HUB: added Opponent Scout, Our Game Review and Practice Review workflows. Practice Review covers pace, compete, drill execution, systems habits, decisions, coaching priorities and next-practice drill recommendations. Automatic AI video analysis still requires a configured AI/API connection.

- v2.9.7 FILM OVERLAY VISUAL UPGRADE
- Added a cleaner broadcast-style film HUD over the video.
- Added film time, period, strength and Tag Assist status overlays.
- Added compact floating overlay toolbar.
- Added Clean View, Player Labels preference, Confidence preference and Fullscreen controls.
- Added responsive overlay styling for smaller screens.
- Existing bench-line/tracking geometry is preserved.
- This is a visual/UI upgrade only; it does not fabricate player detections or AI tracking results.

- VERSION 3.0.0 MAJOR REDESIGN
- Complete visual refresh of the Arctic Foxes coaching platform.
- New coaching command-center home screen with hero workflow and live season metrics.
- New modern card system, spacing, typography, navigation states, tables and controls.
- Game Day / Quick Stats is visually promoted as a first-class workflow.
- Film workspace is more video-first with a larger, cleaner presentation.
- Analytics, Coach Lab, scouting and player tools inherit the new visual system.
- Responsive tablet/mobile styling improved.
- Existing features and saved-season data path are preserved.
- This release is a major UI redesign; cloud sync/PWA hosting is not enabled by this build.

- 3.0.1 EASY GAMES + SEASON SCHEDULE
- Added dedicated Schedule workspace.
- Quick-add a game with only Date + Opponent.
- Full schedule entry supports time, home/away/neutral, game type, rink/location and notes.
- Upcoming / All / Past schedule views.
- Scheduled games have a one-click Create Game / Open Game workflow.
- Creating a game from the schedule links the schedule entry to the saved game.
- Existing game creation remains available and is now labeled Create & Open Game.
- Remaining legacy 2.0 splash/header branding changed to 3.0.
- Schedule data is stored locally under foxes-301-season-schedule.
- Stable season save path remains ArcticFoxesBY14HockeyAnalytics.

- 3.0.3 GITHUB UPDATE FEED CONNECTED
- Update owner: CoachJT
- Update repo: arctic-foxes-12u-aa-analytics2
- This is intended to be the last manually installed bridge build.
- Future versions can be published through GitHub Releases and installed in-app.

- 3.0.4 UPDATE TEST
- Added a visible green update-test banner on the Home screen.
- Purpose: verify that installed 3.0.3 can detect, download, install, and restart into 3.0.4.
- GitHub update repository remains CoachJT/arctic-foxes-12u-aa-analytics2.
- Stable season-data path remains ArcticFoxesBY14HockeyAnalytics.


3.0.5 UPDATE CENTER FIX
- Fixes the left-side Updates button.
- Adds the update controls directly to Coach Center/Home.
- Updates button now returns to Coach Center and scrolls to App Updates.
- Keeps GitHub updater connection and stable season data path unchanged.


3.0.6 UPDATE DIAGNOSTICS
- Fixed updater check that could remain stuck indefinitely.
- Adds a 20-second timeout and visible error message.
- Removed duplicate legacy updater initialization to avoid competing updater listeners/IPC setup.
- Preserves stable ArcticFoxesBY14HockeyAnalytics season data path.


3.0.9 UPDATER FIX
- Home Update Center now uses the same foxesStorage IPC API exposed by preload.js.
- Removed obsolete duplicate updater IPC/event code.
- Added updater timeout, detailed error text, and updater log button.
- Disabled startup auto-check until manual check is confirmed stable.
- Persistent data folder remains ArcticFoxesBY14HockeyAnalytics.
