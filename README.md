# Strength OS — PWA

Strength OS is a local-first workout tracker built as a static Progressive Web App. It requires no backend, database service, app-store build, or workflow beyond GitHub Pages.

## What is included

### Exercise Library
- Built-in exercise library based on the original 5-day program
- Create custom exercises
- Primary and secondary muscle mapping
- Equipment, tracking type, rep/duration defaults, rest time, load increment, persistent notes
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
- Previous performance and progression suggestion
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
- Interactive front/back schematic training heat map

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

## Notes

- The body heat map is intentionally a **schematic training visualization**, not a medical/anatomical illustration.
- Effective sets use a default 0.5 contribution for secondary muscles. Direct sets remain separately visible.
- e1RM is a trend estimate, not a tested 1RM.
