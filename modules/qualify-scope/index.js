/* ============================================================================
   MODULE: Qualify & Scope
   ----------------------------------------------------------------------------
   Flow-diagram stage: Setup Project → Qualify & Scope

   A PRE-SALES stage. An SSD opens a project to size an opportunity, connects
   the customer's Splunk, and leaves with an LOE report to take into a client
   conversation. The deliverable is an agreed scope and a number — no asset is
   migrated here.

   The five steps below are declared on the registration so the stage rail can
   render them once it is rebuilt as a drill-down (see README). Until then this
   module renders its own stepper.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, stackedProgress, fmt } = DMA.ui;

  const STEPS = [
    { id: "connect",  label: "Connect source" },
    { id: "discover", label: "Discover inventory" },
    { id: "assess",   label: "Assess complexity" },
    { id: "decide",   label: "Scope decisions" },
    { id: "estimate", label: "Effort estimate" },
  ];

  function currentStep() {
    const id = DMA.store.session.qualifyStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  function stepper() {
    const active = currentStep();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Qualify & Scope steps" });

    STEPS.forEach((step, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(step.id === active),
            onClick: () => DMA.store.setSession("qualifyStep", step.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, step.label)
        )
      );
    });

    return row;
  }

  /* --- Shared bits ------------------------------------------------------- */
  function defList(pairs) {
    return el(
      "div",
      { class: "dma-deflist" },
      pairs.map(([label, value]) =>
        el(
          "div",
          { class: "dma-deflist__row" },
          el("span", { class: "dt-text-small dt-text-subdued" }, label),
          el("span", { class: "dt-text-small" }, value)
        )
      )
    );
  }

  function bulletList(items, iconName, tone) {
    return el(
      "ul",
      { class: "dt-stack dt-gap-6", style: { margin: 0, padding: 0, listStyle: "none" } },
      items.map((t) =>
        el(
          "li",
          { class: "dt-row dt-gap-6", style: { alignItems: "flex-start" } },
          el("span", { style: { color: `var(--dt-colors-text-${tone}-default)`, marginTop: "2px" } }, icon(iconName, 13)),
          el("span", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, t)
        )
      )
    );
  }

  /* --- Step 1: Connect source -------------------------------------------- */
  function stepConnect() {
    const q = DMA.data.qualify;
    const c = q.connection;

    const connection = card(
      {
        title: "Source connection",
        subtitle: "Universal Source Connector · credentialed pathway",
        actions: badge("Connected", "success", { dot: true }),
      },
      defList([
        ["Product", c.product],
        ["Deployment", c.deployment],
        ["Endpoint", c.endpoint],
        ["Authentication", `${c.authMethod} · ${c.account}`],
        ["Granted scope", c.scopeGranted],
        ["Connected", fmt.date(c.connectedAt)],
        ["Last sync", fmt.date(c.lastSync)],
      ]),
      el(
        "div",
        { style: { marginTop: "var(--dt-spacing-12)" } },
        banner("success", `Connected in ${c.connectMinutes} minutes, against a <15 minute target for time to first successful connection.`)
      )
    );

    const pathways = q.pathways.map((p) => {
      const chosen = p.id === c.pathway;
      return el(
        "div",
        { class: ["dma-pathway", chosen ? "dma-pathway--chosen" : null] },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("div", { class: "dt-stack dt-gap-4 dt-grow" },
            el("div", { class: "dt-text-semibold" }, p.name),
            el("div", { class: "dt-text-small dt-text-subdued" }, p.tagline)
          ),
          chosen ? badge("In use", "primary") : badge("Not used here", "neutral")
        ),
        el("div", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, p.how),
        bulletList(p.gains, "check", "success"),
        bulletList(p.costs, "x", "critical")
      );
    });

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      connection,
      card(
        {
          title: "Pathway trade-off",
          subtitle: "What the credential decision costs later — the reason it belongs here and not at Validate",
        },
        el("div", { class: "dma-pathways" }, pathways)
      )
    );
  }

  /* --- Step 2: Discover inventory ---------------------------------------- */
  function stepDiscover() {
    const d = DMA.data.qualify.discovery;

    const stats = el(
      "div",
      { class: "dt-grid dt-grid-4 dt-gap-12" },
      [
        ["Discovered", fmt.num(d.discovered), "Everything the connector could see"],
        ["In scope", fmt.num(d.inScope), "After exclusions"],
        ["Applications", String(d.applications), "Stable grouping for mapping rules"],
        ["Sourcetypes", String(d.sourcetypes), "Drives bucket strategy"],
      ].map(([label, value, meta]) =>
        el(
          "div",
          { class: "dma-kpi" },
          el("div", { class: "dma-kpi__label" }, label),
          el("div", { class: "dma-kpi__value" }, value),
          el("div", { class: "dma-kpi__meta" }, meta)
        )
      )
    );

    const rows = table(
      [
        { label: "Asset type", render: (r) => el("div", { class: "dt-stack dt-gap-4" },
            el("span", { class: "dt-text-medium" }, r.type),
            r.detail ? el("span", { class: "dt-text-small dt-text-subdued" }, r.detail) : null) },
        { label: "Discovered", width: "110px", render: (r) => fmt.num(r.discovered) },
        { label: "Excluded", width: "110px", render: (r) =>
            r.excluded ? el("span", { class: "dt-text-warning" }, fmt.num(r.excluded)) : el("span", { class: "dt-text-subdued" }, "—") },
        { label: "In scope", width: "110px", render: (r) => el("span", { class: "dt-text-semibold" }, fmt.num(r.discovered - r.excluded)) },
      ],
      d.byType
    );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      stats,
      card(
        { title: "Inventory by asset type", subtitle: `Oldest asset dates to ${fmt.date(d.oldestAsset)} — a scope signal in its own right`, flush: true },
        rows
      )
    );
  }

  /* --- Step 3: Assess complexity ----------------------------------------- */
  function stepAssess() {
    const q = DMA.data.qualify;
    const totals = q.noEquivalentTotals();

    const verdictBadge = (v) =>
      v === "blocked"
        ? badge("Blocked", "critical", { title: "No Dynatrace path — leaves the migration scope" })
        : badge("Rework", "warning", { title: "Stays in scope, but costs manual hours" });

    const group = (verdict, title, subtitle) =>
      card(
        { title, subtitle, flush: true },
        table(
          [
            {
              label: "Capability",
              render: (r) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-medium" }, r.feature),
                  el("span", { class: "dt-text-small dt-text-subdued" }, r.kind)
                ),
            },
            { label: "Assets", width: "90px", render: (r) => el("span", { class: "dt-text-semibold" }, fmt.num(r.assets)) },
            { label: "Verdict", width: "110px", render: (r) => verdictBadge(r.verdict) },
            {
              label: "What it means",
              render: (r) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4", style: { whiteSpace: "normal", maxWidth: "62ch" } },
                  el("span", { class: "dt-text-small dt-text-secondary" }, r.detail),
                  el("span", { class: "dt-text-small dt-text-subdued" }, r.path)
                ),
            },
          ],
          q.noEquivalent.filter((n) => n.verdict === verdict)
        )
      );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      banner(
        "warning",
        `${fmt.num(totals.blocked)} assets have no Dynatrace path and leave the scope entirely. A further ${fmt.num(totals.rework)} stay in scope but will need a human. Both lists go to the customer before a scope is agreed — surprises here are the expensive kind.`,
        {
          title: "No-equivalent capabilities found",
          action: button("Export list", { variant: "default", size: "sm", iconName: "download" }),
        }
      ),
      group("blocked", "Blocked — no Dynatrace equivalent", "Leaves the migration scope. Rebuilding these is a separate statement of work."),
      group("rework", "Rework — translates, but needs confirmation", "Stays in scope. Drives the manual hours in the estimate.")
    );
  }

  /* --- Step 4: Scope decisions ------------------------------------------- */
  function stepDecide() {
    const q = DMA.data.qualify;
    const d = q.discovery;

    const split = el(
      "div",
      { class: "dt-stack dt-gap-8" },
      el(
        "div",
        { class: "dt-row dt-gap-8" },
        el("span", { class: "dt-text-small dt-grow" }, `${fmt.num(d.discovered)} discovered`),
        el("span", { class: "dt-text-small dt-text-subdued" }, `${fmt.num(d.excluded)} excluded · ${fmt.num(d.inScope)} in scope`)
      ),
      stackedProgress([
        { value: (d.inScope / d.discovered) * 100, tone: "success", label: "In scope" },
        { value: (d.excluded / d.discovered) * 100, tone: "warning", label: "Excluded" },
      ])
    );

    const exclusions = q.exclusions.map((x) =>
      el(
        "div",
        { class: "dma-exclusion" },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("div", { class: "dt-stack dt-gap-4 dt-grow" },
            el("div", { class: "dt-text-medium" }, x.label),
            el("div", { class: "dt-text-small dt-text-subdued" }, x.rule)
          ),
          el("span", { class: "dt-text-semibold" }, fmt.num(x.assets)),
          x.overridable
            ? button("Override", { variant: "default", size: "sm", iconName: "edit" })
            : badge("No override", "neutral", { title: "There is no automated path for these — an override would only hide the problem" })
        ),
        el("div", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, x.note)
      )
    );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      card({ title: "Scope split", subtitle: "What the customer is actually buying a migration for" }, split),
      card(
        { title: "Exclusions", subtitle: "Every excluded asset is named in the LOE report — nothing drops silently" },
        el("div", { class: "dt-stack dt-gap-12" }, exclusions)
      )
    );
  }

  /* --- Step 5: Effort estimate ------------------------------------------- */
  function stepEstimate(ctx) {
    const loe = DMA.data.qualify.loe;
    const low = Math.round(loe.dmaAssistedHours * (1 - loe.confidence / 100));
    const high = Math.round(loe.dmaAssistedHours * (1 + loe.confidence / 100));

    const headline = el(
      "div",
      { class: "dt-grid dt-grid-3 dt-gap-12" },
      [
        ["Estimated effort with DMA", fmt.hours(loe.dmaAssistedHours), `±${loe.confidence}% → ${fmt.num(low)}–${fmt.num(high)} hrs`, "info"],
        ["Manual baseline", fmt.hours(loe.manualBaselineHours), "What this costs without DMA", null],
        ["Hours avoided", fmt.hours(loe.hoursAvoided), "The number the client conversation turns on", "success"],
      ].map(([label, value, meta, tone]) =>
        el(
          "div",
          { class: "dma-kpi" },
          el("div", { class: "dma-kpi__label" }, label),
          el("div", { class: ["dma-kpi__value", tone ? `dt-text-${tone}` : null] }, value),
          el("div", { class: "dma-kpi__meta" }, meta)
        )
      )
    );

    const breakdown = card(
      { title: "Where the hours go", flush: true },
      table(
        [
          { label: "Workstream", render: (r) => el("span", { class: "dt-text-medium" }, r.workstream) },
          { label: "Hours", width: "90px", render: (r) => fmt.num(r.hours) },
          { label: "Driver", render: (r) => el("span", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, r.driver) },
        ],
        loe.breakdown
      )
    );

    const assumptions = card(
      { title: "Assumptions", subtitle: "Stated on the report, so the estimate can be argued with rather than trusted blindly" },
      el(
        "ul",
        { class: "dt-stack dt-gap-6", style: { margin: 0, paddingLeft: "18px" } },
        loe.assumptions.map((a) => el("li", { class: "dt-text-small dt-text-secondary" }, a))
      )
    );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      headline,
      banner(
        "info",
        `This band assumes the credentialed connector. On the CLI pathway the same estimate widens to ±${loe.cliConfidence}%, because the inventory is a point-in-time snapshot with no way to verify translation quality.`
      ),
      breakdown,
      assumptions
    );
  }

  const PANELS = {
    connect: stepConnect,
    discover: stepDiscover,
    assess: stepAssess,
    decide: stepDecide,
    estimate: stepEstimate,
  };

  /* --- Registration ------------------------------------------------------ */
  DMA.register({
    id: "qualify-scope",
    title: "Qualify & Scope",
    phase: "setup",
    icon: "search",
    status: "ready",
    scope: "estate",
    summary: "Connect the source, discover the inventory, and scope what is actually migrating.",

    steps: STEPS,

    notes: [
      "Pre-sales, not delivery. The output is an agreed scope and an LOE report an SSD can take to a client — no asset moves at this stage.",
      "The credential decision is made here and paid for at Validate, so the trade-off is shown at the point of choice. The CLI pathway produces a number but forfeits Asset-to-Asset Validation, because no customer data ever flows through DMA.",
      "No-equivalent findings are split into blocked and rework. They have opposite cost shapes — one leaves the scope, the other buys manual hours — and collapsing them into a single 'unsupported' count is what makes an estimate wrong.",
    ],

    render(root, ctx) {
      root.append(
        ctx.pageHeader([
          button("Re-run discovery", { variant: "default", iconName: "refresh" }),
          button("Export LOE report", { variant: "emphasized", iconName: "fileText" }),
        ]),
        stepper(),
        PANELS[currentStep()](ctx)
      );
    },
  });
})();
