/* ============================================================================
   MODULE: Translate
   ----------------------------------------------------------------------------
   Flow-diagram stage: Transform → Translate

   Bulk-translates one wave. For every asset the system selects a best-fit
   model rather than running a single fixed path, and any translation that
   fails is retried exactly once with system-generated context before it is
   treated as a hard failure.

   ----------------------------------------------------------------------------
   WHY THIS SCREEN IS BUILT AROUND A WAVE AND A TRIGGER

   There is no bulk translation step in the product today. Translation happens
   as a side effect of publishing, one dashboard at a time — "I can publish
   this one, or I can publish 15 of them" — which means nobody has ever seen
   the shape of a wave's translation as a single event. So the first decision
   this screen makes is to BE that event: pick a wave, see what will run, run
   it, read what came back.

   The scope control in the stage rail is the wave picker. It already exists
   and it already drives the rail's colouring, so adding a second selector here
   would give the same decision two homes. With no wave selected the screen
   shows the board of six and the estate-level split instead.

   Which of the three modes a wave gets is derived from
   DMA.data.waveStageStatus(wave, "translate") and never from a flag in this
   module — so the rail and this screen cannot disagree about whether Wave 6
   is reachable.

     complete      waves 1–4    the run that happened, replayable
     in-progress   wave 5       pre-flight, armed, with a live trigger
     not-started   wave 6       has not cleared Wave Mapping; no trigger

   ----------------------------------------------------------------------------
   WHAT THIS STAGE DELIBERATELY DOES NOT SHOW

   No confidence score. No diff. No auto-approval rate. Translate answers "did
   we produce runnable DQL?" and Validate answers "does it return the same
   answer?" — 93.9% and 81.2%, two different questions with two different
   numbers. Putting a confidence column here would pre-empt the stage that
   owns it and invite the two to be read as one.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, progress, modal, fmt } = DMA.ui;

  const STEPS = [
    { id: "preflight", label: "Pre-flight" },
    { id: "run",       label: "Run translation" },
    { id: "outcomes",  label: "Outcomes" },
    { id: "routing",   label: "Routing" },
  ];

  const wrap = { whiteSpace: "normal" };
  const T = () => DMA.data.translation;
  const PR = () => DMA.data.project;

  function step() {
    const id = DMA.store.session.trStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  /* The wave the rail's scope control resolves to, or null for "All waves". */
  function selectedWave() {
    const id = DMA.store.session.waveId;
    if (!id || id === "all") return null;
    return PR().waves.find((w) => String(w.id) === String(id)) || null;
  }

  /* Three modes, derived. See the header. */
  function modeFor(wave) {
    if (DMA.store.session["trRan" + wave.id]) return "complete";
    return DMA.data.waveStageStatus(wave, "translate");
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
  const kpiRow = (...k) => el("div", { class: ["dt-grid", `dt-grid-${k.length}`] }, ...k);

  const OUTCOME = {
    clean:   { label: "Translated",         tone: "success",  icon: "check" },
    retried: { label: "Translated on retry", tone: "info",     icon: "refresh" },
    blocked: { label: "Blocked",            tone: "critical", icon: "alert" },
  };

  const modelById = (id) => T().models.find((m) => m.id === id);

  /* Reason counts are pooled across the four completed waves rather than shown
     per wave, because a single wave's 17 retries split four ways is four
     numbers between 3 and 7 — too small to be a distribution and too easy to
     over-read. Saying so on the card is cheaper than letting a reader notice
     that 61 is not 17 and conclude the figures are wrong. */
  const pooledLabel = (waveId) =>
    Number(waveId) === 5
      ? "Counts are this wave's projection."
      : "Counts are pooled across Waves 1–4, not this wave alone.";

  const stepper = () => {
    const active = step();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Translation steps" });
    STEPS.forEach((s, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(s.id === active),
            onClick: () => DMA.store.setSession("trStep", s.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, s.label)
        )
      );
    });
    return row;
  };

  /* ==========================================================================
     The run strip
     --------------------------------------------------------------------------
     Same construction as Calibrate's: built once, handed back with an
     `apply(pct)` closure that derives every visible number from one 0–100
     value. The animation and the finished state are therefore the same code
     path rather than two renderers that can drift, and the sixty-times-a-second
     updates mutate about a dozen nodes instead of going through DMA.store and
     rebuilding the page (which would also reset the reader's scroll on every
     frame).

     The phases are the four things that actually happen, and they are weighted
     by the time they actually take — model selection is fast, translation is
     not. The retry phase is last and separate on purpose: it is where the
     failed-first-pass counter visibly FALLS as context recovers assets, which
     is the whole feature in one movement.
     ======================================================================== */

  const PHASES = [
    { id: "resolve",   label: "Resolve prerequisites",        short: "Resolve",      from: 0,  to: 8 },
    { id: "select",    label: "Select best-fit model",        short: "Select model", from: 8,  to: 20 },
    { id: "translate", label: "Translate",                    short: "Translate",    from: 20, to: 84 },
    { id: "retry",     label: "Retry with injected context",  short: "Retry",        from: 84, to: 100 },
  ];

  /* Playback time is NOT proportional to the bar. Translation and retry get
     88% of it because they are the only phases where a number moves. */
  const PLAYBACK = [
    { to: 8,   ms: 260 },
    { to: 20,  ms: 420 },
    { to: 84,  ms: 3200 },
    { to: 100, ms: 1320 },
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

  let anim = null;      // rAF handle for the one run that may be in flight
  let animWatch = null; // its visibilitychange listener, removed with it

  function cancelRun() {
    if (anim) cancelAnimationFrame(anim);
    anim = null;
    if (animWatch) document.removeEventListener("visibilitychange", animWatch);
    animWatch = null;
  }

  function phaseAt(pct) {
    return PHASES.find((p) => pct < p.to) || PHASES[PHASES.length - 1];
  }

  /* Linear ramp of `pct` across one phase's span, clamped to 0..1. */
  function within(pct, phase) {
    return Math.max(0, Math.min(1, (pct - phase.from) / (phase.to - phase.from)));
  }

  function buildStrip(run, mode) {
    const t = T();
    const translatePhase = PHASES[2];
    const retryPhase = PHASES[3];
    const firstPassFails = run.retried + run.blocked;

    const pctNode   = el("span", { class: "dma-trstrip__big dt-tnum" }, "0%");
    const phaseNode = el("span", { class: "dt-text-small dt-text-secondary" }, "");
    const countNode = el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, "");
    const bar = progress(0, null);
    const fill = bar.querySelector(".dt-progress__fill");

    const ticks = el(
      "div",
      { class: "dma-trrun__ticks" },
      PHASES.slice(1).map((p) => el("span", { class: "dma-trrun__tick", style: { left: `${p.from}%` } }))
    );
    const runBar = el("div", { class: "dma-trrun" }, bar, ticks);

    const phaseChips = PHASES.map((p) =>
      el(
        "span",
        { class: "dma-trphase", dataset: { state: "todo" }, title: p.label },
        el("span", { class: "dma-trphase__dot" }),
        p.short
      )
    );

    /* The three counters. `failed` is the one that matters — it climbs through
       the translate phase and then falls through the retry phase, which is the
       feature made visible rather than asserted. */
    const cleanN  = el("span", { class: "dma-trcount__n dt-tnum" }, "0");
    const failedN = el("span", { class: "dma-trcount__n dt-tnum" }, "0");
    const retryN  = el("span", { class: "dma-trcount__n dt-tnum" }, "0");

    const counter = (node, label, tone) =>
      el("div", { class: "dma-trcount", dataset: { tone } }, node, el("span", { class: "dma-trcount__l" }, label));

    const narration = el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, "");

    const node = el(
      "div",
      { class: "dma-trstrip" },
      el(
        "div",
        { class: "dma-trstrip__main" },
        el("div", { class: "dma-trstrip__head" }, pctNode, el("div", { class: "dt-stack dt-gap-4" }, phaseNode, countNode)),
        runBar,
        el("div", { class: "dma-trphases" }, phaseChips)
      ),
      el(
        "div",
        { class: "dma-trstrip__side" },
        el("div", { class: "dma-kpi__label" }, icon("layers", 13), "Outcome"),
        el(
          "div",
          { class: "dma-trcounts" },
          counter(cleanN, "first pass", "success"),
          counter(failedN, "failed", "critical"),
          counter(retryN, "recovered", "info")
        ),
        narration
      )
    );

    function apply(pct) {
      const p = Math.max(0, Math.min(100, pct));
      const phase = phaseAt(p);

      pctNode.textContent = `${Math.round(p)}%`;
      phaseNode.textContent = p >= 100 ? "Complete" : phase.label;
      fill.style.width = `${p}%`;
      bar.setAttribute("aria-valuenow", String(Math.round(p)));
      /* Primary while it runs, success only once it is done — the bar should
         not claim an outcome it has not reached. */
      fill.className = "dt-progress__fill" + (p >= 100 ? " dt-progress__fill--success" : "");

      /* Assets translated: nothing before the translate phase, linear across
         it, complete thereafter. */
      const tDone = p <= translatePhase.from ? 0
        : p >= translatePhase.to ? run.ran
        : Math.round(within(p, translatePhase) * run.ran);
      countNode.textContent = `${fmt.num(tDone)} of ${fmt.num(run.ran)} assets`;

      const cleanSoFar  = Math.round((tDone / run.ran) * run.clean);
      const failedSoFar = tDone - cleanSoFar;
      const recovered = p <= retryPhase.from ? 0
        : p >= retryPhase.to ? run.retried
        : Math.round(within(p, retryPhase) * run.retried);

      cleanN.textContent  = fmt.num(cleanSoFar);
      failedN.textContent = fmt.num(Math.max(0, failedSoFar - recovered));
      retryN.textContent  = fmt.num(recovered);

      phaseChips.forEach((chip, i) => {
        const ph = PHASES[i];
        chip.dataset.state = p >= ph.to ? "done" : p >= ph.from ? "active" : "todo";
      });

      narration.textContent =
        p === 0 ? (mode === "armed" ? "Armed. Nothing has been written to the tenant." : "")
        : p < translatePhase.from ? "Lookups keyed, macros expanded, model chosen per asset from the SPL it actually contains."
        : p < retryPhase.from ? `${fmt.num(failedSoFar)} have failed their first pass. Each gets exactly one retry with context the earlier stages already resolved.`
        : p < 100 ? `Retrying ${fmt.num(firstPassFails)} with injected context — ${fmt.num(recovered)} recovered so far.`
        : `${fmt.num(run.clean + run.retried)} runnable of ${fmt.num(run.ran)} (${fmt.pct(T().successRate(run), 1)}). ${fmt.num(run.blocked)} could not be recovered by a retry and route to Exceptions.`;
    }

    return { node, apply };
  }

  function playRun(strip, onDone) {
    cancelRun();
    if (document.hidden) { strip.apply(100); if (onDone) onDone(); return; }
    const start = performance.now();
    strip.apply(0);
    animWatch = function () {
      if (document.hidden) { cancelRun(); strip.apply(100); if (onDone) onDone(); }
    };
    document.addEventListener("visibilitychange", animWatch);
    function frame(now) {
      if (!strip.node.isConnected) return cancelRun();
      const ms = now - start;
      strip.apply(pctAtElapsed(ms));
      if (ms < PLAYBACK_MS) anim = requestAnimationFrame(frame);
      else { cancelRun(); if (onDone) onDone(); }
    }
    anim = requestAnimationFrame(frame);
  }

  /* ==========================================================================
     The board — what you see with no wave selected
     ======================================================================== */

  function waveBoard(ctx) {
    const t = T();
    const e = t.estate();
    const split = t.typeSplit();

    const open = (id) => {
      DMA.store.setSession("trStep", "preflight");
      DMA.store.setSession("waveId", String(id));
    };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      kpiRow(
        kpi("Translatable in waves", fmt.num(e.inWave), `of ${fmt.num(split.total)} in scope`, { iconName: "zap" }),
        kpi("Runnable DQL produced", fmt.num(e.translated), `${fmt.pct(t.successRate(), 1)} across ${e.wavesDone} waves`, { iconName: "check", tone: "success" }),
        kpi("Routed to Exceptions", fmt.num(e.blocked), "no runnable output after retry", { iconName: "alert", tone: "critical" }),
        kpi("Not yet run", fmt.num(e.pending), "Waves 5 and 6", { iconName: "clock" })
      ),

      banner(
        "info",
        "Translation runs per wave, not per estate. Pick a wave in the scope control above, or open one below.",
        { title: "Select a wave to work on" }
      ),

      card(
        { title: "The six waves", subtitle: "Waves advance independently — Wave 1 is live while Wave 5 has not started." },
        table(
          [
            { label: "Wave", render: (w) => el("div", { class: "dt-stack dt-gap-4" },
                el("span", { class: "dt-text-semibold" }, `Wave ${w.id} — ${w.name}`),
                subdued(`${fmt.num(w.assets)} assets · ${fmt.num(t.prerequisiteIn(w.id))} prerequisite`)) },
            { label: "Translatable", render: (w) => el("span", { class: "dt-tnum" }, fmt.num(t.translatableIn(w.id))) },
            { label: "Stage", render: (w) => {
                const m = modeFor(w);
                return badge(
                  m === "complete" ? "Translated" : m === "in-progress" ? "Ready to run" : "Not reached",
                  m === "complete" ? "success" : m === "in-progress" ? "info" : "neutral"
                );
              } },
            { label: "First pass", render: (w) => {
                const r = t.runFor(w.id);
                if (!r || modeFor(w) !== "complete") return subdued("—");
                return el("span", { class: "dt-tnum" }, fmt.pct(t.firstPassRate(r), 1));
              } },
            { label: "Retried", render: (w) => {
                const r = t.runFor(w.id);
                if (!r || modeFor(w) !== "complete") return subdued("—");
                return el("span", { class: "dt-tnum" }, fmt.num(r.retried));
              } },
            { label: "Blocked", render: (w) => {
                const r = t.runFor(w.id);
                if (!r || modeFor(w) !== "complete") return subdued("—");
                return el("span", { class: "dt-tnum dt-text-critical" }, fmt.num(r.blocked));
              } },
            { label: "Duration", render: (w) => {
                const r = t.runFor(w.id);
                if (!r || modeFor(w) !== "complete") return subdued("—");
                return el("span", { class: "dt-tnum dt-text-subdued" }, r.durationLabel);
              } },
            { label: "", render: (w) => button(modeFor(w) === "in-progress" ? "Open & run" : "Open", {
                variant: modeFor(w) === "in-progress" ? "emphasized" : "default",
                size: "sm", iconName: "chevronR", iconAfter: true,
                onClick: () => open(w.id),
              }) },
          ],
          PR().waves
        )
      ),

      card(
        { title: "2,955 assets is not 2,955 translations", subtitle: "What this stage actually operates on" },
        el(
          "div",
          { class: "dma-trsplit" },
          el(
            "div",
            { class: "dma-trsplit__col" },
            el("div", { class: "dma-kpi__label" }, icon("zap", 13), "Translatable"),
            el("div", { class: "dma-trsplit__n dt-tnum" }, fmt.num(split.translatable)),
            el("div", { class: "dt-stack dt-gap-4", style: { marginTop: "8px" } },
              PR().assets.byType.filter((x) => t.TRANSLATABLE.includes(x.type)).map((x) =>
                el("div", { class: "dma-trsplit__row" },
                  el("span", {}, x.type),
                  el("span", { class: "dt-tnum dt-text-secondary" }, fmt.num(x.count)))
              )),
            note("SPL becomes DQL. These are the three tabs on the outcomes table — and the only assets a translation rate can honestly be computed over.")
          ),
          el(
            "div",
            { class: "dma-trsplit__col dma-trsplit__col--muted" },
            el("div", { class: "dma-kpi__label" }, icon("database", 13), "Prerequisite"),
            el("div", { class: "dma-trsplit__n dt-tnum" }, fmt.num(split.prerequisite)),
            el("div", { class: "dt-stack dt-gap-4", style: { marginTop: "8px" } },
              PR().assets.byType.filter((x) => t.PREREQUISITE.includes(x.type)).map((x) =>
                el("div", { class: "dma-trsplit__row" },
                  el("span", {}, x.type),
                  el("span", { class: "dt-tnum dt-text-secondary" }, fmt.num(x.count)))
              )),
            note("Lookups are uploaded as data before a translation can resolve against them; macros expand from the dictionary Calibrate froze. Neither is translated, and counting them as translations inflates every rate on this stage by 12.6%.")
          )
        )
      )
    );
  }

  /* ==========================================================================
     Step 1 — Pre-flight
     ======================================================================== */

  function panelPreflight(ctx, wave, mode) {
    const t = T();
    const pf = t.preflight(wave.id);
    const run = t.runFor(wave.id);
    const comp = t.compositionFor(wave.id);
    const blocking = pf.checks.filter((c) => c.blocking && c.status !== "pass");

    const checkRow = (c) =>
      el(
        "div",
        { class: "dma-trcheck", dataset: { status: c.status } },
        el("span", { class: "dma-trcheck__mark" },
          icon(c.status === "pass" ? "check" : c.status === "warning" ? "alert" : "x", 13)),
        el(
          "div",
          { class: "dt-stack dt-gap-4 dt-grow" },
          el("div", { class: "dt-row dt-gap-8", style: { alignItems: "baseline" } },
            el("span", { class: "dt-text-semibold" }, c.label),
            el("span", { class: "dt-text-small dt-text-secondary dt-tnum" }, c.value),
            c.blocking ? badge("Blocking", "neutral") : badge("Advisory", "neutral")),
          note(c.detail)
        ),
        c.status === "blocked" && c.resolvableHere && mode === "in-progress"
          ? button("Pull forward to this wave", {
              variant: "emphasized", size: "sm", iconName: "arrowRight",
              title: "Deliver these lookups with Wave " + wave.id + " instead of Wave " + c.late[0].deliverWave,
              onClick: () => {
                t.pulledForward[wave.id] = true;
                DMA.store.setSession("trPulled", Date.now()); // force a re-render
              },
            })
          : c.status === "warning" && c.owner
          ? button("Open Wave Mapping", { variant: "default", size: "sm", iconName: "externalLink", onClick: () => ctx.navigate(c.owner) })
          : null
      );

    const plan = run ? t.modelMix(run) : [];

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      kpiRow(
        kpi("Assets in wave", fmt.num(wave.assets), `${fmt.num(pf.translatable)} translatable · ${fmt.num(t.prerequisiteIn(wave.id))} prerequisite`, { iconName: "layers" }),
        kpi("Ready to run", fmt.num(pf.runnable), pf.held ? `${fmt.num(pf.held)} held on missing input` : "nothing held", { iconName: "zap", tone: pf.held ? "warning" : "success" }),
        kpi("Blocking checks", String(blocking.length), blocking.length ? "must clear before the run" : "all clear", { iconName: "shield", tone: blocking.length ? "critical" : "success" }),
        kpi("Projected duration", run ? run.durationLabel : "—", run ? "from the model plan" : "no plan", { iconName: "clock" })
      ),

      mode === "not-started"
        ? banner("warning",
            `Wave ${wave.id} has not cleared Wave Mapping — ${t.missingTokens(wave.id).length} applications have supplied no mapping inputs at all. Translation is not offered until it does, because the DQL embeds the resolved name and bucket.`,
            { title: "Not reachable yet", action: button("Open Wave Mapping", { variant: "default", iconName: "externalLink", onClick: () => ctx.navigate("wave-mapping") }) })
        : null,

      card(
        { title: "Pre-flight", subtitle: "Two of these are derived from other stages' data, so they cannot drift out of date." },
        el("div", { class: "dt-stack dt-gap-8" }, pf.checks.map(checkRow))
      ),

      pf.held
        ? card(
            { title: `${fmt.num(pf.held)} assets held — two missing words`, subtitle: "Held is neither a success nor a failure. They never started." },
            el("div", { class: "dt-stack dt-gap-12" },
              t.missingTokens(wave.id).map((m) =>
                el("div", { class: "dma-trheld" },
                  el("div", { class: "dt-stack dt-gap-4 dt-grow" },
                    el("span", { class: "dt-text-semibold" }, m.app.name),
                    subdued(`Missing ${m.missing.map((k) => "`" + k + "`").join(", ")} — every asset in this application would translate to a name that cannot resolve.`)),
                  m.held ? el("div", { class: "dt-row dt-gap-16 dt-tnum dt-text-small" },
                    el("span", {}, `${fmt.num(m.held.dashboards)} dashboards`),
                    el("span", {}, `${fmt.num(m.held.alerts)} alerts`),
                    el("span", {}, `${fmt.num(m.held.savedSearches)} searches`),
                    el("span", { class: "dt-text-semibold" }, `${fmt.num(m.held.total)} held`)) : null)
              ),
              note("They re-enter this wave's queue the moment the value lands — no re-plan, no re-import, no second translation of the assets that already ran. This is the reason a wave runs partially rather than all-or-nothing.")
            )
          )
        : null,

      run && mode !== "not-started"
        ? card(
            { title: "Model plan", subtitle: `A best-fit model is selected per asset from the SPL it actually contains — not one fixed path for all ${fmt.num(run.ran)}.` },
            el("div", { class: "dt-stack dt-gap-12" },
              plan.map((p) =>
                el("div", { class: "dma-trmodel" },
                  el("div", { class: "dt-row dt-gap-8", style: { alignItems: "baseline" } },
                    badge(p.model.kind, p.model.tone),
                    el("span", { class: "dt-text-semibold" }, p.model.name),
                    el("span", { class: "dt-grow" }),
                    el("span", { class: "dt-tnum dt-text-secondary" }, `${fmt.num(p.count)} · ${fmt.pct(p.pct, 0)}`)),
                  el("div", { class: "dma-trmodel__bar" },
                    el("div", { class: "dma-trmodel__fill", dataset: { tone: p.model.tone }, style: { width: `${p.pct}%` } })),
                  note(p.model.selectedWhen),
                  subdued(`~${p.model.latencyS}s per asset.`))
              ),
              note(`${fmt.pct(plan[0] ? plan[0].pct : 0, 0)} of this wave needs no model call at all. That is the half of "best-fit" that is a cost decision rather than a quality one — a single fixed path either overpays on those or underserves the ${fmt.num(plan[2] ? plan[2].count : 0)} searches that do not fit in a standard context window.`)
            )
          )
        : null
    );
  }

  /* ==========================================================================
     Step 2 — Run
     ======================================================================== */

  function panelRun(ctx, wave, mode) {
    const t = T();
    const run = t.runFor(wave.id);

    if (!run || mode === "not-started") {
      return card({}, DMA.ui.emptyState("lock", "No run for this wave yet",
        `Wave ${wave.id} has not cleared Wave Mapping. Translation becomes available once its applications supply the inputs the confirmed rule set demands.`,
        button("Open Wave Mapping", { variant: "default", iconName: "externalLink", onClick: () => ctx.navigate("wave-mapping") })));
    }

    const armed = mode === "in-progress";
    const pf = t.preflight(wave.id);
    const gate = pf.checks.find((c) => c.blocking && c.status === "blocked");

    const strip = buildStrip(run, armed ? "armed" : "complete");
    /* A finished run must LOOK finished the moment the panel opens. The strip
       and the animation are the same code path, so landing on the end state is
       just applying 100 — never a second renderer that can drift from it. */
    strip.apply(armed ? 0 : 100);

    const trigger = armed
      ? button(gate ? "Blocked by pre-flight" : `Start translation — ${fmt.num(run.ran)} assets`, {
          variant: "emphasized",
          iconName: gate ? "lock" : "play",
          disabled: !!gate,
          title: gate ? gate.detail : "Runs the wave. Locks rule set v4 against it.",
          onClick: () => playRun(strip, () => DMA.store.setSession("trRan" + wave.id, Date.now())),
        })
      : button("Replay run", {
          variant: "default", iconName: "play",
          title: "Nothing is recomputed — this is the recorded run played back.",
          onClick: () => playRun(strip),
        });

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      gate
        ? banner("critical", gate.detail, {
            title: "Pre-flight is blocking this run",
            action: button("Go to pre-flight", { variant: "default", onClick: () => DMA.store.setSession("trStep", "preflight") }),
          })
        : armed
        ? banner("info", `${fmt.num(run.ran)} assets will run. ${fmt.num(run.held)} are held on inputs another stage owns and are not part of this run. Starting freezes rule set v4 against Wave ${wave.id}.`, { title: "Armed" })
        : banner(
            "success",
            run.startedAt
              ? `Run completed ${fmt.date(run.startedAt)} in ${run.durationLabel}, triggered by ${run.triggeredBy}.`
              : `Run completed just now in ${run.durationLabel}. Rule set v4 is now locked against Wave ${wave.id} — a later change to the rule set will not silently alter what this wave produced.`,
            { title: `Wave ${wave.id} translated` }
          ),

      el("div", { class: "dt-row dt-gap-8" }, trigger),

      strip.node,

      card(
        { title: "What the retry is for", subtitle: `Exactly one retry per failed asset — the PRD is explicit that this is not an open-ended loop. ${pooledLabel(wave.id)}` },
        el("div", { class: "dt-stack dt-gap-12" },
          note("An open retry loop hides a genuinely broken translation behind three attempts that were never going to work. One retry, with context the system can generate, is the whole mechanism — and because the context comes from decisions earlier stages already made, the retry is this stage collecting on work already done rather than guessing again."),
          el("div", { class: "dma-trwhy" },
            t.reasonsFor(t.retryReasons, wave.id).map((r) =>
              el("div", { class: "dma-trwhy__row" },
                el("span", { class: "dma-trwhy__n dt-tnum" }, fmt.num(r.count)),
                el("div", { class: "dt-stack dt-gap-4 dt-grow" },
                  el("span", { class: "dt-text-semibold" }, r.label),
                  note(r.detail)),
                badge(({ "global-mapping": "Global Mapping", calibrate: "Calibrate", "wave-mapping": "Wave Mapping" })[r.from], "neutral"))
            ))
        )
      ),

      card(
        { title: "Why a second retry would not help", subtitle: `Retries fell ${fmt.num(t.runFor(1).retried)} → ${fmt.num(t.runFor(4).retried)} across four waves. Blocked held ${fmt.num(t.runFor(1).blocked)} → ${fmt.num(t.runFor(4).blocked)}. ${pooledLabel(wave.id)}` },
        el("div", { class: "dt-stack dt-gap-12" },
          note("The two lines move differently because they are different kinds of problem. A retry fixes a CONTEXT problem — a field we already knew, a macro we already had, a bucket already decided — and the profile keeps absorbing those, so the retry count falls. None of the reasons below are context problems. Adding a second retry would not move a single one of these rows."),
          el("div", { class: "dma-trwhy" },
            t.reasonsFor(t.blockReasons, wave.id).map((r) =>
              el("div", { class: "dma-trwhy__row" },
                el("span", { class: "dma-trwhy__n dt-tnum dt-text-critical" }, fmt.num(r.count)),
                el("div", { class: "dt-stack dt-gap-4 dt-grow" },
                  el("span", { class: "dt-text-semibold" }, r.label),
                  note(r.detail)))
            ))
        )
      )
    );
  }

  /* ==========================================================================
     Step 3 — Outcomes
     --------------------------------------------------------------------------
     Three tabs, because the three translatable types do not share a column
     set: only a dashboard has tiles. That is not a cosmetic difference. A
     dashboard is not the unit of work and never was — consultants count tiles
     ("25 tiles out of 50"), and a dashboard marked blocked is usually one bad
     panel out of twelve, which is the difference between routing an asset to
     Exceptions and routing a panel.
     ======================================================================== */

  function assetModal(a) {
    const t = T();
    const m = modelById(a.model);
    const o = OUTCOME[a.outcome];
    const reason = a.blockReason ? t.blockReasons.find((r) => r.id === a.blockReason)
      : a.retryReason ? t.retryReasons.find((r) => r.id === a.retryReason) : null;

    const body = el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el("div", { class: "dt-row dt-gap-8" },
        badge(o.label, o.tone, { iconName: o.icon }),
        badge(m.name, m.tone),
        badge(a.type.replace(/s$/, ""), "neutral"),
        a.tiles ? badge(`${a.tiles.total - a.tiles.flagged} of ${a.tiles.total} tiles clean`, a.tiles.flagged ? "warning" : "success") : null),

      reason ? el("div", { class: "dt-stack dt-gap-4" },
        el("span", { class: "dt-text-semibold" }, a.blockReason ? "Why it is blocked" : "Why it was retried"),
        note(reason.label), note(reason.detail)) : null,

      a.injected ? el("div", { class: "dt-stack dt-gap-4" },
        el("span", { class: "dt-text-semibold" }, "Context injected on the retry"),
        el("div", { class: "dma-trinject" }, a.injected)) : null,

      a.detail ? note(a.detail) : null,

      a.tileList
        ? el("div", { class: "dt-stack dt-gap-8" },
            el("span", { class: "dt-text-semibold" }, `All ${a.tileList.length} tiles`),
            note("This is the view the stage exists to make possible. Routing the whole dashboard to Exceptions sends eleven working panels along with the three that are not."),
            el("div", { class: "dma-trtiles" },
              a.tileList.map((tile) =>
                el("div", { class: "dma-trtile", dataset: { state: tile.state } },
                  el("span", { class: "dma-trtile__n dt-tnum" }, String(tile.n)),
                  el("div", { class: "dt-stack dt-gap-4 dt-grow" },
                    el("span", {}, tile.name),
                    tile.why ? subdued(tile.why) : null),
                  badge(modelById(tile.model).name, "neutral"),
                  badge(tile.state === "clean" ? "Translated" : "Blocked", tile.state === "clean" ? "success" : "critical"))
              )))
        : null
    );

    /* modal() returns its own close handle, and the footer button is built
       before that handle exists — so the button closes over a variable the
       next line fills in. The header's × and Escape already work; a footer
       button that looks like a close and is not one is worse than none. */
    let handle;
    handle = modal(
      a.name,
      body,
      [button("Close", { variant: "default", onClick: () => handle.close() })],
      { wide: !!a.tileList }
    );
  }

  function panelOutcomes(ctx, wave, mode) {
    const t = T();
    const run = t.runFor(wave.id);
    if (!run || mode !== "complete") {
      return card({}, DMA.ui.emptyState(
        "fileText",
        "Nothing translated yet",
        mode === "not-started"
          ? `Wave ${wave.id} has not cleared Wave Mapping, so there is nothing to report on yet.`
          : `Wave ${wave.id} is armed but has not run. The summary is the output of the run — showing it beforehand would be a forecast dressed as a result.`,
        mode === "in-progress"
          ? button("Go to run", { variant: "emphasized", iconName: "play", onClick: () => DMA.store.setSession("trStep", "run") })
          : button("Open Wave Mapping", { variant: "default", iconName: "externalLink", onClick: () => ctx.navigate("wave-mapping") })
      ));
    }

    const activeType = t.TRANSLATABLE.includes(DMA.store.session.trType) ? DMA.store.session.trType : t.TRANSLATABLE[0];
    const filter = DMA.store.session.trFilter || "all";
    const q = (DMA.store.session.trQuery || "").toLowerCase();
    const comp = t.compositionFor(wave.id);
    const typeCount = { Dashboards: comp.dashboards, Alerts: comp.alerts, "Saved searches": comp.savedSearches };

    let rows = t.assetsFor(wave.id, activeType);
    const shown = rows.length;
    if (filter !== "all") rows = rows.filter((r) => r.outcome === filter);
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.app.toLowerCase().includes(q));

    const appName = (id) => {
      const a = DMA.data.planning.applications.find((x) => x.id === id);
      return a ? a.name : id;
    };

    const tabs = el("div", { class: "dma-trtabs", role: "tablist", "aria-label": "Asset type" },
      t.TRANSLATABLE.map((ty) =>
        el("button", {
          class: "dma-trtab", role: "tab", "aria-selected": String(ty === activeType),
          onClick: () => DMA.store.setSession("trType", ty),
        }, ty, el("span", { class: "dma-trtab__n dt-tnum" }, fmt.num(typeCount[ty])))));

    const search = el("input", {
      class: "dt-input", type: "search", placeholder: "Search name or application", value: DMA.store.session.trQuery || "",
      "aria-label": "Search assets",
      onChange: (e) => DMA.store.setSession("trQuery", e.target.value),
    });

    const sel = el("select", { class: "dt-input", "aria-label": "Filter by outcome",
      onChange: (e) => DMA.store.setSession("trFilter", e.target.value) },
      el("option", { value: "all" }, "All outcomes"),
      Object.keys(OUTCOME).map((k) => el("option", { value: k }, OUTCOME[k].label)));
    sel.value = filter;

    const columns = [
      { label: "Name", render: (r) => el("div", { class: "dt-stack dt-gap-4" },
          el("span", { class: "dt-text-semibold" }, r.name),
          subdued(r.id)) },
      { label: "Application", render: (r) => el("span", { class: "dt-text-small" }, appName(r.app)) },
    ];
    if (activeType === "Dashboards") {
      columns.push({ label: "Tiles", render: (r) => {
        if (!r.tiles) return subdued("—");
        return r.tiles.flagged
          ? el("span", { class: "dt-text-critical dt-tnum" }, `${r.tiles.flagged} of ${r.tiles.total} flagged`)
          : el("span", { class: "dt-tnum dt-text-subdued" }, `${r.tiles.total} clean`);
      } });
    }
    columns.push(
      { label: "Model", render: (r) => badge(modelById(r.model).name, modelById(r.model).tone) },
      { label: "Pass", render: (r) => el("span", { class: "dt-text-small dt-text-secondary" }, r.outcome === "retried" ? "Retry" : "First") },
      { label: "Outcome", render: (r) => badge(OUTCOME[r.outcome].label, OUTCOME[r.outcome].tone, { iconName: OUTCOME[r.outcome].icon }) },
      { label: "", render: () => icon("chevronR", 14) }
    );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      kpiRow(
        kpi("Translated first pass", fmt.num(run.clean), fmt.pct(t.firstPassRate(run), 1), { iconName: "check", tone: "success" }),
        kpi("Recovered by retry", fmt.num(run.retried), `${fmt.pct(t.retryRate(run), 1)} of the run`, { iconName: "refresh", tone: "info" }),
        kpi("Blocked", fmt.num(run.blocked), "no runnable output", { iconName: "alert", tone: "critical" }),
        kpi("Held", fmt.num(run.held), run.held ? "never started" : "nothing held", { iconName: "lock", tone: run.held ? "warning" : undefined })
      ),

      card(
        { title: "Outcomes", subtitle: "Three tabs because the three types do not share a column set — only a dashboard has tiles." , flush: true },
        el("div", { class: "dma-trtoolbar" }, tabs),
        el("div", { class: "dma-trfilters" }, search, sel),
        rows.length
          ? table(columns, rows, { onRowClick: assetModal })
          : el("div", { style: { padding: "24px" } }, DMA.ui.emptyState("search", "No assets match", "Clear the search or the outcome filter.")),
        el("div", { class: "dma-trfoot" },
          subdued(`Showing ${fmt.num(rows.length)} of ${fmt.num(shown)} sampled rows, drawn from ${fmt.num(typeCount[activeType])} ${activeType.toLowerCase()} in this wave. A prototype fixture, not the full population — every row opens.`))
      ),

      card(
        { title: "A blocked dashboard is usually not a blocked dashboard", subtitle: "Why the Tiles column exists" },
        el("div", { class: "dt-stack dt-gap-8" },
          note("The live product marks an asset supported, partially supported, or unsupported, and consultants say plainly that the middle one means nothing to them — \"I don't really know what this yellow stuff means.\" It is not wrong, it is just not actionable, because it does not say WHICH part is partial."),
          note("So this stage does not use that word. A dashboard carries its tile count and its flagged count, and opening it names the panels and the reason each one failed. FX Rate Drift — Intraday is blocked on three of fourteen panels; the other eleven translated cleanly and a reviewer should never have to rediscover that."),
          note("It is also the unit the work is actually estimated in. Consultants track progress as \"25 tiles out of 50\" and reassign individual tiles to senior reviewers — never whole dashboards."))
      )
    );
  }

  /* ==========================================================================
     Step 4 — Routing
     ======================================================================== */

  function panelRouting(ctx, wave, mode) {
    const t = T();
    const run = t.runFor(wave.id);
    /* Same gate as Outcomes, and for the same reason: an asset's destination is
       decided by its outcome, so there is nothing to route until the run has
       produced one. */
    if (!run || mode !== "complete") {
      return card({}, DMA.ui.emptyState(
        "gitBranch",
        "Nothing to route",
        mode === "in-progress"
          ? `Wave ${wave.id} is armed but has not run. Where an asset goes is decided by its outcome, and it does not have one yet.`
          : `Wave ${wave.id} has not run.`,
        mode === "in-progress"
          ? button("Go to run", { variant: "emphasized", iconName: "play", onClick: () => DMA.store.setSession("trStep", "run") })
          : null
      ));
    }

    const dest = t.routing(run);
    const total = dest.reduce((a, d) => a + d.count, 0);
    const saved = t.retriesSaved();

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      card(
        { title: "Where this wave's assets go next", subtitle: `${fmt.num(total)} accounted for — ${fmt.num(run.ran)} ran, ${fmt.num(run.held)} held. Nothing is unaccounted for.` },
        el("div", { class: "dma-trroute" },
          dest.map((d) =>
            el("div", { class: "dma-trroute__card", dataset: { tone: d.tone } },
              el("div", { class: "dma-trroute__n dt-tnum" }, fmt.num(d.count)),
              el("div", { class: "dt-text-semibold" }, d.label),
              note(d.detail),
              d.id !== "held"
                ? button(`Open ${d.id === "validate" ? "Validate" : "Exceptions"}`, {
                    variant: "default", size: "sm", iconName: "arrowRight", iconAfter: true,
                    onClick: () => ctx.navigate(d.id),
                  })
                : button("Open Wave Mapping", { variant: "default", size: "sm", iconName: "externalLink", onClick: () => ctx.navigate("wave-mapping") })
            )))
      ),

      card(
        { title: "What the retry bought", subtitle: "The feature's own success metric, measured on this project" },
        el("div", { class: "dt-stack dt-gap-12" },
          kpiRow(
            kpi("Would have blocked", fmt.num(saved.wouldHaveBlocked), "without the automated retry", { iconName: "alert" }),
            kpi("Actually blocked", fmt.num(t.estate().blocked), "reached Exceptions", { iconName: "alert", tone: "critical" }),
            kpi("Recovered", fmt.num(saved.recovered), `${fmt.pct((saved.recovered / saved.wouldHaveBlocked) * 100, 0)} of first-pass failures`, { iconName: "refresh", tone: "success" })
          ),
          note(`Across waves 1–4, ${fmt.num(saved.wouldHaveBlocked)} assets failed their first pass. ${fmt.num(saved.recovered)} of them — ${fmt.pct((saved.recovered / saved.wouldHaveBlocked) * 100, 0)} — were recovered by one automated retry and never reached a human. That is the PRD's headline metric, and it is measured here rather than asserted because the first-pass result is recorded separately from the final one.`),
          note("The number is deliberately not flattering. A 35% recovery rate means the majority of first-pass failures are capability gaps a retry cannot close — which is the honest read, and the reason Exceptions still exists as a staffed stage rather than a holding pen.")
        )
      ),

      card(
        { title: "Two numbers that are not the same number", subtitle: "The most likely misreading of this stage" },
        el("div", { class: "dma-trcompare" },
          el("div", { class: "dma-trcompare__side" },
            el("div", { class: "dma-kpi__label" }, icon("zap", 13), "Translate"),
            el("div", { class: "dma-trcompare__n dt-tnum" }, fmt.pct(t.successRate(), 1)),
            el("div", { class: "dt-text-semibold" }, "Runnable DQL"),
            note("Did we produce DQL that executes, after at most one retry? This stage can answer that and nothing more.")),
          el("div", { class: "dma-trcompare__side dma-trcompare__side--next" },
            el("div", { class: "dma-kpi__label" }, icon("checkCircle", 13), "Validate"),
            el("div", { class: "dma-trcompare__n dt-tnum" }, fmt.pct(PR().validation.autoApprovalRate, 1)),
            el("div", { class: "dt-text-semibold" }, "Auto-approved"),
            note("Does it return the same answer as the Splunk original? A different question, a different comparator, and a lower number."))
        ),
        note("Runnable is an easier bar than correct, so the first number will always be the higher one. A stage that reported 93.9% as its headline would be claiming the second while measuring the first — which is why no confidence score and no diff appears anywhere on this screen.")
      )
    );
  }

  const PANELS = {
    preflight: panelPreflight,
    run: panelRun,
    outcomes: panelOutcomes,
    routing: panelRouting,
  };

  /* ======================================================================== */

  DMA.register({
    id: "translate",
    title: "Translate",
    phase: "transform",
    icon: "zap",
    status: "ready",
    scope: "wave",
    summary:
      "Pick a wave, clear its pre-flight, and run bulk translation — a best-fit model per asset and exactly one automated retry before anything reaches a human.",

    steps: STEPS,

    notes: [
      "2,955 assets is not 2,955 translations. Dashboards, alerts and saved searches translate (2,584); lookups and macros are prerequisites that must exist before a translation can resolve against them (371). Counting the prerequisites as translations inflates every rate on this stage by 12.6% — and the reference design's three tabs say the same thing.",
      "Runnable is not correct. Translate asks whether it produced DQL that executes (93.9%); Validate asks whether it returns the same answer (81.2%). No confidence score or diff appears here, because putting one on this screen pre-empts the stage that owns it.",
      "A best-fit model per asset is partly a cost decision. Rule-based deterministic conversion handles 43% of a wave with no model call at all; extended context is reserved for the ~7% of searches that do not fit a standard window. One fixed path either overpays on the first group or underserves the second.",
      "Exactly one retry, by design. The PRD is explicit that open-ended loops are out of scope — three attempts that were never going to work hide a genuinely broken translation behind a longer wait.",
      "Every retry injects context an earlier stage already resolved: a field rule from Global Mapping, a macro definition from the Calibrate profile, a bucket and timeframe from Wave Mapping. The retry is this stage collecting on work already done rather than guessing a second time.",
      "Retries fall, blocked holds flat: 19 → 17 → 14 → 11 retries across waves 1–4, against 30 → 29 → 29 → 25 blocked. They move differently because a retry fixes a context problem and the profile keeps absorbing those, while none of the block reasons are context problems. A second retry would not move a single one.",
      "Held is a third state, and it is neither success nor failure. 134 of Wave 5's 488 assets never start because Remittance and Facilities & IoT have never supplied a `team` value. Counting them either way is how a wave reports 100% on 73% of its work.",
      "The pre-flight gate the stage can clear itself is lookup delivery order, because that is genuinely a translate-time decision — two tables delivering in Wave 6 are read in Wave 5. The gate it cannot clear is a missing mapping token, which belongs to the application. A gate that sends you elsewhere is a handoff and should look like one.",
      "A dashboard is not the unit of work. Consultants count tiles — \"25 tiles out of 50\" — and reassign individual panels, so an asset carries its tile count and its flagged count. FX Rate Drift is blocked on 3 of 14 panels; routing the whole dashboard to Exceptions sends eleven working panels with it.",
      "\"Partially supported\" is deliberately not used. Consultants said plainly it tells them nothing — the state is not wrong, it just never says which part is partial. Naming the failing panels and the reason costs nothing and replaces it entirely.",
      "Nothing in the product does this today. Translation is currently a side effect of publishing, one dashboard at a time, with no run, no summary and no record — which is why a wave's translation has never been observable as a single event.",
    ],

    render(root, ctx) {
      cancelRun();
      const wave = selectedWave();

      if (!wave) {
        root.append(
          ctx.pageHeader([
            button("Export run log", { variant: "default", iconName: "download" }),
          ]),
          waveBoard(ctx)
        );
        return;
      }

      const mode = modeFor(wave);
      const run = T().runFor(wave.id);

      root.append(
        // No "All waves" button here any more. The shell renders the wave
        // scope picker into this same header, and its first option is All
        // waves, so a second control beside it that only ever does that one
        // thing was the header arguing with itself.
        ctx.pageHeader([
          button("Export run log", { variant: "default", iconName: "download", disabled: mode === "not-started" }),
          mode === "complete"
            ? button(`Wave ${wave.id} translated`, { variant: "emphasized", iconName: "check", disabled: true })
            : mode === "in-progress"
            ? button("Go to run", { variant: "emphasized", iconName: "play", onClick: () => DMA.store.setSession("trStep", "run") })
            : button("Not reachable", { variant: "default", iconName: "lock", disabled: true }),
        ]),
        el("div", { class: "dma-trwave" },
          el("span", { class: "dt-text-semibold" }, `Wave ${wave.id} — ${wave.name}`),
          badge(mode === "complete" ? "Translated" : mode === "in-progress" ? "Ready to run" : "Not reached",
                mode === "complete" ? "success" : mode === "in-progress" ? "info" : "neutral"),
          subdued(`${fmt.num(wave.assets)} assets · ${fmt.num(T().translatableIn(wave.id))} translatable · ${fmt.num(T().prerequisiteIn(wave.id))} prerequisite`)),
        stepper(),
        PANELS[step()](ctx, wave, mode)
      );
    },
  });
})();
