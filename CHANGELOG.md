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
