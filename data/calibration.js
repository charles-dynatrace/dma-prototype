/* ============================================================================
   DATA: Calibration
   ----------------------------------------------------------------------------
   Everything the Calibrate stage needs that is not already owned elsewhere.

   Three numbers deliberately live OUTSIDE this file and are read, never
   restated:
     · the sample itself      — DMA.data.planning.calibration.sample
                                (11 applications, 214 assets, drawn at plan time)
     · the project roll-up    — DMA.data.project.calibration
                                (sampleSize, predicted vs actual, lift, reviewer)
     · the estate outcome     — DMA.data.project.validation
                                (owned by Validate; Calibrate predicts it, it
                                 does not report it)

   The split matters. Prioritize & Plan decides WHICH assets are sampled,
   because that is a planning decision made alongside wave placement. This file
   describes what HAPPENED when that sample was run. If the plan changes the
   sample, the counts here follow automatically — `batches()` below zips against
   the planning sample rather than copying it.

   The arithmetic that has to hold:
     167 of 214 auto-approved with the profile        = 78.0%  → the prediction
     118 of 214 auto-approved with it withheld        = 55.1%  → the control
     difference                                       = 23 pp  → project.calibration.lift
     78 is what Calibrate promised; 81.2 is what Validate later measured.
     The prediction was conservative by 3.2 points, which is the right
     direction to be wrong in.
   ========================================================================== */

