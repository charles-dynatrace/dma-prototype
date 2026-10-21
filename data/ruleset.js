/* ============================================================================
   Global rule-set fixtures.
   ----------------------------------------------------------------------------
   Stage 4 of the flow. The scope model and the cascade resolver live in
   data/mapping.js because Wave Mapping needs them too. THIS file is the
   project-specific state of that model — what the suggested defaults were,
   what the consultant did with them, how triage classified the estate, and
   where the rule set is locked.

   Three features land here:
     Context-Injection Engine   — a suggested default on every rule
     Mapping Confidence Triage  — Fits Default / Needs Configuration / Uncertain
     Rule-set confirmation gate — the half of the dropped Global + Per-Asset
                                  Overrides PRD that belongs at project scope

   Owned by modules/global-mapping. Other modules must not read these fixtures.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

DMA.data.ruleset = {
  /* --- What the live product makes you navigate --------------------------
     Five tabs, one per configuration object type, each a flat list. The same
     bucket decision is taken 1,236 times because there is no surface above
     the list to take it once. The counts are real; `decidedBy` is the
     target-state answer to "which single rule settles this whole tab". */
  objectTypes: [
    { id: "indexes",   label: "Indexes & buckets", count: 1236, decidedBy: "index-bucket",    note: "One bucket decision per index, repeated." },
    { id: "pipelines", label: "Pipelines",         count: 221,  decidedBy: "pipeline-fields", note: "props.conf / transforms.conf, one row each." },
    { id: "lookups",   label: "Lookups",           count: 174,  decidedBy: "lookup-tables",   note: "Lookup files awaiting a target table." },
    { id: "inputs",    label: "Inputs",            count: 66,   decidedBy: "index-bucket",    note: "An input routes to an index, so the bucket rule already settles it. Today it is a separate tab and a separate decision." },
    { id: "fields",    label: "Field mappings",    count: 0,    decidedBy: "pipeline-fields", note: "Reads zero because the translator's thirteen built-in field decisions have no surface. They are being made regardless." },
  ],

  /* --- Per-rule state ------------------------------------------------------
     Keyed to DMA.data.mapping.globalRules by id. `decides` is the surface the
     rule covers — deliberately uneven, because that unevenness is the argument
     for organising by decision rather than by object type. A naming template is
     one decision that reaches 2,955 assets; a bucket rule is 1,236 of them. */
  rules: {
    "index-bucket": {
      decides: 1236,
      decidesLabel: "Splunk indexes",
      suggested: "Bucket per index · logs:{index_name}",
      basis: "1,148 of 1,236 indexes carry a single sourcetype and a consistent retention setting, which is the shape bucket-per-index assumes.",
      state: "accepted",
      triage: { fits: 1148, needs: 71, uncertain: 17 },
    },
    retention: {
      decides: 1236,
      decidesLabel: "target buckets",
      suggested: "Inherit source index retention, capped at 395 days",
      basis: "Retention read from indexes.conf on every source index.",
      state: "edited",
      editedTo: "Inherit source index retention, capped at 730 days",
      editedBy: "Rosa Delgado",
      editedAt: "2026-09-18T13:25:00Z",
      editedWhy: "Compliance holds settlement records for two years. A 395-day cap would have silently truncated them at ingest.",
      triage: { fits: 1201, needs: 35, uncertain: 0 },
    },
    "pipeline-fields": {
      decides: 221,
      decidesLabel: "pipelines",
      suggested: "One OpenPipeline processor per sourcetype, extractions mapped to semantic field names",
      basis: "173 of 221 pipelines use standard props.conf extraction patterns with a recognised sourcetype.",
      state: "accepted",
      triage: { fits: 173, needs: 29, uncertain: 19 },
    },
    "lookup-tables": {
      decides: 174,
      decidesLabel: "lookup files",
      suggested: "One Grail table per lookup file · lookup_{file_name}",
      basis: "174 lookup files resolved from the import, 149 with a usable unique key column.",
      state: "accepted",
      triage: { fits: 149, needs: 21, uncertain: 4 },
    },
    identity: {
      decides: 48,
      decidesLabel: "Splunk roles",
      suggested: "Map each Splunk role to the IAM group with the closest permission set",
      basis: "39 of 48 roles have a direct permission-set match in the target tenant.",
      state: "accepted",
      triage: { fits: 39, needs: 7, uncertain: 2 },
    },
    "naming-template": {
      decides: 1,
      decidesLabel: "template",
      reach: 2955,
      suggested: "[{app_prefix}] {source_name}",
      basis: "71% of source dashboards already carry a bracketed prefix. The template formalises what the estate mostly does.",
      state: "edited",
      editedTo: "[{app_prefix}] {source_name} ({team})",
      editedBy: "Rosa Delgado",
      editedAt: "2026-09-18T14:02:00Z",
      editedWhy: "Four teams own dashboards with identical names. Without the team token the published set collides.",
      triage: { fits: 1, needs: 0, uncertain: 0 },
    },
    "query-guardrails": {
      decides: 2,
      decidesLabel: "guardrails",
      suggested: "Default timeframe ceiling 7 days · bucket selection required on every translated query",
      basis: "Carried forward from the Globex post-mortem, where unscoped queries over an unbounded window throttled the tenant on day one.",
      state: "accepted",
      triage: { fits: 2, needs: 0, uncertain: 0 },
    },
  },

  /* --- Triage queue --------------------------------------------------------
     Only Needs Configuration and Uncertain appear here; Fits Default is the
     2,713 that nobody opens. `required` is the specific input, never a generic
     "needs review" — that distinction is the whole feature. */
  queue: [
    { id: "IDX-0412", object: "wu_fx_rates",             rule: "index-bucket",    cls: "needs",     required: "Target bucket does not exist in the tenant. Create logs:wu_fx_rates, or route into an existing bucket.", context: "Queried by FX Spread Monitoring (DSH-0412), which entered scope at the last import." },
    { id: "IDX-0518", object: "wu_sanctions_v2",         rule: "index-bucket",    cls: "needs",     required: "Bucket not created. Retention also needs a decision — the source index holds 7 years.", context: "Entered scope with the Wave 4–6 re-plan." },
    { id: "IDX-0001", object: "main",                    rule: "index-bucket",    cls: "uncertain", required: "Four applications write to this index with unrelated sourcetypes. Bucket-per-index would merge data that nothing else in the estate treats as related.", context: "840 GB/day. The largest single index in the source." },
    { id: "FLD-0003", object: "_time / _indextime",      rule: "pipeline-fields", cls: "needs",     required: "Both resolve to timestamp. Pick which one becomes the record timestamp; the other needs an explicit target or it is dropped.", context: "Affects every translated query that references index time." },
    { id: "FLD-0006", object: "source / sourcetype",     rule: "pipeline-fields", cls: "uncertain", required: "Both resolve to log.source. 94 saved searches filter on both in the same query — after the collapse those filters contradict each other.", context: "Translator built-in. No surface exists today to see this." },
    { id: "PIP-0088", object: "wu_pay_iso20022",         rule: "pipeline-fields", cls: "uncertain", required: "transforms.conf applies three chained regex rewrites with a lookup in the middle. No deterministic OpenPipeline shape.", context: "Feeds 61 Payments Core assets." },
    { id: "LKP-0044", object: "branch_hierarchy.csv",    rule: "lookup-tables",   cls: "needs",     required: "No unique key column. A Grail table needs one — nominate a column or a composite.", context: "Referenced by 23 assets across three applications." },
    { id: "LKP-0109", object: "fx_rates_intraday.csv",   rule: "lookup-tables",   cls: "uncertain", required: "Rewritten every 15 minutes by an outputlookup search that cannot be translated. The table would go stale the day it ships.", context: "The writing search is already blocked at Import." },
    { id: "ROL-0017", object: "wu_contractor_readonly",  rule: "identity",        cls: "uncertain", required: "No IAM group matches. The role grants read on 9 of 1,236 indexes — narrower than anything in the target tenant.", context: "41 named users." },
    { id: "BKT-0233", object: "wu_settle_archive",       rule: "retention",       cls: "needs",     required: "Source retention is 7 years, above the 730-day cap this project set. Raise the cap for this bucket or accept truncation.", context: "Compliance confirmed the records are in scope for the hold." },
  ],

  /* --- The worked example: what "edit a rule" actually means ---------------
     The question this answers is "how do 1,236 objects get updated", and the
     answer is that they never do. One value is stored at project scope and
     every index row is RESOLVED from it on read. The only per-object storage
     is an override, and there are 14 of those out of 1,236.

     Index → Bucket is the example because it is the worst case: the largest
     object count, the decision with the most downstream consequence, and the
     one rule that genuinely cannot differ between two waves. */
  editor: {
    "index-bucket": {
      confirmed: "per-index",
      overrides: 14,
      /* The decision is four options, not 1,236 edits. Each carries a real
         cost — "recommended" is not the same as "free". */
      strategies: [
        {
          id: "per-index",
          label: "Bucket per index",
          pattern: "logs:{index_name}",
          buckets: 1236,
          recommended: true,
          gain: "Retention, permissions and query scoping stay exactly as the source has them. No index inherits another index's policy.",
          cost: "1,236 buckets sits close to the tenant bucket ceiling. The Limit-Aware Capacity Planner re-checks this against real limits at Prioritize & Plan.",
        },
        {
          id: "per-app",
          label: "Bucket per application",
          pattern: "logs:{app_slug}",
          buckets: 14,
          gain: "14 buckets. Bucket selection still carries meaning in DQL, and the tenant stays well inside every platform limit.",
          cost: "A bucket holds one retention policy, so 311 indexes would be stored longer than their source setting — a cost question, and for 2 of them a compliance one.",
        },
        {
          id: "per-retention",
          label: "Bucket per retention class",
          pattern: "logs:retention_{retention_days}d",
          buckets: 4,
          gain: "Retention is exact everywhere and only four buckets exist.",
          cost: "Bucket name no longer tells you what is in it, so every translated query has to scope by attribute instead. All 2,955 assets would need re-translating.",
        },
        {
          id: "single",
          label: "Single bucket",
          pattern: "logs:western_union",
          buckets: 1,
          gain: "The simplest possible ingest configuration.",
          cost: "Fails this project's own query guardrail, which requires bucket selection on every translated query. There would be nothing left to select.",
        },
      ],
      /* Eight of 1,236. Nothing here is stored except wu_teller_au's override,
         which is why it survives a strategy change and the other seven do not. */
      sample: [
        { name: "wu_payments_settle", app: "Payments Core",   appSlug: "payments_core",   retention: 395,  gb: 142, wave: 1,    state: "rule" },
        { name: "wu_payments_auth",   app: "Payments Core",   appSlug: "payments_core",   retention: 395,  gb: 88,  wave: 1,    state: "rule" },
        { name: "wu_fraud_scores",    app: "Fraud & Risk",    appSlug: "fraud_risk",      retention: 730,  gb: 61,  wave: 2,    state: "rule" },
        { name: "wu_teller_au",       app: "Retail Channels", appSlug: "retail_channels", retention: 180,  gb: 23,  wave: 4,    state: "override",
          overrideTo: "logs:wu_retail_apac", overrideBy: "Claire Dubois", overrideAt: "2026-09-17T09:40:00Z",
          overrideWhy: "APAC records stay in a regionally separated bucket for data residency. The rule cannot express a legal boundary." },
        { name: "wu_settle_archive",  app: "Compliance Reporting", appSlug: "compliance_rpt", retention: 2555, gb: 7, wave: 4,  state: "needs",
          note: "Source retention is 7 years, above the 730-day cap this project set." },
        { name: "wu_sanctions_v2",    app: "Sanctions Screening", appSlug: "sanctions",   retention: 2555, gb: 12,  wave: 2,    state: "needs",
          note: "Target bucket has not been created in the tenant." },
        { name: "wu_fx_rates",        app: "Treasury Ops",    appSlug: "treasury_ops",    retention: 395,  gb: 4,   wave: 3,    state: "needs",
          note: "Target bucket has not been created in the tenant." },
        { name: "main",               app: "Platform Shared", appSlug: "platform_shared", retention: 90,   gb: 840, wave: 1,    state: "uncertain",
          note: "Four applications write here with unrelated sourcetypes. Any single bucket merges data nothing else in the estate treats as related." },
      ],
    },
  },

  /* --- The confirmation gate ----------------------------------------------
     Half of the archived Global + Per-Asset Overrides PRD. The per-asset half
     moved to Wave Mapping; what stays here is one decision over the rule set,
     because a rule set is one thing to sign off, not 2,955 things. */
  confirmation: {
    version: 3,
    confirmedAt: "2026-09-19T14:30:00Z",
    confirmedBy: "Rosa Delgado",
    pendingVersion: 4,
    rule: "Uncertain must be zero before a rule-set version can be confirmed. Needs Configuration may carry, because the input is known and can be supplied per wave.",
  },

  /* --- Lock state ----------------------------------------------------------
     Per wave, because the lock is per wave. Wave 4 is the interesting row: it
     translated, locked, and then came back through the manual-review door when
     the re-plan introduced three indexes the confirmed set had never seen. */
  lockState: [
    { wave: 1, name: "Foundation",                   assets: 534, state: "locked",   at: "2026-09-21T08:40:00Z", by: "Rosa Delgado", detail: "First translation run against rule set v3." },
    { wave: 2, name: "Core — Risk & Screening",      assets: 540, state: "locked",   at: "2026-09-25T09:10:00Z", by: "Rosa Delgado", detail: "First translation run against rule set v3." },
    { wave: 3, name: "Core — Treasury & Settlement", assets: 541, state: "locked",   at: "2026-09-30T08:05:00Z", by: "Claire Dubois",    detail: "First translation run against rule set v3." },
    { wave: 4, name: "Core — Compliance & Channels", assets: 518, state: "reopened", at: "2026-10-13T11:20:00Z", by: "Martin Hale",   detail: "Locked Oct 2 on first translation. Returned to translation by manual review — the Wave 4–6 re-plan brought 3 indexes into scope that rule set v3 never classified." },
    { wave: 5, name: "Secondary",                    assets: 549, state: "open",     at: null, by: null,         detail: "Mapped, not yet translated. Nothing has consumed the rules, so nothing is frozen." },
    { wave: 6, name: "Cleanup",                      assets: 258, state: "open",     at: null, by: null,         detail: "Planned only." },
  ],
};

