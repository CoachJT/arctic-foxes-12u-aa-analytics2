ARCTIC FOXES ANALYTICS - GITHUB AUTO-PUBLISH
=============================================

What this adds
--------------
The file .github/workflows/publish-windows.yml makes GitHub build and publish
Windows updates automatically whenever the app source/version is pushed to the
main branch.

No personal GitHub token is stored in the app or workflow. GitHub Actions uses
the repository's built-in GITHUB_TOKEN for publishing releases.

Future update flow
------------------
1. Update the app source and bump package.json to a NEW version (example 3.0.10).
2. Put the updated source files into the GitHub repository.
3. Commit/push to main (GitHub Desktop is easiest).
4. GitHub Actions builds the NSIS installer and publishes the GitHub Release.
5. Open the installed Arctic Foxes app -> Updates -> Check for Updates.
6. Download -> Restart & Install.

IMPORTANT
---------
- Every release must have a new package.json version.
- Keep the repository name: CoachJT/arctic-foxes-12u-aa-analytics2
- Keep the stable Electron data folder: ArcticFoxesBY14HockeyAnalytics
- Do not put a personal access token into source code or GitHub Actions files.
- The workflow requires repository Actions permission to create releases
  (Settings -> Actions -> General -> Workflow permissions -> Read and write permissions),
  unless the repository already allows write access for GITHUB_TOKEN.

3.0.9 is designed to be the first GitHub-Actions auto-publish test.
