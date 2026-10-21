/* ============================================================================
   DATA: Exceptions — manual translation review and validation
   ----------------------------------------------------------------------------
   Owned by modules/exceptions.

   Implements the P1 PRD "Add Manual Translation Review and Validation to DMA
   Workflow". Its metric is the DELTA SCORE between the auto-translated result
   and the manually corrected one, which is why every corrected asset below
   carries both numbers rather than just the one it ended on.

   ----------------------------------------------------------------------------
   FOUR INLETS, AND WHY THE FOURTH IS NOT A ROUNDING ERROR

     113   Translate blocked it          no runnable DQL after the one retry
     135   Validate triaged it           pre-deploy, a human sent it for rework
       4   Validate failed it live       post-deploy, a human found it wrong
     ───
     252   had an automated attempt
    + 46   no automated path             the Splunk feature has no target
     ───                                 equivalent at all
     298   in the queue

   The first three are derived from the stages that produced them — see
   `streamCounts()` — so this file cannot quietly disagree with Translate or
   Validate about how much work it was handed. That is the defect class that
   produced the 2,955 problem, and it is cheap to make impossible.

   The 46 are owned here, and they are PREREQUISITES: lookups and macros out
   of the 371 that never translate. This matters arithmetically — Waves 1–4
   ran 1,864 translatable assets and every one of them came back clean,
   retried or blocked, so there is no slack in that population for a fourth
   stream to hide in. The 371 sit outside every translation and validation
   rate in the project, which is exactly where a stream with no automated
   path belongs.

   It also matters as an argument. `fx_rates_intraday.csv` is one of the 46:
   a lookup rewritten every fifteen minutes by an `outputlookup` search that
   has no equivalent. Validate's SS-2044 is routed here because it reads that
   table. Fixing the prerequisite is what unblocks the asset — the fourth
   stream is not a sidecar, it is upstream of the other three.

   ----------------------------------------------------------------------------
   TWO LAYOUTS, NOT ONE

   A dashboard is not the unit of work and never was. The consultants count
   tiles, and a blocked dashboard is almost always three bad panels out of
   fourteen — so dashboards open into a tile workspace where each tile is
   retranslated, edited and validated on its own, and the dashboard publishes
   only once every tile is clean.

   An alert or a saved search is one query. Giving it a tile rail with one
   row in it would be a worse screen, not a more consistent one, so it opens
   into a single-query workspace instead. The 46 prerequisites use that same
   workspace in a rebuild-from-intent variant: retranslate is disabled, there
   is nothing to retranslate from, and the context box is the specification
   the rebuild is written against.

   ----------------------------------------------------------------------------
   WHAT THIS STAGE DELIBERATELY DOES NOT DO (PRD, explicit non-goals)

   No AI-generated diagnosis of why a translation failed. No AI-suggested
   fix. No similarity score and no diff view — that is P2 and it is Validate's.
   No automated model selection or retry policy — that is Translate's. The
   human reads the finding, writes the context, and owns the result.
   ========================================================================== */

window.DMA = window.DMA || {};
DMA.data = DMA.data || {};

