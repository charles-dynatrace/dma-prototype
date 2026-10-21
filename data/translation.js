/* ============================================================================
   DATA: Translation
   ----------------------------------------------------------------------------
   Everything the Translate stage needs that is not already owned elsewhere.

   Read, never restated:
     · wave totals + status     — DMA.data.project.waves
     · asset type totals        — DMA.data.project.assets.byType
     · application placement    — DMA.data.planning.placement
     · outstanding mapping tokens and lookup delivery
                                — DMA.data.waveMapping.applications / .lookups
     · the profile the retries inject
                                — DMA.data.calibration.profile

   ----------------------------------------------------------------------------
   THE SPLIT THIS FILE EXISTS TO MAKE

   The estate is 2,955 assets. It is NOT 2,955 translations.

     Dashboards      412  ┐
     Alerts        1,204  │ translatable — SPL becomes DQL   = 2,584
     Saved searches  968  ┘
     Lookups         241  ┐ prerequisite — preloaded, never translated
     Macros          130  ┘                                  =   371

   Lookups are uploaded as data before a translation can resolve a `lookup`
   command against them; the consultants were unambiguous about this ("Preloaded,
   yes" — manual CSV download, API upload, no translation step at all). Macros
   are expanded into the macro dictionary Calibrate already froze. Neither is an
   asset that gets translated, and counting them as translations inflates every
   rate on this stage by 12.6%.

   This is also why the reference design has exactly three tabs.

   ----------------------------------------------------------------------------
   THE OTHER BOUNDARY: runnable vs. correct

   Translate asks "did we produce runnable DQL?"  Validate asks "does it return
   the same answer?"  They are different questions with different numbers:

     translation success   93.9%   runnable DQL, after at most one retry
     auto-approval         81.2%   output matches the Splunk original

   Both are measured over waves 1–4. The first is higher because producing
   runnable DQL is an easier bar than producing DQL that returns the same rows,
   and a stage that reported 93.9% as its headline would be claiming the
   second number while measuring the first.

   Conflating them is the single most likely misreading of this stage, which is
   why no confidence score and no diff appears anywhere in this file. Those
   belong to Validate.

   ----------------------------------------------------------------------------
   THE ARITHMETIC THAT HAS TO HOLD

     in-wave translatable            2,569   (2,584 estate − 15 unplaced)
     waves 1–4, run                  1,864   = 1,690 clean + 61 retried + 113 blocked
     61 retries                              → project.stages.translate
     retries fall  19 → 17 → 14 → 11         (the profile is learning)
     blocked holds 30 → 29 → 29 → 25         (capability, not context)
   ========================================================================== */

