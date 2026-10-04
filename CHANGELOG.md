## v2.7.0
- Added Light / Dark / System themes and Comfortable / Compact layout density.
- Added Train dashboard visibility controls for weekly progress, body weight, and waist.
- Added a configurable default rest value for newly created exercises and exposed secondary-muscle set credit (25/50/75%).
- Rebuilt the muscle heat map as a cleaner training-focused anatomical front/back diagram with individually interactive muscle regions and keyboard access.
- Upgraded Data Health with schema v3 migration tracking, expanded integrity checks, a dedicated integrity report, backup timestamping, and safer import migration.
- Added additional checks for orphaned workouts, invalid dates/values, archived exercises in active programs, invalid prescriptions, body-entry duplication, goal IDs, and target ranges.
- Added system-wide UI consistency refinements and dark-theme coverage across cards, forms, navigation, history, analytics, workout entry, and settings.
- Bumped the service-worker cache to v2.7.0.

## v2.6.0
- Expanded deterministic Insights with 4-week vs previous-4-week adherence, sustained muscle-volume patterns, repeated shortened-session patterns, and richer plateau context.
- Added a Training Pulse summary for adherence, session frequency, duration, and weekly working-set load.
- Upgraded Goals with deadlines, baseline-aware progress, achieved/due states, goal summaries, and clearer remaining-to-target feedback.
- Added goal types for 4-week workout adherence and 4-week average effective muscle sets.
- Preserved existing goals and local training data; new goal fields are optional and backward-compatible.

## v2.5.0
- Added a visible app version badge in the Strength OS header and an About card under More.
- Standardized typography across headings, metadata, buttons, pills, lists, metrics, forms, and notes.
- Added selectable 4/8/12-week effective-set trends for every muscle.
- Upgraded muscle detail with an 8-week trend chart, current target context, and contributor breakdown.
- Upgraded Body analytics with selectable measurements, 30D/90D/1Y/All ranges, latest-change context, and charts for optional measurements.
- Preserved existing workout/body data and bumped the service-worker cache to v2.5.0.

## v2.4.0 — History + Exercise Analytics
- Made calendar days interactive with selected-day filtering.
- Added monthly history summary metrics for workouts, working sets, and training time.
- Replaced modal-only workout history with a dedicated workout-record detail screen.
- Added previous/next workout navigation, full set-level history, PR display, and direct links from historical exercises to analytics.
- Expanded exercise analytics with current vs best e1RM, best set, session count, 30D/90D/1Y/All ranges, top-load, total-reps, session-volume, PR timeline, and richer clickable exercise history.

## v2.3.0
- Reworked the live workout logger for faster in-gym use.
- Programmed exercises now pre-fill load/reps from the corresponding previous session while remaining incomplete until confirmed.
- Added per-set previous-performance lines directly below each current set.
- Replaced the small checkbox with a larger tap-friendly Done control.
- Added immediate Weight / Rep / estimated-1RM PR feedback when a set is completed.
- Added a Next incomplete exercise shortcut in the live workout header.
- Improved superset behavior: rest starts only after the matching set is complete across the entire superset group, regardless of completion order.
- Added clearer superset linking and visual grouping.
- Rest timer now supports −30 sec, +30 sec, and Skip without leaving the workout.
- New sets inherit the most recent current-session load/reps; substitutions reset and intelligently pre-fill from the replacement exercise's history.
- No logo, app-icon, or other asset files changed in this revision.

## v2.2.0
- Matured the Exercise Library with active/custom/built-in/archived filters, muscle filtering, program/history usage counts, exercise detail view, duplicate/archive/restore controls, and safe deletion rules for custom exercises.
- Custom exercises created from an exercise picker now return directly into the original add/substitute workflow instead of dropping the task.
- Added primary-muscle filtering to exercise pickers.
- Expanded Program Builder with planned muscle-volume chips, estimated workout duration, day reordering, day duplication, exercise prescription duplication, and clearer primary/secondary muscle mapping.
- Added a one-tap **Use exercise defaults** action when editing a program prescription.
- Strengthened historical integrity: exercises referenced by programs/history cannot be deleted and should be archived instead.

## v2.1.0
- Rebuilt all bottom navigation icons as one normalized Style A SVG family with consistent 24×24 geometry, stroke weight, optical size, and alignment.
- Replaced the emoji body-weight control with a matching SVG scale icon.
- Refined the Train screen spacing, workout-library rows, active-program hierarchy, and navigation styling.
- Reworked workout preview into a clearer read-only details screen with Back, session summary, exercise list, and a single prominent Start workout action.
- Added explicit preview messaging so opening a workout cannot be confused with starting it.
- No workout/body data model changes; existing local Strength OS data remains compatible.

## v2.0.3
- Changed workout selection so tapping a workout opens a preview/details screen instead of starting immediately.
- Added a dedicated **Start workout** button and a clear **Back** action from the preview screen.
- Updated bottom tab icons to the cleaner Style A set for a more polished Wealth OS-like navigation look.


## v2.0.2
- Replaced the app icon and brand logo with clean high-resolution Strength OS artwork.
- Updated `assets/strength-os-icon.png`, `assets/strength-os-logo.png`, `icons/icon-192.png`, and `icons/icon-512.png`.
- Bumped service worker cache version so GitHub Pages/Safari refreshes the new icon assets.

# Strength OS v2.0

Major rewrite of the original Strength + Protein Tracker.

## Removed
- Protein tracking
- Quick foods / nutrition log
- Creatine tracking

## Added / redesigned
- Versioned Strength OS data model
- Automatic V1 migration and retained migration backup
- V1 JSON import migration
- Central exercise library and custom exercises
- Primary/secondary muscle mapping
- Fully editable multi-program builder
- Empty workouts and exercise substitution
- Set types: warm-up, normal, drop, failure, AMRAP
- Superset grouping
- Workout/exercise notes
- Workout duration and skip state
- History calendar with filters
- Exercise analytics and PR engine
- Direct/effective muscle analytics
- Interactive schematic body heat map
- Editable muscle-volume targets
- Expanded body measurements
- Goals and deterministic insights
- Plate and warm-up calculators
- Data Health diagnostics
- kg/lb exercise-load display and additional preferences
