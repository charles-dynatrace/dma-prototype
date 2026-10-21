/* ============================================================================
   Qualify & Scope fixtures.
   ----------------------------------------------------------------------------
   This stage is a PRE-SALES artifact, not a delivery one. An SSD opens a
   project to size an opportunity, connects the customer's Splunk, and leaves
   with an LOE report to take into a client conversation. Everything here is
   shaped by that: the output is an estimate and a scope decision, not a
   migrated asset.

   Owned by modules/qualify-scope. Other modules must not read these fixtures.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

DMA.data.qualify = {
  /* --- Step 1: how the source got connected ----------------------------- */
  /* The fork that matters most in the whole stage. Choosing the CLI to avoid
     a credential conversation is cheap now and expensive later, so the cost
     has to be legible at the moment of choice rather than at Validate. */
  pathways: [
    {
      id: "connector",
      name: "Universal Source Connector",
      tagline: "Credentialed — DMA connects to Splunk directly",
      feature: "source-connector",
      recommended: true,
      how: "Enter Splunk credentials in DMA. DMA reads the inventory over the API and keeps reading it for the life of the project.",
      gains: [
        "Asset-to-Asset Validation — translated assets are compared against live Splunk results",
        "Delta re-import, so the scope tracks the estate as it keeps changing",
        "Automated environment readiness checks against the target tenant",
        "LOE estimate at full confidence (±20%)",
      ],
      costs: ["Requires a credential conversation with the customer before any numbers exist"],
    },
    {
      id: "cli",
      name: "CLI export (no credentials)",
      tagline: "Non-credentialed — customer runs a script and sends a .tar.gz",
      recommended: false,
      how: "The customer runs the existing export script themselves. DMA ingests the resulting .tar.gz and estimates from the contents.",
      gains: [
        "Full inventory and complexity assessment from the archive",
        "LOE estimate, at a wider band (±35%)",
        "No credential conversation needed to produce a number",
      ],
      costs: [
        "No Asset-to-Asset Validation — no customer data ever flows through DMA, so there is nothing to compare a translation against",
        "Point-in-time snapshot only — no delta or version history across imports",
        "No automated environment readiness checks",
        "Any re-scope means asking the customer to re-run and re-send the export",
      ],
    },
  ],

  /* The golden path took the credentialed route. */
  connection: {
    pathway: "connector",
    product: "Splunk Enterprise 9.1.2",
    deployment: "On-premises · 3 search heads, 12 indexers",
    endpoint: "splunk-sh01.acme.internal:8089",
    authMethod: "Service account + token",
    account: "svc-dma-readonly",
    scopeGranted: "Read-only: saved searches, dashboards, lookups, macros, alert definitions",
    connectedAt: "2026-09-29T14:22:00Z",
    lastSync: "2026-10-13T09:12:00Z",
    connectMinutes: 11, // against the <15 min launch target
  },

  /* --- Step 2: what discovery found ------------------------------------- */
  discovery: {
    discovered: 3088,
    inScope: 2955,
    excluded: 133,
    sourcetypes: 64,
    applications: 19,
    oldestAsset: "2017-03-02",
    byType: [
      { type: "Dashboards",     discovered: 441,  excluded: 29, detail: "3,002 panels across 19 apps" },
      { type: "Alerts",         discovered: 1262, excluded: 58, detail: "scheduled + real-time" },
      { type: "Saved searches", discovered: 1010, excluded: 42, detail: "" },
      { type: "Lookups",        discovered: 245,  excluded: 4,  detail: "" },
      { type: "Macros",         discovered: 130,  excluded: 0,  detail: "" },
    ],
  },

  /* --- Step 3: no-equivalent flagging ----------------------------------- */
  /* The SSD-facing output of this stage. Two verdicts, deliberately kept
     apart: `blocked` leaves the migration scope entirely, `rework` stays in
     scope but buys manual hours. Collapsing them into one "unsupported" count
     is what makes an estimate wrong — they have opposite cost shapes. */
  noEquivalent: [
    {
      id: "summary-index",
      feature: "Summary indexing",
      kind: "Capability",
      verdict: "blocked",
      assets: 18,
      detail: "Pre-aggregated summary indexes have no DQL counterpart. The underlying question has to be re-modelled against raw data or a Grail view.",
      path: "Out of scope for automated migration — rebuild with the customer post-cutover.",
    },
    {
      id: "realtime-alerts",
      feature: "Real-time per-result alerts",
      kind: "Alert type",
      verdict: "blocked",
      assets: 14,
      detail: "Splunk fires per matching event. Dynatrace evaluates on a schedule, so per-result semantics cannot be reproduced faithfully.",
      path: "Out of scope — candidates for Davis anomaly detection instead, scoped separately.",
    },
    {
      id: "scripted-lookups",
      feature: "External scripted lookups",
      kind: "Capability",
      verdict: "blocked",
      assets: 9,
      detail: "Lookups backed by customer Python scripts execute arbitrary code at search time. Nothing in DQL corresponds to this.",
      path: "Out of scope — the enrichment must move upstream into the pipeline.",
    },
    {
      id: "map-command",
      feature: "map command",
      kind: "SPL command",
      verdict: "blocked",
      assets: 5,
      detail: "Row-wise subsearch iteration. No DQL equivalent and no reliable rewrite pattern.",
      path: "Out of scope — manual rebuild, estimated separately.",
    },
    {
      id: "transaction",
      feature: "transaction command",
      kind: "SPL command",
      verdict: "rework",
      assets: 63,
      detail: "No direct equivalent, but event grouping can be expressed with a documented DQL pattern. Translation produces a draft that a consultant must confirm.",
      path: "Stays in scope. Expect manual review on every one.",
    },
    {
      id: "streamstats",
      feature: "streamstats with complex windows",
      kind: "SPL command",
      verdict: "rework",
      assets: 41,
      detail: "Simple windows translate cleanly. Multi-field resets and time-bounded windows need hand-checking.",
      path: "Stays in scope. Routed to manual review by validation.",
    },
    {
      id: "datamodel-accel",
      feature: "Accelerated data models",
      kind: "Data model",
      verdict: "rework",
      assets: 22,
      detail: "The model itself maps to a Grail view, but acceleration semantics and the resulting performance profile do not carry over.",
      path: "Stays in scope. Needs a performance conversation before go-live.",
    },
  ],

  /* --- Step 4: scope decisions ------------------------------------------ */
  exclusions: [
    {
      id: "dead",
      label: "Dead / no-data assets",
      assets: 87,
      rule: "No results returned in the last 90 days",
      feature: "dead-asset-gate",
      overridable: true,
      note: "Auto-excluded by default. PM override available for seasonal or DR assets that are dormant on purpose.",
    },
    {
      id: "no-equivalent",
      label: "No-equivalent capability",
      assets: 46,
      rule: "Contains a capability with no DQL path",
      feature: "no-equivalent-preflag",
      overridable: false,
      note: "Cannot be automated. Listed individually in the LOE report so the customer sees exactly what is not coming across.",
    },
  ],

  /* --- Step 5: level of effort ------------------------------------------ */
  loe: {
    confidence: 20, // ± percent, credentialed pathway
    cliConfidence: 35,
    manualBaselineHours: 1675,
    dmaAssistedHours: 316,
    hoursAvoided: 1359,
    automatedEquivalentHours: 1420,
    breakdown: [
      { workstream: "Exception review & re-translation", hours: 168, driver: "555 assets expected to need a human" },
      { workstream: "Mapping configuration",             hours: 44,  driver: "19 applications, bucket + naming rules" },
      { workstream: "Deployment & wave coordination",    hours: 42,  driver: "6 waves across non-prod and prod" },
      { workstream: "Environment prep & validation",     hours: 38,  driver: "Tenant, buckets, pipelines, readiness sign-off" },
      { workstream: "No-equivalent rework",              hours: 24,  driver: "126 assets flagged for manual confirmation" },
    ],
    assumptions: [
      "Assumes the ≥70% launch auto-approval rate. Every point above that removes roughly 6 hours of review.",
      "Excludes the 46 no-equivalent assets entirely — rebuilding those is a separate statement of work.",
      "Assumes the customer provides an environment owner for readiness checks within the first week.",
    ],
  },
};

DMA.data.qualify.noEquivalentTotals = function () {
  return DMA.data.qualify.noEquivalent.reduce(
    (acc, n) => {
      acc[n.verdict] += n.assets;
      return acc;
    },
    { blocked: 0, rework: 0 }
  );
};