(function () {
  "use strict";

  const T = (DMA.data.translation = {});

  /* --- What translates, and what has to exist first ----------------------- */
  T.TRANSLATABLE = ["Dashboards", "Alerts", "Saved searches"];
  T.PREREQUISITE = ["Lookups", "Macros"];

  T.typeSplit = function () {
    const by = DMA.data.project.assets.byType;
    const sum = (names) => by.filter((t) => names.includes(t.type)).reduce((a, t) => a + t.count, 0);
    return {
      translatable: sum(T.TRANSLATABLE),   // 2,584
      prerequisite: sum(T.PREREQUISITE),   // 371
      total: by.reduce((a, t) => a + t.count, 0),
    };
  };

  /* --- Per-wave composition ------------------------------------------------
     Each row sums to that wave's `assets` count in project.js, and each column
     sums to the estate type total minus the 15 assets that never reached a
     wave (6 orphaned dashboards, 9 orphaned saved searches — the pending and
     out-of-scope rows in planning.js's unmapped queue).

     Wave 1 is lookup- and macro-heavy on purpose: Foundation carries Platform
     Shared Services, which is where the shared dictionary lives. Wave 6 is
     search-heavy and dashboard-light because Cleanup is mostly saved searches
     nobody has opened in a year. ---------------------------------------------- */
  T.composition = [
    { wave: 1, dashboards:  62, alerts:  198, savedSearches: 168, lookups:  61, macros:  45 },
    { wave: 2, dashboards:  78, alerts:  242, savedSearches: 171, lookups:  32, macros:  17 },
    { wave: 3, dashboards:  83, alerts:  228, savedSearches: 175, lookups:  38, macros:  17 },
    { wave: 4, dashboards:  71, alerts:  221, savedSearches: 167, lookups:  37, macros:  22 },
    { wave: 5, dashboards:  83, alerts:  236, savedSearches: 169, lookups:  43, macros:  18 },
    { wave: 6, dashboards:  29, alerts:   79, savedSearches: 109, lookups:  30, macros:  11 },
  ];

  T.compositionFor = function (waveId) {
    return T.composition.find((c) => c.wave === Number(waveId)) || null;
  };

  T.translatableIn = function (waveId) {
    const c = T.compositionFor(waveId);
    return c ? c.dashboards + c.alerts + c.savedSearches : 0;
  };

  T.prerequisiteIn = function (waveId) {
    const c = T.compositionFor(waveId);
    return c ? c.lookups + c.macros : 0;
  };

  /* --- The three model tiers -----------------------------------------------
     The PRD's "best-fit model per asset" needs more than one candidate that is
     genuinely evaluated, not a default with a fallback label. Three tiers with
     real trade-offs:

     Rule-based is the deterministic structure converter that already ships
     today. It is instant and free, and it is selected for 43% of assets —
     which is the part of "best-fit" that is a COST decision rather than a
     quality one. A single fixed path either overpays on those or underserves
     the long tail of multi-join searches that need extended context. ---------- */
  T.models = [
    {
      id: "rule",
      name: "Rule-based",
      kind: "Deterministic",
      blurb: "Structure conversion and DQL scaffolding. No model call.",
      latencyS: 0.4,
      selectedWhen: "Every command in the search is fully covered by the translator's own grammar, and the calibration profile has ≥4 instances of the pattern.",
      tone: "neutral",
    },
    {
      id: "standard",
      name: "Standard model",
      kind: "LLM",
      blurb: "The default for anything with a judgement call in it.",
      latencyS: 22,
      selectedWhen: "The search needs field or macro resolution, a non-trivial eval chain, or a transforming command the grammar does not cover outright.",
      tone: "info",
    },
    {
      id: "extended",
      name: "Extended-context model",
      kind: "LLM",
      blurb: "Reserved for searches that do not fit in the standard window.",
      latencyS: 68,
      selectedWhen: "SPL exceeds ~6k tokens, or carries more than two joins or subsearches that have to be reasoned about together.",
      tone: "warning",
    },
  ];

  /* --- The runs -------------------------------------------------------------
     Waves 1–4 are history. Wave 5 is the next one due and is the only wave the
     demo can actually trigger. Wave 6 has not cleared Wave Mapping, so it is
     not offered — `DMA.data.waveStageStatus` is what decides that, not a flag
     here, so the rail and this screen can never disagree.

     `held` is translatable assets excluded from the run because an upstream
     input is missing. They are not failures and they are not successes — they
     never started. Counting them either way is how a wave reports 100% on 73%
     of its work. ------------------------------------------------------------- */
  T.runs = [
    {
      wave: 1,
      state: "complete",
      startedAt: "2026-10-06T09:14:00Z",
      durationLabel: "11m 10s",
      ran: 428, held: 0,
      clean: 379, retried: 19, blocked: 30,
      models: { rule: 171, standard: 219, extended: 38 },
      triggeredBy: "Rosa Delgado",
      note: "First wave through the stage, and the first to lock rule set v2. 30 blocked is the high-water mark — Foundation carries the shared-index searches with the deepest join chains.",
    },
    {
      wave: 2,
      state: "complete",
      startedAt: "2026-10-10T08:30:00Z",
      durationLabel: "12m 11s",
      ran: 491, held: 0,
      clean: 445, retried: 17, blocked: 29,
      models: { rule: 203, standard: 248, extended: 40 },
      triggeredBy: "Rosa Delgado",
      note: "First wave to run against the released calibration profile. Rule-based selection rises to 41% because the profile now covers the screening idioms outright.",
    },
    {
      wave: 3,
      state: "complete",
      startedAt: "2026-10-14T09:05:00Z",
      durationLabel: "11m 29s",
      ran: 486, held: 0,
      clean: 443, retried: 14, blocked: 29,
      models: { rule: 206, standard: 245, extended: 35 },
      triggeredBy: "Claire Dubois",
      note: "Settlement's date arithmetic drove the extended-context selections. Blocked count flat against Wave 2 — the retries improved, the capability gaps did not.",
    },
    {
      wave: 4,
      state: "complete",
      startedAt: "2026-10-17T08:20:00Z",
      durationLabel: "10m 24s",
      ran: 459, held: 0,
      clean: 423, retried: 11, blocked: 25,
      models: { rule: 198, standard: 232, extended: 29 },
      triggeredBy: "Claire Dubois",
      note: "Re-run after the Oct 13 re-plan returned all 518 assets to translation. Lowest retry rate of the four at 2.4%, against 4.4% in Wave 1.",
    },
    {
      wave: 5,
      state: "armed",
      startedAt: null,
      durationLabel: "9m 18s",   // projected from the model plan
      ran: 354, held: 134,
      clean: 320, retried: 24, blocked: 10,
      models: { rule: 154, standard: 167, extended: 33 },
      triggeredBy: null,
      note: "Projected from the selected model plan. 134 assets are held because Remittance and Facilities & IoT have never supplied a `team` value — two missing words, 27% of the wave.",
    },
  ];

  T.runFor = function (waveId) {
    return T.runs.find((r) => r.wave === Number(waveId)) || null;
  };

  /* --- Why a translation was retried ---------------------------------------
     Every one of these injects context that an earlier stage already decided.
     That is the argument for the stages existing: without Global Mapping there
     is no field rule to inject, without Calibrate no macro dictionary, without
     Wave Mapping no bucket or timeframe. The retry is the stage collecting on
     work already done. ------------------------------------------------------- */
  T.retryReasons = [
    { id: "field",   label: "Field mapping injected from the global rule set",      from: "global-mapping", w14: 24, w5: 10, detail: "The first pass emitted a field the schema does not carry. The retry is given the translator→project→application cascade for that field and re-emits against the resolved target." },
    { id: "macro",   label: "Macro definition injected from the calibration profile", from: "calibrate",     w14: 19, w5:  7, detail: "An unexpanded `\\`macro(n)\\`` call. The retry receives the frozen definition and its argument units — which is exactly the dictionary entry a consultant corrected from hours to minutes." },
    { id: "scope",   label: "Bucket and timeframe scope injected from wave mapping", from: "wave-mapping",   w14: 11, w5:  4, detail: "The query ran unscoped and would have swept every bucket. The retry is handed the resolved bucket and the wave's timeframe ceiling." },
    { id: "lookup",  label: "Lookup schema injected",                                from: "wave-mapping",   w14:  7, w5:  3, detail: "A `lookup` against a preloaded table whose key column the first pass guessed wrong. The retry gets the real column list." },
  ];

  /* --- Why a translation is still blocked after its retry -------------------
     The shape of this list is the argument. Retries fix CONTEXT problems — a
     field we knew, a macro we had, a bucket already decided. They cannot fix
     CAPABILITY problems, which is why the blocked count sits flat across four
     waves while the retry count falls by 42%. Adding a second retry would not
     move any of these rows. ------------------------------------------------- */
  T.blockReasons = [
    { id: "variable", label: "Dashboard variable with no DQL equivalent",   w14: 34, w5: 4, detail: "The panel's query is parameterised by a Splunk dashboard token. Without the variable the DQL is syntactically fine and semantically meaningless — the single largest cause, and the one consultants named first." },
    { id: "field",    label: "Unresolved field reference",                  w14: 28, w5: 2, detail: "A field that exists in neither the source schema nor the mapping cascade. Usually a search written against an index that was decommissioned before the migration started." },
    { id: "join",     label: "Multi-stage join beyond translator support",  w14: 22, w5: 2, detail: "Three or more correlated joins. The translation is attempted and rejected rather than emitted half-right — a plausible-looking wrong join is more expensive than no join." },
    { id: "subsearch",label: "Subsearch exceeding the 10,000-row ceiling",  w14: 14, w5: 1, detail: "Splunk silently truncates these at 10,000 rows; the source result is already wrong, so translating it faithfully would migrate the defect." },
    { id: "context",  label: "SPL exceeds the extended-context window",     w14:  9, w5: 1, detail: "Nine searches over ~24k tokens, all of them generated by a reporting tool rather than written by a person." },
    { id: "lookup",   label: "Lookup referenced but not preloaded",         w14:  6, w5: 0, detail: "Caught by the pre-flight gate from Wave 2 onward. The six in Wave 1 are why that gate exists." },
  ];

  /* --- Pre-flight ------------------------------------------------------------
     Four checks. Two are derived live from other modules' fixtures rather than
     restated here, so they cannot drift:

       lookups  — reads wavemapping.lookups for anything delivering AFTER the
                  wave that reads it. This is the one check this stage can
                  resolve itself, because delivery ORDER is a translate-time
                  decision: pull the table forward and the dependency is met.
       tokens   — reads wavemapping.applications for apps in this wave with no
                  `team` or `app_prefix`. This stage CANNOT resolve it; the
                  value belongs to whoever owns the application.

     The difference is deliberate. A gate you can clear on the screen you are
     standing on is a gate; a gate that sends you somewhere else is a handoff,
     and pretending otherwise is how a consultant ends up typing a team name
     into a field that does not own it. ---------------------------------------- */

  function appsInWave(waveId) {
    const place = DMA.data.planning.placement;
    return DMA.data.planning.applications.filter((a) => place[a.id] === Number(waveId));
  }

  /* Translatable assets held back per application, for the two applications
     that supplied nothing. Keyed rather than computed because the type split
     inside an application is not derivable from its total. */
  T.heldByApp = {
    remittance:       { dashboards: 12, alerts: 38, savedSearches: 27, total: 77 },
    "facilities-iot": { dashboards:  9, alerts: 31, savedSearches: 17, total: 57 },
    "hr-payroll":     { dashboards:  8, alerts: 30, savedSearches: 21, total: 59 },
    marketing:        { dashboards:  6, alerts: 22, savedSearches: 16, total: 44 },
  };

  /* Late lookups: delivered after a wave that reads them. Derived from the
     same rows Wave Mapping draws, so a re-plan re-derives the lateness. */
  T.lateLookups = function (waveId) {
    const place = DMA.data.planning.placement;
    const w = Number(waveId);
    if (T.pulledForward[w]) return [];
    return DMA.data.waveMapping.lookups.filter((lk) => {
      if (lk.deliverWave <= w) return false;
      return lk.referencedBy.some((appId) => place[appId] === w);
    });
  };

  /* Session-free record of a pull-forward, set by the module when a consultant
     resolves the gate. Deliberately NOT in DMA.store: it is a demo action, and
     writing it to session state would re-render the whole module mid-gesture. */
  T.pulledForward = {};

  T.missingTokens = function (waveId) {
    const defs = DMA.data.waveMapping.applications || {};
    const out = [];
    appsInWave(waveId).forEach((app) => {
      const vals = defs[app.id] || {};
      const missing = ["app_prefix", "team"].filter((k) => !vals[k]);
      if (missing.length) out.push({ app, missing, held: T.heldByApp[app.id] || null });
    });
    return out;
  };

  T.preflight = function (waveId) {
    const w = Number(waveId);
    const comp = T.compositionFor(w);
    const late = T.lateLookups(w);
    const tokens = T.missingTokens(w);
    const heldTotal = tokens.reduce((a, t) => a + (t.held ? t.held.total : 0), 0);
    const cal = DMA.data.calibration;

    return {
      wave: w,
      translatable: T.translatableIn(w),
      held: heldTotal,
      runnable: T.translatableIn(w) - heldTotal,
      checks: [
        {
          id: "lookups",
          label: "Lookups preloaded",
          value: `${comp.lookups - late.length} of ${comp.lookups}`,
          status: late.length ? "blocked" : "pass",
          blocking: true,
          resolvableHere: true,
          late: late,
          detail: late.length
            ? `${late.map((l) => l.name).join(" and ")} deliver in Wave ${late[0].deliverWave} but are read in Wave ${w}. Translating now emits a \`lookup\` against a table that will not exist — the DQL runs and returns nothing, which is the failure mode nobody notices until a customer does.`
            : "Every lookup this wave's searches reference is loaded and keyed. A lookup is data, not a translation — it is uploaded before the run, never produced by it.",
        },
        {
          id: "macros",
          label: "Macros resolved",
          value: `${comp.macros} of ${comp.macros}`,
          status: "pass",
          blocking: true,
          detail: `All ${comp.macros} expand from the macro dictionary Calibrate froze at ${cal.profile.version}. Macros are not translated either — they are substituted into the SPL before it reaches a model.`,
        },
        {
          id: "tokens",
          label: "Mapping tokens supplied",
          value: tokens.length ? `${tokens.length} application${tokens.length > 1 ? "s" : ""} outstanding` : "Complete",
          status: tokens.length ? "warning" : "pass",
          blocking: false,
          resolvableHere: false,
          owner: "wave-mapping",
          tokens: tokens,
          detail: tokens.length
            ? `${tokens.map((t) => t.app.name).join(" and ")} have not supplied \`${tokens[0].missing.join("`, `")}\`. Their ${heldTotal} translatable assets are held out of the run rather than translated to a name that cannot resolve. This is not Translate's to fix — the value belongs to the application.`
            : "Every application in this wave has supplied the inputs the confirmed rule set demands.",
        },
        {
          id: "ruleset",
          label: "Rule set",
          value: "v4 — locks on run",
          status: "pass",
          blocking: false,
          detail: "Starting this run freezes rule set v4 against Wave " + w + ". The only way back is a manual review that explicitly returns the wave's assets to translation, which is what Wave 4 did on Oct 13.",
        },
      ],
    };
  };

  /* --- The asset sample ------------------------------------------------------
     A representative slice, not the full population — 2,569 rows is a fixture
     nobody reads and a page nobody scrolls. Every row below is real enough to
     drill into; the table says plainly how many it is showing out of how many.

     `tiles` exists only on dashboards, which is why the three tabs do not share
     a column set. A dashboard is not the unit of work and never was — the
     consultants count tiles ("25 tiles out of 50"), and a dashboard marked
     blocked is almost always one bad panel out of twelve. ---------------------- */
  T.assets = [
    /* ---- Wave 5, dashboards ---- */
    { id: "DS-5101", wave: 5, type: "Dashboards", name: "Wallet Top-Up Funnel", app: "digital-wallet", model: "standard", outcome: "clean", tiles: { total: 12, flagged: 0 } },
    { id: "DS-5102", wave: 5, type: "Dashboards", name: "Stored Value Balances", app: "digital-wallet", model: "rule", outcome: "clean", tiles: { total: 6, flagged: 0 } },
    {
      id: "DS-5103", wave: 5, type: "Dashboards", name: "P2P Transfer Latency", app: "digital-wallet", model: "standard",
      outcome: "retried", retryReason: "macro",
      tiles: { total: 9, flagged: 0 },
      injected: "`wu_latency_pctl(p)` — percentile argument, unitless; defined over `duration_ms`.",
      detail: "First pass emitted the macro call verbatim. The profile's dictionary entry resolved it on the retry.",
    },
    {
      id: "DS-5104", wave: 5, type: "Dashboards", name: "FX Rate Drift — Intraday", app: "fx-pricing", model: "extended",
      outcome: "blocked", blockReason: "variable",
      tiles: { total: 14, flagged: 3 },
      detail: "Eleven of fourteen panels translated. Three are parameterised by the `$corridor$` dashboard token, which has no DQL equivalent — the panels are fine, the parameterisation is not.",
      tileList: [
        { n: 1, name: "Corridor spread — headline", state: "clean", model: "rule" },
        { n: 2, name: "Mid-rate vs. book", state: "clean", model: "standard" },
        { n: 3, name: "Spread by corridor", state: "blocked", model: "extended", why: "Filters on `$corridor$`. No DQL equivalent for a dashboard-scoped token." },
        { n: 4, name: "Quote staleness", state: "clean", model: "standard" },
        { n: 5, name: "Drift against ECB reference", state: "clean", model: "extended" },
        { n: 6, name: "Corridor volume — 24h", state: "blocked", model: "extended", why: "Same `$corridor$` token, used as an index selector rather than a filter." },
        { n: 7, name: "Desk exposure", state: "clean", model: "standard" },
        { n: 8, name: "Hedge coverage", state: "clean", model: "standard" },
        { n: 9, name: "Rate request rate", state: "clean", model: "rule" },
        { n: 10, name: "Failed quote reasons", state: "clean", model: "standard" },
        { n: 11, name: "Corridor P&L", state: "blocked", model: "extended", why: "Joins the corridor token against `corridor_fx_desk` — token and join together." },
        { n: 12, name: "Settlement lag", state: "clean", model: "standard" },
        { n: 13, name: "Top movers", state: "clean", model: "rule" },
        { n: 14, name: "Alert volume", state: "clean", model: "rule" },
      ],
    },
    { id: "DS-5105", wave: 5, type: "Dashboards", name: "KYC Onboarding Funnel", app: "customer-identity", model: "standard", outcome: "clean", tiles: { total: 11, flagged: 0 } },
    {
      id: "DS-5106", wave: 5, type: "Dashboards", name: "Identity Verification SLA", app: "customer-identity", model: "standard",
      outcome: "retried", retryReason: "lookup",
      tiles: { total: 8, flagged: 0 },
      injected: "`kyc_doc_type` — key column `doc_code`, not `type` as the first pass assumed.",
      detail: "Pulled forward from Wave 6 by the pre-flight gate. Without that, this asset would have translated against a table that did not exist yet.",
    },
    { id: "DS-5107", wave: 5, type: "Dashboards", name: "Device Trust Signals", app: "customer-identity", model: "rule", outcome: "clean", tiles: { total: 5, flagged: 0 } },
    {
      id: "DS-5108", wave: 5, type: "Dashboards", name: "Corridor Pricing Board", app: "fx-pricing", model: "extended",
      outcome: "retried", retryReason: "scope",
      tiles: { total: 10, flagged: 0 },
      injected: "Bucket `logs:wu_fx_pricing`, timeframe ceiling 7 days.",
      detail: "The first pass translated an unscoped search that would have swept every bucket in the tenant. Wave Mapping had already resolved the scope; the retry was handed it.",
    },

    /* ---- Wave 5, alerts ---- */
    { id: "AL-5201", wave: 5, type: "Alerts", name: "Wallet top-up failure rate > 2%", app: "digital-wallet", model: "rule", outcome: "clean" },
    { id: "AL-5202", wave: 5, type: "Alerts", name: "FX quote staleness > 90s", app: "fx-pricing", model: "rule", outcome: "clean" },
    {
      id: "AL-5203", wave: 5, type: "Alerts", name: "KYC queue depth sustained", app: "customer-identity", model: "standard",
      outcome: "retried", retryReason: "field",
      injected: "`svc` → `service.name` (project layer), overriding the translator's `k8s.service`.",
      detail: "Exactly the correction a consultant made to the profile at Calibrate — two thirds of this field's users predate the Kubernetes rollout.",
    },
    { id: "AL-5204", wave: 5, type: "Alerts", name: "Stored-value reconciliation break", app: "digital-wallet", model: "standard", outcome: "clean" },
    {
      id: "AL-5205", wave: 5, type: "Alerts", name: "Cross-corridor arbitrage window", app: "fx-pricing", model: "extended",
      outcome: "blocked", blockReason: "join",
      detail: "Correlates three indexes against two lookups in a single search. The translator can emit two of the three joins; emitting a partial correlation would produce an alert that fires on the wrong population.",
    },
    { id: "AL-5206", wave: 5, type: "Alerts", name: "Document upload error spike", app: "customer-identity", model: "rule", outcome: "clean" },

    /* ---- Wave 5, saved searches ---- */
    { id: "SS-5301", wave: 5, type: "Saved searches", name: "Daily wallet settlement extract", app: "digital-wallet", model: "standard", outcome: "clean" },
    { id: "SS-5302", wave: 5, type: "Saved searches", name: "FX desk exposure — hourly", app: "fx-pricing", model: "rule", outcome: "clean" },
    {
      id: "SS-5303", wave: 5, type: "Saved searches", name: "Dormant wallet sweep", app: "digital-wallet", model: "extended",
      outcome: "blocked", blockReason: "subsearch",
      detail: "The subsearch returns 41,000 account ids and Splunk silently truncates it at 10,000. The source result has been wrong for two years; translating it faithfully would migrate the defect and make it look sanctioned.",
    },
    { id: "SS-5304", wave: 5, type: "Saved searches", name: "Identity match-rate rollup", app: "customer-identity", model: "standard", outcome: "clean" },
    {
      id: "SS-5305", wave: 5, type: "Saved searches", name: "Corridor margin by product", app: "fx-pricing", model: "standard",
      outcome: "retried", retryReason: "lookup",
      injected: "`product_catalogue` — 2,217 rows, key column `sku`.",
      detail: "The second of the two tables the pre-flight pulled forward from Wave 6.",
    },

    /* ---- Waves 1–4, a cross-section of the history ---- */
    {
      id: "DS-1101", wave: 1, type: "Dashboards", name: "Platform Ingest Health", app: "platform-shared", model: "extended",
      outcome: "blocked", blockReason: "lookup",
      tiles: { total: 16, flagged: 2 },
      detail: "One of the six Wave 1 assets that reached a lookup before it was loaded. The pre-flight gate exists because of this run.",
    },
    { id: "DS-1102", wave: 1, type: "Dashboards", name: "Payment Authorisation Rates", app: "payments-core", model: "standard", outcome: "clean", tiles: { total: 13, flagged: 0 } },
    {
      id: "DS-1103", wave: 1, type: "Dashboards", name: "Shared Index Throughput", app: "platform-shared", model: "extended",
      outcome: "blocked", blockReason: "join",
      tiles: { total: 9, flagged: 4 },
      detail: "Five panels clean, four correlating four indexes at once. The shared `main` index has four unrelated writers, which is the same fact that dented the calibration curve.",
    },
    {
      id: "AL-2201", wave: 2, type: "Alerts", name: "Sanctions list hit — real time", app: "sanctions", model: "standard",
      outcome: "retried", retryReason: "macro",
      injected: "`wu_fraud_window(n)` — argument in MINUTES.",
      detail: "The profile originally learned this argument as hours. A consultant corrected it at Calibrate; without that correction this alert would have widened its window sixtyfold and still run cleanly.",
    },
    { id: "DS-2101", wave: 2, type: "Dashboards", name: "OFAC Hit Rate", app: "sanctions", model: "standard", outcome: "clean", tiles: { total: 7, flagged: 0 } },
    {
      id: "SS-3301", wave: 3, type: "Saved searches", name: "Settlement break aging", app: "settlement", model: "extended",
      outcome: "retried", retryReason: "scope",
      injected: "Bucket `logs:wu_settlement`, timeframe 7 days.",
    },
    {
      id: "DS-4101", wave: 4, type: "Dashboards", name: "SAR Filing Volume", app: "compliance-rpt", model: "standard",
      outcome: "clean", tiles: { total: 10, flagged: 0 },
      detail: "Re-translated on Oct 17 after the re-plan returned Wave 4 to translation. The first translation on Oct 11 was against rule set v3, which had never classified the three indexes the re-plan introduced.",
    },
    {
      id: "AL-4201", wave: 4, type: "Alerts", name: "Branch close-of-day variance", app: "retail-channels", model: "standard",
      outcome: "blocked", blockReason: "variable",
      detail: "Driven by a `$branch_group$` token the branch team edits weekly. Routed to Exceptions, where it needs a rebuild rather than a retry.",
    },

    /* Enough of each type in every completed wave that the three tabs are worth
       opening on any wave, not just the one the demo arms. The outcome mix is
       deliberately skewed clean — a sample where a third of the rows failed
       would misrepresent a 93.9% stage. */

    /* ---- Wave 1 ---- */
    { id: "AL-1201", wave: 1, type: "Alerts", name: "Authorisation decline rate > 4%", app: "payments-core", model: "rule", outcome: "clean" },
    { id: "AL-1202", wave: 1, type: "Alerts", name: "Ingest pipeline lag sustained", app: "platform-shared", model: "rule", outcome: "clean" },
    {
      id: "AL-1203", wave: 1, type: "Alerts", name: "Settlement file not received", app: "payments-core", model: "standard",
      outcome: "retried", retryReason: "field",
      injected: "`host` → `host.name`, resolved from the global rule set rather than inferred.",
      detail: "The first wave is where most of the field rules were earned. This one became a global rule and never cost a retry again.",
    },
    { id: "SS-1301", wave: 1, type: "Saved searches", name: "Daily authorisation extract", app: "payments-core", model: "rule", outcome: "clean" },
    { id: "SS-1302", wave: 1, type: "Saved searches", name: "Index growth by sourcetype", app: "platform-shared", model: "standard", outcome: "clean" },
    {
      id: "SS-1303", wave: 1, type: "Saved searches", name: "Cross-region payment latency", app: "payments-core", model: "extended",
      outcome: "blocked", blockReason: "context",
      detail: "1,900 lines of SPL accumulated over six years, most of it commented-out alternatives. It does not fit the extended window and nobody in the room could say what it was for.",
    },

    /* ---- Wave 2 ---- */
    { id: "DS-2102", wave: 2, type: "Dashboards", name: "Card Authorisation Overview", app: "card-services", model: "standard", outcome: "clean", tiles: { total: 11, flagged: 0 } },
    {
      id: "DS-2103", wave: 2, type: "Dashboards", name: "Fraud Model Drift", app: "fraud-risk", model: "extended",
      outcome: "blocked", blockReason: "field",
      tiles: { total: 12, flagged: 5 },
      detail: "Seven panels clean. Five read `risk_score_v2`, a field the fraud team renamed in Splunk without telling anyone and which exists under three names across the estate.",
    },
    { id: "AL-2202", wave: 2, type: "Alerts", name: "Card BIN range anomaly", app: "card-services", model: "rule", outcome: "clean" },
    { id: "AL-2203", wave: 2, type: "Alerts", name: "Fraud score backlog", app: "fraud-risk", model: "standard", outcome: "clean" },
    { id: "SS-2301", wave: 2, type: "Saved searches", name: "Sanctions screening throughput", app: "sanctions", model: "rule", outcome: "clean" },
    {
      id: "SS-2302", wave: 2, type: "Saved searches", name: "Chargeback aging by issuer", app: "card-services", model: "standard",
      outcome: "retried", retryReason: "scope",
      injected: "Bucket `logs:wu_card_services`, timeframe ceiling 30 days.",
      detail: "Unscoped and 90 days by default — the same shape as the fourteen assets that later blocked Wave 3's health check.",
    },
    { id: "SS-2303", wave: 2, type: "Saved searches", name: "Watchlist match audit trail", app: "sanctions", model: "standard", outcome: "clean" },

    /* ---- Wave 3 ---- */
    { id: "DS-3101", wave: 3, type: "Dashboards", name: "Nostro Position Monitor", app: "treasury-ops", model: "standard", outcome: "clean", tiles: { total: 9, flagged: 0 } },
    { id: "DS-3102", wave: 3, type: "Dashboards", name: "Partner API Error Budget", app: "partner-api", model: "rule", outcome: "clean", tiles: { total: 6, flagged: 0 } },
    {
      id: "DS-3103", wave: 3, type: "Dashboards", name: "Reconciliation Break Explorer", app: "settlement", model: "extended",
      outcome: "retried", retryReason: "field",
      tiles: { total: 14, flagged: 0 },
      injected: "`break_type` → `settlement.break.category`, from the Settlement application override.",
      detail: "Fourteen panels, one field, one retry. The override existed in Wave Mapping; the first pass simply had not been handed it.",
    },
    { id: "AL-3201", wave: 3, type: "Alerts", name: "Nostro overdraft risk", app: "treasury-ops", model: "rule", outcome: "clean" },
    { id: "AL-3202", wave: 3, type: "Alerts", name: "Partner API 5xx burst", app: "partner-api", model: "rule", outcome: "clean" },
    {
      id: "AL-3203", wave: 3, type: "Alerts", name: "Unmatched settlement > 2h", app: "settlement", model: "extended",
      outcome: "blocked", blockReason: "subsearch",
      detail: "The subsearch returns 23,000 reference ids against a 10,000 ceiling. Translating it faithfully would carry a silent truncation into production and make it look deliberate.",
    },
    { id: "SS-3302", wave: 3, type: "Saved searches", name: "Partner latency percentiles", app: "partner-api", model: "standard", outcome: "clean" },
    { id: "SS-3303", wave: 3, type: "Saved searches", name: "Intraday liquidity snapshot", app: "treasury-ops", model: "rule", outcome: "clean" },

    /* ---- Wave 4 ---- */
    { id: "DS-4102", wave: 4, type: "Dashboards", name: "Agent Network Liquidity", app: "agent-network", model: "standard", outcome: "clean", tiles: { total: 8, flagged: 0 } },
    { id: "DS-4103", wave: 4, type: "Dashboards", name: "Branch Teller Activity", app: "retail-channels", model: "rule", outcome: "clean", tiles: { total: 5, flagged: 0 } },
    { id: "AL-4202", wave: 4, type: "Alerts", name: "Agent float below threshold", app: "agent-network", model: "rule", outcome: "clean" },
    {
      id: "AL-4203", wave: 4, type: "Alerts", name: "Regulatory report overdue", app: "compliance-rpt", model: "standard",
      outcome: "retried", retryReason: "macro",
      injected: "`wu_business_days(n)` — excludes the ACME holiday calendar, not a plain weekday count.",
      detail: "A macro a reviewer would almost certainly have approved wrongly by eye. The dictionary entry made the difference, and it came from Calibrate rather than from this run.",
    },
    { id: "SS-4301", wave: 4, type: "Saved searches", name: "SAR filing audit extract", app: "compliance-rpt", model: "rule", outcome: "clean" },
    { id: "SS-4302", wave: 4, type: "Saved searches", name: "Agent commission reconciliation", app: "agent-network", model: "standard", outcome: "clean" },
    { id: "SS-4303", wave: 4, type: "Saved searches", name: "Branch cash position — daily", app: "retail-channels", model: "standard", outcome: "clean" },
  ];

  T.assetsFor = function (waveId, type) {
    return T.assets.filter((a) => a.wave === Number(waveId) && (!type || a.type === type));
  };

  /* --- Roll-ups --------------------------------------------------------------
     Everything below is derived. Nothing here is a second copy of a number that
     already exists above, which is what stops the summary and the table from
     disagreeing after an edit. ---------------------------------------------- */

  T.completedRuns = function () {
    return T.runs.filter((r) => r.state === "complete");
  };

  T.estate = function () {
    const done = T.completedRuns();
    const sum = (k) => done.reduce((a, r) => a + r[k], 0);
    const inWave = T.composition.reduce((a, c) => a + c.dashboards + c.alerts + c.savedSearches, 0);
    const ran = sum("ran");
    return {
      inWave: inWave,            // 2,569
      ran: ran,                  // 1,864
      clean: sum("clean"),       // 1,690
      retried: sum("retried"),   //    61
      blocked: sum("blocked"),   //   113
      translated: sum("clean") + sum("retried"),
      pending: inWave - ran,
      wavesDone: done.length,
    };
  };

  /* Translation success — runnable DQL after at most one retry. Deliberately
     NOT the auto-approval rate: this stage does not know whether the DQL is
     correct, only whether it is runnable. */
  T.successRate = function (run) {
    const r = run || T.estate();
    const denom = run ? run.ran : r.ran;
    return ((r.clean + r.retried) / denom) * 100;
  };

  T.firstPassRate = function (run) {
    const r = run || T.estate();
    const denom = run ? run.ran : r.ran;
    return (r.clean / denom) * 100;
  };

  T.retryRate = function (run) {
    const r = run || T.estate();
    const denom = run ? run.ran : r.ran;
    return (r.retried / denom) * 100;
  };

  /* What a retry bought: the blocked count had this feature not existed. */
  T.retriesSaved = function () {
    const e = T.estate();
    return { recovered: e.retried, wouldHaveBlocked: e.blocked + e.retried };
  };

  /* Per-wave model mix, as percentages, for whichever runs have one. */
  T.modelMix = function (run) {
    const total = run.models.rule + run.models.standard + run.models.extended;
    return T.models.map((m) => ({
      model: m,
      count: run.models[m.id],
      pct: (run.models[m.id] / total) * 100,
    }));
  };

  /* Reason breakdowns scoped to one run, or to the completed history. */
  T.reasonsFor = function (list, waveId) {
    const key = Number(waveId) === 5 ? "w5" : "w14";
    return list.map((r) => ({ ...r, count: r[key] })).filter((r) => r.count > 0);
  };

  /* --- Where the outputs go next --------------------------------------------
     Three destinations, and the split is the whole routing argument. Clean and
     retried outputs are indistinguishable downstream — a retried translation is
     not a lesser translation, it just took two attempts — so both go to Validate
     as one population. Blocked assets never reach Validate at all, because there
     is nothing to compare. ---------------------------------------------------- */
  T.routing = function (run) {
    return [
      {
        id: "validate",
        label: "To Validate",
        count: run.clean + run.retried,
        tone: "success",
        detail: "Runnable DQL. Asset-to-Asset Validation now asks the question this stage cannot: does it return the same answer? Clean and retried arrive as one population — the retry is invisible downstream and should be.",
      },
      {
        id: "exceptions",
        label: "To Exceptions",
        count: run.blocked,
        tone: "critical",
        detail: "No runnable DQL after the one permitted retry. These arrive with the block reason and the partial output attached, so a reviewer starts from what was produced rather than from the SPL. Exceptions has two inlets — this one, and whatever Validate routes for a difference it cannot auto-approve.",
      },
      {
        id: "held",
        label: "Held",
        count: run.held,
        tone: "warning",
        detail: "Never started. Waiting on an input another stage owns, so they are neither a success nor a failure. They re-enter this wave's queue the moment the value lands — no re-plan, no re-import.",
      },
    ].filter((r) => r.count > 0);
  };
})();
