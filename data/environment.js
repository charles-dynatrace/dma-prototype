/* ============================================================================
   Prepare Environment fixtures.
   ----------------------------------------------------------------------------
   This stage answers one question: is the target Dynatrace environment mature
   enough to import into? It is run by the ARCHITECT, not the SSD who ran
   Qualify & Scope, and it runs in parallel with Import & Qualify — the PRD
   guardrail is ~0 added sequential days.

   The maturity model borrows its shape from the Dynatrace Transformation
   Journey (six domains, 1–5 scoring, current vs. required, gaps become owned
   actions) but the content is technical rather than business. A TJ asks
   whether an organisation is ready to adopt observability; this asks whether
   a tenant is ready to receive a migration.

   Owned by modules/prepare-environment. Other modules must not read these.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

DMA.data.environment = {
  /* --- Who runs this ----------------------------------------------------- */
  architect: {
    name: "Viktor Sorensen",
    role: "Migration Architect",
    assignedAt: "2026-09-30T08:00:00Z",
  },

  /* --- The target --------------------------------------------------------- */
  tenant: {
    prod: "wun-prod.apps.dynatrace.com",
    nonProd: "wun-staging.apps.dynatrace.com",
    generation: "Dynatrace SaaS Gen3",
    region: "AWS eu-central-1",
    grailEnabled: true,
    openPipeline: true,
  },

  /* --- Maturity scale ----------------------------------------------------- */
  /* Level 4 is the bar. Not 5 — a migration does not require an optimised
     environment, it requires a sufficient one, and setting the bar at 5 would
     turn this gate into a improvement programme nobody asked for. */
  requiredLevel: 4,
  levels: [
    { level: 1, name: "Unprepared",     detail: "Tenant exists. Nothing else can be assumed." },
    { level: 2, name: "Provisioned",    detail: "Access granted and agents installed, but no data is flowing yet." },
    { level: 3, name: "Ingesting",      detail: "Data is arriving into default storage. No conventions, no mapping discipline." },
    { level: 4, name: "Migration-ready", detail: "Indexes mapped to buckets, pipeline ordered, conventions applied, capacity headroom verified." },
    { level: 5, name: "Optimised",      detail: "Continuously governed — templates versioned, capacity modelled, drift detected automatically." },
  ],

  /* --- Step 1: the assessment --------------------------------------------- */
  /* Scores are computed from the signals beneath them, not entered by hand.
     A domain below the required level is what produces an action. */
  domains: [
    {
      id: "ingest",
      name: "Agent & Data Ingest",
      what: "Is telemetry actually arriving from every source the migrated assets will query?",
      current: 3.4,
      signals: [
        { label: "OneAgent deployed", detail: "148 of 148 in-scope hosts", state: "pass" },
        { label: "Splunk forwarder bridges configured", detail: "3 of 3 heavy forwarders", state: "pass" },
        { label: "Active ingest confirmed", detail: "2 of 3 sources — splunk-hf03 silent for 6 days", state: "fail" },
      ],
    },
    {
      id: "storage",
      name: "Storage & Buckets",
      what: "Does every Splunk index the estate reads from have a Grail bucket to land in?",
      current: 3.6,
      signals: [
        { label: "Index → bucket mapping", detail: "61 of 64 indexes mapped", state: "fail" },
        { label: "Bucket-per-index convention followed", detail: "No shared buckets detected", state: "pass" },
        { label: "Retention aligned to source", detail: "4 buckets overridden to 90 days to match Splunk", state: "pass" },
      ],
    },
    {
      id: "pipeline",
      name: "Pipeline Processing",
      what: "Will ingested data be parsed into the fields the translated DQL expects?",
      current: 4.2,
      signals: [
        { label: "OpenPipeline processors created", detail: "64 processors, one per sourcetype", state: "pass" },
        { label: "Specific-before-generic ordering", detail: "Verified across all 64", state: "pass" },
        { label: "Naming convention applied", detail: "wu_<index>_<sourcetype>", state: "pass" },
      ],
    },
    {
      id: "access",
      name: "Access & Permissions",
      what: "Can the migration team and the published assets' audiences actually reach what they need?",
      current: 3.0,
      manualOnly: true,
      owner: "Platform IAM team",
      signals: [
        { label: "Consultant access to non-prod", detail: "3 consultants provisioned", state: "pass" },
        { label: "SSO group mapping for asset audiences", detail: "Awaiting platform-IAM confirmation", state: "pending" },
        { label: "RBAC policy for published dashboards", detail: "Awaiting platform-IAM confirmation", state: "pending" },
      ],
    },
    {
      id: "capacity",
      name: "Capacity & Limits",
      what: "Will the translated workload fit inside the tenant's ingest and query ceilings?",
      current: 4.1,
      signals: [
        { label: "DPS budget headroom", detail: "Projected 68% of committed budget at full estate", state: "pass" },
        { label: "Query concurrency headroom", detail: "Peak modelled at 42% of tenant limit", state: "pass" },
        { label: "Throttle risk on scheduled alerts", detail: "14 assets flagged — handled at Pre-Deploy Health Check", state: "warn" },
      ],
    },
    {
      id: "topology",
      name: "Environment Topology",
      what: "Is there somewhere safe to publish before production?",
      current: 4.4,
      signals: [
        { label: "Non-prod tenant available", detail: "wun-staging.apps.dynatrace.com", state: "pass" },
        { label: "Production tenant available", detail: "wun-prod.apps.dynatrace.com", state: "pass" },
        { label: "Gen3 + Grail + OpenPipeline confirmed", detail: "All three present", state: "pass" },
      ],
    },
  ],

  /* --- Step 2: what the assessment produced -------------------------------- */
  /* The point of scoring is not the score. Every domain below the bar emits a
     specific, owned action — "which index lacks a bucket", not "not ready". */
  actions: [
    {
      id: "map-new-indexes",
      domain: "storage",
      title: "Create buckets for 3 unmapped indexes",
      detail: "wu_card_auth, wu_sanctions_v2, and wu_fx_rates entered scope with the Wave 4–6 re-plan and have no Grail bucket. Assets querying them will translate but return nothing.",
      owner: "Architect",
      blocking: true,
      status: "open",
      autoFix: true,
      autoFixLabel: "Apply bucket-per-index template",
    },
    {
      id: "restart-hf03",
      domain: "ingest",
      title: "Restore ingest from splunk-hf03",
      detail: "No events received since Oct 7. 41 in-scope assets read from indexes carried by this forwarder. Asset-to-Asset Validation cannot run against a silent source.",
      owner: "Architect",
      blocking: true,
      status: "open",
      autoFix: false,
    },
    {
      id: "iam-sso",
      domain: "access",
      title: "Confirm SSO group mapping and dashboard RBAC",
      detail: "Outside DMA's reach — the platform-IAM team owns access control. Tracked here as a sign-off line so it cannot be forgotten, not auto-checked.",
      owner: "Platform IAM team",
      blocking: true,
      status: "open",
      autoFix: false,
      external: true,
    },
    {
      id: "retention-review",
      domain: "storage",
      title: "Review retention on 7 buckets below source retention",
      detail: "Source indexes retain 90 days; these buckets retain 35. Translated assets with a 90-day default timeframe will return partial results rather than fail.",
      owner: "Architect",
      blocking: false,
      status: "open",
      autoFix: false,
    },
    {
      id: "processor-order",
      domain: "pipeline",
      title: "Re-order 2 generic KV processors behind their specific patterns",
      detail: "Caught and auto-corrected when the best-practice template was applied on Oct 2.",
      owner: "Architect",
      blocking: false,
      status: "resolved",
      resolvedAt: "2026-10-02T11:20:00Z",
      autoFix: false,
    },
  ],

  /* --- Step 3: applied best-practice defaults ------------------------------ */
  template: {
    name: "DMA Splunk Migration Baseline",
    version: "v2.4",
    source: "Migration guide §14, config-managed by PM/ops",
    appliedAt: "2026-10-02T09:05:00Z",
    appliedBy: "Viktor Sorensen",
    items: [
      { id: "bucket-per-index", label: "One Grail bucket per Splunk index",        applied: 61, overrides: 0, note: "The mapping Import & Qualify assumes. 3 indexes still unmapped." },
      { id: "processor-naming", label: "Processor naming — wu_<index>_<sourcetype>", applied: 64, overrides: 0, note: "" },
      { id: "processor-order",  label: "Specific patterns before generic KV",       applied: 64, overrides: 0, note: "2 processors re-ordered on apply." },
      { id: "dpl-patterns",     label: "Recommended DPL patterns per sourcetype",   applied: 58, overrides: 6, note: "6 custom sourcetypes use hand-written DPL — recorded as overrides." },
      { id: "retention",        label: "Default bucket retention — 35 days",        applied: 57, overrides: 4, note: "4 buckets raised to 90 days to match source retention." },
    ],
  },

  /* --- Step 4: the gate ---------------------------------------------------- */
  /* Auto items are derived from signals DMA already computes. Manual items
     exist because some things genuinely cannot be system-verified, and
     defaulting those to pass is how a gate becomes a rubber stamp. */
  gate: {
    originalSignOff: {
      by: "Viktor Sorensen",
      at: "2026-10-03T09:30:00Z",
      scope: "Waves 1–3 · 61 of 64 indexes",
    },
    reopenedAt: "2026-10-13T09:40:00Z",
    reopenedBy: "Wave 4–6 re-plan introduced 3 new indexes",
    items: [
      { id: "agents",   label: "Agents and forwarders deployed",        kind: "auto",   status: "pass",    detail: "148 hosts, 3 forwarder bridges" },
      { id: "flow",     label: "Data flowing from every mapped source", kind: "auto",   status: "fail",    detail: "2 of 3 — splunk-hf03 silent since Oct 7" },
      { id: "buckets",  label: "Every in-scope index has a bucket",     kind: "auto",   status: "fail",    detail: "61 of 64 — 3 added by the Wave 4–6 re-plan" },
      { id: "template", label: "Best-practice template applied",        kind: "auto",   status: "pass",    detail: "v2.4 applied Oct 2 · 10 overrides recorded" },
      { id: "capacity", label: "Capacity headroom verified",            kind: "auto",   status: "pass",    detail: "68% of DPS budget at full estate" },
      { id: "iam",      label: "IAM / access control confirmed",        kind: "manual", status: "pending", detail: "Platform IAM team — SSO group mapping and dashboard RBAC", owner: "Platform IAM team" },
      { id: "signoff",  label: "Architect sign-off",                    kind: "manual", status: "pending", detail: "Unlocks once every item above passes",                   owner: "Viktor Sorensen" },
    ],
  },

  /* --- The parallel track -------------------------------------------------- */
  /* The stage's guardrail metric is ~0 added sequential days, so the screen
     shows what it is running alongside rather than implying a queue. */
  parallel: {
    stage: "Import & Qualify",
    note: "Environment checks run alongside import, not after it. Nothing here extends the critical path.",
    addedDays: 0,
  },
};

/* Domain score vs. the bar. A domain is "met" at or above requiredLevel. */
DMA.data.environment.domainGap = function (domain) {
  return Number((DMA.data.environment.requiredLevel - domain.current).toFixed(1));
};

DMA.data.environment.overallLevel = function () {
  const d = DMA.data.environment.domains;
  return Number((d.reduce((sum, x) => sum + x.current, 0) / d.length).toFixed(1));
};

DMA.data.environment.openActions = function (blockingOnly = false) {
  return DMA.data.environment.actions.filter(
    (a) => a.status === "open" && (!blockingOnly || a.blocking)
  );
};

DMA.data.environment.gateBlockers = function () {
  return DMA.data.environment.gate.items.filter((i) => i.status !== "pass");
};
