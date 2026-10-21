/* ============================================================================
   Import fixtures.
   ----------------------------------------------------------------------------
   Stage 3 of the flow. Qualify & Scope estimated the estate from discovery
   metadata; this stage pulls the actual assets and their query text, which is
   the first point at which DMA can be precise rather than approximate.

   Four features land here and they are deliberately separable:
     Universal Asset Importer  — the bulk pull and the new/changed/removed flag
     Delta / Versioning Engine — persisted history behind that flag
     No-Equivalent Pre-Flag    — the command catalog, run against real query text
     Dead-Asset Validation Gate— auto-exclusion with a PM override

   Owned by modules/import. Other modules must not read these fixtures.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

DMA.data.inventory = {
  /* --- Step 1: the import runs -------------------------------------------- */
  /* Five runs, because version history is only interesting once an asset has
     been seen more than twice. The <15 min target is per run, regardless of
     asset count — the first full pull is the one that has to prove it. */
  targetMinutes: 15,
  runs: [
    {
      id: 5,
      at: "2026-10-13T09:12:00Z",
      trigger: "Scheduled re-import",
      scope: "Full inventory",
      pulled: 3088,
      minutes: 4.2,
      status: "complete",
      failures: [],
      note: "Wave 4–6 re-plan picked up 3 new indexes.",
    },
    {
      id: 4,
      at: "2026-10-09T07:30:00Z",
      trigger: "Manual · Rosa Delgado",
      scope: "Full inventory",
      pulled: 3074,
      minutes: 3.9,
      status: "complete",
      failures: [],
      note: "",
    },
    {
      id: 3,
      at: "2026-10-06T08:15:00Z",
      trigger: "Manual · Rosa Delgado",
      scope: "Full inventory",
      pulled: 3058,
      minutes: 5.1,
      status: "partial",
      failures: [
        {
          type: "Lookups",
          count: 14,
          reason: "Non-UTF8 encoding in lookup CSV headers — 14 of 245 files rejected by the parser.",
          resolution: "Re-pulled successfully on run 4 after the source team re-saved the files.",
        },
      ],
      note: "One asset type failed. The other four completed — a partial failure does not abandon the run.",
    },
    {
      id: 2,
      at: "2026-10-02T10:40:00Z",
      trigger: "Manual · Rosa Delgado",
      scope: "Full inventory",
      pulled: 3041,
      minutes: 6.8,
      status: "complete",
      failures: [],
      note: "",
    },
    {
      id: 1,
      at: "2026-09-29T15:05:00Z",
      trigger: "First import after source connect",
      scope: "Full inventory",
      pulled: 3012,
      minutes: 12.6,
      status: "complete",
      failures: [],
      note: "Cold pull of the whole estate — the run the <15 min target exists for.",
    },
  ],

  /* --- Step 2: what changed since the previous run ------------------------ */
  /* The rollup is the headline; the per-asset rows are what makes it
     actionable. Without the flag every re-import looks like a first import. */
  delta: {
    comparedTo: 4,
    newCount: 12,
    changedCount: 34,
    removedCount: 3,
    unchangedCount: 3039,
    items: [
      { id: "DSH-0412", name: "FX Spread Monitoring",            type: "Dashboard",    app: "Treasury Ops",     change: "new",     detail: "Created in Splunk Oct 11. Queries wu_fx_rates — an index with no bucket yet." },
      { id: "ALR-1189", name: "Sanctions screening backlog",     type: "Alert",        app: "Compliance",       change: "new",     detail: "Reads wu_sanctions_v2. Entered scope with the Wave 4–6 re-plan." },
      { id: "DSH-0188", name: "Cross-Border Settlement Latency", type: "Dashboard",    app: "Payments Core",    change: "changed", detail: "Panel removed, and a transaction command introduced on panel 7 — newly pre-flagged." },
      { id: "SRC-0731", name: "card_auth_decline_reasons",       type: "Saved search", app: "Retail Channels",  change: "changed", detail: "Time range widened from 24h to 30d. Throttle risk re-evaluated at deploy." },
      { id: "ALR-0904", name: "Settlement file late arrival",    type: "Alert",        app: "Payments Core",    change: "changed", detail: "Threshold adjusted. Already-translated output is now stale and queued for re-translation." },
      { id: "DSH-0251", name: "Legacy wire volumes (2019)",      type: "Dashboard",    app: "Corporate IT",     change: "removed", detail: "Deleted in Splunk Oct 10. Already translated in Wave 1 — flagged for review before it publishes." },
      { id: "SRC-0442", name: "deprecated_kyc_lookup_refresh",   type: "Saved search", app: "Compliance",       change: "removed", detail: "Deleted in Splunk. Was already dead-asset excluded, so no downstream impact." },
    ],
  },

  /* --- Step 3a: the no-equivalent command catalog ------------------------- */
  /* The catalog is fixed and shared with Risk Identification — same list,
     applied earlier. Qualify & Scope estimated this from discovery metadata;
     here it runs against actual query text, so the rework number grows while
     the blocked number holds. */
  catalog: {
    distinctAssets: 198,
    rawHits: 256,
    sharedWith: "Risk Identification · No-Equivalent Capability Flagging (Qualify & Scope)",
    commands: [
      { command: "transaction",        assets: 63, verdict: "rework",  why: "Event grouping has a documented DQL pattern, but every result needs confirming." },
      { command: "tstats",             assets: 38, verdict: "rework",  why: "Maps to a Grail view. Acceleration semantics do not carry over." },
      { command: "foreach",            assets: 29, verdict: "rework",  why: "Loop over fields — rewritable, but only case by case." },
      { command: "appendpipe",         assets: 21, verdict: "rework",  why: "Sub-pipeline append. Needs restructuring into a union." },
      { command: "transpose",          assets: 18, verdict: "rework",  why: "Row/column flip has no direct DQL form; usually a reshaped aggregation." },
      { command: "addtotals",          assets: 17, verdict: "rework",  why: "Expressible with an explicit summary row." },
      { command: "collect",            assets: 14, verdict: "blocked", why: "Writes to a summary index. There is nothing in DQL that writes back." },
      { command: "metadata",           assets: 12, verdict: "blocked", why: "Queries Splunk's own index metadata. No counterpart in Grail." },
      { command: "untable",            assets:  9, verdict: "rework",  why: "Inverse of xyseries. Rewritable with a reshaped aggregation." },
      { command: "cluster",            assets:  8, verdict: "rework",  why: "Pattern clustering — Davis log analytics is the nearest path, not a translation." },
      { command: "timewrap",           assets:  7, verdict: "rework",  why: "Period-over-period overlay. Needs a hand-built comparison." },
      { command: "outputlookup",       assets:  6, verdict: "blocked", why: "Writes a lookup file. No write path exists." },
      { command: "sendemail/sendalert", assets: 6, verdict: "blocked", why: "Triggers an action from inside a search. Belongs to workflows, not DQL." },
      { command: "map",                assets:  5, verdict: "blocked", why: "Row-wise subsearch iteration. No equivalent and no reliable rewrite." },
      { command: "gauge",              assets:  3, verdict: "blocked", why: "Visualisation-only command with no data-layer meaning in Dynatrace." },
    ],
  },

  /* --- Step 3b: the dead-asset gate --------------------------------------- */
  /* Detection already existed and was informational. The feature is the
     enforcement: excluded by default, visible not deleted, override per asset. */
  deadAssets: {
    detected: 88,
    rule: "No results returned in the last 90 days",
    autoExcluded: 87,
    overridden: 1,
    items: [
      { id: "DSH-0677", name: "Year-End Settlement Close",   type: "Dashboard",    app: "Treasury Ops",   lastResult: "2026-01-04", state: "overridden", by: "Martin Hale", at: "2026-10-06T11:02:00Z", reason: "Runs once a year at fiscal close. Dormant on purpose, not dead." },
      { id: "ALR-0233", name: "DR failover heartbeat",       type: "Alert",        app: "Corporate IT",   lastResult: "2026-05-18", state: "excluded",   reason: "" },
      { id: "SRC-0119", name: "legacy_ach_recon_v1",         type: "Saved search", app: "Payments Core",  lastResult: "2025-11-22", state: "excluded",   reason: "" },
      { id: "DSH-0310", name: "Branch Teller Volumes (AU)",  type: "Dashboard",    app: "Retail Channels", lastResult: "2025-08-30", state: "excluded",  reason: "" },
      { id: "ALR-0871", name: "Pilot fraud rule — cohort B",  type: "Alert",       app: "Fraud & Risk",   lastResult: "2026-02-11", state: "excluded",   reason: "" },
    ],
  },

  /* --- Step 4: version history -------------------------------------------- */
  /* Not the validation diff. That one compares source against translated
     output; this one compares one import of an asset against another. */
  tracked: {
    id: "DSH-0188",
    name: "Cross-Border Settlement Latency",
    type: "Dashboard",
    app: "Payments Core",
    wave: 1,
    versions: [
      { v: 1, run: 1, at: "2026-09-29T15:05:00Z", summary: "First import",                   panels: 14, preflags: 0, mapping: "Global default",                   change: "new" },
      { v: 2, run: 2, at: "2026-10-02T10:40:00Z", summary: "2 panels added by the source team", panels: 16, preflags: 0, mapping: "Global default",                 change: "changed" },
      { v: 3, run: 3, at: "2026-10-06T08:15:00Z", summary: "Queries narrowed on 3 panels",    panels: 16, preflags: 0, mapping: "Global default",                   change: "changed" },
      { v: 4, run: 4, at: "2026-10-09T07:30:00Z", summary: "Bucket override applied in mapping", panels: 16, preflags: 0, mapping: "App override · wu_payments",   change: "changed" },
      { v: 5, run: 5, at: "2026-10-13T09:12:00Z", summary: "Panel removed, transaction introduced", panels: 15, preflags: 1, mapping: "App override · wu_payments", change: "changed" },
    ],
    /* Field-level changes keyed by version, used to build an arbitrary diff. */
    changes: {
      2: [{ field: "Panels", from: "14", to: "16", kind: "added" }],
      3: [{ field: "Panel 3 timeframe", from: "-30d", to: "-7d", kind: "edited" },
          { field: "Panel 9 index", from: "wu_payments*", to: "wu_payments_settle", kind: "edited" },
          { field: "Panel 11 timeframe", from: "-90d", to: "-30d", kind: "edited" }],
      4: [{ field: "Bucket mapping", from: "Global default", to: "App override · wu_payments", kind: "edited" }],
      5: [{ field: "Panels", from: "16", to: "15", kind: "removed" },
          { field: "Panel 7 query", from: "stats by session_id", to: "transaction session_id maxspan=30m", kind: "edited" },
          { field: "No-equivalent pre-flags", from: "0", to: "1 (transaction)", kind: "added" }],
    },
  },
};

DMA.data.inventory.latestRun = function () {
  return DMA.data.inventory.runs[0];
};

DMA.data.inventory.catalogTotals = function () {
  return DMA.data.inventory.catalog.commands.reduce(
    (acc, c) => {
      acc[c.verdict] += c.assets;
      return acc;
    },
    { blocked: 0, rework: 0 }
  );
};

/* Every field-level change strictly between two versions, newest last. */
DMA.data.inventory.diff = function (from, to) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const changes = DMA.data.inventory.tracked.changes;
  const out = [];
  for (let v = lo + 1; v <= hi; v++) {
    (changes[v] || []).forEach((c) => out.push({ ...c, v }));
  }
  return out;
};
