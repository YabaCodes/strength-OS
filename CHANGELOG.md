## v2.13.0 — A fuller exercise library

Exercise library
- Every muscle now has at least three built-in exercises to choose from, picked from the most effective options for each. 29 are new:
  - Lats: Straight-Arm Cable Pulldown, Single-Arm Dumbbell Row. Upper back: Barbell Row.
  - Traps: Farmer's Carry, Incline Y-Raise. Lower back (had none): 45° Back Extension, Deadlift, Good Morning.
  - Front delts: Overhead Press. Side delts: Machine Lateral Raise, Wide-Grip Cable Upright Row. Rear delts: Rear-Delt Row.
  - Biceps: Bayesian Cable Curl, EZ-Bar Curl. Triceps: EZ-Bar Skull Crusher, Close-Grip Bench Press.
  - Forearms: Reverse Wrist Curl, Dead Hang (with Wrist Curl and Reverse Curl from v2.12).
  - Hamstrings: Lying Leg Curl, Nordic Curl. Glutes: Walking Lunge, Cable Glute Kickback.
  - Adductors: Copenhagen Plank, Standing Cable Adduction. Calves: Leg Press Calf Raise.
  - Abs: Ab Wheel Rollout. Obliques: Pallof Press, Side Plank, Dumbbell Side Bend.
- Each new exercise has its target line, default sets, reps, rest and a technique tip. Per-side exercises say so in the tip.
- Best first: when you filter the library or the Add exercise list by a muscle, the best exercises for it come first, and the top one or two carry a **Top pick** tag. With "All muscles" the list stays A–Z.
- They appear in your library automatically. Your program, history, custom exercises, notes and archived exercises are unchanged.

Updates
- The app now also looks for a new version when you come back to it from the background (at most every 10 minutes, and hourly while open). Before, a phone app that was never fully closed kept running the old version, so v2.12 didn't reach everyone. When an update is ready you see the same *Reload* banner as before; nothing reloads by itself mid-workout.

## v2.12.0 — Targets and program additions

Targets
- Every exercise shows the part of the muscle it's for, in a line under its name: in Programs, today's session on Train, the workout preview, the live workout, the exercise library and the exercise picker. For example: bench press → "Mid & lower chest (sternal head)", incline press → "Upper chest (clavicular head)", overhead extension → "Triceps long head", seated calf raise → "Calves: soleus".
- Exercise details show it as **Targets**. It can be changed in the exercise's edit form; custom exercises start empty.
- It's an extra line: the existing muscle lines ("Chest → Triceps, Front Delts" and so on) stay where they were.

Program additions (offered once: *Add to my program*)
- Forearms: wrist curl and reverse curl on Friday, as a superset after the hammer curl.
- Side of the hip: hip abduction on Sunday, as a superset with hip adduction.
- Obliques: cable woodchop on Wednesday, after the cable crunch.
- Tips added to the cable fly (pulleys high, pull down and in, for the lower chest) and leg extension (recline the seat, for the rectus femoris), only where the exercise has no note yet.
- Nothing else in the program changes. Anyone who hasn't applied the October revision yet gets these with it.
- New built-in exercises: Wrist Curl, Reverse Curl, Hip Abduction, Cable Woodchop.

## v2.11.0 — Revised program and weekly order

Program
- A revised 5-day program, offered once on Train and Programs (*Apply to my program*). The sessions are the same five, reordered so no muscle is trained hard two days in a row: Sun Legs A · Tue Shoulders + Arms · Wed Legs B · Thu Chest + Triceps · Fri Back + Biceps. Applying it also sets the week to start on Sunday.
- It adds what the first version under-trained or missed:
  - Side delts: 4 sets of lateral raises on Tuesday and Thursday (about 9.5 effective sets a week, up from 6.5).
  - Calves: seated calf raise on Wednesday for the soleus; the standing raise stays on Sunday.
  - Adductors: hip adduction on Sunday. Adductors are now tracked as a muscle (target 4–8 sets, shown on the body map).
  - Front of the thigh: leg extension 3 sets (was 2). Lats: lat pulldown 3 sets (was 2).
  - Abs: cable crunch replaces the weighted plank.
  - Triceps: Tuesday uses the overhead extension instead of the pressdown.
  - Face pull replaces Tuesday's rear-delt fly; 2 sets of shrugs for the upper traps.
