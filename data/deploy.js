/* ============================================================================
   DATA: Deploy — what reached the tenant, what did not, and why
   ----------------------------------------------------------------------------
   Owned by modules/deploy.

   ----------------------------------------------------------------------------
   THIS STAGE REPORTS. IT DOES NOT RELEASE.

   There is no approve-and-publish control anywhere in this stage, and that is
   a decision rather than an omission. An asset that cleared validation goes to
   the tenant on its own; an asset Exceptions fixed goes on its own too. Adding
   a button for a human to press would invent a gate the product does not have
   and the PRD never asked for.

   What a person actually needs here is the opposite of a control: an answer to
   "is it out yet, and if not, what is holding it". So every number below is a
   state, and every action routes somewhere else to change it.

   ----------------------------------------------------------------------------
   THE HEALTH CHECK BLOCKS ASSETS, NOT WAVES

   The P1 PRD is explicit — the check "blocks only the specific assets that
   fail, not the whole wave" — and its metric is the hardest one on the
   roadmap: 0 waves skip the check, under any circumstance. So the check is
   never a thing a wave waits behind. It runs over the wave's ready population,
   holds the rows that fail, and lets the rest through.

   Wave 3 is the worked example. 14 assets are held on throttle-limit and
   data-flow findings; the other 361 ready assets are not held by those 14 and
   would deploy the moment the wave's open validation verdicts clear. Saying
   "Wave 3 is blocked by the health check" — which this prototype used to say,
   in the Overview banner and in a wave-level Blocked badge — overstates the
   check by about 360 assets and makes it look like ceremony. It is not
   ceremony: its scope was widened after the Globex post-mortem to cover
   throttle risk (unscoped buckets, oversized default timeframes) alongside
   data flow, because both reached production undetected.

   Exceptions runs the SAME check against one asset at publish time
   (`DMA.data.exceptions.healthFor`). This file runs it over a wave. Same
   check, two scopes — not two checks.

   ----------------------------------------------------------------------------
   THREE WAYS AN ASSET FAILS TO ARRIVE, AND THEY ARE NOT THE SAME FAILURE

     Held        the health check found something before the write was
                 attempted. Nothing was sent. Fix is upstream.
     Rejected    the write WAS attempted and the tenant refused it — RBAC,
                 ownership mapping, bucket permission. Nothing else in this
                 prototype shows this class, because nothing else talks to the
                 tenant. Fix is a target-side permission, not a DQL problem.
     Live, wrong already in the tenant and already incorrect. Doing nothing has
                 an ongoing cost. Fix is a redeploy over the top of a live
                 object, which is the riskiest write this product makes.

   Collapsing these three into one "failed" count would be the single most
   misleading number this stage could print.

   ----------------------------------------------------------------------------
   THE ARITHMETIC IS DERIVED, NOT TYPED

   `waveDeploy()` re-derives every population from the stage that produced it —
   `translation.runFor`, `validation.comparisonFor`, `exceptions.estate` — so
   this file cannot quietly disagree with them. That is the defect class that
   produced the 2,955 problem, and it is cheap to make impossible.

   For Wave 1, as a worked example of the whole model:

     534  in the wave
     428  translatable          translation.runFor(1).ran
     106  prerequisites         lookups and macros; 92 provision automatically,
                                14 have no automated path and must be hand-built
                                before they can be published like any other asset
     ───
     442  publish population    428 + the 14 hand-built prerequisites

     310  auto-approved         validation.comparisonFor(1).match
    + 21  published on override  needsAttention − the share routed to Exceptions
    + 71  published out of      exceptions.estate("1").states.published
          Exceptions
     ───
     402  live in the tenant
      40  not out yet           fixed-but-waiting, or still being worked

   Waves 1 and 2 reconcile against validation's own live population:
   310 + 377 = 687 auto-approved, 21 + 17 = 38 overridden, 687 + 38 = 725, and
   71 + 62 = 133 out of Exceptions. `assertTotals()` checks this on load rather
   than trusting the comment.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

(function () {
  "use strict";

  const D = (DMA.data.deploy = {});

  const PR = () => DMA.data.project;
  const T = () => DMA.data.translation;
  const V = () => DMA.data.validation;
  const X = () => DMA.data.exceptions;

  const waveRow = (id) => PR().waves.find((w) => String(w.id) === String(id)) || null;

  /* --- Target tenants -------------------------------------------------------
     The delivered platform publishes to a configured non-prod AND a configured
     prod tenant, so a wave's destination is part of its state, not a constant.
     Wave 2 sitting in non-prod with production sign-off outstanding is a real
     state the project is in right now, not a gap in the fixture. ----------- */
  D.TENANTS = {
    Production: {
      id: "prod",
      host: "wun-prod.apps.dynatrace.com",
      label: "Production",
      tone: "critical",
      detail: "Customer-facing. A write here is seen by on-call.",
    },
    "Non-prod": {
      id: "nonprod",
      host: "wun-staging.apps.dynatrace.com",
      label: "Non-prod",
      tone: "info",
      detail: "Staging tenant. Promotion to production is a customer sign-off, recorded here but made outside DMA.",
    },
  };

  D.tenantFor = (wave) => D.TENANTS[wave && wave.env] || null;

  /* --- The health check itself ----------------------------------------------
     Two families, because the check covers two different kinds of harm. Data
     flow is "the asset will return nothing"; throttle is "the asset will
     return everything, repeatedly, and degrade the tenant for everyone else".
     The second family is the post-Globex addition. ---------------------- */
  D.CHECKS = [
    {
      id: "dataflow",
      label: "Data is arriving",
      family: "Data flow",
      what: "The bucket this asset reads has received data inside the asset's own evaluation window.",
      harm: "Publishes clean and returns nothing. Looks like a translation bug and is not one.",
      icon: "database",
    },
    {
      id: "throttle-bucket",
      label: "Bucket selection is scoped",
      family: "Throttle limit",
      what: "The query names the buckets it reads instead of scanning every bucket in the tenant.",
      harm: "Each run scans the whole estate. One dashboard refresh can exhaust the tenant's query budget.",
      icon: "filter",
      addedBy: "Globex post-mortem, August 2026",
    },
    {
      id: "throttle-timeframe",
      label: "Default timeframe is within limits",
      family: "Throttle limit",
      what: "The asset's default timeframe is inside the customer's configured query limit.",
      harm: "A 90-day default on an auto-refreshing panel is a sustained load nobody asked for.",
      icon: "clock",
      addedBy: "Globex post-mortem, August 2026",
    },
  ];

  D.checkById = (id) => D.CHECKS.find((c) => c.id === id) || D.CHECKS[0];

  /* --- Health-check findings, per wave ---------------------------------------
     Waves 1 and 2 are the evidence that the check is not decorative: it found
     ten assets between them and every one was cleared before the wave went
     out. Those rows stay in the record precisely because the metric is about
     the check never being skipped, which is only provable from history.

     Wave 3's fourteen are open. Wave 4's check has not run — the wave has not
     finished validating, so there is no ready population to run it over, and
     an empty list there means "not yet", not "clean". ---------------------- */
  D.findings = {
    1: [
      { id: "DS-1101", name: "Platform Ingest Health", type: "Dashboards", app: "Platform Shared Services", check: "dataflow", detail: "Target bucket `wu_platform_logs` had no writes in the 24h before publish — the source index was still cutting over.", state: "cleared", clearedAt: "2026-10-08T14:20:00Z", clearedBy: "Rosa Delgado", how: "Waited for the cutover to complete, re-ran the check." },
      { id: "DS-1044", name: "Corridor Volume Overview", type: "Dashboards", app: "Payments Core", check: "throttle-timeframe", detail: "Default timeframe 90d on a panel set to auto-refresh every 60s.", state: "cleared", clearedAt: "2026-10-08T16:05:00Z", clearedBy: "Rosa Delgado", how: "Default reduced to 7d; the 90d view kept as a saved timeframe." },
      { id: "SS-1218", name: "Settlement break candidates", type: "Saved searches", app: "Payments Core", check: "throttle-bucket", detail: "No bucket predicate — the translated DQL scanned every bucket in the tenant.", state: "cleared", clearedAt: "2026-10-08T16:40:00Z", clearedBy: "Arjun Mehta", how: "Scoped to `wu_payments_*` via the global mapping rule." },
      { id: "AL-1072", name: "Ingest lag over threshold", type: "Alerts", app: "Platform Shared Services", check: "throttle-bucket", detail: "Unscoped bucket selection on a 1-minute alert evaluation.", state: "cleared", clearedAt: "2026-10-08T17:10:00Z", clearedBy: "Arjun Mehta", how: "Scoped to `wu_platform_logs`." },
      { id: "DS-1077", name: "Payment Channel Mix", type: "Dashboards", app: "Payments Core", check: "throttle-timeframe", detail: "Default timeframe 30d, above the customer's 14d configured limit for dashboard defaults.", state: "cleared", clearedAt: "2026-10-09T08:15:00Z", clearedBy: "Rosa Delgado", how: "Default reduced to 14d." },
      { id: "SS-1330", name: "Corridor failure reasons", type: "Saved searches", app: "Payments Core", check: "throttle-bucket", detail: "Unscoped bucket selection inherited from a macro that did not carry a scope.", state: "cleared", clearedAt: "2026-10-09T08:50:00Z", clearedBy: "Arjun Mehta", how: "Fixed in the macro, which cleared three other assets at the same time." },
    ],
    2: [
      { id: "DS-2033", name: "Model Score Distribution", type: "Dashboards", app: "Fraud & Risk", check: "throttle-bucket", detail: "Unscoped bucket selection across the fraud and sanctions buckets.", state: "cleared", clearedAt: "2026-10-14T11:30:00Z", clearedBy: "Claire Dubois", how: "Scoped to `wu_fraud_scoring`." },
      { id: "AL-2088", name: "Screening backlog rising", type: "Alerts", app: "Sanctions Screening", check: "dataflow", detail: "`wu_sanctions` received no data for 6h before publish — the forwarder had not been repointed.", state: "cleared", clearedAt: "2026-10-14T15:45:00Z", clearedBy: "Claire Dubois", how: "Forwarder repointed by the customer; check re-run and passed." },
      { id: "DS-2061", name: "Risk Decision Latency", type: "Dashboards", app: "Fraud & Risk", check: "throttle-timeframe", detail: "Default timeframe 90d on an eight-panel dashboard.", state: "cleared", clearedAt: "2026-10-15T09:05:00Z", clearedBy: "Rosa Delgado", how: "Default reduced to 7d." },
      { id: "SS-2102", name: "Watchlist hit volume by list", type: "Saved searches", app: "Sanctions Screening", check: "throttle-bucket", detail: "Unscoped bucket selection on a search scheduled every 5 minutes.", state: "cleared", clearedAt: "2026-10-15T09:40:00Z", clearedBy: "Arjun Mehta", how: "Scoped to `wu_sanctions`." },
    ],
    /* Fourteen open findings. Nine of them are the same mistake — a mapping
       rule that scopes buckets was applied to Waves 1–2 and not carried into
       the Wave 3 rule set — which is why the fix for most of this list is one
       change in Global Mapping rather than fourteen edits here.

       Every one of the fourteen is drawn from the wave's ready population —
       assets that cleared validation — and none is an asset already open in
       Exceptions. In the real product an asset could certainly be both
       blocked in translation AND fail the check, but modelling that here
       would make the same asset a member of two segments of the same bar,
       and a deployment bar whose segments overlap is worth less than the
       realism it buys. The held count is a clean subset of `ready`. */
    3: [
      { id: "DS-3011", name: "Treasury Position Intraday", type: "Dashboards", app: "Treasury Ops", check: "throttle-bucket", detail: "No bucket predicate. Twelve panels, each scanning every bucket in the tenant on a 5-minute refresh.", state: "held" },
      { id: "DS-3024", name: "Nostro Balance Monitor", type: "Dashboards", app: "Treasury Ops", check: "throttle-bucket", detail: "No bucket predicate. Inherited from `wu_treasury_base`, which was never scoped.", state: "held" },
      { id: "DS-3038", name: "Liquidity Coverage Intraday", type: "Dashboards", app: "Treasury Ops", check: "throttle-bucket", detail: "No bucket predicate on six of nine panels.", state: "held" },
      { id: "DS-3112", name: "Reconciliation Break Ageing", type: "Dashboards", app: "Settlement & Reconciliation", check: "throttle-bucket", detail: "No bucket predicate on all fourteen panels.", state: "held" },
      { id: "SS-3140", name: "Unmatched settlement ageing", type: "Saved searches", app: "Settlement & Reconciliation", check: "throttle-bucket", detail: "No bucket predicate on a search scheduled every 10 minutes.", state: "held" },
      { id: "SS-3155", name: "Nostro break candidates", type: "Saved searches", app: "Settlement & Reconciliation", check: "throttle-bucket", detail: "No bucket predicate.", state: "held" },
      { id: "AL-3211", name: "Nostro balance below floor", type: "Alerts", app: "Treasury Ops", check: "throttle-bucket", detail: "No bucket predicate on a 1-minute alert evaluation — the heaviest shape in the wave.", state: "held" },
      { id: "AL-3217", name: "FX rate staleness", type: "Alerts", app: "FX Pricing", check: "throttle-bucket", detail: "No bucket predicate. Evaluates every 60s against the whole estate.", state: "held" },
      { id: "AL-3244", name: "Settlement cut-off breach", type: "Alerts", app: "Settlement & Reconciliation", check: "throttle-bucket", detail: "No bucket predicate.", state: "held" },
      { id: "DS-3052", name: "FX Spread Analysis", type: "Dashboards", app: "FX Pricing", check: "throttle-timeframe", detail: "Default timeframe 90d across all panels, against a 14d configured limit.", state: "held" },
      { id: "DS-3061", name: "Treasury Daily Summary", type: "Dashboards", app: "Treasury Ops", check: "throttle-timeframe", detail: "Default timeframe 90d with auto-refresh on.", state: "held" },
      { id: "SS-3172", name: "FX exposure by corridor", type: "Saved searches", app: "FX Pricing", check: "throttle-timeframe", detail: "Default timeframe 90d on a search scheduled hourly.", state: "held" },
      { id: "DS-3088", name: "Settlement Finality Tracker", type: "Dashboards", app: "Settlement & Reconciliation", check: "dataflow", detail: "`wu_settlement_events` has received nothing since Oct 16. The source index is still writing to the old forwarder.", state: "held" },
      { id: "AL-3260", name: "Settlement finality delayed", type: "Alerts", app: "Settlement & Reconciliation", check: "dataflow", detail: "Reads `wu_settlement_events`, same silent bucket. Would publish clean and never fire.", state: "held" },
    ],
    4: [],
  };

  D.findingsFor = function (waveId) {
    if (!waveId || waveId === "all") {
      return Object.keys(D.findings).reduce((a, k) => a.concat(D.findings[k].map((f) => Object.assign({ wave: Number(k) }, f))), []);
    }
    return (D.findings[waveId] || []).map((f) => Object.assign({ wave: Number(waveId) }, f));
  };

  /* Has the check run for this wave at all? The metric is about waves never
     skipping it, so "not run yet" has to be a distinct answer from "ran and
     found nothing" — otherwise an un-run wave reports as clean, which is the
     one reading that would make the metric unauditable.

     Keyed off a recorded run in the deployment record, NOT off the wave's
     stage status. Wave 4 has validated assets and zero findings; inferring
     "clear" from that would claim a check that never happened. A wave is
     checked when there is an event saying so. */
  D.checkState = function (waveId) {
    const w = waveRow(waveId);
    if (!w) return "not-run";
    const ran = D.events.some((e) => e.kind === "check" && String(e.wave) === String(w.id));
    if (!ran) return "not-run";
    const open = D.findingsFor(waveId).filter((f) => f.state === "held").length;
    return open ? "holding" : "clear";
  };

  /* --- Tenant-side rejections -----------------------------------------------
     The write was attempted and refused. Only waves that have actually written
     to a tenant can have these, which is why 3 and 4 are absent rather than
     empty — there has been no write to reject.

     The three outstanding rows are all assets Exceptions marked `resolved`,
     never `published`, so counting them as rejected here cannot double-count
     against the live population. An asset that is fixed, submitted, and
     refused by the tenant is a state this product can genuinely reach and
     nothing else in the prototype shows it. ------------------------------- */
  D.rejections = {
    1: [
      { id: "DS-1031", name: "Payment Corridor Exceptions", type: "Dashboards", app: "Payments Core", reason: "ownership", at: "2026-10-09T10:42:00Z", detail: "Owner `acme-payments-ops` does not exist in the target tenant — the Splunk role had no mapping.", state: "resolved", resolvedAt: "2026-10-09T13:15:00Z", how: "Owner mapped to `ACME Payments Operations` in the target directory; write retried and accepted." },
      { id: "AL-1072", name: "Ingest lag over threshold", type: "Alerts", app: "Platform Shared Services", reason: "rbac", at: "2026-10-09T10:44:00Z", detail: "The publishing service account had no write permission on the alerting namespace.", state: "resolved", resolvedAt: "2026-10-09T11:50:00Z", how: "Permission granted by the customer's tenant admin; write retried and accepted." },
      { id: "SS-1218", name: "Settlement break candidates", type: "Saved searches", app: "Payments Core", reason: "bucket", at: "2026-10-09T10:44:00Z", detail: "Write to `wu_payments_archive` refused — bucket exists but is read-only for the service account.", state: "resolved", resolvedAt: "2026-10-09T12:30:00Z", how: "Bucket permission corrected; write retried and accepted." },
    ],
    2: [
      { id: "DS-2014", name: "Screening Throughput & Backlog", type: "Dashboards", app: "Sanctions Screening", reason: "ownership", at: "2026-10-18T09:12:00Z", detail: "Fixed in Exceptions and submitted automatically. Owner `acme-sanctions-l2` has no mapping in the target directory.", state: "open" },
      { id: "LK-2101", name: "fx_rates_intraday.csv", type: "Lookups", app: "Treasury Ops", reason: "bucket", at: "2026-10-18T09:12:00Z", detail: "Rebuilt by hand and submitted. The target table `wu_fx_rates` does not exist — it was never provisioned, because this lookup had no automated path to create it.", state: "open" },
      { id: "MC-1047", name: "`wu_biz_hours`", type: "Macros", app: "Platform Shared Services", reason: "rbac", at: "2026-10-18T09:13:00Z", detail: "Rebuilt by hand and submitted. Writing a shared function requires tenant-admin scope the publishing account does not hold.", state: "open" },
      { id: "DS-2061", name: "Risk Decision Latency", type: "Dashboards", app: "Fraud & Risk", reason: "ownership", at: "2026-10-15T11:20:00Z", detail: "Owner group unmapped at first write.", state: "resolved", resolvedAt: "2026-10-15T12:05:00Z", how: "Group mapped; write retried and accepted." },
      { id: "AL-2088", name: "Screening backlog rising", type: "Alerts", app: "Sanctions Screening", reason: "rbac", at: "2026-10-15T11:20:00Z", detail: "Alerting namespace write permission missing for the sanctions scope.", state: "resolved", resolvedAt: "2026-10-15T14:40:00Z", how: "Permission granted; write retried and accepted." },
    ],
  };

  D.REJECTION_REASONS = {
    ownership: { label: "Ownership mapping", detail: "The asset's owner has no equivalent principal in the target tenant.", fix: "Map the owner in the target directory. This is a Prepare Environment action, not a DQL correction.", icon: "users" },
    rbac: { label: "Permission", detail: "The publishing service account lacks the scope the write requires.", fix: "Granted by the customer's tenant admin. DMA cannot grant it to itself.", icon: "lock" },
    bucket: { label: "Bucket / table", detail: "The write target does not exist, or exists and is not writable.", fix: "Provision or correct the target. For a hand-built prerequisite, nothing upstream created it.", icon: "database" },
  };

  D.rejectionsFor = function (waveId) {
    if (!waveId || waveId === "all") {
      return Object.keys(D.rejections).reduce((a, k) => a.concat(D.rejections[k].map((r) => Object.assign({ wave: Number(k) }, r))), []);
    }
    return (D.rejections[waveId] || []).map((r) => Object.assign({ wave: Number(waveId) }, r));
  };

  /* --- Live and wrong --------------------------------------------------------
     Read straight out of Exceptions rather than restated, because these are
     the same four assets that stage calls its `validate-live` stream. Deploy's
     interest in them is different: Exceptions cares that they need fixing,
     Deploy cares that the fix has to be written over a live object.

     `redeploy` is the one that is ready to go back out; the rest are still
     being worked and are live and wrong in the meantime. -------------------- */
  /* Exceptions stores an application key; the rest of this file carries the
     application's display name, because that is what Deploy's own fixtures
     carry and a table with "sanctions" in one row and "Sanctions Screening"
     in the next reads as two different applications. Planning owns the
     mapping, so ask it rather than keeping a second copy here. */
  const appName = (key) => {
    const a = DMA.data.planning && DMA.data.planning.appById(key);
    return (a && a.name) || key;
  };

  D.liveAndWrong = function (waveId) {
    const all = (X().assets || []).filter((a) => a.stream === "validate-live");
    const scoped = !waveId || waveId === "all" ? all : all.filter((a) => String(a.wave) === String(waveId));
    return scoped.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      app: appName(a.app),
      wave: a.wave,
      state: a.state,
      /* DONE_STATES would also count `published`, which for this stream means
         the redeploy already happened. `resolved` is the waiting room. */
      awaitingRedeploy: a.state === "resolved",
      tenant: (waveRow(a.wave) || {}).env || "—",
    }));
  };

  /* --- Per-wave deployment state --------------------------------------------
     Everything here is re-derived from the stage that produced it. The only
     literals are the fixtures above, which describe things no other stage
     knows about: what the health check found, and what the tenant refused. */
  D.waveDeploy = function (waveId) {
    const w = waveRow(waveId);
    if (!w) return null;

    const reached = DMA.data.waveStageStatus(w, "validate") !== "not-started";
    const ex = X().hasQueue(w.id) ? X().estate(String(w.id)) : null;

    /* A wave that has not translated has no publish population yet — not a
       population of zero. Returning the shape with nulls rather than zeros
       keeps "not started" renderable instead of reporting a clean sweep. */
    if (!reached) {
      return {
        wave: w,
        reached: false,
        tenant: null,
        population: null, live: 0, ready: 0, awaitingCheck: 0, held: 0, pending: null,
        translatable: null, prerequisites: null, handBuilt: null, provisioned: null,
        openVerdicts: 0, inExceptions: ex ? ex.open : 0,
        findings: [], checkState: "not-run",
      };
    }

    const run = T().runFor(w.id);
    const cmp = V().comparisonFor(w.id);

    const translatable = run.ran;
    const prerequisites = w.assets - run.ran;
    const handBuilt = ex ? ex.streams["no-equivalent"] : 0;
    const provisioned = prerequisites - handBuilt;
    const population = translatable + handBuilt;

    const needsAttention = cmp.difference + cmp.uncertain;
    const published = w.status === "published";

    /* Only a wave that has gone out can have dispositioned its own review
       queue. For 3 and 4 the whole of needsAttention is still open, which is
       what makes validation's project-level `open: 156` reconcile. */
    const toExceptions = ex ? ex.streams["validate-triage"] : 0;
    const overridden = published ? needsAttention - toExceptions : 0;
    const openVerdicts = published ? 0 : needsAttention;

    const fromExceptions = ex ? ex.states.published : 0;
    const live = published ? cmp.match + overridden + fromExceptions : 0;

    const findings = D.findingsFor(w.id);
    const held = findings.filter((f) => f.state === "held").length;
    const checkState = D.checkState(w.id);

    /* "Ready" means cleared validation AND cleared the check — not just the
       first of the two. Wave 4 has 360 assets through validation and no check
       run against them; calling those ready would quietly promise they are
       deployable, which is the claim the check exists to stop anyone making.
       They are `awaitingCheck` instead, and the two never overlap. */
    const checked = checkState !== "not-run";
    const ready = published || !checked ? 0 : Math.max(0, cmp.match - held);
    const awaitingCheck = published || checked ? 0 : cmp.match;

    return {
      wave: w,
      reached: true,
      tenant: D.tenantFor(w),
      population,
      translatable,
      prerequisites,
      handBuilt,
      provisioned,
      autoApproved: cmp.match,
      overridden,
      fromExceptions,
      live,
      ready,
      awaitingCheck,
      held,
      /* Derived by subtraction on purpose. These four segments plus `upstream`
         ARE the publish population, so the bar cannot be drawn with a gap or
         an overlap no matter what the other numbers do. Everything in here is
         still waiting on a verdict or still being worked in Exceptions — one
         segment, because from Deploy's point of view they are the same answer:
         not this stage's to move. */
      upstream: population - live - ready - awaitingCheck - held,
      openVerdicts,
      inExceptions: ex ? ex.open : 0,
      pending: population - live,
      findings,
      checkState,
      rejections: D.rejectionsFor(w.id),
      openRejections: D.rejectionsFor(w.id).filter((r) => r.state === "open").length,
      liveAndWrong: D.liveAndWrong(w.id),
    };
  };

  /* --- Estate roll-up --------------------------------------------------------
     Summed from waveDeploy rather than stated, so a change to any wave moves
     the headline without anyone remembering to update it. ------------------ */
  D.estate = function () {
    const rows = PR().waves.map((w) => D.waveDeploy(w.id)).filter(Boolean);
    const add = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    return {
      waves: rows.length,
      wavesLive: rows.filter((r) => r.live > 0).length,
      live: add("live"),
      ready: add("ready"),
      awaitingCheck: add("awaitingCheck"),
      held: add("held"),
      openVerdicts: add("openVerdicts"),
      inExceptions: add("inExceptions"),
      openRejections: add("openRejections"),
      liveAndWrong: D.liveAndWrong("all").length,
      awaitingRedeploy: D.liveAndWrong("all").filter((a) => a.awaitingRedeploy).length,
      /* The check's own metric, stated the way the PRD states it. */
      wavesChecked: PR().waves.filter((w) => D.checkState(w.id) !== "not-run").length,
      wavesSkipped: 0,
    };
  };

  /* --- Deployment record -----------------------------------------------------
     The delivered platform "records publish status for audit and reporting",
     so this is the shipped capability rather than a roadmap one. Written as
     events rather than a status column because the interesting questions are
     all temporal: when did it go, how long did it take, what came back. ---- */
  D.events = [
    { at: "2026-10-18T09:13:00Z", wave: 2, kind: "rejected", actor: "DMA", text: "3 assets submitted from Exceptions were refused by wun-staging — 2 ownership, 1 permission" },
    { at: "2026-10-18T09:12:00Z", wave: 2, kind: "submitted", actor: "DMA", text: "3 assets cleared in Exceptions submitted to wun-staging" },
    { at: "2026-10-17T06:00:00Z", wave: 3, kind: "check", actor: "DMA", text: "Pre-deploy health check ran over Wave 3's 375 ready assets — 14 held, 361 cleared" },
    { at: "2026-10-15T14:10:00Z", wave: 2, kind: "deployed", actor: "Rosa Delgado", text: "Wave 2 deployed to wun-staging — 456 assets written in 18m 40s" },
    { at: "2026-10-15T11:20:00Z", wave: 2, kind: "rejected", actor: "DMA", text: "2 assets refused on first write — both resolved and retried within 3h" },
    { at: "2026-10-15T09:40:00Z", wave: 2, kind: "check", actor: "DMA", text: "Pre-deploy health check cleared for Wave 2 — 4 findings resolved, 0 held" },
    { at: "2026-10-09T13:15:00Z", wave: 1, kind: "resolved", actor: "Arjun Mehta", text: "Last of 3 tenant rejections resolved — Wave 1 fully landed" },
    { at: "2026-10-09T10:42:00Z", wave: 1, kind: "rejected", actor: "DMA", text: "3 assets refused on first write — ownership, permission, bucket" },
    { at: "2026-10-09T10:30:00Z", wave: 1, kind: "deployed", actor: "Martin Hale", text: "Wave 1 deployed to wun-prod after customer sign-off — 402 assets written in 14m 05s" },
    { at: "2026-10-09T08:50:00Z", wave: 1, kind: "check", actor: "DMA", text: "Pre-deploy health check cleared for Wave 1 — 6 findings resolved, 0 held" },
  ];

  D.EVENT_TONE = {
    deployed: "success",
    resolved: "success",
    submitted: "info",
    check: "info",
    rejected: "critical",
  };

  D.eventsFor = function (waveId) {
    if (!waveId || waveId === "all") return D.events;
    return D.events.filter((e) => String(e.wave) === String(waveId));
  };

  /* --- Self-check ------------------------------------------------------------
     Deploy's populations are derived from three other stages. If any of them
     changes shape, this is where it should be noticed — on load, loudly —
     rather than three screens later as a number nobody can source. ---------- */
  D.assertTotals = function () {
    const out = [];
    const v = V().estate();
    const rows = PR().waves.map((w) => D.waveDeploy(w.id)).filter(Boolean);
    const published = rows.filter((r) => r.wave.status === "published");

    const auto = published.reduce((a, r) => a + r.autoApproved, 0);
    if (auto !== v.liveAutoApproved) out.push(`auto-approved live ${auto} ≠ validation ${v.liveAutoApproved}`);

    const over = published.reduce((a, r) => a + r.overridden, 0);
    if (over !== v.overridden) out.push(`overridden ${over} ≠ validation ${v.overridden}`);

    const live = published.reduce((a, r) => a + r.live, 0);
    const fromEx = published.reduce((a, r) => a + r.fromExceptions, 0);
    if (live !== v.livePopulation + fromEx) {
      out.push(`live ${live} ≠ validation livePopulation ${v.livePopulation} + ${fromEx} from Exceptions`);
    }

    const exPublished = X().estate("all").states.published;
    if (fromEx !== exPublished) out.push(`from Exceptions ${fromEx} ≠ exceptions published ${exPublished}`);

    /* The claim the whole stage rests on: the check holds assets, not waves. */
    const w3 = D.waveDeploy(3);
    if (w3 && w3.held >= w3.autoApproved) out.push(`Wave 3 held ${w3.held} is not a subset of ${w3.autoApproved} ready`);

    /* The deployment bar is five segments over one population. If subtraction
       ever goes negative the bar is lying, and it should say so here first. */
    rows.forEach((r) => {
      if (!r.reached) return;
      if (r.upstream < 0) out.push(`Wave ${r.wave.id} upstream ${r.upstream} is negative — segments exceed the population`);
      const sum = r.live + r.ready + r.awaitingCheck + r.held + r.upstream;
      if (sum !== r.population) out.push(`Wave ${r.wave.id} segments ${sum} ≠ population ${r.population}`);
    });

    if (out.length) console.warn("[deploy] drift:", out.join(" · "));
    return out;
  };
})();
