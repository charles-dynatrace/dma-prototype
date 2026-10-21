/* ============================================================================
   Golden-path demo project.
   ----------------------------------------------------------------------------
   Modelled on the Acme Corp reference migration cited throughout the
   feature PRDs: ~2,955 assets, ~3,000 dashboard panels, ~1,200 alerts, and a
   1,675-hour manual dashboard-review baseline.

   All numbers are illustrative. Each module may add its own fixtures in
   data/ — modules must not reach into another module's fixtures.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

DMA.data.project = {
  id: "PRJ-2041",
  name: "Acme Corp",
  subtitle: "Splunk Enterprise → Dynatrace SaaS",
  source: { product: "Splunk Enterprise", version: "9.1.2", deployment: "On-premises", connected: true },
  target: { tenant: "wun-prod.apps.dynatrace.com", nonProd: "wun-staging.apps.dynatrace.com" },

  epm: "Martin Hale",
  consultants: ["Rosa Delgado", "Claire Dubois", "Arjun Mehta"],

  startDate: "2026-09-29",
  targetGoLive: "2026-10-27",
  daysElapsed: 20,
  targetDays: 30,

  currentStage: "validate",

  /* --- Inventory -------------------------------------------------------- */
  assets: {
    total: 2955,
    byType: [
      { type: "Dashboards",     count: 412,  detail: "3,002 panels" },
      { type: "Alerts",         count: 1204, detail: "scheduled + real-time" },
      { type: "Saved searches", count: 968,  detail: "" },
      { type: "Lookups",        count: 241,  detail: "" },
      { type: "Macros",         count: 130,  detail: "" },
    ],
    lastImport: "2026-10-13T09:12:00Z",
    delta: { new: 12, changed: 34, removed: 3 },
    excluded: { dead: 87, noEquivalent: 46 },
  },

  /* --- Calibration (sample-scoped, runs once before the first wave) ----- */
  calibration: {
    sampleSize: 214,
    sampledFrom: 2955,
    predictedAutoApproval: 78,
    actualAutoApproval: 81.2,
    lift: 23, // percentage points vs. the same sample with no profile
    reviewedBy: "Rosa Delgado",
    reviewedAt: "2026-10-11T15:40:00Z",
  },

  /* --- Validation outcome (Asset-to-Asset Validation, P0) -----------------
     NOT the estate. Validate can only compare assets that Translate produced
     runnable DQL for, and only Waves 1–4 have run: 1,864 ran, 1,751 came out
     runnable, and those 1,751 are the denominator here. The other 113 were
     blocked in Translate and went straight to Exceptions without ever reaching
     a comparator.

     These three numbers used to read 2,400 / 412 / 143, which sums to 2,955 —
     the whole estate, including 371 lookups and macros that never translate
     and 1,091 assets in waves that have not run. 81.2% is the locked rate, so
     the counts are re-derived under it rather than the other way round.

     data/validation.js owns the per-wave detail and re-derives these three on
     load (`DMA.data.validation.assertTotals()`), warning if they drift. They
     are literals here only because this file loads first. */
  validation: {
    validated: 1751,
    autoApproved: 1422,
    meaningfulDifference: 243,
    uncertain: 86,
    get needsAttention() { return this.meaningfulDifference + this.uncertain; },
    /* Of needsAttention, 173 were dispositioned before Waves 1–2 published
       (38 overridden, 135 sent to Exceptions). These 156 are still open. */
    openNow: 156,
    autoApprovalRate: 81.2,
    targetRate: 70,
    stretchRate: 90,
    falsePositiveRate: 0.4,
  },

  /* --- Effort ----------------------------------------------------------- */
  effort: {
    baselineReviewHours: 1675,
    hoursAvoided: 1359,
    hoursRemaining: 316,
    automatedHours: 1420,
    manualHours: 316,
  },

  /* --- Waves --------------------------------------------------------------
     The committed output of Prioritize & Plan, not a hand-built list. Names
     are phases, not applications: a wave carries several applications, and an
     application is not a wave. Priority seeded four waves, one per tier; the
     EPM committed six. These rows are that commit, frozen, plus the execution
     state each wave has accumulated since.

     These counts sum to 2,940, NOT to the 2,955 in scope. The 15-asset gap is
     deliberate and is the point of the unmapped queue: 9 assets carry no
     application attribution and are still awaiting a decision, and 6 were
     marked out of scope at planning time. Neither group belongs to a wave, so
     neither is counted here. They are also NOT in `assets.excluded` above —
     that bucket is the import-time gate (dead + no-equivalent = 133, which is
     what takes 3,088 discovered down to 2,955 in scope). Excluding at import
     and excluding at planning are different decisions by different people at
     different times, and collapsing them would hide the second one.

     `data/planning.js` is the live version of this: edit a placement there and
     the plan re-derives. These rows are the snapshot the rest of the app reads.

     These rows used to carry a wave-level `health: "pass" | "warning" |
     "pending"` and Wave 3 carried `blockedAt: "deploy"`. Both are gone, and
     deliberately. The pre-deploy health check holds the assets that fail it
     and lets the rest of the wave through — the P1 PRD says so explicitly —
     so there is no such thing as a wave-level health verdict. Wave 3 has 14
     assets held and 361 cleared and ready; summarising that as a red
     "Blocked" badge on the wave, and a blocked pip on the stage rail, claimed
     a 497-asset problem where a 14-asset one exists, and made a real safety
     gate look like ceremony standing in front of a finished wave.

     The asset-level truth lives in data/deploy.js and is re-derived on every
     render. Overview's waves table now asks for it rather than reading a flag
     here, which is why neither field is missed. */
  waves: [
    { id: 1, name: "Foundation",                   assets: 534, status: "published",  env: "Production", priority: "Critical", published: "2026-10-09" },
    { id: 2, name: "Core — Risk & Screening",      assets: 540, status: "published",  env: "Non-prod",   priority: "Critical", published: "2026-10-15" },
    { id: 3, name: "Core — Treasury & Settlement", assets: 541, status: "validating", env: "—",          priority: "High",     published: null },
    { id: 4, name: "Core — Compliance & Channels", assets: 518, status: "translated", env: "—",          priority: "High",     published: null },
    { id: 5, name: "Secondary",                    assets: 549, status: "mapped",     env: "—",          priority: "Medium",   published: null },
    { id: 6, name: "Cleanup",                      assets: 258, status: "planned",    env: "—",          priority: "Low",      published: null },
  ],

  /* --- Stage state ------------------------------------------------------ */
  stages: {
    "qualify-scope":       { status: "complete",    note: "Source connected, 2,955 assets discovered" },
    "prepare-environment": { status: "in-progress", note: "Signed off Oct 3 · re-opened by the Wave 4–6 re-plan, 2 blocking actions" },
    "import":              { status: "complete",    note: "12 new · 34 changed · 3 removed since last import" },
    "global-mapping":      { status: "complete",    note: "Global rule set locked for Waves 1–3, open for 4–6" },
    "prioritize-plan":     { status: "complete",    note: "6 waves generated and confirmed" },
    "wave-mapping":        { status: "in-progress", note: "23 application overrides · 6 token values outstanding in Waves 5–6" },
    "calibrate":           { status: "complete",    note: "Profile built on 214 sampled assets · 78% predicted auto-approval" },
    /* Not 2,955. Lookups and macros are prerequisites, not translations, and
       Waves 5–6 have not run — see data/translation.js for the arithmetic. */
    "translate":           { status: "in-progress", note: "Waves 1–4 translated · 1,751 of 1,864 runnable · 113 routed to Exceptions" },
    /* 1,751 compared, not 2,955 — see the validation block above. */
    "validate":            { status: "in-progress", note: "1,422 of 1,751 auto-approved · 156 awaiting a human in Waves 3–4" },
    "exceptions":          { status: "in-progress", note: "113 blocked in translation · 135 routed by validation · 4 failed after going live" },
    /* Not "Wave 3 blocked". 858 assets are live, 361 cleared the check and
       are waiting on their wave's open verdicts, and 14 are held. */
    "deploy":              { status: "in-progress", note: "858 assets live in the tenant · 361 cleared and waiting · 14 held by the health check" },
    /* Not "opens once all waves publish", which this said and which is only
       half true. The stage carries two features with two different triggers:
       the organise-and-flag pass runs when a WAVE publishes and has already
       run over Waves 1–2, while the retention policy runs once at PROJECT
       close and has not run at all. Calling the whole stage not-started hid a
       pass that has produced 16 findings nobody has looked at. */
    "govern-close":        { status: "in-progress", note: "858 published assets organised · 7 optimisation flags and 5 duplicates awaiting review · retention policy runs at close" },
  },

  /* --- Attention queue --------------------------------------------------
     Ordered worst-first, and the order changed when the health check stopped
     being described as a wave-level block. The only genuinely critical item
     here is the one where something is already in a customer's tenant and
     already wrong; a held asset was never written and is costing nobody
     anything while it waits. Leading with the held assets, in red, is what
     made a 14-asset throttle finding look more urgent than four live alerts
     paging on-call. */
  blockers: [
    {
      severity: "critical",
      title: "4 published assets failed human review in the tenant",
      detail: "Three were auto-approved and one was an override. All four are live and wrong — the override has been paging on-call since Oct 18.",
      module: "validate",
      action: "Open live review",
    },
    /* Severity dropped from critical to warning along with the wording. 14
       assets held out of a 497-asset wave is a real problem and not a crisis,
       and calling it critical is what made people want the check removed. */
    {
      severity: "warning",
      title: "14 assets held by the pre-deploy health check",
      detail: "Unscoped bucket selection and 90-day default timeframes — throttle-limit risk. Nine of the fourteen are one mapping rule that was never carried into Wave 3. The other 361 assets in the wave cleared the same check.",
      module: "deploy",
      action: "Review held assets",
    },
    {
      severity: "warning",
      title: "Environment readiness gate re-opened for Waves 4–6",
      detail: "3 indexes added by the re-plan have no bucket, and splunk-hf03 has been silent since Oct 7.",
      module: "prepare-environment",
      action: "Review environment actions",
    },
    {
      severity: "warning",
      title: "46 assets contain no-equivalent SPL commands",
      detail: "Flagged at import. These need manual rebuild and have no automated translation path.",
      module: "exceptions",
      action: "Open exception queue",
    },
    {
      severity: "warning",
      title: "156 assets awaiting a validation verdict in Waves 3–4",
      detail: "116 meaningful differences and 40 uncertain results. Each needs a human to override and publish, or send it for rework.",
      module: "validate",
      action: "Open validation triage",
    },
    {
      severity: "info",
      title: "34 assets changed in the source since last import",
      detail: "Re-import detected upstream edits. Review the delta before Wave 4 translation.",
      module: "import",
      action: "Review delta",
    },
  ],

  /* --- Activity feed ---------------------------------------------------- */
  activity: [
    { at: "2026-10-19T08:40:00Z", actor: "DMA",             text: "Pre-deploy health check ran over Wave 3 — 361 cleared, 14 held" },
    { at: "2026-10-18T16:05:00Z", actor: "Claire Dubois",    text: "Resolved 38 exceptions in Treasury Ops via context re-translation" },
    { at: "2026-10-18T07:05:00Z", actor: "Ravi Anand",      text: "Failed Payment Queue Depth Sustained on live review — overrode it on Oct 8 and was wrong" },
    { at: "2026-10-17T11:22:00Z", actor: "DMA",             text: "Validation complete for Wave 3 — 375 auto-approved, 82 routed for review" },
    { at: "2026-10-15T14:10:00Z", actor: "Rosa Delgado", text: "Published Wave 2 (Fraud & Risk, 548 assets) to non-prod" },
    { at: "2026-10-13T09:12:00Z", actor: "DMA",             text: "Re-import complete — 12 new, 34 changed, 3 removed" },
    { at: "2026-10-09T10:30:00Z", actor: "Martin Hale",   text: "Customer signed off on Wave 1 — published to production" },
  ],
};