- Your current program is kept as a copy ("… (before Oct 2026)"); history, progression and this week's workouts are unchanged. *Not now* hides the offer on Train; it stays in Programs.
- New built-in exercises: Seated Calf Raise, Cable Crunch, Hip Adduction, Face Pull, Shrug.

Weekly order
- **Still to do this week** on Train lists sessions planned earlier in the week that haven't been done, so a Friday session can be done on Saturday.
- Today's session and the catch-up list warn when they work muscles trained in the last two days.

## v2.10.0 — Layout and polish

Fixed
- Progress cards no longer sit on top of each other: every screen now uses the same 14 px gap between cards (Progress had none).
- The Progress section tabs fit the screen; "Goals" used to be cut off. Same for the filters in the exercise library.
- On a logged set, the "Previous …" line and the PR badge no longer collide; the badge moves to its own line when needed.
- The rest timer no longer covers the last buttons of a workout; the page leaves room for it.
- Messages ("Saved.", PRs, "Workout paused") appear at the top of the screen instead of over the buttons you're tapping.
- Labels stay on one line: "0/5 this week", "+ Program"; names like "5-Day" or "Single-Arm" no longer break at the hyphen.
- Stat tiles never leave a half-empty row: three tiles share one row, and an odd last tile spans the row.
- On small phones (320–375 px), the set buttons and the Technique/Pain row stay inside their card.

Calmer screens
- Programs: tap an exercise to edit it; one ⋯ menu per exercise and per day (Edit, Move up, Move down, Duplicate) replaces four small buttons on every row.
- More: settings are compact rows — Theme, Layout density, Units, Week starts and Secondary muscle credit as segmented choices (the same switch style as Wealth OS), and on/off options as switches. Training configuration is a list of rows.
- Muscle targets: one row per muscle with min and max side by side, instead of 34 stacked boxes.
- Long lists (measurement history, PR timeline, exercise history) show 5 rows with "Show all".
- Data health shows dates as "Oct 5, 2026", and a shorter "Last backup"; its buttons sit in a tidy grid.
- The new-goal pop-up is titled "New goal".
- One text-size scale and spacing scale across screens and pop-ups.

No change to your data or how anything is calculated.

## v2.9.0 — Storage moved to IndexedDB

- Your workouts are now saved in IndexedDB instead of localStorage. localStorage stops accepting changes at about 5 MB, which is roughly 3–4 years of logging; IndexedDB has room for many years. Tested with 7 years of history (about 8 MB), which v2.8.1 could not save.
- Nothing to do: on first launch your data is copied over, checked byte for byte, and only then removed from localStorage. Everything looks and works the same, including a workout in progress, dark mode on launch, and the undo copy from your last import or reset.
- A safety copy from before the move is kept on the device for 30 days (More → Storage upgrade → Download safety copy), then removed automatically.
- Each change is handed to storage the moment you make it, so sets logged right before closing the app are kept.
- More → Data health shows the size of your data without the old "of ~5 MB" limit.
- If storage can't be opened at launch, a banner says so and nothing is saved (and import, reset and undo are turned off) until it opens again, instead of starting an empty profile on top of your data.
- If saving keeps failing during a workout, the banner appears and an emergency copy is kept; the next launch puts it back, so sets logged in the meantime aren't lost.
- An old copy of the app (an open desktop tab, or a rollback) can't replace your data with a blank profile; only a newer version of the same data is ever taken over.
- The update banner and Install button can no longer be missed while the app is loading.

## v2.8.1 — Settings fixes

