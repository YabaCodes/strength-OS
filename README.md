# Strength OS — PWA

## v2.19.0 — tap sounds and bars that fill (review candidate)

**Tap sounds (optional, off by default).** More → Logging behavior → *Tap sounds*. When on, a live workout gets short, quiet tones: a soft two-note blip when a set is logged, a lower one when it's reopened, a rising three-note chime when an exercise's sets are all logged, a sparkle for a PR, and a warm chord with the workout summary. Switching days on Train and tabs in the bottom bar gives a faint tick. Turning the setting on plays a sample. The tones are generated on the spot with the existing Web Audio context (no sound files). On iPhones with Safari 16.4+, tap sounds use the *ambient* audio session so they mix with your music instead of pausing it; the rest-timer alert keeps its own setting and session. Editing an old workout makes no sounds.

**Bars and rings fill up.** Arriving at Train, a Progress tab or a muscle's details, the progress bars (muscle sets, goals, the target track) and the week and day rings grow from empty to their value, staggered slightly. Bars further down the page wait and fill when you scroll to them. Redraws after a change (saving a goal, switching back to the same tab) don't replay it. Reduce Motion turns it off.

One new setting (`tapSounds`, default off; older backups simply don't have it). No other data, storage or backup-format changes. All PWA files use app/cache version v2.19.0.

**iPhone acceptance (SF501–SF506):** SF501 Tap sounds is off after updating; turning it on plays a sample. SF502 with music playing (Spotify/Apple Music), log sets: tones mix in and the music doesn't stop. SF503 log, reopen, finish an exercise, hit a PR, finish a workout: each sound plays once; nothing when editing History. SF504 with the silent switch on: note whether the tones play (they should follow the switch on recent iOS). SF505 rest timer alert still sounds as before with tap sounds on and off. SF506 open Train and each Progress tab: bars and rings fill once; scrolling down Muscles fills the list as it appears; Reduce Motion: no animation.

## v2.18.0 — fluid Train screen, in-app confirms and workout summary (review candidate)

**Train is one Week card driven by the day you tap.** The dark program banner, the separate Today card and the "Still to do this week" list are merged into it. The card shows the active program, *This week* with a ring of planned sessions done (for example 2/5), and the seven-day ribbon. Each day has a small ring: how much of that day's workout was logged (a shortened or paused workout shows a part-filled ring), with a mark for done ✓, paused, skipped, **missed** (a planned day earlier this week with nothing logged, drawn dashed in amber), planned, done on another day, or rest. Below the ribbon, the chosen day's card shows what fits that day: today's plan with its exercises, the 2-day muscle check and *View workout* / *Mark skipped*; a logged day with sets, time and PRs and *View record*; a paused workout with *Resume* / *Discard*; a missed day with *View workout* to catch it up. Tapping a day only swaps that card (no full redraw, no jump). Starting a workout from any day still records it for **today**; selecting a day never creates, moves or re-dates a workout. A paused workout is a compact row at the top. The *Weekly progress* setting now shows or hides the week ring and count.

**No more browser pop-ups.** All 22 places that used the browser's confirm box (delete, discard, skip, reset, import, typo check, unit fix, finishing below 90%…) now use an in-app sheet with clear buttons (*Delete*, *Keep it* / *Put back*, *Log it anyway* / *Fix it*). Questions never overlap: one asked while another is showing waits its turn. Tapping outside the sheet, or Escape, answers no. The typo check still runs before a set is logged; *Fix it* puts the cursor back in the box. Changing a logged set to an odd number saves it and asks; *Put back* restores the old number.

**Finishing a live workout shows a summary**: duration, sets logged (of planned), volume, PRs by exercise, and the week ring filling from where it was. *Done* returns to Train (the day is already ticked); *See record* opens it in History. Editing an old workout still returns to History as before.

**Feel:** buttons, tabs, nav and ✓ give slightly under your finger; pop-ups slide up from the bottom on phones (a soft pop on wider screens) and keep their bottom edge above the keyboard while you type. All motion is off with iOS Reduce Motion.

No data schema, storage, migration or backup-format changes. All PWA files use app/cache version v2.18.0.

**iPhone acceptance (SF401–SF410):** SF401 Train at 320 and 390 px, light, dark and compact: one Week card, no sideways page scroll, ribbon scrolls on 320. SF402 tap each kind of day (done, shortened, paused, skipped, missed, planned, rest, done on another day): the right card, buttons work, no jump. SF403 Preview a missed or future day, start it: it's recorded for today. SF404 every confirm: Cancel/outside-tap does nothing, OK does the action (delete workout, discard, skip, delete program/day/exercise/goal/body entry, reset, import, undo import). SF405 typo check: 800 kg on bench → *Fix it* puts the cursor in the box with the keyboard; *Log it anyway* logs it. SF406 change a logged set to an odd number, then tap ✓ on the next set: one sheet at a time, *Put back* restores. SF407 finish complete below 90% → sheet → summary with the week ring; *Done* and *See record*. SF408 pop-ups with text boxes (body entry, exercise options, goal): the sheet stays above the keyboard and Save is reachable. SF409 press feedback and Reduce Motion. SF410 offline reopen; existing data and backups intact after the update.

## v2.17.0 — live workout feedback (review candidate)

Live workout logging now gives a brief visual acknowledgment when a set is checked or reopened, and shows **All sets logged** when an exercise's working sets are complete. A completed exercise gets subtle contextual styling and a short completion toast (unless a personal-record notification takes priority). The live workout progress bar smoothly advances from its previous percentage, with animation disabled when iOS Reduced Motion is enabled. These effects are restricted to active sessions; historical workout editing does not trigger celebratory feedback.

The existing set-logging mechanism is unchanged: values are synchronized from iPhone inputs before the set is recorded, the typo confirmation remains, records still save through IndexedDB, progress math and auto-rest conditions are unchanged, and the existing targeted re-render preserves scroll position and next-set focus. **No new audio, settings, data schema, migrations, or backup-format changes**. All PWA files use app/cache version v2.17.0.

**iPhone acceptance (SF301–SF308):** new visual check/reopen acknowledgment; all-sets-complete label and one-time toast; dynamic progress from both logging and reopening; no duplicated PR message; next-set focus, live typing and scroll position; rest timer and supersets; history editing with no celebratory effects; light/dark/compact and Reduced Motion, offline reopen, history/data retention.

## v2.16.0 — interactive training week

Train now includes a seven-day ribbon for the **current week**, respecting the selected Monday/Sunday week start. Tapping a date updates a contextual detail card and shows actual logged sessions (complete, shortened, skipped or paused) alongside the *current* program's weekday pattern. A completion ring shows scheduled sessions fulfilled by a matching completed or shortened workout; extra/unscheduled sessions do not inflate that percentage. Tapping View record, Resume or Preview uses the existing screens. Previewing a different weekday never backdates a new workout: starting a workout still records it on today's date.

The ribbon is **read-only**. It adds no settings or database fields and does not change workout data, plans, backup format, migration behavior or offline storage. It uses the existing theme and density tokens. On narrow phones the seven touch targets scroll horizontally; the current day is always indicated. The previous Train view and live workout workflow remain intact.

**iPhone acceptance:** confirm both light and dark themes; Monday/Sunday week starts; days with planned, completed, shortened, skipped, paused and unscheduled sessions; return from preview/history; 320–390 px layout; VoiceOver focus and labels; offline launch; existing data and backups after updating.

Strength OS is a local-first workout tracker built as a static Progressive Web App. It requires no backend, database service, app-store build, or workflow beyond GitHub Pages.

## What is included

### Default program (revised October 2026)
Five sessions ordered so no muscle is trained hard two days in a row; the main lifts come first in each session.

| Day | Session |
| --- | --- |
| Sunday | Legs A — squat, hack/leg press, leg extension, seated leg curl, hip adduction + hip abduction, standing calf raise, hanging knee raise |
| Tuesday | Shoulders + Arms — shoulder press, lateral raise, face pull, incline press, preacher curl, overhead triceps extension, shrug |
| Wednesday | Legs B — RDL, Bulgarian split squat, seated leg curl, seated row, seated calf raise, cable crunch, cable woodchop |
| Thursday | Chest + Triceps — bench, incline press, cable fly, overhead triceps extension, pressdown, lateral raise |
| Friday | Back + Biceps — pull-up, chest-supported row, lat pulldown, rear-delt fly, incline curl, hammer curl, wrist curl + reverse curl |

Existing users are offered the revision once (Train and Programs → *Apply to my program*); their previous program is kept as a copy and their history doesn't change. Users who already applied it are offered the v2.12 additions (forearms, side of the hip, obliques) the same way (*Add to my program*). The Train week marks sessions planned earlier in the week that haven't been done as missed, and warns when a session you'd train today works muscles trained in the last two days.

### Exercise Library
- Built-in library of 67 exercises: at least three for every muscle, chosen from the most effective options (v2.13). Filter by muscle to see the best first, with **Top pick** on the top one or two
- Every exercise shows what it targets under its name (for example "Upper chest (clavicular head)"), editable per exercise
- Create custom exercises
- Primary and secondary muscle mapping
- Equipment, tracking type, rep/duration defaults, rest time, load increment, persistent notes
- kg or lb per exercise (v2.14): a machine marked in lb is logged in lb while the rest stay in kg. Weights are saved in kg, so stats and PRs stay comparable
- Archive exercises without deleting historical data

### Program Builder
- Create multiple reusable programs
- Set an active program
- Add/edit/delete program days
- Assign weekdays
- Add/reorder/remove exercises
- Configure sets, rep ranges, RIR targets, rest, priority, superset group, and notes
- Duplicate programs

### Live Workout
- Start today's scheduled workout, another program day, or an empty workout
- Previous performance (each set as done, with the date and workout it came from) and a progression suggestion in the exercise's unit
- Tap the weight heading (KG / LB) to switch that exercise's unit; tapping a filled-in box selects it so typing replaces it
- Typo check before logging a set far outside what you usually do
- Warm-up, normal, drop, failure, and AMRAP set types
- Weight/reps, bodyweight, duration, and related tracking modes
- RIR and technique flags
- Pain/discomfort flag
- Automatic/manual rest timer
- Exercise substitution without changing the program
- Superset grouping
- Session and exercise notes
- Workout duration and completion progress
- Complete / shortened / skipped states
- Add/remove sets and exercises

### History
- Monthly calendar
- Full workout ledger
- Filters by exercise, muscle, and program
- Open/edit/delete historical workouts
- Historical workout snapshots preserve muscle mappings used at the time of the session

### Exercise Analytics
- Estimated 1RM
- Highest load
- Best session volume
- Last performed
- e1RM trend
- Top-load trend
- Session-volume trend
- Exercise-specific history
- Weight, estimated-1RM, rep-at-load, and session-volume PR detection

### Muscle Analytics
- Direct sets
- Effective sets including secondary-muscle fractional credit
- Editable weekly target ranges
- Current week vs target
- Previous week and 4-week context
- Exercise contributors per muscle
- Front/back body map (v2.15): an anatomical figure with each muscle coloured by this week's effective sets against its target (None, Started, Close, On target, Over). Tap a muscle to see its sets, what counted and what your next planned workout adds

### Body
- Bodyweight and 7-day average
- Waist measurement
- Optional chest, arms, thighs, calves, and hips measurements
- Bodyweight and waist trend charts
- Editable/deletable measurement history

### Goals and Insights
- Exercise e1RM goal
- Exercise load goal
- Bodyweight goal
- Waist maximum goal
- Weekly workout-consistency goal
- Low-volume muscle alerts
- Push/pull balance insight
- Frequent-shortened-workout detection
- Basic plateau detection from repeated e1RM data

### Utilities / Settings
- kg/lb exercise-load display
- Monday/Sunday week start
- RIR on/off
- Automatic rest timer on/off
- Plate calculator
- Warm-up calculator
- Configurable plate inventory
- Configurable body fields
- JSON backup / restore
- V1 backup import and migration
- Data Health checks for structural/data-entry problems

## Updating the existing GitHub Pages app

**Best option if you want automatic migration of your existing workout history:** keep the same repository and GitHub Pages URL.

1. Export a JSON backup from the existing app first as an extra precaution.
2. Unzip the Strength OS package.
3. In the existing GitHub repository, replace the old app files with the files from this folder.
4. Make sure these files are directly at the repository root:
   - `index.html`
   - `styles.css`
   - `seed.js`
   - `app.js`
   - `manifest.json`
   - `sw.js`
   - `icons/`
5. Commit the changes to the branch already used by GitHub Pages.
6. Open the existing GitHub Pages URL.

Because the URL/origin stays the same, Strength OS looks for the previous `strengthProteinTrackerV1` local-storage data and migrates:
- workout history
- sets / weights / reps / RIR
- technique and pain flags
- bodyweight entries
- waist entries

Nutrition/protein/creatine data is deliberately not brought into Strength OS.

The original V1 JSON is also retained locally as a migration backup until browser storage is cleared.

## Using a new repository or a different Pages URL

A new Pages URL has separate browser storage, so automatic migration cannot see the old app's local data.

Instead:
1. Open the old tracker and use **Export JSON**.
2. Deploy Strength OS to the new repository.
3. Open **More → Backup & restore → Import JSON**.
4. Select the old V1 JSON file.

Strength OS detects the legacy format and migrates it during import.

## GitHub Pages deployment from scratch

1. Create a repository.
2. Upload the **contents of this folder**, not the ZIP itself.
3. GitHub → repository **Settings → Pages**.
4. Choose **Deploy from a branch** and select `main` / root.
5. Open the Pages URL in Safari.
6. iPhone/iPad: **Share → Add to Home Screen**.

## Data model / privacy

All training and body-measurement data stays in browser storage on the device. There is no cloud account or external database. Use regular JSON exports as backups, especially before clearing browser data or changing devices.

Since v2.9.0 the data is saved in the browser's IndexedDB (database `strength-os`, store `kv`), which has no practical size limit for this app. Before that it was saved in localStorage, which stops accepting changes at about 5 MB (roughly 3–4 years of logging).

- The app works on an in-memory copy and hands every change to IndexedDB immediately, so a set logged right before the app is closed is kept.
- On the first launch of v2.9.0 the data, the import/reset undo copy and the V1 migration copy are copied from localStorage to IndexedDB, read back and compared, and only then removed from localStorage. A safety copy of the data from before the move is kept in IndexedDB for 30 days (downloadable under More → Storage upgrade) and is then removed automatically.
- After the move, data found in localStorage is only taken if it is a newer version of the same profile (same `meta.createdAt`): changes saved by an older copy of the app that was still open, or the emergency copy written to localStorage when saving to IndexedDB keeps failing. A different or empty profile never replaces your data; whichever version isn't kept becomes the safety copy.
- While saved data can't be opened, import, reset and undo are turned off.
- localStorage keeps only small helpers: `strengthOSPrefs` (theme and density, so dark mode is applied before the first paint), `strengthOSStorage` (records that the data moved, and when), and `strengthOSRestTimer` (a running rest timer).
- If a browser can't use IndexedDB at all, the app keeps using localStorage as before. If the data has already moved but IndexedDB can't be opened, the app shows a banner and saves nothing until it opens again, so an empty profile is never written over your data.

## Layout rules (v2.10.0)

So screens stay consistent as features are added, the last block of `styles.css` defines the shared rules:

- `--gap` (14 px; 8 px in Compact) between cards on every screen, `--tile-gap` (10 px) between tiles and rows inside a card. Put cards in a `.stack`.
- Stat tiles: `.grid-3` with three tiles stays one row; other odd counts make the last tile span the row.
- Choices use the segmented control (`.seg`), on/off options use switches (`input.switch` in a `.setting-row`), links to sub-screens use `.nav-row`.
- Several actions on one row go into a ⋯ menu (`openActionSheet`) rather than a row of small buttons.
- Lists longer than 5 rows use `collapsibleAttrs` / `showAllButton`.
- Headings that show a name use `nameHTML()` so hyphenated words like "5-Day" don't break.

## Notes

- The body map is a **training visualization**: muscles are drawn in their real places and shapes so they are easy to recognise, but it is not a medical illustration.
- Effective sets use a default 0.5 contribution for secondary muscles. Direct sets remain separately visible.
- e1RM is a trend estimate, not a tested 1RM.