(function () {
  "use strict";

  const C = (DMA.data.calibration = {});

  /* --- The run ----------------------------------------------------------
     Calibration is one run, not a standing process. It executes against
     non-prod only, and it is the only stage that writes nothing to the
     customer's production tenant. ---------------------------------------- */
  C.run = {
    status: "complete",
    startedAt: "2026-10-09T08:15:00Z",
    finishedAt: "2026-10-09T11:48:00Z",
    durationLabel: "3h 33m",
    environment: "Non-prod",
    runBy: "DMA (automated)",
    reviewedBy: "Rosa Delgado",
    reviewedAt: "2026-10-11T15:40:00Z",
    /* Why a progress bar is the right hero here: this is the one stage where
       waiting is the experience. Nothing is decided until the run completes,
       and the only question anyone asks while it runs is "is the number
       settling down yet". */
    whyProgress:
      "Calibration is the only stage where the answer improves while you watch. Every batch narrows the predicted auto-approval range, so progress is not just elapsed work — it is confidence being earned.",
  };

  /* --- Phases -----------------------------------------------------------
     Four phases, weighted by how long each actually takes rather than split
     evenly. An even four-way split would show the bar at 50% while the
     translation step — the bulk of the wall-clock time — was still running,
     which is the specific lie progress bars are famous for. The `from`/`to`
     pairs are percentages of the whole run, so a single 0–100 value drives
     both the bar and the phase highlighting.

     `short` exists because the four chips sit side by side in a quarter of the
     strip's width each. A truncated "Translate the sampl…" is worse than a
     deliberate short form — the full label still shows beside the percentage
     while that phase is running, and the full detail is on hover. ---------- */
  C.phases = [
    {
      id: "draw",
      label: "Draw the stratified sample",
      short: "Draw sample",
      from: 0,
      to: 6,
      detail: "Select 214 dependency-free assets proportional to the estate across sourcetype, application and complexity.",
    },
    {
      id: "translate",
      label: "Translate the sample into non-prod",
      short: "Translate",
      from: 6,
      to: 62,
      detail: "Translate application by application. The profile is rebuilt after each batch, so later batches are translated with what earlier batches taught.",
    },
    {
      id: "extract",
      label: "Extract and freeze the profile",
      short: "Extract profile",
      from: 62,
      to: 82,
      detail: "Consolidate the macro dictionary, naming conventions, SPL idioms and field vocabulary into one reviewable document.",
    },
    {
      id: "score",
      label: "Score through Asset-to-Asset Validation",
      short: "Score",
      from: 82,
      to: 100,
      detail: "Run the sample twice — once with the profile, once with it withheld — and compare auto-approval on identical inputs.",
    },
  ];

  /* --- Batch progression ------------------------------------------------
     One batch per sampled application, processed in descending size order,
     which is the same order the planning sample is authored in. Each entry
     records what the prediction looked like *after* that batch landed.

     The margin is what makes early progress honest. After 32 assets the
     model has seen one application's idioms and nothing else, so the point
     estimate is both wide and biased — not merely imprecise. Showing 71%
     without showing ±14 would invite someone to act on it. --------------- */
  C.progression = [
    { predicted: 71.0, margin: 14.2, note: "One application, one idiom family. The estimate is wide and skewed toward transaction chains." },
    { predicted: 73.4, margin: 11.0, note: "Windowing functions enter the sample. First evidence that streamstats translates cleanly." },
    { predicted: 70.2, margin: 9.6,  note: "The shared `main` index drops the estimate — four unrelated writers, no consistent naming." },
    { predicted: 72.8, margin: 8.1,  note: "Subsearch nesting recovers some of the drop once the profile learns the map idiom." },
    { predicted: 74.9, margin: 6.9,  note: "tstats acceleration translates almost unchanged. Largest single-batch gain." },
    { predicted: 75.6, margin: 5.8,  note: "Geospatial rollups add a pattern with no close equivalent; held flat rather than climbing." },
    { predicted: 76.4, margin: 5.0,  note: "Mobile session chains reuse the transaction idiom already learned in batch 1." },
    { predicted: 76.1, margin: 4.3,  note: "Lookup-heavy correlation exposes two screening tables with no key column." },
    { predicted: 77.0, margin: 3.6,  note: "Time-series interpolation lands cleanly." },
    { predicted: 77.5, margin: 3.0,  note: "The estate's only append-and-join pattern. One asset, so it informs little." },
    { predicted: 78.0, margin: 2.4,  note: "Legacy rex extraction closes the sample. The interval is now tight enough to decide on." },
  ];

  /* Zip the planning sample against the progression. Counts are never copied —
     if Prioritize & Plan re-draws the sample, this follows. */
  C.batches = function () {
    const sample = DMA.data.planning.calibration.sample;
    let cum = 0;
    return sample.map(function (s, i) {
      const p = C.progression[i] || C.progression[C.progression.length - 1];
      cum += s.assets;
      return {
        index: i + 1,
        app: s.app,
        assets: s.assets,
        cumulative: cum,
        pattern: s.pattern,
        predicted: p.predicted,
        margin: p.margin,
        note: p.note,
      };
    });
  };

  C.sampleSize = function () {
    return DMA.data.planning.calibration.sample.reduce(function (a, s) {
      return a + s.assets;
    }, 0);
  };

  /* Assets completed at a given run percentage. Nothing is scored until the
     translate phase opens, and the sample is fully processed by the time the
     profile freezes — the scoring phase re-runs it, it does not extend it. */
  C.assetsAt = function (pct) {
    const tr = C.phases[1];
    const total = C.sampleSize();
    if (pct <= tr.from) return 0;
    if (pct >= tr.to) return total;
    return Math.round((total * (pct - tr.from)) / (tr.to - tr.from));
  };

  /* The prediction as it stood at a given run percentage, or null before
     enough of the sample has landed to say anything at all. */
  C.predictionAt = function (pct) {
    const done = C.assetsAt(pct);
    if (!done) return null;
    const bs = C.batches();
    let last = null;
    for (let i = 0; i < bs.length; i++) if (bs[i].cumulative <= done) last = bs[i];
    return last || { predicted: bs[0].predicted, margin: bs[0].margin, note: bs[0].note, cumulative: done };
  };

  C.phaseAt = function (pct) {
    for (let i = 0; i < C.phases.length; i++) if (pct < C.phases[i].to) return C.phases[i];
    return C.phases[C.phases.length - 1];
  };

  /* --- Stratification ---------------------------------------------------
     The sample is proportional to the estate on three dimensions at once.
     `naive` is the counterexample: what the first 214 dependency-free assets
     would have looked like had the sample simply been taken in scan order.
     It is kept because the failure is invisible without it — the naive sample
     runs fine, scores high, and over-predicts. ---------------------------- */
  C.stratification = {
    dimensions: [
      {
        id: "sourcetype",
        label: "Sourcetype",
        why: "Translation difficulty tracks source format more strongly than it tracks query length.",
        buckets: [
          { label: "json:app",             estatePct: 21.0, sample: 45, naive: 51 },
          { label: "access_combined",      estatePct: 23.8, sample: 51, naive: 149 },
          { label: "cisco:asa",            estatePct: 18.2, sample: 39, naive: 14 },
          { label: "WinEventLog:Security", estatePct: 15.9, sample: 34, naive: 0 },
          { label: "41 long-tail types",   estatePct: 21.1, sample: 45, naive: 0 },
        ],
      },
      {
        id: "complexity",
        label: "Query complexity",
        why: "A profile learned only on single-stage searches has nothing to say about the pipelines that actually need review.",
        buckets: [
          { label: "Simple — 1–2 stages",      estatePct: 37.9, sample: 81, naive: 182 },
          { label: "Moderate — 3–5 stages",    estatePct: 34.1, sample: 73, naive: 28 },
          { label: "Complex — 6–9 stages",     estatePct: 19.2, sample: 41, naive: 4 },
          { label: "Very complex — 10+ stages", estatePct: 8.8, sample: 19, naive: 0 },
        ],
      },
      {
        id: "application",
        label: "Application",
        why: "Naming conventions are set per team. Sampling one team's assets learns one team's habits.",
        buckets: [
          { label: "11 of 19 applications sampled", estatePct: 100, sample: 214, naive: 214 },
        ],
      },
    ],
    naive: {
      label: "First 214 dependency-free assets, in scan order",
      predicted: 91,
      actual: 62,
      /* The number that makes the case. A naive sample does not merely predict
         less precisely — it predicts confidently in the wrong direction. */
      summary:
        "The naive sample is 85% simple access-log searches, because those are what a dependency scan reaches first. It predicts 91% auto-approval and delivers 62% — a 29-point over-promise that only surfaces once the estate is already translating.",
    },
  };

  /* --- Pattern coverage -------------------------------------------------
     46 distinct SPL patterns observed across the estate. "Covered" means the
     sample contains enough instances to generalise from. "Thin" means it
     contains some but not enough to be confident — the honest middle state
     that a binary covered/uncovered split would hide. -------------------- */
  C.coverage = {
    totalPatterns: 46,
    covered: 41,
    thin: 2,
    uncovered: 3,
    get coveredPct() {
      return Math.round((this.covered / this.totalPatterns) * 100);
    },
    minInstances: 4,
    rule: "A pattern needs at least 4 instances in the sample to count as covered. Below that the profile is memorising an asset rather than learning a convention.",
    patterns: [
      /* 50, not 32: Payments Core contributes 32 and Digital Wallet's 18 mobile
         session chains are the same idiom, which is why batch 7 barely moved the
         estimate. Patterns are counted across applications, not per application. */
      { name: "transaction / stats / eval chains", estate: 418, sample: 50, state: "covered" },
      { name: "streamstats and eventstats windowing", estate: 311, sample: 26, state: "covered" },
      { name: "tstats summary acceleration", estate: 204, sample: 20, state: "covered" },
      { name: "map and subsearch nesting", estate: 186, sample: 21, state: "covered" },
      { name: "legacy rex field extraction", estate: 131, sample: 12, state: "covered" },
      { name: "lookup correlation against screening tables", estate: 97, sample: 16, state: "covered" },
      { name: "geostats and regional rollups", estate: 74, sample: 19, state: "covered" },
      { name: "timewrap period comparison", estate: 52, sample: 15, state: "covered" },
      { name: "append and join across indexes", estate: 19, sample: 14, state: "covered" },
      { name: "multikv table parsing", estate: 11, sample: 3, state: "thin" },
      { name: "iplocation enrichment", estate: 7, sample: 2, state: "thin" },
      { name: "predict / x11 forecasting", estate: 1, sample: 1, state: "uncovered" },
      { name: "localize with transaction fallback", estate: 1, sample: 1, state: "uncovered" },
      { name: "arbitrary external script via `script`", estate: 1, sample: 1, state: "uncovered" },
    ],
    uncoveredAction:
      "All three uncovered patterns appear in exactly one asset each. They are routed to Exceptions rather than sampled — calibrating on a single instance teaches the profile nothing generalisable, and a profile that has memorised one asset will confidently mistranslate the next one that looks like it.",
    thinAction:
      "Thin patterns stay in the profile but are excluded from the auto-approval prediction, so the number is not propped up by shapes the profile has barely seen.",
  };

  /* --- The profile ------------------------------------------------------
     The actual artefact. Four sections, every entry carrying a state:

       learned   — DMA inferred it and nobody has disagreed
       corrected — a consultant changed it, with a reason on the record
       rejected  — a consultant removed it; the pattern routes to Exceptions

     `corrected` and `rejected` are the whole argument for context injection
     over fine-tuning. A weight cannot be read, disputed or reverted by the
     person who knows the customer. A line in a dictionary can. ----------- */
  C.profile = {
    version: "v1.2",
    frozenAt: "2026-10-09T11:31:00Z",
    sections: [
      {
        id: "macros",
        label: "Macro dictionary",
        icon: "database",
        blurb: "130 macros discovered at import. The profile resolves each to its expansion so the translator never sees an opaque call.",
        entries: [
          {
            name: "`cim_authentication`",
            value: "Expands to a tagged search over the Authentication datamodel",
            state: "learned",
            evidence: "Observed in 23 of 214 sampled assets",
          },
          {
            name: "`fraud_window(1)`",
            value: "Argument is minutes, not hours",
            state: "corrected",
            by: "Rosa Delgado",
            at: "2026-10-11T14:02:00Z",
            why: "DMA inferred hours from the surrounding `earliest=-1h` and would have widened every fraud window sixtyfold. The macro definition is authoritative and says minutes.",
            evidence: "Affects 41 assets across fraud-risk and sanctions",
          },
          {
            name: "`biz_hours`",
            value: "Weekday 07:00–19:00 in the tenant's local timezone, not UTC",
            state: "learned",
            evidence: "Observed in 17 of 214 sampled assets",
          },
          {
            name: "`get_customer_tier`",
            value: "Wraps a lookup with no Dynatrace equivalent",
            state: "rejected",
            by: "Rosa Delgado",
            at: "2026-10-11T14:19:00Z",
            why: "The underlying tier table is maintained by hand in a spreadsheet and published to Splunk nightly. There is nothing to translate to until that table has an owner on the Dynatrace side, so every asset using it goes to Exceptions rather than getting a plausible-looking wrong answer.",
            evidence: "Affects 9 assets in retail-channels",
          },
        ],
      },
      {
        id: "naming",
        label: "Naming conventions",
        icon: "fileText",
        blurb: "How this customer names things, inferred from what they named rather than from what a standard says they should have.",
        entries: [
          {
            name: "Index → bucket",
            value: "`idx_<bu>_<env>` becomes `<bu>-<env>`",
            state: "corrected",
            by: "Rosa Delgado",
            at: "2026-10-11T14:31:00Z",
            why: "DMA kept the `idx_` prefix. It carries no meaning on the Dynatrace side and the customer's own bucket naming standard, agreed in Qualify & Scope, drops it.",
            evidence: "Applies to all 2,955 in-scope assets",
          },
          {
            name: "Event field prefix `evt_`",
            value: "Dropped — the prefix is a Splunk-era disambiguator",
            state: "learned",
            evidence: "Observed on 61 distinct fields",
          },
          {
            name: "Sourcetype separator",
            value: "`cisco:asa` becomes `cisco.asa`",
            state: "learned",
            evidence: "Observed across all 46 sourcetypes",
          },
          {
            name: "Corporate application prefix",
            value: "`ACME-CORP` retained on corporate-it assets",
            state: "learned",
            evidence: "Matches the Wave Mapping override already set on corporate-it",
          },
        ],
      },
      {
        id: "idioms",
        label: "Recurring SPL idioms",
        icon: "gitBranch",
        blurb: "Shapes this customer reaches for repeatedly. Each one is translated the same way every time once it is in the profile.",
        entries: [
          {
            name: "`transaction startswith= endswith=`",
            value: "Sequence detection over a session identifier",
            state: "learned",
            evidence: "418 instances in the estate, 50 sampled across payments-core and digital-wallet",
          },
          {
            name: "`streamstats window=N`",
            value: "Rolling aggregation with an explicit window",
            state: "learned",
            evidence: "311 instances in the estate, 26 sampled",
          },
          {
            name: "`rex field=_raw` multi-capture",
            value: "Split into one named extraction per capture group",
            state: "corrected",
            by: "Tomás Herrera",
            at: "2026-10-11T10:50:00Z",
            why: "DMA produced one combined extraction preserving the original group order. It worked, but it was unreadable and nobody downstream could maintain it. Named extractions cost nothing at query time.",
            evidence: "131 instances in the estate, 12 sampled",
          },
          {
            name: "`map` over a subsearch returning >100 rows",
            value: "No safe equivalent — the row limit is silent in Splunk",
            state: "rejected",
            by: "Tomás Herrera",
            at: "2026-10-11T11:04:00Z",
            why: "Splunk truncates the subsearch at a configured limit without warning, so the original query has been returning partial results for years. Translating it faithfully reproduces a bug; translating it correctly changes the numbers the business has been reading. That is a conversation, not a translation.",
            evidence: "14 of 186 map instances exceed the limit",
          },
        ],
      },
      {
        id: "fields",
        label: "Field vocabulary",
        icon: "link",
        blurb: "The customer's field names mapped to semantic-convention equivalents. This is where the mapping rule set and the profile meet.",
        entries: [
          { name: "`src_ip`", value: "→ `client.ip`", state: "learned", evidence: "Observed in 88 of 214 sampled assets" },
          { name: "`user`", value: "→ `user.name`", state: "learned", evidence: "Observed in 104 of 214 sampled assets" },
          { name: "`msg`", value: "→ `content`", state: "learned", evidence: "Matches the project-level mapping override already recorded" },
          {
            name: "`svc`",
            value: "→ `service.name`, not `k8s.service.name`",
            state: "corrected",
            by: "Rosa Delgado",
            at: "2026-10-11T14:44:00Z",
            why: "DMA inferred the Kubernetes form from co-occurring pod fields. Two thirds of the assets using `svc` predate the Kubernetes migration and refer to mainframe services.",
            evidence: "Affects 73 assets across treasury-ops and compliance-rpt",
          },
        ],
      },
    ],
  };

  /* Flat tallies across all four sections, so the UI can state the balance of
     learned / corrected / rejected without walking the structure twice. */
  C.profileTally = function () {
    const t = { total: 0, learned: 0, corrected: 0, rejected: 0 };
    C.profile.sections.forEach(function (s) {
      s.entries.forEach(function (e) {
        t.total++;
        t[e.state]++;
      });
    });
    return t;
  };

  C.corrections = function () {
    const out = [];
    C.profile.sections.forEach(function (s) {
      s.entries.forEach(function (e) {
        if (e.state === "corrected" || e.state === "rejected") out.push({ section: s.label, ...e });
      });
    });
    return out;
  };

  /* --- Scoring ----------------------------------------------------------
     The same 214 assets, scored twice. The control run is the point: without
     it, 78% is a number with nothing to compare against, and there is no way
     to tell whether the stage earned its place in the flow. -------------- */
  C.scoring = {
    total: 214,
    withProfile:    { autoApproved: 167, meaningfulDifference: 32, uncertain: 15 },
    withoutProfile: { autoApproved: 118, meaningfulDifference: 61, uncertain: 35 },
    thresholdPct: 70,
    stretchPct: 90,
    liftFloorPp: 5,
    falsePositivePct: 0.9,
    falsePositiveNote:
      "Two of the 167 auto-approvals were later found to differ meaningfully. Both were timezone assumptions inside `biz_hours`, and both were caught in Wave 1 validation rather than in production.",
    method:
      "Both runs go through Asset-to-Asset Validation unchanged — the same comparator the estate will use. Calibrate does not grade its own homework with a bespoke metric.",
  };

  C.rate = function (side) {
    const s = C.scoring[side];
    return (s.autoApproved / C.scoring.total) * 100;
  };
  C.lift = function () {
    return C.rate("withProfile") - C.rate("withoutProfile");
  };

  /* --- The exit gate ----------------------------------------------------
     Calibrate is blocking before the first wave translates and advisory
     afterwards. The gate is what "blocking" actually means: five conditions,
     each independently checkable, with a recorded human decision at the end.

     Note that clearing threshold is only one of the five. A run that scored
     94% but was never read by a consultant has not passed. ---------------- */
  C.gate = {
    phase: "advisory", // was "blocking" until Wave 1 translated
    phaseNote:
      "Wave 1 has translated, so the gate is now advisory. It stays visible because a re-import or a large correction batch can move the numbers, and because the recorded decision below is what Deploy audits against.",
    items: [
      { label: "Calibration run completed on a stratified sample", status: "pass", detail: "214 assets · 3h 33m · non-prod only" },
      { label: "Predicted auto-approval clears the agreed threshold", status: "pass", detail: "78.0% predicted against a 70% threshold" },
      { label: "Calibration lift clears the floor", status: "pass", detail: "23 points against a 5-point floor — the profile is doing work" },
      { label: "Profile reviewed by a named consultant", status: "pass", detail: "Rosa Delgado · 11 Oct 2026 · 4 corrections, 2 rejections" },
      { label: "Uncovered patterns routed rather than guessed", status: "pass", detail: "3 single-instance patterns sent to Exceptions" },
    ],
    decision: {
      outcome: "released",
      by: "Rosa Delgado",
      at: "2026-10-11T15:40:00Z",
      note: "Profile v1.2 released for estate translation. The two map-subsearch rejections are tracked as open questions with the customer's Splunk owner, not as translation defects.",
    },
    overrideShape:
      "A run that misses threshold can still be released, but only with a written reason recorded against the same decision field. The gate records what was decided and by whom — it does not pretend the decision was unavailable.",
  };

  /* --- Advisory phase ---------------------------------------------------
     After release the profile keeps learning from manual corrections made
     during Validate. Auto-approval should climb wave over wave; if it does
     not, the profile has stopped generalising and should be re-run.

     Waves 5 and 6 have not translated, so they carry no rate. The estate
     roll-up deliberately is not restated here — that belongs to Validate.

     Only the two Calibrate-specific facts are stored per wave: the rate the
     profile achieved and how many corrections it absorbed. Asset counts and
     wave names are read from `project.waves` by `advisoryByWave()` below.
     They were duplicated here at first, and waves 5 and 6 were re-sized
     the same week — which is exactly how a demo ends up showing 549 on one
     screen and 534 on another. A null rate is the only marker needed for
     "not yet translated"; it falls out of the data rather than being a third
     status vocabulary alongside the wave's own. */
  C.advisory = {
    byWave: [
      { wave: 1, rate: 76.4, corrections: 41 },
      { wave: 2, rate: 79.1, corrections: 28 },
      { wave: 3, rate: 82.0, corrections: 19 },
      { wave: 4, rate: 83.3, corrections: 12 },
      { wave: 5, rate: null, corrections: 0 },
      { wave: 6, rate: null, corrections: 0 },
    ],
    trendNote:
      "Wave 1 came in below the 78% prediction, which is expected — the first wave is where the profile meets the assets the sample could only approximate. The climb from 76.4 to 83.3 is the profile absorbing 100 manual corrections across four waves.",
    recalibration: {
      status: "not-recommended",
      trigger: "A re-import whose new assets fall outside the sampled distribution on any stratification dimension.",
      lastChecked: "2026-10-13T09:12:00Z",
      detail:
        "The 13 Oct re-import added 12 assets, all within sampled sourcetypes and complexity bands. No recalibration recommended. Had it been, the prompt would be advisory only — it does not re-block a project mid-flight.",
    },
  };

  /* Zip the per-wave rates against the waves themselves. Name, asset count and
     lifecycle status all come from project.waves, so re-sizing a wave there
     shows up here on the next render with nothing to keep in sync. */
  C.advisoryByWave = function () {
    return DMA.data.project.waves.map(function (w) {
      const a = C.advisory.byWave.find(function (x) {
        return x.wave === w.id;
      }) || { rate: null, corrections: 0 };
      return { wave: w.id, name: w.name, assets: w.assets, status: w.status, rate: a.rate, corrections: a.corrections };
    });
  };
})();