(function () {
  "use strict";

  const X = (DMA.data.exceptions = {});

  /* --- The four inlets ------------------------------------------------------
     `derived` names the function that re-derives the count from the stage that
     produced it. A stream with `derived: null` is owned here and is the only
     one whose total is a literal. ------------------------------------------- */
  X.STREAMS = [
    {
      id: "translate-blocked",
      label: "Blocked in Translate",
      short: "Blocked",
      tone: "critical",
      icon: "x",
      derived: "translation.estate().blocked",
      detail:
        "No runnable DQL after the one permitted retry. Arrives with the block reason and whatever partial output was produced, so the reviewer starts from the translation rather than from the SPL.",
      remedy: "Retranslate with context, or write the DQL by hand.",
    },
    {
      id: "validate-triage",
      label: "Sent back by Validate",
      short: "Triaged",
      tone: "warning",
      icon: "arrowRight",
      derived: "validation.estate().toExceptions",
      detail:
        "Runnable DQL that returned a different answer. A human read the finding pre-deploy and chose rework over an override. Nothing in this stream is live.",
      remedy: "Correct the semantic difference named in the finding.",
    },
    {
      id: "validate-live",
      label: "Failed after going live",
      short: "Live",
      tone: "critical",
      icon: "server",
      derived: "validation.estate().failed",
      detail:
        "Already running in the customer's tenant and already wrong. Carries the reviewer's comment. These are the only rows in the queue where doing nothing has an ongoing cost.",
      remedy: "Correct and republish. The live version stays up until it does.",
    },
    {
      id: "no-equivalent",
      label: "No automated path",
      short: "No path",
      tone: "info",
      icon: "helpCircle",
      derived: null,
      detail:
        "Prerequisites — lookups and macros — whose Splunk behaviour has no Dynatrace equivalent to translate into. They never entered a translation run, so they have no block reason and no confidence score; there was never an attempt to fail.",
      remedy: "Rebuild from intent. There is nothing to retranslate.",
    },
  ];

  X.streamById = (id) => X.STREAMS.find((s) => s.id === id) || null;

  /* The 46. A literal, because no other stage produced it — and the only
     literal in `streamCounts()` for that reason. */
  X.NO_EQUIVALENT_TOTAL = 46;

  /* --- Lifecycle ------------------------------------------------------------
     Six states, and two of them exist because Charles ruled that one person
     fixes and publishes rather than handing to a second reviewer. `needs-review`
     and `sent-back` therefore have to be states the SAME operator can reach —
     "send back" hands the asset to whoever owns it with a comment, and that is
     a real action on this screen, not a KPI with nothing behind it. --------- */
  X.STATES = {
    queued:        { label: "Queued",          tone: "neutral",  icon: "clock",    detail: "In the queue, nobody has started it." },
    "in-progress": { label: "In progress",     tone: "info",     icon: "edit",     detail: "Someone is working it. Context, edits and retranslations are being recorded against it." },
    "needs-review":{ label: "Needs review",    tone: "warning",  icon: "eye",      detail: "Corrected and self-validated. Waiting on the approve-and-publish decision." },
    "sent-back":   { label: "Sent back",       tone: "critical", icon: "arrowLeft",detail: "Handed back to the asset's owner with a comment. Nothing happens here until they answer." },
    resolved:      { label: "Resolved",        tone: "success",  icon: "check",    detail: "Fixed and validated, returned to its wave. Deploy publishes it with the rest of the wave." },
    published:     { label: "Published & live",tone: "success",  icon: "server",   detail: "Published to the tenant from this stage, ahead of or outside its wave's deploy." },
  };

  X.STATE_ORDER = ["queued", "in-progress", "needs-review", "sent-back", "resolved", "published"];
  X.OPEN_STATES = ["queued", "in-progress", "needs-review", "sent-back"];
  X.DONE_STATES = ["resolved", "published"];

  /* --- What a retranslation can come back as --------------------------------
     The PRD is explicit that a user may add context that does not resolve the
     issue, and that there must be a clear "still failing" outcome. A stage
     that only models success would let a reviewer add three rounds of context
     and never be told that none of it worked. ------------------------------- */
  X.OUTCOMES = {
    resolved:       { label: "Resolved",      tone: "success",  icon: "check", detail: "The regenerated DQL runs and returns what the original returned." },
    "still-failing":{ label: "Still failing", tone: "critical", icon: "x",     detail: "The context was taken into account and the result is still wrong. Adding more of the same context will not help." },
    improved:       { label: "Improved",      tone: "warning",  icon: "alert", detail: "Runs now, but the result still differs. Closer, not correct." },
  };

  /* --- SPL legend (design: the key beside the read-only SPL pane) ---------- */
  X.SPL_LEGEND = [
    { id: "ok",          label: "Supported",   detail: "Translates to DQL without a judgement call." },
    { id: "partial",     label: "Partial",     detail: "Has a DQL counterpart that does not behave identically." },
    { id: "unsupported", label: "Unsupported", detail: "No DQL counterpart. This is what blocked the translation." },
    { id: "var",         label: "$Variables$", detail: "A dashboard token. Resolved at view time in Splunk; nothing in DQL does this." },
    { id: "macro",       label: "Macro",       detail: "Expanded from the dictionary Calibrate froze before the SPL reaches a model." },
  ];

  /* Tokenise SPL for that legend. `$tokens$` and `\`macros\`` are found by
     shape; `partial` and `unsupported` are named per tile, because whether a
     command is supported is a property of the translator, not of the string. */
  X.tokenize = function (spl, marks) {
    const m = marks || {};
    const spans = [];
    const push = (re, kind) => {
      let hit;
      const r = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      while ((hit = r.exec(spl)) !== null) spans.push({ start: hit.index, end: hit.index + hit[0].length, kind });
    };
    push(/\$[A-Za-z0-9_.]+\$/g, "var");
    push(/`[^`]+`/g, "macro");
    (m.unsupported || []).forEach((s) => {
      const i = spl.indexOf(s);
      if (i >= 0) spans.push({ start: i, end: i + s.length, kind: "unsupported" });
    });
    (m.partial || []).forEach((s) => {
      const i = spl.indexOf(s);
      if (i >= 0) spans.push({ start: i, end: i + s.length, kind: "partial" });
    });

    spans.sort((a, b) => a.start - b.start || b.end - a.end);
    const out = [];
    let at = 0;
    spans.forEach((s) => {
      if (s.start < at) return; // overlapping marks: first one wins
      if (s.start > at) out.push({ t: spl.slice(at, s.start), k: "ok" });
      out.push({ t: spl.slice(s.start, s.end), k: s.kind });
      at = s.end;
    });
    if (at < spl.length) out.push({ t: spl.slice(at), k: "ok" });
    return out;
  };

  /* --- Translation notes (design: the right-hand panel) --------------------
     Six fixed sections. Fixed on purpose: a reviewer reads the same six
     headings on every asset, so an empty one is information rather than an
     omission. ------------------------------------------------------------- */
  X.NOTE_SECTIONS = [
    { id: "source",      label: "Data source mapping" },
    { id: "fields",      label: "Field extraction" },
    { id: "differences", label: "Key differences" },
    { id: "performance", label: "Performance considerations" },
    { id: "model",       label: "Data model requirement" },
    { id: "testing",     label: "Testing recommendations" },
  ];

  /* --- Publish options (design: the publish-dashboard modal) ---------------
     Metadata embedded as DQL comments in each published query. This is the
     only traceability that survives someone opening the query in the tenant
     six months from now with no access to DMA. ----------------------------- */
  X.PUBLISH_OPTIONS = [
    {
      id: "version",
      label: "Add the DMA translator version as a comment",
      on: true,
      sample: "// dma-translator 4.2.1 · rule set v4 · calibration profile v1.3",
      detail: "Which translator produced this, so a defect found later can be scoped to everything that version touched.",
    },
    {
      id: "spl",
      label: "Include the original SPL as a comment section",
      on: true,
      sample: "// source: index=fraud_scoring sourcetype=model:v2 | timechart span=1h avg(risk_score_v2)",
      detail: "The question the query was originally asked. Costs bytes; worth it the first time someone has to argue about intent.",
    },
    {
      id: "mappings",
      label: "Include the mapping decisions this asset depends on",
      on: false,
      /* Indexes, lookups and macros — the three things Global Mapping owns and
         the three things that make a published query break later if someone
         changes one. Field renames are deliberately not listed: DMA does not
         hold a per-field rename table, and a comment claiming one would be the
         kind of traceability that is worse than none. */
      sample: "// reads: index fraud_scoring · lookup fx_rates_intraday · macro wu_biz_hours",
      detail:
        "Every index, lookup and macro the query resolves through. Off by default — on a wide dashboard this is longer than the query.",
    },
    {
      id: "manual",
      label: "Flag queries a human corrected",
      on: true,
      sample: "// manually corrected · Claire Dubois · 2026-10-20",
      detail: "Marks this as a hand-corrected translation rather than an automated one, by name and date.",
    },
  ];

  /* ------------------------------------------------------------------------
     The population
     ------------------------------------------------------------------------
     Per wave and per stream, then per wave and per state. Both tables are
     checked against the derived stream totals by assertStreams().

     Waves 3 and 4 have nothing in `published`, and that is not an oversight:
     neither wave has deployed, so nothing from them can be live. An Exceptions
     asset in those waves reaches `resolved` and waits for its wave.
     --------------------------------------------------------------------- */

  X.byWave = [
    { wave: 1, "translate-blocked": 30, "validate-triage": 67, "validate-live": 2, "no-equivalent": 14 },
    { wave: 2, "translate-blocked": 29, "validate-triage": 68, "validate-live": 2, "no-equivalent": 13 },
    { wave: 3, "translate-blocked": 29, "validate-triage": 0,  "validate-live": 0, "no-equivalent": 11 },
    { wave: 4, "translate-blocked": 25, "validate-triage": 0,  "validate-live": 0, "no-equivalent": 8 },
  ];

  X.statesByWave = [
    { wave: 1, queued: 5,  "in-progress": 6, "needs-review": 9,  "sent-back": 4, resolved: 18, published: 71 },
    { wave: 2, queued: 6,  "in-progress": 8, "needs-review": 11, "sent-back": 5, resolved: 20, published: 62 },
    { wave: 3, queued: 16, "in-progress": 7, "needs-review": 6,  "sent-back": 2, resolved: 9,  published: 0 },
    { wave: 4, queued: 16, "in-progress": 7, "needs-review": 5,  "sent-back": 1, resolved: 4,  published: 0 },
  ];

  /* Type split of the queue. The five tabs are not the three Translate shows:
     lookups and macros only ever appear on this stage, because this is the one
     stage where a prerequisite is a unit of work rather than an input. */
  X.TYPES = ["Dashboards", "Alerts", "Saved searches", "Lookups", "Macros"];

  X.byType = {
    "translate-blocked": { Dashboards: 31, Alerts: 44, "Saved searches": 38, Lookups: 0,  Macros: 0 },
    "validate-triage":   { Dashboards: 38, Alerts: 52, "Saved searches": 45, Lookups: 0,  Macros: 0 },
    "validate-live":     { Dashboards: 1,  Alerts: 3,  "Saved searches": 0,  Lookups: 0,  Macros: 0 },
    "no-equivalent":     { Dashboards: 0,  Alerts: 0,  "Saved searches": 0,  Lookups: 29, Macros: 17 },
  };

  /* --- The delta score (the PRD's metric) ----------------------------------
     Auto-translated result vs. manually corrected result, over the corrected
     population. The auto mean is low because most of this queue scored zero by
     construction: an asset Translate blocked produced no runnable DQL at all,
     and no runnable DQL is a validation score of 0, not a bad score. Quoting a
     delta without saying that is how +0.75 starts sounding like a model
     improvement instead of what it is — work a person did. ----------------- */
  X.delta = {
    corrected: 184,        // resolved + published, estate-wide
    autoMean: 0.21,
    manualMean: 0.96,
    zeroScored: 113,       // had no runnable DQL to score at all
    captured: 1284,        // individual corrections written to the training set
  };

  /* --- Assets -------------------------------------------------------------
     A fixture, not the population — the same convention Translate and Validate
     use. Every row opens, and the tables say how many of how many they show.

     `layout` picks the workspace: "tiles" for dashboards, "query" for
     everything else. A dashboard always carries a full tile list, because the
     tile is the unit of work — a dashboard row that cannot be opened tile by
     tile is the screen this stage exists to replace. --------------------- */
  X.assets = [
    /* ======================================================================
       DS-2103 — the golden path.
       ----------------------------------------------------------------------
       Blocked in Translate on an unresolved field: five of twelve panels read
       `risk_score_v2`, which the fraud team renamed in Splunk without telling
       anyone and which exists under three names across the estate. That is a
       CONTEXT problem, which is exactly what the context box is for — and it
       is the honest demo, because four of the five resolve and one does not.

       Tile 9 is the one that does not. Its problem was never the field name;
       it correlates two model versions through a subsearch join, which is a
       CAPABILITY gap. More context will not move it, the regenerated DQL says
       so, and the remedy is a human writing the query. The PRD asks for a
       clear "still failing" outcome and this is what it is for.
       ==================================================================== */
    {
      id: "DS-2103",
      name: "Fraud Model Drift",
      type: "Dashboards",
      layout: "tiles",
      app: "fraud-risk",
      wave: 2,
      stream: "translate-blocked",
      state: "in-progress",
      assignee: "claire",
      openedAt: "2026-10-20T09:12:00Z",
      origin: {
        label: "Unresolved field reference",
        at: "2026-10-10T08:41:00Z",
        detail:
          "Seven panels translated cleanly. Five read `risk_score_v2`, a field that exists in neither the source schema nor the mapping cascade — renamed in Splunk in March 2025 and still carried under three names across the estate.",
      },
      delta: { auto: 0.0, manual: null },
      tiles: [
        {
          n: 1,
          name: "Model score distribution",
          splunkType: "Column chart",
          dtType: "BarChart",
          state: "validated",
          spl: "index=fraud_scoring sourcetype=model:v2 earliest=-24h | stats count by score_bucket | sort score_bucket",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_fraud_scoring" and sourcetype == "model:v2"\n| summarize count = count(), by: { score_bucket }\n| sort score_bucket asc',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { rows: 10, executedAt: "2026-10-20T09:18:00Z" },
          notes: {
            source: "`index=fraud_scoring` maps to the bucket `logs:wu_fraud_scoring`, resolved at Wave Mapping.",
            fields: "`score_bucket` carries through unchanged — it is a string label, not a computed score.",
            differences: "None. Row counts and ordering match over a 24-hour window.",
            performance: "Ten buckets over 24 hours. Trivial either side.",
            model: "None beyond the bucket.",
            testing: "Compare bucket counts over the same window; they should be identical, not approximate.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
        },
        {
          n: 2,
          name: "Score drift vs. baseline",
          splunkType: "Line chart",
          dtType: "LineChart",
          state: "validated",
          spl: "index=fraud_scoring sourcetype=model:v2 earliest=-7d | `fraud_baseline(risk_score_v2)` | timechart span=1h avg(risk_score_v2) as current, avg(baseline_score) as baseline",
          marks: { unsupported: ["risk_score_v2"] },
          dql: 'fetch logs, from: -7d\n| filter dt.system.bucket == "logs:wu_fraud_scoring" and sourcetype == "model:v2"\n| makeTimeseries {\n    current  = avg(risk.score),\n    baseline = avg(risk.score.baseline)\n  }, interval: 1h',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: ["fraud_baseline"] },
          result: { rows: 168, executedAt: "2026-10-20T10:04:00Z" },
          notes: {
            source: "Same bucket as tile 1. The `fraud_baseline` macro expands to a 30-day trailing average and is resolved from the dictionary Calibrate froze.",
            fields: "`risk_score_v2` → `risk.score`. The `_v2` suffix is a Splunk artefact of the March 2025 rename, not part of the semantic name — this is the mapping the context box supplied.",
            differences: "None after correction. 168 hourly points on both sides over seven days.",
            performance: "Hourly rollup over seven days. The DQL reads one bucket; the SPL read the index unscoped.",
            model: "Requires `risk.score` and `risk.score.baseline` on the fraud scoring ingest.",
            testing: "Spot-check three hours against the Splunk original. The baseline series should be flat within an hour, the current series should not.",
          },
          editedBy: "claire",
          editedAt: "2026-10-20T10:04:00Z",
          attempts: [
            {
              n: 1,
              at: "2026-10-20T09:51:00Z",
              by: "claire",
              context:
                "risk_score_v2 was renamed from fraud_score in March 2025. The _v2 suffix is a Splunk naming artefact and is not part of the field's meaning — map it to risk.score. baseline_score is the same field computed over a 30-day trailing window and maps to risk.score.baseline.",
              outcome: "resolved",
              note: "Regenerated from the SPL plus the context, not from the context alone. Both fields resolved and the series matched the original on the first run.",
            },
          ],
        },
        {
          n: 3,
          name: "Feature importance",
          splunkType: "Bar chart",
          dtType: "BarChart",
          state: "validated",
          spl: "index=fraud_scoring sourcetype=model:explain earliest=-24h | stats avg(contribution) as weight by feature | sort -weight | head 15",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_fraud_scoring" and sourcetype == "model:explain"\n| summarize weight = avg(contribution), by: { feature }\n| sort weight desc\n| limit 15',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { rows: 15, executedAt: "2026-10-20T09:18:00Z" },
          notes: {
            source: "Explain-plan events in the same bucket, separated by sourcetype.",
            fields: "`contribution` and `feature` carry through unchanged.",
            differences: "None. Identical fifteen rows in identical order.",
            performance: "Aggregates roughly 40k events per day. Comfortable.",
            model: "None.",
            testing: "The top three features should not move between runs; if they do, the explain job is the problem, not the translation.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
        },
        {
          n: 4,
          name: "Decline rate by score band",
          splunkType: "Table",
          dtType: "DataTable",
          state: "blocked",
          spl: 'index=fraud_scoring earliest=-7d | eval band=case(risk_score_v2<0.3,"low",risk_score_v2<0.7,"medium",1=1,"high") | stats count(eval(decision="decline")) as declines, count as total by band | eval rate=round(declines/total*100,2)',
          marks: { unsupported: ["risk_score_v2<0.3", "risk_score_v2<0.7"] },
          dql: null,
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { error: "Translation produced no executable DQL. `risk_score_v2` does not resolve in the target schema, and the band boundaries are computed from it." },
          blockers: [
            { label: "Unresolved field `risk_score_v2`", tone: "critical", detail: "Used twice, in both band boundaries. Neither the source schema nor the mapping cascade carries it." },
          ],
          notes: {
            source: "`index=fraud_scoring` → `logs:wu_fraud_scoring`.",
            fields: "`decision` resolves. `risk_score_v2` does not — this is the whole of the block.",
            differences: "Not yet comparable.",
            performance: "Three bands over seven days; the shape is cheap once the field resolves.",
            model: "Requires whichever field `risk_score_v2` is supposed to be.",
            testing: "Band totals must sum to the ungrouped count. A band that silently drops nulls is the failure mode here.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
          retry: {
            outcome: "resolved",
            dql: 'fetch logs, from: -7d\n| filter dt.system.bucket == "logs:wu_fraud_scoring"\n| fieldsAdd band = if(risk.score < 0.3, "low", else: if(risk.score < 0.7, "medium", else: "high"))\n| summarize {\n    declines = countIf(decision == "decline"),\n    total    = count()\n  }, by: { band }\n| fieldsAdd rate = round(declines / total * 100, decimals: 2)',
            result: { rows: 3, executedAt: "2026-10-21T09:04:00Z" },
            note:
              "The field resolved and both band boundaries came through. Three bands, and they sum to the ungrouped count — which is the test that matters, because a boundary that drops nulls looks right until someone adds the bands up.",
            notes: {
              fields: "`risk_score_v2` → `risk.score`, from the context. `decision` carried through untouched.",
              differences: "None. Three bands, identical counts, rates agree to two decimal places over seven days.",
            },
          },
        },
        {
          n: 5,
          name: "Population stability index",
          splunkType: "Line chart",
          dtType: "LineChart",
          state: "blocked",
          spl: "index=fraud_scoring earliest=-30d | sistats avg(risk_score_v2) as psi by date_mday | timechart span=1d avg(psi)",
          marks: { unsupported: ["risk_score_v2"], partial: ["sistats"] },
          dql: null,
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { error: "Translation produced no executable DQL. Two problems in one query: the unresolved field, and `sistats` has no direct DQL counterpart." },
          blockers: [
            { label: "Unresolved field `risk_score_v2`", tone: "critical", detail: "Same rename as tiles 2, 4, 9 and 11." },
            { label: "`sistats` is a partial match", tone: "warning", detail: "Splunk's summary-indexing variant of `stats`. DQL has no summary index; the equivalent is a plain aggregation, which recomputes rather than reading a pre-aggregated summary. Same numbers, different cost." },
          ],
          notes: {
            source: "`index=fraud_scoring` → `logs:wu_fraud_scoring`.",
            fields: "`risk_score_v2` unresolved. `date_mday` is a Splunk-generated time field with no target equivalent; the DQL groups on the timeframe instead.",
            differences: "Not yet comparable.",
            performance: "Thirty days of raw events, previously read from a summary index. This is the one tile on the dashboard where the translated query is meaningfully more expensive than the original.",
            model: "Requires the resolved score field on the fraud scoring ingest.",
            testing: "Compare against the Splunk summary index, not against a live recompute — the two disagree in Splunk too.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
          retry: {
            outcome: "resolved",
            dql: 'fetch logs, from: -30d\n| filter dt.system.bucket == "logs:wu_fraud_scoring"\n| makeTimeseries psi = avg(risk.score), interval: 1d',
            result: { rows: 30, executedAt: "2026-10-21T09:06:00Z" },
            note:
              "Resolved, with one thing worth saying out loud: `sistats` became a plain aggregation. The numbers match, and this query recomputes thirty days of raw events where the original read a pre-built summary. It is the one panel on this dashboard that costs meaningfully more than it used to.",
            notes: {
              fields: "`risk_score_v2` → `risk.score`. `date_mday` dropped — `makeTimeseries` carries the daily grouping.",
              differences: "Thirty daily points on both sides, matching to three decimal places.",
              performance:
                "Confirmed on the run: this reads thirty days of raw events where the Splunk original read a summary index. Correct and more expensive. Worth watching if this dashboard gets opened often.",
            },
          },
        },
        {
          n: 6,
          name: "Model latency p95",
          splunkType: "Single value",
          dtType: "SingleValue",
          state: "validated",
          spl: "index=fraud_scoring sourcetype=model:v2 earliest=-1h | stats p95(scoring_duration_ms) as p95",
          marks: {},
          dql: 'fetch logs, from: -1h\n| filter dt.system.bucket == "logs:wu_fraud_scoring" and sourcetype == "model:v2"\n| summarize p95 = percentile(scoring.duration, 95)',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { rows: 1, executedAt: "2026-10-20T09:18:00Z" },
          notes: {
            source: "Same bucket.",
            fields: "`scoring_duration_ms` → `scoring.duration`. The unit is milliseconds on both sides; the target field name drops the suffix and keeps the unit in metadata.",
            differences: "Agrees to three decimal places.",
            performance: "One hour, one aggregate.",
            model: "None.",
            testing: "If the two sides disagree by exactly 1000×, the unit metadata is wrong rather than the query.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
        },
        {
          n: 7,
          name: "Scoring volume",
          splunkType: "Area chart",
          dtType: "AreaChart",
          state: "validated",
          spl: "index=fraud_scoring sourcetype=model:v2 earliest=-24h | timechart span=15m count",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_fraud_scoring" and sourcetype == "model:v2"\n| makeTimeseries count(), interval: 15m',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { rows: 96, executedAt: "2026-10-20T09:18:00Z" },
          notes: {
            source: "Same bucket.",
            fields: "None beyond the event count.",
            differences: "None. 96 buckets on both sides.",
            performance: "Trivial.",
            model: "None.",
            testing: "Totals across the 96 buckets should equal the ungrouped count for the same window.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
        },
        {
          n: 8,
          name: "Override rate by analyst",
          splunkType: "Table",
          dtType: "DataTable",
          state: "validated",
          spl: "index=fraud_cases earliest=-30d | lookup analyst_roster analyst_id OUTPUT analyst_name, team | stats count(eval(action=\"override\")) as overrides, count as reviewed by analyst_name | eval rate=round(overrides/reviewed*100,1) | sort -rate",
          marks: {},
          dql: 'fetch logs, from: -30d\n| filter dt.system.bucket == "logs:wu_fraud_cases"\n| lookup [fetch dt.entity.custom.analyst_roster], sourceField: analyst_id, lookupField: analyst_id, fields: { analyst_name, team }\n| summarize {\n    overrides = countIf(action == "override"),\n    reviewed  = count()\n  }, by: { analyst_name }\n| fieldsAdd rate = round(overrides / reviewed * 100, decimals: 1)\n| sort rate desc',
          deps: { indexes: ["fraud_cases"], lookups: ["analyst_roster"], macros: [] },
          result: { rows: 34, executedAt: "2026-10-20T09:18:00Z" },
          notes: {
            source: "A second bucket — `logs:wu_fraud_cases` — joined to a preloaded lookup.",
            fields: "`analyst_id` is the lookup key on both sides. `action` carries through.",
            differences: "None. 34 analysts on both sides, identical rates.",
            performance: "The lookup is 41 rows and is preloaded, so this is a broadcast join either way.",
            model: "Requires `analyst_roster` preloaded — it is, as of Wave 2.",
            testing: "An analyst missing from the roster drops silently on both sides. Check the row count, not just the rates.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
        },
        {
          n: 9,
          name: "Champion vs. challenger",
          splunkType: "Table",
          dtType: "DataTable",
          state: "blocked",
          spl: 'index=fraud_scoring model_version=champion earliest=-7d | join type=left transaction_id [search index=fraud_scoring model_version=challenger | fields transaction_id, risk_score_v2] | stats avg(risk_score_v2) as champion, avg(challenger_score) as challenger by decision_band',
          marks: { unsupported: ["join type=left transaction_id", "risk_score_v2"] },
          dql: null,
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { error: "Regenerated with the field mapping applied. The field now resolves; the correlation does not. A left join against a subsearch over the same bucket has no DQL form that preserves the unmatched rows." },
          blockers: [
            { label: "Subsearch join across model versions", tone: "critical", detail: "Correlates champion and challenger scores on `transaction_id` through a left join over a subsearch. DQL can join, but not in a way that keeps champion transactions the challenger never scored — and those are the rows the panel exists to show." },
          ],
          notes: {
            source: "One bucket, read twice under two filters.",
            fields: "`risk_score_v2` → `risk.score`, resolved by the context on attempt 1. `transaction_id` is the correlation key.",
            differences: "The regenerated query returns 11,204 rows against the original's 14,880. The 3,676 missing are champion-only transactions that the left join preserved and the DQL join drops.",
            performance: "Reading one bucket twice over seven days. The second read is the expensive half.",
            model: "Requires `risk.score` and a stable `transaction_id`.",
            testing: "The row count must equal the champion-only count, not the intersection. An inner join looks correct and is not.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [
            {
              n: 1,
              at: "2026-10-20T10:22:00Z",
              by: "claire",
              context:
                "Same rename as tile 2 — risk_score_v2 maps to risk.score. challenger_score is the same measurement produced by the challenger model and maps to risk.score with model.version == 'challenger'.",
              outcome: "still-failing",
              note:
                "The field mapping was taken and applied — the regenerated DQL compiles and runs, which the first attempt did not. It returns 11,204 rows against 14,880. The field name was never the problem on this tile; the left join is. More context about field names will not change that.",
            },
          ],
          /* The tile that does not come good. A second round of context is
             allowed, taken seriously, and still fails — because the gap is a
             capability, not a vocabulary. The PRD asks for a clear
             "still failing" outcome, and this is where it earns its place. */
          retry: {
            outcome: "still-failing",
            dql: 'fetch logs, from: -7d\n| filter dt.system.bucket == "logs:wu_fraud_scoring" and model.version == "champion"\n| join [\n    fetch logs, from: -7d\n    | filter dt.system.bucket == "logs:wu_fraud_scoring" and model.version == "challenger"\n  ], on: { transaction_id }, fields: { challenger_score = risk.score }\n| summarize {\n    champion   = avg(risk.score),\n    challenger = avg(challenger_score)\n  }, by: { decision_band }',
            result: { error: "Runs. Returns 11,204 rows against the original's 14,880 — the champion-only transactions are still being dropped." },
            note:
              "Second round, same answer. The regenerated query is a clean inner join and the panel needs a left join that keeps champion transactions the challenger never scored. No amount of describing the fields changes which join DQL emits here. This one needs the query written by hand.",
          },
          /* What a person then wrote. Held on the tile so the demo can show the
             hand-edited path landing, and NOT offered as a suggestion anywhere
             in the UI — no AI-suggested fix is a PRD non-goal, and a prototype
             that quietly hands you the answer is making a claim we did not. */
          handWritten: {
            result: { rows: 14880, executedAt: "2026-10-21T11:40:00Z" },
            note:
              "Written by hand as an outer join with the unmatched side preserved, then the challenger average computed only over the rows that have one. 14,880 rows, matching the original exactly.",
          },
        },
        {
          n: 10,
          name: "Backlog by queue",
          splunkType: "Column chart",
          dtType: "BarChart",
          state: "validated",
          spl: "index=fraud_cases status=open earliest=-1h | stats count by queue | sort -count",
          marks: {},
          dql: 'fetch logs, from: -1h\n| filter dt.system.bucket == "logs:wu_fraud_cases" and status == "open"\n| summarize count = count(), by: { queue }\n| sort count desc',
          deps: { indexes: ["fraud_cases"], lookups: [], macros: [] },
          result: { rows: 6, executedAt: "2026-10-20T09:18:00Z" },
          notes: {
            source: "`logs:wu_fraud_cases`.",
            fields: "`status` and `queue` carry through.",
            differences: "None.",
            performance: "Trivial.",
            model: "None.",
            testing: "Six queues. A seventh appearing means a queue was created after the inventory snapshot.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
        },
        {
          n: 11,
          name: "False-positive trend",
          splunkType: "Line chart",
          dtType: "LineChart",
          state: "blocked",
          spl: 'index=fraud_cases earliest=-$lookback$ | eval fp=if(outcome="confirmed_legitimate" AND risk_score_v2>0.7,1,0) | timechart span=1d sum(fp) as false_positives, count as flagged | eval rate=round(false_positives/flagged*100,2)',
          marks: { unsupported: ["risk_score_v2>0.7"] },
          dql: null,
          deps: { indexes: ["fraud_cases"], lookups: [], macros: [] },
          result: { error: "Translation produced no executable DQL. The unresolved field blocks the predicate, and `$lookback$` is a dashboard token with no DQL equivalent." },
          blockers: [
            { label: "Unresolved field `risk_score_v2`", tone: "critical", detail: "Same rename. Used in the false-positive predicate." },
            { label: "Dashboard token `$lookback$`", tone: "warning", detail: "A viewer-selected timeframe, resolved at view time in Splunk. DQL has no equivalent — the timeframe has to be fixed in the query or driven by the Dynatrace dashboard's own timeframe selector, which is the better answer but changes where the control lives." },
          ],
          notes: {
            source: "`logs:wu_fraud_cases`.",
            fields: "`outcome` resolves. `risk_score_v2` does not.",
            differences: "Not yet comparable.",
            performance: "Depends entirely on what `$lookback$` was set to. The Splunk default was 30 days.",
            model: "Requires the resolved score field.",
            testing: "Pin the timeframe to 30 days for the comparison, then move it to the dashboard selector before publishing.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
          retry: {
            outcome: "resolved",
            dql: 'fetch logs, from: -30d\n| filter dt.system.bucket == "logs:wu_fraud_cases"\n| fieldsAdd fp = if(outcome == "confirmed_legitimate" and risk.score > 0.7, 1, else: 0)\n| makeTimeseries {\n    false_positives = sum(fp),\n    flagged         = count()\n  }, interval: 1d\n| fieldsAdd rate = round(false_positives / flagged * 100, decimals: 2)',
            result: { rows: 30, executedAt: "2026-10-21T09:09:00Z" },
            note:
              "Resolved, and the token moved rather than disappeared. `$lookback$` is pinned to 30 days in the query so the comparison has something fixed to compare against; the viewer control it used to provide becomes the Dynatrace dashboard's own timeframe selector, which is a better place for it and a different place.",
            notes: {
              fields: "`risk_score_v2` → `risk.score`. `outcome` carried through.",
              differences: "Thirty daily points on both sides with the Splunk token set to its 30-day default. Rates agree to two decimals.",
              testing:
                "Pinned to 30 days for the comparison. Before this publishes, confirm the dashboard timeframe selector drives it — a hard-coded 30 days on a panel someone used to re-scope is a regression nobody will report.",
            },
          },
        },
        {
          n: 12,
          name: "Data freshness",
          splunkType: "Single value",
          dtType: "SingleValue",
          state: "validated",
          spl: "index=fraud_scoring earliest=-15m | stats max(_time) as latest | eval lag_s=now()-latest",
          marks: {},
          dql: 'fetch logs, from: -15m\n| filter dt.system.bucket == "logs:wu_fraud_scoring"\n| summarize latest = max(timestamp)\n| fieldsAdd lag_s = (now() - latest) / 1000000000',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { rows: 1, executedAt: "2026-10-20T09:18:00Z" },
          notes: {
            source: "`logs:wu_fraud_scoring`.",
            fields: "`_time` → `timestamp`.",
            differences: "None, allowing for the seconds between the two runs.",
            performance: "Trivial.",
            model: "None.",
            testing: "Dynatrace timestamps are nanoseconds; the divisor is the thing to check, not the query shape.",
          },
          editedBy: null,
          editedAt: null,
          attempts: [],
        },
      ],
      comments: [
        {
          by: "claire",
          at: "2026-10-20T09:30:00Z",
          text: "Five panels, one field. Taking the rename as a project-layer mapping rather than fixing it five times — if it is wrong here it is wrong on the other two dashboards that read it.",
          resolved: false,
          replies: [
            {
              by: "rosa",
              at: "2026-10-20T09:44:00Z",
              text: "Agreed, and raise it to Global Mapping once this publishes. Three names across the estate is a rule-set problem, not five panel problems.",
            },
          ],
        },
        {
          by: "claire",
          at: "2026-10-20T10:31:00Z",
          text: "Tile 9 is not the same problem. The mapping landed and it still comes back 3,676 rows short — it needs the join written by hand, not more context. Flagging it so nobody burns another round on it.",
          resolved: false,
          replies: [],
        },
      ],
    },

    /* ======================================================================
       AL-2021 — the live stream, and the case for the delta score being read
       carefully. This asset validated at 0.95 and was auto-approved: it
       replayed 12 firings on each side over 30 days, because the threshold
       really is right. It is live and wrong anyway, and the correction moves
       its score from 0.95 to 0.99. A four-point delta on the asset that did
       the most damage in the project, which is why the delta is a metric for
       the model and never a ranking of the work.
       ==================================================================== */
    {
      id: "AL-2021",
      name: "Card Auth Success Rate < 97%",
      type: "Alerts",
      layout: "query",
      app: "card-services",
      wave: 2,
      stream: "validate-live",
      state: "needs-review",
      assignee: "arjun",
      openedAt: "2026-10-19T11:02:00Z",
      origin: {
        label: "Failed on live review",
        at: "2026-10-19T10:40:00Z",
        by: "ravi",
        detail:
          "Threshold is right but it evaluates every card type pooled. The original ran per BIN range and raised one alert per failing range — we've lost the split, so a single bad range never pulls the pooled number under 97%.",
      },
      delta: { auto: 0.95, manual: 0.99 },
      query: {
        n: 1,
        name: "Card Auth Success Rate < 97%",
        splunkType: "Scheduled alert",
        dtType: "Metric event",
        state: "validated",
        spl: 'index=card_auth earliest=-15m | stats count(eval(auth_result="approved")) as ok, count as total by bin_range | eval rate=round(ok/total*100,2) | where rate < 97',
        marks: {},
        dql: 'fetch logs, from: -15m\n| filter dt.system.bucket == "logs:wu_card_services"\n| summarize {\n    ok    = countIf(auth_result == "approved"),\n    total = count()\n  }, by: { bin_range }\n| fieldsAdd rate = round(ok / total * 100, decimals: 2)\n| filter rate < 97',
        deps: { indexes: ["card_auth"], lookups: [], macros: [] },
        result: { rows: 2, executedAt: "2026-10-19T11:40:00Z" },
        blockers: [],
        notes: {
          source: "`index=card_auth` → `logs:wu_card_services`.",
          fields: "`auth_result` and `bin_range` both carry through unchanged. Nothing was ever wrong with the field mapping here.",
          differences:
            "The published version aggregated without `by bin_range` and raised one alert for the pooled estate. Over the 30-day replay that produced the same 12 firings, because the pooled rate only drops under 97% when a large range fails — which is exactly the case nobody needed an alert for.",
          performance: "Fifteen-minute window, roughly 180k events. Grouping by BIN range adds 1,400 groups and no meaningful cost.",
          model: "None.",
          testing:
            "Replay against a window where one small range failed and the estate did not. The corrected alert must fire; the published one must not. Comparing total firing counts over 30 days will not distinguish them — that is how this got through.",
        },
        editedBy: "arjun",
        editedAt: "2026-10-19T11:40:00Z",
        attempts: [
          {
            n: 1,
            at: "2026-10-19T11:28:00Z",
            by: "arjun",
            context:
              "This alert raises one notification per failing BIN range, not one for the estate. Keep the 97% threshold and the 15-minute window, but group by bin_range so a single failing range triggers on its own.",
            outcome: "resolved",
            note:
              "Regenerated from the SPL plus the context. The `by bin_range` clause the first translation dropped is back, and the replay now separates the two cases.",
          },
        ],
      },
      comments: [
        {
          by: "ravi",
          at: "2026-10-19T10:44:00Z",
          text: "This one has been live since the 15th. We had a bad range on the 17th that never paged. Please treat it as urgent rather than queueing it behind the wave 3 work.",
          resolved: false,
          replies: [
            {
              by: "arjun",
              at: "2026-10-19T11:05:00Z",
              text: "Taken. Publishing this one on its own rather than waiting for a wave — the health check is the same either way.",
            },
          ],
        },
      ],
    },

    /* ======================================================================
       LK-2101 — the fourth stream, and the reason it is upstream rather than
       a sidecar. Validate's SS-2044 is sitting in this queue because it reads
       this table. Nothing unblocks that asset except rebuilding this one.

       Retranslate is disabled here and the context box is relabelled. There
       is no SPL to regenerate from — the thing that has no equivalent is the
       `outputlookup` write itself, so what the operator writes is a
       specification, not a hint.
       ==================================================================== */
    {
      id: "LK-2101",
      name: "fx_rates_intraday.csv",
      type: "Lookups",
      layout: "query",
      rebuild: true,
      app: "treasury-ops",
      wave: 2,
      stream: "no-equivalent",
      state: "in-progress",
      assignee: "rosa",
      openedAt: "2026-10-18T14:10:00Z",
      origin: {
        label: "No Dynatrace equivalent",
        at: "2026-10-12T09:00:00Z",
        detail:
          "A dynamic lookup: 4,100 rows rewritten every fifteen minutes by a scheduled search ending in `outputlookup`. Dynatrace has no construct that writes a table from a query result, so there is nothing for a translator to target. It was never run through translation and has no block reason — there was never an attempt to fail.",
      },
      delta: { auto: null, manual: null },
      blocks: ["SS-2044"],
      query: {
        n: 1,
        name: "Writing search — fx_rates_intraday",
        splunkType: "Scheduled search → outputlookup",
        dtType: "— no equivalent —",
        state: "blocked",
        spl: 'index=fx_feed sourcetype=reuters:tick earliest=-15m | stats latest(mid) as mid, latest(bid) as bid, latest(ask) as ask by currency_pair | eval as_of=now() | outputlookup fx_rates_intraday.csv',
        marks: { unsupported: ["outputlookup fx_rates_intraday.csv"] },
        dql: null,
        deps: { indexes: ["fx_feed"], lookups: ["fx_rates_intraday"], macros: [] },
        result: { error: "Not attempted. `outputlookup` has no DQL counterpart — the gap is the write, not the query that feeds it." },
        blockers: [
          {
            label: "`outputlookup` has no DQL counterpart",
            tone: "critical",
            detail:
              "The query half translates cleanly. What does not translate is writing its result into a table that other queries then read. The rebuild is a scheduled workflow that writes to a custom entity type, which is a different shape of thing rather than a different syntax for the same thing.",
          },
          {
            label: "Read by 1 asset already in this queue",
            tone: "warning",
            detail: "SS-2044 Watchlist Hit Reconciliation was routed here by Validate because its comparison could not tell a translation fault from a stale table. It stays untrustworthy until this is rebuilt.",
          },
        ],
        notes: {
          source: "`index=fx_feed` → `logs:wu_fx_feed`. The read side is not the problem.",
          fields: "`currency_pair`, `mid`, `bid`, `ask`, `as_of`. All five have to exist on whatever the rebuild writes to.",
          differences:
            "Everything. This is not a translation with a defect in it; it is a Splunk capability the target does not have, replaced by a different mechanism with different freshness guarantees.",
          performance: "Every fifteen minutes, indefinitely. Whatever replaces it is a standing cost rather than a query cost.",
          model: "Needs a custom entity type with the five fields above, and a scheduled workflow to populate it.",
          testing:
            "Compare row counts and `as_of` staleness against the Splunk table for 48 hours before anything reads it. A table that is right but twenty minutes stale fails differently from one that is wrong.",
        },
        editedBy: null,
        editedAt: null,
        attempts: [],
      },
      comments: [
        {
          by: "rosa",
          at: "2026-10-18T14:22:00Z",
          text: "This is the one that matters out of the 46 — it is the only prerequisite in waves 1–2 that another queued asset reads. The other 45 are read by assets that already published or by nothing at all.",
          resolved: false,
          replies: [],
        },
      ],
    },

    /* ======================================================================
       SS-1303 — the state Charles asked to be producible rather than decorative.
       One operator fixes and publishes, so "sent back" has to be an action that
       operator can take: hand the asset to whoever owns it, with a question.
       Here the question is whether the asset is wanted at all, and nobody in
       the room could answer it.
       ==================================================================== */
    {
      id: "SS-1303",
      name: "Cross-region payment latency",
      type: "Saved searches",
      layout: "query",
      app: "payments-core",
      wave: 1,
      stream: "translate-blocked",
      state: "sent-back",
      assignee: "martin",
      openedAt: "2026-10-07T10:30:00Z",
      sentBack: {
        at: "2026-10-09T15:12:00Z",
        by: "rosa",
        to: "Payments Core — platform owner",
        comment:
          "Before anyone rebuilds this: 1,900 lines of SPL accumulated over six years, most of it commented-out alternatives, and the last three edits are from people who have left. We cannot tell what it is for. If it is still needed, we need someone to say what question it answers and we will write that query. If it is not, say so and we will retire it rather than migrate it.",
      },
      origin: {
        label: "SPL exceeds the extended-context window",
        at: "2026-10-06T09:21:00Z",
        detail:
          "One of nine searches over roughly 24k tokens. It does not fit the extended-context window, and splitting it is not a translation decision — most of what makes it long is dead.",
      },
      delta: { auto: 0.0, manual: null },
      query: {
        n: 1,
        name: "Cross-region payment latency",
        splunkType: "Scheduled search",
        dtType: "— undetermined —",
        state: "blocked",
        spl:
          'index=payments_core OR index=payments_eu OR index=payments_apac earliest=-24h\n```  removed 2021-03: | join type=outer corridor [search index=legacy_corridor_map]  ```\n| eval region=case(match(host,"^eu-"),"emea",match(host,"^ap-"),"apac",1=1,"amer")\n| `wu_latency_pctl(95)`\n| stats p95(duration_ms) as p95, p99(duration_ms) as p99 by region, corridor\n| where p95 > 2000\n[ ... 1,847 further lines, 71% of them commented out ... ]',
        marks: { unsupported: ["[ ... 1,847 further lines, 71% of them commented out ... ]"], partial: ["index=payments_core OR index=payments_eu OR index=payments_apac"] },
        dql: null,
        deps: { indexes: ["payments_core", "payments_eu", "payments_apac", "legacy_corridor_map"], lookups: [], macros: ["wu_latency_pctl"] },
        result: { error: "Not attempted after the first pass. The search exceeds the extended-context window at roughly 24k tokens." },
        blockers: [
          { label: "Exceeds the extended-context window", tone: "critical", detail: "Roughly 24k tokens against a window that does not reach it. Generated by a reporting tool rather than written by a person." },
          { label: "References a decommissioned index", tone: "warning", detail: "`legacy_corridor_map` was retired in 2021. The join that used it is commented out, but three downstream `eval`s still reference its fields." },
          { label: "Nobody can state what it is for", tone: "critical", detail: "Not a technical blocker. It is the reason this is sent back rather than worked — rebuilding from intent requires an intent." },
        ],
        notes: {
          source: "Three buckets, one of them retired.",
          fields: "Indeterminate until somebody decides what the search is supposed to answer.",
          differences: "Not comparable. There is no translation to compare.",
          performance: "The original runs for roughly four minutes against three indexes, hourly.",
          model: "Undetermined.",
          testing: "Undetermined.",
        },
        editedBy: null,
        editedAt: null,
        attempts: [],
      },
      comments: [
        {
          by: "martin",
          at: "2026-10-09T15:20:00Z",
          text: "Chased the platform owner on the 9th and again on the 14th. No answer yet. This is the oldest open row in the queue and it is open because of a question, not because of a translation.",
          resolved: false,
          replies: [],
        },
      ],
    },

    /* ---- Wave 1 ---------------------------------------------------------- */
    {
      id: "DS-1031",
      name: "Payment Corridor Exceptions",
      type: "Dashboards",
      layout: "tiles",
      app: "payments-core",
      wave: 1,
      stream: "validate-triage",
      state: "published",
      assignee: "rosa",
      openedAt: "2026-10-07T11:40:00Z",
      publishedAt: "2026-10-08T16:05:00Z",
      origin: {
        label: "Meaningful difference",
        at: "2026-10-07T11:40:00Z",
        by: "rosa",
        detail:
          "Returned 12,400 rows in Splunk and 9,810 in Dynatrace for the same 24-hour window. The source counts each retry attempt as its own transaction; the DQL grouped by transaction id, so a payment retried three times collapsed to one row.",
      },
      delta: { auto: 0.71, manual: 0.99 },
      tiles: [
        {
          n: 1, name: "Exceptions by corridor", splunkType: "Table", dtType: "DataTable", state: "validated",
          spl: "index=payments_core status=exception earliest=-24h | stats count by corridor, exception_code | sort -count",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_payments_core" and status == "exception"\n| summarize count = count(), by: { corridor, exception_code }\n| sort count desc',
          deps: { indexes: ["payments_core"], lookups: [], macros: [] },
          result: { rows: 12400, executedAt: "2026-10-08T15:40:00Z" },
          notes: {
            source: "`index=payments_core` → `logs:wu_payments_core`.",
            fields: "`corridor`, `exception_code`, `status` all carry through.",
            differences: "None after correction. The grouping by `transaction_id` that the first translation added has been removed.",
            performance: "12,400 rows over 24 hours. Unremarkable.",
            model: "None.",
            testing: "Row count must match the raw exception count, not the distinct transaction count. That difference is the whole defect.",
          },
          editedBy: "rosa", editedAt: "2026-10-08T15:40:00Z",
          attempts: [{
            n: 1, at: "2026-10-08T15:31:00Z", by: "rosa",
            context: "Each retry attempt is its own transaction for this report — operations reconcile against the retry count. Do not group or deduplicate by transaction_id.",
            outcome: "resolved",
            note: "The regenerated DQL dropped the grouping and returned 12,400 rows, matching the original exactly.",
          }],
        },
        {
          n: 2, name: "Retry depth distribution", splunkType: "Column chart", dtType: "BarChart", state: "validated",
          spl: "index=payments_core status=exception earliest=-24h | stats count by retry_count",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_payments_core" and status == "exception"\n| summarize count = count(), by: { retry_count }',
          deps: { indexes: ["payments_core"], lookups: [], macros: [] },
          result: { rows: 6, executedAt: "2026-10-08T15:40:00Z" },
          notes: {
            source: "Same bucket.", fields: "`retry_count` carries through.",
            differences: "None.", performance: "Trivial.", model: "None.",
            testing: "The sum across retry depths must equal tile 1's row count.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 3, name: "Exception value at risk", splunkType: "Single value", dtType: "SingleValue", state: "validated",
          spl: "index=payments_core status=exception earliest=-24h | stats sum(amount_usd) as at_risk",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_payments_core" and status == "exception"\n| summarize at_risk = sum(amount_usd)',
          deps: { indexes: ["payments_core"], lookups: [], macros: [] },
          result: { rows: 1, executedAt: "2026-10-08T15:40:00Z" },
          notes: {
            source: "Same bucket.", fields: "`amount_usd` is pre-converted at ingest on both sides.",
            differences: "None after correction — though this tile is why the defect mattered: deduplicating by transaction understated value at risk by 21%.",
            performance: "Trivial.", model: "None.",
            testing: "Reconcile against the treasury daily exception report, not against the dashboard it replaces.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 4, name: "Exceptions over time", splunkType: "Line chart", dtType: "LineChart", state: "validated",
          spl: "index=payments_core status=exception earliest=-7d | timechart span=1h count",
          marks: {},
          dql: 'fetch logs, from: -7d\n| filter dt.system.bucket == "logs:wu_payments_core" and status == "exception"\n| makeTimeseries count(), interval: 1h',
          deps: { indexes: ["payments_core"], lookups: [], macros: [] },
          result: { rows: 168, executedAt: "2026-10-08T15:40:00Z" },
          notes: {
            source: "Same bucket.", fields: "None beyond the count.",
            differences: "None.", performance: "Trivial.", model: "None.",
            testing: "168 points over seven days on both sides.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 5, name: "Top failing counterparties", splunkType: "Table", dtType: "DataTable", state: "validated",
          spl: "index=payments_core status=exception earliest=-24h | lookup counterparty_ref cp_id OUTPUT cp_name | stats count by cp_name | sort -count | head 20",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_payments_core" and status == "exception"\n| lookup [fetch dt.entity.custom.counterparty_ref], sourceField: cp_id, lookupField: cp_id, fields: { cp_name }\n| summarize count = count(), by: { cp_name }\n| sort count desc\n| limit 20',
          deps: { indexes: ["payments_core"], lookups: ["counterparty_ref"], macros: [] },
          result: { rows: 20, executedAt: "2026-10-08T15:40:00Z" },
          notes: {
            source: "Same bucket plus a preloaded lookup.", fields: "`cp_id` is the lookup key.",
            differences: "None.", performance: "Broadcast join against 2,900 rows.",
            model: "Requires `counterparty_ref` preloaded.",
            testing: "Unmatched `cp_id`s drop silently on both sides — compare the row count, not just the names.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
      ],
      comments: [],
    },

    {
      id: "DS-1101",
      name: "Platform Ingest Health",
      type: "Dashboards",
      layout: "tiles",
      app: "platform-shared",
      wave: 1,
      stream: "translate-blocked",
      state: "published",
      assignee: "rosa",
      openedAt: "2026-10-06T10:02:00Z",
      publishedAt: "2026-10-08T11:20:00Z",
      origin: {
        label: "Lookup referenced but not preloaded",
        at: "2026-10-06T09:48:00Z",
        detail:
          "Two of sixteen panels read `sourcetype_owner.csv`, which had not been uploaded when Wave 1 ran. One of the six Wave 1 assets that reached a lookup before it existed — the pre-flight gate in Translate exists because of this run.",
      },
      delta: { auto: 0.0, manual: 0.97 },
      tiles: [
        {
          n: 1, name: "Ingest volume by sourcetype", splunkType: "Area chart", dtType: "AreaChart", state: "validated",
          spl: "index=_internal source=*metrics.log group=per_sourcetype_thruput earliest=-24h | timechart span=15m sum(kb) by series",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_platform_internal" and metric.group == "per_sourcetype_thruput"\n| makeTimeseries sum(kb), by: { series }, interval: 15m',
          deps: { indexes: ["_internal"], lookups: [], macros: [] },
          result: { rows: 96, executedAt: "2026-10-08T10:55:00Z" },
          notes: {
            source: "Splunk's `_internal` metrics map to the platform internal bucket populated at Import.",
            fields: "`group` → `metric.group`; `series` and `kb` carry through.",
            differences: "None.", performance: "96 buckets across 41 series.",
            model: "Requires the internal metrics ingest, which is a Prepare Environment deliverable.",
            testing: "Totals should agree within the ingest lag, not exactly.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 2, name: "Sourcetype ownership", splunkType: "Table", dtType: "DataTable", state: "validated",
          spl: "index=_internal group=per_sourcetype_thruput earliest=-24h | lookup sourcetype_owner series OUTPUT owner_team, cost_centre | stats sum(kb) as kb by owner_team, cost_centre | sort -kb",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_platform_internal" and metric.group == "per_sourcetype_thruput"\n| lookup [fetch dt.entity.custom.sourcetype_owner], sourceField: series, lookupField: series, fields: { owner_team, cost_centre }\n| summarize kb = sum(kb), by: { owner_team, cost_centre }\n| sort kb desc',
          deps: { indexes: ["_internal"], lookups: ["sourcetype_owner"], macros: [] },
          result: { rows: 14, executedAt: "2026-10-08T10:55:00Z" },
          notes: {
            source: "Same bucket plus the lookup that was missing at run time.",
            fields: "`series` is the lookup key.",
            differences: "None once the table existed. The translation was never wrong — it had nothing to resolve against.",
            performance: "41-row lookup. Trivial.",
            model: "Requires `sourcetype_owner` preloaded.",
            testing: "Unowned sourcetypes must appear as blank rather than dropping. Check the kb total against tile 1.",
          },
          editedBy: "rosa", editedAt: "2026-10-08T10:55:00Z",
          attempts: [{
            n: 1, at: "2026-10-08T10:48:00Z", by: "rosa",
            context: "sourcetype_owner.csv is now preloaded. Key column is `series`, matching the sourcetype name exactly. Sourcetypes with no owner must be kept and shown blank, not filtered out.",
            outcome: "resolved",
            note: "Nothing about the SPL changed. The retranslation succeeded because the dependency existed by then — which is the argument for the pre-flight gate rather than for a better translator.",
          }],
        },
        {
          n: 3, name: "Indexer queue fill", splunkType: "Line chart", dtType: "LineChart", state: "validated",
          spl: "index=_internal group=queue earliest=-4h | timechart span=1m max(current_size_kb) by name",
          marks: {},
          dql: 'fetch logs, from: -4h\n| filter dt.system.bucket == "logs:wu_platform_internal" and metric.group == "queue"\n| makeTimeseries max(current_size_kb), by: { name }, interval: 1m',
          deps: { indexes: ["_internal"], lookups: [], macros: [] },
          result: { rows: 240, executedAt: "2026-10-08T10:55:00Z" },
          notes: {
            source: "Same bucket.", fields: "`name` and `current_size_kb` carry through.",
            differences: "None.", performance: "Minute resolution over four hours.",
            model: "None beyond the internal metrics ingest.",
            testing: "Queue names must match the Splunk set exactly; a renamed queue reads as a gap.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 4, name: "License usage vs. entitlement", splunkType: "Single value", dtType: "SingleValue", state: "validated",
          spl: "index=_internal source=*license_usage.log earliest=-1d | stats sum(b) as bytes | eval pct=round(bytes/1024/1024/1024/500*100,1)",
          marks: {},
          dql: 'fetch logs, from: -1d\n| filter dt.system.bucket == "logs:wu_platform_internal" and log.source == "license_usage"\n| summarize bytes = sum(b)\n| fieldsAdd pct = round(bytes / 1073741824 / 500 * 100, decimals: 1)',
          deps: { indexes: ["_internal"], lookups: [], macros: [] },
          result: { rows: 1, executedAt: "2026-10-08T10:55:00Z" },
          notes: {
            source: "Same bucket.", fields: "`b` carries through as raw bytes.",
            differences: "None, though the 500 GB entitlement is hard-coded on both sides and will be wrong the day the contract changes.",
            performance: "Trivial.", model: "None.",
            testing: "Flagged for Govern & Close: the entitlement belongs in a configuration value, not in a panel.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
      ],
      comments: [],
    },

    {
      id: "DS-1103",
      name: "Shared Index Throughput",
      type: "Dashboards",
      layout: "tiles",
      app: "platform-shared",
      wave: 1,
      stream: "translate-blocked",
      state: "needs-review",
      assignee: "rosa",
      openedAt: "2026-10-06T10:05:00Z",
      origin: {
        label: "Multi-stage join beyond translator support",
        at: "2026-10-06T09:52:00Z",
        detail:
          "Five panels clean, four correlating four indexes at once. The shared `main` index has four unrelated writers — the same fact that dented the calibration curve.",
      },
      delta: { auto: 0.0, manual: 0.94 },
      tiles: [
        {
          n: 1, name: "Throughput by writer", splunkType: "Column chart", dtType: "BarChart", state: "validated",
          spl: "index=main earliest=-24h | stats count by sourcetype | sort -count",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_shared_main"\n| summarize count = count(), by: { sourcetype }\n| sort count desc',
          deps: { indexes: ["main"], lookups: [], macros: [] },
          result: { rows: 4, executedAt: "2026-10-20T14:02:00Z" },
          notes: {
            source: "`index=main` → `logs:wu_shared_main`.",
            fields: "`sourcetype` carries through.",
            differences: "None.", performance: "Trivial.", model: "None.",
            testing: "Four writers. A fifth appearing means something started writing to the shared index after the snapshot.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 2, name: "Cross-writer correlation", splunkType: "Table", dtType: "DataTable", state: "validated",
          spl: 'index=main earliest=-1h | stats count, values(sourcetype) as writers by correlation_id | where mvcount(writers) > 1',
          marks: {},
          dql: 'fetch logs, from: -1h\n| filter dt.system.bucket == "logs:wu_shared_main"\n| summarize {\n    count   = count(),\n    writers = collectDistinct(sourcetype)\n  }, by: { correlation_id }\n| filter arraySize(writers) > 1',
          deps: { indexes: ["main"], lookups: [], macros: [] },
          result: { rows: 1842, executedAt: "2026-10-20T14:02:00Z" },
          notes: {
            source: "One bucket.",
            fields: "`correlation_id` is the correlation key, and it is the only field all four writers agree on.",
            differences: "None after correction. The original expressed this as a four-way self-join; the aggregate form is equivalent and considerably cheaper.",
            performance: "Roughly 2.1M events per hour. The aggregate form is the reason this is viable at all.",
            model: "Requires `correlation_id` on every writer.",
            testing: "Compare against the Splunk join over a quiet hour. Over a busy hour the Splunk version times out, which is partly why it was written this way.",
          },
          editedBy: "rosa", editedAt: "2026-10-20T14:02:00Z",
          attempts: [{
            n: 1, at: "2026-10-20T13:48:00Z", by: "rosa",
            context:
              "This does not need a join. The four writers all land in the same bucket and all carry correlation_id — aggregate by correlation_id and keep the rows where more than one distinct sourcetype contributed. The self-join in the SPL was a Splunk-era workaround, not the intent.",
            outcome: "resolved",
            note: "Regenerated as an aggregation rather than a join. Same 1,842 rows as the original, and it returns in under a second against the original's forty.",
          }],
        },
        {
          n: 3, name: "Writer latency spread", splunkType: "Box plot", dtType: "BarChart", state: "validated",
          spl: "index=main earliest=-4h | stats p50(ingest_lag_ms) as p50, p95(ingest_lag_ms) as p95, p99(ingest_lag_ms) as p99 by sourcetype",
          marks: {},
          dql: 'fetch logs, from: -4h\n| filter dt.system.bucket == "logs:wu_shared_main"\n| summarize {\n    p50 = percentile(ingest_lag_ms, 50),\n    p95 = percentile(ingest_lag_ms, 95),\n    p99 = percentile(ingest_lag_ms, 99)\n  }, by: { sourcetype }',
          deps: { indexes: ["main"], lookups: [], macros: [] },
          result: { rows: 4, executedAt: "2026-10-20T14:02:00Z" },
          notes: {
            source: "One bucket.", fields: "`ingest_lag_ms` carries through.",
            differences: "Dynatrace has no box-plot visual; the three percentiles render as grouped bars. The numbers are identical.",
            performance: "Three percentiles over four hours.", model: "None.",
            testing: "Percentiles agree to three decimal places. The visual does not, and that is expected rather than a defect.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 4, name: "Retention headroom", splunkType: "Single value", dtType: "SingleValue", state: "validated",
          spl: "index=main | stats min(_time) as oldest | eval days=round((now()-oldest)/86400,1)",
          marks: {},
          dql: 'fetch logs\n| filter dt.system.bucket == "logs:wu_shared_main"\n| summarize oldest = min(timestamp)\n| fieldsAdd days = round((now() - oldest) / 86400000000000, decimals: 1)',
          deps: { indexes: ["main"], lookups: [], macros: [] },
          result: { rows: 1, executedAt: "2026-10-20T14:02:00Z" },
          notes: {
            source: "One bucket, unbounded timeframe.",
            fields: "`_time` → `timestamp`, nanoseconds.",
            differences: "None, allowing for bucket retention differing from Splunk's index retention.",
            performance: "An unbounded scan. Expensive on both sides and worth questioning.",
            model: "None.",
            testing: "Compare against the configured bucket retention rather than against Splunk — the two are set independently.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 5, name: "Shared index cost split", splunkType: "Pie chart", dtType: "PieChart", state: "validated",
          spl: "index=main earliest=-30d | lookup sourcetype_owner sourcetype OUTPUT cost_centre | stats sum(bytes) as b by cost_centre",
          marks: {},
          dql: 'fetch logs, from: -30d\n| filter dt.system.bucket == "logs:wu_shared_main"\n| lookup [fetch dt.entity.custom.sourcetype_owner], sourceField: sourcetype, lookupField: series, fields: { cost_centre }\n| summarize b = sum(bytes), by: { cost_centre }',
          deps: { indexes: ["main"], lookups: ["sourcetype_owner"], macros: [] },
          result: { rows: 3, executedAt: "2026-10-20T14:02:00Z" },
          notes: {
            source: "One bucket plus the ownership lookup.",
            fields: "The lookup key differs by name on the two sides — `sourcetype` here, `series` in the table.",
            differences: "None.", performance: "30-day scan with a broadcast join.",
            model: "Requires `sourcetype_owner` preloaded.",
            testing: "Three cost centres own four writers; one owns two. The split must not come back with four slices.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
      ],
      comments: [
        {
          by: "rosa", at: "2026-10-20T14:10:00Z",
          text: "Tile 2 is worth reading before anyone else fights a join. The SPL said join because Splunk made you say join; the intent was an aggregate. Retranslating the words would have reproduced the workaround.",
          resolved: false, replies: [],
        },
      ],
    },

    {
      id: "AL-1019",
      name: "Auth Service Error Budget Burn",
      type: "Alerts",
      layout: "query",
      app: "platform-shared",
      wave: 1,
      stream: "validate-live",
      state: "in-progress",
      assignee: "martin",
      openedAt: "2026-10-17T09:05:00Z",
      origin: {
        label: "Failed on live review",
        at: "2026-10-17T08:50:00Z",
        by: "ravi",
        detail:
          "The query and the threshold are both right — it fires on exactly the right condition. But the notification routes to the old Splunk on-call schedule, so nobody was paged when it burned on Oct 16. Comparison can't see that, and it shouldn't be expected to.",
      },
      delta: { auto: 0.95, manual: null },
      query: {
        n: 1,
        name: "Auth Service Error Budget Burn",
        splunkType: "Scheduled alert",
        dtType: "Metric event",
        state: "validated",
        spl: 'index=auth_service earliest=-1h | stats count(eval(status>=500)) as errors, count as total | eval burn=round(errors/total/0.001,2) | where burn > 2',
        marks: {},
        dql: 'fetch logs, from: -1h\n| filter dt.system.bucket == "logs:wu_platform_auth"\n| summarize {\n    errors = countIf(status >= 500),\n    total  = count()\n  }\n| fieldsAdd burn = round(errors / total / 0.001, decimals: 2)\n| filter burn > 2',
        deps: { indexes: ["auth_service"], lookups: [], macros: [] },
        result: { rows: 1, executedAt: "2026-10-17T09:10:00Z" },
        blockers: [
          {
            label: "Notification routing is outside DMA",
            tone: "warning",
            detail:
              "The DQL is correct and this stage has nothing to correct. What is wrong is the alerting profile the event routes to, which lives in the tenant's notification configuration — the same boundary that puts IAM and SSO outside the readiness gate. The asset is held here only so the open item stays visible against the wave.",
          },
        ],
        notes: {
          source: "`index=auth_service` → `logs:wu_platform_auth`.",
          fields: "`status` carries through as a numeric.",
          differences: "None. Replayed over 30 days: 7 firings on each side, same timestamps.",
          performance: "Hourly window. Trivial.",
          model: "None.",
          testing:
            "Re-testing the query proves nothing here — it already passes. The test is whether a firing reaches the on-call rotation, which has to be done by triggering it in the tenant.",
        },
        editedBy: null, editedAt: null, attempts: [],
      },
      comments: [
        {
          by: "martin", at: "2026-10-17T09:20:00Z",
          text: "Keeping this open against the wave even though the fix is in the notification profile and not in DMA. Closing it here would make the wave look clean while on-call is still wrong.",
          resolved: false, replies: [],
        },
      ],
    },

    {
      id: "AL-1036",
      name: "Payment Queue Depth Sustained",
      type: "Alerts",
      layout: "query",
      app: "payments-core",
      wave: 1,
      stream: "validate-live",
      state: "queued",
      assignee: null,
      openedAt: "2026-10-18T07:05:00Z",
      origin: {
        label: "Failed on live review — reversed override",
        at: "2026-10-18T07:05:00Z",
        by: "ravi",
        detail:
          "I was wrong. The suppression was never added in the tenant and three real pages went out at 02:00 on Oct 18. This is my override, not a translation fault — but it's live and it's wrong.",
      },
      delta: { auto: 0.74, manual: null },
      query: {
        n: 1,
        name: "Payment Queue Depth Sustained",
        splunkType: "Scheduled alert",
        dtType: "Metric event",
        state: "blocked",
        spl: "index=payments_core sourcetype=queue earliest=-30m | stats avg(depth) as depth by queue_name | where depth > 5000",
        marks: {},
        dql: 'fetch logs, from: -30m\n| filter dt.system.bucket == "logs:wu_payments_core" and sourcetype == "queue"\n| summarize depth = avg(depth), by: { queue_name }\n| filter depth > 5000',
        deps: { indexes: ["payments_core"], lookups: [], macros: [] },
        result: { rows: 2, executedAt: "2026-10-18T07:12:00Z" },
        blockers: [
          {
            label: "Nightly suppression window never configured",
            tone: "critical",
            detail:
              "The source alert was suppressed between 02:00 and 03:00 for the batch run. That suppression lived in Splunk's alert configuration, not in the search, so nothing in the SPL carried it and the comparison could not see it missing. The override that published this assumed it would be added in the tenant and it was not.",
          },
        ],
        notes: {
          source: "`index=payments_core` → `logs:wu_payments_core`.",
          fields: "`depth` and `queue_name` carry through.",
          differences:
            "Would have fired 6 times in Splunk and 9 in Dynatrace over the same 30 days. The three extra firings all fall in the 02:00–03:00 batch window.",
          performance: "Trivial.",
          model: "None.",
          testing: "Replay across a batch window specifically. A 30-day firing count hides this — it did once already.",
        },
        editedBy: null, editedAt: null, attempts: [],
      },
      comments: [
        {
          by: "ravi", at: "2026-10-18T07:08:00Z",
          text: "My call, my mistake. Worth recording that the override reason was sound and the follow-up never happened — the gap was in the handoff, not in the judgement.",
          resolved: false, replies: [],
        },
      ],
    },

    /* ---- Wave 2 ---------------------------------------------------------- */
    {
      id: "DS-2033",
      name: "Model Score Distribution",
      type: "Dashboards",
      layout: "tiles",
      app: "fraud-risk",
      wave: 2,
      stream: "validate-triage",
      state: "needs-review",
      assignee: "claire",
      openedAt: "2026-10-13T10:05:00Z",
      origin: {
        label: "Meaningful difference",
        at: "2026-10-13T10:05:00Z",
        by: "claire",
        detail:
          "Nine of fourteen panels match. The five that differ all read `fraud_score_bucket`, which rounds to one decimal place in Splunk and two in DQL — every score sitting on a bucket boundary moves one bucket left.",
      },
      delta: { auto: 0.68, manual: 0.97 },
      tiles: [
        {
          n: 1, name: "Score histogram", splunkType: "Column chart", dtType: "BarChart", state: "validated",
          spl: "index=fraud_scoring earliest=-24h | `fraud_score_bucket(risk_score)` | stats count by bucket | sort bucket",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_fraud_scoring"\n| fieldsAdd bucket = round(risk.score, decimals: 1)\n| summarize count = count(), by: { bucket }\n| sort bucket asc',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: ["fraud_score_bucket"] },
          result: { rows: 11, executedAt: "2026-10-20T16:20:00Z" },
          notes: {
            source: "`logs:wu_fraud_scoring`.",
            fields: "`risk_score` → `risk.score`.",
            differences: "None after correction. The macro now rounds to one decimal on both sides.",
            performance: "Trivial.",
            model: "None.",
            testing: "Check a score of exactly 0.65. That is the value that moved bucket, and it is the only test that distinguishes the two versions.",
          },
          editedBy: "claire", editedAt: "2026-10-20T16:20:00Z",
          attempts: [{
            n: 1, at: "2026-10-20T16:11:00Z", by: "claire",
            context:
              "fraud_score_bucket rounds to ONE decimal place, not two. The model risk team signs off on this distribution and the bucket boundaries are part of the signed artefact — half-up at one decimal, matching the Splunk macro exactly.",
            outcome: "resolved",
            note: "One macro, five panels. The dictionary entry was corrected once and the regeneration fixed all five tiles in a single pass.",
          }],
        },
        {
          n: 2, name: "Distribution vs. last month", splunkType: "Line chart", dtType: "LineChart", state: "validated",
          spl: "index=fraud_scoring earliest=-60d | `fraud_score_bucket(risk_score)` | timechart span=1d distinct_count(bucket)",
          marks: {},
          dql: 'fetch logs, from: -60d\n| filter dt.system.bucket == "logs:wu_fraud_scoring"\n| fieldsAdd bucket = round(risk.score, decimals: 1)\n| makeTimeseries countDistinctExact(bucket), interval: 1d',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: ["fraud_score_bucket"] },
          result: { rows: 60, executedAt: "2026-10-20T16:20:00Z" },
          notes: {
            source: "Same bucket.", fields: "Same rounding correction.",
            differences: "None after correction.", performance: "60-day scan, daily rollup.",
            model: "None.", testing: "Bucket count should be stable at 11 unless the model's output range moved.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 3, name: "Band share", splunkType: "Pie chart", dtType: "PieChart", state: "validated",
          spl: 'index=fraud_scoring earliest=-24h | `fraud_score_bucket(risk_score)` | eval band=if(bucket>=0.7,"high",if(bucket>=0.3,"medium","low")) | stats count by band',
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_fraud_scoring"\n| fieldsAdd bucket = round(risk.score, decimals: 1)\n| fieldsAdd band = if(bucket >= 0.7, "high", else: if(bucket >= 0.3, "medium", else: "low"))\n| summarize count = count(), by: { band }',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: ["fraud_score_bucket"] },
          result: { rows: 3, executedAt: "2026-10-20T16:20:00Z" },
          notes: {
            source: "Same bucket.",
            fields: "Band boundaries sit exactly on bucket edges, which is why the rounding defect moved real volume between bands.",
            differences: "None after correction. Before it, 2.1% of volume sat in the wrong band.",
            performance: "Trivial.", model: "None.",
            testing: "Band shares must sum to the ungrouped count and match the signed-off distribution.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 4, name: "Scores by channel", splunkType: "Table", dtType: "DataTable", state: "validated",
          spl: "index=fraud_scoring earliest=-24h | `fraud_score_bucket(risk_score)` | stats avg(bucket) as avg_bucket, count by channel | sort -count",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_fraud_scoring"\n| fieldsAdd bucket = round(risk.score, decimals: 1)\n| summarize {\n    avg_bucket = avg(bucket),\n    count      = count()\n  }, by: { channel }\n| sort count desc',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: ["fraud_score_bucket"] },
          result: { rows: 7, executedAt: "2026-10-20T16:20:00Z" },
          notes: {
            source: "Same bucket.", fields: "`channel` carries through.",
            differences: "None after correction.", performance: "Trivial.", model: "None.",
            testing: "Seven channels on both sides.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 5, name: "Boundary population", splunkType: "Single value", dtType: "SingleValue", state: "validated",
          spl: "index=fraud_scoring earliest=-24h | where risk_score IN (0.3, 0.7) | stats count",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_fraud_scoring"\n| filter in(risk.score, array(0.3, 0.7))\n| summarize count = count()',
          deps: { indexes: ["fraud_scoring"], lookups: [], macros: [] },
          result: { rows: 1, executedAt: "2026-10-20T16:20:00Z" },
          notes: {
            source: "Same bucket.",
            fields: "`risk_score` → `risk.score`, unrounded here deliberately.",
            differences: "None. This tile is the one that exposed the defect — it counts exactly the population the rounding moved.",
            performance: "Trivial.", model: "None.",
            testing: "This is the regression test for the whole dashboard. Keep it.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
      ],
      comments: [
        {
          by: "claire", at: "2026-10-20T16:25:00Z",
          text: "Five panels, one macro, one correction. Worth noting against the delta score: the auto result was 0.68 and it was 0.68 for a two-decimal rounding choice nobody made deliberately.",
          resolved: false, replies: [],
        },
      ],
    },

    {
      id: "SS-2044",
      name: "Watchlist Hit Reconciliation",
      type: "Saved searches",
      layout: "query",
      app: "sanctions",
      wave: 2,
      stream: "validate-triage",
      state: "queued",
      assignee: null,
      openedAt: "2026-10-13T12:18:00Z",
      blockedBy: ["LK-2101"],
      origin: {
        label: "Uncertain",
        at: "2026-10-13T12:18:00Z",
        by: "rosa",
        detail:
          "Depends on `fx_rates_intraday.csv`, which is rewritten every 15 minutes by an outputlookup search that could not be translated. The two sides disagree by 61 rows and the comparison cannot tell whether that is a translation fault or a table that has already gone stale.",
      },
      delta: { auto: 0.49, manual: null },
      query: {
        n: 1,
        name: "Watchlist Hit Reconciliation",
        splunkType: "Scheduled search",
        dtType: "DataTable",
        state: "blocked",
        spl: "index=sanctions earliest=-24h | lookup fx_rates_intraday currency_pair OUTPUT mid | eval usd_value=amount*mid | stats sum(usd_value) as exposure, count by watchlist, match_type | sort -exposure",
        marks: { partial: ["lookup fx_rates_intraday currency_pair OUTPUT mid"] },
        dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_sanctions"\n| lookup [fetch dt.entity.custom.fx_rates_intraday], sourceField: currency_pair, lookupField: currency_pair, fields: { mid }\n| fieldsAdd usd_value = amount * mid\n| summarize {\n    exposure = sum(usd_value),\n    count    = count()\n  }, by: { watchlist, match_type }\n| sort exposure desc',
        deps: { indexes: ["sanctions"], lookups: ["fx_rates_intraday"], macros: [] },
        result: { error: "Runs, and the result cannot be trusted. The lookup it reads is frozen at its last Splunk write — 61 currency pairs resolve to a stale rate and the rest resolve to nothing." },
        blockers: [
          {
            label: "Waiting on LK-2101 — fx_rates_intraday.csv",
            tone: "critical",
            detail:
              "This is not a defect in this query. The DQL is a faithful translation; the table underneath it has no live writer in the target, so every comparison on this asset is untrustworthy — this one and every future one. Nothing is gained by working it before the prerequisite is rebuilt.",
          },
        ],
        notes: {
          source: "`index=sanctions` → `logs:wu_sanctions`, plus the dynamic lookup.",
          fields: "`currency_pair` is the lookup key; `amount` and `mid` multiply into `usd_value`.",
          differences: "61 rows out of 1,204. All 61 are pairs whose rate moved after the table was last written.",
          performance: "Trivial once the table is live.",
          model: "Requires whatever LK-2101's rebuild produces, with the same key and a `mid` field.",
          testing: "Cannot be meaningfully tested until the prerequisite lands. Re-run the comparison then, not before.",
        },
        editedBy: null, editedAt: null, attempts: [],
      },
      comments: [
        {
          by: "rosa", at: "2026-10-13T12:24:00Z",
          text: "Deliberately left queued rather than in progress. Picking this up before LK-2101 is rebuilt would burn a day and produce a correction that still cannot be validated.",
          resolved: false, replies: [],
        },
      ],
    },

    {
      id: "DS-2014",
      name: "Screening Throughput & Backlog",
      type: "Dashboards",
      layout: "tiles",
      app: "sanctions",
      wave: 2,
      stream: "validate-live",
      state: "resolved",
      assignee: "hanna",
      openedAt: "2026-10-18T11:12:00Z",
      origin: {
        label: "Failed on live review",
        at: "2026-10-18T11:12:00Z",
        by: "hanna",
        detail:
          "Panel 7 defaults to a 24-hour timeframe; the Splunk original opened on 7 days. The query is right and the comparison window was right, so it matched — but the thing on screen in the morning is not what the team used to look at.",
      },
      delta: { auto: 0.94, manual: 0.98 },
      tiles: [
        {
          n: 1, name: "Screening throughput", splunkType: "Area chart", dtType: "AreaChart", state: "validated",
          spl: "index=sanctions earliest=-7d | timechart span=1h count by screening_stage",
          marks: {},
          dql: 'fetch logs, from: -7d\n| filter dt.system.bucket == "logs:wu_sanctions"\n| makeTimeseries count(), by: { screening_stage }, interval: 1h',
          deps: { indexes: ["sanctions"], lookups: [], macros: [] },
          result: { rows: 168, executedAt: "2026-10-18T14:30:00Z" },
          notes: {
            source: "`logs:wu_sanctions`.", fields: "`screening_stage` carries through.",
            differences: "None.", performance: "Trivial.", model: "None.",
            testing: "Seven days at hourly resolution on both sides.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 7, name: "Backlog age profile", splunkType: "Column chart", dtType: "BarChart", state: "validated",
          spl: "index=sanctions status=pending earliest=-7d | eval age_h=round((now()-_time)/3600,0) | stats count by age_h | sort age_h",
          marks: {},
          dql: 'fetch logs, from: -7d\n| filter dt.system.bucket == "logs:wu_sanctions" and status == "pending"\n| fieldsAdd age_h = round((now() - timestamp) / 3600000000000)\n| summarize count = count(), by: { age_h }\n| sort age_h asc',
          deps: { indexes: ["sanctions"], lookups: [], macros: [] },
          result: { rows: 168, executedAt: "2026-10-18T14:30:00Z" },
          notes: {
            source: "`logs:wu_sanctions`.",
            fields: "`_time` → `timestamp`, nanoseconds.",
            differences:
              "The query was never wrong. The panel's default timeframe was 24 hours where the Splunk original opened on 7 days, so a backlog older than a day was invisible on open. Comparison ran both sides over the same window and correctly found no difference.",
            performance: "Seven days rather than one. Four times the scan, still trivial.",
            model: "None.",
            testing:
              "Open the dashboard cold and read the longest age bucket. Running the query is not the test here — the defect only exists before anyone touches the timeframe control.",
          },
          editedBy: "hanna", editedAt: "2026-10-18T14:30:00Z",
          attempts: [{
            n: 1, at: "2026-10-18T14:22:00Z", by: "hanna",
            context:
              "The panel must open on 7 days, not 24 hours. The whole point of the backlog profile is the tail — anything older than a day is the part the team acts on, and it was off-screen by default.",
            outcome: "resolved",
            note:
              "The DQL did not change at all; the panel's default timeframe did. Recorded as a correction anyway, because the training capture should learn that a translated panel inherits the original's default window and not the target's.",
          }],
        },
      ],
      comments: [
        {
          by: "hanna", at: "2026-10-18T14:35:00Z",
          text: "Worth flagging to Translate as a general rule rather than a one-off: every panel should carry the source's default timeframe forward. We will hit this again on any dashboard whose original opened on anything but 24 hours.",
          resolved: true,
          replies: [
            {
              by: "rosa", at: "2026-10-18T15:02:00Z",
              text: "Raised. It is a translator default, so it is one change rather than a per-asset correction. Resolving this thread.",
            },
          ],
        },
      ],
    },

    /* ---- The fourth stream, worked and closed --------------------------- */
    {
      id: "MC-1047",
      name: "`wu_biz_hours`",
      type: "Macros",
      layout: "query",
      rebuild: true,
      app: "shared",
      wave: 1,
      stream: "no-equivalent",
      state: "resolved",
      assignee: "rosa",
      openedAt: "2026-10-09T09:00:00Z",
      blocks: ["DS-1031", "AL-1019"],
      origin: {
        label: "No automated path",
        at: "2026-10-09T09:00:00Z",
        detail:
          "A search macro, not an asset. Macros are textual substitution evaluated before the search runs; DQL has no macro layer, so there is nothing to translate into. Rebuilt from intent and published as a shared fragment that the assets referencing it inline.",
      },
      delta: { auto: 0, manual: 1.0 },
      query: {
        n: 1, name: "`wu_biz_hours`", splunkType: "Search macro", dtType: "Shared filter fragment", state: "validated",
        spl: "`wu_biz_hours`",
        marks: { unsupported: ["`wu_biz_hours`"] },
        dql: "// shared fragment — inlined by each consuming query\nfilter dayOfWeek(timestamp) >= 1 and dayOfWeek(timestamp) <= 5\n  and hourOfDay(timestamp, timezone: \"Europe/London\") >= 8\n  and hourOfDay(timestamp, timezone: \"Europe/London\") < 18",
        deps: { indexes: [], lookups: [], macros: ["wu_biz_hours"] },
        result: { rows: 0, executedAt: "2026-10-09T15:40:00Z" },
        notes: {
          source: "None — the macro reads no data. It is a predicate applied to whatever the consuming query fetched.",
          fields: "`timestamp` only.",
          differences:
            "The Splunk macro hard-coded the server's local time. Written out explicitly against Europe/London, which is what it always meant and what the two consuming assets assumed.",
          performance: "A filter predicate. No measurable cost.",
          model: "None.",
          testing:
            "Run both consuming assets across a BST boundary. The macro's implicit server time and an explicit Europe/London agree all year in this estate, but writing it down is the point.",
        },
        editedBy: "rosa", editedAt: "2026-10-09T15:40:00Z",
        attempts: [{
          n: 1, at: "2026-10-09T15:30:00Z", by: "rosa",
          context:
            "Business hours means Monday to Friday, 08:00–18:00 London. The macro expression is the spec; there is nothing to retranslate. Written as a fragment the consuming queries inline rather than a standalone asset.",
          outcome: "resolved",
          note:
            "Published as a fragment. Two assets reference it, and both were re-run against the rebuilt predicate before this closed.",
        }],
      },
      comments: [
        {
          by: "rosa", at: "2026-10-09T15:45:00Z",
          text: "Seventeen macros in this estate and most are this shape — a predicate someone got tired of retyping. They are cheap individually and they block whatever references them, so they want doing first in a wave, not last.",
          resolved: true,
          replies: [],
        },
      ],
    },

    /* ---- Wave 3: translated, not yet validated --------------------------- */
    {
      id: "AL-3203",
      name: "Unmatched settlement older than 2h",
      type: "Alerts",
      layout: "query",
      app: "settlement",
      wave: 3,
      stream: "translate-blocked",
      state: "in-progress",
      assignee: "tomas",
      openedAt: "2026-10-20T08:40:00Z",
      origin: {
        label: "Blocked in translation",
        at: "2026-10-20T08:40:00Z",
        detail:
          "A subsearch that builds a list of matched IDs and then excludes them from the outer search. The retry produced the same unrunnable shape, because the problem is structural rather than a mapping gap.",
      },
      delta: { auto: 0, manual: 0 },
      query: {
        n: 1, name: "Unmatched settlement older than 2h", splunkType: "Scheduled alert", dtType: "Metric event", state: "blocked",
        spl: "index=settlement type=instruction earliest=-4h NOT [search index=settlement type=confirmation earliest=-4h | fields instruction_id] | where _time < relative_time(now(), \"-2h\") | stats count by corridor",
        marks: { unsupported: ["[search index=settlement type=confirmation earliest=-4h | fields instruction_id]"] },
        dql: "// no runnable DQL produced",
        deps: { indexes: ["settlement"], lookups: [], macros: [] },
        result: { error: "Translation produced no executable statement. The subsearch has no direct DQL form." },
        blockers: [{
          label: "Subsearch exclusion",
          tone: "critical",
          detail:
            "DQL has no subsearch. The equivalent is a left join of instructions against confirmations followed by a filter on the null side — a different query shape, not a token substitution, which is why the retry did not help.",
        }],
        notes: {
          source: "`logs:wu_settlement`.",
          fields: "`instruction_id`, `corridor`, `type`.",
          differences: "To be written once the join rewrite is in.",
          performance:
            "The join reads the four-hour confirmation window once instead of once per outer row. Expected to be cheaper than the original, not dearer.",
          model: "None.",
          testing:
            "Pick an hour with known unmatched instructions and compare the per-corridor counts against the Splunk original.",
        },
        editedBy: null, editedAt: null,
        attempts: [{
          n: 1, at: "2026-10-20T10:05:00Z", by: "tomas",
          context:
            "Rewrite the exclusion as a left join: fetch instructions, join confirmations on instruction_id, keep the rows where the confirmation side is null and the instruction is older than two hours.",
          outcome: "still-failing",
          note:
            "The join came back but the null-side filter dropped everything — the joined fields are an empty record rather than null. Needs `isNull()` on a specific joined field, not on the record.",
        }],
      },
      comments: [
        {
          by: "tomas", at: "2026-10-20T10:12:00Z",
          text: "Close. The join is right and the filter is wrong. Trying `isNull(confirmation[instruction_id])` next rather than testing the record itself.",
          resolved: false,
          replies: [],
        },
      ],
    },
    {
      id: "DS-3106",
      name: "Settlement Exception Board",
      type: "Dashboards",
      layout: "tiles",
      app: "settlement",
      wave: 3,
      stream: "translate-blocked",
      state: "queued",
      assignee: null,
      openedAt: "2026-10-20T08:40:00Z",
      origin: {
        label: "Blocked in translation",
        at: "2026-10-20T08:40:00Z",
        detail:
          "Two of six panels blocked on the same transaction-grouping construct. The other four translated and validated, so this asset is four-sixths done and cannot publish until the two land.",
      },
      delta: { auto: 0, manual: 0 },
      tiles: [
        {
          n: 1, name: "Exceptions by corridor", splunkType: "Column chart", dtType: "BarChart", state: "validated",
          spl: "index=settlement type=exception earliest=-24h | stats count by corridor | sort -count",
          marks: {},
          dql: 'fetch logs, from: -24h\n| filter dt.system.bucket == "logs:wu_settlement" and type == "exception"\n| summarize count = count(), by: { corridor }\n| sort count desc',
          deps: { indexes: ["settlement"], lookups: [], macros: [] },
          result: { rows: 11, executedAt: "2026-10-20T08:52:00Z" },
          notes: {
            source: "`logs:wu_settlement`.", fields: "`corridor`, `type`.",
            differences: "None.", performance: "Trivial.", model: "None.",
            testing: "Counts matched across 24 hours.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 3, name: "Exception lifecycle duration", splunkType: "Table", dtType: "Table", state: "blocked",
          spl: "index=settlement earliest=-24h | transaction instruction_id startswith=\"raised\" endswith=\"cleared\" | stats avg(duration) p95(duration) by corridor",
          marks: { unsupported: ["transaction instruction_id startswith=\"raised\" endswith=\"cleared\""] },
          dql: "// no runnable DQL produced",
          deps: { indexes: ["settlement"], lookups: [], macros: [] },
          result: { error: "Translation produced no executable statement. `transaction` has no DQL equivalent." },
          blockers: [{
            label: "`transaction` grouping",
            tone: "critical",
            detail:
              "`transaction` stitches events into a session by shared ID and start/end markers, synthesising a duration. DQL expresses this as a summarize over the ID taking min and max timestamps, then the difference — correct, but it drops the start/end marker semantics, so rows that never cleared need handling explicitly.",
          }],
          notes: {
            source: "`logs:wu_settlement`.",
            fields: "`instruction_id`, `duration` (synthesised), `corridor`.",
            differences: "To be written.",
            performance: "The summarize form is cheaper than `transaction`, which buffers whole sessions in memory.",
            model: "None.",
            testing:
              "Average is forgiving; p95 is not. Compare both, and separately count the instructions that raised and never cleared — those are the rows the marker semantics decide.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
        {
          n: 5, name: "Ageing exceptions", splunkType: "Table", dtType: "Table", state: "blocked",
          spl: "index=settlement earliest=-24h | transaction instruction_id startswith=\"raised\" | where duration > 7200 | table instruction_id corridor duration",
          marks: { unsupported: ["transaction instruction_id startswith=\"raised\""] },
          dql: "// no runnable DQL produced",
          deps: { indexes: ["settlement"], lookups: [], macros: [] },
          result: { error: "Translation produced no executable statement. `transaction` has no DQL equivalent." },
          blockers: [{
            label: "`transaction` grouping",
            tone: "critical",
            detail:
              "The same construct as panel 3, and here the open-ended form is the whole point: this panel exists to list the instructions that raised and never cleared. Whatever fixes panel 3 fixes this one, and the two want doing together.",
          }],
          notes: {
            source: "`logs:wu_settlement`.", fields: "`instruction_id`, `corridor`, `duration`.",
            differences: "To be written.", performance: "As panel 3.", model: "None.",
            testing: "The row set must match the Splunk original exactly — this panel is a worklist, not a summary.",
          },
          editedBy: null, editedAt: null, attempts: [],
        },
      ],
      comments: [],
    },
    {
      id: "MC-3012",
      name: "`wu_accel_stats`",
      type: "Macros",
      layout: "query",
      rebuild: true,
      app: "settlement",
      wave: 3,
      stream: "no-equivalent",
      state: "queued",
      assignee: null,
      openedAt: "2026-10-20T08:40:00Z",
      blocks: ["DS-3106"],
      origin: {
        label: "No automated path",
        at: "2026-10-20T08:40:00Z",
        detail:
          "A macro that takes an argument and expands into an accelerated-report lookup. Two things with no DQL counterpart at once: the macro layer and report acceleration.",
      },
      delta: { auto: 0, manual: 0 },
      query: {
        n: 1, name: "`wu_accel_stats(corridor)`", splunkType: "Search macro (1 argument)", dtType: "Rebuild from intent", state: "blocked",
        spl: "`wu_accel_stats(corridor)`",
        marks: { unsupported: ["`wu_accel_stats(corridor)`"] },
        dql: "// rebuild from intent — nothing to translate",
        deps: { indexes: ["settlement"], lookups: [], macros: ["wu_accel_stats"] },
        result: { error: "No automated path. A parameterised macro over an accelerated report has no DQL form." },
        blockers: [
          {
            label: "Macro layer",
            tone: "critical",
            detail: "DQL has no textual substitution step. The expansion has to be written out at each call site or published as a fragment.",
          },
          {
            label: "Report acceleration",
            tone: "warning",
            detail:
              "The Splunk macro reads a pre-summarised accelerated report. Grail has no equivalent artefact; the choice is to compute live over raw or to stand up a scheduled summarisation — a decision for the architect, not a translation.",
          },
        ],
        notes: {
          source: "Accelerated report `settlement_corridor_hourly`, itself derived from `logs:wu_settlement`.",
          fields: "`corridor` in; count, average and p95 out.",
          differences: "To be decided with the architect — live computation or a scheduled summary.",
          performance:
            "The reason the macro exists. The accelerated report is why the dashboard opens in under a second; computing live over 24 hours is the thing to measure before committing.",
          model: "None.",
          testing: "Against the accelerated report's own numbers for a day the report already covers.",
        },
        editedBy: null, editedAt: null, attempts: [],
      },
      comments: [
        {
          by: "tomas", at: "2026-10-20T09:05:00Z",
          text: "Blocking DS-3106's two remaining panels. Raising the acceleration question with the architect before anyone writes DQL — picking live computation by default is how a dashboard that opened instantly starts taking nine seconds.",
          resolved: false,
          replies: [],
        },
      ],
    },

    /* ---- Wave 4: the back of the queue ----------------------------------- */
    {
      id: "AL-4201",
      name: "Branch close-of-day variance",
      type: "Alerts",
      layout: "query",
      app: "branch",
      wave: 4,
      stream: "translate-blocked",
      state: "queued",
      assignee: null,
      openedAt: "2026-10-20T08:40:00Z",
      origin: {
        label: "Blocked in translation",
        at: "2026-10-20T08:40:00Z",
        detail:
          "A `$branch_set$` token with no value in the mapping cascade. Translate held it rather than running it, and the retry held it again — the token is the same two missing values that held 134 of Wave 5's assets.",
      },
      delta: { auto: 0, manual: 0 },
      query: {
        n: 1, name: "Branch close-of-day variance", splunkType: "Scheduled alert", dtType: "Metric event", state: "blocked",
        spl: "index=branch event=close_of_day $branch_set$ | stats sum(variance) as total_variance by branch_id | where abs(total_variance) > 500",
        marks: { unsupported: ["$branch_set$"] },
        dql: "// held — unresolved token",
        deps: { indexes: ["branch"], lookups: [], macros: [] },
        result: { error: "Held before execution. `$branch_set$` has no value in the mapping cascade." },
        blockers: [{
          label: "Unresolved token `$branch_set$`",
          tone: "warning",
          detail:
            "Not a translation problem. The token resolves from the global mapping, and the value is not there. Supply it in Global Mapping and this asset re-runs automatically — there is nothing to fix on this screen.",
        }],
        notes: {
          source: "`logs:wu_branch`.",
          fields: "`branch_id`, `variance`, `event`.",
          differences: "Unknown until the token resolves.",
          performance: "Unknown.",
          model: "None.",
          testing: "Against a close-of-day with a known variance breach, once the token is supplied.",
        },
        editedBy: null, editedAt: null, attempts: [],
      },
      comments: [],
    },
    {
      id: "SS-4305",
      name: "Teller exception audit trail",
      type: "Saved searches",
      layout: "query",
      app: "branch",
      wave: 4,
      stream: "translate-blocked",
      state: "in-progress",
      assignee: "hanna",
      openedAt: "2026-10-20T08:40:00Z",
      origin: {
        label: "Blocked in translation",
        at: "2026-10-20T08:40:00Z",
        detail:
          "Three chained `eval` expressions using a multi-value function the translator does not carry. The surrounding search is straightforward; the blockage is one function deep in the middle of it.",
      },
      delta: { auto: 0, manual: 0 },
      query: {
        n: 1, name: "Teller exception audit trail", splunkType: "Saved search", dtType: "DQL query", state: "blocked",
        spl: "index=branch sourcetype=teller_audit earliest=-30d | eval codes=split(exception_codes,\",\") | eval severity=mvmap(codes, case(match(codes,\"^E9\"),\"high\",match(codes,\"^E5\"),\"medium\",1=1,\"low\")) | stats count by branch_id severity",
        marks: {
          unsupported: ["mvmap(codes, case(match(codes,\"^E9\"),\"high\",match(codes,\"^E5\"),\"medium\",1=1,\"low\"))"],
          partial: ["split(exception_codes,\",\")"],
        },
        dql: "// no runnable DQL produced",
        deps: { indexes: ["branch"], lookups: [], macros: [] },
        result: { error: "Translation produced no executable statement. `mvmap` has no direct DQL equivalent." },
        blockers: [{
          label: "`mvmap` over a split array",
          tone: "critical",
          detail:
            "DQL splits a string into an array fine, but mapping an expression across each element is `arrayMap` with a different argument shape, and the nested `case` has to be rewritten as a lambda. Mechanical, but not a substitution.",
        }],
        notes: {
          source: "`logs:wu_branch`, teller audit.",
          fields: "`exception_codes` (comma-joined string), `branch_id`.",
          differences: "To be written once the array mapping is in.",
          performance: "Thirty days of teller audit. Worth checking the scan before this publishes.",
          model: "None.",
          testing:
            "A teller with several codes on one event is the case that matters — one event must contribute to several severity buckets, not be assigned a single one.",
        },
        editedBy: null, editedAt: null,
        attempts: [{
          n: 1, at: "2026-10-20T13:20:00Z", by: "hanna",
          context:
            "Split `exception_codes` on the comma, then map each element to a severity with `arrayMap` and a lambda holding the three cases. One event with several codes must land in several buckets.",
          outcome: "improved",
          note:
            "Runs now and the per-branch totals are close, but the low bucket is short — codes that match neither prefix are being dropped rather than defaulted. The `1=1` fallback did not survive the rewrite.",
        }],
      },
      comments: [],
    },
    {
      id: "LK-4102",
      name: "`branch_hierarchy.csv`",
      type: "Lookups",
      layout: "query",
      rebuild: true,
      app: "branch",
      wave: 4,
      stream: "no-equivalent",
      state: "sent-back",
      assignee: "rosa",
      openedAt: "2026-10-20T08:40:00Z",
      sentBack: {
        at: "2026-10-20T16:05:00Z",
        by: "rosa",
        to: "Branch Operations (data owner)",
        comment:
          "The file is a four-level hierarchy with 1,840 rows and no documented refresh. Before this is rebuilt as a lookup table, Branch Operations needs to confirm who owns it, how often it changes, and whether the two orphaned levels are live or historic. Rebuilding it as it stands would copy a data-quality problem into the tenant.",
      },
      blocks: ["AL-4201"],
      origin: {
        label: "No automated path",
        at: "2026-10-20T08:40:00Z",
        detail:
          "A CSV lookup maintained by hand outside Splunk. There is no source query to translate — the asset is the file, and the rebuild is a decision about ownership before it is a decision about DQL.",
      },
      delta: { auto: 0, manual: 0 },
      query: {
        n: 1, name: "`branch_hierarchy.csv`", splunkType: "CSV lookup (1,840 rows)", dtType: "Lookup table", state: "blocked",
        spl: "| inputlookup branch_hierarchy.csv",
        marks: { unsupported: ["| inputlookup branch_hierarchy.csv"] },
        dql: "// rebuild from intent — nothing to translate",
        deps: { indexes: [], lookups: ["branch_hierarchy"], macros: [] },
        result: { error: "No automated path. The asset is a maintained file, not a query." },
        blockers: [{
          label: "Awaiting the data owner",
          tone: "warning",
          detail:
            "Sent back to Branch Operations on 20 Oct. Nothing on this screen moves until ownership and refresh cadence come back — and 2 of the 4 hierarchy levels have rows that reference a parent that is not in the file.",
        }],
        notes: {
          source: "A file. Maintained by hand, last modified in the Splunk instance on 2024-11-03.",
          fields: "`branch_id`, `district`, `region`, `country`, plus two columns nothing reads.",
          differences: "Not yet rebuilt.",
          performance: "1,840 rows. Negligible either way.",
          model: "None.",
          testing:
            "Join every branch in 30 days of `logs:wu_branch` against the rebuilt table and count the misses. The Splunk original has misses too — the target is parity, and anything better than parity is a separate conversation with the owner.",
        },
        editedBy: null, editedAt: null, attempts: [],
      },
      comments: [
        {
          by: "rosa", at: "2026-10-20T16:08:00Z",
          text: "Holding AL-4201 as well, which resolves branch sets through this hierarchy. Both move when the owner answers; neither is a DMA problem.",
          resolved: false,
          replies: [],
        },
      ],
    },
  ];

  /* ======================================================================== */

  const sum = (rows, key) => rows.reduce((a, r) => a + (r[key] || 0), 0);

  X.waveRow = (waveId) => X.byWave.find((r) => r.wave === Number(waveId)) || null;
  X.stateRow = (waveId) => X.statesByWave.find((r) => r.wave === Number(waveId)) || null;

  /* Stream totals. Three of the four are re-derived from the stage that
     produced them every time they are read, so a change in Translate or
     Validate moves this stage's inbox without anybody editing this file. */
  /* Waves 5 and 6 have no row above, and that is the honest answer rather than
     a gap: Wave 5 is still translating and Wave 6 has not started, so neither
     has produced an exception yet. Returning zeros — not null — keeps the
     empty queue a state the screen can render instead of one it crashes on.
     X.hasQueue() is what lets the module say *why* it is empty. */
  X.hasQueue = (waveId) => !waveId || waveId === "all" || !!X.waveRow(waveId);

  X.streamCounts = function (waveId) {
    if (waveId && waveId !== "all") {
      const r = X.waveRow(waveId);
      if (!r) return { "translate-blocked": 0, "validate-triage": 0, "validate-live": 0, "no-equivalent": 0 };
      return {
        "translate-blocked": r["translate-blocked"],
        "validate-triage": r["validate-triage"],
        "validate-live": r["validate-live"],
        "no-equivalent": r["no-equivalent"],
      };
    }
    const tr = DMA.data.translation.estate();
    const va = DMA.data.validation.estate();
    return {
      "translate-blocked": tr.blocked,
      "validate-triage": va.toExceptions,
      "validate-live": va.failed,
      "no-equivalent": X.NO_EQUIVALENT_TOTAL,
    };
  };

  X.estate = function (waveId) {
    const streams = X.streamCounts(waveId);
    const total = X.STREAMS.reduce((a, s) => a + streams[s.id], 0);
    const attempted = total - streams["no-equivalent"];

    const stateRows = waveId && waveId !== "all" ? [X.stateRow(waveId)].filter(Boolean) : X.statesByWave;
    const states = {};
    X.STATE_ORDER.forEach((k) => (states[k] = sum(stateRows, k)));

    const open = X.OPEN_STATES.reduce((a, k) => a + states[k], 0);
    const done = X.DONE_STATES.reduce((a, k) => a + states[k], 0);

    return {
      total,
      attempted,          // the 252 — everything that had an automated attempt
      noPath: streams["no-equivalent"],
      streams,
      states,
      open,
      done,
      clearedRate: total ? (done / total) * 100 : 0,
    };
  };

  /* --- Sample accessors ----------------------------------------------------
     The 19 records in X.assets are a worked sample of the 298, not the 298.
     Every count on the screen comes from estate()/streamCounts(); these
     accessors only ever reach the rows a user can actually open. Keeping that
     line sharp is what stops a rate being computed off 19. */

  X.byId = (id) => X.assets.find((a) => a.id === id) || null;

  /* One shape for both layouts. A single-query asset carries `query`, which is
     a tile with n: 1, so every renderer can treat the two identically. */
  X.tilesOf = (asset) => (asset ? asset.tiles || (asset.query ? [asset.query] : []) : []);

  X.progressOf = function (asset) {
    const tiles = X.tilesOf(asset);
    const validated = tiles.filter((t) => t.state === "validated").length;
    return { validated, blocked: tiles.length - validated, total: tiles.length };
  };

  X.assetsFor = function (filter = {}) {
    const want = (key, value) =>
      !filter[key] || filter[key] === "all" || String(value) === String(filter[key]);
    return X.assets.filter(
      (a) =>
        want("wave", a.wave) && want("type", a.type) &&
        want("stream", a.stream) && want("state", a.state)
    );
  };

  /* Dependency links are declared once, on the asset that does the blocking.
     The reverse direction is derived so the two sides cannot disagree. */
  X.blockedByOf = function (id) {
    const declared = (X.byId(id) || {}).blockedBy || [];
    const reverse = X.assets.filter((a) => (a.blocks || []).includes(id)).map((a) => a.id);
    return [...new Set([...declared, ...reverse])];
  };
  X.blocksOf = function (id) {
    const declared = (X.byId(id) || {}).blocks || [];
    const reverse = X.assets.filter((a) => (a.blockedBy || []).includes(id)).map((a) => a.id);
    return [...new Set([...declared, ...reverse])];
  };

  /* --- Single-asset publish health ----------------------------------------
     Exceptions publishes one asset at a time; Deploy publishes waves. The
     decision that made this screen honest was that the single-asset path runs
     the SAME pre-deploy gate as the wave — it does not get to skip it because
     it is only one dashboard. So this returns the gate, pass or fail, and the
     screen shows every check including the ones that block.

     Checks are ordered cheapest-to-explain first. `tone` is the design-system
     vocabulary so the module does not have to map it. */
  X.healthFor = function (asset) {
    if (!asset) return { ok: false, checks: [] };
    const checks = [];
    const tiles = X.tilesOf(asset);
    const unit = asset.layout === "tiles" ? "panel" : "query";
    const prog = X.progressOf(asset);

    checks.push(
      prog.blocked === 0
        ? {
            id: "runnable", label: `Every ${unit} runs`, state: "pass",
            detail: `${prog.validated} of ${prog.total} executed against the tenant and returned rows.`,
          }
        : {
            id: "runnable", label: `Every ${unit} runs`, state: "fail",
            detail: `${prog.blocked} of ${prog.total} ${prog.blocked === 1 ? "has" : "have"} no runnable DQL. ${
              asset.layout === "tiles"
                ? "A dashboard publishes whole or not at all."
                : "The asset is one query, so there is nothing to publish."
            }`,
          }
    );

    const waiting = X.blockedByOf(asset.id).filter((d) => {
      const dep = X.byId(d);
      return !dep || X.OPEN_STATES.includes(dep.state);
    });
    checks.push(
      waiting.length === 0
        ? {
            id: "deps", label: "Upstream assets delivered", state: "pass",
            detail: "Nothing this asset reads is still open in the queue.",
          }
        : {
            id: "deps", label: "Upstream assets delivered", state: "fail",
            detail: `${waiting.join(", ")} ${waiting.length === 1 ? "is" : "are"} still open. The query will run and return nothing until ${waiting.length === 1 ? "it lands" : "they land"}.`,
          }
    );

    const unresolvedTokens = tiles.some((t) =>
      ((t.marks && t.marks.unsupported) || []).some((m) => /^\$.*\$$/.test(m))
    );
    checks.push(
      unresolvedTokens
        ? {
            id: "tokens", label: "Mapping tokens resolved", state: "fail",
            detail: "An unresolved token is a Global Mapping handoff, not a correction. Supply the value there and the asset re-runs on its own.",
          }
        : {
            id: "tokens", label: "Mapping tokens resolved", state: "pass",
            detail: "Every token resolved through the mapping cascade.",
          }
    );

    const openThreads = (asset.comments || []).filter((c) => !c.resolved).length;
    checks.push(
      openThreads === 0
        ? {
            id: "threads", label: "No open review threads", state: "pass",
            detail: "Every comment on this asset is resolved.",
          }
        : {
            id: "threads", label: "No open review threads", state: "warn",
            detail: `${openThreads} open ${openThreads === 1 ? "thread" : "threads"}. A warning, not a block — publishing does not close a conversation.`,
          }
    );

    /* The check that makes the gate real rather than decorative. */
    const wave = (DMA.data.project.waves || []).find((w) => w.id === asset.wave);
    const deployState = wave ? DMA.data.waveStageStatus(wave, "deploy") : null;
    const deployed = deployState === "complete" || deployState === "in-progress";
    checks.push(
      deployed
        ? {
            id: "wave", label: `Wave ${asset.wave} is deployable`, state: "pass",
            detail: "The wave has cleared its own pre-deploy gate, so a single asset can follow it into the tenant.",
          }
        : {
            id: "wave", label: `Wave ${asset.wave} is deployable`, state: "fail",
            detail: `Wave ${asset.wave} has not deployed. Publishing one asset ahead of its wave would put it in the tenant with none of the assets it sits beside — the fix lands here, the publish waits for Deploy.`,
          }
    );

    const failed = checks.filter((c) => c.state === "fail");
    return {
      ok: failed.length === 0,
      checks,
      failed,
      blockedByWave: !deployed,
      summary: failed.length === 0
        ? "Pre-deploy health check passed."
        : `${failed.length} of ${checks.length} checks block this publish.`,
    };
  };

  /* --- Self-check ----------------------------------------------------------
     The per-wave table is a fixture; the stream totals are derived. They have
     to agree, and the only way to be sure of that is to check it on load.
     Same contract as validation.js's assertTotals(), for the same reason. */
  X.assertStreams = function () {
    const out = [];
    const derived = X.streamCounts("all");
    X.STREAMS.forEach((s) => {
      const fromWaves = sum(X.byWave, s.id);
      if (fromWaves !== derived[s.id]) out.push(`${s.id}: byWave ${fromWaves} ≠ ${derived[s.id]}`);
    });

    const total = X.STREAMS.reduce((a, s) => a + derived[s.id], 0);
    const states = sum(X.statesByWave, "queued") + sum(X.statesByWave, "in-progress") +
      sum(X.statesByWave, "needs-review") + sum(X.statesByWave, "sent-back") +
      sum(X.statesByWave, "resolved") + sum(X.statesByWave, "published");
    if (states !== total) out.push(`statesByWave ${states} ≠ ${total} in the queue`);

    const typed = X.STREAMS.reduce(
      (a, s) => a + X.TYPES.reduce((b, t) => b + X.byType[s.id][t], 0), 0);
    if (typed !== total) out.push(`byType ${typed} ≠ ${total} in the queue`);

    if (out.length) console.warn("[exceptions] stream drift:", out.join(" · "));
    return out;
  };
})();
