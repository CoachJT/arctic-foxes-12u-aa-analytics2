# Arctic Foxes 4.2.0

- Improved the Film workspace layout with better video sizing, natural aspect-ratio handling, and less excessive zooming or cropping.
- Cleaned up Film controls, clip navigation, current-clip context, and surrounding review tools without changing tracking behavior.
- Added the Coach Command Center dashboard with compact Top-5 leader views for points, goals, assists, player rating, recorded TOI, shots, Faceoff %, and blocked shots.
- Faceoff % leaderboard eligibility requires at least 10 recorded faceoff attempts; goalies remain outside skater leaderboards.
- Added GF vs GA and Shots For vs Shots Against game trends.
- Added selected-player rating trends, recorded TOI/player usage, and an improved recent team performance view.
- Missing or insufficient analytics data is displayed as unavailable rather than fabricated as zero.
- Added Accounts, Roles & Permissions to the future roadmap only. Authentication, authorization, account management, and permission enforcement are not implemented in v4.2.0.

Existing analytics formulas, manual-data authority, review-first tracking behavior, saved-data schemas, season-data location, and original video files are preserved.

Validation: 129 automated tests pass. Windows installer and packaged-application launch validation are performed as part of the local release preparation process.
