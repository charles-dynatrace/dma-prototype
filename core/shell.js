/* ============================================================================
   DMA.shell — app chrome + hash router.
   ----------------------------------------------------------------------------
   Owns: top bar, sidebar, phase pipeline, content mount point.
   Knows nothing about any individual module beyond the registry contract.
   ========================================================================== */

window.DMA = window.DMA || {};

DMA.shell = (function () {
  "use strict";

  const { el, icon, button, badge, fmt } = DMA.ui;
  let contentNode = null;
  let sidebarNode = null;
  let pipeNode = null;

  /* --- Routing ----------------------------------------------------------- */
  function currentId() {
    const id = (location.hash || "").replace(/^#\/?/, "").split("?")[0];
    return DMA.getModule(id) ? id : DMA.modules[0]?.id;
  }

  function navigate(id) {
    if (currentId() === id) return render();
    location.hash = `#/${id}`;
  }

  /* --- Top bar ----------------------------------------------------------- */
  function topbar() {
    const project = DMA.data.project;

    const themeBtn = button("", {
      variant: "subtle",
      iconName: DMA.store.prefs.theme === "dark" ? "sun" : "moon",
      title: DMA.store.prefs.theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
      onClick: () => DMA.store.set("theme", DMA.store.prefs.theme === "dark" ? "light" : "dark"),
    });

    const tierBtn = el(
      "button",
      {
        class: ["dt-btn", DMA.store.prefs.tierOverlay ? "dt-btn--emphasized" : "dt-btn--default", "dt-btn--sm"],
        onClick: () => DMA.store.toggle("tierOverlay"),
        title: "Overlay P0–P3 roadmap tiers on every screen",
        "aria-pressed": String(!!DMA.store.prefs.tierOverlay),
      },
      icon("layers", 13),
      "Roadmap tiers"
    );

    return el(
      "header",
      { class: "dma-topbar" },
      el("div", { class: "dma-topbar__brand" }, el("span", { class: "dma-topbar__logo" }, "DT"), "Migration Assistant"),
      el("span", { class: "dma-topbar__divider" }),
      el(
        "div",
        { class: "dma-topbar__project" },
        icon("database", 14),
        el("span", { class: "dt-text-medium", style: { color: "var(--dt-colors-text-primary-default)" } }, project.name),
        el("span", { class: "dt-text-small" }, project.subtitle)
      ),
      el("div", { class: "dt-grow" }),
      tierBtn,
      themeBtn,
      button("", { variant: "subtle", iconName: "helpCircle", title: "Help" }),
      button("", { variant: "subtle", iconName: "bell", title: "Notifications" })
    );
  }

  /* --- Sidebar ----------------------------------------------------------- */
  function sidebar() {
    const project = DMA.data.project;
    const active = currentId();

    const projectCard = el(
      "div",
      { class: "dma-sidebar__project dt-stack dt-gap-8" },
      el(
        "div",
        { class: "dt-row dt-gap-8" },
        el("div", { class: "dt-text-semibold dt-grow dt-truncate" }, project.name),
        badge(`Day ${project.daysElapsed}`, "primary")
      ),
      el("div", { class: "dt-text-small dt-text-subdued" }, `${fmt.num(project.assets.total)} assets · ${project.waves.length} waves`),
      DMA.ui.progress((project.daysElapsed / project.targetDays) * 100),
      el(
        "div",
        { class: "dt-text-small dt-text-subdued" },
        `Target go-live ${fmt.dateShort(project.targetGoLive)}`
      )
    );

    const nav = el("nav", { "aria-label": "Migration stages" });

    // Ungrouped modules first (Overview), then one group per flow phase.
    const ungrouped = DMA.modules.filter((m) => !m.phase);
    ungrouped.forEach((m) => nav.append(navItem(m, active)));

    for (const phase of DMA.PHASES) {
      const mods = DMA.modules.filter((m) => m.phase === phase.id);
      if (!mods.length) continue;
      nav.append(el("div", { class: "dma-sidebar__group-label" }, phase.label));
      mods.forEach((m) => nav.append(navItem(m, active)));
    }

    return el("aside", { class: "dma-sidebar" }, projectCard, nav);
  }

  /* Navigation only. Per-stage status deliberately stays out of here — the
     pipeline above carries progress, this carries destinations, and that
     division is the whole reason the two navs are not the same list twice. */
  function navItem(mod, active) {
    return el(
      "button",
      {
        class: "dma-navitem",
        "aria-current": mod.id === active ? "page" : null,
        onClick: () => navigate(mod.id),
      },
      icon(mod.icon || "info", 15),
      el("span", { class: "dma-navitem__label" }, mod.shortTitle || mod.title),
      mod.status === "stub" ? el("span", { class: "dt-text-small dt-text-subdued", title: "Not built yet" }, "–") : null
    );
  }

  /* --- Scope ------------------------------------------------------------- */
  /* The two navs used to carry the same thirteen stage names in two different
     shapes, which is the definition of a duplicate. They now answer different
     questions:

       sidebar   where can I go — every stage, by name, always in the same
                 order, never reordered by state
       pipeline  how far has the work got — five phases, each carrying a
                 completion fraction, recomputed against the wave in scope

     The scope <select> that used to sit in this bar has moved into the page
     header, because which wave you are looking at is a property of the stage
     in front of you, not of the app chrome. The pipeline still reads the
     selection — it has to, or the fractions are meaningless — but it reads it
     rather than owning it, and it names the wave it resolved to so the numbers
     can be checked against something. */

  function selectedWaveId() {
    return DMA.store.session.waveId || "all";
  }

  /* Both sides are coerced. `w.id` is a number and the scope <select> hands
     back a string, so the comparison only worked because every writer in the
     app remembered to call String() on the way in. A module that stored a
     number instead would not throw — the lookup would quietly miss, the rail
     would fall back to estate-level status, and the muting would vanish, while
     the module itself kept scoping correctly. That is the two navs disagreeing,
     which is the one thing the rail exists to prevent. Every module already
     compares String-to-String; this makes the shell match. */
  function selectedWave() {
    const id = selectedWaveId();
    if (id === "all") return null;
    return DMA.data.project.waves.find((w) => String(w.id) === String(id)) || null;
  }

  /* Rendered into the page header, not the chrome, and only where the choice
     is real. Estate- and sample-scoped stages used to show a static "Whole
     estate" / "Calibration sample" line here; it was a control-shaped thing
     that could not be operated, and the pipeline's subject label already says
     what the screen is working on. A control that never does anything is
     worse than no control. */
  function waveScopePicker(mod) {
    if (mod.scope !== "wave") return null;

    const project = DMA.data.project;
    const wave = selectedWave();

    const select = el("select", {
      class: "dma-scope__select",
      "aria-label": "Scope this stage to a single wave",
      onChange: (e) => DMA.store.setSession("waveId", e.target.value),
    });
    select.append(el("option", { value: "all" }, "All waves"));
    project.waves.forEach((w) => select.append(el("option", { value: String(w.id) }, `Wave ${w.id} — ${w.name}`)));
    select.value = selectedWaveId();

    return el(
      "div",
      { class: "dma-scope" },
      el("span", { class: "dma-scope__label" }, "Scope"),
      select,
      el(
        "span",
        { class: "dma-scope__detail" },
        `${fmt.num(wave ? wave.assets : project.assets.total)} assets`
      )
    );
  }

  /* --- Phase pipeline ---------------------------------------------------- */
  /* Where one stage sits. `wave` is the current selection, so a wave-scoped
     stage reports that wave's position and everything else reports the
     estate's. */
  function stageStatus(mod, wave) {
    if (wave && mod.scope === "wave") return DMA.data.waveStageStatus(wave, mod.id);
    return DMA.data.project.stages[mod.id]?.status || null;
  }

  /* The flow runs as one track until the first wave-scoped stage, then as one
     track per wave. Derived, not hard-coded, so re-ordering stages moves the
     fan-out automatically. */
  function fanOutStage() {
    return DMA.modules.find((m) => m.phase && m.scope === "wave") || null;
  }

  /* Three words, not four. `stageStatusTone` maps a "blocked" status and the
     pipeline briefly styled one, but nothing can produce it: every entry in
     `project.stages` is complete or in-progress, and `waveStageStatus` returns
     only complete / in-progress / not-started since its `blockedAt` branch was
     removed for having no honest referent. Styling a state the data cannot
     reach is the same mistake one layer up. If a genuine stage-level block
     ever lands, this map and a `--blocked` segment rule are where it goes. */
  const STATUS_WORD = {
    complete: "complete",
    "in-progress": "in progress",
    "not-started": "not started",
  };

  /* A fraction, not a tick. The first sketch of this bar gave each phase a
     tick / half / empty glyph, which against the real project renders five
     identical half-glyphs, because every phase is mid-flight at once — that is
     what a migration looks like. "Extract 3/4" differentiates where "Extract
     in progress" does not, and the segment meter beside it says which three.

     The denominator is every stage in the phase, including the estate-scoped
     ones, even when a wave is in scope. A wave does not personally pass
     through Import, but Import is a prerequisite it inherits, so counting it
     answers "how far along is the work this wave depends on" rather than the
     narrower "how far along is this wave's own leg". The tooltip spells the
     split out stage by stage so the number is never the whole claim. */
  function phaseChip(phase, { activePhase, wave }) {
    const mods = DMA.modules.filter((m) => m.phase === phase.id);
    const statuses = mods.map((m) => stageStatus(m, wave));
    const done = statuses.filter((s) => s === "complete").length;

    // Land on the work, not on the first stage. Going to a named stage is the
    // sidebar's job; a phase chip that always dropped you on a finished screen
    // would make the fraction next to it useless as a target.
    const target = mods.find((m, i) => statuses[i] !== "complete") || mods[0];

    const tip = [
      `${phase.label} — ${done} of ${mods.length} stages complete${wave ? ` for wave ${wave.id}` : ""}`,
      ...mods.map((m, i) => {
        const inherited = wave && m.scope !== "wave" ? " (ran once for the whole estate)" : "";
        return `  ${m.shortTitle || m.title} — ${STATUS_WORD[statuses[i]] || "not started"}${inherited}`;
      }),
      "",
      `Opens ${target.shortTitle || target.title}`,
    ].join("\n");

    return el(
      "button",
      {
        class: ["dma-pipe__phase", phase.id === activePhase ? "dma-pipe__phase--current" : null],
        "aria-current": phase.id === activePhase ? "step" : null,
        title: tip,
        onClick: () => navigate(target.id),
      },
      el("span", { class: "dma-pipe__label" }, phase.label),
      el(
        "span",
        { class: "dma-pipe__row" },
        el(
          "span",
          { class: "dma-pipe__meter" },
          statuses.map((s) => el("span", { class: ["dma-pipe__seg", `dma-pipe__seg--${s || "not-started"}`] }))
        ),
        el("span", { class: "dma-pipe__count" }, `${done}/${mods.length}`)
      )
    );
  }

  /* What the fractions are counting. The wave selection is global session
     state and the picker that sets it now only appears on wave-scoped stages,
     so without this label the pipeline would quietly report wave 3's position
     on a screen with nothing on it mentioning wave 3. It doubles as the way
     back out: clicking it clears the scope, which is the only exit from a
     wave once you have navigated to a stage that has no picker. */
  function pipeSubject(wave) {
    const project = DMA.data.project;
    const fan = fanOutStage();
    const fanName = fan ? fan.shortTitle || fan.title : "the first per-wave stage";

    if (!wave) {
      return el(
        "div",
        {
          class: "dma-pipe__subject",
          title: `Counting the whole estate. Waves run independently from ${fanName} onwards — scope to one on any per-wave stage to see that wave's own position.`,
        },
        icon("database", 13),
        el("span", { class: "dma-pipe__subject-text" }, "Whole estate"),
        el("span", { class: "dma-pipe__subject-detail" }, `${fmt.num(project.assets.total)} assets`)
      );
    }

    return el(
      "button",
      {
        class: ["dma-pipe__subject", "dma-pipe__subject--scoped"],
        title: `Counting wave ${wave.id}. Stages before ${fanName} ran once for the whole estate and count as done for every wave.\n\nClick to go back to the whole estate.`,
        onClick: () => DMA.store.setSession("waveId", "all"),
      },
      icon("gitBranch", 13),
      el("span", { class: "dma-pipe__subject-text" }, `Wave ${wave.id} — ${wave.name}`),
      el("span", { class: "dma-pipe__subject-detail" }, `${fmt.num(wave.assets)} assets`),
      icon("x", 12)
    );
  }

  function pipeline() {
    const mod = DMA.getModule(currentId());
    const wave = selectedWave();

    const track = el("div", { class: "dma-pipe__track", role: "navigation", "aria-label": "Migration phases" });
    DMA.PHASES.forEach((phase, index) => {
      if (!DMA.modules.some((m) => m.phase === phase.id)) return;
      if (index > 0) track.append(el("span", { class: "dma-pipe__sep" }, icon("chevronR", 13)));
      track.append(phaseChip(phase, { activePhase: mod.phase, wave }));
    });

    return el("div", { class: "dma-pipe" }, pipeSubject(wave), track);
  }

  /* --- Page header helper, available to every module --------------------- */
  /* The wave picker renders here rather than in each of the five wave-scoped
     modules. Same outcome — the control sits with the stage instead of in the
     chrome — but one implementation instead of five, in a function the shell
     already owns and every module already calls. Pushing it into the modules
     would have meant five chances to place it differently and five files to
     touch the next time it changes, in exchange for nothing. */
  function pageHeader(mod, actions) {
    const stage = DMA.data.project.stages[mod.id];
    const features = DMA.data.featuresFor(mod.id);
    const scope = waveScopePicker(mod);

    return el(
      "div",
      { class: "dt-stack dt-gap-12" },
      el(
        "div",
        { class: "dma-pagehead" },
        el(
          "div",
          { class: "dma-pagehead__main dt-stack dt-gap-6 dt-grow" },
          el(
            "div",
            { class: "dma-pagehead__title" },
            el("h2", {}, mod.title),
            stage ? badge(stage.status.replace("-", " "), DMA.data.stageStatusTone(stage.status), { dot: true }) : null
          ),
          mod.summary ? el("div", { class: "dt-text-secondary" }, mod.summary) : null
        ),
        /* The picker sits in the control row, not under the summary. Stacked
           in the left column it put the wave's name directly above whatever
           wave strip the module renders, so the name appeared twice in two
           lines and read as a restatement. Among the buttons it reads as what
           it is — and it lands where each module's own "All waves" button
           used to be, which is the control it replaced. */
        scope || actions
          ? el("div", { class: "dma-pagehead__controls dt-row dt-gap-8" }, scope, actions)
          : null
      ),
      features.length
        ? el(
            "div",
            { class: "dma-featurestrip" },
            features.map((f) =>
              el(
                "span",
                { class: "dma-featurepill", title: f.parked ? f.parkedWhy : f.what || "" },
                DMA.ui.tierChip(f.tier),
                f.name,
                f.proposed ? el("span", { class: "dma-featurepill__proposed" }, "Proposed") : null,
                f.parked ? el("span", { class: "dma-featurepill__parked" }, "Parked") : null
              )
            )
          )
        : null
    );
  }

  /* --- Mapping rule set, rendered on the two mapping stubs --------------- */
  function ruleSetBlock(ruleSetKey) {
    const rules = DMA.data.mapping[ruleSetKey];
    if (!rules) return null;
    const isGlobal = ruleSetKey === "globalRules";

    return el(
      "div",
      { class: "dt-stack dt-gap-8" },
      el(
        "div",
        { class: "dt-text-small dt-text-semibold dt-text-secondary" },
        isGlobal ? "Rules owned at this scope" : "Overrides available at this scope"
      ),
      el("div", { class: "dt-text-small dt-text-subdued" }, DMA.data.mapping.principle),
      el(
        "div",
        { class: "dt-stack dt-gap-8", style: { marginTop: "var(--dt-spacing-4)" } },
        rules.map((r) =>
          el(
            "div",
            {
              class: "dt-stack dt-gap-4",
              style: {
                padding: "var(--dt-spacing-12)",
                background: "var(--dt-colors-background-surface-default)",
                border: "1px solid var(--dt-colors-border-neutral-subdued)",
                borderRadius: "var(--dt-border-radius-container-default)",
              },
            },
            el("div", { class: "dt-text-medium" }, r.name),
            el("div", { class: "dt-text-small dt-text-secondary" }, r.detail),
            r.why ? el("div", { class: "dt-text-small dt-text-subdued" }, `Why global: ${r.why}`) : null
          )
        )
      )
    );
  }

  /* --- Stub screen for modules not yet built ----------------------------- */
  function stubScreen(mod) {
    const features = DMA.data.featuresFor(mod.id);
    const stage = DMA.data.project.stages[mod.id];

    return el(
      "div",
      { class: "dma-stub dt-stack dt-gap-16" },
      el("div", { class: "dt-row dt-gap-8" }, icon("clock", 18), el("h3", {}, "Not built yet")),
      el(
        "div",
        { class: "dt-text-secondary", style: { maxWidth: "70ch" } },
        `This screen is scheduled for a later phase. Everything it needs — tokens, components, navigation, and demo data — is already in place, so building it will not touch any other module.`
      ),
      stage ? el("div", { class: "dt-text-small dt-text-subdued" }, `Current demo state: ${stage.note}`) : null,

      mod.notes && mod.notes.length
        ? el(
            "div",
            { class: "dt-stack dt-gap-8" },
            el("div", { class: "dt-text-small dt-text-semibold dt-text-secondary" }, "Design decisions agreed in review"),
            el(
              "ul",
              { class: "dt-stack dt-gap-6", style: { margin: 0, paddingLeft: "18px" } },
              mod.notes.map((n) => el("li", { class: "dt-text-small dt-text-secondary" }, n))
            )
          )
        : null,

      mod.ruleSet ? ruleSetBlock(mod.ruleSet) : null,

      features.length
        ? el(
            "div",
            { class: "dt-stack dt-gap-8" },
            el("div", { class: "dt-text-small dt-text-semibold dt-text-secondary" }, "Roadmap features this screen will carry"),
            el(
              "ul",
              { class: "dt-stack dt-gap-6", style: { margin: 0, paddingLeft: "18px" } },
              features.map((f) =>
                el(
                  "li",
                  {},
                  el("span", { class: "dt-text-medium" }, f.name),
                  " ",
                  el("span", { class: "dt-badge dt-badge--neutral" }, DMA.data.TIER_LABELS[f.tier]),
                  f.proposed ? " " : null,
                  f.proposed ? el("span", { class: "dt-badge dt-badge--warning" }, "Proposed — not in approved roadmap") : null,
                  f.parked ? " " : null,
                  f.parked ? el("span", { class: "dt-badge dt-badge--neutral" }, "Parked — deferred out of this prototype") : null,
                  f.what ? el("div", { class: "dt-text-small dt-text-subdued" }, f.what) : null,
                  f.parked && f.parkedWhy ? el("div", { class: "dt-text-small dt-text-subdued" }, f.parkedWhy) : null
                )
              )
            )
          )
        : null
    );
  }

  /* --- Render ------------------------------------------------------------ */
  function render() {
    const id = currentId();
    const mod = DMA.getModule(id);
    if (!mod) return;

    document.title = `${mod.title} · DMA — Migration Assistant`;

    // Chrome
    const app = document.getElementById("app");
    DMA.ui.clear(app);

    sidebarNode = sidebar();
    pipeNode = pipeline();
    contentNode = el("div", { class: "dma-content" });

    app.append(
      el(
        "div",
        { class: "dma-app" },
        topbar(),
        el("div", { class: "dma-body" }, sidebarNode, el("main", { class: "dma-main" }, pipeNode, contentNode))
      )
    );

    // Module body
    const ctx = { navigate, pageHeader: (actions) => pageHeader(mod, actions), module: mod };
    if (mod.status === "stub") {
      contentNode.append(pageHeader(mod), stubScreen(mod));
    } else {
      mod.render(contentNode, ctx);
    }

    contentNode.parentElement.scrollTop = 0;
  }

  /* --- Boot -------------------------------------------------------------- */
  function applyPrefs() {
    document.documentElement.setAttribute("data-theme", DMA.store.prefs.theme);
    document.documentElement.setAttribute("data-tier-overlay", DMA.store.prefs.tierOverlay ? "on" : "off");
  }

  function boot() {
    applyPrefs();
    DMA.store.subscribe(() => {
      applyPrefs();
      render();
    });
    window.addEventListener("hashchange", render);
    if (!location.hash) location.hash = `#/${DMA.modules[0].id}`;
    render();
  }

  return { boot, navigate, render };
})();

document.addEventListener("DOMContentLoaded", () => DMA.shell.boot());
