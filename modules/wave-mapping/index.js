/* ============================================================================
   MODULE: Wave Map Configurations
   ----------------------------------------------------------------------------
   Flow-diagram stage: Extract → Wave Map Configurations
   Sits AFTER Prioritize & Plan, once waves exist as delivery units.

   The stage is named for waves. Almost nothing in it binds to one.

   A wave is a mutable delivery container the EPM re-groups whenever the plan
   changes; an application is a stable semantic grouping that survives every
   re-plan. So the wave is the LENS, the application is the UNIT OF DECISION,
   and the asset is the EXCEPTION. The Wave 4–6 re-plan on Oct 13 moved six
   applications between waves and orphaned nothing, which is the whole argument
   made as an event rather than an opinion.

   The one genuine exception is lookup delivery, where the answer really is a
   wave number — a lookup must publish with or before the first wave that reads
   it. Step 4 exists because that exception is real, and stating it is what
   makes the rule credible everywhere else.

   Where Global Mapping's argument was RESOLUTION (one stored value, 1,236
   objects computed from it), this stage's argument is INHERITANCE — and the
   counting has to keep two populations apart to make it. 38 token slots are
   inputs the confirmed template DEMANDS, of which 32 are supplied and 6 are
   outstanding. 57 further fields an application MAY override, of which it
   declines 34 and changes 23. Pooling the two gives "36% inherited", which
   reads as a configuration sprawl that is not happening.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, stackedProgress, emptyState, fmt } = DMA.ui;

  const STEPS = [
    { id: "inherited",  label: "Inheritance" },
    { id: "overrides",  label: "Application overrides" },
    { id: "exceptions", label: "Asset exceptions" },
    { id: "delivery",   label: "Lookup delivery" },
    { id: "gate",       label: "Readiness gate" },
  ];

  /* Provenance vocabulary. The screen says "where did this value come from"
     roughly forty times, so it says it the same way every time. */
  const SRC = {
    application: { label: "Set on application", short: "Application", tone: "primary",  icon: "edit" },
    project:     { label: "Inherited from project", short: "Project", tone: "neutral",  icon: "arrowRight" },
    asset:       { label: "Asset exception", short: "Asset",          tone: "warning",  icon: "flag" },
    translator:  { label: "Translator built-in", short: "Translator", tone: "neutral",  icon: "zap" },
  };
  const OUTSTANDING = { label: "No value — outstanding", short: "Outstanding", tone: "critical", icon: "helpCircle" };

  const wrap = { whiteSpace: "normal" };

  const W = () => DMA.data.waveMapping;

  /* ---------------------------------------------------------------------- */
  /* Session + scope                                                         */
  /* ---------------------------------------------------------------------- */

  function currentStep() {
    const id = DMA.store.session.waveMapStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  /* The wave comes from the shell's scope selector, not from a control this
     module owns — Wave Mapping is the fan-out point, so the selector that
     appears here is the same one every later stage uses. */
  function waveId() {
    return DMA.store.session.waveId || "all";
  }

  function allWaves() {
    return waveId() === "all";
  }

  function scopeApps() {
    return W().appsInWave(waveId());
  }

  function scopeLabel() {
    if (allWaves()) return "the whole estate";
    const w = DMA.data.project.waves.find((x) => String(x.id) === waveId());
    return w ? `Wave ${w.id} — ${w.name}` : `Wave ${waveId()}`;
  }

  function openApp(id) {
    DMA.store.setSession("waveMapApp", id);
  }

  function currentApp() {
    const id = DMA.store.session.waveMapApp;
    return scopeApps().some((a) => a.id === id) ? id : null;
  }

  function appName(id) {
    const a = DMA.data.planning.applications.find((x) => x.id === id);
    return a ? a.name : id;
  }

  function appAssets(id) {
    const a = DMA.data.planning.applications.find((x) => x.id === id);
    return a ? a.assets : 0;
  }

  function waveOf(appId) {
    return W().waveOfApp()[appId];
  }

  /* Duplicated per module on purpose — the isolation rule forbids reaching
     into another module for a ten-line helper. */
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

  function stepper() {
    const active = currentStep();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Wave mapping steps" });

    STEPS.forEach((step, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(step.id === active),
            onClick: () => {
              DMA.store.session.waveMapApp = null;
              DMA.store.setSession("waveMapStep", step.id);
            },
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, step.label)
        )
      );
    });

    return row;
  }

  /* A resolved value plus its provenance, in one cell. */
  function valueCell(r, opts = {}) {
    const meta = r.outstanding ? OUTSTANDING : SRC[r.source] || OUTSTANDING;
    return el(
      "div",
      { class: "dt-stack dt-gap-4" },
      el(
        "span",
        { class: ["dma-wm__val", r.outstanding ? "dma-wm__val--none" : null], style: wrap },
        r.outstanding ? "—" : String(r.value)
      ),
      opts.quiet
        ? null
        : el("span", { class: `dt-text-small dt-text-${meta.tone === "neutral" ? "subdued" : meta.tone}` }, meta.short)
    );
  }

  function srcDot(r) {
    const meta = r.outstanding ? OUTSTANDING : SRC[r.source] || OUTSTANDING;
    return el("span", { class: "dma-wm__dot", dataset: { tone: meta.tone }, title: meta.label });
  }

  /* ======================================================================== */
  /* Step 1 — Inheritance                                                     */
  /* ======================================================================== */

  function inheritedKpis() {
    const apps = scopeApps();
    const ids = apps.map((a) => a.id);
    const t = W().tally(ids);
    const assets = apps.reduce((n, a) => n + a.assets, 0);

    /* Two populations, counted separately on purpose. Pooling them yields the
       misleading "36% inherited" — true of the combined set, and true only
       because every application is REQUIRED to supply two token values. A
       required input and a declined override are not the same event. */
    const tokenFields = W().fields.filter((f) => f.kind === "token").length;
    const slots = { token: apps.length * tokenFields, optional: apps.length * (W().fields.length - tokenFields) };

    return el(
      "div",
      { class: "dt-grid dt-grid-4 dt-gap-16" },
      kpi("Assets in scope", fmt.num(assets), `${apps.length} application${apps.length === 1 ? "" : "s"} · ${scopeLabel()}`, { iconName: "layers" }),
      kpi("Token values supplied", `${t.tokens} / ${slots.token}`, "Inputs the confirmed naming template demands. There is no default to fall back on.", {
        iconName: "edit",
        tone: t.outstanding ? "warning" : "success",
        bar: stackedProgress([
          { value: (t.tokens / slots.token) * 100, tone: "success", label: "Supplied" },
          { value: (t.outstanding / slots.token) * 100, tone: "critical", label: "Outstanding" },
        ]),
      }),
      kpi("Inherited", `${t.inherited} / ${slots.optional}`, `${fmt.pct((t.inherited / slots.optional) * 100)} of the fields an application may override, it does not. ${t.overrides} deliberate deviations.`, {
        iconName: "arrowRight",
        tone: "success",
        bar: stackedProgress([
          { value: (t.inherited / slots.optional) * 100, tone: "success", label: "Inherited from project" },
          { value: (t.overrides / slots.optional) * 100, tone: "warning", label: "Overridden" },
        ]),
      }),
      kpi("Outstanding", fmt.num(t.outstanding), t.outstanding ? outstandingWaves(ids) : "Every token the template demands has a value", {
        iconName: t.outstanding ? "helpCircle" : "checkCircle",
        tone: t.outstanding ? "critical" : "success",
      })
    );
  }

  /* Which waves the outstanding tokens actually hold up — "6 outstanding" is
     only actionable once it names the waves it blocks. */
  function outstandingWaves(ids) {
    const waves = new Set();
    ids.forEach((id) =>
      W()
        .fields.filter((f) => f.kind === "token")
        .forEach((f) => {
          if (W().resolve(id, f.id).outstanding) waves.add(waveOf(id));
        })
    );
    const list = [...waves].sort((a, b) => a - b);
    return `Blocks ${list.length === 1 ? "Wave" : "Waves"} ${list.join(" and ")} from translating`;
  }

  function stepInherited() {
    const apps = scopeApps();

    return el(
      "div",
      { class: "dt-stack dt-gap-20" },

      inheritedKpis(),

      banner(
        "info",
        "A wave is a delivery container the EPM re-groups whenever the plan changes; an application is a stable semantic grouping that survives every re-plan. Binding a mapping decision to a wave would orphan it on the next re-plan — so every value below is stored against an application, and the wave is only the lens you are reading it through. The one exception is lookup delivery, in step 4.",
        { title: "Nothing on this screen binds to a wave" }
      ),

      card(
        {
          title: "Resolution matrix",
          subtitle: `Five fields × ${apps.length} application${apps.length === 1 ? "" : "s"}. The value is what the asset will carry; the colour is which layer put it there.`,
          actions: legend(),
          flush: true,
        },
        matrix(apps)
      ),

      rePlanPanel()
    );
  }

  function legend() {
    const items = [
      ["neutral", "Inherited"],
      ["primary", "Application"],
      ["critical", "Outstanding"],
    ];
    return el(
      "div",
      { class: "dt-row dt-gap-12 dt-wrap" },
      items.map(([tone, label]) =>
        el(
          "span",
          { class: "dt-row dt-gap-4 dt-text-small dt-text-subdued" },
          el("span", { class: "dma-wm__dot", dataset: { tone } }),
          label
        )
      )
    );
  }

  function matrix(apps) {
    const fields = W().fields;
    const cols = [
      {
        label: "Application",
        width: "20%",
        render: (a) =>
          el(
            "div",
            { class: "dt-stack dt-gap-4" },
            el("span", { class: "dt-text-medium", style: wrap }, a.name),
            el("span", { class: "dt-text-small dt-text-subdued" }, `${fmt.num(a.assets)} assets · Wave ${waveOf(a.id)}`)
          ),
      },
    ].concat(
      fields.map((f) => ({
        label: f.label,
        width: "16%",
        render: (a) => {
          const r = W().resolve(a.id, f.id);
          return el("div", { class: "dt-row dt-gap-6 dt-row-top" }, srcDot(r), valueCell(r, { quiet: true }));
        },
      }))
    );

    return table(cols, apps, { onRowClick: (a) => { DMA.store.session.waveMapApp = a.id; DMA.store.setSession("waveMapStep", "overrides"); } });
  }

  function rePlanPanel() {
    const rows = W().rePlanCost();
    const orphaned = rows.reduce((n, r) => n + r.entries, 0);
    const rp = W().rePlan;

    return card(
      {
        title: "What binding to the application bought",
        subtitle: `The Wave 4–6 re-plan, ${fmt.date(rp.at)} — recorded rather than argued.`,
      },
      el(
        "div",
        { class: "dt-stack dt-gap-16" },
        el("p", { class: "dt-text-small dt-text-secondary", style: wrap }, rp.why),
        table(
          [
            { label: "Application", width: "34%", render: (r) => el("span", { class: "dt-text-medium", style: wrap }, r.name) },
            { label: "Moved", width: "22%", render: (r) => el("span", { class: "dt-row dt-gap-6" }, badge(`Wave ${r.from}`, "neutral"), icon("arrowRight", 12), badge(`Wave ${r.to}`, "info")) },
            { label: "Assets", width: "14%", render: (r) => el("span", { class: "dt-tnum" }, fmt.num(r.assets)) },
            {
              label: "Mapping entries carried",
              render: (r) =>
                r.entries
                  ? el("span", { class: "dt-row dt-gap-6" }, badge(`${r.entries} survived`, "success", { iconName: "check" }))
                  : el("span", { class: "dt-text-small dt-text-subdued" }, "None set"),
            },
          ],
          rows
        ),
        banner(
          "success",
          `Six applications changed wave and ${orphaned} mapping entries moved with them, because each one is stored against the application. Had the same values been stored against the wave — which is what the stage name implies and what the live product's grouping suggests — all ${orphaned} would have been orphaned on Oct 13, and the only way to notice would have been a published asset with the wrong name.`,
          { title: `${orphaned} entries survived the re-plan` }
        )
      )
    );
  }

  /* ======================================================================== */
  /* Step 2 — Application overrides                                           */
  /* ======================================================================== */

  function stepOverrides() {
    const open = currentApp();
    return open ? appDetail(open) : appList();
  }

  function appList() {
    const apps = scopeApps();
    const fields = W().fields;

    /* Per-field roll-up: how uneven the decision surface actually is. */
    const byField = fields.map((f) => {
      let set = 0;
      let outstanding = 0;
      let reach = 0;
      apps.forEach((a) => {
        const r = W().resolve(a.id, f.id);
        if (r.outstanding) outstanding++;
        else if (r.source === "application") {
          set++;
          reach += a.assets;
        }
      });
      return { f, set, outstanding, reach, inherited: apps.length - set - outstanding };
    });

    return el(
      "div",
      { class: "dt-stack dt-gap-20" },

      card(
        {
          title: "By field",
          subtitle: "What the project already settles, and what each application still has to say for itself.",
        },
        table(
          [
            {
              label: "Field",
              width: "26%",
              render: (r) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-medium", style: wrap }, r.f.label),
                  badge(r.f.kind === "token" ? "Token — required" : "Override — optional", r.f.kind === "token" ? "info" : "neutral")
                ),
            },
            {
              label: "Project default",
              width: "20%",
              render: (r) =>
                W().project[r.f.id]
                  ? el("span", { class: "dt-code" }, String(W().project[r.f.id]))
                  : el("span", { class: "dt-text-small dt-text-subdued", style: wrap }, "None — the template demands a value"),
            },
            { label: "Inherited", width: "10%", render: (r) => el("span", { class: "dt-tnum dt-text-subdued" }, String(r.inherited)) },
            { label: "Set here", width: "10%", render: (r) => (r.set ? badge(String(r.set), "primary") : el("span", { class: "dt-text-subdued" }, "0")) },
            { label: "Outstanding", width: "12%", render: (r) => (r.outstanding ? badge(String(r.outstanding), "critical") : el("span", { class: "dt-text-subdued" }, "0")) },
            {
              label: "Assets reached by the overrides",
              render: (r) => el("span", { class: "dt-tnum dt-text-small dt-text-secondary" }, r.reach ? fmt.num(r.reach) : "—"),
            },
          ],
          byField
        )
      ),

      card(
        {
          title: "By application",
          subtitle: `${apps.length} application${apps.length === 1 ? "" : "s"} in ${scopeLabel()}. Open one to see the full cascade and what its assets will be called.`,
          flush: true,
        },
        table(
          [
            {
              label: "Application",
              width: "26%",
              render: (a) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-medium", style: wrap }, a.name),
                  el("span", { class: "dt-text-small dt-text-subdued" }, `${fmt.num(a.assets)} assets · Wave ${waveOf(a.id)}`)
                ),
            },
            {
              label: "Published name",
              width: "34%",
              render: (a) => {
                const p = W().previewName(a.id, "Daily Volume");
                return el("span", { class: ["dt-code", p.complete ? null : "dma-wm__val--none"], style: wrap }, p.text);
              },
            },
            {
              label: "Set here",
              width: "16%",
              render: (a) => {
                const t = W().tally([a.id]);
                return el(
                  "div",
                  { class: "dt-row dt-gap-6 dt-wrap" },
                  t.tokens ? badge(`${t.tokens} token`, "info") : null,
                  t.overrides ? badge(`${t.overrides} override`, "primary") : null,
                  !t.tokens && !t.overrides ? el("span", { class: "dt-text-small dt-text-subdued" }, "Fully inherited") : null
                );
              },
            },
            {
              label: "Outstanding",
              width: "14%",
              render: (a) => {
                const t = W().tally([a.id]);
                return t.outstanding
                  ? badge(`${t.outstanding} missing`, "critical", { iconName: "helpCircle" })
                  : badge("Complete", "success", { iconName: "check" });
              },
            },
            { label: "", width: "10%", render: () => icon("chevronR", 14) },
          ],
          apps,
          { onRowClick: (a) => openApp(a.id) }
        )
      )
    );
  }

  function appDetail(appId) {
    const rows = W().resolveAll(appId);
    const assets = appAssets(appId);
    const wave = waveOf(appId);
    const exceptions = W().assetExceptions.filter((e) => e.app === appId);
    const preview = W().previewName(appId, "Daily Volume");

    return el(
      "div",
      { class: "dt-stack dt-gap-20" },

      el(
        "div",
        { class: "dt-row dt-gap-12" },
        button("All applications", { variant: "subtle", iconName: "chevronL", onClick: () => openApp(null) }),
        el("span", { class: "dt-text-medium" }, appName(appId)),
        badge(`Wave ${wave}`, "info"),
        badge(`${fmt.num(assets)} assets`, "neutral")
      ),

      card(
        {
          title: "Cascade",
          subtitle: "translator → project → application → asset. Most specific wins, and the winner is always named.",
        },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          rows.map((r) => cascadeRow(appId, r))
        )
      ),

      card(
        { title: "What this resolves to", subtitle: "The naming tokens are two text boxes. This is what they do." },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          el("div", { class: "dt-text-small dt-text-subdued" }, "Source asset"),
          el("div", { class: "dt-code" }, "Daily Volume"),
          el("div", { class: "dt-text-small dt-text-subdued" }, "Published as"),
          el("div", { class: ["dt-code", preview.complete ? null : "dma-wm__val--none"] }, preview.text),
          preview.complete
            ? null
            : banner("critical", "An unfilled token publishes literally. Every asset in this application would carry a brace in its name, and the collision the team token was added to prevent comes back.", { title: "Outstanding token" })
        )
      ),

      exceptions.length
        ? card(
            { title: `${exceptions.length} asset exception${exceptions.length === 1 ? "" : "s"} in this application`, subtitle: "Shown here because the asset, its application value and its wave are only comparable together." },
            table(
              [
                { label: "Asset", width: "30%", render: (e) => el("span", { class: "dt-text-medium", style: wrap }, e.asset) },
                { label: "Field", width: "18%", render: (e) => el("span", {}, W().fields.find((f) => f.id === e.field).label) },
                {
                  label: "Application → asset",
                  render: (e) => {
                    const inh = W().resolve(appId, e.field);
                    return el(
                      "div",
                      { class: "dt-row dt-gap-6 dt-wrap" },
                      el("span", { class: "dt-code dma-wm__val--none", style: wrap }, inh.outstanding ? "—" : String(inh.value)),
                      icon("arrowRight", 12),
                      el("span", { class: "dt-code", style: wrap }, e.v)
                    );
                  },
                },
              ],
              exceptions
            )
          )
        : null
    );
  }

  function cascadeRow(appId, r) {
    const f = r.field;
    const layers = [
      { id: "project", value: W().project[f.id] },
      { id: "application", value: (W().applications[appId] || {})[f.id] ? (W().applications[appId] || {})[f.id].v : undefined },
    ];

    return el(
      "div",
      { class: "dma-wm__field" },
      el(
        "div",
        { class: "dt-row dt-gap-12 dt-row-top" },
        el(
          "div",
          { class: "dt-stack dt-gap-4", style: { minWidth: "180px" } },
          el("span", { class: "dt-text-medium", style: wrap }, f.label),
          badge(f.kind === "token" ? "Token" : "Override", f.kind === "token" ? "info" : "neutral")
        ),
        el(
          "div",
          { class: "dt-stack dt-gap-8 dt-grow" },
          el(
            "div",
            { class: "dt-row dt-gap-8 dt-wrap" },
            layers.map((l) =>
              el(
                "span",
                { class: ["dma-wm__layer", r.source === l.id ? "dma-wm__layer--wins" : null] },
                el("span", { class: "dt-text-small dt-text-subdued" }, SRC[l.id].short),
                el("span", { class: "dt-code", style: wrap }, l.value === undefined || l.value === null ? "—" : String(l.value)),
                r.source === l.id ? icon("check", 12) : null
              )
            ),
            r.outstanding ? el("span", { class: "dma-wm__layer dma-wm__layer--none" }, icon("helpCircle", 12), "No value at any layer") : null
          ),
          r.entry && r.entry.why ? el("p", { class: "dt-text-small dt-text-secondary", style: wrap }, `“${r.entry.why}”`) : null,
          r.entry
            ? el("span", { class: "dt-text-small dt-text-subdued" }, `${r.entry.by} · ${fmt.date(r.entry.at)}`)
            : el("p", { class: "dt-text-small dt-text-subdued", style: wrap }, f.kind === "token" ? f.note : W().projectBasis[f.id] || f.note),
          f.ceiling && r.source === "application"
            ? el("span", { class: "dt-text-small dt-text-subdued" }, `Global ceiling ${f.ceiling} — an application may move inside it, never through it.`)
            : null
        )
      )
    );
  }

  /* ======================================================================== */
  /* Step 3 — Asset exceptions                                                */
  /* ======================================================================== */

  function stepExceptions() {
    const ids = scopeApps().map((a) => a.id);
    const rows = W().assetExceptions.filter((e) => ids.includes(e.app));
    const estate = DMA.data.project.assets.total;
    const debt = W().debt().filter((g) => ids.includes(g.app));

    return el(
      "div",
      { class: "dt-stack dt-gap-20" },

      el(
        "div",
        { class: "dt-grid dt-grid-3 dt-gap-16" },
        kpi("Asset exceptions", fmt.num(rows.length), `${fmt.pct((W().assetExceptions.length / estate) * 100, 1)} of ${fmt.num(estate)} assets estate-wide`, { iconName: "flag" }),
        kpi("Applications affected", String(new Set(rows.map((e) => e.app)).size), "An exception is scoped to one asset and never spreads", { iconName: "layers" }),
        kpi("Repeating", String(debt.reduce((n, g) => n + g.items.length, 0)), debt.length ? "Same application, same field, same value — see below" : "No exception is stated more than twice", {
          iconName: debt.length ? "alert" : "checkCircle",
          tone: debt.length ? "warning" : "success",
        })
      ),

      banner(
        "info",
        "Global + Per-Asset Overrides was dropped from the roadmap for being unbounded — an override surface on every asset with nothing above it. It comes back here counted rather than uncapped: the application layer carries the rule, the asset layer carries the handful of genuine exceptions, and a repeating exception is treated as a missing application rule rather than a feature.",
        { title: "Bounded on purpose" }
      ),

      debt.length ? debtPanel(debt) : null,

      card(
        { title: "Exceptions", subtitle: "The asset, the value it would have inherited, and the value it carries instead — together, because none of the three means anything alone.", flush: true },
        rows.length
          ? table(
              [
                {
                  label: "Asset",
                  width: "24%",
                  render: (e) =>
                    el(
                      "div",
                      { class: "dt-stack dt-gap-4" },
                      el("span", { class: "dt-text-medium", style: wrap }, e.asset),
                      el("span", { class: "dt-text-small dt-text-subdued" }, e.type)
                    ),
                },
                {
                  label: "Application",
                  width: "16%",
                  render: (e) =>
                    el(
                      "div",
                      { class: "dt-stack dt-gap-4" },
                      el("span", { style: wrap }, appName(e.app)),
                      badge(`Wave ${waveOf(e.app)}`, "neutral")
                    ),
                },
                { label: "Field", width: "14%", render: (e) => el("span", { style: wrap }, W().fields.find((f) => f.id === e.field).label) },
                {
                  label: "Inherited → asset",
                  width: "26%",
                  render: (e) => {
                    const inh = W().resolve(e.app, e.field);
                    return el(
                      "div",
                      { class: "dt-stack dt-gap-4" },
                      el("span", { class: "dt-code dma-wm__val--none", style: wrap }, inh.outstanding ? "—" : String(inh.value)),
                      el("span", { class: "dt-code", style: wrap }, e.v)
                    );
                  },
                },
                { label: "Why", render: (e) => el("span", { class: "dt-text-small dt-text-secondary", style: wrap }, e.why) },
              ],
              rows
            )
          : emptyState("checkCircle", "No asset exceptions in this wave", "Every asset here takes its application's value unchanged.")
      )
    );
  }

  function debtPanel(debt) {
    return card(
      { title: "Repeating exceptions", subtitle: "Three assets saying the same thing about the same application is not three decisions." },
      el(
        "div",
        { class: "dt-stack dt-gap-16" },
        debt.map((g) => {
          const f = W().fields.find((x) => x.id === g.field);
          const inh = W().resolve(g.app, g.field);
          return el(
            "div",
            { class: "dma-wm__debt" },
            el(
              "div",
              { class: "dt-stack dt-gap-8" },
              el(
                "div",
                { class: "dt-row dt-gap-8 dt-wrap" },
                badge(`${g.items.length} assets`, "warning", { iconName: "alert" }),
                el("span", { class: "dt-text-medium", style: wrap }, `${appName(g.app)} · ${f.label}`)
              ),
              el(
                "p",
                { class: "dt-text-small dt-text-secondary", style: wrap },
                `All ${g.items.length} override ${inh.outstanding ? "nothing" : `“${inh.value}”`} to “${g.v}” for the same reason. The application rule is what is missing; each exception is a workaround for its absence, and every asset added to this application from here on will need a fourth.`
              ),
              el("div", { class: "dt-row dt-gap-8 dt-wrap" }, g.items.map((i) => badge(i.asset, "neutral"))),
              el(
                "div",
                { class: "dt-row dt-gap-8" },
                button(`Promote to the ${appName(g.app)} rule`, { variant: "emphasized", size: "sm", iconName: "arrowRight" }),
                button("Keep as exceptions", { variant: "subtle", size: "sm" })
              )
            )
          );
        })
      )
    );
  }

  /* ======================================================================== */
  /* Step 4 — Lookup delivery                                                 */
  /* ======================================================================== */

  function stepDelivery() {
    const states = W().lookupStates();
    const late = states.filter((s) => s.late);
    const totals = W().lookupTotals;

    return el(
      "div",
      { class: "dt-stack dt-gap-20" },

      banner(
        late.length ? "critical" : "success",
        "Every other rule on this stage binds to an application. This one does not, and it is the reason the distinction is worth stating: a lookup's answer is a wave number. Publish it after the first wave that reads it and that wave ships a dangling reference — the DQL resolves, returns nothing, and looks like an empty dashboard rather than a missing table.",
        { title: "The one rule a wave genuinely owns" }
      ),

      el(
        "div",
        { class: "dt-grid dt-grid-3 dt-gap-16" },
        kpi("Cross-wave lookups", String(states.length), `${fmt.num(totals.singleWave)} of ${fmt.num(totals.estate)} are read by one wave only and schedule themselves`, { iconName: "database" }),
        kpi("Scheduled correctly", String(states.length - late.length), "Published with or before the first wave that reads them", { iconName: "checkCircle", tone: "success" }),
        kpi("Late", String(late.length), late.length ? "Would publish after a wave that already needs them" : "None", {
          iconName: late.length ? "alert" : "check",
          tone: late.length ? "critical" : "success",
        })
      ),

      late.length
        ? card(
            { title: "Delivered too late", subtitle: "Caught by the ordering check, not by a reviewer reading 241 lookups." },
            el(
              "div",
              { class: "dt-stack dt-gap-16" },
              late.map((s) =>
                el(
                  "div",
                  { class: "dma-wm__late" },
                  el(
                    "div",
                    { class: "dt-stack dt-gap-8" },
                    el(
                      "div",
                      { class: "dt-row dt-gap-8 dt-wrap" },
                      el("span", { class: "dt-code" }, s.name),
                      badge(`${s.slip} wave${s.slip === 1 ? "" : "s"} late`, "critical", { iconName: "alert" })
                    ),
                    el(
                      "p",
                      { class: "dt-text-small dt-text-secondary", style: wrap },
                      `Scheduled for Wave ${s.deliverWave}, but ${s.blocks.map((b) => `${appName(b.app)} (Wave ${b.wave})`).join(" and ")} read${s.blocks.length === 1 ? "s" : ""} it first. ${fmt.num(s.blocks.reduce((n, b) => n + appAssets(b.app), 0))} assets would publish against a table that does not exist yet.`
                    ),
                    el(
                      "div",
                      { class: "dt-row dt-gap-8" },
                      button(`Pull forward to Wave ${s.firstNeed}`, { variant: "emphasized", size: "sm", iconName: "arrowRight" }),
                      button("Move the referencing assets instead", { variant: "subtle", size: "sm" })
                    )
                  )
                )
              )
            )
          )
        : null,

      card(
        { title: "Delivery schedule", subtitle: "Which wave publishes each shared lookup, against the first wave that reads it.", flush: true },
        table(
          [
            { label: "Lookup", width: "22%", render: (s) => el("div", { class: "dt-stack dt-gap-4" }, el("span", { class: "dt-code" }, s.name), el("span", { class: "dt-text-small dt-text-subdued" }, `${fmt.num(s.rows)} rows`)) },
            {
              label: "Read by",
              width: "34%",
              render: (s) => el("div", { class: "dt-row dt-gap-6 dt-wrap" }, s.needs.map((n) => badge(`${appName(n.app)} · W${n.wave}`, n.wave < s.deliverWave ? "critical" : "neutral"))),
            },
            { label: "First needed", width: "14%", render: (s) => badge(`Wave ${s.firstNeed}`, "info") },
            { label: "Delivers", width: "14%", render: (s) => badge(`Wave ${s.deliverWave}`, s.late ? "critical" : "success") },
            {
              label: "Status",
              render: (s) => (s.late ? badge("Late", "critical", { iconName: "alert" }) : badge("In time", "success", { iconName: "check" })),
            },
          ],
          states
        )
      )
    );
  }

  /* ======================================================================== */
  /* Step 5 — Readiness gate                                                  */
  /* ======================================================================== */

  function stepGate() {
    const waves = allWaves() ? DMA.data.project.waves.map((w) => w.id) : [Number(waveId())];
    const gates = waves.map((id) => W().gate(id));
    const clear = gates.filter((g) => g.clear).length;

    return el(
      "div",
      { class: "dt-stack dt-gap-20" },

      banner(
        "info",
        "Global Mapping confirms the rule set once, for the estate. This is not a second signature on the same thing — it asks only whether this wave's applications have supplied every input those rules demand, and whether anything it reads publishes after it. The answer is computed from the same data the rest of this stage reads, so a green gate and an outstanding token cannot coexist.",
        { title: "A gate, not a second sign-off" }
      ),

      el(
        "div",
        { class: "dt-stack dt-gap-16" },
        gates.map((g) => gateCard(g))
      ),

      allWaves()
        ? banner(
            clear === gates.length ? "success" : "warning",
            `${clear} of ${gates.length} waves can translate now. The rest are waiting on a named input, not on judgement — every blocked item below says which application and which field.`,
            { title: "Across all waves" }
          )
        : null
    );
  }

  function gateCard(g) {
    const w = DMA.data.project.waves.find((x) => x.id === Number(g.waveId));
    const name = w ? `Wave ${w.id} — ${w.name}` : `Wave ${g.waveId}`;
    const assets = g.apps.reduce((n, id) => n + appAssets(id), 0);

    return el(
      "div",
      { class: ["dma-wm__gate", g.clear ? "dma-wm__gate--clear" : "dma-wm__gate--blocked"] },
      el(
        "div",
        { class: "dt-stack dt-gap-12" },
        el(
          "div",
          { class: "dt-row dt-gap-12 dt-wrap" },
          icon(g.clear ? "checkCircle" : "alert", 18),
          el("span", { class: "dt-text-medium dt-grow", style: wrap }, name),
          badge(`${g.apps.length} apps · ${fmt.num(assets)} assets`, "neutral"),
          g.clear ? badge("Ready to translate", "success") : badge(`${g.missing.length + g.lateLookups.length} blocking`, "critical")
        ),

        g.missing.length
          ? el(
              "div",
              { class: "dt-stack dt-gap-6" },
              el("span", { class: "dt-text-small dt-text-subdued" }, "Outstanding token values"),
              g.missing.map((m) =>
                el(
                  "div",
                  { class: "dt-row dt-gap-8 dt-wrap" },
                  badge(appName(m.app), "critical", { iconName: "helpCircle" }),
                  el("span", { class: "dt-text-small", style: wrap }, `${W().fields.find((f) => f.id === m.field).label} has no value at any layer`),
                  button("Set it", { variant: "subtle", size: "sm", onClick: () => { DMA.store.session.waveMapApp = m.app; DMA.store.setSession("waveMapStep", "overrides"); } })
                )
              )
            )
          : null,

        g.lateLookups.length
          ? el(
              "div",
              { class: "dt-stack dt-gap-6" },
              el("span", { class: "dt-text-small dt-text-subdued" }, "Lookups publishing after this wave"),
              g.lateLookups.map((s) =>
                el(
                  "div",
                  { class: "dt-row dt-gap-8 dt-wrap" },
                  el("span", { class: "dt-code" }, s.name),
                  el("span", { class: "dt-text-small", style: wrap }, `delivers in Wave ${s.deliverWave}`),
                  button("Open delivery", { variant: "subtle", size: "sm", onClick: () => DMA.store.setSession("waveMapStep", "delivery") })
                )
              )
            )
          : null,

        g.confirmed
          ? el("span", { class: "dt-text-small dt-text-subdued" }, `Confirmed by ${g.confirmed.by} · ${fmt.date(g.confirmed.at)}`)
          : el(
              "div",
              { class: "dt-row dt-gap-8" },
              button("Confirm for this wave", { variant: g.clear ? "emphasized" : "default", size: "sm", iconName: "check", disabled: !g.clear }),
              !g.clear ? el("span", { class: "dt-text-small dt-text-subdued", style: wrap }, "Blocked until every input above has a value.") : null
            )
      )
    );
  }

  /* ---------------------------------------------------------------------- */

  const PANELS = {
    inherited: stepInherited,
    overrides: stepOverrides,
    exceptions: stepExceptions,
    delivery: stepDelivery,
    gate: stepGate,
  };

  DMA.register({
    id: "wave-mapping",
    title: "Wave Map Configurations",
    shortTitle: "Wave Mapping",
    phase: "extract",
    icon: "sliders",
    status: "ready",
    scope: "wave",
    summary:
      "Refine the global rules per application, once waves exist. The wave is the lens; the application is the unit of decision; the asset is the exception.",

    ruleSet: "waveRules",
    steps: STEPS,

    notes: [
      "Rules bind to application, not wave. Waves are mutable delivery containers the EPM re-groups; binding here would orphan mapping decisions on every re-plan. The Wave 4–6 re-plan moved six applications and orphaned nothing — that is the argument, recorded as an event.",
      "Token values and overrides are different things. A token is an input the confirmed template demands and has no default for; an override is a deliberate deviation from a project default. A single 'needs review' queue gives a missing prefix the same weight as a considered decision.",
      "Every field shows provenance — which of translator, project, application or asset put the value there — resolved most-specific-wins by the shared cascade in data/mapping.js.",
      "Overrides are bounded by the global rule. An application may move its timeframe inside the 7-day guardrail ceiling; it cannot move through it, because the ceiling is a project decision.",
      "Per-asset overrides come back counted rather than uncapped — 9 across 2,955 assets. Three exceptions repeating the same value about the same application are read as one missing application rule, not three decisions.",
      "Lookup delivery is the only rule whose answer is a wave number, and it is checked rather than trusted: a lookup publishing after the first wave that reads it ships a dangling reference that looks like an empty dashboard.",
      "The readiness gate is computed, not signed. It asks only whether this wave's applications have supplied every input the confirmed rules demand — Global Mapping already owns the rule set itself.",
    ],

    render(root, ctx) {
      root.append(
        ctx.pageHeader([
          button("Export wave configuration", { variant: "default", iconName: "fileText" }),
          button("Re-check delivery order", { variant: "emphasized", iconName: "refresh" }),
        ]),
        stepper(),
        PANELS[currentStep()]()
      );
    },
  });
})();