- Settings in More (theme, layout density, units, week start, Train dashboard, logging options) now save and apply the moment you change them. Before, they only applied after tapping "Save personalization", which sat in a different card, so changing Theme or Density looked like it did nothing.
- Compact density is now clearly tighter: about 15% shorter on Train, History and Progress, and about 10% on the live workout and More, while keeping 16px inputs and 44px Done buttons.
- Pausing a workout started from the workout preview now returns to Train with the Resume card (it used to land on the preview page, hiding the paused workout).
- The set buttons under each exercise no longer cut off their labels ("Use previous" is now "Previous").

## v2.8.0 — Reliability, in-gym logging, dark mode fixes

Data safety
- Import now checks that the file is a real Strength OS (or V1) backup, shows what will be replaced, asks before replacing, and keeps an undo copy (More → Data health → Restore previous data). Reset keeps the same undo copy.
- If saved data can't be read, the app no longer overwrites it with an empty profile; it shows a banner and lets you download the raw data.
- If browser storage is full, a banner says changes aren't being saved and offers an immediate backup.
- Backups are exported through the share sheet on phones ("Save to Files"), and "Last backup" is only updated when the export actually happens. A reminder appears on Train after 14 days without a backup. Data health shows how much storage is used.
- The app asks the browser to keep its storage persistent.

Bug fixes
- Editing a past workout no longer changes its duration when saved.
- Body measurements can be edited and deleted again (tapping a row used to crash). Moving an entry onto a date that already has one merges them.
- Pressing Return/Go in a pop-up saves instead of closing it and discarding the input.
- History "Training time" shows real totals (it always showed 0m).
- Workouts can't get stranded: "Save & close" is now "Pause workout", paused workouts appear on Train with Resume/Discard, History labels them "Unfinished", and editing a past workout is blocked while one is live.
- The Progress screen no longer scrolls sideways on phones.
- Body-weight and waist goals without a starting point (made before v2.6 or before the first weigh-in) no longer show "Achieved" on day one.
- PRs: none on the first-ever session of an exercise; three sets at a new top weight count as one PR; bodyweight exercises earn Rep PRs; duration PRs for timed exercises; assisted exercises progress by reducing assistance.
- Train shows today's workout as done after you finish it. Complete and shortened workouts count as done everywhere ("x/5 this week", Overview, Goals).
- Body weight follows the kg/lb setting everywhere.

Live workout
- Rest timer plays a short beep (setting), survives the app being reloaded by iOS, and the screen stays on during a live workout (setting).
- Set inputs are 16px so iOS no longer zooms in; Done buttons are 44px. After ✓, focus moves to the next set and the screen doesn't jump.
- Finished exercises fold into a one-line summary once you move on; Technique/Pain sit on one compact row.
- Tapping ✓ redraws only that exercise card.
- The PR toast no longer covers the rest timer's buttons. Superset rest starts correctly when exercises have different set counts.
- Log a workout on an earlier day from History (select a day → "+ Log a workout on this day"), and edit a workout's date and duration.

Dark mode and visuals
- No white flash on launch. Fixed unreadable insight cards, white pop-ups, white program-day headers, invisible "Technique good" state, white ✓ buttons, and low-contrast text.
- Heat map: gray now means no sets; blue gets darker toward and past the target, with readable shades in both themes. Muscles are announced individually to VoiceOver.
- Charts show dates and high/low labels at a readable size; the two small charts stack on phones. Muscle table headers no longer collide. The History calendar is more compact.
- Accessibility: all set inputs are labelled, tappable rows work with keyboard/VoiceOver, the current tab is announced, and the page is no longer re-read aloud on every update. No automated contrast failures in light or dark mode.

Speed and offline
- Exercise analytics and Progress are much faster with long histories (about 1.1 s → 0.1 s with three years of data on a throttled phone CPU).
- The header logo uses the 41 KB icon instead of a 1.2 MB image, and the unused 1 MB logo is no longer downloaded for offline use (first install ~2.8 MB → ~0.6 MB).
- The service worker fetches fresh files when a new version installs, and the app shows "Strength OS has been updated — Reload".
- The version number now lives in two places: APP_VERSION in app.js and VERSION in sw.js.
- Code is formatted for readability (no logic changes from formatting alone).

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
