/* ============================================================================
   Wave Mapping fixtures — owned by modules/wave-mapping.
   ----------------------------------------------------------------------------
   The cascade itself lives in data/mapping.js, shared with Global Mapping.
   This file carries only the layer CONTENTS: what the project confirmed, what
   each application set on top, and the handful of per-asset exceptions.

   The governing fact, and the thing the whole screen exists to make visible:

     Nothing here binds to a wave.

   A wave is a mutable delivery container the EPM re-groups whenever the plan
   changes. An application is a stable semantic grouping that survives every
   re-plan. So every value below is stored against an APPLICATION, and the wave
   is only the lens you read it through. `rePlan` records what that bought.

   The one exception is lookup delivery, where the answer genuinely IS a wave
   number — a lookup must ship with or before the first wave that reads it.
   That exception is why the rule is worth stating rather than assuming.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

DMA.data.waveMapping = {
  /* --- The resolvable fields ----------------------------------------------
     Two kinds, and conflating them is what produces a review queue where a
     missing prefix and a deliberate deviation look identical:

       token    — the global template DEMANDS a value and has no default to
                  fall back on. Absence is an outstanding input.
       override — a project default already resolves. Absence is agreement. */
  fields: [
    {
      id: "app_prefix",
      rule: "naming-tokens",
      label: "Application prefix",
      kind: "token",
      note: "Fills {app_prefix} in the confirmed template [{app_prefix}] {source_name} ({team}). There is deliberately no project default — a prefix identical across the estate disambiguates nothing, which is the entire reason the token exists.",
    },
    {
      id: "team",
      rule: "naming-tokens",
      label: "Team label",
      kind: "token",
      note: "Fills {team}. Added to the global template on Sep 18 because four teams own dashboards with identical names; until it carries a value those names still collide.",
    },
    {
      id: "timeframe",
      rule: "timeframe",
      label: "Default query window",
      kind: "override",
      ceiling: "7 days",
      note: "Bounded by the global query guardrail. 7 days is a project rule carried forward from the Globex post-mortem and cannot be raised from this screen — an application may move within the ceiling, never through it.",
    },
    {
      id: "placement",
      rule: "placement",
      label: "Target app / segment",
      kind: "override",
      note: "Where converted assets land in the Dynatrace tenant.",
    },
    {
      id: "tags",
      rule: "tags",
      label: "Tags",
      kind: "override",
      note: "Appended to the project set, never replacing it. Feeds Optimization-Opportunity Flagging at closeout.",
    },
  ],

  /* --- Layer: project ------------------------------------------------------
     What Global Mapping confirmed. Note the two absences: no prefix, no team.
     Those are the tokens. */
  project: {
    timeframe: "24 hours",
    placement: "Migrated Assets",
    tags: "migrated:true, source:splunk",
  },

  projectBasis: {
    timeframe: "The guardrail ceiling is 7 days; 24 hours is the default inside it, because 83% of source dashboards already open on a 24-hour window.",
    placement: "A single landing app until an application says otherwise. Being wrong here is visible and cheap to move.",
    tags: "Two tags every migrated asset carries, so a published estate can always be separated from a native one.",
  },

  /* --- Layer: application --------------------------------------------------
     32 token values supplied, 23 overrides, 6 tokens still outstanding.
     Every entry records who and why — an override with no reason is
     indistinguishable from a mistake six weeks later. */
  applications: {
    "platform-shared": {
      app_prefix: { v: "ACME-PLAT", by: "Rosa Delgado", at: "2026-09-16T09:10:00Z" },
      team: { v: "Platform Engineering", by: "Rosa Delgado", at: "2026-09-16T09:10:00Z" },
    },
    "payments-core": {
      app_prefix: { v: "ACME-PAY", by: "Rosa Delgado", at: "2026-09-16T09:12:00Z" },
      team: { v: "Payments Engineering", by: "Rosa Delgado", at: "2026-09-16T09:12:00Z" },
      placement: { v: "Payments Ops", by: "Rosa Delgado", at: "2026-09-16T09:14:00Z", why: "The team already runs a Payments Ops app natively. Landing migrated assets anywhere else splits their working set in two." },
      tags: { v: "tier:critical, pci:in-scope", by: "Claire Dubois", at: "2026-09-17T10:40:00Z", why: "PCI scope has to be machine-readable at closeout. The auditors query the tag, not the dashboard name." },
    },
    "fraud-risk": {
      app_prefix: { v: "ACME-RISK", by: "Rosa Delgado", at: "2026-09-16T09:16:00Z" },
      team: { v: "Financial Crime", by: "Rosa Delgado", at: "2026-09-16T09:16:00Z" },
      timeframe: { v: "72 hours", by: "Claire Dubois", at: "2026-09-19T08:55:00Z", why: "A fraud analyst compares the current shift against the two before it. 24 hours shows one shift and no comparison." },
      placement: { v: "Risk Ops", by: "Claire Dubois", at: "2026-09-19T08:56:00Z", why: "Shared surface with Sanctions Screening — one on-call rota reads both." },
      tags: { v: "tier:critical, regulated:true", by: "Claire Dubois", at: "2026-09-19T08:58:00Z", why: "Regulated assets are retained and reviewed on a different schedule." },
    },
    sanctions: {
      app_prefix: { v: "ACME-SCRN", by: "Rosa Delgado", at: "2026-09-16T09:18:00Z" },
      team: { v: "Financial Crime", by: "Rosa Delgado", at: "2026-09-16T09:18:00Z" },
      timeframe: { v: "7 days", by: "Claire Dubois", at: "2026-09-19T09:02:00Z", why: "Screening backlogs are reviewed weekly. This is the ceiling — it cannot go further without changing the global guardrail." },
      placement: { v: "Risk Ops", by: "Claire Dubois", at: "2026-09-19T09:02:00Z", why: "Shared surface with Fraud & Risk." },
      tags: { v: "tier:critical, regulated:true", by: "Claire Dubois", at: "2026-09-19T09:03:00Z", why: "Same regulatory review schedule as Fraud & Risk." },
    },
    "treasury-ops": {
      app_prefix: { v: "ACME-TRES", by: "Rosa Delgado", at: "2026-09-16T09:20:00Z" },
      team: { v: "Treasury", by: "Rosa Delgado", at: "2026-09-16T09:20:00Z" },
      timeframe: { v: "7 days", by: "Arjun Mehta", at: "2026-09-22T11:15:00Z", why: "Liquidity positions are read against the prior settlement week." },
      placement: { v: "Treasury Ops", by: "Arjun Mehta", at: "2026-09-22T11:15:00Z", why: "Shared surface with Settlement — the same desk reads both." },
      tags: { v: "tier:critical", by: "Arjun Mehta", at: "2026-09-22T11:16:00Z", why: "Treasury is on the critical path for the daily close." },
    },
    settlement: {
      app_prefix: { v: "ACME-SETL", by: "Rosa Delgado", at: "2026-09-16T09:22:00Z" },
      team: { v: "Treasury", by: "Rosa Delgado", at: "2026-09-16T09:22:00Z" },
      timeframe: { v: "7 days", by: "Arjun Mehta", at: "2026-09-22T11:18:00Z", why: "Reconciliation breaks are chased across a settlement week, not a day." },
      placement: { v: "Treasury Ops", by: "Arjun Mehta", at: "2026-09-22T11:18:00Z", why: "Shared surface with Treasury Ops." },
    },
    "compliance-rpt": {
      app_prefix: { v: "ACME-CMPL", by: "Rosa Delgado", at: "2026-09-16T09:24:00Z" },
      team: { v: "Compliance", by: "Rosa Delgado", at: "2026-09-16T09:24:00Z" },
      timeframe: { v: "7 days", by: "Claire Dubois", at: "2026-09-24T14:05:00Z", why: "Weekly regulatory reporting cycle." },
      placement: { v: "Compliance", by: "Claire Dubois", at: "2026-09-24T14:05:00Z", why: "Access to this app is restricted to the compliance group by the IAM mapping." },
      tags: { v: "regulated:true, retention:730d", by: "Claire Dubois", at: "2026-09-24T14:07:00Z", why: "Settlement records are held for two years — the same reason the global retention cap moved to 730 days." },
    },
    "retail-channels": {
      app_prefix: { v: "ACME-CHAN", by: "Rosa Delgado", at: "2026-09-16T09:26:00Z" },
      team: { v: "Channels", by: "Rosa Delgado", at: "2026-09-16T09:26:00Z" },
      placement: { v: "Channel Ops", by: "Arjun Mehta", at: "2026-09-26T10:20:00Z", why: "Branch and teller operations have their own on-call rota." },
    },
    "agent-network": {
      app_prefix: { v: "ACME-AGNT", by: "Rosa Delgado", at: "2026-09-16T09:28:00Z" },
      team: { v: "Channels", by: "Rosa Delgado", at: "2026-09-16T09:28:00Z" },
    },
    "digital-wallet": {
      app_prefix: { v: "ACME-WLLT", by: "Rosa Delgado", at: "2026-09-16T09:30:00Z" },
      team: { v: "Digital", by: "Rosa Delgado", at: "2026-09-16T09:30:00Z" },
      placement: { v: "Digital Products", by: "Arjun Mehta", at: "2026-09-26T10:24:00Z", why: "Shared surface with Card Services — one product org." },
    },
    "fx-pricing": {
      app_prefix: { v: "ACME-FX", by: "Rosa Delgado", at: "2026-09-16T09:32:00Z" },
      team: { v: "Treasury", by: "Rosa Delgado", at: "2026-09-16T09:32:00Z" },
      timeframe: { v: "72 hours", by: "Arjun Mehta", at: "2026-09-26T10:26:00Z", why: "Rate moves are read against the preceding trading days." },
    },
    "card-services": {
      app_prefix: { v: "ACME-CARD", by: "Rosa Delgado", at: "2026-09-16T09:34:00Z" },
      team: { v: "Digital", by: "Rosa Delgado", at: "2026-09-16T09:34:00Z" },
      placement: { v: "Digital Products", by: "Arjun Mehta", at: "2026-09-26T10:28:00Z", why: "Shared surface with Digital Wallet." },
    },
    "customer-identity": {
      app_prefix: { v: "ACME-IDNT", by: "Rosa Delgado", at: "2026-09-16T09:36:00Z" },
      team: { v: "Identity & Access", by: "Rosa Delgado", at: "2026-09-16T09:36:00Z" },
      tags: { v: "pii:true", by: "Claire Dubois", at: "2026-09-27T09:40:00Z", why: "Anything carrying identity data has to be findable by tag for the quarterly privacy review." },
    },
    "partner-api": {
      app_prefix: { v: "ACME-API", by: "Rosa Delgado", at: "2026-09-16T09:38:00Z" },
      team: { v: "Platform Engineering", by: "Rosa Delgado", at: "2026-09-16T09:38:00Z" },
      placement: { v: "Partner Platform", by: "Arjun Mehta", at: "2026-09-26T10:30:00Z", why: "External partner SLAs are reported from a dedicated surface." },
    },
    remittance: {
      app_prefix: { v: "ACME-RMIT", by: "Rosa Delgado", at: "2026-09-16T09:40:00Z" },
    },
    "corporate-it": {
      app_prefix: { v: "ACME-CORP", by: "Rosa Delgado", at: "2026-09-16T09:42:00Z" },
      team: { v: "Corporate Systems", by: "Rosa Delgado", at: "2026-09-16T09:42:00Z" },
      placement: { v: "Corporate IT", by: "Arjun Mehta", at: "2026-09-26T10:32:00Z", why: "Internal IT runs its own tenancy conventions and asked to stay separate." },
    },
    "hr-payroll": {},
    "facilities-iot": {
      app_prefix: { v: "ACME-FCLT", by: "Rosa Delgado", at: "2026-09-16T09:44:00Z" },
    },
    marketing: {},
  },

  /* --- Layer: asset --------------------------------------------------------
     The per-asset half of the archived Global + Per-Asset Overrides PRD. It
     was dropped for being unbounded, so it comes back counted rather than
     uncapped: 9 exceptions across 2,955 assets. Three of them say the same
     thing about the same application, which is not nine decisions — it is one
     application rule nobody has written yet. `debt()` finds that shape. */
  assetExceptions: [
    { id: "AX-01", asset: "Branch Throughput — Weekly", type: "Dashboard", app: "retail-channels", field: "timeframe", v: "72 hours", by: "Arjun Mehta", at: "2026-10-06T10:12:00Z", why: "The weekly branch review opens on three days of context." },
    { id: "AX-02", asset: "Teller Queue Depth", type: "Dashboard", app: "retail-channels", field: "timeframe", v: "72 hours", by: "Arjun Mehta", at: "2026-10-06T10:14:00Z", why: "Same weekly review." },
    { id: "AX-03", asset: "Channel Error Budget", type: "Dashboard", app: "retail-channels", field: "timeframe", v: "72 hours", by: "Arjun Mehta", at: "2026-10-06T10:15:00Z", why: "Same weekly review." },
    { id: "AX-04", asset: "PCI Audit Trail", type: "Saved search", app: "payments-core", field: "tags", v: "migrated:true, source:splunk, tier:critical, pci:in-scope, pci:evidence", by: "Claire Dubois", at: "2026-10-02T11:30:00Z", why: "Named in the PCI evidence pack by exact tag. One asset, one tag, not an application-wide claim." },
    { id: "AX-05", asset: "Grail Ingest Watchdog", type: "Alert", app: "platform-shared", field: "placement", v: "Platform Health", by: "Viktor Sorensen", at: "2026-10-01T08:50:00Z", why: "Owned by the platform team rather than the migration. It outlives this project." },
    { id: "AX-06", asset: "SAR Filing Volume", type: "Dashboard", app: "compliance-rpt", field: "placement", v: "Compliance — Restricted", by: "Claire Dubois", at: "2026-10-07T13:20:00Z", why: "Only the filing team may read suspicious-activity counts. A restricted segment, not the open Compliance app." },
    { id: "AX-07", asset: "OFAC Hit Rate", type: "Dashboard", app: "sanctions", field: "app_prefix", v: "ACME-OFAC", by: "Claire Dubois", at: "2026-10-07T13:26:00Z", why: "Examiners search for the OFAC prefix by name. Renaming it to ACME-SCRN would make a regulated artefact unfindable." },
    { id: "AX-08", asset: "Model Drift — Nightly", type: "Saved search", app: "fraud-risk", field: "timeframe", v: "7 days", by: "Claire Dubois", at: "2026-10-03T09:05:00Z", why: "Drift is not visible inside 72 hours. At the ceiling, deliberately." },
    { id: "AX-09", asset: "KYC Onboarding Funnel", type: "Dashboard", app: "customer-identity", field: "placement", v: "Payments Ops", by: "Martin Hale", at: "2026-10-14T09:18:00Z", why: "Referenced by the Wave 1 executive dashboard, so it has to land where that dashboard reads from." },
  ],

  /* --- Lookup delivery -----------------------------------------------------
     The one rule in the set whose answer is a wave number. A lookup must be
     published with or before the first wave that references it, or that wave
     publishes a dangling reference and the DQL returns nothing.

     232 of the estate's 241 lookups are referenced by applications sitting in
     a single wave and schedule themselves. These 9 cross waves, which is the
     only reason they need a screen. */
  lookups: [
    { id: "LK-01", name: "country_risk_tier", rows: 249, deliverWave: 2, referencedBy: ["sanctions", "fraud-risk", "compliance-rpt"] },
    { id: "LK-02", name: "corridor_fx_desk", rows: 1840, deliverWave: 3, referencedBy: ["treasury-ops", "settlement", "fx-pricing"] },
    { id: "LK-03", name: "merchant_category", rows: 981, deliverWave: 1, referencedBy: ["payments-core", "card-services"] },
    { id: "LK-04", name: "agent_location_master", rows: 12402, deliverWave: 4, referencedBy: ["agent-network", "retail-channels", "remittance"] },
    { id: "LK-05", name: "sanctioned_entity_alias", rows: 58311, deliverWave: 2, referencedBy: ["sanctions", "compliance-rpt"] },
    { id: "LK-06", name: "employee_cost_centre", rows: 4106, deliverWave: 6, referencedBy: ["hr-payroll", "corporate-it"] },
    { id: "LK-07", name: "settlement_calendar", rows: 366, deliverWave: 3, referencedBy: ["settlement", "treasury-ops"] },
    { id: "LK-08", name: "kyc_doc_type", rows: 142, deliverWave: 6, referencedBy: ["customer-identity", "remittance", "hr-payroll"] },
    { id: "LK-09", name: "product_catalogue", rows: 2217, deliverWave: 6, referencedBy: ["digital-wallet", "marketing"] },
  ],

  lookupTotals: { estate: 241, singleWave: 232 },

  /* --- What the Wave 4–6 re-plan moved -------------------------------------
     The counterfactual, recorded rather than argued. Six applications changed
     wave on Oct 13. Because every value above is stored against the
     application, none of them noticed. Had the same values been stored against
     the wave, each of these rows would have been orphaned on the same day. */
  rePlan: {
    at: "2026-10-13T11:20:00Z",
    by: "Martin Hale",
    why: "Wave 4–6 re-plan. Compliance and Channels were pulled forward to land before the regulatory reporting cycle; Corporate IT and HR were pushed back to make room.",
    moved: [
      { app: "compliance-rpt", from: 5, to: 4 },
      { app: "retail-channels", from: 5, to: 4 },
      { app: "agent-network", from: 6, to: 4 },
      { app: "digital-wallet", from: 4, to: 5 },
      { app: "corporate-it", from: 5, to: 6 },
      { app: "hr-payroll", from: 5, to: 6 },
    ],
  },

  /* --- Per-wave readiness --------------------------------------------------
     Deliberately NOT a second rule-set signature. Global Mapping confirms the
     rules once for the estate; this gate only asks whether a wave's
     applications have every input those rules demand. It is computed, so it
     cannot drift from the data it describes — see gate(). */
  confirmed: {
    1: { at: "2026-09-20T09:30:00Z", by: "Rosa Delgado" },
    2: { at: "2026-09-24T10:05:00Z", by: "Rosa Delgado" },
    3: { at: "2026-09-29T08:40:00Z", by: "Claire Dubois" },
    4: { at: "2026-10-13T15:10:00Z", by: "Claire Dubois" },
  },
};

