/* ============================================================================
   Validate — Asset-to-Asset Validation fixtures.
   ----------------------------------------------------------------------------
   Owned by modules/validate. No other module reads this file.

   ----------------------------------------------------------------------------
   THE RECONCILIATION (read this before changing a number)

   `DMA.data.project.validation` used to say 2,400 auto-approved + 412
   meaningful differences + 143 uncertain = 2,955. That total is the whole
   estate, and it cannot be right: Validate can only compare assets that
   Translate produced runnable DQL for, and only Waves 1–4 have run.

   The chain, end to end:

     2,955  assets in scope            project.assets.total
     2,584  translatable               translation.typeSplit()   (371 are
                                       lookups and macros — prerequisites,
                                       not translations)
     2,569  translatable inside a wave translation.estate().inWave
     1,864  actually ran (Waves 1–4)   translation.estate().ran
     1,751  produced runnable DQL      translation.estate().translated
     ─────
     1,751  THE INPUT TO THIS STAGE

   The other 113 were blocked in Translate and went straight to Exceptions.
   They never reach a comparator, because there is nothing to compare.

   81.2% of 1,751 is 1,422. That rate is the locked figure Translate cites on
   its "two numbers that are not the same number" card, so the rate is held and
   the counts are re-derived under it rather than the other way round.

   project.validation now carries 1,422 / 243 / 86. It stays a literal there
   because data/project.js loads first and cannot read this file; assertTotals()
   below re-derives it from the per-wave rows so the two can never drift
   silently.

   ----------------------------------------------------------------------------
   TWO SURFACES, NOT ONE QUEUE

   A human can disagree with the machine in both directions, and the two
   disagreements are different events at different times:

     PRE-DEPLOY TRIAGE   machine said FAIL, asset is not live.
                         Human overrides (publish anyway, reason + owner
                         required) or sends it to Exceptions for rework.

     POST-DEPLOY REVIEW  machine said PASS, asset is already live in the
                         customer's tenant. Human confirms, or fails it with a
                         comment — which routes a LIVE asset to the manual
                         translation and validation workflow.

   The P1 PRD is explicit that these "may need different UI flows and different
   redeploy mechanics, not a single shared screen." Merging them into one table
   would flatten the difference between "not yet shipped" and "shipped and
   wrong", which is the single most important distinction on this stage.

   ----------------------------------------------------------------------------
   WHAT LIVES HERE AND WHAT DOES NOT

   Validate owns the VERDICT and the ROUTING DECISION. Exceptions owns the
   REWORK. There is no DQL editor, no natural-language context box and no
   re-translate button in this module — all three belong to stage 8, and
   features.js attributes them there. A failed review captures the comment and
   hands off.

   There is also no side-by-side diff. Similarity Score + Diff View is P2; the
   P0 feature this stage implements asks for a persisted confidence score (F-3)
   and a SPECIFIC written finding (F-5) — "returns 12,400 rows in Splunk and
   9,810 in Dynatrace for the same time range", never a generic "different".
   Every finding below is written to that bar.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

(function () {
  "use strict";

  /* --- The comparison signals (PRD F-6: asset-type aware) ----------------- */
  const SIGNALS = [
    {
      id: "result",
      label: "Query-result equivalence",
      detail: "Runs both queries over the same window and compares the rows that come back.",
      types: ["Dashboards", "Alerts", "Saved searches"],
    },
    {
      id: "structure",
      label: "Structural equivalence",
      detail: "Compares the shape of the query — fields produced, grouping, aggregation, sort order.",
      types: ["Dashboards", "Alerts", "Saved searches"],
    },
    {
      id: "dependency",
      label: "Dependency resolution",
      detail: "Confirms every lookup, macro and field the asset references resolves in the target.",
      types: ["Dashboards", "Alerts", "Saved searches"],
    },
    {
      id: "layout",
      label: "Visual layout match",
      detail: "Compares panel geometry, chart type and axis configuration. Dashboards only.",
      types: ["Dashboards"],
    },
    {
      id: "firing",
      label: "Firing behaviour",
      detail: "Replays the alert over 30 days of history and compares when each side would have fired.",
      types: ["Alerts"],
    },
  ];

  /* An asset is never scored on a signal that does not apply to it. A saved
     search has no layout and never fires; scoring it on four signals and
     silently passing two would inflate every confidence number on the page. */
  const signalsFor = (type) => SIGNALS.filter((s) => s.types.includes(type));

  /* --- The three classifications (PRD: every asset resolves to exactly one) */
  const CLASSES = {
    match: {
      label: "Match",
      short: "Match",
      tone: "success",
      icon: "check",
      detail: "Auto-approved. No human sees it unless they go looking.",
    },
    difference: {
      label: "Meaningful difference",
      short: "Difference",
      tone: "warning",
      icon: "alert",
      detail: "Routed with a written finding naming what differs and why.",
    },
    uncertain: {
      label: "Uncertain",
      short: "Uncertain",
      tone: "critical",
      icon: "helpCircle",
      detail: "Routed with a low-confidence flag. The comparison will not guess.",
    },
  };

  /* --- Human verdicts, pre-deploy ----------------------------------------- */
  const VERDICTS = {
    override: {
      label: "Overridden",
      tone: "info",
      icon: "shield",
      detail: "Published despite the finding. Requires a named owner and a reason.",
    },
    exception: {
      label: "Sent to Exceptions",
      tone: "warning",
      icon: "arrowRight",
      detail: "Handed to the manual translation and validation workflow for rework.",
    },
  };

  /* --- Human reviews, post-deploy ----------------------------------------- */
  const REVIEWS = {
    confirmed: { label: "Confirmed live", tone: "success", icon: "check", detail: "A human looked at it in the tenant and agreed." },
    failed: { label: "Failed on review", tone: "critical", icon: "x", detail: "Live and wrong. Routed to Exceptions with the reviewer's comment." },
  };

  /* --- Who reviewed -------------------------------------------------------
     There is no persona switcher in this prototype and there is not going to
     be one. The customer's review is not a different VIEW, it is a different
     VALUE in this field — which is also what the PRD's immutable audit log
     (F-7) requires us to persist anyway. One screen, attributed rows. */
  const REVIEWERS = {
    dma: { name: "DMA", role: "system", label: "DMA" },
    rosa: { name: "Rosa Delgado", role: "consultant", label: "Lead consultant" },
    claire: { name: "Claire Dubois", role: "consultant", label: "Consultant" },
    arjun: { name: "Arjun Mehta", role: "consultant", label: "Consultant" },
    ravi: { name: "Ravi Anand", role: "customer", label: "Observability Lead, Acme Corp" },
    hanna: { name: "Hanna Nowak", role: "customer", label: "Treasury Platform Owner, Acme Corp" },
    martin: { name: "Martin Hale", role: "epm", label: "Engagement PM" },
  };

  const ROLE_TONE = { system: "neutral", consultant: "info", customer: "success", epm: "warning" };

  /* --- Per-wave comparison runs -------------------------------------------
     One row per wave that has translated. `validated` is clean + retried from
     that wave's translation run — see the reconciliation note at the top.

     The rate climbs 77.9 → 81.6 → 82.1 → 83.0 across the four waves. Wave 1
     landing at 77.9% is not a coincidence in the fixture: Calibrate predicted
     78.0% ±2.4 off a 214-asset sample, and the first real wave came in inside
     that band. That is the Calibrate stage collecting on its own claim, and it
     is the reason the prediction is worth making at all. */
  const comparisons = [
    { wave: 1, ranAt: "2026-10-06T14:20:00Z", validated: 398, match: 310, difference: 65, uncertain: 23, medianConfidence: 0.94, durationLabel: "22 min" },
    { wave: 2, ranAt: "2026-10-12T09:05:00Z", validated: 462, match: 377, difference: 62, uncertain: 23, medianConfidence: 0.95, durationLabel: "26 min" },
    { wave: 3, ranAt: "2026-10-17T11:22:00Z", validated: 457, match: 375, difference: 61, uncertain: 21, medianConfidence: 0.96, durationLabel: "25 min" },
    { wave: 4, ranAt: "2026-10-19T16:48:00Z", validated: 434, match: 360, difference: 55, uncertain: 19, medianConfidence: 0.96, durationLabel: "24 min" },
  ];

  /* --- Pre-deploy triage disposition --------------------------------------
     What happened to the difference + uncertain assets. Waves 1–2 were worked
     through before they published; Waves 3–4 are still open, which is what
     this stage has a reviewer for today. */
  const triage = [
    { wave: 1, overridden: 21, toExceptions: 67, open: 0 },
    { wave: 2, overridden: 17, toExceptions: 68, open: 0 },
    { wave: 3, overridden: 0, toExceptions: 0, open: 82 },
    { wave: 4, overridden: 0, toExceptions: 0, open: 74 },
  ];

  /* --- Post-deploy live review --------------------------------------------
     Only published waves have a population here, because the surface only
     exists for assets that are already in the customer's tenant.

     `population` is deliberately derived, not stored: it is everything that
     reached the tenant with a PASS of some kind — the machine's matches plus
     the humans' overrides. The overrides belong in it precisely because they
     are the assets nobody could prove were right.

     The numbers are small on purpose. 4 reversals out of 198 spot-checks is
     the whole point of the stage: the PRD's UX goal is "quiet by default", and
     a post-deploy queue with hundreds of rows in it would mean auto-approval
     had failed. */
  const live = [
    { wave: 1, deployedAt: "2026-10-09", reviewed: 96, confirmed: 94, failed: 2, failedFrom: { match: 1, override: 1 } },
    { wave: 2, deployedAt: "2026-10-15", reviewed: 102, confirmed: 100, failed: 2, failedFrom: { match: 2, override: 0 } },
  ];

  /* --- Asset sample --------------------------------------------------------
     A fixture, not the population — the same convention Translate uses. Every
     row opens. `app` ids match planning.placement so a row's wave is never
     asserted independently of the plan.

     `finding` is mandatory on anything routed. The PRD's F-5 bar is that a
     reviewer should not have to re-derive what the system already knew, so
     "different" is never an acceptable value here. Matches carry `evidence`
     instead — shorter, but present, because an auto-approval that cannot be
     defended three months later is the failure mode Scenario D describes. */
  const assets = [
    /* ---- Wave 1 — Foundation (published Oct 9) --------------------------- */
    { id: "DS-1001", name: "Platform Health — Core Services", type: "Dashboards", app: "platform-shared", wave: 1, cls: "match", confidence: 0.97,
      evidence: "18 of 18 panels returned identical row counts over a 7-day window. Chart types, axes and panel geometry unchanged.",
      live: true, review: { decision: "confirmed", by: "ravi", at: "2026-10-12T10:15:00Z" } },

    { id: "AL-1004", name: "Payment Gateway Latency > 2s", type: "Alerts", app: "payments-core", wave: 1, cls: "match", confidence: 0.96,
      evidence: "Replayed over 30 days: 41 firings in Splunk, 41 in Dynatrace, every one inside the same evaluation window.",
      live: true, review: { decision: "confirmed", by: "ravi", at: "2026-10-12T10:31:00Z" } },

    { id: "SS-1007", name: "Daily Settlement Volume by Corridor", type: "Saved searches", app: "payments-core", wave: 1, cls: "match", confidence: 0.98,
      evidence: "4,212 rows on both sides over the same 24-hour window, identical ordering.",
      live: true, review: null },

    { id: "DS-1012", name: "Payments Core — Throughput", type: "Dashboards", app: "payments-core", wave: 1, cls: "match", confidence: 0.93,
      evidence: "12 of 12 panels matched on data. One panel's y-axis range differs because Dynatrace auto-scales where Splunk had a fixed maximum; the underlying series is identical.",
      live: true, review: null },

    { id: "AL-1019", name: "Auth Service Error Budget Burn", type: "Alerts", app: "platform-shared", wave: 1, cls: "match", confidence: 0.95,
      evidence: "Replayed over 30 days: 7 firings on each side, same timestamps.",
      live: true,
      review: { decision: "failed", by: "ravi", at: "2026-10-17T08:50:00Z",
        comment: "The query and the threshold are both right — it fires on exactly the right condition. But the notification routes to the old Splunk on-call schedule, so nobody was paged when it burned on Oct 16. Comparison can't see that, and it shouldn't be expected to." } },

    { id: "SS-1023", name: "Index Ingest Volume — 30d", type: "Saved searches", app: "platform-shared", wave: 1, cls: "match", confidence: 0.99,
      evidence: "Identical row count and identical values across all 30 buckets.",
      live: true, review: { decision: "confirmed", by: "rosa", at: "2026-10-11T16:02:00Z" } },

    { id: "DS-1031", name: "Payment Corridor Exceptions", type: "Dashboards", app: "payments-core", wave: 1, cls: "difference", confidence: 0.71,
      finding: "Returns 12,400 rows in Splunk and 9,810 in Dynatrace for the same 24-hour window. The source counts each retry attempt as its own transaction; the DQL groups by transaction id, so a payment retried three times collapses to one row.",
      live: false,
      verdict: { decision: "exception", by: "rosa", at: "2026-10-07T11:40:00Z",
        comment: "This is a real semantic change, not a tolerance. Operations reconcile against the retry count. Needs the grouping removed and re-translating." } },

    { id: "AL-1036", name: "Payment Queue Depth Sustained", type: "Alerts", app: "payments-core", wave: 1, cls: "difference", confidence: 0.74,
      finding: "Would have fired 6 times in Splunk and 9 times in Dynatrace over the same 30 days. The three extra firings all fall in a nightly window where the source alert was suppressed.",
      live: true,
      verdict: { decision: "override", by: "ravi", at: "2026-10-08T09:12:00Z",
        reason: "The three extra firings are inside our 02:00–03:00 batch window. The condition is correct — suppression is configured in the tenant, not in the query, and we'll add it there. Publishing as-is." },
      review: { decision: "failed", by: "ravi", at: "2026-10-18T07:05:00Z",
        comment: "I was wrong. The suppression was never added in the tenant and three real pages went out at 02:00 on Oct 18. This is my override, not a translation fault — but it's live and it's wrong." } },

    { id: "SS-1042", name: "Biz-Hours Transaction Mix", type: "Saved searches", app: "platform-shared", wave: 1, cls: "uncertain", confidence: 0.52,
      finding: "The `biz_hours` macro resolves to a timezone the comparison cannot confirm. Both sides return 2,980 rows, but a two-hour offset would produce exactly the same count over different rows — so the match is not evidence.",
      live: true,
      verdict: { decision: "override", by: "rosa", at: "2026-10-08T14:20:00Z",
        reason: "Checked by hand against the Oct 3 ledger: 14 transactions sit in the disputed two hours and all 14 appear on both sides. This is the second of the two timezone assumptions Calibrate flagged in `biz_hours` and it resolves the same way." },
      review: { decision: "confirmed", by: "rosa", at: "2026-10-16T13:44:00Z" } },

    /* ---- Wave 2 — Core: Risk & Screening (published Oct 15) -------------- */
    { id: "DS-2001", name: "Fraud Signals — Realtime", type: "Dashboards", app: "fraud-risk", wave: 2, cls: "match", confidence: 0.97,
      evidence: "16 of 16 panels matched on data and layout over a 7-day window.",
      live: true, review: { decision: "confirmed", by: "hanna", at: "2026-10-17T09:20:00Z" } },

    { id: "AL-2005", name: "Sanctions List Sync Failure", type: "Alerts", app: "sanctions", wave: 2, cls: "match", confidence: 0.98,
      evidence: "Replayed over 30 days: 3 firings each side, same timestamps. Dependency check resolved the OFAC lookup in the target.",
      live: true, review: { decision: "confirmed", by: "hanna", at: "2026-10-17T09:28:00Z" } },

    { id: "SS-2009", name: "Card Decline Reasons — Top 20", type: "Saved searches", app: "card-services", wave: 2, cls: "match", confidence: 0.96,
      evidence: "Identical 20 rows in identical order over a 7-day window.",
      live: true, review: null },

    { id: "DS-2014", name: "Screening Throughput & Backlog", type: "Dashboards", app: "sanctions", wave: 2, cls: "match", confidence: 0.94,
      evidence: "11 of 11 panels matched on returned rows. Layout preserved.",
      live: true,
      review: { decision: "failed", by: "hanna", at: "2026-10-18T11:12:00Z",
        comment: "Panel 7 defaults to a 24-hour timeframe; the Splunk original opened on 7 days. The query is right and the comparison window was right, so it matched — but the thing on screen in the morning is not what the team used to look at." } },

    { id: "AL-2021", name: "Card Auth Success Rate < 97%", type: "Alerts", app: "card-services", wave: 2, cls: "match", confidence: 0.95,
      evidence: "Replayed over 30 days: 12 firings each side.",
      live: true,
      review: { decision: "failed", by: "ravi", at: "2026-10-19T10:40:00Z",
        comment: "Threshold is right but it evaluates every card type pooled. The original ran per BIN range and raised one alert per failing range — we've lost the split, so a single bad range never pulls the pooled number under 97%." } },

    { id: "SS-2027", name: "Chargeback Ratio by Merchant", type: "Saved searches", app: "fraud-risk", wave: 2, cls: "match", confidence: 0.99,
      evidence: "1,106 rows on both sides, identical values to four decimal places.",
      live: true, review: { decision: "confirmed", by: "arjun", at: "2026-10-16T15:55:00Z" } },

    { id: "DS-2033", name: "Model Score Distribution", type: "Dashboards", app: "fraud-risk", wave: 2, cls: "difference", confidence: 0.68,
      finding: "Nine of fourteen panels match. The five that differ all read `fraud_score_bucket`, which rounds to one decimal place in Splunk and two in DQL — every score sitting on a bucket boundary moves one bucket left.",
      live: false,
      verdict: { decision: "exception", by: "claire", at: "2026-10-13T10:05:00Z",
        comment: "Rounding is in the macro, so it is one fix for all five panels. Not an override — the distribution is what the model risk team signs off on." } },

    { id: "AL-2038", name: "Screening Queue SLA Breach", type: "Alerts", app: "sanctions", wave: 2, cls: "difference", confidence: 0.76,
      finding: "Would have fired 14 times in Splunk and 11 in Dynatrace over 30 days. All three missed firings fall in the 90-second gap between the source's 60-second schedule and the target's 150-second evaluation interval.",
      live: true,
      verdict: { decision: "override", by: "hanna", at: "2026-10-14T16:30:00Z",
        reason: "All three missed firings cleared on their own inside two minutes. The 60-second schedule was Splunk licensing habit, not a requirement — compliance only needs a breach held for 5 minutes. Publishing on the longer interval deliberately." },
      review: { decision: "confirmed", by: "hanna", at: "2026-10-19T08:15:00Z" } },

    { id: "SS-2044", name: "Watchlist Hit Reconciliation", type: "Saved searches", app: "sanctions", wave: 2, cls: "uncertain", confidence: 0.49,
      finding: "Depends on `fx_rates_intraday.csv`, which is rewritten every 15 minutes by an outputlookup search that could not be translated. The two sides disagree by 61 rows and the comparison cannot tell whether that is a translation fault or a table that has already gone stale.",
      live: false,
      verdict: { decision: "exception", by: "rosa", at: "2026-10-13T12:18:00Z",
        comment: "Not overridable. The table is stale by design until the writing search is rebuilt, so every future comparison on this asset is untrustworthy too, not just this one." } },

    /* ---- Wave 3 — Core: Treasury & Settlement (triage open) -------------- */
    { id: "DS-3001", name: "Treasury Liquidity — Intraday", type: "Dashboards", app: "treasury-ops", wave: 3, cls: "match", confidence: 0.96,
      evidence: "14 of 14 panels matched on data and layout over a 7-day window.", live: false, review: null },

    { id: "AL-3006", name: "Nostro Balance Breach", type: "Alerts", app: "treasury-ops", wave: 3, cls: "match", confidence: 0.97,
      evidence: "Replayed over 30 days: 9 firings each side, same timestamps.", live: false, review: null },

    { id: "SS-3011", name: "Settlement Break Ageing", type: "Saved searches", app: "settlement", wave: 3, cls: "match", confidence: 0.98,
      evidence: "687 rows on both sides, identical ageing buckets.", live: false, review: null },

    { id: "DS-3017", name: "Partner API Latency by Endpoint", type: "Dashboards", app: "partner-api", wave: 3, cls: "match", confidence: 0.95,
      evidence: "9 of 9 panels matched. Percentile calculations agree to three decimal places.", live: false, review: null },

    { id: "AL-3022", name: "Recon File Missing by 06:00", type: "Alerts", app: "settlement", wave: 3, cls: "match", confidence: 0.94,
      evidence: "Replayed over 30 days: 4 firings each side, all on the same dates.", live: false, review: null },

    { id: "DS-3029", name: "Correspondent Exposure", type: "Dashboards", app: "treasury-ops", wave: 3, cls: "difference", confidence: 0.72,
      finding: "Returns 1,840 rows in Splunk and 1,612 in Dynatrace over the same 7-day window. The 228-row gap is entirely counterparties with a null `legal_entity` — Splunk keeps them and shows them as blank, the DQL `filter` drops them.",
      live: false, verdict: null, review: null },

    { id: "AL-3034", name: "Settlement Cutoff Approaching", type: "Alerts", app: "settlement", wave: 3, cls: "difference", confidence: 0.78,
      finding: "Would have fired 22 times in Splunk and 19 in Dynatrace over 30 days. All three missed firings are on bank holidays, where the source alert read a calendar lookup that now resolves to an empty table.",
      live: false, verdict: null, review: null },

    { id: "SS-3041", name: "Partner Error Budget by Tenant", type: "Saved searches", app: "partner-api", wave: 3, cls: "difference", confidence: 0.69,
      finding: "Identical row count, but `error_rate` differs on 112 of 904 rows. Splunk divides errors by total requests; the DQL divides by successful requests, so any tenant above a 1% error rate reads high.",
      live: false, verdict: null, review: null },

    { id: "DS-3047", name: "Treasury Daily Pack", type: "Dashboards", app: "treasury-ops", wave: 3, cls: "uncertain", confidence: 0.54,
      finding: "Six of nineteen panels returned no rows on either side for the comparison window. An empty result matching an empty result is not evidence of equivalence, and the comparison will not report it as one.",
      live: false, verdict: null, review: null },

    { id: "AL-3052", name: "FX Exposure Limit", type: "Alerts", app: "treasury-ops", wave: 3, cls: "uncertain", confidence: 0.47,
      finding: "Neither side fired once in the 30-day replay, so firing behaviour could not be compared at all. Structural equivalence and dependency resolution both passed — that is two signals out of three for an alert, and the missing one is the one that matters.",
      live: false, verdict: null, review: null },

    /* ---- Wave 4 — Core: Compliance & Channels (triage open) -------------- */
    { id: "DS-4001", name: "Regulatory Reporting Status", type: "Dashboards", app: "compliance-rpt", wave: 4, cls: "match", confidence: 0.97,
      evidence: "13 of 13 panels matched on data and layout.", live: false, review: null },

    { id: "AL-4007", name: "SAR Filing Deadline", type: "Alerts", app: "compliance-rpt", wave: 4, cls: "match", confidence: 0.96,
      evidence: "Replayed over 30 days: 18 firings each side, same timestamps.", live: false, review: null },

    { id: "SS-4012", name: "Agent Cash Position", type: "Saved searches", app: "agent-network", wave: 4, cls: "match", confidence: 0.98,
      evidence: "3,480 rows on both sides, identical balances.", live: false, review: null },

    { id: "DS-4018", name: "Retail Channel Funnel", type: "Dashboards", app: "retail-channels", wave: 4, cls: "match", confidence: 0.93,
      evidence: "8 of 8 panels matched on data. One funnel step renders as a bar chart rather than the source's funnel visual — Dynatrace has no funnel type, and the series is identical.",
      live: false, review: null },

    { id: "AL-4024", name: "Agent Terminal Offline > 30m", type: "Alerts", app: "agent-network", wave: 4, cls: "match", confidence: 0.95,
      evidence: "Replayed over 30 days: 127 firings each side.", live: false, review: null },

    { id: "DS-4031", name: "AML Case Ageing", type: "Dashboards", app: "compliance-rpt", wave: 4, cls: "difference", confidence: 0.74,
      finding: "Eleven of sixteen panels match. The five that differ bucket on `case_opened_date`: Splunk buckets on local date, the DQL on UTC, which moves every case opened after 19:00 ET into the following day.",
      live: false, verdict: null, review: null },

    { id: "SS-4037", name: "Channel Attribution — 90d", type: "Saved searches", app: "retail-channels", wave: 4, cls: "difference", confidence: 0.66,
      finding: "Returns 8,904 rows in Splunk and 11,240 in Dynatrace. The DQL join does not deduplicate on `session_id`, so a session that touches three channels is counted three times instead of once.",
      live: false, verdict: null, review: null },

    { id: "AL-4043", name: "Agent Float Below Threshold", type: "Alerts", app: "agent-network", wave: 4, cls: "difference", confidence: 0.77,
      finding: "Would have fired 31 times in Splunk and 26 in Dynatrace over 30 days. The five missed firings are all agents whose `float_currency` is not USD — the threshold comparison is unit-blind in the target.",
      live: false, verdict: null, review: null },

    { id: "SS-4049", name: "Compliance Attestation Export", type: "Saved searches", app: "compliance-rpt", wave: 4, cls: "uncertain", confidence: 0.51,
      finding: "The query returns 2,104 identical rows on both sides, but the asset's purpose is the lookup it writes, and the target has no equivalent write. The comparison passed on the only thing it could see and that is not the thing the asset does.",
      live: false, verdict: null, review: null },

    { id: "DS-4055", name: "Retail Ops — Regional", type: "Dashboards", app: "retail-channels", wave: 4, cls: "uncertain", confidence: 0.58,
      finding: "Nine of twenty-two panels reference `region_map.csv`, which is not delivered until Wave 6. Both sides return rows, but every row resolves `region` to `unknown` — so the panels match each other and neither one is right.",
      live: false, verdict: null, review: null },
  ];

  /* ======================================================================== */

  const sumBy = (list, key) => list.reduce((a, r) => a + (r[key] || 0), 0);

  const comparisonFor = (waveId) => comparisons.find((c) => c.wave === Number(waveId)) || null;
  const triageFor = (waveId) => triage.find((t) => t.wave === Number(waveId)) || null;

  /* Derived, never stored — see the note on `live` above. */
  function liveFor(waveId) {
    const row = live.find((l) => l.wave === Number(waveId));
    if (!row) return null;
    const c = comparisonFor(waveId);
    const t = triageFor(waveId);
    const population = c.match + t.overridden;
    return Object.assign({}, row, {
      population,
      unreviewed: population - row.reviewed,
      autoApprovedLive: c.match,
      overriddenLive: t.overridden,
    });
  }

  /* The estate rollup. Everything on the board view derives from this. */
  function estate() {
    const validated = sumBy(comparisons, "validated");
    const match = sumBy(comparisons, "match");
    const difference = sumBy(comparisons, "difference");
    const uncertain = sumBy(comparisons, "uncertain");
    const overridden = sumBy(triage, "overridden");
    const toExceptions = sumBy(triage, "toExceptions");
    const open = sumBy(triage, "open");
    const reviewed = sumBy(live, "reviewed");
    const confirmed = sumBy(live, "confirmed");
    const failed = sumBy(live, "failed");
    const failedFromMatch = live.reduce((a, l) => a + l.failedFrom.match, 0);
    const failedFromOverride = live.reduce((a, l) => a + l.failedFrom.override, 0);
    const liveAutoApproved = live.reduce((a, l) => a + comparisonFor(l.wave).match, 0);
    const livePopulation = live.reduce((a, l) => a + liveFor(l.wave).population, 0);

    return {
      validated,
      match,
      difference,
      uncertain,
      needsAttention: difference + uncertain,
      autoApprovalRate: (match / validated) * 100,
      overridden,
      toExceptions,
      open,
      reviewed,
      confirmed,
      failed,
      failedFromMatch,
      failedFromOverride,
      liveAutoApproved,
      livePopulation,
      /* The metric the PRD says to protect, not optimise: auto-approvals a
         human later found to be wrong, over auto-approvals that are live and
         therefore could have been found wrong. Overrides are excluded from
         the numerator deliberately — a reversed override is a human's mistake,
         and folding it in here would let the machine take credit for it. */
      falsePositiveRate: (failedFromMatch / liveAutoApproved) * 100,
      overrideReversalRate: overridden ? (failedFromOverride / overridden) * 100 : 0,
      wavesCompared: comparisons.length,
    };
  }

  /* --- Row selection -------------------------------------------------------
     `surface` is which of the two human surfaces is asking:
       "approved"  everything the machine passed — the auto-validated table
       "triage"    pre-deploy, machine said FAIL
       "live"      post-deploy, in the tenant, machine said PASS (or a human
                   overrode) — the only rows a customer can fail
  */
  function assetsFor(waveId, surface, type) {
    let rows = assets.filter((a) => a.wave === Number(waveId));
    if (surface === "approved") rows = rows.filter((a) => a.cls === "match");
    if (surface === "triage") rows = rows.filter((a) => a.cls !== "match");
    if (surface === "live") rows = rows.filter((a) => a.live);
    if (type) rows = rows.filter((a) => a.type === type);
    return rows;
  }

  /* --- Immutable audit trail (PRD F-7) ------------------------------------
     Derived from the asset rather than stored alongside it, so a row and its
     history cannot disagree. Scenario D in the PRD is a customer asking, three
     months later, how we know a dashboard nobody ever looked at was right —
     this is the answer to that question, and it has to exist for the 1,422
     assets no human ever opened just as much as for the 4 that went wrong. */
  function auditFor(a) {
    const c = comparisonFor(a.wave);
    const entries = [
      {
        at: c.ranAt,
        by: "dma",
        title: "Comparison run",
        detail: `Classified ${CLASSES[a.cls].label} at confidence ${a.confidence.toFixed(2)} on ${signalsFor(a.type).length} signals. Threshold in effect: auto-approve at ≥ 0.90.`,
        tone: CLASSES[a.cls].tone,
      },
    ];

    if (a.verdict) {
      const v = VERDICTS[a.verdict.decision];
      entries.push({
        at: a.verdict.at,
        by: a.verdict.by,
        title: a.verdict.decision === "override" ? "Overridden and published" : "Routed to Exceptions",
        detail: a.verdict.reason || a.verdict.comment,
        tone: v.tone,
      });
    }

    if (a.review) {
      const r = REVIEWS[a.review.decision];
      entries.push({
        at: a.review.at,
        by: a.review.by,
        title: a.review.decision === "confirmed" ? "Confirmed in the tenant" : "Failed on live review",
        detail: a.review.comment || "Reviewed in the Dynatrace tenant and agreed with the automated result.",
        tone: r.tone,
      });
      if (a.review.decision === "failed") {
        entries.push({
          at: a.review.at,
          by: "dma",
          title: "Routed to manual translation and validation",
          detail: "A live asset with a failed review re-enters the workflow with the reviewer's comment attached. The prior result is superseded, not deleted.",
          tone: "warning",
        });
      }
    }

    return entries;
  }

  /* --- Self-check ----------------------------------------------------------
     project.validation cannot read this file (it loads first), so it carries
     the same three numbers as literals. This re-derives them and complains in
     the console if the two ever drift. Cheap, and it catches exactly the kind
     of silent inconsistency that produced the 2,955 problem in the first
     place. */
  function assertTotals() {
    const e = estate();
    const p = DMA.data.project && DMA.data.project.validation;
    const out = [];
    if (!p) return ["project.validation is missing"];
    if (p.autoApproved !== e.match) out.push(`autoApproved ${p.autoApproved} ≠ ${e.match}`);
    if (p.meaningfulDifference !== e.difference) out.push(`meaningfulDifference ${p.meaningfulDifference} ≠ ${e.difference}`);
    if (p.uncertain !== e.uncertain) out.push(`uncertain ${p.uncertain} ≠ ${e.uncertain}`);
    if (Math.abs(p.autoApprovalRate - e.autoApprovalRate) > 0.05) {
      out.push(`autoApprovalRate ${p.autoApprovalRate} ≠ ${e.autoApprovalRate.toFixed(1)}`);
    }
    if (out.length) console.warn("[validation] drift against project.validation:", out.join(" · "));
    return out;
  }

  DMA.data.validation = {
    SIGNALS,
    CLASSES,
    VERDICTS,
    REVIEWS,
    REVIEWERS,
    ROLE_TONE,
    TYPES: ["Dashboards", "Alerts", "Saved searches"],
    AUTO_APPROVE_THRESHOLD: 0.9,
    comparisons,
    triage,
    live,
    assets,
    signalsFor,
    comparisonFor,
    triageFor,
    liveFor,
    assetsFor,
    auditFor,
    estate,
    assertTotals,
    reviewer: (id) => DMA.data.validation.REVIEWERS[id] || { name: id, role: "system", label: "" },
  };
})();