/* Estate-wide triage, summed from the per-rule splits so the headline can
   never drift from the table underneath it. */
DMA.data.ruleset.triageTotals = function () {
  return Object.values(DMA.data.ruleset.rules).reduce(
    (acc, r) => {
      acc.fits += r.triage.fits;
      acc.needs += r.triage.needs;
      acc.uncertain += r.triage.uncertain;
      acc.total += r.triage.fits + r.triage.needs + r.triage.uncertain;
      return acc;
    },
    { fits: 0, needs: 0, uncertain: 0, total: 0 }
  );
};

/* The resolution itself. This function IS the answer to "how do 1,236 objects
   get updated" — they are computed from one stored pattern on every read. An
   override is the only thing persisted per object, so it wins over any
   strategy, which is also why it survives a strategy change. */
DMA.data.ruleset.resolveBucket = function (strategyId, row) {
  if (row.state === "override") return { bucket: row.overrideTo, source: "override" };
  if (row.state === "needs" || row.state === "uncertain") return { bucket: null, source: row.state };

  const by = {
    "per-index": () => `logs:${row.name}`,
    "per-app": () => `logs:${row.appSlug}`,
    "per-retention": () => `logs:retention_${row.retention}d`,
    single: () => "logs:western_union",
  };
  return { bucket: (by[strategyId] || by["per-index"])(), source: "rule" };
};

DMA.data.ruleset.ruleName = function (ruleId) {
  const rule = DMA.data.mapping.globalRules.find((r) => r.id === ruleId);
  return rule ? rule.name : ruleId;
};