/* ===========================================================================
   Derivations. No mapping value is stored twice: every effective value below
   is resolved on read from the global → wave → app → asset layers.

   Wave membership is the one thing this file does NOT derive. As of Oct 21
   2026 it is stored, on the application, by Prioritize & Plan — because the
   EPM places applications using information the system cannot see. This file
   reads that placement; it never recomputes it. Changing a placement there
   changes what appears here on the next render, with nothing to keep in sync.
   ========================================================================= */
(function () {
  const W = DMA.data.waveMapping;

  /* The committed plan, as Prioritize & Plan stored it. */
  function plan() {
    return DMA.data.planning.committed();
  }

  /* app id → wave id, read from the stored placement. */
  W.waveOfApp = function () {
    const map = {};
    plan().waves.forEach((w) => w.apps.forEach((a) => (map[a.id] = w.id)));
    return map;
  };

  W.appsInWave = function (waveId) {
    if (!waveId || waveId === "all") return DMA.data.planning.applications.slice();
    const w = plan().waves.find((x) => String(x.id) === String(waveId));
    return w ? w.apps.slice() : [];
  };

  /* Plain {fieldId: value} layers for DMA.data.mapping.resolve(). */
  function appLayer(appId) {
    const entries = W.applications[appId] || {};
    const out = {};
    Object.keys(entries).forEach((k) => (out[k] = entries[k].v));
    return out;
  }

  function assetLayer(assetId) {
    const ex = W.assetExceptions.find((e) => e.id === assetId);
    return ex ? { [ex.field]: ex.v } : {};
  }

  /* The effective value of one field, plus where it came from. `assetId` is
     optional — omit it and you get the application's own resolution. */
  W.resolve = function (appId, fieldId, assetId) {
    const r = DMA.data.mapping.resolve(fieldId, {
      asset: assetId ? assetLayer(assetId) : null,
      application: appLayer(appId),
      project: W.project,
      translator: null,
    });
    const field = W.fields.find((f) => f.id === fieldId);
    const entry = (W.applications[appId] || {})[fieldId];
    return {
      ...r,
      field,
      entry: entry || null,
      /* A token with nothing to resolve to is an outstanding input, not a
         default. Keeping these apart is the whole point of `kind`. */
      outstanding: r.value === null && field.kind === "token",
    };
  };

  W.resolveAll = function (appId, assetId) {
    return W.fields.map((f) => ({ id: f.id, ...W.resolve(appId, f.id, assetId) }));
  };

  /* Counts across a set of applications. */
  W.tally = function (appIds) {
    const t = { tokens: 0, overrides: 0, outstanding: 0, inherited: 0 };
    appIds.forEach((id) => {
      W.fields.forEach((f) => {
        const r = W.resolve(id, f.id);
        if (r.outstanding) t.outstanding++;
        else if (r.source === "application") f.kind === "token" ? t.tokens++ : t.overrides++;
        else t.inherited++;
      });
    });
    return t;
  };

  /* The rendered name of an asset, so the naming tokens have a visible
     consequence rather than being two text boxes. */
  W.previewName = function (appId, sourceName, assetId) {
    const prefix = W.resolve(appId, "app_prefix", assetId).value;
    const team = W.resolve(appId, "team", assetId).value;
    return {
      text: `[${prefix || "{app_prefix}"}] ${sourceName}${team ? ` (${team})` : " ({team})"}`,
      complete: Boolean(prefix && team),
    };
  };

  /* Asset exceptions that repeat. Three assets saying the same thing about the
     same application is one missing application rule, not three decisions. */
  W.debt = function () {
    const groups = {};
    W.assetExceptions.forEach((e) => {
      const key = `${e.app}::${e.field}::${e.v}`;
      (groups[key] = groups[key] || { app: e.app, field: e.field, v: e.v, items: [] }).items.push(e);
    });
    return Object.values(groups).filter((g) => g.items.length >= 3);
  };

  /* Lookup delivery. A lookup is late when it publishes after the first wave
     that reads it. */
  W.lookupState = function (lk) {
    const where = W.waveOfApp();
    const needs = lk.referencedBy.map((a) => ({ app: a, wave: where[a] })).sort((x, y) => x.wave - y.wave);
    const firstNeed = needs[0].wave;
    return {
      ...lk,
      needs,
      firstNeed,
      late: lk.deliverWave > firstNeed,
      slip: lk.deliverWave - firstNeed,
      blocks: needs.filter((n) => n.wave < lk.deliverWave),
    };
  };

  W.lookupStates = function () {
    return W.lookups.map(W.lookupState);
  };

  /* Entries that would have been orphaned had the cascade bound to waves. */
  W.rePlanCost = function () {
    return W.rePlan.moved.map((m) => {
      const entries = Object.keys(W.applications[m.app] || {});
      const app = DMA.data.planning.applications.find((a) => a.id === m.app);
      return { ...m, app: m.app, name: app ? app.name : m.app, assets: app ? app.assets : 0, entries: entries.length };
    });
  };

  /* The readiness gate for one wave. Computed from the same data the rest of
     the screen reads, so a green gate and an outstanding token cannot coexist. */
  W.gate = function (waveId) {
    const apps = W.appsInWave(waveId).map((a) => a.id);
    const missing = [];
    apps.forEach((id) =>
      W.fields
        .filter((f) => f.kind === "token")
        .forEach((f) => {
          if (W.resolve(id, f.id).outstanding) missing.push({ app: id, field: f.id });
        })
    );
    const lateHere = W.lookupStates().filter((s) => s.late && s.blocks.some((b) => String(b.wave) === String(waveId)));
    const confirmed = W.confirmed[waveId] || null;
    return {
      waveId,
      apps,
      missing,
      lateLookups: lateHere,
      clear: missing.length === 0 && lateHere.length === 0,
      confirmed,
    };
  };
})();
