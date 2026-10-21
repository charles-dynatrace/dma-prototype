/* ============================================================================
   DATA: Govern & Close — organise what shipped, flag what could be better,
         and clean up what the migration itself left behind
   ----------------------------------------------------------------------------
   Owned by modules/govern-close.

   ----------------------------------------------------------------------------
   TWO FEATURES, TWO TRIGGERS, AND THAT IS THE WHOLE SHAPE OF THIS STAGE

   This stage carries exactly two roadmap items, both P3, and the single most
   important thing about them is that they do not fire at the same moment:

     Optimization-Opportunity Flagging   runs per wave, when that wave goes
                                         live. Waves 1 and 2 are live, so it
                                         has already run twice.
     Retention / Close-Out Policy        runs once, at PROJECT close. The
                                         project is open. It has never run.

   Building this stage as one screen that "opens when the project closes"
   would have been wrong in both directions: it would hide a pass that has
   already produced 16 findings, and it would imply the cleanup is a live
   capability when it is a preview of one.

   So the stage is half-populated by design, and says which half and why.

   ----------------------------------------------------------------------------
   THE STAGE DOES NOT PERFORM THE WORK IT NAMES

   Both PRDs are unusually blunt about this and it is worth not softening:

     - Flagging flags. "Actually performing the optimization work itself
       (rewriting an inefficient query, switching an asset from logs to
       native) ... is a services engagement or separate follow-on work."
     - Dedupe never merges. "Likely-duplicate assets are flagged for review,
       not automatically merged or deleted."
     - Nothing is optimised without a human. "No optimization action is taken
       automatically — every flag requires explicit human review and action."

   There is no Fix button anywhere. A one-click "optimise" would be the
   easiest thing to demo here and the most dishonest thing on the screen.

   The two features answer that constraint differently, and the difference is
   the point:

     Dedupe        keeps its review controls. A duplicate verdict is a
                   judgement about the customer's estate that DMA is holding
                   the evidence for, and it stays in the record.
     Optimisation  has no controls at all. Its findings leave as a report
                   that Professional Services reads with the customer. "Every
                   flag requires explicit human review" never said the review
                   happens in DMA, and an accept/dismiss queue in here was
                   this product implying it owns a backlog the PRD hands to a
                   services engagement.

   ----------------------------------------------------------------------------
   QUERY EFFICIENCY IS TWO FLAGS, NOT ONE

   The Optimization PRD calls today's "query efficiency" an "unspecified
   catch-all" and makes the split an acceptance criterion in its own words:
   the two patterns must be "their own distinct, labeled flag types — not
   folded into a single generic 'query efficiency' flag."

   Both come from the Globex post-mortem (August 2026):

     parse-before-filter   DQL that parses and extracts fields BEFORE
                           filtering, instead of filtering first. The cost is
                           paid on every row the filter would have discarded.
     repeated-parse        fields re-parsed out of raw data (e.g. JSON) at
                           query time, on every run, when they could be
                           extracted once upstream in the ingest pipeline.
                           The fix is not in the query at all.

   They are two different fixes owned by two different people — one is a
   rewrite, one is an OpenPipeline change — so collapsing them into one row
   would produce a flag nobody can action.

   ----------------------------------------------------------------------------
   A MIGRATION ARTIFACT IS NOT A MIGRATED ASSET

   The Retention PRD draws one line and the whole feature sits on it. In
   scope: the things that exist only to support the migration — the Universal
   Source Connector credential, staging buckets, intermediate export files.
   Out of scope: retention for the migrated production assets themselves,
   which is the customer's governance question about their own tenant and
   emphatically not DMA's to decide.

   So this file inventories eight artifacts DMA itself created, and none of
   the 858 assets it published.

   ----------------------------------------------------------------------------
   DERIVED, NOT TYPED

   The published population comes from `DMA.data.deploy`, the applications and
   wave placement from `DMA.data.planning`, the connector credential from
   `DMA.data.qualify`, and the close gate from all of them plus
   `DMA.data.project`. `assertTotals()` checks the joins on load.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

(function () {
  "use strict";

  const G = (DMA.data.governClose = {});

  const PR = () => DMA.data.project;
  const DP = () => DMA.data.deploy;
  const PL = () => DMA.data.planning;
  const Q = () => DMA.data.qualify;

  /* --- What "closeout" is allowed to touch ---------------------------------
     Five classes. The fifth one — version history — is the interesting one:
     it IS a migration artifact by any definition, and it is also the only
     record of what was translated into a customer's production tenant. The
     default for it is retain, not delete, and that asymmetry is the reason
     this is a policy with classes rather than a delete button. ----------- */
  G.ARTIFACT_CLASSES = {
    credential: {
      id: "credential",
      label: "Source credentials & tokens",
      icon: "lock",
      what: "Anything entered into the Universal Source Connector to read the source estate.",
      why: "A read-only service token that outlives the project it was issued for is a standing grant nobody is reviewing.",
      tone: "critical",
    },
    bucket: {
      id: "bucket",
      label: "Temporary buckets",
      icon: "database",
      what: "Grail buckets created to stage migration data, not to serve a migrated asset.",
      why: "Billed storage holding data no published asset reads.",
      tone: "warning",
    },
    staging: {
      id: "staging",
      label: "Staging data",
      icon: "layers",
      what: "Intermediate state written during translation and validation — comparison result sets, cached source responses.",
      why: "Contains customer query output. Keeping it past the project is the largest data-residency surface the migration creates.",
      tone: "critical",
    },
    export: {
      id: "export",
      label: "Export artifacts",
      icon: "download",
      what: "Files produced for humans: inventory exports, deployment records, LOE packs.",
      why: "Usually harmless and occasionally the thing a customer's audit asks for a year later. The common case for an exception.",
      tone: "info",
    },
    history: {
      id: "history",
      label: "Translation & version history",
      icon: "gitBranch",
      what: "Delta & Versioning's record of every translation and every rollback.",
      why: "The only evidence of how a live production asset came to say what it says. Default is retain, not delete.",
      tone: "neutral",
    },
  };

  /* --- The policy ----------------------------------------------------------
     Config-managed, per the PRD — it is a setting an organisation makes once,
     not a decision a consultant makes per project. Timings are relative to
     the close date because there is no close date yet. --------------------- */
  G.POLICY = {
    name: "DMA Migration-Artifact Retention Baseline",
    version: "v1.0",
    source: "Config-managed by PM/ops · applies to every DMA project",
    managedBy: "Dynatrace Professional Services",
    rules: [
      { class: "credential", action: "revoke",  offsetDays: 0,   label: "Revoke at close",            detail: "The token is invalidated at the source. Re-connecting a reopened project means a new credential conversation." },
      { class: "staging",    action: "delete",  offsetDays: 0,   label: "Delete at close",            detail: "Comparison result sets and cached source responses are destroyed with the project." },
      { class: "bucket",     action: "delete",  offsetDays: 7,   label: "Delete 7 days after close",  detail: "A week of grace, because a bucket deleted the same afternoon a project closes is the one somebody needed." },
      { class: "export",     action: "delete",  offsetDays: 30,  label: "Delete 30 days after close", detail: "Long enough to be downloaded, short enough not to become a filing cabinet." },
      { class: "history",    action: "retain",  offsetDays: 365, label: "Retain 12 months",           detail: "Deliberately not deleted at close. Published assets outlive the project that published them." },
    ],
    ruleFor(classId) {
      return this.rules.find((r) => r.class === classId) || null;
    },
  };

  G.ACTION_TONE = { revoke: "critical", delete: "warning", retain: "success" };

  /* --- The artifacts this project has actually accumulated ------------------
     Eight rows. Every one of them exists because a stage earlier in this
     prototype created it, which is the point — "what counts as a migration
     artifact" is a question with a concrete answer per project, and the PRD
     names not having that inventory as the first complexity driver. ------- */
  G.artifacts = [
    {
      id: "ART-01",
      class: "credential",
      name: "svc-dma-readonly",
      detail: "Service account + token on splunk-sh01.acme.internal:8089. Read-only across saved searches, dashboards, lookups, macros and alert definitions.",
      createdAt: "2026-09-29T14:22:00Z",
      createdBy: "Universal Source Connector setup",
      stage: "qualify-scope",
      inUse: true,
      inUseWhy: "Delta re-import still reads through this token. Revoking it now stops the scope tracking the estate.",
      size: null,
    },
    {
      id: "ART-02",
      class: "credential",
      name: "DMA → wun-staging write token",
      detail: "Write scope on the non-prod tenant, issued so Deploy could publish Wave 2.",
      createdAt: "2026-10-03T09:35:00Z",
      createdBy: "Prepare Environment sign-off",
      stage: "prepare-environment",
      inUse: true,
      inUseWhy: "Waves 3–6 publish through this token.",
      size: null,
    },
    {
      id: "ART-03",
      class: "bucket",
      name: "dma_staging_wun_2041",
      detail: "Temporary Grail bucket holding source responses captured for Asset-to-Asset Validation. No published asset queries it.",
      createdAt: "2026-10-01T11:00:00Z",
      createdBy: "Validation setup",
      stage: "validate",
      inUse: true,
      inUseWhy: "Waves 3 and 4 are still being validated against it.",
      size: "41.2 GB",
    },
    {
      id: "ART-04",
      class: "bucket",
      name: "dma_calibration_sample_2041",
      detail: "Holds the 214-asset calibration sample and its scored results.",
      createdAt: "2026-10-10T08:15:00Z",
      createdBy: "Calibrate",
      stage: "calibrate",
      inUse: false,
      inUseWhy: null,
      size: "2.8 GB",
    },
    {
      id: "ART-05",
      class: "staging",
      name: "Comparison result sets",
      detail: "1,751 paired result sets — the Splunk output and the Dynatrace output for every validated asset. Customer transaction data.",
      createdAt: "2026-10-05T00:00:00Z",
      createdBy: "Asset-to-Asset Validation",
      stage: "validate",
      inUse: true,
      inUseWhy: "156 verdicts are still open and a reviewer needs the comparison to decide.",
      size: "18.6 GB",
    },
    {
      id: "ART-06",
      class: "export",
      name: "Deployment record — Wave 1",
      detail: "Signed publish record for the production release on Oct 9. Names every asset, its destination and its approver.",
      createdAt: "2026-10-09T10:30:00Z",
      createdBy: "Deploy",
      stage: "deploy",
      inUse: false,
      inUseWhy: null,
      size: "1.4 MB",
      /* The PRD's demo scenario turns on exactly this: one artifact flagged
         for retention per a customer-configured exception, rather than an
         all-or-nothing deletion. It is pre-configured here because an
         exception nobody has created yet cannot demonstrate that the path
         exists. */
      exception: {
        reason: "Group Internal Audit requires the production release record for 7 years. Deleting it at close + 30 days would destroy the only signed copy.",
        until: "2033-10-09",
        by: "Martin Hale",
        at: "2026-10-09T16:40:00Z",
      },
    },
    {
      id: "ART-07",
      class: "export",
      name: "Inventory export — 2026-10-13 re-import",
      detail: "Full 2,955-asset inventory snapshot with the 12 new / 34 changed / 3 removed delta.",
      createdAt: "2026-10-13T09:12:00Z",
      createdBy: "Import & Qualify",
      stage: "import",
      inUse: false,
      inUseWhy: null,
      size: "22.1 MB",
    },
    {
      id: "ART-08",
      class: "history",
      name: "Delta & Versioning history",
      detail: "Every translation, every re-translation and every rollback across 1,864 translated assets.",
      createdAt: "2026-10-04T00:00:00Z",
      createdBy: "Translate",
      stage: "translate",
      inUse: true,
      inUseWhy: "Waves 3–6 have not finished translating.",
      size: "6.9 GB",
    },
  ];

  G.artifactById = (id) => G.artifacts.find((a) => a.id === id) || null;

  /* --- The published population --------------------------------------------
     Read through Deploy rather than restated. The flagging pass can only see
     what is live, which is why Wave 3's 361 cleared-and-waiting assets are
     not in any number on this stage. --------------------------------------- */
  G.publishedWaves = function () {
    return PR()
      .waves.map((w) => {
        const r = DP().waveDeploy(w.id);
        return r && r.reached && r.live > 0 ? { wave: w, live: r.live, tenant: r.tenant } : null;
      })
      .filter(Boolean);
  };

  G.published = () => G.publishedWaves().reduce((a, r) => a + r.live, 0);

  /* --- Groups ---------------------------------------------------------------
     One group per application present in a published wave. The live counts
     are apportioned from each application's share of its wave rather than
     typed, so this can never disagree with planning.js or with Deploy. The
     remainder lands on the largest application in the wave, which keeps the
     groups summing to the published population exactly. ------------------- */
  G.groups = function () {
    const out = [];
    G.publishedWaves().forEach((r) => {
      const apps = PL().applications.filter((a) => PL().placement[a.id] === r.wave.id);
      if (!apps.length) return;
      const planned = apps.reduce((a, x) => a + x.assets, 0);
      const rows = apps.map((a) => ({
        id: a.id,
        name: a.name,
        slug: a.slug,
        tier: a.tier,
        wave: r.wave.id,
        tenant: r.tenant,
        live: Math.floor((a.assets / planned) * r.live),
      }));
      const drift = r.live - rows.reduce((a, x) => a + x.live, 0);
      rows.sort((a, b) => b.live - a.live);
      if (drift) rows[0].live += drift;
      out.push(...rows);
    });
    return out.sort((a, b) => (a.wave === b.wave ? b.live - a.live : a.wave - b.wave));
  };

  /* --- Tag rules ------------------------------------------------------------
     Four rules. Three apply to everything because DMA already knows the
     answer; the fourth applies to nothing because it needs a mapping only the
     customer has. Reporting 100% tag coverage while a rule sits at zero would
     be the easy lie here. -------------------------------------------------- */
  G.tagRules = [
    { id: "owner",   key: "dt.owner",            from: "Application owner, as placed at Prioritize & Plan",       derivable: true },
    { id: "source",  key: "dma.source.index",    from: "The Splunk index the asset was translated from",          derivable: true },
    { id: "wave",    key: "dma.wave",            from: "The wave the asset published in",                          derivable: true },
    { id: "cost",    key: "dt.cost_center",      from: "Customer finance mapping — not derivable from the source estate", derivable: false,
      gap: "No cost-centre mapping has been supplied. The rule is configured and applies to nothing, which is reported as a gap rather than rounded up to 100%." },
  ];

  G.tagCoverage = function () {
    const n = G.published();
    return G.tagRules.map((r) => Object.assign({}, r, { applied: r.derivable ? n : 0, of: n }));
  };

  /* --- Dedupe candidates ----------------------------------------------------
     Seven clusters over sixteen assets. Two are already dispositioned so that
     both outcomes are visible in the fixture, and three are NOT duplicates —
     the PRD names false-positive dedupe as a complexity driver, and a queue
     where every row is a genuine duplicate would quietly teach a reviewer to
     click confirm without reading.

     `kind` is the truth; `state` is what a human has decided so far. They are
     separate fields because the whole value of the review step is that the
     system does not get to be right by default. ---------------------------- */
  G.dedupe = [
    {
      id: "DUP-01",
      wave: 1,
      app: "payments-core",
      kind: "duplicate",
      confidence: 97,
      title: "Two settlement latency dashboards with identical panels",
      basis: "Same 11 panels, same DQL in all 11, same default timeframe. Authored four months apart by two people in the same team.",
      assets: [
        { id: "DS-1142", name: "Settlement Latency — Corridor View", type: "Dashboard" },
        { id: "DS-1318", name: "Corridor Settlement Latency", type: "Dashboard" },
      ],
      state: "open",
    },
    {
      id: "DUP-02",
      wave: 1,
      app: "payments-core",
      kind: "duplicate",
      confidence: 94,
      title: "Three saved searches resolving to the same query",
      basis: "Identical DQL after macro expansion. The three Splunk originals differed only in the macro they called, and all three macros expanded the same way.",
      assets: [
        { id: "SS-0441", name: "auth_decline_rate_hourly", type: "Saved search" },
        { id: "SS-0607", name: "hourly_auth_declines", type: "Saved search" },
        { id: "SS-0912", name: "declines_by_hour_v2", type: "Saved search" },
      ],
      state: "open",
    },
    {
      id: "DUP-03",
      wave: 2,
      app: "fraud-risk",
      kind: "intentional",
      confidence: 88,
      title: "Four region-scoped fraud dashboards",
      basis: "Identical panel structure. Each filters to one region and is owned by that region's on-call rota.",
      why: "Structurally identical and operationally distinct. Consolidating them would put four rotas on one dashboard.",
      assets: [
        { id: "DS-2201", name: "Fraud Signals — EMEA", type: "Dashboard" },
        { id: "DS-2202", name: "Fraud Signals — AMER", type: "Dashboard" },
        { id: "DS-2203", name: "Fraud Signals — APAC", type: "Dashboard" },
        { id: "DS-2204", name: "Fraud Signals — LATAM", type: "Dashboard" },
      ],
      state: "open",
    },
    {
      id: "DUP-04",
      wave: 2,
      app: "sanctions",
      kind: "duplicate",
      confidence: 91,
      title: "Two OFAC screening throughput alerts",
      basis: "Same condition, same threshold, same evaluation window. One notifies a distribution list that no longer exists.",
      assets: [
        { id: "AL-0318", name: "OFAC Screening Throughput Drop", type: "Alert" },
        { id: "AL-0455", name: "Screening Throughput — Sustained Drop", type: "Alert" },
      ],
      state: "open",
    },
    {
      id: "DUP-05",
      wave: 2,
      app: "card-services",
      kind: "intentional",
      confidence: 79,
      title: "Prepaid balance enquiry — two thresholds",
      basis: "Same condition on the same signal at 2% and 5%.",
      why: "A warn and a page on one signal. This is how a two-tier alert is built, not a mistake.",
      assets: [
        { id: "AL-0612", name: "Balance Enquiry Failure Rate — Warn", type: "Alert" },
        { id: "AL-0613", name: "Balance Enquiry Failure Rate — Page", type: "Alert" },
      ],
      state: "open",
    },
    {
      id: "DUP-06",
      wave: 1,
      app: "platform-shared",
      kind: "duplicate",
      confidence: 96,
      title: "Routing lookup imported twice",
      basis: "Byte-identical content under two names. Both were referenced, which is why neither was caught as dead at import.",
      assets: [
        { id: "LK-0077", name: "corridor_routing_map", type: "Lookup" },
        { id: "LK-0131", name: "routing_corridors", type: "Lookup" },
      ],
      state: "confirmed",
      decidedBy: "Rosa Delgado",
      decidedAt: "2026-10-16T11:05:00Z",
      note: "Consolidated onto corridor_routing_map. Nine assets repointed by hand after closeout flagged it.",
    },
    {
      id: "DUP-07",
      wave: 1,
      app: "payments-core",
      kind: "intentional",
      confidence: 72,
      title: "Executive and operational views of authorisation volume",
      basis: "Shared headline metric and overlapping DQL across 3 of 9 panels.",
      why: "Different audiences, different cadence. A 72% signal was never strong enough to call this a duplicate.",
      assets: [
        { id: "DS-1007", name: "Payments — Executive Summary", type: "Dashboard" },
        { id: "DS-1044", name: "Authorisation Volume — Ops", type: "Dashboard" },
      ],
      state: "dismissed",
      decidedBy: "Claire Dubois",
      decidedAt: "2026-10-16T14:20:00Z",
      note: "Not a duplicate. Left as-is.",
    },
  ];

  /* --- Flag types -----------------------------------------------------------
     Four labelled types. The two in the middle are the Globex patterns and
     they are separate rows on purpose — it is an acceptance criterion, and
     more usefully they have different owners. A parse-before-filter flag is
     fixed by rewriting a query; a repeated-parse flag is fixed in
     OpenPipeline by somebody who may never look at the query. ------------- */
  G.FLAG_TYPES = {
    "native-vs-logs": {
      id: "native-vs-logs",
      label: "Native signal available",
      family: "Cost",
      icon: "zap",
      tone: "warning",
      what: "The asset queries logs for something Dynatrace already emits as a native metric or trace.",
      fix: "Repoint the asset at the native signal.",
      owner: "Professional Services",
      source: "Target-state Close & Govern — flag cost/usability optimization targets",
    },
    "parse-before-filter": {
      id: "parse-before-filter",
      label: "Parses before it filters",
      family: "Query efficiency",
      icon: "filter",
      tone: "warning",
      what: "The DQL parses and extracts fields before narrowing the row set, so the parse is paid on every row the filter would have thrown away.",
      fix: "Move the filter ahead of the parse. Same result, a fraction of the rows.",
      owner: "Professional Services",
      source: "Globex post-mortem, August 2026 — pattern 1 of 2",
      globex: true,
    },
    "repeated-parse": {
      id: "repeated-parse",
      label: "Re-parses raw data every run",
      family: "Query efficiency",
      icon: "refresh",
      tone: "warning",
      what: "Fields are extracted out of raw payloads (JSON, KV) at query time, on every execution, when they could be extracted once at ingest.",
      fix: "Extract the fields upstream in the OpenPipeline processor. The query stops parsing entirely.",
      owner: "Architect — this one is not a query change",
      source: "Globex post-mortem, August 2026 — pattern 2 of 2",
      globex: true,
    },
    "unused-since-publish": {
      id: "unused-since-publish",
      label: "Nobody has opened it",
      family: "Usability",
      icon: "eye",
      tone: "info",
      what: "Live since its wave published and never queried by a human. Either it migrated something already dead, or its audience does not know it moved.",
      fix: "Confirm the audience, or retire it. A migrated asset nobody opens is a migration that did not land.",
      owner: "Customer / Professional Services",
      source: "Target-state Close & Govern — flag cost/usability optimization targets",
    },
  };

  G.flagType = (id) => G.FLAG_TYPES[id] || null;

  /* --- The flags ------------------------------------------------------------
     Nine, over the 858 live assets. The PRD's outcome metric is deliberately
     "≥1 flagged opportunity per project, tracked as a count not a target" —
     so this is not sized to impress, and `impact` is written as an observed
     measurement rather than a projected saving nobody can bank.

     NO FLAG CARRIES A VERDICT. These used to have `state: open | accepted |
     dismissed` with a decider and a note, because the stage used to run a
     triage queue. It does not any more — the findings leave DMA as a report
     that Professional Services reads with the customer, and a verdict field
     would be this product recording a decision it is not in the room for.

     Two of them used to carry a decision note worth keeping, so the substance
     moved into `impact` where it reads as a caveat on the finding rather than
     as somebody's ruling: OPT-07 shares a rewrite with OPT-01, and OPT-09 is
     a correct flag that is probably the wrong thing to act on. The second is
     the more important one to keep — a report that cannot say "this may be
     deliberate" trains its reader to action every row. ---------------------- */
  G.flags = [
    {
      id: "OPT-01",
      type: "parse-before-filter",
      wave: 2,
      app: "fraud-risk",
      asset: { id: "AL-0291", name: "High-Risk Corridor Score Spike", type: "Alert" },
      detail: "Parses the full transaction payload, then filters to three corridors. 94% of parsed rows are discarded by the next command.",
      evidence: "parse ... | fields ... | filter corridor in (\"US-MX\", \"US-PH\", \"AE-IN\")",
      impact: "Runs every 5 minutes against a 7-day window. The heaviest scheduled query in Wave 2.",
    },
    {
      id: "OPT-02",
      type: "repeated-parse",
      wave: 2,
      app: "fraud-risk",
      asset: { id: "DS-2240", name: "Fraud Scoring — Model Drift", type: "Dashboard" },
      detail: "Six panels each extract the same four fields out of the raw JSON scoring payload at query time.",
      evidence: "Four fields — model_version, score_band, feature_hash, decision — re-parsed in six panels, on every refresh.",
      impact: "The fields are stable and present on every event. Extracting them in the wu_fraud_scoring processor removes the parse from all six panels at once.",
    },
    {
      id: "OPT-03",
      type: "native-vs-logs",
      wave: 1,
      app: "payments-core",
      asset: { id: "DS-1090", name: "Payment Gateway Host Health", type: "Dashboard" },
      detail: "Reads CPU, memory and disk out of OS log lines. OneAgent reports all three natively on the same hosts.",
      evidence: "Eight panels querying wu_platform_os for metrics already in dt.host.cpu.usage and friends.",
      impact: "A faithful translation of a Splunk dashboard that only existed because Splunk had no host metrics.",
    },
    {
      id: "OPT-04",
      type: "parse-before-filter",
      wave: 1,
      app: "platform-shared",
      asset: { id: "SS-0233", name: "identity_lookup_failures_daily", type: "Saved search" },
      detail: "Extracts eleven fields before applying a status filter that keeps roughly one row in forty.",
      evidence: "parse ... | parse ... | filter status != \"ok\"",
      impact: "Daily, over 24 hours of identity traffic.",
    },
    {
      id: "OPT-05",
      type: "native-vs-logs",
      wave: 2,
      app: "sanctions",
      asset: { id: "AL-0377", name: "Screening Service Unreachable", type: "Alert" },
      detail: "Infers service availability from the absence of log lines. The service is instrumented and reports availability directly.",
      evidence: "Absence-of-signal alerting over wu_sanctions, where dt.service availability exists.",
      impact: "Absence-of-signal is the alert class most likely to go quiet when ingest breaks — which is the moment it is needed.",
    },
    {
      id: "OPT-06",
      type: "repeated-parse",
      wave: 1,
      app: "payments-core",
      asset: { id: "SS-0188", name: "corridor_fee_breakdown", type: "Saved search" },
      detail: "Re-parses the fee object out of the raw settlement payload on every run.",
      evidence: "Nested JSON parsed at query time to reach three leaf fields.",
      impact: "Shares a processor with OPT-02's payload. One OpenPipeline change covers both.",
    },
    {
      id: "OPT-07",
      type: "parse-before-filter",
      wave: 2,
      app: "card-services",
      asset: { id: "DS-2310", name: "Prepaid Issuance Funnel", type: "Dashboard" },
      detail: "Three of nine panels parse the issuance event before filtering to a single card programme.",
      evidence: "parse ... | filter programme == \"ACME-PREPAID-EU\"",
      impact: "Interactive dashboard. Cost is paid per viewer, per refresh. Same rewrite as OPT-01 — the two are worth scheduling together.",
    },
    {
      id: "OPT-08",
      type: "unused-since-publish",
      wave: 1,
      app: "platform-shared",
      asset: { id: "DS-1260", name: "Legacy Batch Window Monitor", type: "Dashboard" },
      detail: "Live for 12 days. Zero queries by any user.",
      evidence: "No recorded query against this asset since it published on Oct 9.",
      impact: "The batch window it monitors was decommissioned in the source estate before the migration started.",
    },
    {
      id: "OPT-09",
      type: "native-vs-logs",
      wave: 1,
      app: "payments-core",
      asset: { id: "DS-1155", name: "Gateway Error Budget", type: "Dashboard" },
      detail: "Counts HTTP error lines in logs where request-level traces are available on the same services.",
      evidence: "Log-derived error rate on three services carrying full distributed traces.",
      impact: "The customer's SRE practice reports error budget from logs by policy, so this is likely a deliberate choice rather than a defect. The pattern is real; acting on it may still be wrong. Worth confirming before anyone schedules a rewrite.",
    },
  ];

  G.flagById = (id) => G.flags.find((f) => f.id === id) || null;
  G.dedupeById = (id) => G.dedupe.find((d) => d.id === id) || null;

  /* --- Can the project close? -----------------------------------------------
     Derived, every time, from the stages that would have to be finished. This
     is the honest answer to "why is this stage empty": it is not empty
     because it is unbuilt, it is empty because four waves have not published.

     Each reason names the module that owns it, so the gate is navigable
     rather than a wall. ---------------------------------------------------- */
  G.closeGate = function () {
    const dep = DP().estate();
    const unpublished = PR().waves.filter((w) => w.status !== "published");
    const reasons = [];

    if (unpublished.length) {
      reasons.push({
        id: "waves",
        module: "deploy",
        label: `${unpublished.length} of ${PR().waves.length} waves have not published`,
        detail: `Waves ${unpublished.map((w) => w.id).join(", ")}. A project cannot close while assets are still in flight.`,
        tone: "critical",
      });
    }
    if (dep.liveAndWrong) {
      reasons.push({
        id: "wrong",
        module: "deploy",
        label: `${dep.liveAndWrong} published assets are live and wrong`,
        detail: "Closing over these would revoke the credentials and delete the comparison data needed to fix them.",
        tone: "critical",
      });
    }
    if (dep.openVerdicts) {
      reasons.push({
        id: "verdicts",
        module: "validate",
        label: `${dep.openVerdicts} validation verdicts are still open`,
        detail: "The comparison result sets are a closeout-deleted artifact. Nobody can review a verdict after close.",
        tone: "warning",
      });
    }
    if (dep.held) {
      reasons.push({
        id: "held",
        module: "deploy",
        label: `${dep.held} assets are held by the pre-deploy health check`,
        detail: "Held assets were never written. They do not block a wave, but they do block a close.",
        tone: "warning",
      });
    }

    const promoted = PR().waves.filter((w) => w.status === "published" && w.env === "Non-prod");
    if (promoted.length) {
      reasons.push({
        id: "promotion",
        module: "deploy",
        label: `${promoted.length} published wave is live in staging and not promoted`,
        detail: "Promotion to production is a customer sign-off made outside DMA. It is recorded here, not performed here.",
        tone: "warning",
        external: true,
      });
    }

    return { canClose: reasons.length === 0, reasons };
  };

  /* --- Closeout preview -----------------------------------------------------
     What would happen, to what, if the project closed today. `blocked` is the
     set that cannot be acted on because the project is still using them —
     which is most of them, and is the reason this policy fires at close
     rather than continuously. ---------------------------------------------- */
  G.closeoutPreview = function (exceptions) {
    const keep = exceptions || {};
    return G.artifacts.map((a) => {
      const rule = G.POLICY.ruleFor(a.class);
      const ex = keep[a.id] || a.exception || null;
      return {
        artifact: a,
        rule,
        cls: G.ARTIFACT_CLASSES[a.class],
        exception: ex,
        /* An exception does not change what the rule says; it changes what
           happens. Keeping both visible is what makes the guardrail metric —
           revoked OR explicitly extended with a reason — auditable. */
        outcome: ex ? "retain" : rule.action,
        sessionException: Boolean(keep[a.id]),
      };
    });
  };

  /* --- Self-check -----------------------------------------------------------
     Joins only. Anything typed above that a derived number could contradict
     is checked here rather than trusted. ----------------------------------- */
  G.assertTotals = function () {
    const out = [];
    const published = G.published();

    const grouped = G.groups().reduce((a, g) => a + g.live, 0);
    if (grouped !== published) out.push(`groups sum to ${grouped}, published population is ${published}`);

    const waveIds = PR().waves.map((w) => w.id);
    G.flags.forEach((f) => {
      if (!G.FLAG_TYPES[f.type]) out.push(`${f.id} has unknown flag type ${f.type}`);
      if (!waveIds.includes(f.wave)) out.push(`${f.id} is in unknown wave ${f.wave}`);
      if (!PL().appById(f.app)) out.push(`${f.id} is in unknown application ${f.app}`);
    });

    /* Every flagged and deduped asset has to be in a wave that is actually
       live. Flagging an asset that has not published would be the stage
       claiming to have seen something it cannot see. */
    const liveWaves = G.publishedWaves().map((r) => r.wave.id);
    G.flags.forEach((f) => {
      if (!liveWaves.includes(f.wave)) out.push(`${f.id} is flagged in wave ${f.wave}, which is not live`);
    });
    G.dedupe.forEach((d) => {
      if (!liveWaves.includes(d.wave)) out.push(`${d.id} is flagged in wave ${d.wave}, which is not live`);
      if (d.assets.length < 2) out.push(`${d.id} is a duplicate cluster of ${d.assets.length}`);
      if (d.kind === "intentional" && !d.why) out.push(`${d.id} is a false positive with no explanation`);
    });

    G.artifacts.forEach((a) => {
      if (!G.ARTIFACT_CLASSES[a.class]) out.push(`${a.id} has unknown artifact class ${a.class}`);
      if (!G.POLICY.ruleFor(a.class)) out.push(`${a.id} has a class with no policy rule`);
      if (a.exception && !a.exception.reason) out.push(`${a.id} has an exception with no reason`);
    });

    /* The connector credential is the PRD's named example. If Qualify ever
       renames the service account, this stage should notice rather than
       quietly show a stale string. */
    const cred = G.artifactById("ART-01");
    if (Q().connection.account !== cred.name) {
      out.push(`connector credential is ${Q().connection.account} in qualify, ${cred.name} here`);
    }

    if (out.length) console.warn("[DMA.data.governClose] drift:", out);
    return out;
  };
})();