/* Convenience accessors used across modules. */
DMA.data.waveStatusTone = function (status) {
  return {
    published: "success",
    validating: "info",
    translated: "info",
    mapped: "neutral",
    planned: "neutral",
  }[status] || "neutral";
};

DMA.data.stageStatusTone = function (status) {
  return {
    complete: "success",
    "in-progress": "info",
    blocked: "critical",
    "not-started": "neutral",
  }[status] || "neutral";
};

/* --- Per-wave flow position ----------------------------------------------
   Waves advance independently once Prioritize & Plan has fanned the estate
   out, so a single project-level stage status cannot describe them. The
   sequence below is the wave-scoped leg of the flow; `waveStageStatus` places
   any one wave against it.

   Stage ids are matched against module ids on purpose — the rail asks this
   function about whatever module it is drawing, and gets null for the
   estate-scoped stages that sit outside a wave's life.

   Calibrate sits in the sequence as an ordering position only. It is
   sample-scoped, not wave-scoped — it runs once, blocking the first wave, and
   is advisory after that. No wave is ever "at" Calibrate, which is why the
   rail dims it whenever a wave is selected.
   -------------------------------------------------------------------------- */
DMA.data.WAVE_STAGE_SEQUENCE = ["wave-mapping", "calibrate", "translate", "validate", "exceptions", "deploy"];

/* Where a wave currently sits, keyed off its published status. */
const WAVE_STATUS_STAGE = {
  planned: "wave-mapping",
  mapped: "translate",
  translated: "validate",
  validating: "validate",
  published: null, // through the whole sequence
};

/* There was a `blockedAt` branch here that returned "blocked" for a stage the
   wave had not reached yet, on the theory that a failed gate is worth
   surfacing early. Its only user was Wave 3's pre-deploy health check, and
   that check does not block waves — so the branch is gone with it rather than
   left as a mechanism with nothing honest to point at. If a genuinely
   wave-level gate ever appears, this is where it goes back. */
DMA.data.waveStageStatus = function (wave, stageId) {
  const seq = DMA.data.WAVE_STAGE_SEQUENCE;
  const index = seq.indexOf(stageId);
  if (index === -1) return null;

  const current = WAVE_STATUS_STAGE[wave.status];
  if (current === null) return "complete";

  const currentIndex = seq.indexOf(current);
  if (index < currentIndex) return "complete";
  if (index === currentIndex) return "in-progress";
  return "not-started";
};
