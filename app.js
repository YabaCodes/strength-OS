(() => {
  "use strict";
  const SEED = window.STRENGTH_OS_SEED;
  const SEED_FOCUS = Object.fromEntries(SEED.exercises.map((e) => [e.id, e.focus || ""]));
  const LATEST_PROGRAM_UPDATE = SEED.programAdditions?.id || SEED.programRevision?.id;
  // Best-first order of the built-in exercises for each muscle (seed.js "best"); the first group is the Top pick.
  const BEST_RANK = {},
    TOP_PICKS = new Set();
  Object.entries(SEED.best || {}).forEach(([muscle, [top = [], rest = []]]) => {
    [...top, ...rest].forEach((id, i) => (BEST_RANK[`${muscle}:${id}`] = i));
    top.forEach((id) => TOP_PICKS.add(`${muscle}:${id}`));
  });
  const KEY = "strengthOSV2";
  const LEGACY_KEY = "strengthProteinTrackerV1";
  const MIGRATION_BACKUP_KEY = "strengthOSMigrationBackupV1";
  const PRE_IMPORT_KEY = "strengthOSPreImportBackup";
  const REST_KEY = "strengthOSRestTimer";
  // Since v2.9.0 your data lives in IndexedDB. localStorage only keeps small helpers:
  const STORAGE_MARK_KEY = "strengthOSStorage"; // where the data lives + when it moved
  const PRE_UPGRADE_KEY = "strengthOSV2PreUpgrade"; // IndexedDB: safety copy from the move, removed after 30 days
  const PREFS_KEY = "strengthOSPrefs"; // theme + density, read before the first paint (index.html)
  const DB_NAME = "strength-os",
    DB_STORE = "kv";
  const PRE_UPGRADE_DAYS = 30;
  const VERSION = 3;
  const APP_VERSION = "2.19.0"; // Bump together with VERSION in sw.js.
  const trackingTypes = [
    ["weight_reps", "Weight + reps"],
    ["bodyweight_reps", "Bodyweight + reps"],
    ["bodyweight_added", "Bodyweight + added weight"],
    ["assisted_bodyweight", "Assisted bodyweight"],
    ["duration", "Duration"],
    ["weight_duration", "Weight + duration"],
    ["reps_only", "Reps only"],
    ["distance_duration", "Distance + duration"],
  ];
  const equipments = [
    "Barbell",
    "Dumbbell",
    "Cable",
    "Machine",
    "Bodyweight",
    "Smith Machine",
    "EZ Bar",
    "Kettlebell",
    "Plate",
    "Bands",
    "Other",
  ];
  const setTypes = [
    ["warmup", "W"],
    ["normal", "N"],
    ["drop", "D"],
    ["failure", "F"],
    ["amrap", "A"],
  ];
  const bodyFields = [
    ["weight", "Weight", "kg"],
    ["waist", "Waist", "cm"],
    ["chest", "Chest", "cm"],
    ["armLeft", "Left arm", "cm"],
    ["armRight", "Right arm", "cm"],
    ["thighLeft", "Left thigh", "cm"],
    ["thighRight", "Right thigh", "cm"],
    ["calfLeft", "Left calf", "cm"],
    ["calfRight", "Right calf", "cm"],
    ["hips", "Hips", "cm"],
  ];
  const byId = (id) => document.getElementById(id);
  const view = byId("view"),
    toast = byId("toast"),
    modal = byId("modal"),
    modalForm = byId("modalForm"),
    modalBody = byId("modalBody"),
    modalActions = byId("modalActions");
  let dataRev = 0,
    recoveryRaw = null,
    saveFailed = false,
    updateReady = false;
  let state = null; // loaded in boot()
  let activeView = "train";
  let trainSelectedDate = isoToday(); // Transient Train week selection; never stored or written to workouts.
  let progressTab = "overview";
  let historyMonth = startOfMonth(isoToday());
  let historyExerciseFilter = "all",
    historyMuscleFilter = "all",
    historyProgramFilter = "all";
  let selectedHistoryDate = null,
    selectedHistorySessionId = null;
  let librarySearch = "";
  let libraryMuscle = "all",
    libraryScope = "active";
  let selectedProgramId = null;
  let selectedExerciseAnalyticsId = "bench";
  let selectedMuscleTrendId = "chest";
  let muscleTrendWeeks = 8;
  let selectedBodyMetric = "weight";
  let bodyRangeDays = 90;
  let exerciseAnalyticsRangeDays = 90;
  let trainPreviewProgramId = null,
    trainPreviewDayId = null;
  let restInterval = null,
    restEndAt = 0;
  let elapsedInterval = null;
  let deferredInstallPrompt = null;
  let expandedItems = new Set(),
    lastTouchedItemId = null;
  let wakeLock = null,
    audioCtx = null;
  let indexCache = null; // see historyIndex()
  let mapMuscle = null; // muscle tapped on the body map (Progress → Muscles)
  const typedLoads = new Set(); // sets whose weight you typed while the app was open (not pre-filled)

  // Listeners that must be in place before saved data finishes loading, so these one-off events aren't missed.
  function early() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      byId("installBtn").classList.remove("hidden");
    });
    if ("serviceWorker" in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker
        .register("./sw.js")
        .then((reg) => {
          // A phone app brought back from the background doesn't reload, so without this it only
          // looked for a new version after being closed completely.
          let lastCheck = Date.now();
          const check = () => {
            if (Date.now() - lastCheck < 10 * 60 * 1000) return;
            lastCheck = Date.now();
            reg.update().catch(() => {});
          };
          document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") check();
          });
          setInterval(check, 60 * 60 * 1000);
        })
        .catch(() => {});
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (!hadController) return;
        updateReady = true;
        renderBanner();
      });
    }
  }
  async function boot() {
    try {
      await openStore();
    } catch (e) {
      console.warn("Storage setup failed", e);
    }
    state = loadState();
    selectedProgramId = state.settings.activeProgramId;
    if (!recoveryRaw && !storageBlocked && !dataMissing) mirrorPrefs();
    init();
  }

  // ---------- STORAGE ----------
  // The app works on an in-memory copy of your data and writes every change straight to IndexedDB, which has no
  // ~5 MB limit. If a browser can't use IndexedDB at all, the app keeps using localStorage as before.
  const mem = new Map(),
    dirty = new Set();
  let backend = "local",
    db = null,
    commitQueued = false,
    flushing = false,
    storageBlocked = false,
    dataMissing = false, // data had moved to IndexedDB but none was found there
    storageMark = null;

  const store = {
    get(k) {
      if (backend !== "idb") return localStorage.getItem(k);
      return mem.has(k) ? mem.get(k) : null;
    },
    // localStorage mode: throws when storage is full, exactly as before.
    // IndexedDB mode: all changes from one tap are saved together in one transaction, started before the tap is
    // over, so closing the app right after still keeps them. A failure shows the "Changes aren't being saved"
    // banner and is retried.
    set(k, v) {
      if (backend !== "idb") return localStorage.setItem(k, v);
      mem.set(k, v);
      queueCommit(k);
    },
    remove(k) {
      if (backend !== "idb") return localStorage.removeItem(k);
      mem.delete(k);
      queueCommit(k);
    },
  };
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch {
      return false;
    }
  }
  function lsRemove(k) {
    try {
      localStorage.removeItem(k);
    } catch {}
  }
  function withTimeout(promise, ms, what) {
    let timer;
    const late = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} took too long`)), ms);
    });
    return Promise.race([promise, late]).finally(() => clearTimeout(timer));
  }
  function closeDb() {
    try {
      db?.close();
    } catch {}
    db = null;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (e) => {
        if (settled) return;
        settled = true;
        reject(e || new Error("IndexedDB could not be opened"));
      };
      const timer = setTimeout(() => fail(new Error("IndexedDB took too long to open")), 4000);
      let req;
      try {
        req = indexedDB.open(DB_NAME, 1);
      } catch (e) {
        clearTimeout(timer);
        return fail(e);
      }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => {
        clearTimeout(timer);
        const d = req.result;
        if (settled) return d.close();
        settled = true;
        // If the browser drops the connection (iOS sometimes does), the next write opens a new one.
        d.onversionchange = () => {
          d.close();
          if (db === d) db = null;
        };
        d.onclose = () => {
          if (db === d) db = null;
        };
        resolve(d);
      };
      req.onerror = () => {
        clearTimeout(timer);
        fail(req.error);
      };
    });
  }
  async function idbReadAll() {
    if (!db) db = await openDb();
    const read = new Promise((resolve, reject) => {
      const out = new Map(),
        tx = db.transaction(DB_STORE, "readonly"),
        req = tx.objectStore(DB_STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        out.set(c.key, c.value);
        c.continue();
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Read failed"));
    });
    return withTimeout(read, 8000, "Reading saved data");
  }
  // All entries in one transaction: either every one is saved or none is.
  async function idbWrite(entries) {
    if (!db) db = await openDb();
    const write = new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, "readwrite"),
        os = tx.objectStore(DB_STORE);
      entries.forEach(([k, v]) => (v == null ? os.delete(k) : os.put(v, k)));
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Write failed"));
    });
    return withTimeout(write, 10000, "Saving");
  }

  function queueCommit(k) {
    dirty.add(k);
    if (commitQueued) return;
    commitQueued = true;
    queueMicrotask(commitNow); // runs as soon as the current tap's code finishes, before anything else
  }
  // The browser runs these transactions in the order they were started, and each writes the latest value of every
  // changed key, so an older value can never overwrite a newer one.
  function commitNow() {
    commitQueued = false;
    if (!dirty.size) return;
    if (flushing || !db) return scheduleFlush();
    const keys = [...dirty];
    dirty.clear();
    let tx;
    try {
      tx = db.transaction(DB_STORE, "readwrite");
      const os = tx.objectStore(DB_STORE);
      keys.forEach((key) => (mem.has(key) ? os.put(mem.get(key), key) : os.delete(key)));
      if (tx.commit) tx.commit();
    } catch {
      try {
        tx?.abort();
      } catch {}
      keys.forEach((key) => dirty.add(key));
      return scheduleFlush();
    }
    // A save that hasn't finished after 10 seconds is treated as failed and retried the slow way.
    const watchdog = setTimeout(() => {
      tx.oncomplete = tx.onabort = null;
      try {
        tx.abort();
      } catch {}
      keys.forEach((key) => dirty.add(key));
      scheduleFlush();
    }, 10000);
    tx.oncomplete = () => {
      clearTimeout(watchdog);
      if (saveFailed && !dirty.size && !flushing) savesWorkAgain();
    };
    tx.onabort = () => {
      clearTimeout(watchdog);
      keys.forEach((key) => dirty.add(key)); // retried with the latest value of each
      scheduleFlush();
    };
  }
  function scheduleFlush() {
    if (flushing) return;
    flushing = true;
    Promise.resolve().then(flush);
  }
  // Slow path: reconnect if needed and retry. If saving still fails, show the banner and keep an emergency copy in
  // localStorage; the next launch moves it back into IndexedDB.
  async function flush() {
    let retried = false;
    while (dirty.size) {
      const keys = [...dirty];
      dirty.clear();
      try {
        await idbWrite(keys.map((k) => [k, mem.has(k) ? mem.get(k) : null]));
        retried = false;
        if (saveFailed && !dirty.size) savesWorkAgain();
      } catch (e) {
        keys.forEach((k) => dirty.add(k));
        if (!retried) {
          retried = true;
          closeDb();
          continue;
        }
        console.warn("Save failed", e);
        saveFailed = true;
        if (mem.has(KEY)) lsSet(KEY, mem.get(KEY));
        renderBanner();
        break; // the next change tries again
      }
    }
    flushing = false;
  }
  function savesWorkAgain() {
    saveFailed = false;
    lsRemove(KEY); // the emergency copy is no longer needed
    renderBanner();
  }

  function metaOf(text) {
    try {
      const m = JSON.parse(text)?.meta || {};
      return { created: m.createdAt ?? null, saved: Number(m.updatedAt) || 0 };
    } catch {
      return { created: null, saved: 0 };
    }
  }
  async function openStore() {
    try {
      storageMark = JSON.parse(lsGet(STORAGE_MARK_KEY) || "null");
    } catch {}
    const movedToIdb = storageMark?.backend === "indexeddb";
    if (!window.indexedDB) {
      // Your data is in IndexedDB but this browser can't open it now: don't start an empty profile on top of it.
      if (movedToIdb) storageBlocked = true;
      return;
    }
    let saved;
    try {
      try {
        db = await openDb();
      } catch {
        db = await openDb(); // one retry; iOS occasionally fails the first open after launch
      }
      saved = await idbReadAll();
    } catch (e) {
      console.warn("IndexedDB unavailable", e);
      closeDb();
      if (movedToIdb) storageBlocked = true;
      return; // otherwise keep using localStorage
    }

    // Move what's in localStorage. Normally this happens once, on the first launch of v2.9.0. Later it only picks
    // up a newer version of the same data (saved by an older copy of the app that was still open, or the emergency
    // copy from a failed save), never a different or empty profile. Whichever version isn't kept becomes the
    // 30-day safety copy.
    const lsData = lsGet(KEY),
      idbData = saved.get(KEY) ?? null,
      moves = [];
    if (lsData != null && lsData !== idbData) {
      const fromLs = metaOf(lsData),
        inIdb = metaOf(idbData);
      const lsWins =
        idbData == null || (fromLs.created != null && fromLs.created === inIdb.created && fromLs.saved >= inIdb.saved);
      moves.push([PRE_UPGRADE_KEY, lsWins ? (idbData ?? lsData) : lsData]);
      if (lsWins) moves.push([KEY, lsData]);
    }
    for (const k of [PRE_IMPORT_KEY, MIGRATION_BACKUP_KEY]) {
      const v = lsGet(k);
      if (v != null && !saved.has(k)) moves.push([k, v]);
    }
    try {
      if (moves.length) {
        await idbWrite(moves);
        // Read everything back and compare before removing anything from localStorage.
        const check = await idbReadAll();
        if (moves.some(([k, v]) => check.get(k) !== v)) throw new Error("The copy in IndexedDB didn't match");
        moves.forEach(([k, v]) => saved.set(k, v));
      }
    } catch (e) {
      console.warn("Moving data to IndexedDB failed; staying on localStorage for now", e);
      closeDb();
      if (movedToIdb) storageBlocked = true;
      return;
    }
    if (lsData != null) lsRemove(KEY);
    for (const k of [PRE_IMPORT_KEY, MIGRATION_BACKUP_KEY]) if (saved.has(k)) lsRemove(k);
    const newCopy = moves.some(([k]) => k === PRE_UPGRADE_KEY);
    if (!movedToIdb || newCopy || (saved.has(PRE_UPGRADE_KEY) && !storageMark?.movedAt)) {
      storageMark = { backend: "indexeddb", movedAt: newCopy || !storageMark?.movedAt ? Date.now() : storageMark.movedAt };
      lsSet(STORAGE_MARK_KEY, JSON.stringify(storageMark));
    }
    saved.forEach((v, k) => mem.set(k, v));
    backend = "idb";
    // Nothing found where your data should be. Start empty, but don't save until you change something, so a
    // read that wrongly came back empty can't overwrite anything.
    dataMissing = movedToIdb && !saved.has(KEY);
    if (mem.has(PRE_UPGRADE_KEY) && Date.now() - storageMark.movedAt > PRE_UPGRADE_DAYS * 864e5)
      store.remove(PRE_UPGRADE_KEY);
  }
  function mirrorPrefs() {
    const v = JSON.stringify({ theme: state.settings.theme, density: state.settings.density });
    if (mirrorPrefs.last === v) return;
    if (lsSet(PREFS_KEY, v)) mirrorPrefs.last = v;
  }
  function preUpgradeCopy() {
    const text = backend === "idb" ? mem.get(PRE_UPGRADE_KEY) : null;
    return text && storageMark?.movedAt ? { text, until: new Date(storageMark.movedAt + PRE_UPGRADE_DAYS * 864e5) } : null;
  }
  // While saved data can't be opened, anything that replaces or restores data is turned off, so a placeholder
  // profile can't end up in the undo copy.
  function dataLocked() {
    if (!recoveryRaw && !storageBlocked) return false;
    showToast("Your saved data couldn't be opened, so this is turned off until it opens.");
    return true;
  }

  function init() {
    byId("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    if (byId("appVersionLabel")) byId("appVersionLabel").textContent = `v${APP_VERSION}`;
    applyPreferences();
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onThemeChange = () => {
        if (state.settings.theme === "system") applyPreferences();
      };
      if (mq.addEventListener) mq.addEventListener("change", onThemeChange);
      else if (mq.addListener) mq.addListener(onThemeChange);
    }
    document.querySelectorAll(".nav-btn").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.view !== activeView) playTapSound("tick");
        navigate(b.dataset.view);
      }),
    );
    byId("cancelTimer").addEventListener("click", stopRestTimer);
    byId("restMinusBtn").addEventListener("click", () => adjustRestTimer(-30));
    byId("restPlusBtn").addEventListener("click", () => adjustRestTimer(30));
    byId("quickWeightBtn").addEventListener("click", () => openBodyEntryModal(isoToday(), "weight"));
    byId("installBtn").addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      byId("installBtn").classList.add("hidden");
    });
    // Pop-ups: Return/Go triggers the main button instead of closing and discarding what you typed.
    modalForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (e.submitter?.value === "cancel") return closeModal();
      modalActions.querySelector(".btn.primary")?.click();
    });
    byId("modalCloseBtn")?.addEventListener("click", closeModal);
    watchKeyboardForSheets();
    // iOS only shows :active (the press-down feedback on buttons) once a touch listener exists on the page.
    document.addEventListener("touchstart", () => {}, { passive: true });
    view.addEventListener("click", (e) => {
      const b = e.target.closest(".show-more");
      if (!b) return;
      const key = b.dataset.list,
        open = !expandedLists.has(key);
      if (open) expandedLists.add(key);
      else expandedLists.delete(key);
      view.querySelector(`.collapsible[data-list="${key}"]`)?.classList.toggle("collapsed", !open);
      b.textContent = open ? "Show less" : `Show all ${b.dataset.count}`;
      b.setAttribute("aria-expanded", String(open));
    });
    // iOS unlocks audio on a completed tap, so listen for both.
    ["touchend", "click"].forEach((t) => document.addEventListener(t, unlockAudio, { passive: true, capture: true }));
    // Rows that open something behave like buttons for keyboard and VoiceOver users.
    document.addEventListener("keydown", (e) => {
      const row = e.target.closest?.(".click-row");
      if (row && e.target === row && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        row.click();
      }
    });
    new MutationObserver(() => {
      document.querySelectorAll(".click-row:not([tabindex])").forEach((r) => {
        r.setAttribute("tabindex", "0");
        r.setAttribute("role", "button");
      });
    }).observe(byId("app"), { childList: true, subtree: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      if (restEndAt) tickRest();
      const live = liveSession();
      if (live && !live.endTime) requestWakeLock();
    });
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    renderBanner();
    restoreRestTimer();
    render();
  }

  function newState() {
    const exerciseMap = Object.fromEntries(SEED.exercises.map((e) => [e.id, clone(e)]));
    const p = clone(SEED.program);
    return {
      version: VERSION,
      meta: { createdAt: Date.now(), updatedAt: Date.now(), migratedFrom: null },
      settings: {
        units: "kg",
        weekStarts: "sunday",
        trackRir: true,
        autoRest: true,
        secondaryMultiplier: 0.5,
        theme: "system",
        density: "comfortable",
        defaultExerciseRest: 90,
        showWeeklyProgress: true,
        trainMetrics: ["weight", "waist"],
        restSound: true,
        tapSounds: false,
        keepAwake: true,
        activeProgramId: p.id,
        visibleBodyFields: ["weight", "waist"],
        plateInventory: [20, 15, 10, 5, 2.5, 1.25],
        barWeight: 20,
        muscleTargets: clone(SEED.targetRanges),
      },
      exercises: exerciseMap,
      programs: { [p.id]: p },
      sessions: [],
      bodyEntries: [],
      goals: [],
      currentWorkoutId: null,
    };
  }

  function loadState() {
    if (storageBlocked) return newState(); // read-only until the saved data can be opened again
    let raw = null;
    try {
      raw = store.get(KEY);
      if (raw) {
        const original = JSON.parse(raw),
          normalized = normalizeState(migrateStateSchema(original));
        backfillGoalBaselines(normalized);
        if (Number(original.version) !== VERSION) store.set(KEY, JSON.stringify(normalized));
        return normalized;
      }
      const legacy = lsGet(LEGACY_KEY); // the V1 tracker's own data stays where it was
      if (legacy) {
        store.set(MIGRATION_BACKUP_KEY, legacy);
        const migrated = migrateLegacy(JSON.parse(legacy));
        store.set(KEY, JSON.stringify(migrated));
        return migrated;
      }
    } catch (e) {
      console.warn("State load failed", e);
      // Never overwrite saved data that failed to load. Keep the app read-only and offer the raw data for download.
      if (raw) {
        recoveryRaw = raw;
        return newState();
      }
    }
    const s = newState();
    s.meta.programRevision = LATEST_PROGRAM_UPDATE;
    try {
      if (!dataMissing) store.set(KEY, JSON.stringify(s));
    } catch {}
    return s;
  }
  function backfillGoalBaselines(s) {
    // Weight and waist goals need a starting point to know whether you are gaining or cutting.
    // Goals created before v2.6, or before the first weigh-in, have none; use the latest logged value.
    let changed = false;
    (s.goals || []).forEach((g) => {
      if (!["weight", "waist"].includes(g.type) || num(g.baseline) > 0) return;
      const field = g.type === "waist" ? "waist" : "weight";
      const entries = [...(s.bodyEntries || [])].filter((x) => num(x[field]) > 0).sort((a, b) => a.date.localeCompare(b.date));
      const since = g.createdAt ? isoFromDate(new Date(g.createdAt)) : null;
      // Goal made before the first weigh-in: start from the first weigh-in after it. Older goals: start from now.
      const pick = since ? entries.find((x) => x.date >= since) || entries.at(-1) : entries.at(-1);
      if (pick) {
        g.baseline = num(pick[field]);
        changed = true;
      }
    });
    return changed;
  }

  function migrateStateSchema(input) {
    const s = clone(input || {}),
      from = Number(s.version) || 1;
    if (from < VERSION) {
      s.meta = {
        ...(s.meta || {}),
        schemaMigrations: [...((s.meta || {}).schemaMigrations || []), { from, to: VERSION, at: Date.now() }],
        lastMigratedAt: Date.now(),
      };
      s.settings = { ...(s.settings || {}) };
      if (from < 3) {
        if (!s.settings.theme) s.settings.theme = "system";
        if (!s.settings.density) s.settings.density = "comfortable";
        if (!Number.isFinite(Number(s.settings.defaultExerciseRest))) s.settings.defaultExerciseRest = 90;
        if (typeof s.settings.showWeeklyProgress !== "boolean") s.settings.showWeeklyProgress = true;
        if (!Array.isArray(s.settings.trainMetrics)) s.settings.trainMetrics = ["weight", "waist"];
      }
      s.version = VERSION;
    }
    return s;
  }

  function applyPreferences() {
    const pref = state?.settings?.theme || "system";
    const resolved =
      pref === "system" && window.matchMedia
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : pref;
    document.body.dataset.theme = resolved === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = resolved === "dark" ? "dark" : "light";
    document.body.dataset.density = state?.settings?.density === "compact" ? "compact" : "comfortable";
    document.documentElement.dataset.density = document.body.dataset.density;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", resolved === "dark" ? "#0b1120" : "#f5f7fa");
  }

  function normalizeState(s) {
    const base = newState();
    return {
      ...base,
      ...s,
      version: VERSION,
      meta: { ...base.meta, ...(s.meta || {}) },
      settings: {
        ...base.settings,
        ...(s.settings || {}),
        muscleTargets: { ...base.settings.muscleTargets, ...(s.settings?.muscleTargets || {}) },
      },
      exercises: { ...base.exercises, ...(s.exercises || {}) },
      programs: s.programs && Object.keys(s.programs).length ? s.programs : base.programs,
      sessions: Array.isArray(s.sessions) ? s.sessions : [],
      bodyEntries: Array.isArray(s.bodyEntries) ? s.bodyEntries : [],
      goals: Array.isArray(s.goals) ? s.goals : [],
    };
  }

  function migrateLegacy(old) {
    const s = newState();
    s.meta.programRevision = LATEST_PROGRAM_UPDATE;
    s.meta.migratedFrom = "strengthProteinTrackerV1";
    s.meta.migratedAt = Date.now();
    Object.entries(old.body || {}).forEach(([date, v]) => {
      const entry = { id: uid("body"), date };
      if (num(v.weight) > 0) entry.weight = num(v.weight);
      if (num(v.waist) > 0) entry.waist = num(v.waist);
      s.bodyEntries.push(entry);
    });
    Object.entries(old.workouts || {}).forEach(([date, w]) => {
      const dayId = SEED.legacyProgramDayMap[w.programKey] || null;
      const pday = SEED.program.days.find((d) => d.id === dayId);
      const session = {
        id: uid("sess"),
        date,
        programId: SEED.program.id,
        programDayId: dayId,
        name: pday?.name || "Migrated workout",
        status: w.status || "complete",
        startTime: null,
        endTime: w.completedAt || null,
        notes: "Migrated from Strength + Protein Tracker",
        items: [],
      };
      Object.entries(w.exercises || {}).forEach(([oldId, x]) => {
        const exId = SEED.legacyExerciseMap[oldId] || oldId;
        const ex = s.exercises[exId];
        if (!ex) return;
        session.items.push({
          id: uid("item"),
          exerciseId: exId,
          exerciseSnapshot: snapshotExercise(ex),
          substitutedForExerciseId: null,
          supersetGroup: "",
          notes: "",
          techniqueGood: x.techniqueGood !== false,
          pain: x.pain || "none",
          sets: (x.sets || []).map((st) => ({
            id: uid("set"),
            type: st.warmup ? "warmup" : "normal",
            loadKg: num(st.load) || 0,
            reps: num(st.reps) || 0,
            rir: st.rir === "" || st.rir == null ? null : num(st.rir),
            durationSec: 0,
            distanceKm: 0,
            complete: num(st.reps) > 0,
          })),
        });
      });
      if (session.items.length) s.sessions.push(session);
    });
    s.sessions.sort((a, b) => a.date.localeCompare(b.date));
    return s;
  }

  function save() {
    dataRev++;
    if (recoveryRaw || storageBlocked) {
      renderBanner();
      return false;
    }
    state.meta.updatedAt = Date.now();
    if (dataMissing) {
      dataMissing = false;
      renderBanner();
    }
    try {
      store.set(KEY, JSON.stringify(state));
      mirrorPrefs();
      if (backend !== "idb" && saveFailed) {
        saveFailed = false;
        renderBanner();
      }
      return true;
    } catch (e) {
      console.warn("Save failed", e);
      saveFailed = true;
      renderBanner();
      return false;
    }
  }
  function storageBytes() {
    try {
      // localStorage counts 2 bytes per character toward its limit; IndexedDB is reported as the data's size.
      return (store.get(KEY) || "").length * (backend === "idb" ? 1 : 2);
    } catch {
      return 0;
    }
  }
  function renderBanner() {
    const el = byId("appBanner");
    if (!el) return;
    let html = "";
    if (storageBlocked)
      html = `<div class="banner danger"><strong>Your saved data couldn't be opened right now.</strong><span>Nothing has been changed, and new changes won't be saved until it opens. Close Strength OS completely and open it again.</span><div class="wrap"><button class="btn primary small-btn" id="bannerReloadBtn" type="button">Try again</button></div></div>`;
    else if (recoveryRaw)
      html = `<div class="banner danger"><strong>Your saved data couldn't be opened.</strong><span>Nothing has been changed or overwritten, and new changes won't be saved until this is fixed. Download the raw data so it can be repaired.</span><div class="wrap"><button class="btn primary small-btn" id="bannerRawBtn" type="button">Download raw data</button></div></div>`;
    else if (saveFailed)
      html = `<div class="banner danger"><strong>Changes aren't being saved.</strong><span>Browser storage is full or blocked. Export a backup now so nothing is lost.</span><div class="wrap"><button class="btn primary small-btn" id="bannerExportBtn" type="button">Export backup</button></div></div>`;
    else if (dataMissing)
      html = `<div class="banner info"><strong>No saved workouts were found on this device.</strong><span>If you have a backup, import it from More → Data health. Nothing is saved until you change something.</span><div class="wrap"><button class="btn primary small-btn" id="bannerDataHealthBtn" type="button">Go to Data health</button></div></div>`;
    else if (updateReady)
      html = `<div class="banner info"><strong>Strength OS has been updated.</strong><span>Reload to use the new version.</span><div class="wrap"><button class="btn primary small-btn" id="bannerReloadBtn" type="button">Reload</button></div></div>`;
    el.innerHTML = html;
    el.classList.toggle("hidden", !html);
    byId("bannerRawBtn")?.addEventListener("click", () =>
      downloadText(`strength-os-raw-${isoToday()}.json`, recoveryRaw, "application/json"),
    );
    byId("bannerExportBtn")?.addEventListener("click", exportBackup);
    byId("bannerReloadBtn")?.addEventListener("click", () => location.reload());
    byId("bannerDataHealthBtn")?.addEventListener("click", () => navigate("more"));
  }

  // Per-exercise index of logged (complete/shortened) work. Rebuilt lazily after every save.
  function historyIndex() {
    if (indexCache && indexCache.rev === dataRev) return indexCache;
    const byExercise = new Map(),
      sessionsById = new Map();
    state.sessions.forEach((s) => {
      sessionsById.set(s.id, s);
      if (!["complete", "shortened"].includes(s.status)) return;
      (s.items || []).forEach((item) => {
        if (!byExercise.has(item.exerciseId)) byExercise.set(item.exerciseId, []);
        byExercise.get(item.exerciseId).push({ session: s, item, sets: workingSets(item) });
      });
    });
    byExercise.forEach((list) =>
      list.sort((a, b) => a.session.date.localeCompare(b.session.date) || (a.session.endTime || 0) - (b.session.endTime || 0)),
    );
    indexCache = { rev: dataRev, byExercise, sessionsById };
    return indexCache;
  }
  function exerciseEntries(exId) {
    return historyIndex().byExercise.get(exId) || [];
  }
  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }
  function uid(prefix = "id") {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function clamp(v, min, max) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : null;
  }
  function esc(v) {
    return String(v ?? "").replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  }
  // Names in headings keep "5-Day" or "Single-Arm" together instead of breaking at the hyphen.
  function nameHTML(v) {
    return esc(v).replace(/[^\s<>&;]*-[^\s<>&;]+/g, (w) => `<span class="nw">${w}</span>`);
  }
  function cap(s) {
    return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : "";
  }
  function isoToday() {
    const d = new Date();
    return isoFromDate(d);
  }
  function isoFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  function dateObj(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }
  function addDays(s, n) {
    const d = dateObj(s);
    d.setDate(d.getDate() + n);
    return isoFromDate(d);
  }
  function fmtDate(s, opts = { weekday: "short", month: "short", day: "numeric" }) {
    return dateObj(s).toLocaleDateString(undefined, opts);
  }
  function fmtDateTime(ms) {
    return ms
      ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";
  }
  function startOfMonth(s) {
    const d = dateObj(s);
    d.setDate(1);
    return isoFromDate(d);
  }
  function startOfWeek(s) {
    const d = dateObj(s),
      day = d.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const sundayOffset = -day;
    d.setDate(d.getDate() + (state?.settings?.weekStarts === "sunday" ? sundayOffset : mondayOffset));
    return isoFromDate(d);
  }
  function durationText(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600),
      m = Math.floor((sec % 3600) / 60),
      s = sec % 60;
    return h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`;
  }
  function restText(sec) {
    const m = Math.floor(sec / 60),
      s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function round1(n) {
    return Math.round(n * 10) / 10;
  }
  function unitWeight(kg) {
    return state.settings.units === "lb" ? round1(kg * 2.2046226218) : round1(kg);
  }
  function toKg(display) {
    return state.settings.units === "lb" ? numIn(display) / 2.2046226218 : numIn(display);
  }
  function weightUnit() {
    return state.settings.units;
  }
  // Each exercise can have its own unit (a machine marked in lb in a kg gym). Weights are always saved in kg;
  // the unit only changes how they're shown and typed, so history, PRs and stats stay comparable.
  const LB = 2.2046226218;
  function exUnit(ex) {
    return ex?.unit === "kg" || ex?.unit === "lb" ? ex.unit : weightUnit();
  }
  function kgIn(unit, kg) {
    return unit === "lb" ? round1(num(kg) * LB) : round1(num(kg));
  }
  function exWeight(ex, kg) {
    return kgIn(exUnit(ex), kg);
  }
  function exToKg(ex, display) {
    return exUnit(ex) === "lb" ? numIn(display) / LB : numIn(display);
  }
  // "22.5 kg" / "50 lb" in the exercise's unit.
  function exW(ex, kg) {
    return `${exWeight(ex, kg)} ${exUnit(ex)}`;
  }
  function muscleName(id) {
    return SEED.muscles.find((m) => m.id === id)?.name || id || "Unknown";
  }
  // The part of the muscle an exercise is meant for ("Upper chest (clavicular head)"). Built-in exercises
  // saved before v2.12 don't carry it, so it falls back to the built-in text; an edited value always wins.
  function exFocus(ex) {
    if (!ex) return "";
    if (typeof ex.focus === "string") return ex.focus;
    return SEED_FOCUS[ex.id] || "";
  }
  function bestRank(ex) {
    return BEST_RANK[`${ex.primaryMuscle}:${ex.id}`] ?? Infinity;
  }
  function isTopPick(ex) {
    return !!ex.builtIn && TOP_PICKS.has(`${ex.primaryMuscle}:${ex.id}`);
  }
  // A–Z for all muscles; with one muscle chosen, the best exercises for it come first.
  function exerciseOrder(muscle) {
    return (a, b) =>
      muscle && muscle !== "all"
        ? bestRank(a) - bestRank(b) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name);
  }
  function topPickHTML(ex) {
    return isTopPick(ex) ? ` <span class="top-pick">Top pick</span>` : "";
  }
  function focusHTML(ex, tag = "div") {
    const f = exFocus(ex);
    return f ? `<${tag} class="focus-line">${esc(f)}</${tag}>` : "";
  }
  function trackingLabel(id) {
    return trackingTypes.find((x) => x[0] === id)?.[1] || id;
  }
  function snapshotExercise(ex) {
    return {
      name: ex.name,
      primaryMuscle: ex.primaryMuscle,
      secondaryMuscles: [...(ex.secondaryMuscles || [])],
      equipment: ex.equipment,
      trackingType: ex.trackingType,
    };
  }
  function sessionDuration(s) {
    if (!s.startTime) return 0;
    return Math.max(0, Math.floor(((s.endTime || Date.now()) - s.startTime) / 1000));
  }
  function activeProgram() {
    return state.programs[state.settings.activeProgramId] || Object.values(state.programs)[0] || null;
  }
  function getSession(id) {
    return state.sessions.find((s) => s.id === id) || null;
  }
  function getExercise(id) {
    return state.exercises[id] || null;
  }
  function liveSession() {
    return state.currentWorkoutId ? getSession(state.currentWorkoutId) : null;
  }
  function workingSets(item) {
    return (item.sets || []).filter((s) => s.type !== "warmup" && s.complete);
  }
  function allWorkingSets(item) {
    return (item.sets || []).filter((s) => s.type !== "warmup");
  }
  // The last time this exercise was actually done: a workout where it was skipped (no ticked sets) is passed
  // over, so "Previous" and the pre-filled sets come from real numbers instead of going blank.
  function previousExerciseEntry(exerciseId, beforeDate, excludeSessionId = null) {
    const list = exerciseEntries(exerciseId);
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      if (e.session.id !== excludeSessionId && e.session.date <= beforeDate && e.sets.length) return e;
    }
    return null;
  }
  function previousExerciseItem(exerciseId, beforeDate, excludeSessionId = null) {
    return previousExerciseEntry(exerciseId, beforeDate, excludeSessionId)?.item || null;
  }
  function e1rm(loadKg, reps) {
    if (loadKg <= 0 || reps <= 0 || reps > 20) return 0;
    return loadKg * (1 + reps / 30);
  }
  function setVolume(s) {
    return s.complete && s.type !== "warmup" ? num(s.loadKg) * num(s.reps) : 0;
  }
  function isRepBased(ex) {
    return ["weight_reps", "bodyweight_reps", "bodyweight_added", "assisted_bodyweight", "reps_only"].includes(
      ex.trackingType,
    );
  }
  function isDurationBased(ex) {
    return ["duration", "weight_duration"].includes(ex.trackingType);
  }
  function usesLoad(ex) {
    return !["reps_only", "bodyweight_reps", "duration"].includes(ex.trackingType);
  }
  // A number typed into a set. Accepts a comma as the decimal mark ("22,5"), as some phone keyboards type it.
  function numIn(v) {
    return num(String(v ?? "").trim().replace(",", "."));
  }
  // What you usually do on an exercise: the middle of each workout's best (load, reps or seconds), taking the lower
  // of the two middle values. A median, so a typo or two in the history doesn't make the next typo look normal.
  function typicalTop(entries, field) {
    const tops = entries
      .map((e) => Math.max(0, ...e.sets.map((s) => num(s[field]))))
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    return tops.length ? tops[(tops.length - 1) >> 1] : 0;
  }
  // Numbers like "2220" (tapping into "20" and typing "22") or "1012" reps are almost always typos.
  function unlikelyLoad(load, ref) {
    return ref > 0 ? load > ref * 2 && load - ref >= 10 : load > 400;
  }
  function unlikelyAmount(v, ref, field, targetMax) {
    const limit = ref > 0 ? Math.max(ref * 3, ref + (field === "reps" ? 20 : 120)) : Math.max(targetMax * 3, field === "reps" ? 50 : 600);
    return v > limit;
  }
  // Before a set is logged: is it far outside what you usually do on this exercise?
  // Returns { text, field: "load" | "amount" }, or null when it looks fine.
  function unlikelySet(session, item, ex, st) {
    if (st.type === "warmup") return null;
    const entries = exerciseEntries(item.exerciseId)
      .filter((e) => e.session.id !== session.id && e.session.date <= session.date && e.sets.length)
      .slice(-6);
    // A value you already confirmed on an earlier set of this workout isn't asked about again.
    const today = item.sets.filter((x) => x !== st && x.complete && x.type !== "warmup");
    const load = num(st.loadKg);
    if (usesLoad(ex) && load > 0 && !today.some((x) => num(x.loadKg) >= load)) {
      const ref = typicalTop(entries, "loadKg");
      if (unlikelyLoad(load, ref))
        return {
          field: "load",
          text:
            (ref
              ? `${ex.name}: ${exW(ex, load)} is more than twice what you usually do (about ${exW(ex, ref)}).`
              : `${ex.name}: ${exW(ex, load)} is very heavy.`) +
            // Pounds typed into a kg box come out about 2.2 times too heavy.
            (exUnit(ex) === "kg" && ref && load / ref > 1.9 && load / ref < 2.6
              ? ` If this machine is in lb, tap the KG heading to switch ${ex.name} to lb.`
              : ""),
        };
    }
    const field = isDurationBased(ex) ? "durationSec" : isRepBased(ex) ? "reps" : null;
    const v = field ? num(st[field]) : 0;
    if (field && v > 0 && !today.some((x) => num(x[field]) >= v)) {
      const ref = typicalTop(entries, field);
      if (unlikelyAmount(v, ref, field, num(item.target?.max || ex.defaultMax)))
        return {
          field: "amount",
          text:
            field === "reps"
              ? `${ex.name}: ${v} reps is far more than usual${ref ? ` (about ${ref})` : ""}.`
              : `${ex.name}: ${v} s is far longer than usual${ref ? ` (about ${ref} s)` : ""}.`,
        };
    }
    return null;
  }

  function navigate(v) {
    if (v !== "train") {
      trainPreviewProgramId = null;
      trainPreviewDayId = null;
    }
    activeView = v;
    enteredScreen = ""; // arriving at a screen: its bars fill once
    document.querySelectorAll(".nav-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === v);
      if (b.dataset.view === v) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    stopElapsedTimer();
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    byId("todayLabel").textContent = new Date().toLocaleDateString(undefined, {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    if (activeView === "train") renderTrain();
    else if (activeView === "programs") renderPrograms();
    else if (activeView === "history") renderHistory();
    else if (activeView === "progress") renderProgress();
    else renderMore();
  }
  // v2.19: bars and rings fill up from empty when a screen opens. Only on arriving at a screen (or a Progress
  // tab), never on the redraws that follow a change, so editing doesn't make everything bounce. Bars further
  // down the page wait at empty and fill when they scroll into view.
  let enteredScreen = "",
    barWatcher = null;
  const pendingFills = new Map(); // element → its paused fill animation
  function motionAllowed() {
    return !!Element.prototype.animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }
  function screenEnter(key) {
    if (key === enteredScreen) return;
    enteredScreen = key;
    barWatcher?.disconnect();
    pendingFills.clear();
    fillBars(view);
  }
  function fillBars(root) {
    if (!root || !motionAllowed()) return;
    const ease = "cubic-bezier(.2,.8,.2,1)",
      items = [];
    root.querySelectorAll(".bar > span, .track-fill").forEach((el) => {
      const w = el.style.width;
      if (w && parseFloat(w) > 0) items.push([el, [{ width: "0%" }, { width: w }], 650]);
    });
    root.querySelectorAll(".train-week-ring-fill, .day-ring-fill").forEach((el) => {
      const dash = el.getAttribute("stroke-dasharray");
      if (dash && parseFloat(dash) > 0) items.push([el, [{ strokeDasharray: "0 100" }, { strokeDasharray: dash }], 700]);
    });
    if ("IntersectionObserver" in window && !barWatcher)
      barWatcher = new IntersectionObserver(onBarsVisible, { threshold: 0.2 });
    let n = 0;
    items.forEach(([el, frames, duration]) => {
      if (!el.getClientRects().length) return; // hidden (e.g. a folded list): shown as is when opened
      const r = el.getBoundingClientRect(),
        onScreen = r.bottom > 0 && r.top < window.innerHeight;
      const anim = el.animate(frames, { duration, delay: onScreen ? Math.min(n++, 12) * 35 : 0, easing: ease, fill: "backwards" });
      if (onScreen || !barWatcher) return;
      anim.pause();
      anim.currentTime = 0;
      pendingFills.set(el, anim);
      barWatcher.observe(el);
    });
    root.querySelectorAll(".track-plan").forEach((el) =>
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 550, fill: "backwards" }),
    );
  }
  function onBarsVisible(entries) {
    let n = 0;
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const anim = pendingFills.get(e.target);
      barWatcher.unobserve(e.target);
      pendingFills.delete(e.target);
      if (!anim) return;
      anim.effect?.updateTiming?.({ delay: Math.min(n++, 8) * 35 });
      anim.play();
    });
  }
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove("show"), 1900);
  }

  // ---------- TRAIN ----------
  // v2.18: one Week card driven by the selected day. Tapping a day only changes what the card shows; it never
  // creates, moves or re-dates a workout. Starting a workout from any day's card always records it for today.
  const DONE_STATUSES = ["complete", "shortened"];
  // This week in the active program: planned days that have a complete or shortened workout anywhere this week.
  function trainWeekStats(p = activeProgram()) {
    const start = startOfWeek(isoToday()),
      end = addDays(start, 6);
    const done = state.sessions.filter((s) => s.date >= start && s.date <= end && DONE_STATUSES.includes(s.status));
    const days = (p?.days || []).filter((d) => Number(d.weekday) >= 0);
    const fulfilled = days.filter((d) => done.some((s) => s.programDayId === d.id)).length;
    return { scheduled: days.length, fulfilled, logged: done.length };
  }
  // PRs counted once per exercise and kind (three sets at a new best are one Rep PR, not three).
  function distinctPRCount(prs) {
    return new Set(prs.map((x) => `${x.exerciseId}|${x.type}`)).size;
  }
  function sessionSetCount(s) {
    return s.items.reduce((n, i) => n + workingSets(i).length, 0);
  }
  // Everything the week shows for one date.
  function trainDayInfo(p, date) {
    const today = isoToday();
    const logs = state.sessions.filter((s) => s.date === date && s.id !== state.currentWorkoutId);
    const recorded = logs
      .filter((s) => DONE_STATUSES.includes(s.status))
      .sort((a, b) => (b.endTime || b.startTime || 0) - (a.endTime || a.startTime || 0));
    const paused = logs.find((s) => s.status === "in_progress") || null;
    const skipped = logs.find((s) => s.status === "skipped") || null;
    const plans = (p?.days || []).filter((d) => Number(d.weekday) === dateObj(date).getDay());
    // A planned day that was trained (or skipped) on another day this week isn't missed.
    let elsewhere = null;
    if (!recorded.length && !paused && !skipped && plans.length && date < today) {
      const start = startOfWeek(today);
      elsewhere =
        state.sessions.find(
          (s) =>
            s.date !== date &&
            s.date >= start &&
            s.date <= today &&
            plans.some((d) => d.id === s.programDayId) &&
            [...DONE_STATUSES, "skipped", "in_progress"].includes(s.status),
        ) || null;
    }
    const kind = recorded.length
      ? "done"
      : paused
        ? "paused"
        : skipped
          ? "skipped"
          : elsewhere
            ? "moved"
            : plans.length
              ? date < today
                ? "missed"
                : "planned"
              : "rest";
    // Ring = sets logged out of the sets in those workouts (shortened and paused days show a part-filled ring).
    const ringOf = (list) => {
      const logged = list.reduce((n, s) => n + sessionSetCount(s), 0),
        total = list.reduce((n, s) => n + s.items.reduce((m, i) => m + allWorkingSets(i).length, 0), 0);
      return total ? Math.min(100, Math.round((logged / total) * 100)) : logged ? 100 : 0;
    };
    const ring = kind === "done" ? Math.max(ringOf(recorded), 8) : kind === "paused" ? ringOf([paused]) : 0;
    return { date, today, isToday: date === today, kind, recorded, paused, skipped, plans, elsewhere, ring };
  }
  const DAY_KIND_NAME = {
    done: "Workout logged",
    paused: "Workout paused",
    skipped: "Marked skipped",
    moved: "Done on another day",
    missed: "Missed",
    planned: "Planned",
    rest: "Rest day",
  };
  // A small ring for each day, with a mark drawn as lines so it looks the same on every phone.
  function dayRingSVG(kind, pct) {
    const mark = {
      done: `<path d="M9.6 14.3l3 3 5.9-6.4"/>`,
      paused: `<path d="M12 10.6v6.8M16 10.6v6.8"/>`,
      skipped: `<path d="M10.2 14h7.6"/>`,
      moved: `<path d="M9.8 14h7.4M14.6 11l3 3-3 3"/>`,
      missed: `<path d="M14 9.6v5.2M14 18.3v.1"/>`,
      planned: "",
      rest: `<path d="M14 14h.01"/>`,
    }[kind];
    return `<svg viewBox="0 0 28 28" aria-hidden="true"><circle class="day-ring-track" cx="14" cy="14" r="11.5"/>${pct > 0 ? `<circle class="day-ring-fill" cx="14" cy="14" r="11.5" pathLength="100" stroke-dasharray="${pct} 100" transform="rotate(-90 14 14)"/>` : ""}<g class="day-ring-mark">${mark}</g></svg>`;
  }
  function trainRibbonDayHTML(info) {
    const sel = info.date === trainSelectedDate;
    const label = `${fmtDate(info.date, { weekday: "long", month: "short", day: "numeric" })}${info.isToday ? ", today" : ""}: ${DAY_KIND_NAME[info.kind]}`;
    return `<button type="button" class="train-week-day ${info.kind}${sel ? " selected" : ""}${info.isToday ? " today" : ""}" data-train-date="${info.date}" aria-pressed="${sel}" aria-label="${esc(label)}">
        <span class="train-week-dayname">${esc(fmtDate(info.date, { weekday: "short" }))}</span>
        <span class="train-day-ring">${dayRingSVG(info.kind, info.ring)}</span>
        <span class="train-week-number">${dateObj(info.date).getDate()}</span>
      </button>`;
  }
  function trainPlanListHTML(day, max = 4) {
    const rows = day.items
      .slice(0, max)
      .map((x) => {
        const ex = getExercise(x.exerciseId);
        return `<li><span>${esc(ex?.name || "Missing exercise")}</span><span class="meta">${x.sets} × ${x.min}–${x.max}</span></li>`;
      })
      .join("");
    const sets = day.items.reduce((a, x) => a + num(x.sets), 0);
    return `<ul class="train-day-exercises">${rows}</ul><p class="meta">${day.items.length > max ? `+ ${day.items.length - max} more · ` : ""}${day.items.length} exercise${day.items.length === 1 ? "" : "s"} · ${sets} sets</p>`;
  }
  // The 2-day muscle check, for a session you'd be training today.
  function trainRestLineHTML(day) {
    const note = restNote(day);
    return note ? `<p class="train-day-note rest-warn">${esc(note)}</p>` : `<p class="train-day-note rest-ok">Muscles rested</p>`;
  }
  function trainDayPanelHTML(info) {
    const { kind, plans, recorded, paused, skipped, elsewhere, isToday } = info;
    const plan = plans[0] || null;
    const planTitle = plans.map((d) => d.name).join(" · ");
    const weekday = weekdayName(dateObj(info.date).getDay());
    const act = (label, a, cls = "ghost", data = "") => `<button type="button" class="btn ${cls}" data-act="${a}" ${data}>${esc(label)}</button>`;
    let title = "",
      pill = "",
      body = "",
      actions = "";
    if (kind === "done") {
      const s = recorded[0],
        allComplete = recorded.every((x) => x.status === "complete");
      title = recorded.length === 1 ? s.name : `${recorded.length} workouts`;
      pill = allComplete ? `<span class="pill good">Done</span>` : `<span class="pill warn">${recorded.length === 1 ? "Shortened" : "Done"}</span>`;
      body = recorded
        .map((x) => {
          const prs = distinctPRCount(sessionPRs(x)),
            dur = x.startTime && x.endTime ? durationText(sessionDuration(x)) : "";
          return `<p class="meta">${recorded.length > 1 ? `<strong>${esc(x.name)}</strong> · ` : ""}${sessionSetCount(x)} working sets${dur ? ` · ${dur}` : ""}${prs ? ` · ★ ${prs} PR${prs === 1 ? "" : "s"}` : ""}${recorded.length > 1 ? ` · ${statusLabel(x.status)}` : ""}</p>`;
        })
        .join("");
      actions = act("View record", "record", isToday ? "primary" : "ghost", `data-session="${esc(s.id)}"`);
      if (isToday && plan)
        actions += act(recorded.some((x) => x.programDayId === plan.id) ? "Train again" : "Today's plan", "preview", "ghost", `data-day="${esc(plan.id)}"`);
    } else if (kind === "paused") {
      const total = paused.items.reduce((n, i) => n + allWorkingSets(i).length, 0);
      title = paused.name;
      pill = `<span class="pill warn">Paused</span>`;
      body = `<p class="meta">${sessionSetCount(paused)} of ${total} sets logged. Pick up where you left off.</p>`;
      actions = act("Resume", "resume", "primary", `data-session="${esc(paused.id)}"`) + act("Discard", "discard", "ghost", `data-session="${esc(paused.id)}"`);
    } else if (kind === "skipped") {
      title = skipped.name;
      pill = `<span class="pill neutral">Skipped</span>`;
      body = `<p class="meta">Marked as skipped${isToday && plan ? ". You can still train if plans change." : "."}</p>`;
      if (isToday && plan) actions = act("View workout", "preview", "ghost", `data-day="${esc(plan.id)}"`);
    } else if (kind === "moved") {
      const when = weekdayName(dateObj(elsewhere.date).getDay());
      title = planTitle;
      pill = `<span class="pill ${elsewhere.status === "in_progress" ? "warn" : elsewhere.status === "skipped" ? "neutral" : "good"}">${elsewhere.status === "in_progress" ? "Paused" : cap(elsewhere.status)} · ${esc(fmtDate(elsewhere.date, { weekday: "short" }))}</span>`;
      body = `<p class="meta">${elsewhere.status === "in_progress" ? `Started on ${when} instead, and paused.` : elsewhere.status === "skipped" ? `Marked skipped on ${when}.` : `Done on ${when} instead.`}</p>`;
      actions =
        elsewhere.status === "in_progress"
          ? act("Resume", "resume", "primary", `data-session="${esc(elsewhere.id)}"`)
          : elsewhere.status === "skipped"
            ? ""
            : act("View record", "record", "ghost", `data-session="${esc(elsewhere.id)}"`);
    } else if (kind === "missed") {
      title = planTitle;
      pill = `<span class="pill warn">Missed</span>`;
      body = `<p class="meta">Not logged on ${weekday}. Catch it up today?</p>${trainRestLineHTML(plan)}${trainPlanListHTML(plan, 3)}`;
      actions = act("View workout", "preview", "primary", `data-day="${esc(plan.id)}"`);
      body += `<p class="meta train-day-fineprint">Starting it records it for today.</p>`;
    } else if (kind === "planned" && isToday) {
      title = planTitle;
      pill = `<span class="pill accent">Today</span>`;
      body = `${trainRestLineHTML(plan)}${trainPlanListHTML(plan)}`;
      actions = act("View workout", "preview", "primary", `data-day="${esc(plan.id)}"`) + act("Mark skipped", "skip", "ghost", `data-day="${esc(plan.id)}"`);
    } else if (kind === "planned") {
      title = planTitle;
      pill = `<span class="pill neutral">Planned</span>`;
      body = trainPlanListHTML(plan);
      actions = act("Preview", "preview", "ghost", `data-day="${esc(plan.id)}"`);
      body += `<p class="meta train-day-fineprint">Starting it from here records it for today, not ${weekday}.</p>`;
    } else {
      title = isToday ? "Rest / flexible day" : "Rest day";
      pill = `<span class="pill neutral">Rest</span>`;
      body = isToday
        ? `<p class="meta">Nothing planned today. Start an empty workout, or pick any session from the library below.</p>`
        : `<p class="meta">${info.date < info.today ? "No workout logged, and none planned." : "Nothing planned in your current program."}</p>`;
      if (isToday) actions = act("Empty workout", "empty", "ghost");
    }
    return `<div class="train-day-panel kind-${kind}">
        <div class="train-day-head"><div class="train-day-title"><span class="meta">${esc(fmtDate(info.date, { weekday: "long", month: "short", day: "numeric" }))}${isToday ? " · Today" : ""}</span><h3>${nameHTML(title)}</h3></div>${pill}</div>
        <div class="train-day-body">${body}</div>
        ${actions ? `<div class="train-day-actions">${actions}</div>` : ""}
      </div>`;
  }
  function trainWeekHTML(p) {
    const today = isoToday(),
      start = startOfWeek(today);
    const dates = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    if (!dates.includes(trainSelectedDate)) trainSelectedDate = today;
    const infos = dates.map((d) => trainDayInfo(p, d));
    const stats = trainWeekStats(p),
      showWeek = state.settings.showWeeklyProgress !== false;
    const missed = infos.filter((x) => x.kind === "missed").length,
      extra = Math.max(0, stats.logged - stats.fulfilled);
    const pct = stats.scheduled ? Math.min(100, Math.round((stats.fulfilled / stats.scheduled) * 100)) : 0;
    const range = `${fmtDate(start, { month: "short", day: "numeric" })} – ${fmtDate(addDays(start, 6), { month: "short", day: "numeric" })}`;
    const line = !showWeek
      ? range
      : stats.scheduled
        ? `${stats.fulfilled} of ${stats.scheduled} planned sessions done${missed ? ` · ${missed} missed` : ""}${extra ? ` · ${extra} extra` : ""}`
        : `${stats.logged} workout${stats.logged === 1 ? "" : "s"} logged · ${range}`;
    return `<section class="card train-week-card" aria-label="This week's training">
      <div class="train-week-top"><div><p class="eyebrow">${nameHTML(p?.name || "No active program")}</p><h2>This week</h2><p class="meta">${line}</p></div>
        ${
          showWeek && stats.scheduled
            ? `<div class="train-week-progress${pct >= 100 ? " full" : ""}" role="img" aria-label="${stats.fulfilled} of ${stats.scheduled} planned sessions done this week">
          <svg viewBox="0 0 40 40" aria-hidden="true"><circle class="train-week-ring-track" cx="20" cy="20" r="16"/><circle class="train-week-ring-fill" cx="20" cy="20" r="16" pathLength="100" stroke-dasharray="${pct} 100" transform="rotate(-90 20 20)"/></svg>
          <span>${stats.fulfilled}/${stats.scheduled}</span>
        </div>`
            : ""
        }
      </div>
      <div class="train-week-ribbon" role="group" aria-label="Pick a day">${infos.map(trainRibbonDayHTML).join("")}</div>
      <div class="train-day-slot" aria-live="polite">${trainDayPanelHTML(infos[dates.indexOf(trainSelectedDate)])}</div>
    </section>`;
  }
  // Keep the chosen day in view when the seven 44px buttons scroll sideways on 320px phones.
  function keepRibbonDayVisible() {
    const ribbon = view.querySelector(".train-week-ribbon");
    const activeDay = ribbon?.querySelector('.train-week-day[aria-pressed="true"]');
    if (!ribbon || !activeDay) return;
    const track = ribbon.getBoundingClientRect(),
      selected = activeDay.getBoundingClientRect();
    if (selected.right > track.right) ribbon.scrollLeft += selected.right - track.right + 5;
    else if (selected.left < track.left) ribbon.scrollLeft -= track.left - selected.left + 5;
  }
  // Swap only the day card (no full redraw), so the page doesn't jump or flash.
  function selectTrainDay(p, date) {
    trainSelectedDate = date;
    const card = view.querySelector(".train-week-card"),
      slot = card?.querySelector(".train-day-slot");
    if (!slot) return renderTrain();
    card.querySelectorAll(".train-week-day").forEach((b) => {
      const on = b.dataset.trainDate === date;
      b.classList.toggle("selected", on);
      b.setAttribute("aria-pressed", String(on));
    });
    slot.innerHTML = trainDayPanelHTML(trainDayInfo(p, date));
    slot.firstElementChild?.classList.add("train-day-enter");
    keepRibbonDayVisible();
  }
  async function discardUnfinished(sessionId) {
    if (!(await askConfirm("Discard this unfinished workout?", "Sets logged in it will be deleted.", { ok: "Discard", danger: true }))) return;
    state.sessions = state.sessions.filter((x) => x.id !== sessionId);
    save();
    renderTrain();
    showToast("Unfinished workout discarded.");
  }

  function renderTrain() {
    const live = liveSession();
    if (live) return renderLiveSession(live);
    const p = activeProgram();
    const latestWeight = latestBody("weight"),
      avg7 = bodyAverage("weight", 7);
    const trainMetrics = Array.isArray(state.settings.trainMetrics) ? state.settings.trainMetrics : ["weight", "waist"];
    const trainMetricCards = [
      trainMetrics.includes("weight")
        ? `<div class="metric"><span class="meta">Body weight</span><strong>${latestWeight ? `${round1(unitWeight(latestWeight.weight))} ${weightUnit()}` : "—"}</strong><span class="small muted">7-day avg ${avg7 ? `${round1(unitWeight(avg7))} ${weightUnit()}` : "—"}</span></div>`
        : "",
      trainMetrics.includes("waist")
        ? `<div class="metric"><span class="meta">Waist</span><strong>${latestBody("waist") ? `${round1(latestBody("waist").waist)} cm` : "—"}</strong><span class="small muted">Latest measurement</span></div>`
        : "",
    ]
      .filter(Boolean)
      .join("");
    if (trainPreviewProgramId && trainPreviewDayId) {
      const pp = state.programs[trainPreviewProgramId] || p;
      const pd = pp?.days.find((x) => x.id === trainPreviewDayId);
      if (pd) return renderTrainPreview(pp, pd);
      trainPreviewProgramId = null;
      trainPreviewDayId = null;
    }
    const unfinished = state.sessions
      .filter((x) => x.status === "in_progress" && x.id !== state.currentWorkoutId)
      .sort((a, b) => b.date.localeCompare(a.date));
    view.innerHTML = `<div class="stack train-stack">
      ${unfinished.map((u) => `<section class="card unfinished-card"><div class="unfinished-row"><div class="unfinished-copy"><p class="eyebrow">Paused workout</p><strong>${nameHTML(u.name)}</strong><span class="meta">${fmtDate(u.date)} · ${sessionSetCount(u)} sets logged</span></div><div class="unfinished-actions"><button class="btn primary small-btn" data-act="resume" data-session="${esc(u.id)}" type="button">Resume</button><button class="btn ghost small-btn" data-act="discard" data-session="${esc(u.id)}" type="button">Discard</button></div></div></section>`).join("")}
      ${trainWeekHTML(p)}
      ${revisionCardHTML("train")}
      ${backupReminderHTML()}
      ${trainMetricCards ? `<section class="grid-2 train-metrics">${trainMetricCards}</section>` : ""}
      <section class="card library-card"><div class="section-title"><h2>Workout library</h2><button class="btn ghost small-btn" data-act="empty" type="button">Empty workout</button></div><div class="list">${p?.days.map((day) => `<button type="button" class="list-row click-row workout-library-row" data-act="preview" data-day="${esc(day.id)}"><div><strong>${esc(day.name)}</strong><div class="meta">${weekdayName(day.weekday)} · ${day.items.length} exercises</div></div><span class="row-chevron" aria-hidden="true">›</span></button>`).join("") || `<p class="empty">Create a program first.</p>`}</div></section>
    </div>`;
    const stack = view.querySelector(".train-stack");
    stack.addEventListener("click", (e) => {
      const day = e.target.closest(".train-week-day");
      if (day) {
        if (day.dataset.trainDate !== trainSelectedDate) playTapSound("tick");
        return selectTrainDay(p, day.dataset.trainDate);
      }
      const b = e.target.closest("[data-act]");
      if (!b || b.disabled) return;
      const { act, session, day: dayId } = b.dataset;
      if (act === "record") openHistoryRecord(session);
      else if (act === "resume") resumeSession(session);
      else if (act === "discard") discardUnfinished(session);
      else if (act === "preview" && p) openTrainPreview(p.id, dayId);
      else if (act === "skip" && p) markSkippedWorkout(p.id, dayId);
      else if (act === "empty") startEmptyWorkout();
    });
    keepRibbonDayVisible();
    wireBackupReminder();
    wireRevisionCard(renderTrain);
    screenEnter("train");
  }

  function resetLiveUi() {
    expandedItems = new Set();
    lastTouchedItemId = null;
    // Leaving or starting a workout always returns to the Train home, not an old preview page.
    trainPreviewProgramId = null;
    trainPreviewDayId = null;
  }
  function openHistoryRecord(sessionId) {
    selectedHistorySessionId = sessionId;
    navigate("history");
  }
  function resumeSession(sessionId) {
    if (state.currentWorkoutId && state.currentWorkoutId !== sessionId) {
      showToast("Finish or pause the current workout first.");
      return;
    }
    state.currentWorkoutId = sessionId;
    resetLiveUi();
    save();
    navigate("train");
  }
  function backupReminderHTML() {
    const logged = state.sessions.filter((x) => ["complete", "shortened"].includes(x.status)).length;
    if (logged < 3) return "";
    const last = state.meta.lastBackupAt || 0,
      days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    if (days != null && days < 14) return "";
    if ((state.meta.backupSnoozeUntil || 0) > Date.now()) return "";
    return `<section class="card backup-reminder"><div class="row start"><div><p class="eyebrow">Backup</p><h2>${days == null ? "You haven't backed up yet" : `Last backup ${days} days ago`}</h2><p class="meta">Your workouts live only on this phone. Export a copy to Files or iCloud Drive.</p></div></div><div class="preview-actions" style="margin-top:12px"><button class="btn primary" id="backupNowBtn" type="button">Export backup</button><button class="btn ghost" id="backupLaterBtn" type="button">Remind me later</button></div></section>`;
  }
  function wireBackupReminder() {
    byId("backupNowBtn")?.addEventListener("click", exportBackup);
    byId("backupLaterBtn")?.addEventListener("click", () => {
      state.meta.backupSnoozeUntil = Date.now() + 3 * 86400000;
      save();
      render();
    });
  }
  function openTrainPreview(programId, dayId) {
    trainPreviewProgramId = programId;
    trainPreviewDayId = dayId;
    renderTrain();
  }

  function renderTrainPreview(programObj, day) {
    const totalSets = day.items.reduce((a, x) => a + x.sets, 0);
    const priorityA = day.items.filter((x) => x.priority === "A").length;
    const totalRest = day.items.reduce((sum, x) => sum + Math.max(0, (x.sets - 1) * (x.rest || 0)), 0);
    const approxMinutes = Math.max(20, Math.round((totalSets * 55 + totalRest) / 60));
    view.innerHTML = `<div class="preview-shell">
      <section class="card preview-summary">
        <div class="preview-toolbar"><button class="btn ghost small-btn preview-back" id="backToTrainBtn" type="button"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Back</button><span class="pill neutral">Preview only</span></div>
        <p class="eyebrow" style="margin-top:14px">${esc(programObj?.name || "Program")}</p><h2>${nameHTML(day.name)}</h2><p class="meta">Review the session before you start. The workout timer and active session begin only after you press Start workout.</p>
        <div class="preview-kpis"><div class="preview-kpi"><span class="meta">Exercises</span><strong>${day.items.length}</strong></div><div class="preview-kpi"><span class="meta">Working sets</span><strong>${totalSets}</strong></div><div class="preview-kpi"><span class="meta">Approx.</span><strong>~${approxMinutes} min</strong></div></div>
        <div style="margin-top:14px"><button class="btn primary preview-start" id="startPreviewWorkoutBtn" type="button">Start workout</button></div>
      </section>
      <section class="card"><div class="section-title"><h2>Exercises</h2><span class="meta">${priorityA} priority A</span></div><div class="preview-hint" style="margin-top:10px">Viewing this page does not create a workout session.</div><div class="list" style="margin-top:5px">${day.items
        .map((x, idx) => {
          const ex = getExercise(x.exerciseId) || { name: "Missing exercise", primaryMuscle: "" };
          return `<div class="exercise-preview-row preview-exercise"><div><strong>${idx + 1}. ${esc(ex.name)}</strong>${focusHTML(ex)}<div class="meta">${x.sets} × ${x.min}–${x.max} · ${restText(x.rest)} rest</div><div class="meta">${muscleName(ex.primaryMuscle)}${ex.equipment ? ` · ${esc(ex.equipment)}` : ""}</div></div><span class="pill ${x.priority === "A" ? "good" : x.priority === "B" ? "neutral" : "warn"}">Priority ${x.priority}</span></div>`;
        })
        .join("")}</div></section>
      <section class="card"><div class="preview-actions"><button class="btn ghost" id="previewSkipBtn" type="button">Mark skipped</button><button class="btn ghost" id="previewEmptyBtn" type="button">Start empty workout</button></div></section>
    </div>`;
    byId("backToTrainBtn").addEventListener("click", () => {
      trainPreviewProgramId = null;
      trainPreviewDayId = null;
      renderTrain();
    });
    byId("startPreviewWorkoutBtn").addEventListener("click", () => startProgramWorkout(programObj.id, day.id));
    byId("previewSkipBtn").addEventListener("click", () => markSkippedWorkout(programObj.id, day.id));
    byId("previewEmptyBtn").addEventListener("click", startEmptyWorkout);
  }

  function weekdayName(n) {
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(n)] || "Unscheduled";
  }
  function startProgramWorkout(programId, dayId) {
    if (state.currentWorkoutId) {
      showToast("Finish or close the current workout first.");
      return;
    }
    const p = state.programs[programId],
      d = p?.days.find((x) => x.id === dayId);
    if (!d) return;
    const session = {
      id: uid("sess"),
      date: isoToday(),
      programId,
      programDayId: dayId,
      name: d.name,
      status: "in_progress",
      startTime: Date.now(),
      endTime: null,
      notes: "",
      items: d.items.map((pi) => makeSessionItem(pi)),
    };
    session.items.forEach((item) => prefillSessionItem(item, session.date, session.id));
    state.sessions.push(session);
    state.currentWorkoutId = session.id;
    resetLiveUi();
    save();
    renderTrain();
    showToast("Workout started · previous values pre-filled.");
  }
  async function markSkippedWorkout(programId, dayId) {
    const p = state.programs[programId],
      d = p?.days.find((x) => x.id === dayId);
    if (!d) return;
    if (!(await askConfirm(`Mark ${d.name} as skipped?`, "It's recorded as skipped for today, with no sets. You can still train later if plans change.", { ok: "Mark skipped" })))
      return;
    state.sessions.push({
      id: uid("sess"),
      date: isoToday(),
      programId,
      programDayId: dayId,
      name: d.name,
      status: "skipped",
      startTime: null,
      endTime: Date.now(),
      notes: "",
      items: [],
    });
    save();
    renderTrain();
    showToast("Workout marked skipped.");
  }
  function startEmptyWorkout() {
    const session = {
      id: uid("sess"),
      date: isoToday(),
      programId: null,
      programDayId: null,
      name: "Empty Workout",
      status: "in_progress",
      startTime: Date.now(),
      endTime: null,
      notes: "",
      items: [],
    };
    state.sessions.push(session);
    state.currentWorkoutId = session.id;
    resetLiveUi();
    save();
    renderTrain();
  }
  function makeSessionItem(pi) {
    const ex = getExercise(pi.exerciseId);
    return {
      id: uid("item"),
      exerciseId: pi.exerciseId,
      exerciseSnapshot: snapshotExercise(
        ex || { name: "Missing", primaryMuscle: "", secondaryMuscles: [], equipment: "", trackingType: "weight_reps" },
      ),
      substitutedForExerciseId: null,
      supersetGroup: pi.supersetGroup || "",
      notes: pi.notes || "",
      techniqueGood: true,
      pain: "none",
      target: {
        sets: pi.sets,
        min: pi.min,
        max: pi.max,
        rest: pi.rest,
        priority: pi.priority,
        rirMin: pi.rirMin,
        rirMax: pi.rirMax,
      },
      sets: Array.from({ length: pi.sets }, () => newSet("normal")),
    };
  }
  function newSet(type = "normal") {
    return { id: uid("set"), type, loadKg: 0, reps: 0, rir: null, durationSec: 0, distanceKm: 0, complete: false };
  }

  function renderLiveSession(s, anchorSelector = null) {
    // Keep whatever the user just touched at the same spot on screen after re-rendering.
    const anchorBefore = anchorSelector ? document.querySelector(anchorSelector)?.getBoundingClientRect().top : null;
    const editing = !!s.endTime;
    view.innerHTML = `<div class="stack">
      ${liveHeadHTML(s)}
      ${s.items.length ? s.items.map((item, idx) => liveExerciseCard(s, item, idx)).join("") : `<section class="card"><div class="empty">No exercises yet.</div></section>`}
      <section class="card"><div class="wrap"><button class="btn secondary" id="addExerciseLive" type="button">+ Exercise</button><button class="btn ghost" id="sessionNoteBtn" type="button">Session note</button><button class="btn ghost" id="sessionTimeBtn" type="button">${editing ? "Date & duration" : "Change date"}</button></div>${s.notes ? `<div class="note-box" style="margin-top:10px">${esc(s.notes)}</div>` : ""}</section>
      <section class="card"><div class="form-grid three"><button class="status-btn btn primary" data-finish="complete" type="button">${editing ? "Save as complete" : "Finish complete"}</button><button class="status-btn btn secondary" data-finish="shortened" type="button">${editing ? "Save as shortened" : "Finish shortened"}</button><button class="btn ghost" id="closeWorkoutBtn" type="button">${editing ? "Close editor" : "Pause workout"}</button></div>${editing ? "" : `<p class="meta" style="margin-top:8px">Pausing keeps this workout on the Train tab so you can resume it later.</p>`}<button class="btn danger" id="deleteSessionBtn" type="button" style="margin-top:10px;width:100%">Delete workout</button></section>
    </div>`;
    if (anchorBefore != null) {
      const after = document.querySelector(anchorSelector)?.getBoundingClientRect().top;
      if (after != null) window.scrollBy(0, after - anchorBefore);
    }
    startElapsedTimer(s);
    if (!editing) requestWakeLock();
    s.items.forEach((item, idx) => wireLiveExercise(s, item, idx));
    wireLiveHead(s);
    byId("addExerciseLive").addEventListener("click", () =>
      openExercisePicker((exId) => {
        const ex = getExercise(exId);
        const item = {
          id: uid("item"),
          exerciseId: exId,
          exerciseSnapshot: snapshotExercise(ex),
          substitutedForExerciseId: null,
          supersetGroup: "",
          notes: "",
          techniqueGood: true,
          pain: "none",
          target: {
            sets: 3,
            min: ex.defaultMin,
            max: ex.defaultMax,
            rest: ex.defaultRest,
            priority: "B",
            rirMin: 1,
            rirMax: 2,
          },
          sets: Array.from({ length: 3 }, () => newSet("normal")),
        };
        prefillSessionItem(item, s.date, s.id);
        s.items.push(item);
        lastTouchedItemId = item.id;
        save();
        renderLiveSession(s);
        byId(`exercise_${item.id}`)?.scrollIntoView({ block: "start" });
      }, "Add exercise"),
    );
    byId("sessionNoteBtn").addEventListener("click", () =>
      openTextModal("Session note", s.notes || "", (v) => {
        s.notes = v;
        save();
        renderLiveSession(s);
      }),
    );
    byId("sessionTimeBtn").addEventListener("click", () => openSessionTimeModal(s));
    document
      .querySelectorAll("[data-finish]")
      .forEach((b) => b.addEventListener("click", () => finishSession(s, b.dataset.finish)));
    byId("closeWorkoutBtn").addEventListener("click", () => {
      state.currentWorkoutId = null;
      resetLiveUi();
      save();
      stopElapsedTimer();
      releaseWakeLock();
      if (editing) {
        selectedHistorySessionId = s.status === "in_progress" ? null : s.id;
        navigate("history");
      } else {
        navigate("train");
        showToast("Workout paused. Resume it from Train.");
      }
    });
    byId("deleteSessionBtn").addEventListener("click", async () => {
      if (!(await askConfirm("Delete this workout?", "It's removed for good, with every set logged in it.", { ok: "Delete", danger: true })))
        return;
      state.sessions = state.sessions.filter((x) => x.id !== s.id);
      if (state.currentWorkoutId === s.id) state.currentWorkoutId = null;
      save();
      stopRestTimer();
      releaseWakeLock();
      navigate("history");
    });
  }

  function liveHeadHTML(s) {
    const editing = !!s.endTime;
    const elapsed = sessionDuration(s);
    const completedSets = s.items.reduce((n, i) => n + workingSets(i).length, 0);
    const totalSets = s.items.reduce((n, i) => n + allWorkingSets(i).length, 0);
    const next = nextIncompleteItem(s);
    const statusLabel = s.status === "in_progress" ? (editing ? "Draft" : "In progress") : cap(s.status);
    return `<section class="workout-head"><div class="row start"><div><p class="meta">${editing ? "Editing history" : "Live workout"}</p><h2 style="margin:2px 0 0">${nameHTML(s.name)}</h2><p class="meta">${fmtDate(s.date)} · <span id="elapsedTimer" class="timer-big">${editing && !s.startTime ? "No duration" : durationText(elapsed)}</span></p></div><span class="pill ${s.status === "complete" ? "good" : s.status === "shortened" ? "warn" : "neutral"}">${statusLabel}</span></div><div class="progress-track"><div class="progress-fill" style="width:${totalSets ? Math.min(100, (completedSets / totalSets) * 100) : 0}%"></div></div><div class="row" style="margin-top:7px"><div class="meta">${completedSets}/${totalSets} working sets logged</div>${next ? `<button class="live-jump" id="jumpNextBtn" type="button">Next · ${esc((getExercise(next.exerciseId) || next.exerciseSnapshot).name)}</button>` : '<span class="pill good">All prescribed sets logged</span>'}</div></section>`;
  }
  function wireLiveHead(s) {
    const next = nextIncompleteItem(s);
    byId("jumpNextBtn")?.addEventListener("click", () => {
      expandedItems.add(next.id);
      renderLiveSession(s);
      byId(`exercise_${next.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  // Redraw only the header and the given exercise cards (much faster than the whole workout).
  // A one-shot visual acknowledgement after the existing save-and-rerender path.
  // It never changes workout state, starts audio, or moves the user's scroll position.
  function flashSetFeedback(itemId, setId, wasLogged, exerciseJustFinished) {
    const entry = view.querySelector(`[data-set-entry="${setId}"]`);
    entry?.classList.add(wasLogged ? "set-just-logged" : "set-just-reopened");
    if (exerciseJustFinished) byId(`exercise_${itemId}`)?.classList.add("exercise-just-finished");
  }
  function refreshLive(s, itemIds, anchorSelector = null) {
    const head = view.querySelector(".workout-head");
    if (!head) return renderLiveSession(s, anchorSelector);
    const anchorBefore = anchorSelector ? document.querySelector(anchorSelector)?.getBoundingClientRect().top : null;
    // Preserve the previous ring width so only the real change animates.
    // The header is already recreated by this existing targeted renderer.
    const previousWidth = head.querySelector(".progress-fill")?.style.width;
    head.outerHTML = liveHeadHTML(s);
    const fill = view.querySelector(".workout-head .progress-fill");
    const nextWidth = fill?.style.width;
    if (!s.endTime && previousWidth != null && fill?.animate && previousWidth !== nextWidth &&
        !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)) {
      fill.animate(
        [{ width: previousWidth }, { width: nextWidth }],
        { duration: 320, easing: "ease-out" },
      );
    }
    [...new Set(itemIds.filter(Boolean))].forEach((id) => {
      const idx = s.items.findIndex((i) => i.id === id),
        el = byId(`exercise_${id}`);
      if (idx < 0 || !el) return;
      el.outerHTML = liveExerciseCard(s, s.items[idx], idx);
      wireLiveExercise(s, s.items[idx], idx);
    });
    wireLiveHead(s);
    if (anchorBefore != null) {
      const after = document.querySelector(anchorSelector)?.getBoundingClientRect().top;
      if (after != null && Math.abs(after - anchorBefore) > 1) window.scrollBy(0, after - anchorBefore);
    }
  }
  function nextIncompleteItem(session) {
    return session.items.find((item) => allWorkingSets(item).some((st) => !st.complete)) || null;
  }
  function itemComplete(item) {
    const ws = allWorkingSets(item);
    return ws.length > 0 && ws.every((st) => st.complete);
  }

  function liveExerciseCard(session, item, idx) {
    const ex = getExercise(item.exerciseId) || item.exerciseSnapshot;
    const sets = item.sets || [];
    const sup = item.supersetGroup ? `<span class="pill superset-pill">Superset ${esc(item.supersetGroup)}</span>` : "";
    const prs = sessionPRs(session, item.exerciseId);
    const prPill = prs.length ? `<span class="pill good">${prs.length} PR${prs.length > 1 ? "s" : ""}</span>` : "";
    // Finished exercises fold away once you move on, so the screen stays short.
    const collapsed = itemComplete(item) && item.id !== lastTouchedItemId && !expandedItems.has(item.id);
    if (collapsed) {
      return `<section class="card exercise-card collapsed ${item.supersetGroup ? "superset-card" : ""}" id="exercise_${item.id}"><button class="exercise-collapsed-btn toggle-item" data-item="${item.id}" type="button" aria-expanded="false"><span class="exercise-collapsed-check" aria-hidden="true">✓</span><span class="exercise-collapsed-text"><strong>${esc(ex.name)}</strong><span class="meta">${workingSets(item).map((st) => setSummary(st, ex)).join(" · ")}</span></span>${prPill}<span class="row-chevron" aria-hidden="true">›</span></button></section>`;
    }
    const prevEntry = previousExerciseEntry(item.exerciseId, addDays(session.date, -1), session.id),
      prev = prevEntry?.item || null;
    const suggestion = suggestLoad(ex, item, prev);
    const supNames = item.supersetGroup
      ? session.items
          .filter((x) => x.supersetGroup === item.supersetGroup && x.id !== item.id)
          .map((x) => (getExercise(x.exerciseId) || x.exerciseSnapshot).name)
      : [];
    const canFold = itemComplete(item);
    return `<section class="card exercise-card ${canFold ? "exercise-finished" : ""} ${item.supersetGroup ? "superset-card" : ""} ${usesLoad(ex) && exUnit(ex) === "lb" ? "unit-lb" : ""}" id="exercise_${item.id}"><div class="exercise-top"><div class="row start"><div><div class="wrap"><h3>${nameHTML(ex.name)}</h3><span class="pill priority-pill">${esc(item.target?.priority || "B")}</span>${sup}${prPill}</div>${focusHTML(ex)}<div class="target">${item.target?.sets || sets.length} × ${item.target?.min || ex.defaultMin}–${item.target?.max || ex.defaultMax} · ${restText(item.target?.rest || ex.defaultRest || 90)} rest${canFold ? '<span class="exercise-complete-note">✓ All sets logged</span>' : ""}</div><div class="meta">${muscleName(ex.primaryMuscle)} · ${esc(ex.equipment || "")} · ${trackingLabel(ex.trackingType)}</div>${supNames.length ? `<div class="meta superset-link">Linked with ${supNames.map(esc).join(" + ")}</div>` : ""}</div><div class="exercise-top-actions">${canFold ? `<button class="icon-btn toggle-item" data-item="${item.id}" type="button" aria-expanded="true" aria-label="Fold ${esc(ex.name)}">⌃</button>` : ""}<button class="icon-btn exercise-menu" data-item="${item.id}" type="button" aria-label="Options for ${esc(ex.name)}">•••</button></div></div></div><div class="exercise-body">
      ${ex.notes ? `<div class="note-box"><strong>Exercise note:</strong> ${esc(ex.notes)}</div>` : ""}
      <div class="previous">${previousHTML(prevEntry, ex, session)}<div><strong>Suggested:</strong> ${esc(suggestion)}</div></div>
      <div class="set-head"><span aria-hidden="true">Set</span><span aria-hidden="true">Type</span>${unitHeaderHTML(item, ex)}<span aria-hidden="true">${repHeader(ex)}</span><span aria-hidden="true">${state.settings.trackRir ? "RIR" : ""}</span><span aria-hidden="true">Done</span></div>
      <div id="sets_${item.id}">${sets.map((st, i) => liveSetRow(session, item, ex, st, i, prev)).join("")}</div>
      <div class="exercise-actions"><button class="btn ghost small-btn use-prev" data-item="${item.id}" type="button" aria-label="Use previous values">Previous</button><button class="btn ghost small-btn add-set" data-item="${item.id}" type="button">+ Set</button><button class="btn ghost small-btn add-warmup" data-item="${item.id}" type="button">+ Warm-up</button><button class="btn ghost small-btn remove-last-set" data-item="${item.id}" type="button">− Set</button><button class="btn ghost small-btn rest-now" data-item="${item.id}" type="button">Rest</button></div>
      <div class="exercise-flags"><label class="check-chip compact-chip"><input class="tech-good" data-item="${item.id}" type="checkbox" ${item.techniqueGood !== false ? "checked" : ""}><span>Technique good</span></label><label class="pain-inline"><span>Pain</span><select class="pain-select" data-item="${item.id}" aria-label="Pain or discomfort"><option value="none" ${item.pain === "none" ? "selected" : ""}>None</option><option value="mild" ${item.pain === "mild" ? "selected" : ""}>Mild</option><option value="stop" ${item.pain === "stop" ? "selected" : ""}>Stop exercise</option></select></label></div>
      ${item.notes ? `<div class="note-box"><strong>Session note:</strong> ${esc(item.notes)}</div>` : ""}
    </div></section>`;
  }
  // The weight column heading doubles as the kg/lb switch for that exercise (remembered for next time).
  function unitHeaderHTML(item, ex) {
    if (!usesLoad(ex) || !getExercise(item.exerciseId)) return `<span aria-hidden="true">${esc(loadHeader(ex))}</span>`;
    const u = exUnit(ex),
      other = u === "kg" ? "lb" : "kg";
    return `<button class="unit-toggle ${u === "lb" ? "is-lb" : ""}" data-item="${item.id}" type="button" aria-label="${esc(ex.name)} weights are in ${u}. Switch to ${other}."><span>${esc(loadHeader(ex))}</span><span class="unit-swap" aria-hidden="true">⇄</span></button>`;
  }
  function loadHeader(ex) {
    if (["reps_only", "bodyweight_reps", "duration"].includes(ex.trackingType)) return "Load";
    if (ex.trackingType === "assisted_bodyweight") return `Assist ${exUnit(ex)}`;
    if (ex.trackingType === "bodyweight_added") return `+${exUnit(ex)}`;
    return exUnit(ex);
  }
  function repHeader(ex) {
    if (isDurationBased(ex)) return "Sec";
    if (ex.trackingType === "distance_duration") return "Km";
    return "Reps";
  }
  function workingOrdinal(sets, index) {
    if (sets[index]?.type === "warmup") return -1;
    let n = -1;
    for (let i = 0; i <= index; i++) if (sets[i]?.type !== "warmup") n++;
    return n;
  }
  function previousSetCompact(ex, prevSet) {
    if (!prevSet) return "Previous —";
    const load =
      prevSet.loadKg > 0
        ? exW(ex, prevSet.loadKg)
        : ex.trackingType.includes("bodyweight")
          ? "BW"
          : "—";
    let second = "—";
    if (isDurationBased(ex)) second = `${prevSet.durationSec || 0}s`;
    else if (ex.trackingType === "distance_duration") second = `${prevSet.distanceKm || 0} km`;
    else second = `${prevSet.reps || 0} reps`;
    return `Previous ${load} · ${second}${prevSet.rir != null ? ` · RIR ${prevSet.rir}` : ""}`;
  }
  function instantSetPRs(session, item, st) {
    if (!st.complete || st.type === "warmup") return [];
    const ex = getExercise(item.exerciseId) || item.exerciseSnapshot;
    const history = allPriorSets(item.exerciseId, addDays(session.date, -1), session.id);
    // Earlier sets in this workout count too, so three sets at a new top weight show one PR, not three.
    const idx = item.sets.findIndex((x) => x.id === st.id);
    const earlier = item.sets.slice(0, Math.max(0, idx)).filter((x) => x.complete && x.type !== "warmup");
    return setPRTypes(ex, st, history, earlier);
  }
  function liveSetRow(session, item, ex, s, i, prev) {
    const second = isDurationBased(ex)
      ? s.durationSec
      : ex.trackingType === "distance_duration"
        ? s.distanceKm
        : s.reps;
    const loadShown = s.loadKg ? exWeight(ex, s.loadKg) : "";
    const ord = workingOrdinal(item.sets, i);
    const prevSet = ord >= 0 ? workingSets(prev || { sets: [] })[ord] : null;
    const prs = instantSetPRs(session, item, s);
    const setName = s.type === "warmup" ? "Warm-up set" : `Set ${ord + 1}`;
    return `<div class="set-entry ${s.complete ? "complete" : ""}" data-set-entry="${s.id}"><div class="set-row" data-set="${s.id}"><span class="set-num" aria-hidden="true">${s.type === "warmup" ? "W" : ord + 1}</span><select class="set-type" data-set="${s.id}" aria-label="${setName} type">${setTypes.map(([v, l]) => `<option value="${v}" ${s.type === v ? "selected" : ""}>${l}</option>`).join("")}</select><input class="set-load" data-set="${s.id}" type="text" inputmode="decimal" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(loadShown)}" placeholder="${usesLoad(ex) ? exUnit(ex) : "—"}" aria-label="${setName} ${esc(loadHeader(ex))}"><input class="set-reps" data-set="${s.id}" type="text" inputmode="${ex.trackingType === "distance_duration" ? "decimal" : "numeric"}" autocomplete="off" autocorrect="off" spellcheck="false" value="${second || ""}" placeholder="${repHeader(ex)}" aria-label="${setName} ${repHeader(ex).toLowerCase()}"><input class="set-rir" data-set="${s.id}" type="text" inputmode="numeric" autocomplete="off" autocorrect="off" spellcheck="false" maxlength="1" value="${s.rir ?? ""}" aria-label="${setName} reps in reserve" ${state.settings.trackRir && s.type !== "warmup" ? "" : "disabled"}><button class="done-btn ${s.complete ? "done" : ""}" data-set="${s.id}" type="button" aria-pressed="${s.complete ? "true" : "false"}" aria-label="${s.complete ? "Reopen" : "Complete"} ${setName.toLowerCase()}">✓</button></div>${s.type !== "warmup" ? `<div class="set-prev-line"><span>${esc(previousSetCompact(ex, prevSet))}</span>${prs.length ? `<span class="pr-inline">★ ${prs.join(" + ")}</span>` : ""}</div>` : ""}</div>`;
  }

  // keepDone: leave sets you've already ticked in this workout as they are (the "Previous" button).
  function prefillSessionItem(item, date, excludeSessionId = null, keepDone = false) {
    const ex = getExercise(item.exerciseId) || item.exerciseSnapshot;
    const prev = previousExerciseItem(item.exerciseId, addDays(date, -1), excludeSessionId);
    if (!prev) return 0;
    const prior = workingSets(prev),
      current = allWorkingSets(item);
    let filled = 0;
    current.forEach((st, i) => {
      const p = prior[i];
      if (!p || (keepDone && st.complete)) return;
      filled++;
      typedLoads.delete(st.id);
      if (!["reps_only", "bodyweight_reps", "duration"].includes(ex.trackingType)) st.loadKg = p.loadKg || 0;
      if (isDurationBased(ex)) st.durationSec = p.durationSec || 0;
      else if (ex.trackingType === "distance_duration") st.distanceKm = p.distanceKm || 0;
      else st.reps = p.reps || 0;
      st.rir = null;
      st.complete = false;
    });
    return filled;
  }

  // Tapping into a filled-in number selects it, so typing replaces it. Otherwise the cursor lands next to the
  // old number and "20" then "22" becomes "2220", which then gets logged and pre-filled into every later workout.
  function selectOnFocus(el) {
    let fresh = false,
      start = "";
    const all = () => {
      // Once you've started typing, leave the field alone.
      if (document.activeElement !== el || el.value !== start) return;
      try {
        el.setSelectionRange(0, el.value.length);
      } catch {
        try {
          el.select();
        } catch {}
      }
    };
    el.addEventListener("focus", () => {
      fresh = true;
      start = el.value;
      all();
      setTimeout(all, 0);
    });
    // The tap that focused the field would otherwise drop the cursor where the finger was, undoing the selection.
    // Only that first tap: tapping again places the cursor as usual.
    el.addEventListener("mouseup", (e) => {
      if (!fresh) return;
      fresh = false;
      e.preventDefault();
      all();
    });
    el.addEventListener("input", () => (fresh = false));
    el.addEventListener("blur", () => (fresh = false));
  }

  function wireLiveExercise(session, item, idx) {
    const ex = getExercise(item.exerciseId) || item.exerciseSnapshot;
    const card = byId(`exercise_${item.id}`);
    card.querySelectorAll(".toggle-item").forEach((b) =>
      b.addEventListener("click", () => {
        const isOpen = b.getAttribute("aria-expanded") === "true";
        if (isOpen) {
          expandedItems.delete(item.id);
          if (lastTouchedItemId === item.id) lastTouchedItemId = null;
        } else expandedItems.add(item.id);
        renderLiveSession(session, `#exercise_${item.id}`);
      }),
    );
    const root = byId(`sets_${item.id}`);
    if (!root) return; // folded card
    let previousTouched = null;
    const touch = () => {
      if (lastTouchedItemId !== item.id) {
        // The exercise you just left folds away (if finished); the anchor keeps what's under your finger in place.
        previousTouched = lastTouchedItemId;
        lastTouchedItemId = item.id;
      }
    };
    const rerender = (anchor) => refreshLive(session, [item.id, previousTouched], anchor || `#exercise_${item.id}`);
    const setAmount = (st, v) => {
      if (isDurationBased(ex)) st.durationSec = Math.max(0, numIn(v));
      else if (ex.trackingType === "distance_duration") st.distanceKm = Math.max(0, numIn(v));
      else st.reps = Math.max(0, numIn(v));
    };
    // Read the inputs of a set row straight from the screen, in case iOS hasn't fired "change" yet.
    const syncRow = (st) => {
      const row = root.querySelector(`.set-row[data-set="${st.id}"]`);
      if (!row) return;
      const load = row.querySelector(".set-load"),
        reps = row.querySelector(".set-reps"),
        rir = row.querySelector(".set-rir");
      if (load && load.value.trim() !== "") {
        if (load.value !== load.defaultValue) typedLoads.add(st.id);
        st.loadKg = Math.max(0, exToKg(ex, load.value));
      }
      if (reps && reps.value.trim() !== "") setAmount(st, reps.value);
      if (rir && !rir.disabled) st.rir = rir.value.trim() === "" ? null : clamp(numIn(rir.value), 0, 5);
    };
    // Changing a number on a set that's already logged gets the same typo check as ticking it. The new number
    // is saved straight away; "Put back" restores what was there.
    const keepChange = (st, before) => {
      if (!st.complete) return;
      const odd = unlikelySet(session, item, ex, st);
      if (!odd) return;
      askConfirm("Check this number", odd.text, { ok: "Keep it", cancel: "Put back" }).then((keep) => {
        if (keep) return;
        Object.assign(st, before);
        save();
        if (view.querySelector(".workout-head") && byId(`exercise_${item.id}`)) rerender(`[data-set-entry="${st.id}"]`);
      });
    };
    root.querySelectorAll(".set-load, .set-reps, .set-rir").forEach(selectOnFocus);
    card.querySelector(".unit-toggle")?.addEventListener("click", () => {
      const exObj = getExercise(item.exerciseId);
      if (!exObj) return;
      const from = exUnit(exObj),
        to = from === "kg" ? "lb" : "kg";
      // A weight still in its box (not saved yet) was typed in the old unit.
      root.querySelectorAll(".set-load").forEach((box) => {
        const st = item.sets.find((x) => x.id === box.dataset.set);
        if (st && box.value !== box.defaultValue && box.value.trim() !== "") {
          st.loadKg = Math.max(0, exToKg(exObj, box.value));
          typedLoads.add(st.id);
        }
      });
      const typed = item.sets.filter((st) => typedLoads.has(st.id) && num(st.loadKg) > 0);
      const apply = (keepNumbers) => {
        const onScreen = new Map(typed.map((st) => [st.id, kgIn(from, st.loadKg)]));
        exObj.unit = to;
        exObj.updatedAt = Date.now();
        if (keepNumbers) typed.forEach((st) => (st.loadKg = exToKg(exObj, onScreen.get(st.id))));
        touch();
        save();
        renderLiveSession(session, `#exercise_${item.id}`);
        showToast(`${exObj.name}: weights now in ${to}, here and next time.`);
      };
      // Pre-filled and saved weights are real, so they're shown converted. Numbers you just typed are usually
      // the machine's own numbers in the other unit, so ask.
      if (!typed.length) return apply(false);
      const n = kgIn(from, typed[0].loadKg);
      openActionSheet("Weight unit", `${exObj.name} in ${to}`, [
        [`My numbers were ${to}: ${n} → ${n} ${to}`, () => apply(true)],
        [`Convert them: ${n} ${from} → ${kgIn(to, typed[0].loadKg)} ${to}`, () => apply(false)],
      ]);
    });
    root.querySelectorAll(".set-type").forEach((el) =>
      el.addEventListener("change", () => {
        const st = item.sets.find((x) => x.id === el.dataset.set);
        st.type = el.value;
        if (st.type === "warmup") st.rir = null;
        touch();
        save();
        rerender(`[data-set-entry="${st.id}"]`);
      }),
    );
    root.querySelectorAll(".set-load").forEach((el) =>
      el.addEventListener("change", () => {
        const st = item.sets.find((x) => x.id === el.dataset.set);
        const before = { loadKg: st.loadKg };
        st.loadKg = Math.max(0, exToKg(ex, el.value));
        if (el.value.trim() !== "") typedLoads.add(st.id);
        touch();
        save();
        keepChange(st, before);
      }),
    );
    root.querySelectorAll(".set-reps").forEach((el) =>
      el.addEventListener("change", () => {
        const st = item.sets.find((x) => x.id === el.dataset.set);
        const before = { reps: st.reps, durationSec: st.durationSec, distanceKm: st.distanceKm };
        setAmount(st, el.value);
        touch();
        save();
        keepChange(st, before);
      }),
    );
    root.querySelectorAll(".set-rir").forEach((el) =>
      el.addEventListener("change", () => {
        const st = item.sets.find((x) => x.id === el.dataset.set);
        st.rir = el.value.trim() === "" ? null : clamp(numIn(el.value), 0, 5);
        touch();
        save();
      }),
    );
    root.querySelectorAll(".done-btn").forEach((el) =>
      el.addEventListener("click", async () => {
        const st = item.sets.find((x) => x.id === el.dataset.set);
        if (!st) return;
        syncRow(st);
        // A number far outside what you usually do is almost always a typo: ask before it's logged, because
        // whatever is logged becomes "Previous" and is pre-filled into the next workout.
        if (!st.complete) {
          const odd = unlikelySet(session, item, ex, st);
          if (odd) {
            save(); // keep what was typed, whichever way you answer
            const logIt = await askConfirm("Check this number", odd.text, { ok: "Log it anyway", cancel: "Fix it" });
            if (!logIt) {
              document.querySelector(`.set-row[data-set="${st.id}"] ${odd.field === "load" ? ".set-load" : ".set-reps"}`)?.focus();
              return;
            }
            if (st.complete || !item.sets.includes(st)) return;
          }
        }
        const wasExerciseComplete = itemComplete(item);
        st.complete = !st.complete;
        const justCompleted = st.complete;
        const exerciseJustFinished = justCompleted && !wasExerciseComplete && itemComplete(item);
        touch();
        save();
        const setPRs = justCompleted ? instantSetPRs(session, item, st) : [];
        // Tap sounds (if on) for live workouts only, like the visual feedback.
        if (!session.endTime) playTapSound(!justCompleted ? "reopen" : setPRs.length ? "pr" : exerciseJustFinished ? "exercise" : "log");
        if (justCompleted) {
          const prs = setPRs;
          if (prs.length) showToast(`★ ${ex.name}: ${prs.join(" + ")}`);
          else if (!session.endTime && exerciseJustFinished) showToast(`${ex.name}: all working sets logged.`);
          // No rest timer when editing a past workout.
          if (!session.endTime && state.settings.autoRest && shouldStartRest(session, item, idx, st))
            startRestTimer(
              item.target?.rest || ex.defaultRest || 90,
              item.supersetGroup ? `Superset ${item.supersetGroup}` : ex.name,
            );
        }
        rerender(`[data-set-entry="${st.id}"]`);
        if (!session.endTime) flashSetFeedback(item.id, st.id, justCompleted, exerciseJustFinished);
        // Move focus to the next open set (no scrolling, no keyboard) so the flow continues.
        const nextOpen = [...document.querySelectorAll(`#sets_${item.id} .done-btn:not(.done)`)][0];
        (nextOpen || document.querySelector(`[data-set-entry="${st.id}"] .done-btn`))?.focus({ preventScroll: true });
      }),
    );
    card.querySelector(".use-prev").addEventListener("click", () => {
      // Only the sets you haven't ticked yet: what you've already logged today stays.
      const filled = prefillSessionItem(item, session.date, session.id, true);
      touch();
      save();
      rerender();
      showToast(
        filled
          ? `${ex.name}: previous values filled in.`
          : previousExerciseItem(item.exerciseId, addDays(session.date, -1), session.id)
            ? `${ex.name}: every set with a previous value is already ticked.`
            : `${ex.name}: no previous workout to copy from yet.`,
      );
    });
    card.querySelector(".add-set").addEventListener("click", () => {
      const st = newSet("normal");
      const priorCurrent = allWorkingSets(item).at(-1);
      if (priorCurrent) {
        if (typedLoads.has(priorCurrent.id)) typedLoads.add(st.id);
        st.loadKg = priorCurrent.loadKg || 0;
        st.reps = priorCurrent.reps || 0;
        st.durationSec = priorCurrent.durationSec || 0;
        st.distanceKm = priorCurrent.distanceKm || 0;
      }
      item.sets.push(st);
      touch();
      save();
      rerender();
    });
    card.querySelector(".add-warmup").addEventListener("click", () => {
      item.sets.unshift(newSet("warmup"));
      touch();
      save();
      rerender();
    });
    card.querySelector(".remove-last-set").addEventListener("click", () => {
      if (item.sets.length <= 1) return showToast("Keep at least one set.");
      item.sets.pop();
      touch();
      save();
      rerender();
    });
    card
      .querySelector(".rest-now")
      .addEventListener("click", () =>
        startRestTimer(
          item.target?.rest || ex.defaultRest || 90,
          item.supersetGroup ? `Superset ${item.supersetGroup}` : ex.name,
        ),
      );
    card.querySelector(".tech-good").addEventListener("change", (e) => {
      item.techniqueGood = e.target.checked;
      save();
    });
    card.querySelector(".pain-select").addEventListener("change", (e) => {
      item.pain = e.target.value;
      save();
      if (e.target.value === "stop") showToast("Stop this exercise and choose a pain-free substitute.");
    });
    card.querySelector(".exercise-menu").addEventListener("click", () => openExerciseSessionMenu(session, item, idx));
  }

  function shouldStartRest(session, item, idx, set) {
    if (!item.supersetGroup) return true;
    const ord = workingOrdinal(
      item.sets,
      item.sets.findIndex((x) => x.id === set.id),
    );
    if (ord < 0) return false;
    const group = session.items.filter((it) => it.supersetGroup === item.supersetGroup);
    // An exercise in the superset with fewer sets doesn't block the rest timer.
    return group.every((it) => {
      const nth = allWorkingSets(it)[ord];
      return !nth || nth.complete;
    });
  }
  // Each set as it was done, sets at the same weight grouped: "20 kg × 12, 10 · 22.5 kg × 8".
  // (It used to show the heaviest weight next to every set's reps, as if all sets were done at that weight.)
  function setsSummaryText(sets, ex) {
    const t = ex.trackingType;
    const loadOf = (s) => {
      const w = num(s.loadKg);
      if (!usesLoad(ex)) return "";
      if (t === "bodyweight_added") return w > 0 ? `BW + ${exW(ex, w)}` : "BW";
      if (t === "assisted_bodyweight") return w > 0 ? `${exW(ex, w)} assist` : "BW";
      return w > 0 ? exW(ex, w) : "";
    };
    const amountOf = (s) =>
      isDurationBased(ex) ? `${num(s.durationSec)} s` : t === "distance_duration" ? `${num(s.distanceKm)} km` : `${num(s.reps)}`;
    const groups = [];
    sets.forEach((s) => {
      const load = loadOf(s),
        last = groups.at(-1);
      if (last && last.load === load) last.amounts.push(amountOf(s));
      else groups.push({ load, amounts: [amountOf(s)] });
    });
    const reps = isRepBased(ex) && !isDurationBased(ex);
    return groups
      .map((g) => (g.load ? `${g.load} × ${g.amounts.join(", ")}` : `${g.amounts.join(", ")}${reps ? " reps" : ""}`))
      .join(" · ");
  }
  // "Previous (Thu, Oct 8 · Chest + Triceps): 9 kg × 15, 14, 13, 12" — the date says where the numbers come from,
  // and the workout name shows when they come from a different day of the program.
  function previousHTML(entry, ex, session) {
    if (!entry) return `<div><strong>Previous:</strong> not done before</div>`;
    const when = fmtDate(entry.session.date),
      other = entry.session.name && entry.session.name !== session.name ? ` · ${entry.session.name}` : "";
    // Line breaks fall between groups, never inside "10 kg × 12".
    const sets = setsSummaryText(entry.sets, ex)
      .split(" · ")
      .map((g) => `<span class="nw">${esc(g)}</span>`)
      .join(" · ");
    return `<div class="previous-line"><strong>Previous</strong> <span class="previous-when">(${esc(when + other)})</span>: ${sets}</div>`;
  }
  function suggestLoad(ex, item, prev) {
    if (!prev) return "Choose a conservative load and establish a baseline.";
    if (prev.pain === "stop") return "Use a pain-free substitute before progressing.";
    if (prev.techniqueGood === false) return "Repeat or reduce load until technique is clean.";
    const sets = workingSets(prev);
    if (!sets.length) return "Repeat your last planned load.";
    const maxRep = item.target?.max || ex.defaultMax;
    const top =
      sets.length >= (item.target?.sets || sets.length) &&
      sets
        .slice(0, item.target?.sets || sets.length)
        .every((s) => (isDurationBased(ex) ? s.durationSec >= maxRep : s.reps >= maxRep));
    const rirOkay = sets.every((s) => s.rir == null || s.rir >= 1);
    const load = Math.max(0, ...sets.map((s) => s.loadKg || 0));
    // Steps in the exercise's own unit: a machine in lb goes up 5 lb, not "2.5 kg = 5.5 lb".
    const u = exUnit(ex),
      step = loadStep(ex),
      shown = (kg) => exWeight(ex, kg);
    if (ex.trackingType === "assisted_bodyweight") {
      // Less assistance is progress.
      const assist = Math.min(...sets.map((s) => num(s.loadKg)));
      if (top && rirOkay && assist > 0) {
        const next = round1(Math.max(0, shown(assist) - (step || (u === "lb" ? 5 : 2.5))));
        return next > 0 ? `Try ${next} ${u} of assistance.` : "Try it unassisted.";
      }
      return assist > 0 ? `Stay at ${shown(assist)} ${u} of assistance and add reps.` : "Add reps.";
    }
    if (["bodyweight_reps", "reps_only"].includes(ex.trackingType))
      return top && rirOkay ? "Top of the rep range — add reps or move to a harder variation." : "Add reps.";
    if (top && rirOkay && step > 0) {
      const next = round1(shown(load) + step);
      return ex.trackingType === "bodyweight_added" ? `Try bodyweight + ${next} ${u}.` : `Try ${next} ${u}.`;
    }
    return load ? `Stay at ${shown(load)} ${u} and add reps.` : "Add reps before adding load.";
  }
  // The usual jump in load, in the exercise's unit. Increments are saved in kg; in lb they snap to plate sizes.
  function loadStep(ex) {
    const kg = num(ex.incrementKg);
    if (kg <= 0) return 0;
    if (exUnit(ex) !== "lb") return kg;
    const lb = kg * LB;
    return [1, 2.5, 5, 10, 20].reduce((best, x) => (Math.abs(x - lb) < Math.abs(best - lb) ? x : best));
  }
  function openExerciseSessionMenu(session, item, idx) {
    const ex = getExercise(item.exerciseId) || item.exerciseSnapshot;
    const u = exUnit(ex),
      other = u === "kg" ? "lb" : "kg",
      canFixUnit = usesLoad(ex) && item.sets.some((st) => num(st.loadKg) > 0);
    openModal(
      "Exercise options",
      ex.name,
      `<div class="stack">${canFixUnit ? `<button class="btn ghost" id="fixUnitBtn" type="button">Weights here were typed in ${other}</button>` : ""}<button class="btn ghost" id="substituteBtn" type="button">Substitute for this workout</button><button class="btn ghost" id="noteItemBtn" type="button">Add / edit session note</button><label>Superset group<input id="supersetInput" value="${esc(item.supersetGroup || "")}" placeholder="e.g. A"></label><button class="btn ghost" id="saveSupersetBtn" type="button">Save superset group</button><button class="btn danger" id="removeExerciseSessionBtn" type="button">Remove from workout</button></div>`,
      "",
    );
    // Repair: numbers typed as the wrong unit (e.g. a machine's lb typed into kg boxes). The numbers stay; their
    // unit changes, so 100 "kg" becomes 100 lb = 45.4 kg. Only this exercise in this workout.
    byId("fixUnitBtn")?.addEventListener("click", async () => {
      const first = item.sets.find((st) => num(st.loadKg) > 0),
        typed = exWeight(ex, first.loadKg),
        asKg = (kg) => (u === "kg" ? num(kg) / LB : num(kg) * LB),
        n = item.sets.filter((st) => num(st.loadKg) > 0).length;
      const fix = await askConfirm(
        `Were these weights in ${other}, not ${u}?`,
        `${ex.name}, ${fmtDate(session.date)}.\n\n${typed} ${u} becomes ${typed} ${other} (${kgIn(u, asKg(first.loadKg))} ${u}). ${n} set${n === 1 ? "" : "s"} in this workout change; nothing else does.`,
        { ok: `Yes, they were ${other}` },
      );
      if (!fix) return;
      item.sets.forEach((st) => {
        if (num(st.loadKg) > 0) st.loadKg = asKg(st.loadKg);
      });
      const exObj = getExercise(item.exerciseId);
      if (
        exObj &&
        (await askConfirm(`Log ${ex.name} in ${other} from now on?`, "Weights are still saved in kg; this only changes how they're shown and typed.", {
          ok: `Use ${other}`,
          cancel: "Just this workout",
        }))
      ) {
        exObj.unit = other;
        exObj.updatedAt = Date.now();
      }
      save();
      closeModal();
      renderLiveSession(session, `#exercise_${item.id}`);
      showToast(`${ex.name}: weights in this workout read as ${other}.`);
    });
    byId("substituteBtn").addEventListener("click", () => {
      closeModal();
      openExercisePicker(
        (exId) => {
          const replacement = getExercise(exId);
          item.substitutedForExerciseId = item.exerciseId;
          item.exerciseId = exId;
          item.exerciseSnapshot = snapshotExercise(replacement);
          item.sets = Array.from({ length: item.target?.sets || 3 }, () => newSet("normal"));
          prefillSessionItem(item, session.date, session.id);
          save();
          renderLiveSession(session);
        },
        "Substitute exercise",
        item.exerciseId,
      );
    });
    byId("noteItemBtn").addEventListener("click", () => {
      closeModal();
      openTextModal("Exercise session note", item.notes || "", (v) => {
        item.notes = v;
        save();
        renderLiveSession(session);
      });
    });
    byId("saveSupersetBtn").addEventListener("click", () => {
      item.supersetGroup = byId("supersetInput").value.trim().toUpperCase().slice(0, 4);
      save();
      closeModal();
      renderLiveSession(session);
    });
    byId("removeExerciseSessionBtn").addEventListener("click", async () => {
      if (!(await askConfirm(`Remove ${ex.name} from this workout?`, "Its sets in this workout are removed too.", { ok: "Remove", danger: true })))
        return;
      const at = session.items.indexOf(item);
      if (at < 0) return closeModal();
      session.items.splice(at, 1);
      save();
      closeModal();
      renderLiveSession(session);
    });
  }
  async function finishSession(s, status) {
    const completed = s.items.reduce((n, i) => n + workingSets(i).length, 0),
      total = s.items.reduce((n, i) => n + allWorkingSets(i).length, 0);
    const aIncomplete = s.items.some(
      (i) => i.target?.priority === "A" && workingSets(i).length < Math.max(1, i.target.sets),
    );
    if (status === "complete" && ((total && completed / total < 0.9) || aIncomplete)) {
      const anyway = await askConfirm(
        "Mark it complete anyway?",
        "Less than 90% of the prescribed work is logged, or a Priority-A exercise isn't finished. You can also finish it as shortened.",
        { ok: "Mark complete", cancel: "Go back" },
      );
      if (!anyway || !state.sessions.includes(s)) return;
    }
    const editingHistory = !!s.endTime;
    const weekBefore = trainWeekStats();
    s.status = status;
    // Only a live workout gets a new end time. Editing a past workout must not change its duration.
    if (!editingHistory) s.endTime = Date.now();
    state.currentWorkoutId = null;
    save();
    stopElapsedTimer();
    releaseWakeLock();
    const prs = sessionPRs(s);
    if (editingHistory) {
      selectedHistorySessionId = s.id;
      navigate("history");
      return showToast("Workout updated.");
    }
    // A finished live workout: back to Train (the week fills in behind) with a short summary on top.
    stopRestTimer();
    trainSelectedDate = s.date;
    navigate("train");
    openWorkoutSummary(s, prs, weekBefore, trainWeekStats());
  }
  // What the workout added up to, shown once when a live workout is finished (v2.18). Reads only; saves nothing.
  function openWorkoutSummary(s, prs, before, after) {
    const sets = s.items.reduce((n, i) => n + workingSets(i).length, 0),
      planned = s.items.reduce((n, i) => n + allWorkingSets(i).length, 0),
      vol = s.items.reduce((n, i) => n + workingSets(i).reduce((a, x) => a + setVolume(x), 0), 0),
      secs = sessionDuration(s);
    const pct = (w) => (w.scheduled ? Math.min(100, Math.round((w.fulfilled / w.scheduled) * 100)) : 0);
    const byExercise = new Map();
    prs.forEach((pr) => {
      const types = byExercise.get(pr.exerciseId) || new Set();
      types.add(pr.type);
      byExercise.set(pr.exerciseId, types);
    });
    const prRows = [...byExercise.entries()]
      .slice(0, 4)
      .map(([id, types]) => {
        const name = getExercise(id)?.name || s.items.find((i) => i.exerciseId === id)?.exerciseSnapshot?.name || "Exercise";
        return `<div class="summary-pr"><strong>${esc(name)}</strong><span class="pill good">★ ${esc([...types].join(" + "))}</span></div>`;
      })
      .join("");
    const counted = after.fulfilled > before.fulfilled;
    const weekLine = !after.scheduled
      ? `${after.logged} workout${after.logged === 1 ? "" : "s"} logged this week.`
      : after.fulfilled >= after.scheduled && counted
        ? "Every planned session this week is done."
        : counted
          ? `${after.fulfilled} of ${after.scheduled} planned sessions done this week.`
          : `Extra workout · ${after.fulfilled} of ${after.scheduled} planned sessions done this week.`;
    openModal(
      s.status === "complete" ? "Workout complete" : "Workout shortened",
      s.name,
      `<div class="workout-summary">
        <div class="summary-week">
          ${after.scheduled ? `<div class="summary-ring" aria-hidden="true"><svg viewBox="0 0 64 64"><circle class="summary-ring-track" cx="32" cy="32" r="27"/><circle class="summary-ring-fill" cx="32" cy="32" r="27" pathLength="100" stroke-dasharray="${pct(after)} 100" transform="rotate(-90 32 32)"/></svg><span><strong>${after.fulfilled}/${after.scheduled}</strong><small>week</small></span></div>` : `<div class="summary-check" aria-hidden="true">✓</div>`}
          <p>${esc(weekLine)}</p>
        </div>
        <div class="summary-stats">
          <div><span class="meta">Duration</span><strong>${secs ? durationText(secs) : "—"}</strong></div>
          <div><span class="meta">Sets</span><strong>${sets}</strong><small class="muted">${planned > sets ? `of ${planned}` : "working"}</small></div>
          <div><span class="meta">Volume</span><strong>${vol ? Math.round(unitWeight(vol)).toLocaleString() : "—"}</strong><small class="muted">${weightUnit()}-reps</small></div>
          <div><span class="meta">PRs</span><strong>${distinctPRCount(prs)}</strong><small class="muted">${byExercise.size ? `${byExercise.size} exercise${byExercise.size === 1 ? "" : "s"}` : "this time"}</small></div>
        </div>
        ${prRows ? `<div class="summary-prs">${prRows}${byExercise.size > 4 ? `<p class="meta">+ ${byExercise.size - 4} more in the record</p>` : ""}</div>` : ""}
      </div>`,
      `<button class="btn ghost" id="summaryDetailsBtn" type="button">See record</button><button class="btn primary" id="summaryDoneBtn" type="button">Done</button>`,
    );
    byId("summaryDoneBtn").addEventListener("click", closeModal);
    byId("summaryDetailsBtn").addEventListener("click", () => {
      closeModal();
      openHistoryRecord(s.id);
    });
    playTapSound("finish");
    // The week ring fills from where it was to where it is now.
    const fill = modalBody.querySelector(".summary-ring-fill");
    if (fill?.animate && counted && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
      fill.animate([{ strokeDasharray: `${pct(before)} 100` }, { strokeDasharray: `${pct(after)} 100` }], {
        duration: 750,
        delay: 220,
        easing: "cubic-bezier(.2,.8,.2,1)",
        fill: "backwards",
      });
  }
  // Which PR types make sense for each tracking type.
  function prRules(ex) {
    const t = ex?.trackingType || "weight_reps";
    return {
      load: ["weight_reps", "bodyweight_added", "weight_duration"].includes(t),
      e1rm: t === "weight_reps",
      volume: t === "weight_reps",
      reps: ["weight_reps", "bodyweight_reps", "bodyweight_added", "assisted_bodyweight", "reps_only"].includes(t),
      duration: ["duration", "weight_duration"].includes(t),
    };
  }
  // PRs for one set against earlier sets. No PRs on the first-ever exposure to an exercise.
  function setPRTypes(ex, st, history, earlierThisSession = []) {
    if (!st.complete || st.type === "warmup" || !history.length) return [];
    const prior = history.concat(earlierThisSession),
      r = prRules(ex),
      out = [],
      load = num(st.loadKg),
      reps = num(st.reps);
    if (r.load && load > 0 && load > Math.max(0, ...prior.map((x) => num(x.loadKg)))) out.push("Weight PR");
    const e = r.e1rm ? e1rm(load, reps) : 0;
    if (e > 0 && e > Math.max(0, ...prior.map((x) => e1rm(num(x.loadKg), num(x.reps))))) out.push("e1RM PR");
    const sameLoad = prior.filter((x) => Math.abs(num(x.loadKg) - load) < 0.01);
    if (r.reps && reps > 0) {
      const best = Math.max(0, ...sameLoad.map((x) => num(x.reps)));
      if (best > 0 && reps > best) out.push("Rep PR");
    }
    if (r.duration && num(st.durationSec) > 0) {
      const best = Math.max(0, ...sameLoad.map((x) => num(x.durationSec)));
      if (best > 0 && num(st.durationSec) > best) out.push("Duration PR");
    }
    return out;
  }
  function sessionPRs(session, onlyExerciseId = null) {
    const result = [];
    session.items.forEach((item) => {
      if (onlyExerciseId && item.exerciseId !== onlyExerciseId) return;
      const cur = workingSets(item);
      if (!cur.length) return;
      const ex = getExercise(item.exerciseId) || item.exerciseSnapshot,
        r = prRules(ex);
      const priorSets = allPriorSets(item.exerciseId, addDays(session.date, -1), session.id);
      if (!priorSets.length) return;
      const priorMaxLoad = Math.max(0, ...priorSets.map((s) => num(s.loadKg))),
        curMaxLoad = Math.max(0, ...cur.map((s) => num(s.loadKg)));
      if (r.load && curMaxLoad > priorMaxLoad && curMaxLoad > 0)
        result.push({ exerciseId: item.exerciseId, type: "Weight PR", value: curMaxLoad });
      if (r.e1rm) {
        const priorE = Math.max(0, ...priorSets.map((s) => e1rm(s.loadKg, s.reps))),
          curE = Math.max(0, ...cur.map((s) => e1rm(s.loadKg, s.reps)));
        if (curE > priorE && curE > 0) result.push({ exerciseId: item.exerciseId, type: "e1RM PR", value: curE });
      }
      cur.forEach((st) => {
        const sameLoad = priorSets.filter((p) => Math.abs(num(p.loadKg) - num(st.loadKg)) < 0.01);
        if (r.reps && num(st.reps) > 0) {
          const best = Math.max(0, ...sameLoad.map((p) => num(p.reps)));
          if (best > 0 && num(st.reps) > best)
            result.push({ exerciseId: item.exerciseId, type: "Rep PR", value: st.reps, loadKg: num(st.loadKg) });
        }
        if (r.duration && num(st.durationSec) > 0) {
          const best = Math.max(0, ...sameLoad.map((p) => num(p.durationSec)));
          if (best > 0 && num(st.durationSec) > best)
            result.push({ exerciseId: item.exerciseId, type: "Duration PR", value: st.durationSec, loadKg: num(st.loadKg) });
        }
      });
      if (r.volume) {
        const curVolume = session.items
          .filter((i) => i.exerciseId === item.exerciseId)
          .reduce((a, i) => a + workingSets(i).reduce((x, st) => x + setVolume(st), 0), 0);
        const perSession = new Map();
        exerciseEntries(item.exerciseId).forEach((e) => {
          if (e.session.id === session.id || e.session.date >= session.date) return;
          perSession.set(e.session.id, (perSession.get(e.session.id) || 0) + e.sets.reduce((a, x) => a + setVolume(x), 0));
        });
        const bestPriorVolume = Math.max(0, ...perSession.values());
        if (curVolume > bestPriorVolume && bestPriorVolume > 0)
          result.push({ exerciseId: item.exerciseId, type: "Volume PR", value: curVolume });
      }
    });
    return dedupePRs(result);
  }
  function dedupePRs(list) {
    const seen = new Set();
    return list.filter((x) => {
      const k = `${x.exerciseId}|${x.type}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  function allPriorSets(exId, beforeDate, excludeId) {
    return exerciseEntries(exId)
      .filter((e) => e.session.id !== excludeId && e.session.date <= beforeDate)
      .flatMap((e) => e.sets);
  }
  function startElapsedTimer(s) {
    stopElapsedTimer();
    if (s.endTime) return;
    elapsedInterval = setInterval(() => {
      const el = byId("elapsedTimer");
      if (el) el.textContent = durationText(sessionDuration(s));
    }, 1000);
  }
  function stopElapsedTimer() {
    if (elapsedInterval) clearInterval(elapsedInterval);
    elapsedInterval = null;
  }
  function startRestTimer(sec, label, endAt = null) {
    stopRestTimer();
    unlockAudio();
    restEndAt = endAt || Date.now() + sec * 1000;
    byId("restTimerLabel").textContent = label;
    byId("restTimer").classList.remove("hidden");
    document.body.classList.add("rest-active");
    try {
      localStorage.setItem(REST_KEY, JSON.stringify({ endAt: restEndAt, label }));
    } catch {}
    tickRest();
    restInterval = setInterval(tickRest, 250);
  }
  function adjustRestTimer(deltaSec) {
    if (!restEndAt) return;
    restEndAt = Math.max(Date.now(), restEndAt + deltaSec * 1000);
    try {
      localStorage.setItem(REST_KEY, JSON.stringify({ endAt: restEndAt, label: byId("restTimerLabel").textContent }));
    } catch {}
    tickRest();
  }
  function tickRest() {
    const left = Math.max(0, Math.ceil((restEndAt - Date.now()) / 1000));
    byId("restTimerValue").textContent = restText(left);
    if (left <= 0) {
      stopRestTimer();
      showToast("Rest complete.");
      restAlert();
    }
  }
  function stopRestTimer() {
    if (restInterval) clearInterval(restInterval);
    restInterval = null;
    restEndAt = 0;
    byId("restTimer").classList.add("hidden");
    document.body.classList.remove("rest-active");
    try {
      localStorage.removeItem(REST_KEY);
    } catch {}
  }
  // Bring back a rest timer that was running when iOS reloaded the app.
  function restoreRestTimer() {
    try {
      const saved = JSON.parse(localStorage.getItem(REST_KEY) || "null");
      if (saved && saved.endAt > Date.now() + 1000) startRestTimer(0, saved.label || "Rest", saved.endAt);
      else localStorage.removeItem(REST_KEY);
    } catch {}
  }
  // iOS only plays sound after a tap has "unlocked" audio, so this runs on taps.
  function unlockAudio() {
    if (!state || (state.settings.restSound === false && !state.settings.tapSounds)) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) {
        setAudioSession(state.settings.restSound === false ? "ambient" : "transient");
        audioCtx = new AC();
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
    } catch {}
  }
  // iOS (Safari 16.4+): "transient" for the rest alert, which should be heard; "ambient" for tap sounds, so they
  // mix with your music instead of pausing it.
  function setAudioSession(type) {
    try {
      if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type;
    } catch {}
  }
  // ---------- Tap sounds (v2.19, off by default: More → Logging behavior) ----------
  // Short tones made on the spot with Web Audio: no sound files, nothing to download.
  // Each note: [frequency Hz, start s, length s, peak volume].
  const TAP_SOUNDS = {
    tick: [[1568, 0, 0.03, 0.03]],
    log: [
      [880, 0, 0.08, 0.08],
      [1318.5, 0.055, 0.1, 0.07],
    ],
    reopen: [[587.3, 0, 0.09, 0.06]],
    exercise: [
      [1046.5, 0, 0.1, 0.07],
      [1318.5, 0.07, 0.1, 0.07],
      [1568, 0.14, 0.18, 0.07],
    ],
    pr: [
      [1318.5, 0, 0.09, 0.06],
      [1568, 0.06, 0.09, 0.06],
      [1975.5, 0.12, 0.09, 0.06],
      [2637, 0.18, 0.26, 0.05],
    ],
    finish: [
      [523.25, 0, 0.7, 0.05],
      [659.25, 0.06, 0.7, 0.05],
      [783.99, 0.12, 0.7, 0.05],
      [1046.5, 0.18, 0.8, 0.05],
    ],
  };
  function playTapSound(name) {
    const notes = TAP_SOUNDS[name];
    if (!notes || !state?.settings?.tapSounds) return;
    try {
      unlockAudio();
      if (!audioCtx) return;
      setAudioSession("ambient");
      const t0 = audioCtx.currentTime + 0.01;
      notes.forEach(([freq, at, len, peak]) => {
        const osc = audioCtx.createOscillator(),
          gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + at);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + at);
        osc.stop(t0 + at + len + 0.02);
      });
    } catch {}
  }
  function restAlert() {
    if ("vibrate" in navigator) navigator.vibrate?.([120, 80, 120]);
    if (state.settings.restSound === false || !audioCtx) return;
    try {
      setAudioSession("transient");
      const t0 = audioCtx.currentTime + 0.02;
      [0, 0.22, 0.44].forEach((offset, i) => {
        const osc = audioCtx.createOscillator(),
          gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = i === 2 ? 1175 : 880;
        gain.gain.setValueAtTime(0.0001, t0 + offset);
        gain.gain.exponentialRampToValueAtTime(0.35, t0 + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.18);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t0 + offset);
        osc.stop(t0 + offset + 0.2);
      });
    } catch {}
  }
  // Keep the screen on during a live workout so the timer stays visible.
  async function requestWakeLock() {
    if (state.settings.keepAwake === false || wakeLock || !("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
      wakeLock.addEventListener?.("release", () => (wakeLock = null));
    } catch {
      wakeLock = null;
    }
  }
  function releaseWakeLock() {
    try {
      wakeLock?.release();
    } catch {}
    wakeLock = null;
  }
  function openSessionTimeModal(s) {
    const editing = !!s.endTime;
    const start = s.startTime ? new Date(s.startTime) : null;
    const startTimeValue = start
      ? `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`
      : "18:00";
    const minutes = s.startTime && s.endTime ? Math.round((s.endTime - s.startTime) / 60000) : "";
    openModal(
      "Workout",
      editing ? "Date & duration" : "Change date",
      `<div class="stack"><label>Date<input id="sessDate" type="date" value="${esc(s.date)}" max="${isoToday()}"></label>${
        editing
          ? `<div class="form-grid"><label>Start time<input id="sessStart" type="time" value="${startTimeValue}"></label><label>Duration (minutes)<input id="sessMinutes" type="number" min="0" max="600" step="1" inputmode="numeric" value="${minutes}" placeholder="Unknown"></label></div><p class="meta">Leave duration empty if you don't know it.</p>`
          : `<p class="meta">Use this if you're logging a workout that happened on another day. The timer keeps running.</p>`
      }</div>`,
      `<button class="btn primary" id="saveSessTime" type="button">Save</button>`,
    );
    byId("saveSessTime").addEventListener("click", () => {
      const date = byId("sessDate").value;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return showToast("Choose a valid date.");
      if (date > isoToday()) return showToast("The date can't be in the future.");
      s.date = date;
      if (editing) {
        const mins = byId("sessMinutes").value === "" ? null : clamp(byId("sessMinutes").value, 0, 600);
        const [hh, mm] = (byId("sessStart").value || "18:00").split(":").map(Number);
        const d = dateObj(date);
        d.setHours(hh || 0, mm || 0, 0, 0);
        if (mins) {
          s.startTime = d.getTime();
          s.endTime = s.startTime + mins * 60000;
        } else {
          s.startTime = null;
          s.endTime = d.getTime();
        }
      }
      save();
      closeModal();
      renderLiveSession(s);
      showToast("Workout date updated.");
    });
  }
  // Log a workout that happened on an earlier day (from History).
  function openBackfillModal(date) {
    if (state.currentWorkoutId) return showToast("Finish or pause the current workout first.");
    const p = activeProgram();
    openModal(
      "Log past workout",
      fmtDate(date),
      `<div class="stack"><label>Workout<select id="backfillDay">${(p?.days || []).map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}<option value="">Empty workout</option></select></label><div class="form-grid"><label>Start time<input id="backfillStart" type="time" value="18:00"></label><label>Duration (minutes)<input id="backfillMinutes" type="number" min="0" max="600" inputmode="numeric" value="60"></label></div><p class="meta">Sets are pre-filled from your previous session. Tick each set you did, then save.</p></div>`,
      `<button class="btn primary" id="backfillCreate" type="button">Start logging</button>`,
    );
    byId("backfillCreate").addEventListener("click", () => {
      const dayId = byId("backfillDay").value,
        d = p?.days.find((x) => x.id === dayId),
        mins = clamp(byId("backfillMinutes").value, 0, 600),
        [hh, mm] = (byId("backfillStart").value || "18:00").split(":").map(Number),
        startD = dateObj(date);
      startD.setHours(hh || 0, mm || 0, 0, 0);
      const session = {
        id: uid("sess"),
        date,
        programId: d ? p.id : null,
        programDayId: d ? d.id : null,
        name: d ? d.name : "Empty Workout",
        status: "in_progress",
        startTime: mins ? startD.getTime() : null,
        endTime: mins ? startD.getTime() + mins * 60000 : startD.getTime(),
        notes: "",
        items: d ? d.items.map((pi) => makeSessionItem(pi)) : [],
      };
      session.items.forEach((item) => prefillSessionItem(item, session.date, session.id));
      state.sessions.push(session);
      state.currentWorkoutId = session.id;
      resetLiveUi();
      save();
      closeModal();
      selectedHistoryDate = null;
      navigate("train");
    });
  }

  // ---------- PROGRAMS + LIBRARY ----------
  function renderPrograms() {
    const p = state.programs[selectedProgramId] || activeProgram() || Object.values(state.programs)[0];
    if (p) selectedProgramId = p.id;
    const activeExercises = Object.values(state.exercises).filter((e) => !e.archived),
      customCount = activeExercises.filter((e) => !e.builtIn).length;
    view.innerHTML = `<div class="stack">${revisionCardHTML("programs")}<section class="card"><div class="row"><div><p class="eyebrow">Program builder</p><h2>${p ? nameHTML(p.name) : "No program"}</h2><p class="meta">${p?.description ? esc(p.description) : "Create and edit reusable workout schedules."}</p></div><button class="btn primary" id="newProgramBtn" type="button">+ Program</button></div><div class="tabs" style="margin-top:12px">${Object.values(
      state.programs,
    )
      .map(
        (x) =>
          `<button class="tab ${x.id === selectedProgramId ? "active" : ""}" data-prog="${x.id}" type="button">${esc(x.name)}</button>`,
      )
      .join("")}</div></section>
      ${p ? `<section class="card"><div class="row"><div><strong>${p.days.length} training days</strong><div class="meta">${p.days.reduce((n, d) => n + d.items.length, 0)} exercise slots · ${p.days.reduce((n, d) => n + d.items.reduce((a, x) => a + x.sets, 0), 0)} planned sets</div></div><span class="pill ${p.id === state.settings.activeProgramId ? "good" : "neutral"}">${p.id === state.settings.activeProgramId ? "Active" : "Inactive"}</span></div><div class="wrap" style="margin-top:12px"><button class="btn ${p.id === state.settings.activeProgramId ? "secondary" : "ghost"}" id="activateProgramBtn" type="button">${p.id === state.settings.activeProgramId ? "Active program" : "Make active"}</button><button class="btn ghost" id="editProgramBtn" type="button">Edit details</button><button class="btn ghost" id="addDayBtn" type="button">+ Day</button><button class="btn ghost" id="duplicateProgramBtn" type="button">Duplicate program</button>${Object.keys(state.programs).length > 1 ? `<button class="btn danger" id="deleteProgramBtn" type="button">Delete</button>` : ""}</div></section>` : ""}
      ${p?.days.map((d, di) => programDayCard(p, d, di)).join("") || `<section class="card empty">No program days yet.</section>`}
      <section class="card"><div class="section-title"><h2>Exercise Library</h2><button class="btn primary small-btn" id="addExerciseLibraryBtn" type="button">+ Exercise</button></div><p class="meta">${activeExercises.length} active exercises · ${customCount} custom · Muscle mapping feeds weekly analytics automatically.</p><div class="wrap"><button class="btn ghost small-btn" id="openLibraryBtn" type="button">Open library</button></div></section>
    </div>`;
    document.querySelectorAll("[data-prog]").forEach((b) =>
      b.addEventListener("click", () => {
        selectedProgramId = b.dataset.prog;
        renderPrograms();
      }),
    );
    byId("newProgramBtn").addEventListener("click", () => openProgramDetailsModal(null));
    wireRevisionCard(renderPrograms);
    if (!p) return;
    byId("activateProgramBtn").addEventListener("click", () => {
      state.settings.activeProgramId = p.id;
      save();
      renderPrograms();
      showToast("Active program updated.");
    });
    byId("editProgramBtn").addEventListener("click", () => openProgramDetailsModal(p));
    byId("addDayBtn").addEventListener("click", () => openProgramDayModal(p, null));
    byId("duplicateProgramBtn").addEventListener("click", () => {
      const cp = clone(p);
      cp.id = uid("prog");
      cp.name = `${p.name} Copy`;
      cp.createdAt = Date.now();
      cp.updatedAt = Date.now();
      cp.days.forEach((d) => {
        d.id = uid("day");
        d.items.forEach((i) => (i.id = uid("pi")));
      });
      state.programs[cp.id] = cp;
      selectedProgramId = cp.id;
      save();
      renderPrograms();
      showToast("Program duplicated.");
    });
    byId("deleteProgramBtn")?.addEventListener("click", async () => {
      if (!(await askConfirm(`Delete ${p.name}?`, "Workouts you've already logged stay in History.", { ok: "Delete program", danger: true }))) return;
      if (!state.programs[p.id]) return;
      delete state.programs[p.id];
      if (state.settings.activeProgramId === p.id) state.settings.activeProgramId = Object.keys(state.programs)[0];
      selectedProgramId = state.settings.activeProgramId;
      save();
      renderPrograms();
    });
    document.querySelectorAll(".day-menu").forEach((b) =>
      b.addEventListener("click", () => {
        const di = p.days.findIndex((x) => x.id === b.dataset.day),
          d = p.days[di];
        if (!d) return;
        openActionSheet("Program day", d.name, [
          ["Edit day", () => openProgramDayModal(p, d)],
          ["Move up", () => moveProgramDay(p, d.id, -1), di === 0],
          ["Move down", () => moveProgramDay(p, d.id, 1), di === p.days.length - 1],
          ["Duplicate day", () => duplicateProgramDay(p, d.id)],
        ]);
      }),
    );
    document.querySelectorAll(".item-menu").forEach((b) =>
      b.addEventListener("click", () => {
        const d = p.days.find((x) => x.id === b.dataset.day),
          ii = d ? d.items.findIndex((x) => x.id === b.dataset.item) : -1,
          it = d?.items[ii];
        if (!it) return;
        openActionSheet(d.name, getExercise(it.exerciseId)?.name || "Exercise", [
          ["Edit sets, reps and rest", () => openProgramItemModal(p, d, it, it.exerciseId)],
          ["Move up", () => moveProgramItem(p, d.id, it.id, -1), ii === 0],
          ["Move down", () => moveProgramItem(p, d.id, it.id, 1), ii === d.items.length - 1],
          ["Duplicate", () => duplicateProgramItem(p, d.id, it.id)],
        ]);
      }),
    );
    document.querySelectorAll(".add-program-ex").forEach((b) =>
      b.addEventListener("click", () => {
        const d = p.days.find((x) => x.id === b.dataset.day);
        openExercisePicker((exId) => openProgramItemModal(p, d, null, exId), "Add exercise");
      }),
    );
    document.querySelectorAll(".edit-program-item").forEach((b) =>
      b.addEventListener("click", () => {
        const d = p.days.find((x) => x.id === b.dataset.day),
          it = d.items.find((x) => x.id === b.dataset.item);
        openProgramItemModal(p, d, it, it.exerciseId);
      }),
    );
    byId("addExerciseLibraryBtn").addEventListener("click", () => openExerciseModal(null, () => openLibraryModal()));
    byId("openLibraryBtn").addEventListener("click", () => openLibraryModal());
  }
  function plannedDayMuscles(day) {
    const totals = {};
    day.items.forEach((it) => {
      const ex = getExercise(it.exerciseId);
      if (!ex) return;
      totals[ex.primaryMuscle] = (totals[ex.primaryMuscle] || 0) + num(it.sets);
      (ex.secondaryMuscles || []).forEach(
        (m) => (totals[m] = (totals[m] || 0) + num(it.sets) * (state.settings.secondaryMultiplier ?? 0.5)),
      );
    });
    return totals;
  }
  function plannedDayMuscleChips(day) {
    const totals = plannedDayMuscles(day);
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([m, n]) => `<span class="pill neutral">${esc(muscleName(m))} ${round1(n)}</span>`)
      .join("");
  }
  function estimatedDayMinutes(day) {
    const rest = day.items.reduce((total, it) => total + Math.max(0, num(it.rest)) * Math.max(0, num(it.sets) - 1), 0);
    const work = day.items.reduce((total, it) => total + num(it.sets) * 42, 0);
    return Math.max(5, Math.round((rest + work) / 60));
  }
  function programDayCard(p, d, di) {
    return `<section class="card program-day"><div class="program-day-head"><div class="row start"><div><h3>${nameHTML(d.name)}</h3><div class="meta">${weekdayName(d.weekday)} · ${d.items.length} exercises · ${d.items.reduce((a, x) => a + x.sets, 0)} sets · ~${estimatedDayMinutes(d)} min</div><div class="wrap" style="margin-top:7px">${plannedDayMuscleChips(d) || `<span class="meta">Add exercises to see muscle coverage.</span>`}</div></div><button class="icon-btn menu-btn day-menu" data-day="${d.id}" type="button" aria-label="Options for ${esc(d.name)}">⋯</button></div></div><div class="program-items">${d.items
      .map((it, ii) => {
        const ex = getExercise(it.exerciseId);
        return `<div class="program-item"><button class="program-item-main edit-program-item" data-day="${d.id}" data-item="${it.id}" type="button"><strong>${nameHTML(ex?.name || "Missing exercise")}</strong>${ex ? focusHTML(ex, "span") : ""}<span class="meta">${it.sets} × ${it.min}–${it.max} · ${restText(it.rest)} · Priority ${it.priority}${it.supersetGroup ? ` · SS ${esc(it.supersetGroup)}` : ""}</span><span class="meta">${ex ? `${muscleName(ex.primaryMuscle)}${(ex.secondaryMuscles || []).length ? ` → ${(ex.secondaryMuscles || []).map(muscleName).join(", ")}` : ""}` : ""}</span></button><button class="icon-btn menu-btn item-menu" data-day="${d.id}" data-item="${it.id}" type="button" aria-label="Options for ${esc(ex?.name || "exercise")}">⋯</button></div>`;
      })
      .join(
        "",
      )}<button class="btn ghost small-btn add-program-ex" data-day="${d.id}" type="button">+ Exercise</button></div></section>`;
  }
  function moveProgramDay(p, dayId, dir) {
    const i = p.days.findIndex((x) => x.id === dayId),
      j = i + dir;
    if (i < 0 || j < 0 || j >= p.days.length) return;
    [p.days[i], p.days[j]] = [p.days[j], p.days[i]];
    p.updatedAt = Date.now();
    save();
    renderPrograms();
  }
  function duplicateProgramDay(p, dayId) {
    const d = p.days.find((x) => x.id === dayId);
    if (!d) return;
    const cp = clone(d);
    cp.id = uid("day");
    cp.name = `${d.name} Copy`;
    cp.weekday = -1;
    cp.items.forEach((i) => (i.id = uid("pi")));
    const at = p.days.findIndex((x) => x.id === dayId);
    p.days.splice(at + 1, 0, cp);
    p.updatedAt = Date.now();
    save();
    renderPrograms();
    showToast("Day duplicated as unscheduled.");
  }
  function moveProgramItem(p, dayId, itemId, dir) {
    const d = p.days.find((x) => x.id === dayId),
      i = d.items.findIndex((x) => x.id === itemId),
      j = i + dir;
    if (i < 0 || j < 0 || j >= d.items.length) return;
    [d.items[i], d.items[j]] = [d.items[j], d.items[i]];
    p.updatedAt = Date.now();
    save();
    renderPrograms();
  }
  function duplicateProgramItem(p, dayId, itemId) {
    const d = p.days.find((x) => x.id === dayId),
      i = d?.items.findIndex((x) => x.id === itemId);
    if (i == null || i < 0) return;
    const cp = clone(d.items[i]);
    cp.id = uid("pi");
    d.items.splice(i + 1, 0, cp);
    p.updatedAt = Date.now();
    save();
    renderPrograms();
    showToast("Exercise prescription duplicated.");
  }
  function openProgramDetailsModal(p) {
    const creating = !p;
    openModal(
      creating ? "New program" : "Program details",
      creating ? "Create reusable program" : p.name,
      `<div class="stack"><label>Name<input id="programName" value="${esc(p?.name || "")}" maxlength="60"></label><label>Description<textarea id="programDesc">${esc(p?.description || "")}</textarea></label></div>`,
      `<button class="btn primary" id="saveProgramDetails" type="button">${creating ? "Create" : "Save"}</button>`,
    );
    byId("saveProgramDetails").addEventListener("click", () => {
      const name = byId("programName").value.trim();
      if (!name) return showToast("Program name is required.");
      if (creating) {
        const id = uid("prog");
        state.programs[id] = {
          id,
          name,
          description: byId("programDesc").value.trim(),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          days: [],
        };
        selectedProgramId = id;
      } else {
        p.name = name;
        p.description = byId("programDesc").value.trim();
        p.updatedAt = Date.now();
      }
      save();
      closeModal();
      renderPrograms();
    });
  }
  function openProgramDayModal(p, d) {
    const creating = !d;
    openModal(
      creating ? "Add program day" : "Edit program day",
      p.name,
      `<div class="stack"><label>Day name<input id="dayName" value="${esc(d?.name || "")}" maxlength="50"></label><label>Scheduled weekday<select id="dayWeekday">${[
        [0, "Sunday"],
        [1, "Monday"],
        [2, "Tuesday"],
        [3, "Wednesday"],
        [4, "Thursday"],
        [5, "Friday"],
        [6, "Saturday"],
        [-1, "Unscheduled"],
      ]
        .map(([v, n]) => `<option value="${v}" ${Number(d?.weekday) === v ? "selected" : ""}>${n}</option>`)
        .join(
          "",
        )}</select></label>${!creating ? `<div class="note-box">Deleting this day changes the program only. Historical workouts remain intact.</div><button class="btn danger" id="deleteDayBtn" type="button">Delete day</button>` : ""}</div>`,
      `<button class="btn primary" id="saveDayBtn" type="button">Save</button>`,
    );
    byId("saveDayBtn").addEventListener("click", () => {
      const name = byId("dayName").value.trim();
      if (!name) return showToast("Day name is required.");
      if (creating) p.days.push({ id: uid("day"), name, weekday: Number(byId("dayWeekday").value), items: [] });
      else {
        d.name = name;
        d.weekday = Number(byId("dayWeekday").value);
      }
      p.updatedAt = Date.now();
      save();
      closeModal();
      renderPrograms();
    });
    byId("deleteDayBtn")?.addEventListener("click", async () => {
      if (!(await askConfirm(`Delete ${d.name || "this program day"}?`, "Workouts you've already logged stay in History.", { ok: "Delete day", danger: true }))) return;
      p.days = p.days.filter((x) => x.id !== d.id);
      save();
      closeModal();
      renderPrograms();
    });
  }
  function openProgramItemModal(p, d, it, exerciseId) {
    const ex = getExercise(exerciseId);
    if (!ex) return showToast("Exercise not found.");
    const v = it || {
      sets: 3,
      min: ex.defaultMin,
      max: ex.defaultMax,
      rest: ex.defaultRest,
      priority: "B",
      rirMin: 1,
      rirMax: 2,
      supersetGroup: "",
      notes: "",
    };
    openModal(
      it ? "Edit exercise prescription" : "Add exercise",
      ex.name,
      `<div class="note-box"><strong>${muscleName(ex.primaryMuscle)}</strong>${(ex.secondaryMuscles || []).length ? ` · secondary: ${(ex.secondaryMuscles || []).map(muscleName).join(", ")}` : ""}<br>${esc(ex.equipment)} · ${trackingLabel(ex.trackingType)}</div><div class="form-grid"><label>Sets<input id="piSets" type="number" min="1" max="20" value="${v.sets}"></label><label>Min reps / sec<input id="piMin" type="number" min="1" max="300" value="${v.min}"></label><label>Max reps / sec<input id="piMax" type="number" min="1" max="300" value="${v.max}"></label><label>Rest seconds<input id="piRest" type="number" min="0" max="900" value="${v.rest}"></label><label>Priority<select id="piPriority">${["A", "B", "C"].map((x) => `<option ${v.priority === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><label>Superset group<input id="piSS" value="${esc(v.supersetGroup || "")}" placeholder="A"></label><label>RIR min<input id="piRirMin" type="number" min="0" max="5" value="${v.rirMin ?? 1}"></label><label>RIR max<input id="piRirMax" type="number" min="0" max="5" value="${v.rirMax ?? 2}"></label></div><label>Program note<textarea id="piNotes">${esc(v.notes || "")}</textarea></label><div class="wrap"><button class="btn ghost small-btn" id="useExerciseDefaultsBtn" type="button">Use exercise defaults</button>${it ? `<button class="btn danger small-btn" id="removeProgramItem" type="button">Remove exercise</button>` : ""}</div>`,
      `<button class="btn primary" id="saveProgramItem" type="button">Save</button>`,
    );
    byId("useExerciseDefaultsBtn").addEventListener("click", () => {
      byId("piMin").value = ex.defaultMin;
      byId("piMax").value = ex.defaultMax;
      byId("piRest").value = ex.defaultRest;
      showToast("Exercise defaults applied.");
    });
    byId("saveProgramItem").addEventListener("click", () => {
      const obj = it || { id: uid("pi"), exerciseId };
      obj.sets = clamp(byId("piSets").value, 1, 20) || 3;
      obj.min = clamp(byId("piMin").value, 1, 300) || ex.defaultMin;
      obj.max = Math.max(obj.min, clamp(byId("piMax").value, 1, 300) || ex.defaultMax);
      obj.rest = clamp(byId("piRest").value, 0, 900) ?? ex.defaultRest;
      obj.priority = byId("piPriority").value;
      obj.supersetGroup = byId("piSS").value.trim().toUpperCase().slice(0, 4);
      obj.rirMin = clamp(byId("piRirMin").value, 0, 5) ?? 1;
      obj.rirMax = Math.max(obj.rirMin, clamp(byId("piRirMax").value, 0, 5) ?? 2);
      obj.notes = byId("piNotes").value.trim();
      if (!it) d.items.push(obj);
      p.updatedAt = Date.now();
      save();
      closeModal();
      renderPrograms();
    });
    byId("removeProgramItem")?.addEventListener("click", () => {
      d.items = d.items.filter((x) => x.id !== it.id);
      p.updatedAt = Date.now();
      save();
      closeModal();
      renderPrograms();
    });
  }

  function exerciseProgramUsage(exId) {
    const rows = [];
    Object.values(state.programs).forEach((p) =>
      p.days.forEach((d) => {
        const count = d.items.filter((i) => i.exerciseId === exId).length;
        if (count) rows.push({ program: p.name, day: d.name, count });
      }),
    );
    return rows;
  }
  function exerciseHistoryUsage(exId) {
    return state.sessions.filter((s) => s.items.some((i) => i.exerciseId === exId)).length;
  }
  function openLibraryModal() {
    openModal(
      "Exercise Library",
      "Built-in + custom exercises",
      libraryHTML(),
      `<button class="btn primary" id="libAddBtn" type="button">+ Custom exercise</button>`,
    );
    wireLibraryModal();
    byId("libAddBtn").addEventListener("click", () => {
      closeModal();
      openExerciseModal(null, () => openLibraryModal());
    });
  }
  function libraryHTML() {
    const list = Object.values(state.exercises)
      .filter((e) => {
        const muscleOk = libraryMuscle === "all" || e.primaryMuscle === libraryMuscle;
        const searchOk = e.name.toLowerCase().includes(librarySearch.toLowerCase());
        const scopeOk =
          libraryScope === "all" ||
          (libraryScope === "active" && !e.archived) ||
          (libraryScope === "custom" && !e.builtIn && !e.archived) ||
          (libraryScope === "builtin" && e.builtIn && !e.archived) ||
          (libraryScope === "archived" && e.archived);
        return muscleOk && searchOk && scopeOk;
      })
      .sort(exerciseOrder(libraryMuscle));
    return `<div class="stack"><div class="form-grid"><label>Search<input id="librarySearchInput" value="${esc(librarySearch)}" placeholder="Exercise name"></label><label>Primary muscle<select id="libraryMuscleSelect"><option value="all">All muscles</option>${SEED.muscles.map((m) => `<option value="${m.id}" ${libraryMuscle === m.id ? "selected" : ""}>${m.name}</option>`).join("")}</select></label></div><div class="tabs seg">${[
      ["active", "Active"],
      ["custom", "Custom"],
      ["builtin", "Built-in"],
      ["archived", "Archived"],
      ["all", "All"],
    ]
      .map(
        ([v, n]) =>
          `<button class="tab library-scope ${libraryScope === v ? "active" : ""}" data-scope="${v}" type="button">${n}</button>`,
      )
      .join("")}</div><div class="list">${
      list
        .map((e) => {
          const uses = exerciseProgramUsage(e.id).length,
            hist = exerciseHistoryUsage(e.id);
          return `<div class="list-row click-row library-row" data-ex="${e.id}"><div><strong>${esc(e.name)}</strong>${topPickHTML(e)}${focusHTML(e)}<div class="meta">${muscleName(e.primaryMuscle)}${(e.secondaryMuscles || []).length ? ` → ${(e.secondaryMuscles || []).map(muscleName).join(", ")}` : ""}</div><div class="meta">${esc(e.equipment)} · ${trackingLabel(e.trackingType)} · ${uses} program day${uses === 1 ? "" : "s"} · ${hist} logged session${hist === 1 ? "" : "s"}${e.archived ? " · Archived" : ""}</div></div><span class="pill ${e.archived ? "warn" : e.builtIn ? "neutral" : "good"}">${e.archived ? "Archived" : e.builtIn ? "Built-in" : "Custom"}</span></div>`;
        })
        .join("") || `<div class="empty">No exercises match.</div>`
    }</div></div>`;
  }
  function wireLibraryModal() {
    byId("librarySearchInput")?.addEventListener("input", (e) => {
      librarySearch = e.target.value;
      modalBody.innerHTML = libraryHTML();
      wireLibraryModal();
    });
    byId("libraryMuscleSelect")?.addEventListener("change", (e) => {
      libraryMuscle = e.target.value;
      modalBody.innerHTML = libraryHTML();
      wireLibraryModal();
    });
    document.querySelectorAll(".library-scope").forEach((b) =>
      b.addEventListener("click", () => {
        libraryScope = b.dataset.scope;
        modalBody.innerHTML = libraryHTML();
        wireLibraryModal();
      }),
    );
    document
      .querySelectorAll(".library-row")
      .forEach((r) => r.addEventListener("click", () => openExerciseDetails(r.dataset.ex)));
  }
  function openExerciseDetails(exId) {
    const ex = getExercise(exId);
    if (!ex) return;
    const usage = exerciseProgramUsage(ex.id),
      hist = exerciseHistoryUsage(ex.id);
    modalBody.innerHTML = `<div class="stack">${exFocus(ex) ? `<div class="focus-box"><span class="meta">Targets</span><strong>${esc(exFocus(ex))}</strong></div>` : ""}<div class="note-box"><strong>${muscleName(ex.primaryMuscle)}</strong>${(ex.secondaryMuscles || []).length ? ` · secondary: ${(ex.secondaryMuscles || []).map(muscleName).join(", ")}` : ""}<br>${esc(ex.equipment)} · ${trackingLabel(ex.trackingType)}${usesLoad(ex) ? ` · weights in ${exUnit(ex)}${ex.unit ? "" : " (app setting)"}` : ""}</div><div class="grid-2"><div class="metric"><span class="meta">Program use</span><strong>${usage.length}</strong><span class="small muted">program days</span></div><div class="metric"><span class="meta">History</span><strong>${hist}</strong><span class="small muted">logged sessions</span></div></div>${ex.notes ? `<div class="note-box"><strong>Exercise note:</strong> ${esc(ex.notes)}</div>` : ""}${usage.length ? `<div><p class="meta" style="font-weight:800">Used in</p><div class="list">${usage.map((u) => `<div class="list-row"><div><strong>${esc(u.day)}</strong><div class="meta">${esc(u.program)}</div></div><span class="pill neutral">${u.count}×</span></div>`).join("")}</div></div>` : ""}<div class="wrap"><button class="btn primary" id="detailEditEx" type="button">Edit</button><button class="btn ghost" id="detailDuplicateEx" type="button">Duplicate</button><button class="btn ghost" id="detailArchiveEx" type="button">${ex.archived ? "Restore" : "Archive"}</button>${!ex.builtIn ? `<button class="btn danger" id="detailDeleteEx" type="button">Delete</button>` : ""}</div></div>`;
    byId("modalTitle").textContent = ex.name;
    byId("modalEyebrow").textContent = ex.builtIn ? "Built-in exercise" : "Custom exercise";
    byId("detailEditEx").addEventListener("click", () => {
      closeModal();
      openExerciseModal(ex, () => openLibraryModal());
    });
    byId("detailDuplicateEx").addEventListener("click", () => {
      const cp = clone(ex);
      cp.focus = exFocus(ex);
      cp.id = uid("ex");
      cp.name = `${ex.name} Copy`;
      cp.builtIn = false;
      cp.archived = false;
      cp.createdAt = Date.now();
      cp.updatedAt = Date.now();
      state.exercises[cp.id] = cp;
      save();
      closeModal();
      openExerciseModal(cp, () => openLibraryModal());
    });
    byId("detailArchiveEx").addEventListener("click", () => {
      ex.archived = !ex.archived;
      save();
      modalBody.innerHTML = libraryHTML();
      byId("modalTitle").textContent = "Exercise Library";
      byId("modalEyebrow").textContent = "Built-in + custom exercises";
      wireLibraryModal();
      showToast(ex.archived ? "Exercise archived." : "Exercise restored.");
    });
    byId("detailDeleteEx")?.addEventListener("click", async () => {
      const currentUsage = exerciseProgramUsage(ex.id),
        historyUsage = exerciseHistoryUsage(ex.id);
      if (currentUsage.length || historyUsage) {
        return showToast("Archive this exercise instead; it is referenced by programs or history.");
      }
      if (!(await askConfirm(`Delete ${ex.name}?`, "This custom exercise is removed from your library for good.", { ok: "Delete", danger: true }))) return;
      delete state.exercises[ex.id];
      save();
      modalBody.innerHTML = libraryHTML();
      byId("modalTitle").textContent = "Exercise Library";
      byId("modalEyebrow").textContent = "Built-in + custom exercises";
      wireLibraryModal();
      showToast("Custom exercise deleted.");
    });
  }
  function openExerciseModal(ex, onSaved = null) {
    const creating = !ex;
    const v = ex || {
      name: "",
      primaryMuscle: "chest",
      secondaryMuscles: [],
      equipment: "Other",
      trackingType: "weight_reps",
      defaultMin: 8,
      defaultMax: 12,
      defaultRest: Number.isFinite(Number(state.settings.defaultExerciseRest))
        ? Number(state.settings.defaultExerciseRest)
        : 90,
      incrementKg: 2.5,
      notes: "",
      archived: false,
    };
    openModal(
      creating ? "New exercise" : "Edit exercise",
      creating ? "Add to your library" : v.name,
      `<div class="stack"><label>Name<input id="exName" value="${esc(v.name)}" maxlength="70"></label><label>Targets <span class="meta">optional · shown under the name</span><input id="exFocus" value="${esc(exFocus(v))}" maxlength="60" placeholder="e.g. Upper chest, Triceps long head"></label><div class="form-grid"><label>Primary muscle<select id="exPrimary">${SEED.muscles.map((m) => `<option value="${m.id}" ${v.primaryMuscle === m.id ? "selected" : ""}>${m.name}</option>`).join("")}</select></label><label>Equipment<select id="exEquipment">${equipments.map((x) => `<option ${v.equipment === x ? "selected" : ""}>${x}</option>`).join("")}</select></label><label>Tracking type<select id="exTracking">${trackingTypes.map(([id, n]) => `<option value="${id}" ${v.trackingType === id ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Weight unit<select id="exUnit"><option value="" ${v.unit === "kg" || v.unit === "lb" ? "" : "selected"}>App setting (${weightUnit()})</option><option value="kg" ${v.unit === "kg" ? "selected" : ""}>kg</option><option value="lb" ${v.unit === "lb" ? "selected" : ""}>lb</option></select></label><label>Load increment (<span id="exIncUnit">${exUnit(v)}</span>)<input id="exIncrement" type="number" step="0.5" min="0" inputmode="decimal" value="${incrementShown(v, exUnit(v))}"></label><label>Default min<input id="exMin" type="number" min="1" max="300" value="${v.defaultMin}"></label><label>Default max<input id="exMax" type="number" min="1" max="300" value="${v.defaultMax}"></label><label>Default rest (sec)<input id="exRest" type="number" min="0" max="900" value="${v.defaultRest}"></label></div><div><p class="meta" style="font-weight:800">Secondary muscles</p><p class="meta">These count fractionally toward muscle analytics using your secondary-set multiplier.</p><div class="checks">${SEED.muscles.map((m) => `<label class="check-chip"><input class="secondary-muscle" type="checkbox" value="${m.id}" ${(v.secondaryMuscles || []).includes(m.id) ? "checked" : ""}><span>${m.name}</span></label>`).join("")}</div></div><label>Persistent exercise note<textarea id="exNotes">${esc(v.notes || "")}</textarea></label>${!creating ? `<label class="check-chip"><input id="exArchived" type="checkbox" ${v.archived ? "checked" : ""}><span>Archived</span></label>` : ""}</div>`,
      `<button class="btn primary" id="saveExerciseBtn" type="button">${creating ? "Create exercise" : "Save"}</button>`,
    );
    // Switching the unit shows the increment in the new unit (5 lb instead of 2.5 kg).
    let incUnit = exUnit(v);
    byId("exUnit").addEventListener("change", () => {
      const next = byId("exUnit").value || weightUnit(),
        box = byId("exIncrement");
      if (next === incUnit) return;
      box.value =
        box.value === String(incrementShown(v, incUnit))
          ? incrementShown(v, next)
          : round1(next === "lb" ? numIn(box.value) * LB : numIn(box.value) / LB);
      incUnit = next;
      byId("exIncUnit").textContent = next;
    });
    byId("saveExerciseBtn").addEventListener("click", () => {
      const name = byId("exName").value.trim();
      if (!name) return showToast("Exercise name is required.");
      const primary = byId("exPrimary").value;
      const second = [...document.querySelectorAll(".secondary-muscle:checked")]
        .map((x) => x.value)
        .filter((x) => x !== primary);
      const obj = ex || { id: uid("ex"), builtIn: false, createdAt: Date.now() };
      Object.assign(obj, {
        name,
        primaryMuscle: primary,
        secondaryMuscles: second,
        equipment: byId("exEquipment").value,
        trackingType: byId("exTracking").value,
        unit: byId("exUnit").value || null,
        incrementKg: incrementFromForm(v, byId("exUnit").value || weightUnit(), byId("exIncrement").value),
        defaultMin: clamp(byId("exMin").value, 1, 300) || 8,
        defaultMax: clamp(byId("exMax").value, 1, 300) || 12,
        defaultRest: clamp(byId("exRest").value, 0, 900) ?? 90,
        notes: byId("exNotes").value.trim(),
        focus: byId("exFocus").value.trim(),
        archived: byId("exArchived")?.checked || false,
        updatedAt: Date.now(),
      });
      if (obj.defaultMax < obj.defaultMin) obj.defaultMax = obj.defaultMin;
      state.exercises[obj.id] = obj;
      save();
      closeModal();
      showToast(creating ? "Exercise created." : "Exercise saved.");
      if (onSaved) onSaved(obj.id);
      else if (activeView === "programs") renderPrograms();
      else render();
    });
  }
  // The increment as the edit form shows it in a unit; saved in kg. Left untouched, the saved value is kept as is.
  function incrementShown(ex, unit) {
    return unit === "lb" ? loadStep({ ...ex, unit: "lb" }) : round1(num(ex.incrementKg));
  }
  function incrementFromForm(ex, unit, typed) {
    if (String(typed).trim() === String(incrementShown(ex, unit))) return num(ex.incrementKg);
    return Math.max(0, unit === "lb" ? numIn(typed) / LB : numIn(typed));
  }
  function openExercisePicker(onPick, title = "Choose exercise", excludeId = null) {
    let pickerMuscle = "all";
    const allActive = () =>
      Object.values(state.exercises)
        .filter((e) => !e.archived && e.id !== excludeId)
        .sort((a, b) => a.name.localeCompare(b.name));
    openModal(
      title,
      "Exercise Library",
      `<div class="form-grid"><label>Search<input id="pickerSearch" placeholder="Search exercises"></label><label>Primary muscle<select id="pickerMuscle"><option value="all">All muscles</option>${SEED.muscles.map((m) => `<option value="${m.id}">${m.name}</option>`).join("")}</select></label></div><div class="list" id="pickerList">${pickerRows(allActive())}</div>`,
      `<button class="btn ghost" id="pickerNewExercise" type="button">+ Create exercise</button>`,
    );
    const filter = () => {
      const q = byId("pickerSearch").value.toLowerCase();
      pickerMuscle = byId("pickerMuscle").value;
      byId("pickerList").innerHTML = pickerRows(
        allActive()
          .filter((e) => e.name.toLowerCase().includes(q) && (pickerMuscle === "all" || e.primaryMuscle === pickerMuscle))
          .sort(exerciseOrder(pickerMuscle)),
      );
      wirePickRows();
    };
    const wirePickRows = () =>
      document.querySelectorAll(".pick-exercise").forEach((r) =>
        r.addEventListener("click", () => {
          const id = r.dataset.ex;
          closeModal();
          onPick(id);
        }),
      );
    byId("pickerSearch").addEventListener("input", filter);
    byId("pickerMuscle").addEventListener("change", filter);
    byId("pickerNewExercise").addEventListener("click", () => {
      closeModal();
      openExerciseModal(null, (id) => onPick(id));
    });
    wirePickRows();
  }
  function pickerRows(list) {
    return (
      list
        .map(
          (e) =>
            `<div class="list-row click-row pick-exercise" data-ex="${e.id}"><div><strong>${esc(e.name)}</strong>${topPickHTML(e)}${focusHTML(e)}<div class="meta">${muscleName(e.primaryMuscle)}${(e.secondaryMuscles || []).length ? ` → ${(e.secondaryMuscles || []).map(muscleName).join(", ")}` : ""} · ${esc(e.equipment)}</div></div><span>›</span></div>`,
        )
        .join("") || `<div class="empty">No matching exercises.</div>`
    );
  }

  // ---------- HISTORY ----------
  function renderHistory() {
    if (selectedHistorySessionId) {
      const s = getSession(selectedHistorySessionId);
      if (s) return renderHistoryDetail(s);
      selectedHistorySessionId = null;
    }
    const monthDate = dateObj(historyMonth),
      monthLabel = monthDate.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const matches = (s) => {
      if (historyProgramFilter !== "all" && s.programId !== historyProgramFilter) return false;
      if (historyExerciseFilter !== "all" && !s.items.some((i) => i.exerciseId === historyExerciseFilter)) return false;
      if (
        historyMuscleFilter !== "all" &&
        !s.items.some((i) => {
          const ex = i.exerciseSnapshot || getExercise(i.exerciseId);
          return (
            ex &&
            (ex.primaryMuscle === historyMuscleFilter || (ex.secondaryMuscles || []).includes(historyMuscleFilter))
          );
        })
      )
        return false;
      return true;
    };
    const allMonth = state.sessions
      .filter((s) => s.date.slice(0, 7) === historyMonth.slice(0, 7) && matches(s))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.startTime || 0) - (a.startTime || 0));
    const monthSessions = selectedHistoryDate ? allMonth.filter((s) => s.date === selectedHistoryDate) : allMonth;
    const activeExercises = Object.values(state.exercises)
      .filter((e) => !e.archived)
      .sort((a, b) => a.name.localeCompare(b.name));
    const completed = allMonth.filter((s) => s.status === "complete").length,
      shortened = allMonth.filter((s) => s.status === "shortened").length,
      skipped = allMonth.filter((s) => s.status === "skipped").length;
    const logged = allMonth.filter((s) => ["complete", "shortened"].includes(s.status));
    const monthSets = logged.reduce((n, s) => n + s.items.reduce((a, i) => a + workingSets(i).length, 0), 0);
    // sessionDuration() is in seconds.
    const monthMinutes = Math.round(logged.reduce((n, s) => n + sessionDuration(s), 0) / 60);
    const monthTime = monthMinutes >= 60 ? `${Math.floor(monthMinutes / 60)}h ${monthMinutes % 60}m` : `${monthMinutes}m`;
    view.innerHTML = `<div class="stack">
      <section class="card"><div class="calendar-head"><button class="icon-btn" id="prevMonth" type="button" aria-label="Previous month">‹</button><div><p class="eyebrow">Workout history</p><h2>${monthLabel}</h2></div><button class="icon-btn" id="nextMonth" type="button" aria-label="Next month">›</button></div>${calendarHTML(historyMonth)}</section>
      <section class="grid-3 history-month-metrics"><div class="metric"><span class="meta">Workouts</span><strong>${completed + shortened}</strong><span class="small muted">${completed} complete · ${shortened} shortened</span></div><div class="metric"><span class="meta">Working sets</span><strong>${monthSets}</strong><span class="small muted">${skipped} skipped</span></div><div class="metric"><span class="meta">Training time</span><strong>${monthTime}</strong><span class="small muted">Logged duration</span></div></section>
      ${selectedHistoryDate ? `<section class="card selected-history-day"><div class="row"><div><p class="eyebrow">Selected day</p><h2>${fmtDate(selectedHistoryDate)}</h2><p class="meta">${monthSessions.length} workout${monthSessions.length === 1 ? "" : "s"}</p></div><button class="btn ghost small-btn" id="clearHistoryDate" type="button">Show month</button></div>${selectedHistoryDate <= isoToday() ? `<button class="btn secondary" id="backfillBtn" type="button" style="margin-top:10px;width:100%">+ Log a workout on this day</button>` : ""}</section>` : ""}
      <section class="card"><div class="section-title"><h2>Filters</h2><button class="btn ghost small-btn" id="clearHistoryFilters" type="button">Clear</button></div><div class="form-grid three" style="margin-top:10px"><label>Exercise<select id="historyExercise"><option value="all">All exercises</option>${activeExercises.map((e) => `<option value="${e.id}" ${historyExerciseFilter === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label><label>Muscle<select id="historyMuscle"><option value="all">All muscles</option>${SEED.muscles.map((m) => `<option value="${m.id}" ${historyMuscleFilter === m.id ? "selected" : ""}>${m.name}</option>`).join("")}</select></label><label>Program<select id="historyProgram"><option value="all">All programs</option>${Object.values(
        state.programs,
      )
        .map(
          (p) => `<option value="${p.id}" ${historyProgramFilter === p.id ? "selected" : ""}>${esc(p.name)}</option>`,
        )
        .join("")}</select></label></div></section>
      <section class="card"><div class="section-title"><h2>${selectedHistoryDate ? "Workouts on this day" : "Sessions"}</h2><span class="meta">${monthSessions.length} workout${monthSessions.length === 1 ? "" : "s"}</span></div><div class="list">${monthSessions.map(sessionHistoryRow).join("") || `<div class="empty">No workouts match these filters.</div>`}</div></section>
    </div>`;
    byId("prevMonth").addEventListener("click", () => {
      const d = dateObj(historyMonth);
      d.setMonth(d.getMonth() - 1);
      historyMonth = startOfMonth(isoFromDate(d));
      selectedHistoryDate = null;
      renderHistory();
    });
    byId("nextMonth").addEventListener("click", () => {
      const d = dateObj(historyMonth);
      d.setMonth(d.getMonth() + 1);
      historyMonth = startOfMonth(isoFromDate(d));
      selectedHistoryDate = null;
      renderHistory();
    });
    byId("historyExercise").addEventListener("change", (e) => {
      historyExerciseFilter = e.target.value;
      renderHistory();
    });
    byId("historyMuscle").addEventListener("change", (e) => {
      historyMuscleFilter = e.target.value;
      renderHistory();
    });
    byId("historyProgram").addEventListener("change", (e) => {
      historyProgramFilter = e.target.value;
      renderHistory();
    });
    byId("clearHistoryFilters").addEventListener("click", () => {
      historyExerciseFilter = historyMuscleFilter = historyProgramFilter = "all";
      renderHistory();
    });
    byId("clearHistoryDate")?.addEventListener("click", () => {
      selectedHistoryDate = null;
      renderHistory();
    });
    byId("backfillBtn")?.addEventListener("click", () => openBackfillModal(selectedHistoryDate));
    document.querySelectorAll(".cal-day[data-cal-date]").forEach((b) =>
      b.addEventListener("click", () => {
        const date = b.dataset.calDate;
        const d = dateObj(date);
        if (date.slice(0, 7) !== historyMonth.slice(0, 7)) historyMonth = startOfMonth(date);
        selectedHistoryDate = date;
        renderHistory();
      }),
    );
    document.querySelectorAll(".history-session").forEach((r) =>
      r.addEventListener("click", () => {
        selectedHistorySessionId = r.dataset.session;
        renderHistory();
      }),
    );
  }
  function calendarHTML(monthStart) {
    const d = dateObj(monthStart),
      year = d.getFullYear(),
      month = d.getMonth();
    const first = new Date(year, month, 1, 12);
    const monday = state.settings.weekStarts !== "sunday";
    let offset = first.getDay();
    if (monday) offset = offset === 0 ? 6 : offset - 1;
    const labels = monday ? ["M", "T", "W", "T", "F", "S", "S"] : ["S", "M", "T", "W", "T", "F", "S"];
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const dayNum = i - offset + 1;
      const cd = new Date(year, month, dayNum, 12);
      const iso = isoFromDate(cd),
        inMonth = cd.getMonth() === month;
      const ss = state.sessions.filter((s) => s.date === iso);
      cells.push(
        `<button class="cal-day ${!inMonth ? "muted-day" : ""} ${iso === isoToday() ? "today" : ""} ${iso === selectedHistoryDate ? "selected" : ""}" type="button" data-cal-date="${iso}" aria-label="${fmtDate(iso)}${ss.length ? `, ${ss.length} workouts` : ""}"><strong>${cd.getDate()}</strong>${
          ss.length
            ? `<div class="dots">${ss
                .slice(0, 3)
                .map(
                  (s) =>
                    `<i class="dot ${s.status === "shortened" ? "short" : s.status === "skipped" ? "skip" : ""}"></i>`,
                )
                .join("")}</div>`
            : ""
        }</button>`,
      );
    }
    return `<div class="calendar">${labels.map((x) => `<div class="cal-label">${x}</div>`).join("")}${cells.join("")}</div>`;
  }
  function statusLabel(status) {
    return status === "in_progress" ? "Unfinished" : cap(status);
  }
  function statusPillClass(status) {
    return status === "complete" ? "good" : status === "shortened" || status === "in_progress" ? "warn" : "neutral";
  }
  function sessionHistoryRow(s) {
    const sets = s.items.reduce((n, i) => n + workingSets(i).length, 0),
      vol = s.items.reduce((n, i) => n + workingSets(i).reduce((a, x) => a + setVolume(x), 0), 0),
      prs = sessionPRs(s).length;
    const dur = s.status === "in_progress" || !s.startTime ? "" : ` · ${durationText(sessionDuration(s))}`;
    return `<div class="list-row click-row history-session" data-session="${s.id}"><div><strong>${esc(s.name)}</strong><div class="meta">${fmtDate(s.date)}${dur} · ${sets} set${sets === 1 ? "" : "s"}${vol ? ` · ${Math.round(unitWeight(vol))} ${weightUnit()}-reps` : ""}${prs ? ` · ${prs} PR${prs > 1 ? "s" : ""}` : ""}</div></div><span class="pill ${statusPillClass(s.status)}">${statusLabel(s.status)}</span></div>`;
  }
  function renderHistoryDetail(s) {
    const prs = sessionPRs(s),
      sets = s.items.reduce((n, i) => n + workingSets(i).length, 0),
      vol = s.items.reduce((n, i) => n + workingSets(i).reduce((a, x) => a + setVolume(x), 0), 0);
    const chron = state.sessions
      .filter((x) => ["complete", "shortened", "skipped"].includes(x.status))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || 0) - (b.startTime || 0));
    const pos = chron.findIndex((x) => x.id === s.id),
      prev = pos > 0 ? chron[pos - 1] : null,
      next = pos >= 0 && pos < chron.length - 1 ? chron[pos + 1] : null;
    view.innerHTML = `<div class="stack"><section class="card"><div class="preview-head"><button class="btn ghost small-btn back-inline" id="backHistoryBtn" type="button">‹ History</button><div class="preview-title"><p class="eyebrow">Workout record</p><h2>${nameHTML(s.name)}</h2><p class="meta">${fmtDate(s.date)} · ${statusLabel(s.status)}</p></div><span class="pill ${statusPillClass(s.status)}">${statusLabel(s.status)}</span></div><div class="grid-3"><div class="metric"><span class="meta">Duration</span><strong>${s.startTime && s.status !== "in_progress" ? durationText(sessionDuration(s)) : "—"}</strong></div><div class="metric"><span class="meta">Working sets</span><strong>${sets}</strong></div><div class="metric"><span class="meta">Volume</span><strong>${vol ? Math.round(unitWeight(vol)) : "—"}</strong><span class="small muted">${weightUnit()}-reps</span></div></div>${s.notes ? `<div class="note-box" style="margin-top:10px">${esc(s.notes)}</div>` : ""}<div class="wrap" style="margin-top:12px"><button class="btn ${s.status === "in_progress" ? "primary" : "ghost"}" id="editHistoryBtn" type="button">${s.status === "in_progress" ? "Resume" : "Edit workout"}</button><button class="btn danger" id="deleteHistoryBtn" type="button">Delete</button></div></section>
      ${prs.length ? `<section class="card"><div class="section-title"><h2>PRs from this workout</h2><span class="pill good">${prs.length}</span></div><div class="list">${prs.map((p) => `<div class="list-row"><div><strong>${esc(getExercise(p.exerciseId)?.name || "Exercise")}</strong><div class="meta">${esc(p.type)}</div></div><span class="pill good">${prDisplay(p)}</span></div>`).join("")}</div></section>` : ""}
      <section class="card"><div class="section-title"><h2>Exercises</h2><span class="meta">${s.items.length} exercises</span></div><div class="history-exercise-list">${s.items.map((i) => historyExerciseDetail(i)).join("") || `<div class="empty">No exercises recorded.</div>`}</div></section>
      <section class="card"><div class="preview-actions"><button class="btn ghost" id="previousHistorySession" type="button" ${prev ? "" : "disabled"}>‹ Previous workout</button><button class="btn ghost" id="nextHistorySession" type="button" ${next ? "" : "disabled"}>Next workout ›</button></div></section></div>`;
    byId("backHistoryBtn").addEventListener("click", () => {
      selectedHistorySessionId = null;
      renderHistory();
    });
    byId("editHistoryBtn").addEventListener("click", () => {
      // Never swap out a workout that is still running.
      const live = liveSession();
      if (live && live.id !== s.id) {
        showToast("Finish or pause your current workout first.");
        return;
      }
      state.currentWorkoutId = s.id;
      expandedItems = new Set();
      lastTouchedItemId = null;
      save();
      selectedHistorySessionId = null;
      navigate("train");
    });
    byId("deleteHistoryBtn").addEventListener("click", async () => {
      if (!(await askConfirm("Delete this workout?", `${s.name}, ${fmtDate(s.date)}. It's removed from History, stats and PRs for good.`, { ok: "Delete", danger: true })))
        return;
      state.sessions = state.sessions.filter((x) => x.id !== s.id);
      save();
      selectedHistorySessionId = null;
      renderHistory();
    });
    byId("previousHistorySession").addEventListener("click", () => {
      if (prev) {
        selectedHistorySessionId = prev.id;
        renderHistory();
      }
    });
    byId("nextHistorySession").addEventListener("click", () => {
      if (next) {
        selectedHistorySessionId = next.id;
        renderHistory();
      }
    });
    document.querySelectorAll(".history-exercise-analytics").forEach((b) =>
      b.addEventListener("click", () => {
        selectedExerciseAnalyticsId = b.dataset.exercise;
        progressTab = "exercise";
        selectedHistorySessionId = null;
        navigate("progress");
      }),
    );
  }
  function historyExerciseDetail(item) {
    const ex = getExercise(item.exerciseId) || item.exerciseSnapshot,
      sets = workingSets(item);
    return `<div class="history-exercise-card"><div class="row start"><div><strong>${esc(ex.name)}</strong><div class="meta">${muscleName(ex.primaryMuscle)} · ${esc(ex.equipment || "")}</div></div><button class="btn ghost small-btn history-exercise-analytics" data-exercise="${item.exerciseId}" type="button">Analytics</button></div>${item.notes ? `<div class="note-box" style="margin-top:8px">${esc(item.notes)}</div>` : ""}<div class="history-set-table"><div class="history-set-head"><span>Set</span><span>Type</span><span>Performance</span><span>RIR</span></div>${sets.map((st, idx) => `<div class="history-set-row"><span>${idx + 1}</span><span>${cap(st.type || "normal")}</span><strong>${setSummary(st, ex)}</strong><span>${st.rir == null ? "—" : st.rir}</span></div>`).join("") || `<div class="meta" style="padding:8px 0">No completed working sets.</div>`}</div></div>`;
  }
  function prDisplay(p) {
    const ex = getExercise(p.exerciseId);
    if (p.type === "Weight PR") return exW(ex, p.value);
    if (p.type === "e1RM PR") return exW(ex, p.value);
    if (p.type === "Rep PR") return num(p.loadKg) > 0 ? `${exW(ex, p.loadKg)} × ${p.value}` : `${p.value} reps`;
    if (p.type === "Duration PR") return num(p.loadKg) > 0 ? `${exW(ex, p.loadKg)} × ${p.value}s` : `${p.value}s`;
    if (p.type === "Volume PR") return `${Math.round(exWeight(ex, p.value))} ${exUnit(ex)}-reps`;
    return "PR";
  }
  function setSummary(st, ex) {
    if (isDurationBased(ex)) return `${exWeight(ex, st.loadKg || 0)}${exUnit(ex)} × ${st.durationSec}s`;
    if (ex.trackingType === "distance_duration") return `${st.distanceKm}km`;
    if (st.loadKg > 0) return `${exWeight(ex, st.loadKg)}${exUnit(ex)}×${st.reps}`;
    return `${st.reps} reps`;
  }

  // ---------- PROGRESS / ANALYTICS ----------
  function renderProgress() {
    view.innerHTML = `<div class="stack"><div class="tabs seg progress-tabs" role="tablist" aria-label="Progress sections">${[
      ["overview", "Overview"],
      ["muscles", "Muscles"],
      ["exercise", "Exercise"],
      ["body", "Body"],
      ["goals", "Goals"],
    ]
      .map(
        ([id, n]) =>
          `<button class="tab ${progressTab === id ? "active" : ""}" data-progress-tab="${id}" type="button" role="tab" aria-selected="${progressTab === id}">${n}</button>`,
      )
      .join("")}</div><div id="progressContent" class="stack">${progressTabHTML()}</div></div>`;
    screenEnter(`progress:${progressTab}`);
    document.querySelectorAll("[data-progress-tab]").forEach((b) =>
      b.addEventListener("click", () => {
        progressTab = b.dataset.progressTab;
        renderProgress();
      }),
    );
    wireProgressTab();
  }
  function progressTabHTML() {
    if (progressTab === "muscles") return musclesHTML();
    if (progressTab === "exercise") return exerciseAnalyticsHTML();
    if (progressTab === "body") return bodyHTML();
    if (progressTab === "goals") return goalsHTML();
    return overviewHTML();
  }
  function overviewHTML() {
    const week = weekSummary(isoToday()),
      insights = buildInsights(),
      avgWeight = bodyAverage("weight", 7),
      latestWaist = latestBody("waist"),
      recentPrs = recentPRs(30).slice(0, 5);
    const recent4 = trainingWindowStats(1, 4),
      previous4 = trainingWindowStats(5, 4),
      adherenceDelta =
        recent4.adherence == null || previous4.adherence == null ? null : recent4.adherence - previous4.adherence;
    return `<section class="card hero"><div class="row"><div><p class="meta">This week</p><div class="big">${week.done}/${week.scheduled}</div><p class="meta">workouts done this week · ${week.shortened} shortened</p></div><span class="pill ${week.done >= week.scheduled && week.scheduled ? "good" : "neutral"}">${week.sets} working set${week.sets === 1 ? "" : "s"}</span></div></section>
    <section class="grid-2"><div class="metric"><span class="meta">7-day body weight</span><strong>${avgWeight ? `${round1(unitWeight(avgWeight))} ${weightUnit()}` : "—"}</strong></div><div class="metric"><span class="meta">Latest waist</span><strong>${latestWaist ? `${round1(latestWaist.waist)} cm` : "—"}</strong></div></section>
    <section class="card"><div class="section-title"><div><p class="eyebrow">Training pulse</p><h2>Last 4 completed weeks</h2></div><span class="pill ${adherenceDelta != null && adherenceDelta >= 5 ? "good" : adherenceDelta != null && adherenceDelta <= -5 ? "warn" : "neutral"}">${adherenceDelta == null ? "—" : `${adherenceDelta >= 0 ? "+" : ""}${Math.round(adherenceDelta)} pp`}</span></div><div class="grid-3 insight-metrics" style="margin-top:10px"><div class="metric"><span class="meta">Adherence</span><strong>${recent4.adherence == null ? "—" : `${Math.round(recent4.adherence)}%`}</strong><span class="small muted">Previous ${previous4.adherence == null ? "—" : `${Math.round(previous4.adherence)}%`}</span></div><div class="metric"><span class="meta">Avg sessions / week</span><strong>${round1(recent4.sessions / 4)}</strong><span class="small muted">${recent4.sessions} logged sessions</span></div><div class="metric"><span class="meta">Avg session</span><strong>${recent4.avgDurationMin ? `${recent4.avgDurationMin}m` : "—"}</strong><span class="small muted">${Math.round(recent4.sets / 4)} sets/week</span></div></div></section>
    <section class="card"><div class="section-title"><h2>Insights</h2><span class="meta">Deterministic · based on your logs</span></div><div class="stack" style="margin-top:10px">${insights.map((x) => `<div class="insight ${x.tone || ""}"><div class="row start"><div><span class="insight-kicker">${esc(x.category || "Training")}</span><strong>${esc(x.title)}</strong></div>${x.badge ? `<span class="pill ${x.tone === "warn" ? "warn" : x.tone === "good" ? "good" : "neutral"}">${esc(x.badge)}</span>` : ""}</div><div class="meta">${esc(x.text)}</div>${x.action ? `<div class="insight-action">${esc(x.action)}</div>` : ""}</div>`).join("") || `<div class="empty">Log more workouts to generate useful insights.</div>`}</div></section>
    <section class="card"><div class="section-title"><h2>Recent PRs</h2><span class="meta">Last 30 days</span></div><div class="list">${recentPrs.map((p) => `<div class="list-row"><div><strong>${esc(getExercise(p.exerciseId)?.name || "Exercise")}</strong><div class="meta">${esc(p.type)} · ${fmtDate(p.date)}</div></div><span class="pill good">${p.display}</span></div>`).join("") || `<div class="empty">No PRs yet.</div>`}</div></section>`;
  }
  function weekSummary(date) {
    const start = startOfWeek(date),
      end = addDays(start, 6),
      p = activeProgram();
    const scheduled = p ? p.days.filter((d) => d.weekday >= 0).length : 0;
    const ss = state.sessions.filter(
      (s) => s.date >= start && s.date <= end && ["complete", "shortened"].includes(s.status),
    );
    const completed = ss.filter((s) => s.status === "complete").length,
      shortened = ss.filter((s) => s.status === "shortened").length;
    return {
      scheduled,
      completed,
      shortened,
      // Complete and shortened workouts both count as done, everywhere in the app.
      done: completed + shortened,
      sets: ss.reduce((n, s) => n + s.items.reduce((a, i) => a + workingSets(i).length, 0), 0),
    };
  }
  // ---------- weekly order (v2.11) ----------
  // Muscles worked yesterday or today (logged sets), to warn before training them again within ~48 hours.
  function recentlyWorkedMuscles() {
    const since = addDays(isoToday(), -1),
      out = new Set();
    state.sessions
      .filter((x) => x.date >= since && ["complete", "shortened", "in_progress"].includes(x.status))
      .forEach((x) =>
        x.items.forEach((i) => {
          const m = (getExercise(i.exerciseId) || i.exerciseSnapshot)?.primaryMuscle;
          if (m && workingSets(i).length) out.add(m);
        }),
      );
    return out;
  }
  function restNote(day) {
    const recent = recentlyWorkedMuscles();
    const hit = [...new Set(day.items.map((i) => getExercise(i.exerciseId)?.primaryMuscle).filter((m) => m && recent.has(m)))];
    return hit.length ? `Worked in the last 2 days: ${hit.map(muscleName).join(", ")}` : "";
  }

  // ---------- program updates (offered once, applied only on request) ----------
  // Someone who never applied the October revision is offered the whole revised program (which already
  // includes the later additions); someone who did is offered only the additions, added to their program.
  function pendingProgramUpdate() {
    const full = SEED.programRevision,
      add = SEED.programAdditions,
      cur = state.meta.programRevision;
    if (!Object.keys(state.programs || {}).length) return null;
    if (add && full && cur === full.id) return { kind: "additions", ...add };
    if (full && cur !== full.id && cur !== add?.id) return { kind: "full", ...full };
    return null;
  }
  function revisionCardHTML(where) {
    const u = pendingProgramUpdate();
    if (!u || (where === "train" && state.meta.programRevisionDismissed === u.id)) return "";
    const full = u.kind === "full";
    return `<section class="card revision-card"><p class="eyebrow">Program update</p><h2>${esc(u.title)}</h2><p class="meta">${esc(u.summary)}</p><ul class="revision-list">${u.changes.map((c) => `<li>${esc(c)}</li>`).join("")}</ul><div class="preview-actions" style="margin-top:12px"><button class="btn primary" id="applyRevisionBtn" type="button">${full ? "Apply to my program" : "Add to my program"}</button>${where === "train" ? `<button class="btn ghost" id="dismissRevisionBtn" type="button">Not now</button>` : ""}</div><p class="meta" style="margin-top:8px">${full ? "Your current program is kept as a copy in Programs, and your history doesn't change." : "Nothing in your program is removed, and your history doesn't change."}</p></section>`;
  }
  function wireRevisionCard(rerender) {
    byId("applyRevisionBtn")?.addEventListener("click", () => {
      const u = pendingProgramUpdate();
      if (!u) return rerender();
      if (u.kind === "full") {
        applyProgramRevision();
        rerender();
        showToast("Revised program applied. Your previous one is saved in Programs.");
      } else {
        const n = applyProgramAdditions();
        rerender();
        showToast(n ? `${n} exercise${n === 1 ? "" : "s"} added to your program.` : "Your program already has these exercises.");
      }
    });
    byId("dismissRevisionBtn")?.addEventListener("click", () => {
      state.meta.programRevisionDismissed = pendingProgramUpdate()?.id;
      save();
      rerender();
      showToast("You can add it later from Programs.");
    });
  }
  function addExerciseCues(cues) {
    Object.entries(cues || {}).forEach(([id, note]) => {
      const ex = state.exercises[id];
      if (ex && !ex.notes) ex.notes = note;
    });
  }
  function applyProgramAdditions() {
    const a = SEED.programAdditions,
      p = activeProgram();
    let added = 0;
    if (p)
      a.adds.forEach(({ dayId, after, item, pairWith }) => {
        const day = p.days.find((d) => d.id === dayId);
        if (!day || day.items.some((i) => i.exerciseId === item.exerciseId)) return;
        const at = day.items.findIndex((i) => i.exerciseId === after),
          it = { ...clone(item), id: uid("pi") };
        day.items.splice(at >= 0 ? at + 1 : day.items.length, 0, it);
        // Pair it with its partner as a superset, keeping a group the partner already has.
        const partner = pairWith ? day.items.find((i) => i.exerciseId === pairWith) : null;
        if (partner) {
          if (partner.supersetGroup) it.supersetGroup = partner.supersetGroup;
          else partner.supersetGroup = it.supersetGroup;
        }
        added++;
      });
    addExerciseCues(a.notes);
    if (p) p.updatedAt = Date.now();
    state.meta.programRevision = a.id;
    save();
    return added;
  }
  function applyProgramRevision() {
    const r = SEED.programRevision,
      rev = clone(SEED.program),
      cur = activeProgram(),
      stamp = Date.now();
    const days = rev.days.map((d) => ({ ...d, items: d.items.map((i) => ({ ...i, id: uid("pi") })) }));
    // Keep what was there as a separate, inactive program.
    if (cur) {
      const copy = clone(cur);
      copy.id = uid("prog");
      copy.name = `${cur.name} (before ${r.label})`;
      copy.createdAt = stamp;
      copy.updatedAt = stamp;
      state.programs[copy.id] = copy;
    }
    // The built-in program is updated in place (same day IDs, so this week's workouts still count);
    // any other active program is left alone and the revised one is added next to it.
    if (cur && cur.id === rev.id) Object.assign(cur, { name: rev.name, description: rev.description, days, updatedAt: stamp });
    else {
      const id = state.programs[rev.id] ? uid("prog") : rev.id;
      state.programs[id] = { ...rev, id, days, createdAt: stamp, updatedAt: stamp };
      state.settings.activeProgramId = id;
    }
    // Technique cues on the existing exercises the revision leans on, only where there's no note yet.
    addExerciseCues({
      lateral_raise: "Cable or dumbbell; keep tension at the bottom of the rep.",
      standing_calf: "Pause 1–2 s in the bottom stretch.",
      oh_tri: "Overhead position: more long-head growth than pressdowns.",
      ...(SEED.programAdditions?.notes || {}),
    });
    state.settings.weekStarts = "sunday";
    // The seed program already includes the later additions.
    state.meta.programRevision = LATEST_PROGRAM_UPDATE;
    selectedProgramId = state.settings.activeProgramId;
    save();
  }

  function recentPRs(days) {
    const cutoff = addDays(isoToday(), -(days - 1)),
      out = [];
    state.sessions
      .filter((s) => s.date >= cutoff && ["complete", "shortened"].includes(s.status))
      .sort((a, b) => a.date.localeCompare(b.date))
      .forEach((s) =>
        sessionPRs(s).forEach((p) => out.push({ ...p, date: s.date, display: prDisplay(p) })),
      );
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }
  function trainingWindowStats(offsetWeeks = 1, weeks = 4) {
    const currentStart = startOfWeek(isoToday()),
      end = addDays(currentStart, -7 * offsetWeeks + 6),
      start = addDays(end, -7 * weeks + 1),
      p = activeProgram(),
      scheduledPerWeek = p ? p.days.filter((d) => d.weekday >= 0).length : 0;
    const ss = state.sessions.filter(
      (s) => s.date >= start && s.date <= end && ["complete", "shortened"].includes(s.status),
    );
    const scheduled = scheduledPerWeek * weeks,
      sets = ss.reduce((n, s) => n + s.items.reduce((a, i) => a + workingSets(i).length, 0), 0),
      duration = ss.reduce((n, s) => n + sessionDuration(s), 0);
    return {
      start,
      end,
      weeks,
      scheduled,
      sessions: ss.length,
      sets,
      avgDurationMin: ss.length ? Math.round(duration / 60 / ss.length) : 0,
      adherence: scheduled ? Math.min(100, (ss.length / scheduled) * 100) : null,
    };
  }
  function completedWeekMuscleAverage(mid, weeks = 4, offsetWeeks = 1) {
    const current = startOfWeek(isoToday()),
      vals = [];
    for (let k = offsetWeeks; k < offsetWeeks + weeks; k++) {
      const start = addDays(current, -7 * k),
        st = muscleStatsForRange(start, addDays(start, 6))[mid] || { effective: 0 };
      vals.push(st.effective || 0);
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  function sessionPatternInsights() {
    const recent = state.sessions
        .filter((s) => ["complete", "shortened"].includes(s.status))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 24),
      groups = {};
    recent.forEach((s) => {
      const key = s.programDayId || s.name;
      if (!groups[key]) groups[key] = { name: s.name, total: 0, short: 0, durations: [] };
      const g = groups[key];
      g.total++;
      if (s.status === "shortened") g.short++;
      const mins = Math.round(sessionDuration(s) / 60);
      if (mins) g.durations.push(mins);
    });
    return Object.values(groups)
      .filter((g) => g.total >= 3 && g.short >= 2 && g.short / g.total >= 0.4)
      .sort((a, b) => b.short / b.total - a.short / a.total)
      .slice(0, 1)
      .map((g) => ({
        category: "Session pattern",
        tone: "warn",
        title: `${g.name} is often shortened`,
        badge: `${g.short}/${g.total}`,
        text: `${g.short} of the last ${g.total} logged ${g.name} sessions were shortened.`,
        action: "Consider moving lower-priority exercises later, trimming them, or reducing total session density.",
      }));
  }
  function buildInsights() {
    const out = [],
      recent4 = trainingWindowStats(1, 4),
      previous4 = trainingWindowStats(5, 4);
    if (recent4.sessions >= 4 && recent4.adherence != null) {
      if (previous4.sessions >= 2 && previous4.adherence != null) {
        const delta = recent4.adherence - previous4.adherence;
        if (delta >= 10)
          out.push({
            category: "Consistency",
            tone: "good",
            title: "Training adherence is improving",
            badge: `+${Math.round(delta)} pp`,
            text: `Your last 4 completed weeks averaged ${Math.round(recent4.adherence)}% adherence vs ${Math.round(previous4.adherence)}% in the previous 4.`,
            action: "Keep the current weekly structure while it remains sustainable.",
          });
        else if (delta <= -10)
          out.push({
            category: "Consistency",
            tone: "warn",
            title: "Training adherence has dropped",
            badge: `${Math.round(delta)} pp`,
            text: `Your last 4 completed weeks averaged ${Math.round(recent4.adherence)}% adherence vs ${Math.round(previous4.adherence)}% previously.`,
            action:
              "Check whether session length, scheduling, or lower-priority volume is making the plan harder to complete.",
          });
      }
      if (recent4.adherence >= 90)
        out.push({
          category: "Consistency",
          tone: "good",
          title: "Four-week consistency is strong",
          badge: `${Math.round(recent4.adherence)}%`,
          text: `You logged ${recent4.sessions} of ${recent4.scheduled} scheduled sessions across the last 4 completed weeks.`,
        });
    }
    if (recent4.sessions >= 6) {
      const sustained = SEED.muscles
        .map((m) => {
          const avg = completedWeekMuscleAverage(m.id, 4, 1),
            t = state.settings.muscleTargets[m.id] || [0, 999];
          return { m, avg, t, low: t[0] >= 4 && avg < t[0] * 0.72, high: t[1] > 0 && t[1] < 99 && avg > t[1] * 1.18 };
        })
        .filter((x) => x.low || x.high)
        .sort((a, b) => {
          const ag = a.low ? a.t[0] - a.avg : a.avg - a.t[1],
            bg = b.low ? b.t[0] - b.avg : b.avg - b.t[1];
          return bg - ag;
        })
        .slice(0, 2);
      sustained.forEach((x) =>
        out.push(
          x.low
            ? {
                category: "Volume",
                tone: "warn",
                title: `${x.m.name} has been consistently under target`,
                badge: `${round1(x.avg)}/wk`,
                text: `Four-week average: ${round1(x.avg)} effective sets vs your ${x.t[0]}–${x.t[1]} target.`,
                action:
                  "If this muscle is a priority, add volume gradually rather than correcting everything in one session.",
              }
            : {
                category: "Volume",
                tone: "warn",
                title: `${x.m.name} is consistently above target`,
                badge: `${round1(x.avg)}/wk`,
                text: `Four-week average: ${round1(x.avg)} effective sets vs your ${x.t[0]}–${x.t[1]} target.`,
                action: "If recovery or performance is slipping, reduce the lowest-priority contributing work first.",
              },
        ),
      );
    }
    out.push(...sessionPatternInsights());
    const plateaus = findPlateaus();
    plateaus
      .slice(0, 2)
      .forEach((p) =>
        out.push({
          category: "Strength",
          tone: "warn",
          title: `${p.name} plateau signal`,
          badge: "6 exposures",
          text: p.context,
          action: p.action,
        }),
      );
    if (!out.length && state.sessions.length)
      out.push({
        category: "Training",
        tone: "good",
        title: "No major pattern needs attention",
        text: "Recent consistency, volume distribution, and strength trends do not show a strong deterministic warning signal.",
      });
    return out.slice(0, 6);
  }
  function sumMus(stats, ids) {
    return ids.reduce((a, id) => a + (stats[id]?.effective || 0), 0);
  }
  function findPlateaus() {
    return Object.values(state.exercises)
      .map((ex) => {
        const pts = exerciseE1rmPoints(ex.id).slice(-6);
        if (pts.length < 6) return null;
        const vals = pts.map((x) => x.value),
          avg = vals.reduce((a, b) => a + b, 0) / vals.length,
          spread = avg ? (Math.max(...vals) - Math.min(...vals)) / avg : 1;
        if (spread > 0.01) return null;
        const vols = exercisePerformanceSeries(ex.id, "volume")
          .slice(-6)
          .map((x) => x.value);
        let context = "Estimated 1RM has stayed within about 1% across the last six exposures.",
          action =
            "If technique and RIR are stable, consider a small progression change rather than adding volume automatically.";
        if (vols.length >= 6) {
          const a = vols.slice(0, 3).reduce((x, y) => x + y, 0) / 3,
            b = vols.slice(-3).reduce((x, y) => x + y, 0) / 3,
            delta = a ? ((b - a) / a) * 100 : 0;
          if (delta >= 8) {
            context = `Estimated 1RM is flat, while session volume rose about ${Math.round(delta)}% across the same six exposures.`;
            action =
              "You may be accumulating more work without translating it into top-set strength; review fatigue, rep targets, and progression increments.";
          } else if (delta <= -8) {
            context = `Estimated 1RM is flat and session volume fell about ${Math.abs(Math.round(delta))}% across the same six exposures.`;
            action = "Check recent session completion and recovery before changing the exercise or adding more work.";
          }
        }
        return { id: ex.id, name: ex.name, context, action };
      })
      .filter(Boolean);
  }

  function muscleWeeklySeries(mid, weeks = 8) {
    const current = startOfWeek(isoToday()),
      out = [];
    for (let k = weeks - 1; k >= 0; k--) {
      const start = addDays(current, -7 * k),
        end = addDays(start, 6),
        st = muscleStatsForRange(start, end)[mid] || { direct: 0, effective: 0 };
      out.push({ date: start, value: st.effective, direct: st.direct });
    }
    return out;
  }
  function musclesHTML() {
    const start = startOfWeek(isoToday()),
      end = addDays(start, 6),
      stats = muscleStatsForRange(start, end);
    if (!SEED.muscles.some((m) => m.id === selectedMuscleTrendId))
      selectedMuscleTrendId = SEED.muscles[0]?.id || "chest";
    const trend = muscleWeeklySeries(selectedMuscleTrendId, muscleTrendWeeks),
      target = state.settings.muscleTargets[selectedMuscleTrendId] || [0, 0],
      trendAvg = trend.length ? trend.reduce((a, b) => a + b.value, 0) / trend.length : 0;
    if (mapMuscle && !SEED.muscles.some((m) => m.id === mapMuscle)) mapMuscle = null;
    return `<section class="card muscle-map-card"><div class="section-title"><div><p class="eyebrow">Muscle analytics</p><h2>This week</h2></div><span class="meta">${fmtDate(start)} – ${fmtDate(end)}</span></div><div class="body-map-wrap${mapMuscle ? " has-selection" : ""}" id="bodyMapWrap">${bodyMapSVG("front", stats, mapMuscle)}${bodyMapSVG("back", stats, mapMuscle)}</div><div id="muscleMapDetail" aria-live="polite">${mapMuscle ? muscleMapPanelHTML(mapMuscle, stats) : ""}</div><div class="heat-scale" aria-label="Colour key">${MUSCLE_LEVELS.map((n, i) => `<div class="heat-step${i === 3 ? " key" : ""}"><i class="heat-${i}"></i><span>${n}</span></div>`).join("")}</div><p class="meta bm-note"><span class="only-dark">Brighter</span><span class="only-light">Darker</span> means more of your weekly target is done: on target is within your target range, over is above it. Tap a muscle to see what counted.</p></section>
    <section class="card"><div class="section-title"><div><p class="eyebrow">Volume trend</p><h2>${nameHTML(muscleName(selectedMuscleTrendId))}</h2></div><span class="pill neutral">${muscleTrendWeeks}-week avg ${round1(trendAvg)}</span></div><div class="analytics-top" style="margin-top:10px"><label>Muscle<select id="muscleTrendSelect">${SEED.muscles.map((m) => `<option value="${m.id}" ${m.id === selectedMuscleTrendId ? "selected" : ""}>${m.name}</option>`).join("")}</select></label><div class="tabs seg">${[
      [4, "4W"],
      [8, "8W"],
      [12, "12W"],
    ]
      .map(
        ([w, n]) =>
          `<button class="tab ${muscleTrendWeeks === w ? "active" : ""}" data-muscle-weeks="${w}" type="button">${n}</button>`,
      )
      .join("")}</div></div><div class="chart">${lineChart(
      trend.map((x) => ({ date: x.date, value: x.value })),
      "sets",
    )}</div><div class="note-box">Target: ${target[0]}–${target[1]} effective sets/week · Current week: ${round1(stats[selectedMuscleTrendId]?.effective || 0)}</div></section>
    <section class="card"><div class="muscle-row muscle-table-head"><span>Muscle</span><span>Direct</span><span>Effective</span><span>Target</span></div>${SEED.muscles
      .map((m) => {
        const x = stats[m.id] || { direct: 0, effective: 0 },
          t = state.settings.muscleTargets[m.id] || [0, 0],
          pct = t[0] ? Math.min(100, (x.effective / t[0]) * 100) : 0;
        return `<div class="muscle-row click-row muscle-detail" data-muscle="${m.id}"><div><strong>${m.name}</strong><div class="bar"><span style="width:${pct}%"></span></div></div><span>${round1(x.direct)}</span><span>${round1(x.effective)}</span><span>${t[0]}–${t[1]}</span></div>`;
      })
      .join("")}</section>`;
  }
  function muscleStatsForRange(start, end) {
    const out = {};
    SEED.muscles.forEach((m) => (out[m.id] = { direct: 0, effective: 0, contributors: {} }));
    state.sessions
      .filter((s) => s.date >= start && s.date <= end && ["complete", "shortened"].includes(s.status))
      .forEach((s) =>
        s.items.forEach((item) => {
          const ex = item.exerciseSnapshot || getExercise(item.exerciseId),
            c = workingSets(item).length;
          if (!c || !ex?.primaryMuscle) return;
          const pri = ex.primaryMuscle;
          if (out[pri]) {
            out[pri].direct += c;
            out[pri].effective += c;
            out[pri].contributors[ex.name] = (out[pri].contributors[ex.name] || 0) + c;
          }
          (ex.secondaryMuscles || []).forEach((mid) => {
            if (out[mid]) {
              const add = c * num(state.settings.secondaryMultiplier || 0.5);
              out[mid].effective += add;
              out[mid].contributors[ex.name] = (out[mid].contributors[ex.name] || 0) + add;
            }
          });
        }),
      );
    return out;
  }
  // ---------- BODY MAP ----------
  // Anatomy on a 200-wide grid centred on x = 100. Each shape is drawn for the figure's right side (the viewer's
  // left) and mirrored for the other side. Muscles are listed back to front: later shapes overlap earlier ones and a
  // thin line separates them, the way neighbouring muscles look. [shape, fibre lines] per part of a muscle.
  const BODY = {
    head: [100, 31, 18, 24],
    patella: [82.5, 322, 5.5, 6.5],
    silhouette: [
      "M88.5 44 Q88.5 58 85 70 L100 70 L100 44 Z", // neck
      "M100 63 L87 65 Q74 69 64 75 Q57 81 57 94 L61 118 Q66 128 67.5 142 Q69.5 162 73.5 180 Q70.5 196 66.5 210 Q63 224 63.5 238 L100 243 Z", // torso
      "M66 75 Q49.5 75 45 92 Q43.5 104 44 118 Q42 136 41 150 Q40 158 39 163 Q34 178 33 196 Q32 210 32 222 L43 224 Q45 208 48 193 Q52 176 54 163 Q57 150 60 136 L64 118 Z", // arm
      "M32 219 Q27 230 27 244 Q28 258 33 262 Q38 264 41 258 Q43 249 43 238 L43 222 Z", // hand
      "M66.5 206 Q62 224 62.5 248 Q63 276 68 306 Q70 318 69 328 Q66 346 67 366 Q69 388 73 408 L86 409 Q87 390 89 372 Q91 352 90 334 Q91 320 93 304 Q98 272 100 238 L100 200 Z", // leg
      "M73 406 Q65 418 66 428 Q67 433 74 433 L88 433 Q90 422 87 406 Z", // foot
    ],
    front: {
      // Parts the app doesn't track: neck, shin, hip, the side of the ribs.
      neutral: [
        "M91 52 Q94 63 97.5 74 L100.2 73.5 Q97 62 94 51 Z",
        "M73.5 333 Q79.5 340 80.5 358 Q80.5 380 79.5 401 L76 401 Q73.5 378 72.5 358 Q72 343 73.5 333 Z",
        "M66.5 207 Q71.5 212 72.5 224 Q70.5 233 65.5 238 Q63.5 222 66.5 207 Z",
        "M69 110 L76.5 115 L70.5 117.5 Z",
        "M70 118.5 L77 123 L71.5 125.5 Z",
        "M71 127 L76.5 130.5 L72 133 Z",
      ],
      muscles: [
        ["traps", [["M89 60 Q83 68 67 74.5 Q73.5 77 78.5 77 Q86 72.5 91.5 67.5 Z", []]]],
        ["side_delts", [["M62.5 75.5 Q48.5 76 45 92 Q43.5 106 46 117 Q49 126 54 129.5 Q54.5 112 55.5 98 Q57 84 62.5 75.5 Z", ["M53 83 Q48 99 50 119"]]]],
        ["front_delts", [["M74.5 77 Q64 75 58 80 Q54 92 54.5 106 Q55 120 56.5 129.5 Q61.5 120 64.5 106 Q67.5 90 74.5 77 Z", ["M66 83 Q60 97 58.5 120"]]]],
        ["chest", [["M99 77.5 Q86 75.5 74 78.5 Q66 83 63.5 95 Q64.5 103 68 108 Q74.5 120 86 124.5 Q94 125.5 99 121.5 Z", ["M97 82 Q84 82 70 88", "M97 90 Q84 92 67 96", "M97 99 Q85 101 67 102", "M97 108 Q86 110 70 106", "M96 116 Q86 118 75 113"]]]],
        ["biceps", [["M60.5 121 Q51 123 47.5 135 Q45.5 148 48 158 Q52 165 56 160 Q60 146 62 129 Z", ["M56.5 128 Q52 142 52.5 158"]]]],
        ["forearms", [
          ["M51 158 Q42 160 37.5 172 Q34 186 33.5 202 Q33.2 212 34 219 L38.5 219 Q39.5 204 42 190 Q45.5 175 52 164 Z", ["M44 166 Q38 182 36.5 206"]],
          ["M55 162 Q48 166 44.5 180 Q41.5 196 40 210 Q39.5 217 41.5 221 L43.5 221 Q45.5 207 48.5 193 Q52 179 55.5 167 Z", ["M51 170 Q45.5 186 42.5 212"]],
        ]],
        ["obliques", [["M71.5 128 Q80 130 87.5 133 L87.5 180 Q86.5 194 81.5 203 Q75 198 73 186 Q69.5 158 71.5 128 Z", ["M74 136 Q80.5 146 85.5 155", "M73.5 150 Q79.5 162 85.5 172", "M74 166 Q78.5 178 84 189"]]]],
        ["abs", [
          ["M88.5 126.5 Q94 123.5 98.8 125.5 L98.8 140 Q93.5 142 88.5 140 Z", []],
          ["M88.5 143 Q93.5 141.5 98.8 143 L98.8 157 Q93.5 158.5 88.5 157 Z", []],
          ["M88.5 160 Q93.5 158.5 98.8 160 L98.8 174 Q93.5 175.5 88.5 174 Z", []],
          ["M88.8 177 Q93.5 175.5 98.8 177 L98.8 205 Q95 211 92 205 Q89 193 88.8 177 Z", []],
        ]],
        ["adductors", [["M86 228 Q95 231 99.8 238 Q99 256 95.5 272 Q91 266 88 252 Z", ["M93 238 Q95 252 95 266"]]]],
        ["quads", [
          ["M67 212 Q75 214 80 228 Q83 252 81 280 Q79 300 77.5 315 Q72.5 318.5 70 310 Q64 285 63 256 Q63.5 228 67 212 Z", ["M69 226 Q69 262 72.5 306"]], // vastus lateralis
          ["M83 218 Q90.5 234 90.5 260 Q90 286 85.5 308 Q82.5 313 79.5 307 Q76 285 76.5 258 Q77.5 234 83 218 Z", ["M83.5 232 Q84 268 83 302"]], // rectus femoris
          ["M92 266 Q98 280 97 299 Q95 315 86 319.5 Q82.5 312 85 300 Q89.5 286 92 266 Z", ["M92 280 Q91 298 87 314"]], // vastus medialis
        ]],
        ["calves", [
          ["M84 330 Q92 338 92.5 356 Q91.5 374 86.5 386 Q81.5 378 81 360 Q81 342 84 330 Z", ["M86.5 340 Q88 358 86 378"]],
          ["M70 335 Q65.5 354 67 374 Q68.5 390 72.5 401 Q73 378 72.8 356 Q72.5 343 70 335 Z", []],
        ]],
      ],
    },
    back: {
      neutral: ["M77 396 L85 396 Q84.5 404 83.5 410 L78.5 410 Q77.5 404 77 396 Z"], // Achilles tendon
      muscles: [
        ["side_delts", [["M58 77 Q49 80 46 92 Q44.5 105 48 116 Q48.5 100 51.5 90 Z", []]]],
        ["rear_delts", [["M67 78 Q55 77 49 88 Q45.5 101 49 114 Q53.5 122 58.5 117 Q61.5 102 68 89 Z", ["M62 85 Q55 98 54 114"]]]],
        ["traps", [["M100 49 L95.5 49 Q92.5 58 87.5 66 Q76 73 63.5 77 Q76 84 86 95 Q93.5 118 100 152 Z", ["M97 56 Q88 68 70 78", "M98.5 84 Q90 88 76 85", "M99 116 Q94 102 88 96"]]]],
        ["upper_back", [
          ["M85.5 97 Q76 92 67.5 98 Q64.5 110 68 121 Q78.5 126 89.5 119 Q90 107 85.5 97 Z", ["M84 101 Q75.5 108 69.5 116", "M87.5 112 Q80 117 71.5 120"]],
          ["M67.5 123.5 Q64.5 128 64.5 132 Q73 135 83 126.5 Z", []],
        ]],
        ["lats", [["M63.5 127 Q78 134 91.5 126 Q95.5 141 97.5 157 Q93.5 174 85.5 191 Q77 191 73.5 180 Q68.5 153 63.5 127 Z", ["M69 137 Q79.5 161 84 187", "M77 135 Q86.5 153 89.5 178", "M86.5 131 Q92.5 147 94 163"]]]],
        ["lower_back", [["M92 150 Q97.5 151 99.4 155 L99.4 204 Q95 210 90.5 204 Q88.5 176 92 150 Z", ["M95 160 Q94.5 182 95 202"]]]],
        ["triceps", [["M62 112 Q52 112 47 124 Q44 140 45.5 156 Q50 164 55 160 Q60 142 62 112 Z", ["M54.5 120 Q50.5 136 50.5 156", "M58.5 122 Q56 139 55.5 155"]]]],
        ["forearms", [
          ["M51 158 Q42 160 37.5 172 Q34 186 33.5 202 Q33.2 212 34 219 L38.5 219 Q39.5 204 42 190 Q45.5 175 52 164 Z", ["M44 166 Q38 182 36.5 206"]],
          ["M55 162 Q48 166 44.5 180 Q41.5 196 40 210 Q39.5 217 41.5 221 L43.5 221 Q45.5 207 48.5 193 Q52 179 55.5 167 Z", ["M51 170 Q45.5 186 42.5 212"]],
        ]],
        ["glutes", [
          ["M67.5 200 Q78 190 94 193 Q86 199 78 203 Q71 207 67 213 Z", []], // glute medius
          ["M70.5 207 Q80 198 95.5 201 Q99.6 210 99.6 222 L99.6 236 Q92 245 79.5 243 Q67.5 239 65.5 225 Q65.5 213 70.5 207 Z", ["M96 209 Q86 218 70 225", "M97.5 223 Q86 231 70.5 233"]], // glute max
        ]],
        ["adductors", [["M95.5 244 Q99.8 250 99.8 262 Q98 272 95 278 Z", []]]],
        ["hamstrings", [
          ["M68.5 244 Q78 248 82.5 266 Q85 288 82 309 Q77.5 316 73.5 309 Q66.5 286 66 262 Q66 250 68.5 244 Z", ["M71.5 254 Q78 278 78 304"]], // biceps femoris
          ["M83 248 Q93 244 97 251 Q97 274 93 298 Q90.5 311 85.5 316 Q82.5 292 83 268 Z", ["M89.5 256 Q91 279 88.5 306"]], // semitendinosus
        ]],
        ["calves", [
          ["M70.5 324 Q65 342 67 362 Q71 375 78.8 370 Q81 350 80.3 332 Q77 321 70.5 324 Z", ["M72.5 333 Q70 350 72 366"]],
          ["M80.3 328 Q89 321 93 334 Q95.5 352 91 370 Q85 380 80.8 371 Q79.5 350 80.3 328 Z", ["M87.5 334 Q90 352 86.5 370"]],
          ["M68.5 366 Q70 381 74.5 397 L77 397 Q73.5 381 72.5 369 Z", []], // soleus
          ["M91 369 Q90 383 85.5 397 L88 397 Q92 383 92.5 367 Z", []],
        ]],
      ],
    },
  };
  // The other side of the body: every x becomes 200 − x. Paths use absolute commands with "x y" pairs only.
  function mirrorPath(d) {
    return d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${+(200 - Number(x)).toFixed(2)} ${y}`);
  }
  const bothSides = (d) => [d, mirrorPath(d)];
  // Status of a muscle this week, from its target range: 0 none, 1 started, 2 close, 3 on target, 4 over.
  const MUSCLE_LEVELS = ["None", "Started", "Close", "On target", "Over"];
  function muscleLevel(mid, stats) {
    const [lo, hi] = state.settings.muscleTargets[mid] || [0, 0],
      v = stats[mid]?.effective || 0;
    if (v <= 0) return 0;
    if (!(num(lo) > 0)) return 3;
    if (v < lo * 0.5) return 1;
    if (v < lo) return 2;
    return !(num(hi) > 0) || v <= hi ? 3 : 4;
  }
  // The silhouette and untracked parts never change, so they're built once per side.
  const bodyBaseCache = {};
  function bodyBase(side) {
    if (bodyBaseCache[side]) return bodyBaseCache[side];
    const [hx, hy, rx, ry] = BODY.head,
      uid = `bm-${side}`;
    const head = `M${hx} ${hy - ry} Q${hx + rx + 2} ${hy - ry} ${hx + rx} ${hy + 2} Q${hx + rx - 2} ${hy + ry - 4} ${hx} ${hy + ry} Q${hx - rx + 2} ${hy + ry - 4} ${hx - rx} ${hy + 2} Q${hx - rx - 2} ${hy - ry} ${hx} ${hy - ry} Z`;
    const hair =
      side === "back"
        ? `<path class="bm-hair" d="M${hx - rx + 1} ${hy + 2} Q${hx - rx} ${hy - ry} ${hx} ${hy - ry} Q${hx + rx} ${hy - ry} ${hx + rx - 1} ${hy + 2} Q${hx} ${hy - 4} ${hx - rx + 1} ${hy + 2} Z"/>`
        : "";
    const [px, py, prx, pry] = BODY.patella;
    const knees = side === "front" ? `<ellipse cx="${px}" cy="${py}" rx="${prx}" ry="${pry}"/><ellipse cx="${200 - px}" cy="${py}" rx="${prx}" ry="${pry}"/>` : "";
    const sacrum = side === "back" ? `<path d="M95 203 Q100 207 105 203 L105 214 Q100 218 95 214 Z"/>` : "";
    return (bodyBaseCache[side] =
      `<defs><radialGradient id="${uid}-sheen" cx="0.36" cy="0.28" r="0.85"><stop offset="0" class="bm-hi"/><stop offset="0.55" class="bm-mid"/><stop offset="1" class="bm-lo"/></radialGradient><linearGradient id="${uid}-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="bm-body-top"/><stop offset="1" class="bm-body-bot"/></linearGradient></defs>` +
      `<g class="bm-body" fill="url(#${uid}-body)"><path d="${head}"/>${BODY.silhouette.flatMap(bothSides).map((d) => `<path d="${d}"/>`).join("")}</g>${hair}` +
      `<g class="bm-neutral">${BODY[side].neutral.flatMap(bothSides).map((d) => `<path d="${d}"/>`).join("")}${knees}${sacrum}</g>`);
  }
  function bodyMapSVG(side, stats, selected = null) {
    const label = side === "front" ? "Front" : "Back",
      uid = `bm-${side}`;
    const muscles = BODY[side].muscles
      .map(([mid, parts]) => {
        const lv = muscleLevel(mid, stats),
          sel = mid === selected;
        const shapes = parts
          .map(([d, fibres]) => {
            const fill = bothSides(d)
              .map((p) => `<path class="bm-fill" d="${p}" style="fill:var(--heat-${lv})"/><path class="bm-sheen" d="${p}" fill="url(#${uid}-sheen)"/>`)
              .join("");
            return fibres.length ? `${fill}<path class="bm-fibre" d="${fibres.flatMap(bothSides).join(" ")}"/>` : fill;
          })
          .join("");
        return `<g class="bm-muscle${sel ? " selected" : ""}" data-muscle="${mid}" role="button" tabindex="0" aria-pressed="${sel}" aria-label="${esc(muscleName(mid))}: ${MUSCLE_LEVELS[lv].toLowerCase()}, ${round1(stats[mid]?.effective || 0)} effective sets this week">${shapes}</g>`;
      })
      .join("");
    return `<figure class="bm-figure"><figcaption>${label}</figcaption><svg class="bm-svg" viewBox="22 4 156 432" role="group" aria-label="${label} of the body">${bodyBase(side)}${muscles}</svg></figure>`;
  }
  // The panel under the body map for the muscle you tapped.
  function plannedWorkoutFor(mid) {
    const p = activeProgram();
    if (!p) return null;
    const today = isoToday(),
      start = startOfWeek(today),
      end = addDays(start, 6),
      mult = num(state.settings.secondaryMultiplier || 0.5);
    // Days already done, skipped or under way this week don't count again.
    const handled = new Set(
      state.sessions
        .filter((s) => s.date >= start && s.date <= end && s.programDayId)
        .map((s) => s.programDayId),
    );
    for (let d = today; d <= end; d = addDays(d, 1)) {
      const dow = dateObj(d).getDay(),
        day = p.days.find((x) => Number(x.weekday) === dow);
      if (!day || handled.has(day.id)) continue;
      const adds = day.items.reduce((a, it) => {
        const ex = getExercise(it.exerciseId);
        if (!ex) return a;
        return a + (ex.primaryMuscle === mid ? num(it.sets) : (ex.secondaryMuscles || []).includes(mid) ? num(it.sets) * mult : 0);
      }, 0);
      if (adds > 0) return { date: d, day, adds, when: d === today ? "Today's" : `${weekdayName(dow)}'s` };
    }
    return null;
  }
  function muscleMapPanelHTML(mid, stats) {
    const st = stats[mid] || { direct: 0, effective: 0, contributors: {} },
      [lo, hi] = state.settings.muscleTargets[mid] || [0, 0],
      lv = muscleLevel(mid, stats),
      eff = st.effective || 0,
      plan = plannedWorkoutFor(mid),
      adds = plan?.adds || 0,
      max = Math.max(num(hi) * 1.2, eff + adds, 1),
      pct = (v) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`,
      contrib = Object.entries(st.contributors || {}).sort((a, b) => b[1] - a[1]);
    const target = num(lo) > 0 ? `Target ${lo}–${hi}` : "No target set";
    return `<div class="map-detail-card"><div class="row start"><h3>${esc(muscleName(mid))}</h3><span class="pill level-pill level-${lv}">${MUSCLE_LEVELS[lv]}</span></div>
      <div class="map-detail-amount"><strong>${round1(eff)} effective set${round1(eff) === 1 ? "" : "s"}</strong><span class="meta">${target}</span></div>
      <div class="target-track" role="img" aria-label="${round1(eff)} effective sets${num(lo) > 0 ? ` of a ${lo} to ${hi} set target` : ""}${plan ? `; ${plan.when.replace("'s", "")} adds about ${round1(adds)}` : ""}">${num(lo) > 0 ? `<span class="track-band" style="left:${pct(lo)};width:${pct(Math.max(0, hi - lo))}"></span>` : ""}<span class="track-fill" style="width:${pct(eff)}"></span>${plan ? `<span class="track-plan" style="left:${pct(eff)};width:${pct(adds)}"></span>` : ""}</div>
      <p class="meta">${num(lo) > 0 ? "Shaded: your target. " : ""}${plan ? `Dashed: ${plan.when} ${esc(plan.day.name)} adds about ${round1(adds)}.` : "No more planned workouts for it this week."}</p>
      <p class="eyebrow">What counted</p>
      <div class="map-detail-list">${contrib.map(([n, v]) => `<div><span>${esc(n)}</span><strong>${round1(v)} set${round1(v) === 1 ? "" : "s"}</strong></div>`).join("") || `<div class="meta">Nothing logged for it yet this week.</div>`}</div>
      <div class="preview-actions"><button class="btn ghost" id="mapDetailMore" data-muscle="${mid}" type="button">Details</button><button class="btn ghost" id="mapDetailClose" type="button">Close</button></div></div>`;
  }

  function exerciseAnalyticsHTML() {
    const active = Object.values(state.exercises)
        .filter((e) => !e.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
      ex = getExercise(selectedExerciseAnalyticsId) || active[0];
    if (ex) selectedExerciseAnalyticsId = ex.id;
    const stats = exerciseStats(ex?.id),
      latest = exerciseLatestPerformance(ex?.id),
      rangeLabel =
        exerciseAnalyticsRangeDays === 0
          ? "All time"
          : exerciseAnalyticsRangeDays === 365
            ? "1 year"
            : `${exerciseAnalyticsRangeDays} days`;
    const ranges = [
      [30, "30D"],
      [90, "90D"],
      [365, "1Y"],
      [0, "All"],
    ];
    const filtered = (pts) => filterAnalyticsRange(pts, exerciseAnalyticsRangeDays);
    const prTimeline = exercisePRTimeline(ex?.id).slice(0, 12);
    return `<section class="card"><div class="analytics-top"><label>Exercise<select id="analyticsExerciseSelect">${active.map((x) => `<option value="${x.id}" ${x.id === selectedExerciseAnalyticsId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label><div class="tabs seg analytics-range-tabs">${ranges.map(([d, n]) => `<button class="tab ${exerciseAnalyticsRangeDays === d ? "active" : ""}" data-analytics-range="${d}" type="button">${n}</button>`).join("")}</div></div></section>${
      ex
        ? `
      <section class="card analytics-hero"><div class="row start"><div><p class="eyebrow">Exercise analytics</p><h2>${nameHTML(ex.name)}</h2><p class="meta">${muscleName(ex.primaryMuscle)} · ${esc(ex.equipment || "")} · ${rangeLabel}</p></div><span class="pill neutral">${trackingLabel(ex.trackingType)}</span></div>${latest ? `<div class="latest-performance"><span class="meta">Latest performance · ${fmtDate(latest.date)}</span><strong>${esc(latest.summary)}</strong></div>` : ""}</section>
      <section class="grid-3 analytics-metrics"><div class="metric"><span class="meta">Current e1RM</span><strong>${latest?.e1rm ? `${exWeight(ex, (latest.e1rm))} ${exUnit(ex)}` : "—"}</strong></div><div class="metric"><span class="meta">Best e1RM</span><strong>${stats.bestE ? `${exWeight(ex, (stats.bestE))} ${exUnit(ex)}` : "—"}</strong></div><div class="metric"><span class="meta">Highest load</span><strong>${stats.bestLoad ? `${exWeight(ex, stats.bestLoad)} ${exUnit(ex)}` : "—"}</strong></div><div class="metric"><span class="meta">Best set</span><strong style="font-size:18px">${stats.bestSet ? esc(setSummary(stats.bestSet, ex)) : "—"}</strong></div><div class="metric"><span class="meta">Best session volume</span><strong>${stats.bestVolume ? Math.round(exWeight(ex, stats.bestVolume)) : "—"}</strong><span class="small muted">${exUnit(ex)}-reps</span></div><div class="metric"><span class="meta">Sessions logged</span><strong>${stats.sessions}</strong></div></section>
      <section class="card"><div class="section-title"><h2>Estimated 1RM</h2><span class="meta">${rangeLabel}</span></div><div class="chart">${lineChart(
        filtered(exerciseE1rmPoints(ex.id)).map((p) => ({ date: p.date, value: exWeight(ex, p.value) })),
        exUnit(ex),
      )}</div></section>
      <section class="grid-2 analytics-chart-grid"><div class="card"><div class="section-title"><h2>Top load</h2><span class="meta">${rangeLabel}</span></div><div class="chart">${lineChart(
        filtered(exercisePerformanceSeries(ex.id, "load")).map((p) => ({ date: p.date, value: exWeight(ex, p.value) })),
        exUnit(ex),
      )}</div></div><div class="card"><div class="section-title"><h2>Total reps</h2><span class="meta">${rangeLabel}</span></div><div class="chart">${lineChart(filtered(exercisePerformanceSeries(ex.id, "reps")), "reps")}</div></div></section>
      <section class="card"><div class="section-title"><h2>Session volume</h2><span class="meta">${rangeLabel}</span></div><div class="chart">${lineChart(
        filtered(exercisePerformanceSeries(ex.id, "volume")).map((p) => ({ date: p.date, value: exWeight(ex, p.value) })),
        `${exUnit(ex)}-reps`,
      )}</div></section>
      <section class="card"><div class="section-title"><h2>PR timeline</h2><span class="meta">All time · ${prTimeline.length}</span></div><div ${collapsibleAttrs("pr-timeline")}>${prTimeline.map((p) => `<div class="list-row"><div><strong>${esc(p.type)}</strong><div class="meta">${fmtDate(p.date)}</div></div><span class="pill good">${prDisplay(p)}</span></div>`).join("") || `<div class="empty">No PR history yet.</div>`}</div>${showAllButton("pr-timeline", prTimeline.length)}</section>
      <section class="card"><div class="section-title"><h2>Exercise history</h2><span class="meta">Most recent 30 sessions</span></div>${collapsibleList("exercise-history", exerciseHistoryRows(ex.id))}</section>`
        : ""
    }`;
  }
  function filterAnalyticsRange(points, days) {
    if (!days) return points;
    const cutoff = addDays(isoToday(), -(days - 1));
    return points.filter((p) => p.date >= cutoff);
  }
  function exercisePerformanceSeries(exId, kind) {
    return state.sessions
      .filter((s) => ["complete", "shortened"].includes(s.status) && s.items.some((i) => i.exerciseId === exId))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => {
        const sets = s.items.filter((i) => i.exerciseId === exId).flatMap((i) => workingSets(i));
        let value = 0;
        if (kind === "load") value = Math.max(0, ...sets.map((x) => x.loadKg || 0));
        else if (kind === "volume") value = sets.reduce((a, x) => a + setVolume(x), 0);
        else value = sets.reduce((a, x) => a + (x.reps || 0), 0);
        return value ? { date: s.date, value } : null;
      })
      .filter(Boolean);
  }
  function exerciseStats(exId) {
    const sessions = state.sessions.filter(
      (s) => ["complete", "shortened"].includes(s.status) && s.items.some((i) => i.exerciseId === exId),
    );
    let bestE = 0,
      bestLoad = 0,
      bestVolume = 0,
      lastDate = null,
      bestSet = null;
    sessions.forEach((s) => {
      const items = s.items.filter((i) => i.exerciseId === exId);
      const volume = items.reduce((a, i) => a + workingSets(i).reduce((x, st) => x + setVolume(st), 0), 0);
      bestVolume = Math.max(bestVolume, volume);
      items
        .flatMap((i) => workingSets(i))
        .forEach((st) => {
          bestLoad = Math.max(bestLoad, st.loadKg || 0);
          const e = e1rm(st.loadKg, st.reps);
          if (e > bestE) {
            bestE = e;
            bestSet = st;
          } else if (!bestSet && st.reps > 0) bestSet = st;
        });
      if (!lastDate || s.date > lastDate) lastDate = s.date;
    });
    return { bestE, bestLoad, bestVolume, lastDate, bestSet, sessions: sessions.length };
  }
  function exerciseLatestPerformance(exId) {
    const sessions = state.sessions
      .filter((s) => ["complete", "shortened"].includes(s.status) && s.items.some((i) => i.exerciseId === exId))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.endTime || 0) - (a.endTime || 0));
    const s = sessions[0];
    if (!s) return null;
    const ex = getExercise(exId),
      sets = s.items.filter((i) => i.exerciseId === exId).flatMap((i) => workingSets(i));
    if (!sets.length) return null;
    return {
      date: s.date,
      sessionId: s.id,
      e1rm: Math.max(0, ...sets.map((st) => e1rm(st.loadKg, st.reps))),
      summary: sets.map((st) => setSummary(st, ex)).join(" · "),
    };
  }
  function exerciseE1rmPoints(exId) {
    return state.sessions
      .filter((s) => ["complete", "shortened"].includes(s.status) && s.items.some((i) => i.exerciseId === exId))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((s) => {
        const sets = s.items.filter((i) => i.exerciseId === exId).flatMap((i) => workingSets(i));
        const best = Math.max(0, ...sets.map((st) => e1rm(st.loadKg, st.reps)));
        return best ? { date: s.date, value: best } : null;
      })
      .filter(Boolean);
  }
  function exercisePRTimeline(exId) {
    const out = [];
    state.sessions
      .filter((s) => ["complete", "shortened"].includes(s.status) && s.items.some((i) => i.exerciseId === exId))
      .sort((a, b) => a.date.localeCompare(b.date) || (a.endTime || 0) - (b.endTime || 0))
      .forEach((s) => sessionPRs(s, exId).forEach((p) => out.push({ ...p, date: s.date, sessionId: s.id })));
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }
  // Long lists show their first 5 rows, with "Show all" to open the rest (remembered while the app is open).
  const expandedLists = new Set();
  function collapsibleAttrs(key) {
    return `class="list collapsible ${expandedLists.has(key) ? "" : "collapsed"}" data-list="${key}"`;
  }
  function showAllButton(key, count) {
    return count > 5
      ? `<button class="btn ghost small-btn show-more" data-list="${key}" data-count="${count}" type="button" aria-expanded="${expandedLists.has(key)}">${expandedLists.has(key) ? "Show less" : `Show all ${count}`}</button>`
      : "";
  }
  function collapsibleList(key, rowsHTML) {
    const count = (rowsHTML.match(/class="list-row/g) || []).length;
    return `<div ${collapsibleAttrs(key)}>${rowsHTML}</div>${showAllButton(key, count)}`;
  }
  function exerciseHistoryRows(exId) {
    const ex = getExercise(exId);
    const arr = state.sessions
      .filter((s) => s.items.some((i) => i.exerciseId === exId) && ["complete", "shortened"].includes(s.status))
      .sort((a, b) => b.date.localeCompare(a.date) || (b.endTime || 0) - (a.endTime || 0))
      .slice(0, 30);
    return (
      arr
        .map((s) => {
          const sets = s.items.filter((i) => i.exerciseId === exId).flatMap((i) => workingSets(i)),
            best = Math.max(0, ...sets.map((st) => e1rm(st.loadKg, st.reps))),
            vol = sets.reduce((a, x) => a + setVolume(x), 0);
          return `<div class="list-row click-row analytics-history-row" data-session="${s.id}"><div><strong>${fmtDate(s.date)}</strong><div class="meta">${sets.map((st) => setSummary(st, ex)).join(" · ") || "No completed working sets"}</div><div class="meta">${best ? `e1RM ${exW(ex, best)} · ` : ""}${sets.length} sets${vol ? ` · ${Math.round(exWeight(ex, vol))} ${exUnit(ex)}-reps` : ""}</div></div><span>›</span></div>`;
        })
        .join("") || `<div class="empty">No history for this exercise.</div>`
    );
  }
  function lineChart(points, unit) {
    if (points.length < 2) return `<div class="chart-empty">Log at least two data points to see a trend.</div>`;
    // Drawn at 640 units wide and scaled to the screen, so text sizes here are roughly 2x their on-phone size.
    const w = 640,
      h = 200,
      padX = 14,
      top = 48,
      bottom = h - 40,
      vals = points.map((x) => x.value),
      min = Math.min(...vals),
      max = Math.max(...vals),
      range = Math.max(0.1, max - min);
    const xy = points.map((pt, i) => ({
      x: padX + (i * (w - 2 * padX)) / (points.length - 1),
      y: bottom - ((pt.value - min) / range) * (bottom - top),
    }));
    const path = xy.map((q, i) => `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
    const short = (d) => fmtDate(d, { month: "short", day: "numeric" });
    const first = points[0],
      last = points.at(-1);
    const r = points.length > 40 ? 3 : 5;
    return `<svg class="line-chart" viewBox="0 0 ${w} ${h}" role="img" aria-label="Trend from ${round1(first.value)} to ${round1(last.value)} ${esc(unit)}, ${short(first.date)} to ${short(last.date)}"><line class="chart-grid" x1="${padX}" x2="${w - padX}" y1="${top}" y2="${top}"/><line class="chart-grid" x1="${padX}" x2="${w - padX}" y1="${bottom}" y2="${bottom}"/><path class="chart-line" d="${path}"/>${xy.map((q) => `<circle class="chart-dot" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="${r}"/>`).join("")}<text class="chart-label" x="${padX}" y="${top - 22}">High ${round1(max)} ${esc(unit)}</text><text class="chart-label" x="${w - padX}" y="${top - 22}" text-anchor="end">Low ${round1(min)} ${esc(unit)}</text><text class="chart-label" x="${padX}" y="${h - 8}">${short(first.date)}</text><text class="chart-label" x="${w - padX}" y="${h - 8}" text-anchor="end">${short(last.date)}</text></svg>`;
  }


  function bodyFieldMeta(field) {
    const found = bodyFields.find(([k]) => k === field);
    return found || [field, field, "cm"];
  }
  function bodyMetricSeries(field, days = 0) {
    const cutoff = days ? addDays(isoToday(), -(days - 1)) : "0000-00-00";
    return [...state.bodyEntries]
      .filter((x) => x.date >= cutoff && num(x[field]) > 0)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((x) => ({ date: x.date, value: num(x[field]) }));
  }
  function bodyMetricChange(field) {
    const pts = bodyMetricSeries(field, 0);
    if (pts.length < 2) return null;
    return pts[pts.length - 1].value - pts[pts.length - 2].value;
  }
  function bodyHTML() {
    const entries = [...state.bodyEntries].sort((a, b) => a.date.localeCompare(b.date));
    const visible = [...new Set(["weight", "waist", ...(state.settings.visibleBodyFields || [])])];
    if (!visible.includes(selectedBodyMetric)) selectedBodyMetric = visible[0] || "weight";
    const [metricKey, metricName, baseUnit] = bodyFieldMeta(selectedBodyMetric),
      // Body weight follows the kg/lb setting; other measurements stay in cm.
      conv = (v) => (metricKey === "weight" ? unitWeight(v) : v),
      metricUnit = metricKey === "weight" ? weightUnit() : baseUnit,
      metricPts = bodyMetricSeries(metricKey, bodyRangeDays).map((x) => ({ ...x, value: conv(x.value) })),
      latestMetric = latestBody(metricKey),
      metricChange = bodyMetricChange(metricKey) == null ? null : conv(bodyMetricChange(metricKey)),
      bw = (v) => `${round1(unitWeight(v))} ${weightUnit()}`;
    return `<section class="card"><div class="row"><div><p class="eyebrow">Body measurements</p><h2>Track trends, not daily noise</h2></div><button class="btn primary" id="addBodyEntryBtn" type="button">+ Entry</button></div></section>
    <section class="grid-3 body-summary-grid"><div class="metric"><span class="meta">7-day weight average</span><strong>${bodyAverage("weight", 7) ? bw(bodyAverage("weight", 7)) : "—"}</strong></div><div class="metric"><span class="meta">Latest weight</span><strong>${latestBody("weight") ? bw(latestBody("weight").weight) : "—"}</strong></div><div class="metric"><span class="meta">Latest waist</span><strong>${latestBody("waist") ? `${round1(latestBody("waist").waist)} cm` : "—"}</strong></div></section>
    <section class="card"><div class="section-title"><div><p class="eyebrow">Measurement trend</p><h2>${nameHTML(metricName)}</h2></div>${latestMetric ? `<span class="pill ${metricChange == null ? "neutral" : metricChange <= 0 && metricKey === "waist" ? "good" : "neutral"}">${metricChange == null ? "Latest" : `${metricChange > 0 ? "+" : ""}${round1(metricChange)} ${metricUnit}`}</span>` : ""}</div><div class="analytics-top" style="margin-top:10px"><label>Measurement<select id="bodyMetricSelect">${visible
      .map((k) => {
        const [, n] = bodyFieldMeta(k);
        return `<option value="${k}" ${k === metricKey ? "selected" : ""}>${n}</option>`;
      })
      .join("")}</select></label><div class="tabs seg">${[
      [30, "30D"],
      [90, "90D"],
      [365, "1Y"],
      [0, "All"],
    ]
      .map(
        ([d, n]) =>
          `<button class="tab ${bodyRangeDays === d ? "active" : ""}" data-body-range="${d}" type="button">${n}</button>`,
      )
      .join(
        "",
      )}</div></div><div class="chart">${lineChart(metricPts, metricUnit)}</div>${latestMetric ? `<div class="note-box">Latest: ${round1(conv(latestMetric[metricKey]))} ${metricUnit} · ${fmtDate(latestMetric.date)}</div>` : ""}</section>
    <section class="card"><div class="section-title"><h2>Measurement history</h2><span class="meta">Most recent 30 entries</span></div><div ${collapsibleAttrs("measurement-history")}>${
      entries
        .slice()
        .reverse()
        .slice(0, 30)
        .map(
          (e) =>
            `<div class="list-row click-row body-entry-row" data-body="${e.id}"><div><strong>${fmtDate(e.date)}</strong><div class="meta">${bodyFields
              .filter(([k]) => e[k] != null)
              .map(([k, n, u]) => (k === "weight" ? `${n}: ${bw(e[k])}` : `${n}: ${e[k]} ${u}`))
              .join(" · ")}</div></div><span>›</span></div>`,
        )
        .join("") || `<div class="empty">No measurements yet.</div>`
    }</div>${showAllButton("measurement-history", Math.min(30, entries.length))}</section>`;
  }
  function latestBody(field) {
    return (
      [...state.bodyEntries].filter((x) => num(x[field]) > 0).sort((a, b) => b.date.localeCompare(a.date))[0] || null
    );
  }
  function bodyAverage(field, days) {
    const start = addDays(isoToday(), -(days - 1));
    const vals = state.bodyEntries
      .filter((x) => x.date >= start && x.date <= isoToday() && num(x[field]) > 0)
      .map((x) => num(x[field]));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  }
  function openBodyEntryModal(date = isoToday(), focus = null, entry = null) {
    date = date || entry?.date || isoToday();
    const existing = entry || state.bodyEntries.find((x) => x.date === date) || null;
    const e = existing || { id: uid("body"), date };
    const fields = state.settings.visibleBodyFields || ["weight", "waist"];
    // Body weight follows the kg/lb setting; other measurements stay in cm.
    const shown = (k) => (e[k] == null ? "" : k === "weight" ? unitWeight(e[k]) : e[k]);
    const unitFor = (k, u) => (k === "weight" ? weightUnit() : u);
    openModal(
      existing ? "Edit body entry" : "Body measurement",
      fmtDate(e.date || date),
      `<label>Date<input id="bodyDate" type="date" value="${esc(e.date || date)}" max="${isoToday()}"></label><div class="form-grid">${bodyFields
        .filter(([k]) => fields.includes(k) || ["weight", "waist"].includes(k))
        .map(
          ([k, n, u]) =>
            `<label>${n} (${unitFor(k, u)})<input id="body_${k}" type="number" inputmode="decimal" step="0.1" min="0" value="${shown(k)}"></label>`,
        )
        .join(
          "",
        )}</div>${existing ? `<button class="btn danger" id="deleteBodyEntry" type="button">Delete entry</button>` : ""}`,
      `<button class="btn primary" id="saveBodyEntry" type="button">Save</button>`,
    );
    setTimeout(() => focus && byId(`body_${focus}`)?.focus(), 0);
    byId("saveBodyEntry").addEventListener("click", async () => {
      const newDate = byId("bodyDate").value || e.date || date;
      // Moving an entry onto a date that already has one merges them instead of creating a duplicate.
      const clash = state.bodyEntries.find((x) => x.date === newDate && x.id !== e.id);
      const target = clash || e;
      if (clash && !(await askConfirm(`${fmtDate(newDate)} already has an entry`, "Update that entry with these values?", { ok: "Update entry" })))
        return;
      target.date = newDate;
      bodyFields.forEach(([k]) => {
        const el = byId(`body_${k}`);
        if (el) {
          const v = Number(el.value);
          if (Number.isFinite(v) && v > 0) target[k] = k === "weight" ? Math.round(toKg(v) * 100) / 100 : v;
          else if (!clash) delete target[k];
        }
      });
      if (clash) state.bodyEntries = state.bodyEntries.filter((x) => x.id !== e.id);
      else if (!state.bodyEntries.includes(e)) state.bodyEntries.push(e);
      backfillGoalBaselines(state);
      save();
      closeModal();
      if (activeView === "progress") renderProgress();
      else render();
      showToast("Measurement saved.");
    });
    byId("deleteBodyEntry")?.addEventListener("click", async () => {
      if (!(await askConfirm(`Delete the entry for ${fmtDate(e.date)}?`, "Its body weight and measurements are removed.", { ok: "Delete", danger: true }))) return;
      state.bodyEntries = state.bodyEntries.filter((x) => x.id !== e.id);
      save();
      closeModal();
      render();
      showToast("Body entry deleted.");
    });
  }

  function goalsHTML() {
    const rows = state.goals.map((g) => ({ g, p: goalProgress(g) })),
      achieved = rows.filter((x) => x.p.achieved).length,
      active = rows.length - achieved,
      dueSoon = rows.filter(
        (x) =>
          !x.p.achieved &&
          goalDeadlineInfo(x.g).days != null &&
          goalDeadlineInfo(x.g).days >= 0 &&
          goalDeadlineInfo(x.g).days <= 14,
      ).length;
    return `<section class="card"><div class="row"><div><p class="eyebrow">Goals</p><h2>Measurable targets</h2></div><button class="btn primary" id="addGoalBtn" type="button">+ Goal</button></div><div class="grid-3 goal-summary" style="margin-top:12px"><div class="metric"><span class="meta">Active</span><strong>${active}</strong></div><div class="metric"><span class="meta">Achieved</span><strong>${achieved}</strong></div><div class="metric"><span class="meta">Due ≤14 days</span><strong>${dueSoon}</strong></div></div></section><section class="card"><div class="section-title"><h2>Your goals</h2><span class="meta">Progress uses logged data only</span></div><div class="list" style="margin-top:8px">${rows.map((x) => goalRow(x.g, x.p)).join("") || `<div class="empty">No goals yet. Add a strength, body, consistency, or muscle-volume target.</div>`}</div></section>`;
  }
  function goalRow(g, prog = goalProgress(g)) {
    const deadline = goalDeadlineInfo(g);
    return `<div class="goal-card click-row goal-row" data-goal="${g.id}"><div class="row start"><div><span class="insight-kicker">${esc(goalTypeLabel(g.type))}</span><strong>${esc(g.name)}</strong><div class="meta">Current ${prog.currentDisplay} · Target ${prog.targetDisplay}</div></div><span class="pill ${prog.achieved ? "good" : deadline.overdue ? "warn" : "neutral"}">${prog.achieved ? "Achieved" : `${Math.round(prog.pct)}%`}</span></div><div class="bar"><span style="width:${prog.pct}%"></span></div><div class="goal-foot"><span>${prog.remainingText}</span><span>${deadline.text}</span></div></div>`;
  }
  function goalTypeLabel(type) {
    return (
      {
        exercise_e1rm: "Strength · e1RM",
        exercise_load: "Strength · load",
        weight: "Body · weight",
        waist: "Body · waist",
        weekly_workouts: "Consistency · weekly",
        muscle_effective: "Muscle volume · 4W avg",
        adherence_4w: "Consistency · 4W adherence",
      }[type] || "Goal"
    );
  }
  function goalDeadlineInfo(g) {
    if (!g.deadline) return { text: "No deadline", days: null, overdue: false };
    const days = Math.ceil((dateObj(g.deadline) - dateObj(isoToday())) / 86400000);
    if (days < 0) return { text: `Overdue ${Math.abs(days)}d`, days, overdue: true };
    if (days === 0) return { text: "Due today", days, overdue: false };
    return { text: `Due in ${days}d`, days, overdue: false };
  }
  function goalRawCurrent(g) {
    if (g.type === "exercise_e1rm") return exerciseStats(g.exerciseId).bestE || 0;
    if (g.type === "exercise_load") return exerciseStats(g.exerciseId).bestLoad || 0;
    if (g.type === "weekly_workouts") {
      const w = weekSummary(isoToday());
      return w.completed + w.shortened;
    }
    if (g.type === "muscle_effective") return completedWeekMuscleAverage(g.muscleId || "chest", 4, 1);
    if (g.type === "adherence_4w") return trainingWindowStats(1, 4).adherence || 0;
    if (g.type === "waist") return latestBody("waist")?.waist || 0;
    return latestBody("weight")?.weight || 0;
  }
  function goalTargetValue(g) {
    if (["exercise_e1rm", "exercise_load"].includes(g.type)) return num(g.targetKg);
    if (g.type === "weight") return num(g.target);
    return num(g.target);
  }
  function goalProgress(g) {
    const current = goalRawCurrent(g),
      target = goalTargetValue(g),
      isWeight = g.type === "weight",
      isWaist = g.type === "waist",
      // A body goal without a recorded starting point starts from the current value (0% progress), never "Achieved".
      baseline = num(g.baseline) || (isWeight || isWaist ? current : 0);
    let pct = 0,
      achieved = false;
    if (target > 0) {
      if (isWaist) {
        const start = baseline || current || target,
          den = start - target;
        achieved = current > 0 && current <= target;
        pct = den > 0 ? ((start - current) / den) * 100 : achieved ? 100 : 0;
      } else if (isWeight && baseline) {
        const increase = target >= baseline,
          den = Math.abs(target - baseline);
        achieved = current > 0 && (increase ? current >= target : current <= target);
        pct = den ? ((increase ? current - baseline : baseline - current) / den) * 100 : achieved ? 100 : 0;
      } else {
        achieved = current >= target;
        pct =
          baseline && target > baseline ? ((current - baseline) / (target - baseline)) * 100 : (current / target) * 100;
      }
    }
    pct = Math.max(0, Math.min(100, pct || 0));
    let currentDisplay = "—",
      targetDisplay = "—",
      remainingText = "";
    if (["exercise_e1rm", "exercise_load"].includes(g.type)) {
      const gex = getExercise(g.exerciseId);
      currentDisplay = current ? exW(gex, current) : "—";
      targetDisplay = exW(gex, target);
      remainingText = achieved ? "Target reached" : `${exW(gex, Math.max(0, target - current))} remaining`;
    } else if (g.type === "weight") {
      currentDisplay = current ? `${round1(unitWeight(current))} ${weightUnit()}` : "—";
      targetDisplay = `${round1(unitWeight(target))} ${weightUnit()}`;
      remainingText = achieved
        ? "Target reached"
        : `${round1(unitWeight(Math.abs(target - current)))} ${weightUnit()} to target`;
    } else if (g.type === "waist") {
      currentDisplay = current ? `${round1(current)} cm` : "—";
      targetDisplay = `≤${round1(target)} cm`;
      remainingText = achieved ? "Target reached" : `${round1(Math.max(0, current - target))} cm to target`;
    } else if (g.type === "weekly_workouts") {
      currentDisplay = `${round1(current)} this week`;
      targetDisplay = `${round1(target)}/week`;
      remainingText = achieved
        ? "Weekly target reached"
        : `${Math.max(0, Math.ceil(target - current))} workout${Math.ceil(target - current) === 1 ? "" : "s"} remaining`;
    } else if (g.type === "muscle_effective") {
      currentDisplay = `${round1(current)} sets/wk`;
      targetDisplay = `${round1(target)} sets/wk`;
      remainingText = achieved
        ? "4-week average target reached"
        : `${round1(Math.max(0, target - current))} sets/wk remaining`;
    } else if (g.type === "adherence_4w") {
      currentDisplay = `${Math.round(current)}%`;
      targetDisplay = `${Math.round(target)}%`;
      remainingText = achieved
        ? "Adherence target reached"
        : `${Math.round(Math.max(0, target - current))} percentage points remaining`;
    }
    return { current, target, pct, achieved, currentDisplay, targetDisplay, remainingText };
  }
  function defaultGoalName(type, exerciseId, muscleId, target) {
    const ex = getExercise(exerciseId)?.name || "Exercise",
      mus = muscleName(muscleId || "chest");
    if (type === "exercise_e1rm") return `${ex} e1RM ${exW(getExercise(exerciseId), target)}`;
    if (type === "exercise_load") return `${ex} load ${exW(getExercise(exerciseId), target)}`;
    if (type === "weight") return `Body weight ${round1(unitWeight(target))} ${weightUnit()}`;
    if (type === "waist") return `Waist ≤ ${round1(target)} cm`;
    if (type === "weekly_workouts") return `${round1(target)} workouts per week`;
    if (type === "muscle_effective") return `${mus} ${round1(target)} effective sets/week`;
    if (type === "adherence_4w") return `${Math.round(target)}% 4-week adherence`;
    return "Training goal";
  }
  function openGoalModal(g = null) {
    const active = Object.values(state.exercises)
        .filter((e) => !e.archived)
        .sort((a, b) => a.name.localeCompare(b.name)),
      v = g || {
        type: "exercise_e1rm",
        exerciseId: active[0]?.id || "bench",
        muscleId: "chest",
        targetKg: 100,
        target: 90,
        name: "",
        deadline: "",
      };
    const initialTarget = ["exercise_e1rm", "exercise_load"].includes(v.type)
      ? exWeight(getExercise(v.exerciseId), v.targetKg || 0)
      : v.type === "weight"
        ? unitWeight(v.target || 0)
        : v.target || "";
    openModal(
      "Goals",
      g ? "Edit goal" : "New goal",
      `<div class="stack"><p class="meta">Progress is calculated from your logged training data.</p><label>Goal type<select id="goalType"><option value="exercise_e1rm" ${v.type === "exercise_e1rm" ? "selected" : ""}>Exercise estimated 1RM</option><option value="exercise_load" ${v.type === "exercise_load" ? "selected" : ""}>Exercise load</option><option value="weight" ${v.type === "weight" ? "selected" : ""}>Body weight</option><option value="waist" ${v.type === "waist" ? "selected" : ""}>Waist maximum</option><option value="weekly_workouts" ${v.type === "weekly_workouts" ? "selected" : ""}>Workouts per week</option><option value="muscle_effective" ${v.type === "muscle_effective" ? "selected" : ""}>Muscle effective sets · 4-week average</option><option value="adherence_4w" ${v.type === "adherence_4w" ? "selected" : ""}>4-week workout adherence</option></select></label><label id="goalExerciseWrap">Exercise<select id="goalExercise">${active.map((e) => `<option value="${e.id}" ${v.exerciseId === e.id ? "selected" : ""}>${esc(e.name)}</option>`).join("")}</select></label><label id="goalMuscleWrap">Muscle<select id="goalMuscle">${SEED.muscles.map((m) => `<option value="${m.id}" ${v.muscleId === m.id ? "selected" : ""}>${m.name}</option>`).join("")}</select></label><label><span id="goalTargetLabel">Target</span><input id="goalTarget" type="number" step="0.1" min="0" value="${initialTarget}"></label><label>Deadline <span class="meta">optional</span><input id="goalDeadline" type="date" value="${esc(v.deadline || "")}"></label><label>Goal name <span class="meta">optional</span><input id="goalName" value="${esc(v.name || "")}" placeholder="Generated automatically if blank"></label><div id="goalCurrentPreview" class="note-box"></div>${g ? `<button class="btn danger" id="deleteGoalBtn" type="button">Delete goal</button>` : ""}</div>`,
      `<button class="btn primary" id="saveGoalBtn" type="button">${g ? "Save goal" : "Create goal"}</button>`,
    );
    const sync = () => {
      const type = byId("goalType").value,
        isExercise = type.startsWith("exercise_"),
        isMuscle = type === "muscle_effective";
      byId("goalExerciseWrap").classList.toggle("hidden", !isExercise);
      byId("goalMuscleWrap").classList.toggle("hidden", !isMuscle);
      const label =
        type === "adherence_4w"
          ? "Target adherence (%)"
          : type === "muscle_effective"
            ? "Target effective sets/week"
            : type === "weekly_workouts"
              ? "Target workouts/week"
              : type === "waist"
                ? "Target waist (cm)"
                : type === "weight"
                  ? `Target body weight (${weightUnit()})`
                  : isExercise
                    ? `Target (${exUnit(getExercise(byId("goalExercise").value))})`
                    : "Target";
      byId("goalTargetLabel").textContent = label;
      const temp = { type, exerciseId: byId("goalExercise").value, muscleId: byId("goalMuscle").value };
      const cur = goalRawCurrent(temp);
      let text = "Current logged value: ";
      if (isExercise) text += cur ? exW(getExercise(temp.exerciseId), cur) : "—";
      else if (type === "weight") text += cur ? `${round1(unitWeight(cur))} ${weightUnit()}` : "—";
      else if (type === "waist") text += cur ? `${round1(cur)} cm` : "—";
      else if (type === "adherence_4w") text += `${Math.round(cur)}%`;
      else if (type === "muscle_effective") text += `${round1(cur)} sets/week`;
      else text += `${round1(cur)} workouts`;
      byId("goalCurrentPreview").textContent = text;
    };
    byId("goalType").addEventListener("change", sync);
    byId("goalExercise").addEventListener("change", sync);
    byId("goalMuscle").addEventListener("change", sync);
    sync();
    byId("saveGoalBtn").addEventListener("click", () => {
      const type = byId("goalType").value,
        targetInput = num(byId("goalTarget").value);
      if (!(targetInput > 0)) return showToast("Enter a target greater than zero.");
      const obj = g || { id: uid("goal"), createdAt: Date.now() };
      obj.type = type;
      obj.exerciseId = byId("goalExercise").value;
      obj.muscleId = byId("goalMuscle").value;
      obj.deadline = byId("goalDeadline").value || "";
      if (["exercise_e1rm", "exercise_load"].includes(type)) obj.targetKg = exToKg(getExercise(byId("goalExercise").value), targetInput);
      else if (type === "weight") obj.target = toKg(targetInput);
      else obj.target = targetInput;
      if (!g || obj.baseline == null) obj.baseline = goalRawCurrent(obj);
      const internalTarget = ["exercise_e1rm", "exercise_load"].includes(type) ? obj.targetKg : obj.target;
      obj.name = byId("goalName").value.trim() || defaultGoalName(type, obj.exerciseId, obj.muscleId, internalTarget);
      obj.updatedAt = Date.now();
      if (!g) state.goals.push(obj);
      save();
      closeModal();
      renderProgress();
      showToast(g ? "Goal updated." : "Goal created.");
    });
    byId("deleteGoalBtn")?.addEventListener("click", async () => {
      if (!(await askConfirm("Delete this goal?", "", { ok: "Delete", danger: true }))) return;
      state.goals = state.goals.filter((x) => x.id !== g.id);
      save();
      closeModal();
      renderProgress();
    });
  }

  function wireProgressTab() {
    if (progressTab === "muscles") {
      document.querySelectorAll(".muscle-detail").forEach((x) => {
        x.addEventListener("click", () => openMuscleDetail(x.dataset.muscle));
        x.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openMuscleDetail(x.dataset.muscle);
          }
        });
      });
      wireBodyMap();
      byId("muscleTrendSelect")?.addEventListener("change", (e) => {
        selectedMuscleTrendId = e.target.value;
        renderProgress();
      });
      document.querySelectorAll("[data-muscle-weeks]").forEach((b) =>
        b.addEventListener("click", () => {
          muscleTrendWeeks = Number(b.dataset.muscleWeeks);
          renderProgress();
        }),
      );
    }
    if (progressTab === "exercise") {
      byId("analyticsExerciseSelect")?.addEventListener("change", (e) => {
        selectedExerciseAnalyticsId = e.target.value;
        renderProgress();
      });
      document.querySelectorAll("[data-analytics-range]").forEach((b) =>
        b.addEventListener("click", () => {
          exerciseAnalyticsRangeDays = Number(b.dataset.analyticsRange);
          renderProgress();
        }),
      );
      document.querySelectorAll(".analytics-history-row").forEach((r) =>
        r.addEventListener("click", () => {
          selectedHistorySessionId = r.dataset.session;
          activeView = "history";
          document
            .querySelectorAll(".nav-btn")
            .forEach((b) => b.classList.toggle("active", b.dataset.view === "history"));
          renderHistory();
        }),
      );
    }
    if (progressTab === "body") {
      byId("addBodyEntryBtn")?.addEventListener("click", () => openBodyEntryModal());
      byId("bodyMetricSelect")?.addEventListener("change", (e) => {
        selectedBodyMetric = e.target.value;
        renderProgress();
      });
      document.querySelectorAll("[data-body-range]").forEach((b) =>
        b.addEventListener("click", () => {
          bodyRangeDays = Number(b.dataset.bodyRange);
          renderProgress();
        }),
      );
      document.querySelectorAll(".body-entry-row").forEach((r) =>
        r.addEventListener("click", () =>
          openBodyEntryModal(
            null,
            null,
            state.bodyEntries.find((x) => x.id === r.dataset.body),
          ),
        ),
      );
    }
    if (progressTab === "goals") {
      byId("addGoalBtn")?.addEventListener("click", () => openGoalModal());
      document
        .querySelectorAll(".goal-row")
        .forEach((r) =>
          r.addEventListener("click", () => openGoalModal(state.goals.find((x) => x.id === r.dataset.goal))),
        );
    }
  }
  // Tap a muscle: it's outlined, the rest dims, and its details show under the figures. Tap it again to close.
  function selectMapMuscle(mid) {
    mapMuscle = mid && mid !== mapMuscle ? mid : null;
    const start = startOfWeek(isoToday()),
      stats = muscleStatsForRange(start, addDays(start, 6));
    byId("bodyMapWrap")?.classList.toggle("has-selection", !!mapMuscle);
    document.querySelectorAll("#bodyMapWrap .bm-muscle").forEach((g) => {
      const on = g.dataset.muscle === mapMuscle;
      g.classList.toggle("selected", on);
      g.setAttribute("aria-pressed", String(on));
    });
    const panel = byId("muscleMapDetail");
    if (panel) panel.innerHTML = mapMuscle ? muscleMapPanelHTML(mapMuscle, stats) : "";
    if (mapMuscle) fillBars(panel);
    wireMapPanel();
    if (mapMuscle) panel?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function wireMapPanel() {
    byId("mapDetailMore")?.addEventListener("click", (e) => openMuscleDetail(e.currentTarget.dataset.muscle));
    byId("mapDetailClose")?.addEventListener("click", () => {
      const was = mapMuscle;
      selectMapMuscle(null);
      document.querySelector(`#bodyMapWrap .bm-muscle[data-muscle="${was}"]`)?.focus({ preventScroll: true });
    });
  }
  function wireBodyMap() {
    const wrap = byId("bodyMapWrap");
    if (!wrap) return;
    wrap.addEventListener("click", (e) => {
      const g = e.target.closest(".bm-muscle");
      // A tap on the body between muscles closes the details.
      if (g) selectMapMuscle(g.dataset.muscle);
      else if (mapMuscle && e.target.closest("svg")) selectMapMuscle(null);
    });
    wrap.addEventListener("keydown", (e) => {
      const g = e.target.closest(".bm-muscle");
      if (g && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        selectMapMuscle(g.dataset.muscle);
      }
    });
    wireMapPanel();
  }
  function openMuscleDetail(mid) {
    const start = startOfWeek(isoToday()),
      stats = muscleStatsForRange(start, addDays(start, 6))[mid] || { direct: 0, effective: 0, contributors: {} },
      last = muscleStatsForRange(addDays(start, -7), addDays(start, -1))[mid] || { direct: 0, effective: 0 },
      t = state.settings.muscleTargets[mid] || [0, 0],
      trend = muscleWeeklySeries(mid, 8),
      avg8 = trend.reduce((a, b) => a + b.value, 0) / (trend.length || 1),
      contrib = Object.entries(stats.contributors).sort((a, b) => b[1] - a[1]);
    openModal(
      "Muscle detail",
      muscleName(mid),
      `<div class="grid-3"><div class="metric"><span class="meta">Direct</span><strong>${round1(stats.direct)}</strong></div><div class="metric"><span class="meta">Effective</span><strong>${round1(stats.effective)}</strong></div><div class="metric"><span class="meta">Target</span><strong>${t[0]}–${t[1]}</strong></div></div><div class="note-box">Last week: ${round1(last.effective)} effective sets · 8-week average: ${round1(avg8)}</div><div><div class="section-title"><h3>8-week trend</h3><span class="meta">Effective sets</span></div><div class="chart">${lineChart(
        trend.map((x) => ({ date: x.date, value: x.value })),
        "sets",
      )}</div></div><div><div class="section-title"><h3>This week's contributors</h3><span class="meta">Effective sets</span></div><div class="list">${contrib.map(([n, v]) => `<div class="list-row"><strong>${esc(n)}</strong><span class="pill">${round1(v)} sets</span></div>`).join("") || `<div class="empty">No contributors this week.</div>`}</div></div>`,
      "",
    );
  }

  // ---------- MORE / SETTINGS / DATA HEALTH ----------
  // Settings rows: label on the left, a segmented choice or a switch on the right.
  function settingSeg(label, id, options, current) {
    return `<div class="setting-row"><span class="setting-label" id="${id}Label">${label}</span><div class="seg setting-seg" id="${id}" role="group" aria-labelledby="${id}Label">${options.map(([v, l]) => `<button type="button" class="${v === current ? "active" : ""}" data-value="${v}" aria-pressed="${v === current}">${l}</button>`).join("")}</div></div>`;
  }
  function settingSwitch(label, { id = "", cls = "", value = "" } = {}, checked = false) {
    return `<label class="setting-row"><span class="setting-label">${label}</span><input type="checkbox" role="switch" class="switch ${cls}" ${id ? `id="${id}"` : ""} ${value ? `value="${value}"` : ""} ${checked ? "checked" : ""}></label>`;
  }
  function segValue(id) {
    return byId(id)?.querySelector("button.active")?.dataset.value;
  }
  function wireSegs(root, onChange) {
    root.querySelectorAll(".setting-seg").forEach((g) =>
      g.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => {
          if (b.classList.contains("active")) return;
          g.querySelectorAll("button").forEach((x) => {
            x.classList.toggle("active", x === b);
            x.setAttribute("aria-pressed", String(x === b));
          });
          onChange();
        }),
      ),
    );
  }
  function renderMore() {
    const issues = dataHealthIssues(),
      lastBackup = state.meta.lastBackupAt ? fmtDateTime(state.meta.lastBackupAt) : "Never",
      trainMetrics = Array.isArray(state.settings.trainMetrics) ? state.settings.trainMetrics : ["weight", "waist"];
    view.innerHTML = `<div class="stack">
      <section class="card"><div class="section-title"><div><p class="eyebrow">Library</p><h2>Exercise Library</h2></div><button class="btn primary small-btn" id="moreAddExercise" type="button">+ Exercise</button></div><p class="meta">Create, edit, archive, and map exercises to muscles.</p><button class="btn ghost" id="moreOpenLibrary" type="button">Open library</button></section>
      <section class="card"><div class="section-title"><div><p class="eyebrow">Personalization</p><h2>Appearance & display</h2></div></div><div class="settings-list">${settingSeg("Theme", "themeSetting", [["system", "System"], ["light", "Light"], ["dark", "Dark"]], state.settings.theme || "system")}${settingSeg("Layout density", "densitySetting", [["comfortable", "Comfortable"], ["compact", "Compact"]], state.settings.density === "compact" ? "compact" : "comfortable")}${settingSeg("Units", "unitsSetting", [["kg", "kg"], ["lb", "lb"]], state.settings.units === "lb" ? "lb" : "kg")}${settingSeg("Week starts", "weekSetting", [["monday", "Monday"], ["sunday", "Sunday"]], state.settings.weekStarts === "sunday" ? "sunday" : "monday")}</div><p class="settings-subhead">Train dashboard</p><div class="settings-list">${settingSwitch("Weekly progress", { id: "weekProgressSetting" }, state.settings.showWeeklyProgress !== false)}${settingSwitch("Body weight", { cls: "train-metric-setting", value: "weight" }, trainMetrics.includes("weight"))}${settingSwitch("Waist", { cls: "train-metric-setting", value: "waist" }, trainMetrics.includes("waist"))}</div></section>
      <section class="card"><div><p class="eyebrow">Training defaults</p><h2>Logging behavior</h2></div><div class="settings-list"><label class="setting-row"><span class="setting-label">Rest for new exercises<small>Seconds, 15–900</small></span><input id="defaultRestSetting" class="setting-input" type="number" inputmode="numeric" min="15" max="900" step="15" value="${Number.isFinite(Number(state.settings.defaultExerciseRest)) ? Number(state.settings.defaultExerciseRest) : 90}"></label>${settingSeg("Secondary muscle credit", "secondaryMultiplierSetting", [["0.25", "25%"], ["0.5", "50%"], ["0.75", "75%"]], String(Number(state.settings.secondaryMultiplier) || 0.5))}${settingSwitch("Track RIR", { id: "rirSetting" }, state.settings.trackRir)}${settingSwitch("Auto rest timer", { id: "restSetting" }, state.settings.autoRest)}${settingSwitch("Rest timer sound", { id: "restSoundSetting" }, state.settings.restSound !== false)}${settingSwitch("Tap sounds<small>Soft sounds for logging sets, PRs and finishing. Off by default.</small>", { id: "tapSoundsSetting" }, !!state.settings.tapSounds)}${settingSwitch("Keep screen on during workouts", { id: "keepAwakeSetting" }, state.settings.keepAwake !== false)}</div><p class="meta" style="margin-top:8px">Changes save automatically.</p></section>
      <section class="card"><div class="section-title"><div><p class="eyebrow">Data health</p><h2>Integrity & backups</h2></div><span class="pill ${issues.length ? "warn" : "good"}">${issues.length ? `${issues.length} issue${issues.length > 1 ? "s" : ""}` : "Healthy"}</span></div><div class="data-health-grid"><div class="health-stat"><span>Schema</span><strong>v${VERSION}</strong></div><div class="health-stat"><span>Sessions</span><strong>${state.sessions.length}</strong></div><div class="health-stat"><span>Exercises</span><strong>${Object.keys(state.exercises).length}</strong></div><div class="health-stat"><span>Last backup</span><strong class="health-backup-value">${esc(lastBackup)}</strong></div><div class="health-stat"><span>Storage used</span><strong>${storageText()}</strong></div></div>${
        issues.length
          ? `<div class="stack health-preview">${issues
              .slice(0, 4)
              .map(healthIssueHTML)
              .join("")}</div>`
          : `<div class="health-ok">No structural data problems detected.</div>`
      }<div class="button-grid"><button class="btn ghost" id="exportBtn" type="button">Export backup</button><label class="btn ghost">Import backup<input class="hidden" id="importInput" type="file" accept="application/json,.json"></label><button class="btn ghost span-all" id="healthDetailsBtn" type="button">View integrity report</button></div>${hasUndoCopy() ? `<div class="note-box" style="margin-top:12px">An undo copy from your last import or reset is kept on this device.<div class="wrap" style="margin-top:8px"><button class="btn ghost small-btn" id="undoImportBtn" type="button">Restore previous data</button><button class="btn ghost small-btn" id="discardUndoBtn" type="button">Delete undo copy</button></div></div>` : ""}</section>
      <section class="card"><div><p class="eyebrow">Training</p><h2>Training configuration</h2></div><div class="nav-list"><button class="nav-row" id="editTargetsBtn" type="button"><span>Muscle targets<small>Weekly effective sets per muscle</small></span></button><button class="nav-row" id="editBodyFieldsBtn" type="button"><span>Body fields<small>Which measurements you log</small></span></button><button class="nav-row" id="plateCalcBtn" type="button"><span>Plate calculator<small>Plates per side for a target load</small></span></button><button class="nav-row" id="warmupCalcBtn" type="button"><span>Warm-up calculator<small>Ramp-up sets to your working weight</small></span></button></div></section>
      ${preUpgradeNote()}
      ${store.get(MIGRATION_BACKUP_KEY) ? `<section class="card"><h2>Legacy migration</h2><p class="meta">Original V1 data is retained separately as a migration safety copy.</p><button class="btn ghost" id="legacyBackupBtn" type="button">Download V1 migration backup</button></section>` : ""}
      <section class="card"><div class="section-title"><div><p class="eyebrow">About</p><h2>Strength OS</h2></div><span class="pill neutral">v${APP_VERSION}</span></div><p class="meta">Local-first workout tracking · Data schema v${VERSION} · no account or cloud backend required.</p></section>
      <section class="card danger-zone"><h2>Advanced</h2><p class="meta">Reset removes Strength OS data stored in this browser. Export a backup first.</p><button class="btn danger" id="resetBtn" type="button">Reset Strength OS data</button></section>
    </div>`;
    byId("moreAddExercise").addEventListener("click", () => openExerciseModal(null));
    byId("moreOpenLibrary").addEventListener("click", openLibraryModal);
    byId("plateCalcBtn").addEventListener("click", openPlateCalculator);
    byId("warmupCalcBtn").addEventListener("click", openWarmupCalculator);
    // Every setting saves and applies the moment it changes (no Save button to hunt for).
    const saveSettings = () => {
      state.settings.theme = segValue("themeSetting");
      state.settings.density = segValue("densitySetting");
      state.settings.units = segValue("unitsSetting");
      state.settings.weekStarts = segValue("weekSetting");
      state.settings.trackRir = byId("rirSetting").checked;
      state.settings.restSound = byId("restSoundSetting").checked;
      const soundsWereOn = !!state.settings.tapSounds;
      state.settings.tapSounds = byId("tapSoundsSetting").checked;
      if (state.settings.tapSounds && !soundsWereOn) playTapSound("log"); // a sample, so you hear what it's like
      state.settings.keepAwake = byId("keepAwakeSetting").checked;
      if (!state.settings.keepAwake) releaseWakeLock();
      state.settings.autoRest = byId("restSetting").checked;
      state.settings.defaultExerciseRest = clamp(byId("defaultRestSetting").value, 15, 900) ?? 90;
      state.settings.secondaryMultiplier = Number(segValue("secondaryMultiplierSetting")) || 0.5;
      state.settings.showWeeklyProgress = byId("weekProgressSetting").checked;
      state.settings.trainMetrics = [...document.querySelectorAll(".train-metric-setting:checked")].map((x) => x.value);
      save();
      applyPreferences();
      showToast("Saved.");
    };
    [
      "#rirSetting",
      "#restSetting",
      "#restSoundSetting",
      "#tapSoundsSetting",
      "#keepAwakeSetting",
      "#defaultRestSetting",
      "#weekProgressSetting",
      ".train-metric-setting",
    ].forEach((q) => document.querySelectorAll(q).forEach((el) => el.addEventListener("change", saveSettings)));
    wireSegs(view, saveSettings);
    byId("editTargetsBtn").addEventListener("click", openMuscleTargetsModal);
    byId("editBodyFieldsBtn").addEventListener("click", openBodyFieldsModal);
    byId("healthDetailsBtn").addEventListener("click", openDataHealthReport);
    wireHealthIssues(view);
    byId("exportBtn").addEventListener("click", exportBackup);
    byId("importInput").addEventListener("change", importBackup);
    byId("undoImportBtn")?.addEventListener("click", undoImport);
    byId("discardUndoBtn")?.addEventListener("click", async () => {
      if (dataLocked()) return;
      if (!(await askConfirm("Delete the undo copy?", "This frees storage, but you won't be able to restore it.", { ok: "Delete", danger: true }))) return;
      if (dataLocked()) return;
      try {
        store.remove(PRE_IMPORT_KEY);
      } catch {}
      renderMore();
    });
    byId("preUpgradeBtn")?.addEventListener("click", () =>
      downloadText(`strength-os-pre-upgrade-copy.json`, preUpgradeCopy()?.text || "", "application/json"),
    );
    byId("legacyBackupBtn")?.addEventListener("click", () =>
      downloadText(
        "strength-os-v1-migration-backup.json",
        store.get(MIGRATION_BACKUP_KEY),
        "application/json",
      ),
    );
    byId("resetBtn").addEventListener("click", async () => {
      if (dataLocked()) return;
      if (!(await askConfirm("Reset all Strength OS data on this device?", "Export a backup first.", { ok: "Reset", danger: true }))) return;
      if (dataLocked()) return;
      try {
        store.set(PRE_IMPORT_KEY, JSON.stringify(state));
      } catch {
        if (!(await askConfirm("No room for an undo copy", "There isn't room to keep an undo copy. Reset anyway?", { ok: "Reset anyway", danger: true }))) return;
        if (dataLocked()) return;
      }
      stopRestTimer();
      state = newState();
      state.meta.programRevision = LATEST_PROGRAM_UPDATE;
      save();
      applyPreferences();
      selectedProgramId = state.settings.activeProgramId;
      navigate("train");
    });
  }

  function hasUndoCopy() {
    try {
      return !!store.get(PRE_IMPORT_KEY);
    } catch {
      return false;
    }
  }
  function storageText() {
    const kb = storageBytes() / 1024,
      size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(kb))} KB`;
    // localStorage (the fallback) allows roughly 5 MB per site; IndexedDB has no practical limit for this app.
    return backend === "idb" ? size : `${size} of ~5 MB`;
  }
  function preUpgradeNote() {
    const copy = preUpgradeCopy();
    if (!copy) return "";
    const until = copy.until.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `<section class="card"><h2>Storage upgrade</h2><p class="meta">Your data now lives in IndexedDB, which has room for years of workouts. A safety copy from before the move is kept on this device until ${esc(until)}, then removed automatically.</p><button class="btn ghost" id="preUpgradeBtn" type="button">Download safety copy</button></section>`;
  }
  async function exportBackup() {
    const name = `strength-os-backup-${isoToday()}.json`;
    const stamp = Date.now();
    const text = JSON.stringify({ ...state, meta: { ...state.meta, lastBackupAt: stamp } }, null, 2);
    const markDone = () => {
      state.meta.lastBackupAt = stamp;
      save();
      render();
      showToast("Backup exported.");
    };
    // On phones, the share sheet ("Save to Files") is more reliable than a download inside a home-screen app.
    try {
      const file = new File([text], name, { type: "application/json" });
      if (window.matchMedia?.("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Strength OS backup" });
        return markDone();
      }
    } catch (e) {
      if (e?.name === "AbortError") return showToast("Backup not saved.");
    }
    downloadText(name, text, "application/json");
    markDone();
  }
  function healthIssueHTML(x) {
    return `<div class="health-issue"><strong>${esc(x.title)}</strong><br>${esc(x.text)}${x.sessionId ? `<div class="wrap" style="margin-top:6px"><button class="btn ghost small-btn open-issue-session" data-session="${x.sessionId}" type="button">Open workout to fix</button></div>` : ""}</div>`;
  }
  function wireHealthIssues(root) {
    root.querySelectorAll(".open-issue-session").forEach((b) =>
      b.addEventListener("click", () => {
        closeModal();
        openHistoryRecord(b.dataset.session);
      }),
    );
  }
  function openDataHealthReport() {
    const issues = dataHealthIssues(),
      counts = {
        Programs: Object.keys(state.programs).length,
        Exercises: Object.keys(state.exercises).length,
        Sessions: state.sessions.length,
        "Body entries": state.bodyEntries.length,
        Goals: state.goals.length,
      };
    openModal(
      "Data Health",
      "Integrity report",
      `<div class="grid-3 data-report-grid">${Object.entries(counts)
        .map(([k, v]) => `<div class="metric"><span class="meta">${esc(k)}</span><strong>${v}</strong></div>`)
        .join(
          "",
        )}</div><div class="note-box">Schema v${VERSION}${state.meta.lastMigratedAt ? ` · Last migration ${new Date(state.meta.lastMigratedAt).toLocaleString()}` : ""}${state.meta.lastBackupAt ? ` · Last backup ${new Date(state.meta.lastBackupAt).toLocaleString()}` : " · No backup recorded yet"}</div>${issues.length ? `<div class="stack">${issues.map(healthIssueHTML).join("")}</div>` : `<div class="health-ok">All current integrity checks passed.</div>`}`,
      `<button class="btn primary" id="healthExportModal" type="button">Export backup</button>`,
    );
    wireHealthIssues(modalBody);
    byId("healthExportModal").addEventListener("click", () => {
      closeModal();
      exportBackup();
    });
  }

  function dayText(d) {
    return /^\d{4}-\d{2}-\d{2}$/.test(d || "") ? fmtDate(d, { month: "short", day: "numeric", year: "numeric" }) : String(d || "an unknown date");
  }
  // Logged sets far outside what you usually do on that exercise: most likely typos ("2220 kg", "1012 reps").
  // One entry per exercise per workout, newest first, each with the workout to open and fix.
  function likelyTypos() {
    const out = [];
    historyIndex().byExercise.forEach((list, exId) => {
      const ex = getExercise(exId) || list[0]?.item.exerciseSnapshot;
      if (!ex) return;
      const done = list.filter((e) => e.sets.length);
      if (done.length < 3) return; // too little history to know what's usual
      const field = isDurationBased(ex) ? "durationSec" : isRepBased(ex) ? "reps" : null;
      done.forEach((e, i) => {
        // Compared with the workouts around it (up to 4 before and 4 after), so months of progress don't look like a typo.
        const near = done.slice(Math.max(0, i - 4), i).concat(done.slice(i + 1, i + 5));
        const refLoad = usesLoad(ex) ? typicalTop(near, "loadKg") : 0,
          refAmt = field ? typicalTop(near, field) : 0;
        const oddLoad = (st) => refLoad > 0 && num(st.loadKg) > 0 && unlikelyLoad(num(st.loadKg), refLoad),
          oddAmt = (st) => refAmt > 0 && unlikelyAmount(num(st[field]), refAmt, field, 0);
        const odd = e.sets.filter((st) => oddLoad(st) || oddAmt(st));
        if (!odd.length) return;
        const usual = [
          odd.some(oddLoad) ? exW(ex, refLoad) : "",
          odd.some(oddAmt) ? `${refAmt}${field === "reps" ? " reps" : " s"}` : "",
        ]
          .filter(Boolean)
          .join(" and ");
        // About 2.2 times the usual weight: pounds typed into kg boxes.
        const ratio = refLoad ? Math.max(...odd.map((st) => num(st.loadKg))) / refLoad : 0,
          lbHint =
            exUnit(ex) === "kg" && ratio > 1.9 && ratio < 2.6
              ? " Looks like lb typed as kg: in the workout, tap ••• on the exercise → Weights here were typed in lb."
              : "";
        out.push({
          title: "Possible typo",
          text: `${ex.name} on ${dayText(e.session.date)}: ${setsSummaryText(odd, ex)}. You usually do about ${usual}.${lbHint}`,
          sessionId: e.session.id,
          setIds: odd.map((st) => st.id),
          date: e.session.date,
        });
      });
    });
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }
  function dataHealthIssues() {
    const issues = [],
      sessionIds = new Set(),
      goalIds = new Set(),
      bodyIds = new Set(),
      bodyDates = new Map();
    const typos = likelyTypos(),
      typoSets = new Set(typos.flatMap((x) => x.setIds));
    issues.push(...typos);
    if (Number(state.version) !== VERSION)
      issues.push({
        title: "Schema version mismatch",
        text: `Stored schema is v${state.version}; app expects v${VERSION}.`,
      });
    if (state.currentWorkoutId && !state.sessions.some((s) => s.id === state.currentWorkoutId))
      issues.push({
        title: "Orphaned active workout",
        text: "The active-workout reference does not point to an existing session.",
      });
    state.sessions.forEach((s) => {
      if (sessionIds.has(s.id)) issues.push({ title: "Duplicate session ID", text: `Session ${s.id} is duplicated.` });
      sessionIds.add(s.id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s.date || ""))
        issues.push({ title: "Invalid session date", text: `${s.name || "A session"} has an invalid date.` });
      if (s.startTime && s.endTime && s.endTime < s.startTime)
        issues.push({ title: "Invalid session duration", text: `${s.name} on ${dayText(s.date)} ends before it starts.` });
      if (s.startTime && s.endTime && s.endTime - s.startTime > 6 * 3600000)
        issues.push({
          title: "Unusually long workout",
          text: `${s.name} on ${dayText(s.date)} lasted ${durationText((s.endTime - s.startTime) / 1000)}. Open it from History → Edit workout → Date & duration to correct it.`,
        });
      if (s.status === "in_progress" && s.id !== state.currentWorkoutId)
        issues.push({
          title: "Unfinished workout",
          text: `${s.name} on ${dayText(s.date)} was never finished. Resume or discard it from the Train tab.`,
        });
      (s.items || []).forEach((i) => {
        if (!state.exercises[i.exerciseId] && !i.exerciseSnapshot)
          issues.push({
            title: "Missing exercise reference",
            text: `A workout on ${dayText(s.date)} references ${i.exerciseId}.`,
          });
        (i.sets || []).forEach((st) => {
          if (st.rir != null && (st.rir < 0 || st.rir > 5))
            issues.push({ title: "Invalid RIR", text: `${dayText(s.date)} contains RIR ${st.rir}.` });
          if (st.loadKg < 0 || st.reps < 0 || st.durationSec < 0 || st.distanceKm < 0)
            issues.push({
              title: "Negative set value",
              text: `${dayText(s.date)} contains a negative load, rep, duration, or distance value.`,
            });
          if (st.loadKg > 1000 && !typoSets.has(st.id))
            issues.push({
              title: "Unusually high load",
              text: `${dayText(s.date)} contains ${round1(st.loadKg)} kg. Verify this entry.`,
            });
          if (st.complete && st.type !== "warmup" && !st.reps && !st.durationSec && !st.distanceKm)
            issues.push({
              title: "Empty completed set",
              text: `${dayText(s.date)} contains a completed set without reps/duration/distance.`,
            });
        });
      });
    });
    Object.values(state.exercises).forEach((e) => {
      if (!e.primaryMuscle) issues.push({ title: "Exercise missing primary muscle", text: e.name });
      if (e.primaryMuscle && !SEED.muscles.some((m) => m.id === e.primaryMuscle))
        issues.push({ title: "Unknown primary muscle", text: `${e.name} uses ${e.primaryMuscle}.` });
    });
    Object.values(state.programs).forEach((p) =>
      (p.days || []).forEach((d) =>
        (d.items || []).forEach((i) => {
          const ex = state.exercises[i.exerciseId];
          if (!ex)
            issues.push({
              title: "Program references missing exercise",
              text: `${p.name} → ${d.name} → ${i.exerciseId}`,
            });
          else if (ex.archived)
            issues.push({
              title: "Archived exercise in program",
              text: `${p.name} → ${d.name} still contains ${ex.name}.`,
            });
          if (num(i.sets) < 1 || num(i.min) < 1 || num(i.max) < num(i.min))
            issues.push({
              title: "Invalid program prescription",
              text: `${p.name} → ${d.name} has an invalid set/rep prescription.`,
            });
        }),
      ),
    );
    state.bodyEntries.forEach((e) => {
      if (bodyIds.has(e.id))
        issues.push({ title: "Duplicate body-entry ID", text: `Body entry ${e.id} is duplicated.` });
      bodyIds.add(e.id);
      bodyDates.set(e.date, (bodyDates.get(e.date) || 0) + 1);
      bodyFields.forEach(([k, n]) => {
        if (e[k] != null && num(e[k]) <= 0)
          issues.push({ title: "Invalid body measurement", text: `${n} on ${dayText(e.date)} is not greater than zero.` });
      });
    });
    bodyDates.forEach((count, date) => {
      if (count > 1)
        issues.push({
          title: "Multiple body entries on one date",
          text: `${dayText(date)} contains ${count} separate measurement entries. This is allowed, but verify it is intentional.`,
        });
    });
    state.goals.forEach((g) => {
      if (goalIds.has(g.id)) issues.push({ title: "Duplicate goal ID", text: `Goal ${g.id} is duplicated.` });
      goalIds.add(g.id);
    });
    Object.entries(state.settings.muscleTargets || {}).forEach(([mid, t]) => {
      if (!Array.isArray(t) || num(t[0]) < 0 || num(t[1]) < num(t[0]))
        issues.push({ title: "Invalid muscle target", text: `${muscleName(mid)} has an invalid target range.` });
    });
    return issues;
  }

  function openMuscleTargetsModal() {
    openModal(
      "Muscle targets",
      "Weekly effective sets",
      `<p class="meta">Effective sets per week. Secondary muscles count at your secondary credit.</p><div class="targets-table"><div class="target-row target-head"><span>Muscle</span><span>Min</span><span></span><span>Max</span></div>${SEED.muscles
        .map((m) => {
          const t = state.settings.muscleTargets[m.id] || [0, 0];
          return `<div class="target-row"><span id="target_${m.id}_label">${m.name}</span><input id="target_${m.id}_min" type="number" inputmode="numeric" min="0" max="40" value="${t[0]}" aria-label="${m.name} minimum"><span aria-hidden="true">–</span><input id="target_${m.id}_max" type="number" inputmode="numeric" min="0" max="50" value="${t[1]}" aria-label="${m.name} maximum"></div>`;
        })
        .join("")}</div>`,
      `<button class="btn primary" id="saveTargetsBtn" type="button">Save targets</button>`,
    );
    byId("saveTargetsBtn").addEventListener("click", () => {
      SEED.muscles.forEach((m) => {
        const mn = clamp(byId(`target_${m.id}_min`).value, 0, 40) || 0,
          mx = clamp(byId(`target_${m.id}_max`).value, 0, 50) || mn;
        state.settings.muscleTargets[m.id] = [mn, Math.max(mn, mx)];
      });
      save();
      closeModal();
      renderMore();
    });
  }
  function openBodyFieldsModal() {
    openModal(
      "Body fields",
      "Choose measurements",
      `<div class="checks">${bodyFields.map(([k, n]) => `<label class="check-chip"><input class="body-field-check" type="checkbox" value="${k}" ${(state.settings.visibleBodyFields || []).includes(k) || ["weight", "waist"].includes(k) ? "checked" : ""} ${["weight", "waist"].includes(k) ? "disabled" : ""}><span>${n}</span></label>`).join("")}</div>`,
      `<button class="btn primary" id="saveBodyFieldsBtn" type="button">Save</button>`,
    );
    byId("saveBodyFieldsBtn").addEventListener("click", () => {
      state.settings.visibleBodyFields = [
        "weight",
        "waist",
        ...[...document.querySelectorAll(".body-field-check:checked")]
          .map((x) => x.value)
          .filter((x) => !["weight", "waist"].includes(x)),
      ];
      save();
      closeModal();
      renderMore();
    });
  }
  function openPlateCalculator() {
    const inv = state.settings.plateInventory || [20, 15, 10, 5, 2.5, 1.25];
    openModal(
      "Plate calculator",
      "Barbell loading",
      `<div class="form-grid"><label>Target (${weightUnit()})<input id="plateTarget" type="number" step="0.5" value="82.5"></label><label>Bar (${weightUnit()})<input id="plateBar" type="number" step="0.5" value="${state.settings.barWeight || 20}"></label></div><label>Available plates per side<input id="plateInventory" value="${inv.join(", ")}"></label><button class="btn secondary" id="calcPlatesBtn" type="button">Calculate</button><div id="plateResult" class="note-box">Enter your target load.</div>`,
      "",
    );
    byId("calcPlatesBtn").addEventListener("click", () => {
      const target = num(byId("plateTarget").value),
        bar = num(byId("plateBar").value),
        plates = byId("plateInventory")
          .value.split(",")
          .map((x) => num(x.trim()))
          .filter((x) => x > 0)
          .sort((a, b) => b - a);
      state.settings.plateInventory = plates;
      state.settings.barWeight = bar;
      save();
      let per = (target - bar) / 2;
      if (per < 0) return (byId("plateResult").textContent = "Target is lighter than the bar.");
      const used = [];
      plates.forEach((p) => {
        while (per + 1e-9 >= p) {
          used.push(p);
          per -= p;
        }
      });
      byId("plateResult").innerHTML =
        per < 0.01
          ? `Per side: <strong>${used.length ? used.join(" + ") : "no plates"}</strong>`
          : `Closest loadable combination leaves ${round1(per)} ${weightUnit()} per side.`;
    });
  }
  function openWarmupCalculator() {
    openModal(
      "Warm-up calculator",
      "Simple ramp to working weight",
      `<div class="form-grid"><label>Working load (${weightUnit()})<input id="warmLoad" type="number" step="0.5" value="80"></label><label>Bar / minimum load<input id="warmBar" type="number" step="0.5" value="20"></label></div><button class="btn secondary" id="calcWarmBtn" type="button">Generate</button><div id="warmResult" class="note-box">Uses low-fatigue ramp sets.</div>`,
      "",
    );
    byId("calcWarmBtn").addEventListener("click", () => {
      const load = num(byId("warmLoad").value),
        bar = num(byId("warmBar").value);
      if (load <= 0) return;
      const rounds = [
        [Math.max(bar, load * 0.45), 8],
        [Math.max(bar, load * 0.65), 5],
        [Math.max(bar, load * 0.8), 3],
        [Math.max(bar, load * 0.9), 1],
      ].filter((x, i, a) => x[0] < load && (!i || Math.abs(x[0] - a[i - 1][0]) > 2));
      byId("warmResult").innerHTML =
        rounds.map(([w, r]) => `${roundToIncrement(w, 2.5)} ${weightUnit()} × ${r}`).join("<br>") +
        `<br><strong>${load} ${weightUnit()} → working sets</strong>`;
    });
  }
  function roundToIncrement(v, inc) {
    return Math.round(v / inc) * inc;
  }
  function downloadText(name, text, type) {
    const blob = new Blob([text], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  // Checks that a file really is a Strength OS (or V1) backup before anything is replaced.
  function validateBackup(parsed) {
    const fail = (reason) => ({ ok: false, reason });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fail("This file isn't a Strength OS backup.");
    const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    if (!Array.isArray(parsed.sessions) && (isObj(parsed.workouts) || isObj(parsed.body) || parsed.nutrition)) {
      const workouts = Object.keys(parsed.workouts || {}).length,
        body = Object.keys(parsed.body || {}).length;
      if (!workouts && !body) return fail("This V1 backup has no workouts or body entries.");
      return { ok: true, legacy: true, sessions: workouts, body };
    }
    if (!Array.isArray(parsed.sessions) || !isObj(parsed.programs) || !isObj(parsed.exercises) || !isObj(parsed.settings))
      return fail("This file isn't a Strength OS backup.");
    if (parsed.bodyEntries != null && !Array.isArray(parsed.bodyEntries)) return fail("The backup's body entries are damaged.");
    if (parsed.goals != null && !Array.isArray(parsed.goals)) return fail("The backup's goals are damaged.");
    const bad = parsed.sessions.find(
      (x) => !isObj(x) || !/^\d{4}-\d{2}-\d{2}$/.test(x.date || "") || !Array.isArray(x.items) || !x.id,
    );
    if (bad) return fail("The backup has damaged workout records, so nothing was imported.");
    return {
      ok: true,
      legacy: false,
      sessions: parsed.sessions.filter((x) => ["complete", "shortened"].includes(x.status)).length,
      body: (parsed.bodyEntries || []).length,
      savedAt: parsed.meta?.lastBackupAt || parsed.meta?.updatedAt || null,
    };
  }
  function importBackup(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (dataLocked()) return void (e.target.value = "");
    const r = new FileReader();
    r.onload = async () => {
      let parsed;
      try {
        parsed = JSON.parse(r.result);
      } catch {
        return showToast("That file isn't valid JSON. Nothing was changed.");
      }
      const check = validateBackup(parsed);
      if (!check.ok) return showToast(`${check.reason} Nothing was changed.`);
      const curSessions = state.sessions.filter((x) => ["complete", "shortened"].includes(x.status)).length;
      const when = check.savedAt ? ` (saved ${new Date(check.savedAt).toLocaleDateString()})` : "";
      if (
        !(await askConfirm(
          "Replace all data with this backup?",
          `Now: ${curSessions} workouts, ${state.bodyEntries.length} body entries.\nBackup${when}: ${check.sessions} workouts, ${check.body} body entries.\n\nA copy of your current data is kept so you can undo from More → Data health.`,
          { ok: "Replace my data", danger: true },
        ))
      )
        return;
      if (dataLocked()) return;
      let next;
      try {
        next = check.legacy ? migrateLegacy(parsed) : normalizeState(migrateStateSchema(parsed));
        backfillGoalBaselines(next);
      } catch (err) {
        console.warn("Import failed", err);
        return showToast("The backup couldn't be read. Nothing was changed.");
      }
      try {
        store.set(PRE_IMPORT_KEY, JSON.stringify(state));
      } catch {
        if (
          !(await askConfirm("No room for an undo copy", "There isn't room to keep an undo copy of your current data. Import anyway? Export a backup first if unsure.", {
            ok: "Import anyway",
            danger: true,
          }))
        )
          return;
      }
      stopRestTimer();
      state = next;
      if (!save()) return;
      applyPreferences();
      selectedProgramId = state.settings.activeProgramId;
      selectedHistorySessionId = null;
      showToast(check.legacy ? "V1 backup migrated and imported." : "Backup imported.");
      renderMore();
    };
    r.readAsText(file);
    e.target.value = "";
  }
  async function undoImport() {
    if (dataLocked()) return;
    let prev;
    try {
      prev = JSON.parse(store.get(PRE_IMPORT_KEY) || "null");
    } catch {}
    if (!prev) return showToast("No undo copy found.");
    if (!(await askConfirm("Restore your previous data?", "The data you had before the last import comes back, and the imported data is replaced.", { ok: "Restore" }))) return;
    if (dataLocked()) return;
    state = normalizeState(migrateStateSchema(prev));
    if (!save()) return;
    try {
      store.remove(PRE_IMPORT_KEY);
    } catch {}
    applyPreferences();
    selectedProgramId = state.settings.activeProgramId;
    renderMore();
    showToast("Previous data restored.");
  }

  // ---------- MODAL HELPERS ----------
  function openModal(eyebrow, title, body, actions = "") {
    byId("modalEyebrow").textContent = eyebrow || "";
    byId("modalTitle").textContent = title || "";
    modalBody.innerHTML = body || "";
    modalActions.innerHTML = actions || "";
    if (!modal.open) modal.showModal();
  }
  function closeModal() {
    if (modal.open) modal.close();
  }
  // A short list of actions in a pop-up, used instead of rows of small buttons.
  // actions: [label, run, disabled?, danger?]
  function openActionSheet(eyebrow, title, actions) {
    openModal(
      eyebrow,
      title,
      `<div class="action-sheet">${actions.map(([label, , disabled, danger], i) => `<button class="btn ${danger ? "danger" : "ghost"}" data-action-i="${i}" type="button" ${disabled ? "disabled" : ""}>${esc(label)}</button>`).join("")}</div>`,
    );
    modalBody.querySelectorAll("[data-action-i]").forEach((b) =>
      b.addEventListener("click", () => {
        closeModal();
        actions[Number(b.dataset.actionI)][1]();
      }),
    );
  }
  // In-app yes/no question (v2.18), used everywhere instead of the browser's confirm(). Resolves true/false.
  // A question asked while another is showing waits its turn, so two never overlap (e.g. a number checked on
  // "change" and again by the ✓ tap that caused that change).
  let confirmQueue = Promise.resolve();
  function askConfirm(title, message = "", { ok = "OK", cancel = "Cancel", danger = false } = {}) {
    const ask = () =>
      new Promise((resolve) => {
        const dlg = byId("confirmSheet");
        if (!dlg?.showModal) return resolve(window.confirm([title, message].filter(Boolean).join("\n\n")));
        // Put the keyboard away first: the sheet is the only thing to answer, and closing it must not refocus a field.
        const focused = document.activeElement;
        if (focused?.matches?.("input, textarea, select")) focused.blur();
        byId("confirmTitle").textContent = title;
        byId("confirmMessage").innerHTML = String(message || "")
          .split(/\n{2,}/)
          .filter((p) => p.trim())
          .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
          .join("");
        const okBtn = byId("confirmOkBtn"),
          cancelBtn = byId("confirmCancelBtn");
        okBtn.textContent = ok;
        cancelBtn.textContent = cancel;
        okBtn.className = `btn ${danger ? "danger" : "primary"}`;
        const openedAt = Date.now();
        let settled = false;
        const finish = (answer) => {
          if (settled) return;
          settled = true;
          okBtn.onclick = cancelBtn.onclick = dlg.onclick = dlg.oncancel = null;
          if (dlg.open) dlg.close();
          resolve(answer);
        };
        okBtn.onclick = () => finish(true);
        cancelBtn.onclick = () => finish(false);
        dlg.oncancel = (e) => {
          e.preventDefault();
          finish(false);
        };
        // Tapping the dimmed page means "no" — but not the end of the very tap that opened the sheet.
        dlg.onclick = (e) => {
          if (e.target === dlg && Date.now() - openedAt > 450) finish(false);
        };
        dlg.showModal();
        cancelBtn.focus({ preventScroll: true });
      });
    const answer = confirmQueue.then(ask, ask);
    confirmQueue = answer.catch(() => {});
    return answer;
  }
  // On phones, keep a pop-up's bottom edge above the on-screen keyboard while you type in it.
  function watchKeyboardForSheets() {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const typing = document.activeElement?.closest?.("dialog[open]") && document.activeElement.matches("input, textarea, select");
      const gap = Math.round(window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--kb", typing && gap > 120 ? `${gap}px` : "0px");
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", () => setTimeout(update, 60));
  }
  function openTextModal(title, value, onSave) {
    openModal(
      "Note",
      title,
      `<label>Text<textarea id="textModalValue">${esc(value)}</textarea></label>`,
      `<button class="btn primary" id="textModalSave" type="button">Save</button>`,
    );
    byId("textModalSave").addEventListener("click", () => {
      onSave(byId("textModalValue").value.trim());
      closeModal();
    });
  }
  early();
  boot(); // last, so every declaration above is ready
})();
