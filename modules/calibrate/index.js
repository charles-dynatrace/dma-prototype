/* ============================================================================
   MODULE: Calibrate
   ----------------------------------------------------------------------------
   Flow-diagram stage: Transform → Calibrate (new; precedes Translate)

   Builds a customer translation profile — macro dictionary, naming
   conventions, recurring SPL idioms, field vocabulary — from a stratified
   sample of dependency-free assets, then scores itself by running that sample
   through Asset-to-Asset Validation.

   Deliberately NOT model fine-tuning. No weights change. The profile is
   injected context, which means no per-customer model hosting and, more
   importantly, a consultant can read and correct a learned convention.

   ----------------------------------------------------------------------------
   Why this screen is built around a progress strip

   Every other stage shows a state. This one shows a number getting better.
   Calibration is the only point in the flow where the system is allowed to say
   something about the 2,955 assets it has not touched yet, and the honesty of
   that claim depends entirely on how much of the sample has landed. So the
   strip carries three measures at once, and they answer three different
   questions:

     run progress      how far        214 assets, four phases, a live estimate
     pattern coverage  how good       89% of estate patterns represented
     exit gate         can I leave    five conditions and a recorded decision

   Shipping only the first would be a loading bar. Shipping only the third
   would hide the fact that the number moved. The composition is the point.

   The demo lands on the finished state, because that is what the project
   fixture says happened. "Replay calibration" re-runs the animation on
   demand so a room can watch the prediction converge — it mutates the strip's
   own nodes directly rather than going through DMA.store, which keeps the
   other 400-odd nodes on the page from being rebuilt sixty times and keeps
   the reader's scroll position where they left it.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, progress, stackedProgress, fmt } = DMA.ui;

  const STEPS = [
    { id: "sample",  label: "Draw the sample" },
    { id: "profile", label: "Build the profile" },
    { id: "score",   label: "Score & coverage" },
    { id: "release", label: "Release decision" },
  ];

  const wrap = { whiteSpace: "normal" };
  const C = () => DMA.data.calibration;
  const PR = () => DMA.data.project;

  function step() {
    const id = DMA.store.session.calStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  /* --- Local helpers (duplicated per module by design) ---------------------- */

  function kpi(label, value, meta, opts = {}) {
    return el(
      "div",
      { class: "dma-kpi" },
      el("div", { class: "dma-kpi__label" }, opts.iconName ? icon(opts.iconName, 13) : null, label),
      el("div", { class: ["dma-kpi__value", opts.tone ? `dt-text-${opts.tone}` : null] }, value),
      opts.bar || null,
      meta ? el("div", { class: "dma-kpi__meta" }, meta) : null
    );
  }

  const code = (t) => el("code", { class: "dma-code" }, t);
  const note = (t) => el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, t);
  const subdued = (t) => el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, t);

  const stepper = () => {
    const active = step();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Calibration steps" });
    STEPS.forEach((s, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(s.id === active),
            onClick: () => DMA.store.setSession("calStep", s.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, s.label)
        )
      );
    });
    return row;
  };

  /* ==========================================================================
     The progress strip — the hero
     --------------------------------------------------------------------------
     Built once per render and handed back with an `apply(pct)` closure. The
     replay animation calls `apply` sixty times a second; nothing else on the
     page re-renders, and no session state is written until the run lands.

     Everything inside `apply` is derived from the single 0–100 value, which is
     what makes the animation and the static finished state the same code path
     rather than two renderers that can drift.
     ======================================================================== */

  let anim = null;     // rAF handle for the one replay that may be in flight
  let animWatch = null; // its visibilitychange listener, removed with it

  function cancelReplay() {
    if (anim) cancelAnimationFrame(anim);
    anim = null;
    if (animWatch) document.removeEventListener("visibilitychange", animWatch);
    animWatch = null;
  }

  function buildStrip() {
    const c = C();
    const cov = c.coverage;
    const gate = c.gate;
    const total = c.sampleSize();
    const passed = gate.items.filter((i) => i.status === "pass").length;

    /* --- Measure 1: run progress ----------------------------------------- */
    const pctNode = el("span", { class: "dma-calstrip__big dt-tnum" }, "100%");
    const phaseNode = el("span", { class: "dt-text-small dt-text-secondary" }, "");
    const countNode = el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, "");
    const bar = progress(100, "success");
    const fill = bar.querySelector(".dt-progress__fill");

    /* Phase boundaries drawn onto the bar. Four phases of visibly different
       widths, because they take visibly different amounts of time — an even
       split is the standard progress-bar lie. */
    const ticks = el(
      "div",
      { class: "dma-calrun__ticks" },
      c.phases.slice(1).map((p) => el("span", { class: "dma-calrun__tick", style: { left: `${p.from}%` } }))
    );
    const runBar = el("div", { class: "dma-calrun" }, bar, ticks);

    const phaseChips = c.phases.map((p) =>
      el(
        "div",
        { class: "dma-calphase", dataset: { phase: p.id }, title: p.detail },
        el("span", { class: "dma-calphase__dot" }),
        el("span", { class: "dt-truncate" }, p.short)
      )
    );
    const chipRow = el("div", { class: "dma-calphases" }, phaseChips);

    /* The live estimate. The margin is not decoration — an early point
       estimate without its interval invites someone to act on 71%. */
    const predNode = el("span", { class: "dma-calstrip__big dt-tnum" }, "—");
    const marginNode = el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, "");
    const predNote = el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, "");

    const main = el(
      "div",
      { class: "dma-calstrip__main" },
      el(
        "div",
        { class: "dt-row dt-gap-12" },
        el(
          "div",
          { class: "dt-stack dt-gap-4 dt-grow" },
          el("div", { class: "dma-kpi__label" }, icon("zap", 13), "Calibration run"),
          el("div", { class: "dt-row dt-gap-8", style: { alignItems: "baseline" } }, pctNode, phaseNode),
          runBar,
          el("div", { class: "dt-row dt-gap-8" }, countNode)
        ),
        el(
          "div",
          { class: "dt-stack dt-gap-4 dma-calstrip__pred" },
          el("div", { class: "dma-kpi__label" }, icon("sliders", 13), "Predicted auto-approval"),
          el("div", { class: "dt-row dt-gap-6", style: { alignItems: "baseline" } }, predNode, marginNode)
        )
      ),
      chipRow,
      predNote
    );

    /* --- Measure 2: pattern coverage -------------------------------------- */
    const coverage = el(
      "div",
      { class: "dma-calstrip__side" },
      el("div", { class: "dma-kpi__label" }, icon("layers", 13), "Pattern coverage"),
      el("div", { class: "dma-kpi__value" }, fmt.pct(cov.coveredPct, 0)),
      stackedProgress([
        { value: (cov.covered / cov.totalPatterns) * 100, tone: "success", label: "Covered" },
        { value: (cov.thin / cov.totalPatterns) * 100, tone: "warning", label: "Thin" },
        { value: (cov.uncovered / cov.totalPatterns) * 100, tone: "critical", label: "Uncovered" },
      ]),
      subdued(`${cov.covered} covered · ${cov.thin} thin · ${cov.uncovered} routed to Exceptions`)
    );

    /* --- Measure 3: the exit gate ----------------------------------------- */
    const released = gate.decision.outcome === "released";
    const gateBox = el(
      "div",
      { class: "dma-calstrip__side" },
      el("div", { class: "dma-kpi__label" }, icon("flag", 13), "Exit gate"),
      el(
        "div",
        { class: "dt-row dt-gap-8", style: { alignItems: "center" } },
        el("div", { class: ["dma-kpi__value", released ? "dt-text-success" : null] }, `${passed} of ${gate.items.length}`),
        badge(released ? "Released" : "Open", released ? "success" : "warning", { iconName: released ? "checkCircle" : "clock" })
      ),
      subdued(`${gate.decision.by} · ${fmt.date(gate.decision.at)} · now ${gate.phase}`)
    );

    const strip = el("div", { class: "dma-calstrip" }, main, coverage, gateBox);

    /* --- The single derivation ------------------------------------------- */
    function apply(pct) {
      const p = Math.max(0, Math.min(100, pct));
      const done = c.assetsAt(p);
      const phase = c.phaseAt(p);
      const pred = c.predictionAt(p);
      const finished = p >= 100;

      pctNode.textContent = `${Math.round(p)}%`;
      phaseNode.textContent = finished ? `Complete · ${c.run.durationLabel}` : phase.label;
      fill.style.width = `${p}%`;
      fill.classList.toggle("dt-progress__fill--success", finished);
      bar.setAttribute("aria-valuenow", String(Math.round(p)));
      countNode.textContent = done
        ? `${fmt.num(done)} of ${fmt.num(total)} sampled assets processed`
        : `Selecting ${fmt.num(total)} assets from ${fmt.num(PR().assets.total)} in scope`;

      phaseChips.forEach((chip, i) => {
        const ph = c.phases[i];
        const state = p >= ph.to ? "done" : p > ph.from ? "active" : "pending";
        chip.dataset.state = state;
      });

      if (pred) {
        predNode.textContent = fmt.pct(pred.predicted, 1);
        marginNode.textContent = `± ${pred.margin.toFixed(1)}`;
        predNode.className = `dma-calstrip__big dt-tnum ${
          pred.predicted >= c.scoring.thresholdPct ? "dt-text-success" : "dt-text-warning"
        }`;
        predNote.textContent = finished
          ? `Final. ${c.scoring.method}`
          : `${pred.note} The interval narrows as strata land, which is why an early point estimate is never the headline.`;
      } else {
        predNode.textContent = "—";
        predNode.className = "dma-calstrip__big dt-tnum dt-text-subdued";
        marginNode.textContent = "";
        predNote.textContent = "No prediction until the first batch has been translated and scored. A sample of zero has no opinion.";
      }
    }

    return { node: strip, apply };
  }

  /* How long the replay dwells on each phase. This is deliberately NOT the
     same shape as the bar itself: the bar's segment widths are proportional to
     how long each phase really took, while playback time is proportional to how
     much there is to watch. Translation is the only phase where the number
     moves — eleven batches, the interval tightening from ±14.2 to ±2.4 — so it
     gets two thirds of the playback and the other three are brisk. An even
     split, or a generic ease-out, spends the viewer's attention on the two
     phases where nothing changes. */
  const PLAYBACK = [
    { to: 6,   ms: 350 },
    { to: 62,  ms: 3600 },
    { to: 82,  ms: 700 },
    { to: 100, ms: 950 },
  ];
  const PLAYBACK_MS = PLAYBACK.reduce((a, s) => a + s.ms, 0);

  function pctAtElapsed(ms) {
    let acc = 0;
    let from = 0;
    for (const seg of PLAYBACK) {
      if (ms < acc + seg.ms) return from + ((ms - acc) / seg.ms) * (seg.to - from);
      acc += seg.ms;
      from = seg.to;
    }
    return 100;
  }

  /* Replay.

     Two ways out, both of which have to leave the strip truthful rather than
     frozen part-way through a run that finished two weeks ago:

       navigated away  — the node is detached, so there is nothing to paint.
                         Cancel and let the next render re-run apply(100).
       tab hidden      — requestAnimationFrame stops dead in a background tab.
                         Nobody can watch an animation they cannot see, so snap
                         to the finished state. Coming back to a stalled 34% bar
                         would read as a stuck job, which is a lie about a run
                         that completed on 9 Oct. */
  function replay(apply, node) {
    cancelReplay();
    /* Already hidden when asked — there is no animation to show, so go
       straight to the truth rather than starting a run nobody will see. */
    if (document.hidden) return apply(100);

    const start = performance.now();
    apply(0);

    animWatch = function () {
      if (document.hidden) {
        cancelReplay();
        apply(100);
      }
    };
    document.addEventListener("visibilitychange", animWatch);

    function frame(now) {
      if (!node.isConnected) return cancelReplay();
      const ms = now - start;
      apply(pctAtElapsed(ms));
      if (ms < PLAYBACK_MS) anim = requestAnimationFrame(frame);
      else cancelReplay();
    }
    anim = requestAnimationFrame(frame);
  }

  /* ==========================================================================
     Step 1 — Draw the sample
     ======================================================================== */

  function stepSample() {
    const c = C();
    const st = c.stratification;
    const sample = DMA.data.planning.calibration.sample;
    const total = c.sampleSize();
    const inScope = PR().assets.total; // `total` here means in-scope; the 133 import-time exclusions are already gone

    const naiveBars = (b) =>
      el(
        "div",
        { class: "dma-calstrat" },
        el("div", { class: "dt-text-small dt-truncate", title: b.label }, b.label),
        el(
          "div",
          { class: "dma-calstrat__bars" },
          el("div", { class: "dma-calstrat__row" }, subdued("Estate"), progress(b.estatePct), el("span", { class: "dt-text-small dt-tnum dma-calstrat__n" }, fmt.pct(b.estatePct, 1))),
          el("div", { class: "dma-calstrat__row" }, subdued("Sample"), progress((b.sample / total) * 100, "success"), el("span", { class: "dt-text-small dt-tnum dma-calstrat__n" }, fmt.pct((b.sample / total) * 100, 1))),
          el("div", { class: "dma-calstrat__row" }, subdued("Scan order"), progress((b.naive / total) * 100, "critical"), el("span", { class: "dt-text-small dt-tnum dma-calstrat__n" }, fmt.pct((b.naive / total) * 100, 1)))
        )
      );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Sampled assets", fmt.num(total), `${fmt.pct((total / inScope) * 100, 1)} of ${fmt.num(inScope)} in scope`, { iconName: "zap" }),
        kpi("Applications drawn from", `${sample.length} of 19`, "Eight applications contribute nothing the sample needs", { iconName: "layers" }),
        kpi("Dependency-free", `${total} of ${total}`, "A sampled asset cannot depend on an unsampled one — the profile has to be learnable without the estate", { iconName: "shield", tone: "success" }),
        kpi("Deploys to", c.run.environment, "Calibration never writes to the production tenant", { iconName: "server" })
      ),

      banner(
        "info",
        "Every sampled asset keeps its home wave. It is translated early into non-prod to tune the profile and deploys to production on its own wave's schedule. The sampling decision itself is made in Prioritize & Plan, alongside wave placement — this stage runs what was drawn there.",
        { title: "A sample overlay, not a seventh wave" }
      ),

      card(
        { title: "Stratified three ways at once", subtitle: "Proportional to the estate on sourcetype, complexity and application" },
        el(
          "div",
          { class: "dt-stack dt-gap-20" },
          st.dimensions
            .filter((d) => d.buckets.length > 1)
            .map((d) =>
              el(
                "div",
                { class: "dt-stack dt-gap-8" },
                el("div", { class: "dt-text-semibold" }, d.label),
                note(d.why),
                el("div", { class: "dt-stack dt-gap-12" }, d.buckets.map(naiveBars))
              )
            )
        )
      ),

      card(
        { title: "What scan order would have given you" },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          note(st.naive.summary),
          el(
            "div",
            { class: "dt-grid dt-grid-2" },
            el(
              "div",
              { class: "dma-calcompare" },
              el("div", { class: "dt-text-semibold" }, "Stratified sample"),
              el("div", { class: "dma-kpi__value dt-text-success" }, fmt.pct(C().rate("withProfile"), 1)),
              subdued("Predicted — and the estate later came in at 81.2%, so the promise was conservative.")
            ),
            el(
              "div",
              { class: "dma-calcompare dma-calcompare--bad" },
              el("div", { class: "dt-text-semibold" }, st.naive.label),
              el(
                "div",
                { class: "dt-row dt-gap-8", style: { alignItems: "baseline" } },
                el("div", { class: "dma-kpi__value dt-text-critical" }, fmt.pct(st.naive.predicted, 0)),
                el("span", { class: "dt-text-small dt-text-subdued" }, `→ delivers ${fmt.pct(st.naive.actual, 0)}`)
              ),
              subdued("A 29-point over-promise that only surfaces once the estate is already translating.")
            )
          ),
          subdued(
            "This is the argument for the stage being more than a loading bar. A naive sample does not fail loudly — it runs fine, scores high, and is wrong in the direction that costs the most to discover late."
          )
        )
      ),

      card(
        { title: "The sample, batch by batch", subtitle: `${sample.length} applications · processed largest first · the prediction after each`, flush: true },
        table(
          [
            { label: "#", width: "40px", render: (b) => el("span", { class: "dt-tnum dt-text-subdued" }, String(b.index)) },
            { label: "Application", width: "170px", render: (b) => el("span", { class: "dt-text-medium" }, DMA.data.planning.appById(b.app).name) },
            { label: "Assets", width: "70px", render: (b) => el("span", { class: "dt-tnum" }, String(b.assets)) },
            { label: "Cumulative", width: "90px", render: (b) => el("span", { class: "dt-tnum dt-text-subdued" }, String(b.cumulative)) },
            {
              label: "Prediction after",
              width: "130px",
              render: (b) =>
                el(
                  "span",
                  { class: "dt-row dt-gap-6", style: { alignItems: "baseline" } },
                  el("span", { class: "dt-tnum dt-text-medium" }, fmt.pct(b.predicted, 1)),
                  el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, `± ${b.margin.toFixed(1)}`)
                ),
            },
            { label: "What this batch taught", render: (b) => note(b.note) },
          ],
          C().batches()
        )
      )
    );
  }

  /* ==========================================================================
     Step 2 — Build the profile
     ======================================================================== */

  const STATE_TONE = { learned: "neutral", corrected: "warning", rejected: "critical" };
  const STATE_LABEL = { learned: "Learned", corrected: "Corrected", rejected: "Rejected" };

  function profileEntry(e) {
    return el(
      "div",
      /* No modifier for `learned` — the base rule already is the neutral,
         undisputed case, and emitting a class with no rule behind it is how
         dead CSS gets written later to explain the class. */
      { class: ["dma-calentry", e.state === "learned" ? null : `dma-calentry--${e.state}`] },
      el(
        "div",
        { class: "dt-row dt-gap-8", style: { alignItems: "baseline", flexWrap: "wrap" } },
        code(e.name),
        el("span", { class: "dt-text-small dt-text-secondary dt-grow", style: wrap }, e.value),
        badge(STATE_LABEL[e.state], STATE_TONE[e.state], { dot: true })
      ),
      e.evidence ? subdued(e.evidence) : null,
      e.why
        ? el(
            "div",
            { class: "dma-calwhy" },
            el(
              "div",
              { class: "dt-text-small dt-text-subdued" },
              `${e.by} · ${fmt.date(e.at)}`
            ),
            note(e.why)
          )
        : null
    );
  }

  function stepProfile() {
    const c = C();
    const t = c.profileTally();

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Profile version", c.profile.version, `Frozen ${fmt.date(c.profile.frozenAt)}`, { iconName: "fileText" }),
        kpi("Conventions learned", String(t.learned), "Inferred and undisputed", { iconName: "zap" }),
        kpi("Corrected by a consultant", String(t.corrected), "Changed, with a reason on the record", { iconName: "edit", tone: "warning" }),
        kpi("Rejected outright", String(t.rejected), "Routed to Exceptions rather than guessed", { iconName: "x", tone: "critical" })
      ),

      banner(
        "info",
        "No model weights change here. The profile is injected context — which means no per-customer model to host, no retraining cycle, and, far more importantly, a consultant can read a learned convention and disagree with it. The four corrections and two rejections below are the proof: each one is a sentence someone could point at and overrule. A fine-tuned weight offers nothing to point at.",
        { title: "This is context, not fine-tuning" }
      ),

      c.profile.sections.map((s) =>
        card(
          { title: s.label, subtitle: s.blurb, actions: el("span", { class: "dt-text-subdued" }, icon(s.icon, 18)) },
          el("div", { class: "dt-stack dt-gap-8" }, s.entries.map(profileEntry))
        )
      ),

      card(
        { title: "Why the corrections matter more than the count" },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          note(
            "Of the six interventions below, two would have produced output that ran without error and returned wrong answers. The fraud-window macro read as hours instead of minutes would have widened every fraud detection window sixtyfold across 41 assets — a query that executes, returns rows, and quietly stops catching anything. The `svc` field mapped to its Kubernetes form would have silently dropped two thirds of the assets that use it."
          ),
          note(
            "Neither is the kind of failure Asset-to-Asset Validation catches, because both translations are structurally faithful. They are caught by a person reading a dictionary. That is the whole design argument for keeping the profile human-legible, and it is why the stage cannot be collapsed into the translator."
          ),
          el(
            "div",
            { class: "dt-stack dt-gap-6" },
            c.corrections().map((x) =>
              el(
                "div",
                { class: "dt-row dt-gap-8", style: { alignItems: "baseline", flexWrap: "wrap" } },
                badge(STATE_LABEL[x.state], STATE_TONE[x.state], { dot: true }),
                el("span", { class: "dt-text-small dt-text-subdued" }, x.section),
                code(x.name),
                el("span", { class: "dt-text-small dt-text-secondary dt-grow", style: wrap }, x.evidence)
              )
            )
          )
        )
      )
    );
  }

  /* ==========================================================================
     Step 3 — Score & coverage
     ======================================================================== */

  function scoreBar(label, side, tone) {
    const c = C();
    const s = c.scoring[side];
    const total = c.scoring.total;
    const pct = (n) => (n / total) * 100;
    return el(
      "div",
      { class: "dt-stack dt-gap-6" },
      el(
        "div",
        { class: "dt-row dt-gap-8", style: { alignItems: "baseline" } },
        el("span", { class: "dt-text-semibold dt-grow" }, label),
        el("span", { class: ["dt-text-medium dt-tnum", tone ? `dt-text-${tone}` : null] }, fmt.pct(pct(s.autoApproved), 1))
      ),
      stackedProgress([
        { value: pct(s.autoApproved), tone: "success", label: "Auto-approved" },
        { value: pct(s.meaningfulDifference), tone: "warning", label: "Meaningful difference" },
        { value: pct(s.uncertain), tone: "critical", label: "Uncertain" },
      ]),
      subdued(`${s.autoApproved} auto-approved · ${s.meaningfulDifference} meaningful difference · ${s.uncertain} uncertain`)
    );
  }

  const COV_TONE = { covered: "success", thin: "warning", uncovered: "critical" };
  const COV_LABEL = { covered: "Covered", thin: "Thin", uncovered: "Uncovered" };

  function stepScore() {
    const c = C();
    const sc = c.scoring;
    const cov = c.coverage;
    const lift = c.lift();
    const withPct = c.rate("withProfile");

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Predicted auto-approval", fmt.pct(withPct, 1), `Threshold ${fmt.pct(sc.thresholdPct, 0)} · stretch ${fmt.pct(sc.stretchPct, 0)}`, {
          iconName: "checkCircle",
          tone: "success",
          bar: progress(withPct, "success"),
        }),
        kpi("Same sample, no profile", fmt.pct(c.rate("withoutProfile"), 1), "The control run — identical inputs", { iconName: "sliders", bar: progress(c.rate("withoutProfile")) }),
        kpi("Calibration lift", `${lift.toFixed(0)} pp`, `Floor is ${sc.liftFloorPp} pp — below it this stage is ceremony`, { iconName: "zap", tone: "success" }),
        kpi("Pattern coverage", fmt.pct(cov.coveredPct, 0), `${cov.covered} of ${cov.totalPatterns} estate patterns`, { iconName: "layers" })
      ),

      card(
        { title: "Scored twice on identical inputs", subtitle: sc.method },
        el(
          "div",
          { class: "dt-stack dt-gap-16" },
          scoreBar("With the profile", "withProfile", "success"),
          scoreBar("With the profile withheld", "withoutProfile", "critical"),
          el(
            "div",
            { class: "dma-delta" },
            el("div", { class: "dt-text-semibold" }, `Lift: ${lift.toFixed(0)} percentage points`),
            note(
              "The control run is what makes the headline number mean anything. 78% on its own is unfalsifiable — it could be the profile working or it could be that this estate was always going to translate cleanly. Running the same 214 assets with the profile withheld separates the two, and it is the only guardrail that can tell you to delete this stage."
            )
          ),
          el("div", { class: "dma-failure" }, el("div", { class: "dt-text-semibold" }, `False positives: ${fmt.pct(sc.falsePositivePct, 1)}`), note(sc.falsePositiveNote))
        )
      ),

      card(
        { title: "Pattern coverage", subtitle: cov.rule, flush: true },
        table(
          [
            { label: "SPL pattern", render: (p) => el("span", { class: "dt-text-medium", style: wrap }, p.name) },
            { label: "In estate", width: "90px", render: (p) => el("span", { class: "dt-tnum" }, fmt.num(p.estate)) },
            { label: "In sample", width: "90px", render: (p) => el("span", { class: "dt-tnum" }, String(p.sample)) },
            { label: "Coverage", width: "120px", render: (p) => badge(COV_LABEL[p.state], COV_TONE[p.state], { dot: true }) },
          ],
          cov.patterns
        )
      ),

      card(
        { title: "The three it will not calibrate on" },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          note(cov.uncoveredAction),
          note(cov.thinAction),
          subdued(
            `Fourteen of the 46 observed patterns are shown above. The remaining 32 are all comfortably covered and are collapsed to keep the table readable — ${cov.covered} covered, ${cov.thin} thin, ${cov.uncovered} uncovered is the full picture.`
          )
        )
      )
    );
  }

  /* ==========================================================================
     Step 4 — Release decision
     ======================================================================== */

  function stepRelease() {
    const c = C();
    const g = c.gate;
    const adv = c.advisory;
    const passed = g.items.filter((i) => i.status === "pass").length;
    const waves = c.advisoryByWave();
    const translated = waves.filter((w) => w.rate != null);

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Gate conditions met", `${passed} of ${g.items.length}`, "All five, or the release carries a written override", { iconName: "flag", tone: passed === g.items.length ? "success" : "warning" }),
        kpi("Decision", "Released", `${g.decision.by} · ${fmt.date(g.decision.at)}`, { iconName: "checkCircle", tone: "success" }),
        kpi("Gate phase", g.phase === "advisory" ? "Advisory" : "Blocking", g.phase === "advisory" ? "Wave 1 has translated" : "No wave has translated yet", { iconName: "shield" }),
        kpi("Recalibration", "Not recommended", `Last checked ${fmt.date(adv.recalibration.lastChecked)}`, { iconName: "refresh", tone: "success" })
      ),

      banner("info", g.phaseNote, { title: "Blocking before the first wave, advisory after" }),

      card(
        { title: "The exit condition is a recorded decision, not a score" },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          g.items.map((i) =>
            el(
              "div",
              { class: ["dma-gateitem", i.status !== "pass" ? `dma-gateitem--${i.status}` : null] },
              icon(i.status === "pass" ? "checkCircle" : i.status === "pending" ? "clock" : "alert", 16),
              el(
                "div",
                { class: "dt-stack dt-gap-4 dt-grow" },
                el("div", { class: "dt-text-medium", style: wrap }, i.label),
                subdued(i.detail)
              )
            )
          ),
          note(
            "Clearing threshold is one of five. A run that scored 94% and was never read by a consultant has not passed this gate, because the two failure modes that matter most — a macro read wrong, a field mapped to the wrong semantic convention — produce queries that execute cleanly and return the wrong answer. A score cannot see them."
          )
        )
      ),

      card(
        { title: "Release", subtitle: `${g.decision.by} · ${fmt.date(g.decision.at)}` },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          el(
            "div",
            { class: "dma-verdict" },
            el("div", { class: "dt-row dt-gap-8", style: { alignItems: "center" } }, badge("Released", "success", { iconName: "checkCircle" }), el("span", { class: "dt-text-semibold" }, `Profile ${c.profile.version} released for estate translation`)),
            note(g.decision.note)
          ),
          subdued(g.overrideShape)
        )
      ),

      card(
        { title: "After release the profile keeps learning", subtitle: "Auto-approval by wave, as manual corrections feed back", flush: true },
        table(
          [
            { label: "Wave", width: "190px", render: (w) => el("span", { class: "dt-row dt-gap-8", style: { alignItems: "center" } }, badge(`Wave ${w.wave}`, "neutral", { iconName: "layers" }), el("span", { class: "dt-text-small dt-text-secondary dt-truncate" }, w.name)) },
            { label: "Assets", width: "90px", render: (w) => el("span", { class: "dt-tnum" }, fmt.num(w.assets)) },
            {
              label: "Auto-approval",
              width: "180px",
              render: (w) =>
                w.rate == null
                  ? el("span", { class: "dt-text-small dt-text-subdued" }, "Not yet translated")
                  : el(
                      "div",
                      { class: "dt-row dt-gap-8", style: { alignItems: "center" } },
                      el("span", { class: "dt-tnum dt-text-medium", style: { minWidth: "48px" } }, fmt.pct(w.rate, 1)),
                      el("div", { class: "dt-grow" }, progress(w.rate, w.rate >= 80 ? "success" : null))
                    ),
            },
            { label: "Corrections absorbed", width: "150px", render: (w) => el("span", { class: "dt-tnum" }, w.corrections ? String(w.corrections) : "—") },
            {
              label: "Wave status",
              width: "120px",
              /* The wave's own lifecycle, read from project.waves. Calibrate
                 does not keep a parallel status vocabulary for the same waves. */
              render: (w) =>
                badge(
                  w.status.charAt(0).toUpperCase() + w.status.slice(1),
                  w.status === "published" ? "success" : w.status === "validating" || w.status === "translated" ? "info" : "neutral"
                ),
            },
          ],
          waves
        )
      ),

      card(
        { title: "Reading the trend" },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          note(adv.trendNote),
          note(
            `Across the ${fmt.num(translated.reduce((a, w) => a + w.assets, 0))} assets translated so far the rate is climbing wave over wave. If it ever flattens or falls, the profile has stopped generalising and the run should be repeated — that is the signal recalibration exists to catch, and it is why this table stays on screen long after the gate stopped blocking.`
          ),
          el(
            "div",
            { class: "dma-delta" },
            el("div", { class: "dt-text-semibold" }, "Recalibration trigger"),
            note(adv.recalibration.trigger),
            subdued(adv.recalibration.detail)
          ),
          subdued("Estate-wide validation totals are not restated here. They belong to Validate — Calibrate predicts the rate, it does not report it.")
        )
      )
    );
  }

  const PANELS = {
    sample: stepSample,
    profile: stepProfile,
    score: stepScore,
    release: stepRelease,
  };

  /* --- Registration --------------------------------------------------------- */
  DMA.register({
    id: "calibrate",
    title: "Calibrate",
    phase: "transform",
    icon: "gitBranch",
    status: "ready",
    scope: "sample",
    summary:
      "Learn this customer's SPL style on 214 stratified assets, then score the profile against itself to predict auto-approval before the estate commits.",

    steps: STEPS,

    notes: [
      "Blocking before the first wave translates; advisory thereafter. The exit condition is a recorded decision, not a score — calibration has run, a consultant reviewed the profile, and it either cleared threshold or carries an explicit override with a reason.",
      "Sample is 214 dependency-free assets, stratified across sourcetype, application and complexity. Taking the first 214 in scan order gives an 85%-simple sample that predicts 91% and delivers 62% — it calibrates on the easy ones and over-promises in the direction that costs most to discover late.",
      "Scores itself using Asset-to-Asset Validation, unchanged — the same comparator the estate will use. Calibrate does not grade its own homework with a bespoke metric.",
      "The control run is the guardrail. The same 214 assets scored with the profile withheld reach 55.1% against 78.0% with it, so the 23-point lift is measured rather than asserted. Near zero would mean the stage is ceremony and should be cut.",
      "Deliberately not fine-tuning. No weights change, so there is no per-customer model to host — and, more importantly, four learned conventions were corrected and two rejected by name, with reasons on the record. A weight offers nothing to disagree with.",
      "Two of the six interventions would otherwise have produced queries that run cleanly and return wrong answers — a macro argument read as hours instead of minutes, a field mapped to its Kubernetes form. Validation cannot catch those; a person reading a dictionary can.",
      "Three SPL patterns appear in exactly one asset each and are routed to Exceptions rather than sampled. Two more are 'thin' — present but below the four-instance bar — and are excluded from the prediction so the number is not propped up by shapes the profile has barely seen.",
      "In its advisory phase the profile keeps learning from every manual correction: 76.4% auto-approval in Wave 1 climbing to 83.3% in Wave 4 across 100 absorbed corrections. A flat or falling trend is the signal to re-run.",
      "A re-import that brings in assets outside the sample's distribution raises 'recalibration recommended' — advisory only, it does not re-block a project mid-flight. The 13 Oct re-import of 12 assets fell inside the distribution and raised nothing.",
      "The sample is an overlay, not a partition. Which assets get drawn is decided in Prioritize & Plan alongside wave placement; this stage runs what was drawn and never moves an asset out of its home wave.",
    ],

    render(root, ctx) {
      cancelReplay();
      const strip = buildStrip();

      root.append(
        ctx.pageHeader([
          button("Replay calibration", {
            variant: "default",
            iconName: "play",
            title: "Re-run the animation. Nothing is recomputed — this is the recorded run played back.",
            onClick: () => replay(strip.apply, strip.node),
          }),
          button("Export profile", { variant: "default", iconName: "download" }),
          button("Profile released", { variant: "emphasized", iconName: "check", disabled: true }),
        ]),
        strip.node,
        stepper(),
        PANELS[step()](ctx)
      );

      /* Land on the finished state. The fixture says this run completed on
         9 Oct and was released on the 11th, so anything else would be fiction. */
      strip.apply(100);
    },
  });
})();
