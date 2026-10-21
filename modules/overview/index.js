/* ============================================================================
   MODULE: Project Overview
   ----------------------------------------------------------------------------
   Implements the flow diagram's cross-cutting step:
   "View latest statuses and next steps on the Project Overview."

   Dependencies: DMA.ui, DMA.data, DMA.store ONLY.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, progress, stackedProgress, banner, table, fmt } = DMA.ui;

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

  function kpiRow(p) {
    const v = p.validation;
    return el(
      "div",
      { class: "dt-grid dt-grid-5" },
      kpi("Assets in scope", fmt.num(p.assets.total), `${p.assets.excluded.dead + p.assets.excluded.noEquivalent} excluded at import`, {
        iconName: "database",
      }),
      kpi("Auto-approval rate", fmt.pct(v.autoApprovalRate, 1), `Target ≥${v.targetRate}% · stretch ≥${v.stretchRate}%`, {
        iconName: "checkCircle",
        tone: "success",
        bar: progress(v.autoApprovalRate, "success"),
      }),
      kpi("Awaiting a verdict", fmt.num(v.openNow), `of ${fmt.num(v.needsAttention)} routed · the rest are dispositioned`, {
        iconName: "alert",
        tone: "warning",
      }),
      kpi("Expert hours avoided", fmt.num(p.effort.hoursAvoided), `of ${fmt.num(p.effort.baselineReviewHours)} hr manual baseline`, {
        iconName: "zap",
      }),
      kpi("Day " + p.daysElapsed, `of ${p.targetDays}`, `Go-live ${fmt.dateShort(p.targetGoLive)}`, {
        iconName: "clock",
        bar: progress((p.daysElapsed / p.targetDays) * 100),
      })
    );
  }

  function validationBreakdown(p) {
    const v = p.validation;
    /* The denominator is what was compared, not what is in scope. Dividing by
       2,955 here was the visible symptom of the estate-rollup error: lookups,
       macros and two un-run waves were all sitting in the bar as if they had
       been validated and silently passed. */
    const total = v.validated;
    const segments = [
      { label: "Auto-approved", value: (v.autoApproved / total) * 100, tone: "success" },
      { label: "Meaningful difference", value: (v.meaningfulDifference / total) * 100, tone: "warning" },
      { label: "Uncertain", value: (v.uncertain / total) * 100, tone: "critical" },
    ];

    const legend = [
      ["Auto-approved", v.autoApproved, "success"],
      ["Meaningful difference", v.meaningfulDifference, "warning"],
      ["Uncertain", v.uncertain, "critical"],
    ].map(([label, count, tone]) =>
      el(
        "div",
        { class: "dt-row dt-gap-8" },
        el("span", { class: "dma-navitem__dot", style: { background: `var(--dt-colors-background-${tone}-default)` } }),
        el("span", { class: "dt-grow dt-text-small" }, label),
        el("span", { class: "dt-text-small dt-text-semibold dt-tnum" }, fmt.num(count))
      )
    );

    return card(
      { title: "Validation outcome", subtitle: `${fmt.num(v.validated)} assets compared — the runnable DQL Waves 1–4 produced, not the 2,955 in scope` },
      el(
        "div",
        { class: "dt-stack dt-gap-16" },
        stackedProgress(segments),
        el("div", { class: "dt-stack dt-gap-8" }, legend),
        el("hr", { class: "dt-divider" }),
        el(
          "div",
          { class: "dt-row dt-gap-12" },
          el(
            "div",
            { class: "dt-stack dt-gap-2 dt-grow" },
            el("span", { class: "dt-text-small dt-text-subdued" }, "False-positive rate"),
            el("span", { class: "dt-text-semibold" }, fmt.pct(v.falsePositiveRate, 1))
          ),
          badge("Guardrail <1%", "success", { iconName: "check" })
        )
      )
    );
  }

  function stageProgress(ctx) {
    const rows = DMA.modules
      .filter((m) => m.phase)
      .map((m) => {
        const stage = DMA.data.project.stages[m.id];
        const phase = DMA.PHASES.find((ph) => ph.id === m.phase);
        return el(
          "button",
          {
            class: "dma-navitem",
            style: { padding: "var(--dt-spacing-8) var(--dt-spacing-12)", alignItems: "flex-start" },
            onClick: () => ctx.navigate(m.id),
          },
          el("span", { class: `dma-navitem__dot dma-navitem__dot--${stage.status}`, style: { marginTop: "6px" } }),
          el(
            "span",
            { class: "dt-stack dt-gap-2 dt-grow", style: { minWidth: 0 } },
            el(
              "span",
              { class: "dt-row dt-gap-8" },
              el("span", { class: "dt-text-medium", style: { color: "var(--dt-colors-text-primary-default)" } }, m.title),
              el("span", { class: "dt-text-small dt-text-subdued" }, phase ? phase.label : "")
            ),
            el("span", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, stage.note)
          ),
          icon("chevronR", 14)
        );
      });

    return card({ title: "Migration progress", subtitle: "Every stage of the target-state flow" }, el("div", { class: "dt-stack" }, rows));
  }

  function attentionQueue(ctx) {
    const items = DMA.data.project.blockers.map((b) =>
      el(
        "div",
        {
          class: "dt-stack dt-gap-8",
          style: {
            padding: "var(--dt-spacing-12)",
            border: "1px solid var(--dt-colors-border-neutral-subdued)",
            borderLeft: `3px solid var(--dt-colors-background-${b.severity}-default)`,
            borderRadius: "var(--dt-border-radius-container-default)",
            background: "var(--dt-colors-background-container-neutral-subdued)",
          },
        },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          icon(b.severity === "info" ? "info" : "alert", 14, b.severity === "critical" ? "dt-text-critical" : "dt-text-warning"),
          el("span", { class: "dt-text-medium dt-grow" }, b.title)
        ),
        el("div", { class: "dt-text-small dt-text-secondary" }, b.detail),
        el(
          "div",
          {},
          button(b.action, { variant: "default", size: "sm", iconName: "arrowRight", iconAfter: true, onClick: () => ctx.navigate(b.module) })
        )
      )
    );

    return card(
      { title: "Needs your attention", subtitle: `${items.length} open items across the project` },
      el("div", { class: "dt-stack dt-gap-12" }, items)
    );
  }

  function wavesTable(ctx) {
    const p = DMA.data.project;

    /* The health check holds assets, not waves. This column used to read the
       wave's own `health` field and print a flat "Blocked" badge for Wave 3 —
       which said that 497 assets were stuck behind a gate when 14 were, and
       361 were cleared and ready. A whole wave reported as blocked by 2.8% of
       itself is the kind of rounding that turns a safety gate into something
       people want deleted.

       So this asks Deploy for the asset-level split instead. That is a
       data-layer cross-read, which is allowed; reaching into the Deploy
       MODULE would not be. */
    const healthCell = (w) => {
      const r = DMA.data.deploy.waveDeploy(w.id);
      if (!r || !r.reached || r.checkState === "not-run") return badge("Not run", "neutral", { title: "No ready population to run the check over yet." });
      if (!r.held) {
        return badge("Clear", "success", {
          iconName: "check",
          title: `${fmt.num(r.population)} assets checked, none held.`,
        });
      }
      return el(
        "div",
        { class: "dt-stack dt-gap-2" },
        badge(`${fmt.num(r.held)} held`, "critical", { iconName: "alert", title: "Only these assets are held. The rest of the wave is not." }),
        el("span", { class: "dt-text-small dt-text-subdued" }, `${fmt.num(r.ready)} cleared`)
      );
    };

    return card(
      {
        title: "Waves",
        subtitle: `${p.waves.filter((w) => w.status === "published").length} of ${p.waves.length} published`,
        flush: true,
        actions: button("Plan waves", { variant: "default", size: "sm", iconName: "layers", onClick: () => ctx.navigate("prioritize-plan") }),
      },
      table(
        [
          { label: "Wave", width: "26%", render: (w) => el("div", { class: "dt-row dt-gap-8" }, badge(String(w.id), "primary"), el("span", { class: "dt-text-medium" }, w.name)) },
          { label: "Assets", render: (w) => el("span", { class: "dt-tnum" }, fmt.num(w.assets)) },
          { label: "Priority", render: (w) => el("span", { class: "dt-text-small dt-text-secondary" }, w.priority) },
          { label: "Status", render: (w) => badge(w.status, DMA.data.waveStatusTone(w.status), { dot: true }) },
          { label: "Health check", render: healthCell },
          { label: "Environment", render: (w) => el("span", { class: "dt-text-small dt-text-secondary" }, w.env) },
          { label: "Published", render: (w) => el("span", { class: "dt-text-small dt-text-subdued" }, w.published ? fmt.dateShort(w.published) : "—") },
        ],
        p.waves,
        { onRowClick: () => ctx.navigate("deploy") }
      )
    );
  }

  function activityFeed() {
    const items = DMA.data.project.activity.map((a) =>
      el(
        "div",
        { class: "dt-row-top dt-gap-12" },
        el("span", {
          class: "dma-navitem__dot",
          style: { marginTop: "7px", background: a.actor === "DMA" ? "var(--dt-colors-primary-default)" : "var(--dt-colors-border-neutral-emphasized)" },
        }),
        el(
          "div",
          { class: "dt-stack dt-gap-2 dt-grow" },
          el("div", { class: "dt-text-small" }, a.text),
          el("div", { class: "dt-text-small dt-text-subdued" }, `${a.actor} · ${fmt.date(a.at)}`)
        )
      )
    );
    return card({ title: "Recent activity" }, el("div", { class: "dt-stack dt-gap-12" }, items));
  }

  /* --- Registration ------------------------------------------------------ */
  DMA.register({
    id: "overview",
    title: "Project Overview",
    phase: null,
    icon: "overview",
    status: "ready",
    scope: "estate",
    summary: "Latest status and next step for every stage of the migration.",

    render(root, ctx) {
      const p = DMA.data.project;

      root.append(
        ctx.pageHeader([
          button("Export overview", { variant: "default", iconName: "fileText" }),
          /* Routes to whatever is actually worst, rather than to Deploy —
             which was only ever right while the health check was being
             described as the project's critical blocker. */
          button("Resolve blockers", {
            variant: "emphasized",
            iconName: "arrowRight",
            iconAfter: true,
            onClick: () => ctx.navigate(p.blockers[0].module),
          }),
        ])
      );

      /* This banner used to be a literal reading "Pre-deploy health check
         failed for Wave 3 · Publishing is blocked until they are resolved",
         and it was wrong twice over. The check holds the assets that fail it
         and lets the rest of the wave through, so nothing was blocked; and
         putting 14 held assets in the one critical slot on the project's
         front page ranked them above four assets that are already in a
         customer's tenant and already wrong.

         So the banner now leads with the genuinely critical state and the
         held assets follow it as context. Both figures are read from Deploy
         rather than written here, so the sentence cannot drift from the
         screen it points at. */
      const dep = DMA.data.deploy.estate();
      root.append(
        banner(
          "critical",
          `${fmt.num(dep.liveAndWrong)} published assets failed human review in the tenant and are live and incorrect. ` +
            `Separately, ${fmt.num(dep.held)} assets are held by the pre-deploy health check — the other ${fmt.num(dep.ready)} in that wave cleared it and are not held.`,
          {
            title: `${fmt.num(dep.liveAndWrong)} assets are live and wrong`,
            action: button("Open live review", { variant: "critical", size: "sm", onClick: () => ctx.navigate("validate") }),
          }
        )
      );

      root.append(kpiRow(p));

      root.append(
        el(
          "div",
          { class: "dt-grid", style: { gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)" } },
          stageProgress(ctx),
          el("div", { class: "dt-stack dt-gap-20" }, attentionQueue(ctx), validationBreakdown(p))
        )
      );

      root.append(wavesTable(ctx));
      root.append(activityFeed());
    },
  });
})();
