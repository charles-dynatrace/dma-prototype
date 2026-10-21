/* ============================================================================
   MODULE: Import
   ----------------------------------------------------------------------------
   Flow-diagram stage: Extract → Import

   Qualify & Scope estimated the estate from discovery metadata. This is the
   first stage that works from the assets themselves — actual query text,
   actual panel counts — so every number here supersedes an estimate.

   Four features, one step each:
     Universal Asset Importer   — the bulk pull, and the <15 min target
     Delta / Versioning Engine  — the new/changed/removed flag and its history
     No-Equivalent Pre-Flag     — the command catalog run against real queries
     Dead-Asset Validation Gate — auto-exclusion with a PM override

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, progress, stackedProgress, fmt } = DMA.ui;

  const STEPS = [
    { id: "run",     label: "Run import" },
    { id: "changes", label: "What changed" },
    { id: "flags",   label: "Flags & exclusions" },
    { id: "history", label: "Version history" },
  ];

  function currentStep() {
    const id = DMA.store.session.importStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  function stepper() {
    const active = currentStep();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Import steps" });

    STEPS.forEach((step, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(step.id === active),
            onClick: () => DMA.store.setSession("importStep", step.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, step.label)
        )
      );
    });

    return row;
  }

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

  const mins = (n) => `${n.toFixed(1)} min`;

  /* --- Step 1: Run import -------------------------------------------------- */
  /* The target is per run, not per asset, and the cold pull is the run it
     exists for — so the run list is the evidence, not the headline number. */
  function stepRun() {
    const inv = DMA.data.inventory;
    const latest = inv.latestRun();
    const slowest = inv.runs.reduce((a, r) => (r.minutes > a.minutes ? r : a));
    const partials = inv.runs.filter((r) => r.status === "partial");

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Assets pulled", fmt.num(latest.pulled), `Last run ${fmt.date(latest.at)} · ${latest.trigger}`, { iconName: "database" }),
        kpi("Last run duration", mins(latest.minutes), `Target under ${inv.targetMinutes} min per run`, {
          iconName: "clock",
          tone: "success",
          bar: progress((latest.minutes / inv.targetMinutes) * 100, "success"),
        }),
        kpi("Slowest run", mins(slowest.minutes), `Run ${slowest.id} — ${slowest.note ? "cold pull of the whole estate" : "full inventory"}`, {
          iconName: "alert",
          bar: progress((slowest.minutes / inv.targetMinutes) * 100, slowest.minutes > inv.targetMinutes ? "critical" : "warning"),
        }),
        kpi("Runs recorded", String(inv.runs.length), `${partials.length} partial · ${inv.runs.length - partials.length} complete`, {
          iconName: "refresh",
        })
      ),
      banner(
        "info",
        "One import covers dashboards, alerts, saved searches, reports and lookups — their definitions, their query text, their scheduling and their ownership. Nothing is re-entered by hand, which is what makes every downstream count a fact rather than a sample.",
        { title: "A single pull across all five asset types" }
      ),
      card(
        { title: "Import runs", subtitle: "Newest first · the cold pull is run 1", flush: true },
        table(
          [
            {
              label: "Run",
              width: "72px",
              render: (r) => el("span", { class: "dt-text-semibold" }, `#${r.id}`),
            },
            {
              label: "When",
              width: "150px",
              render: (r) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", {}, fmt.date(r.at)),
                  el("span", { class: "dt-text-small dt-text-subdued" }, r.trigger)
                ),
            },
            { label: "Assets", width: "100px", render: (r) => fmt.num(r.pulled) },
            {
              label: `Duration vs ${inv.targetMinutes} min target`,
              width: "200px",
              render: (r) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: r.minutes > inv.targetMinutes ? "dt-text-critical" : "dt-text-success" }, mins(r.minutes)),
                  progress((r.minutes / inv.targetMinutes) * 100, r.minutes > inv.targetMinutes ? "critical" : "success")
                ),
            },
            {
              label: "Outcome",
              render: (r) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4", style: { alignItems: "flex-start" } },
                  r.status === "partial"
                    ? badge("Partial", "warning", { iconName: "alert" })
                    : badge("Complete", "success", { iconName: "check" }),
                  r.note ? el("span", { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } }, r.note) : null
                ),
            },
          ],
          inv.runs
        )
      ),
      partials.length
        ? card(
            {
              title: "How a partial run behaves",
              subtitle: `Run ${partials[0].id} · ${fmt.date(partials[0].at)}`,
            },
            el(
              "div",
              { class: "dt-stack dt-gap-12" },
              partials[0].failures.map((f) =>
                el(
                  "div",
                  { class: "dma-failure" },
                  el(
                    "div",
                    { class: "dt-row dt-gap-8" },
                    el("div", { class: "dt-text-medium dt-grow" }, `${f.type} — ${f.count} assets`),
                    badge("Recovered", "success", { iconName: "check" })
                  ),
                  el("div", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, f.reason),
                  el("div", { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } }, f.resolution)
                )
              ),
              el(
                "div",
                { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } },
                "A failing asset type does not abandon the run. The other four complete, the failure is reported against the specific objects and the reason they were rejected, and the next run re-pulls only what was missed. An all-or-nothing import on a 3,000-asset estate means one malformed CSV costs a whole afternoon."
              )
            )
          )
        : null
    );
  }

  /* --- Step 2: What changed ------------------------------------------------ */
  /* Without the flag every re-import looks like a first import, and the only
     way to find the 46 assets that moved is to re-read all 3,088. */
  function stepChanges() {
    const inv = DMA.data.inventory;
    const d = inv.delta;
    const moved = d.newCount + d.changedCount + d.removedCount;
    const total = moved + d.unchangedCount;
    /* The bar breaks down the moved assets, not the estate. At 1.6% of 3,088
       an estate-proportional bar is a solid block that says nothing. */
    const pctOf = (n) => (n / moved) * 100;

    const CHANGE_TONE = { new: "info", changed: "warning", removed: "critical" };
    const CHANGE_ICON = { new: "upload", changed: "edit", removed: "x" };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("New", fmt.num(d.newCount), "Not present in the previous import", { iconName: "upload", tone: "info" }),
        kpi("Changed", fmt.num(d.changedCount), "Definition or query text differs", { iconName: "edit", tone: "warning" }),
        kpi("Removed", fmt.num(d.removedCount), "Deleted at source since the last run", { iconName: "x", tone: "critical" }),
        kpi("Unchanged", fmt.num(d.unchangedCount), `${fmt.pct((d.unchangedCount / total) * 100, 1)} of the estate — no re-work needed`, {
          iconName: "check",
        })
      ),
      card(
        {
          title: `Changes since run ${d.comparedTo}`,
          subtitle: "The comparison is against the previous import of each asset, not against its translated output",
        },
        stackedProgress([
          { value: pctOf(d.newCount), label: "New" },
          { value: pctOf(d.changedCount), tone: "warning", label: "Changed" },
          { value: pctOf(d.removedCount), tone: "critical", label: "Removed" },
        ]),
        el(
          "div",
          { class: "dt-text-small dt-text-secondary", style: { marginTop: "var(--dt-spacing-12)", whiteSpace: "normal" } },
          `${fmt.num(moved)} of ${fmt.num(total)} assets moved — the bar above breaks those ${fmt.num(moved)} down. The other ${fmt.num(d.unchangedCount)} keep their existing translation, validation result and wave assignment untouched, which is the entire point of tracking the delta rather than re-running the estate.`
        )
      ),
      card(
        { title: "Assets that moved", subtitle: "A sample of the 49 — each row names what changed, not just that it did", flush: true },
        table(
          [
            {
              label: "Asset",
              render: (r) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-medium" }, r.name),
                  el("span", { class: "dt-text-small dt-text-subdued" }, `${r.id} · ${r.type} · ${r.app}`)
                ),
            },
            {
              label: "Change",
              width: "120px",
              render: (r) =>
                badge(r.change.charAt(0).toUpperCase() + r.change.slice(1), CHANGE_TONE[r.change], { iconName: CHANGE_ICON[r.change] }),
            },
            {
              label: "Detail",
              width: "42%",
              render: (r) => el("span", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, r.detail),
            },
          ],
          d.items
        )
      ),
      card(
        { title: "Why removed assets still need a decision" },
        el(
          "div",
          { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } },
          "An asset deleted in Splunk after it was already translated is the case that bites. The translation is still sitting in the wave, still queued to publish, and publishing it recreates something the customer deliberately retired. Removal is flagged for review rather than auto-dropped, because the inverse mistake — silently discarding work someone deleted by accident — is just as expensive."
        )
      )
    );
  }

  /* --- Step 3: Flags & exclusions ------------------------------------------ */
  /* Two features, one screen, because they answer the same question: which
     assets should not reach a translator, and why. */
  function stepFlags() {
    const inv = DMA.data.inventory;
    const c = inv.catalog;
    const totals = inv.catalogTotals();
    const dead = inv.deadAssets;

    const VERDICT = {
      blocked: { tone: "critical", label: "Blocked", why: "No DQL equivalent and no viable rewrite — the asset is excluded." },
      rework: { tone: "warning", label: "Rework", why: "Translatable, but by hand. Costs consultant hours rather than blocking the migration." },
    };

    const catalogCard = card(
      {
        title: "No-equivalent command catalog",
        subtitle: `${c.rawHits} occurrences across ${c.distinctAssets} distinct assets · catalog shared with ${c.sharedWith}`,
        flush: true,
      },
      table(
        [
          {
            label: "SPL command",
            width: "210px",
            render: (r) => el("code", { class: "dma-code" }, r.command),
          },
          { label: "Assets", width: "90px", render: (r) => fmt.num(r.assets) },
          {
            label: "Verdict",
            width: "120px",
            render: (r) => badge(VERDICT[r.verdict].label, VERDICT[r.verdict].tone, { title: VERDICT[r.verdict].why }),
          },
          {
            label: "Why",
            render: (r) => el("span", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, r.why),
          },
        ],
        c.commands
      )
    );

    const deadRow = (a) =>
      el(
        "div",
        { class: ["dma-exclusion", a.state === "overridden" ? "dma-exclusion--kept" : null] },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el(
            "div",
            { class: "dt-stack dt-gap-4 dt-grow" },
            el("div", { class: "dt-text-medium" }, a.name),
            el("div", { class: "dt-text-small dt-text-subdued" }, `${a.id} · ${a.type} · ${a.app} · last returned results ${fmt.date(a.lastResult)}`)
          ),
          a.state === "overridden"
            ? badge("Kept by override", "info", { iconName: "flag" })
            : badge("Excluded", "neutral", { iconName: "archive" })
        ),
        a.state === "overridden"
          ? el(
              "div",
              { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } },
              `"${a.reason}" — ${a.by}, ${fmt.date(a.at)}`
            )
          : null,
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("span", { class: "dt-grow" }),
          a.state === "overridden"
            ? button("Re-exclude", { variant: "default", size: "sm", iconName: "archive" })
            : button("Include anyway", { variant: "default", size: "sm", iconName: "flag" })
        )
      );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Blocked by command", fmt.num(totals.blocked), "Excluded — no DQL equivalent exists", { iconName: "lock", tone: "critical" }),
        kpi("Needs rework", fmt.num(totals.rework), "Translatable by hand — hours, not a blocker", { iconName: "sliders", tone: "warning" }),
        kpi("Dead assets detected", fmt.num(dead.detected), dead.rule, { iconName: "archive" }),
        kpi("Auto-excluded", fmt.num(dead.autoExcluded), `${dead.overridden} kept by PM override`, { iconName: "x" })
      ),
      banner(
        "info",
        "Qualify & Scope ran this same catalog against discovery metadata to size the estate. Here it runs against the actual query text of every imported asset — which is why the rework number moves and the blocked number holds. Blocked is a property of the command; rework is a property of how the command was used.",
        { title: "The same catalog, applied with real evidence" }
      ),
      catalogCard,
      card(
        { title: "Blocked and rework are not the same cost" },
        el(
          "div",
          { class: "dt-grid dt-grid-2 dt-gap-16" },
          el(
            "div",
            { class: "dma-verdict dma-verdict--blocked" },
            el("div", { class: "dt-text-medium dt-text-critical" }, `Blocked — ${fmt.num(totals.blocked)} assets`),
            el("div", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, VERDICT.blocked.why),
            el(
              "div",
              { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } },
              "These write data back, read Splunk's own internals, or trigger actions from inside a search. No amount of consultant time produces a DQL version, so they leave the scope and the customer is told why."
            )
          ),
          el(
            "div",
            { class: "dma-verdict dma-verdict--rework" },
            el("div", { class: "dt-text-medium dt-text-warning" }, `Rework — ${fmt.num(totals.rework)} assets`),
            el("div", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, VERDICT.rework.why),
            el(
              "div",
              { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } },
              "These have a known DQL pattern that a human has to apply and confirm case by case. Collapsing them into a single 'unsupported' count is how an LOE ends up wrong in both directions at once."
            )
          )
        )
      ),
      card(
        {
          title: "Dead-asset gate",
          subtitle: `${dead.rule} · excluded by default, never deleted`,
          actions: badge(`${dead.autoExcluded} excluded · ${dead.overridden} overridden`, "neutral"),
        },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } },
            "Detection already existed and was informational, which meant dead dashboards were translated, validated and published anyway. The feature is the enforcement: excluded by default, with a per-asset override for the dormant-on-purpose case. A yearly fiscal-close dashboard looks identical to a dead one for 364 days."
          ),
          dead.items.map(deadRow)
        )
      )
    );
  }

  /* --- Step 4: Version history --------------------------------------------- */
  /* Not the validation diff. That one compares source against translated
     output; this one compares one import of an asset against another. */
  function stepHistory() {
    const inv = DMA.data.inventory;
    const t = inv.tracked;
    const latestV = t.versions[t.versions.length - 1].v;

    const from = Number(DMA.store.session.importDiffFrom || latestV - 1);
    const to = Number(DMA.store.session.importDiffTo || latestV);
    const rows = inv.diff(from, to);

    const KIND_TONE = { added: "success", removed: "critical", edited: "warning" };
    const KIND_ICON = { added: "upload", removed: "x", edited: "edit" };

    const versionSelect = (key, value) => {
      const sel = el("select", {
        class: "dma-select",
        "aria-label": key === "importDiffFrom" ? "Compare from version" : "Compare to version",
        onChange: (e) => DMA.store.setSession(key, Number(e.target.value)),
      });
      t.versions.forEach((v) => sel.append(el("option", { value: String(v.v) }, `v${v.v} — ${fmt.dateShort(v.at)}`)));
      sel.value = String(value);
      return sel;
    };

    const timelineItem = (v) =>
      el(
        "li",
        { class: ["dma-version", v.v === latestV ? "dma-version--current" : null] },
        el("span", { class: "dma-version__dot" }),
        el(
          "div",
          { class: "dt-stack dt-gap-4 dt-grow" },
          el(
            "div",
            { class: "dt-row dt-gap-8" },
            el("span", { class: "dt-text-medium dt-grow" }, `v${v.v} — ${v.summary}`),
            v.v === latestV ? badge("Current", "success") : button("Roll back to v" + v.v, { variant: "default", size: "sm", iconName: "refresh" })
          ),
          el(
            "div",
            { class: "dt-text-small dt-text-subdued" },
            `${fmt.date(v.at)} · import run ${v.run} · ${v.panels} panels · ${v.preflags} pre-flag${v.preflags === 1 ? "" : "s"} · ${v.mapping}`
          )
        )
      );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      banner(
        "info",
        "Every import writes a version, so an asset's state at any past run can be reproduced. This is not the validation diff — that one compares a Splunk asset against its translated Dynatrace output. This one compares an asset against itself, one import ago.",
        { title: "Two diffs exist in DMA and they answer different questions" }
      ),
      card(
        {
          title: t.name,
          subtitle: `${t.id} · ${t.type} · ${t.app} · Wave ${t.wave}`,
          actions: badge(`${t.versions.length} versions`, "neutral", { iconName: "clock" }),
        },
        el("ul", { class: "dma-timeline" }, t.versions.slice().reverse().map(timelineItem))
      ),
      card(
        {
          title: "Compare any two versions",
          subtitle: "Not just consecutive ones — an asset that drifted over four runs is the case worth seeing whole",
        },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          el(
            "div",
            { class: "dma-diffbar" },
            versionSelect("importDiffFrom", from),
            el("span", { class: "dt-text-subdued", style: { display: "inline-flex" } }, icon("arrowRight", 14)),
            versionSelect("importDiffTo", to),
            el("span", { class: "dt-grow" }),
            badge(`${rows.length} field change${rows.length === 1 ? "" : "s"}`, rows.length ? "info" : "neutral")
          ),
          rows.length
            ? el(
                "div",
                { class: "dt-stack dt-gap-8" },
                rows.map((r) =>
                  el(
                    "div",
                    { class: "dma-diff" },
                    el("span", { class: `dt-text-${KIND_TONE[r.kind]}`, style: { display: "inline-flex" } }, icon(KIND_ICON[r.kind], 13)),
                    el(
                      "div",
                      { class: "dt-stack dt-gap-4 dt-grow" },
                      el("div", { class: "dt-text-medium" }, r.field),
                      el(
                        "div",
                        { class: "dma-diff__values" },
                        el("code", { class: "dma-code dma-code--from" }, r.from),
                        el("span", { class: "dt-text-subdued", style: { display: "inline-flex" } }, icon("arrowRight", 12)),
                        el("code", { class: "dma-code dma-code--to" }, r.to)
                      )
                    ),
                    badge(`v${r.v}`, "neutral")
                  )
                )
              )
            : el("div", { class: "dt-text-small dt-text-subdued" }, "No field-level changes between these two versions."),
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } },
            "The v5 pre-flag is what this view is for. The source team replaced a stats aggregation with a transaction command between two imports — the asset was already translated and validated, and nothing on its translated output would have said so."
          )
        )
      )
    );
  }

  const PANELS = {
    run: stepRun,
    changes: stepChanges,
    flags: stepFlags,
    history: stepHistory,
  };

  /* --- Registration -------------------------------------------------------- */
  DMA.register({
    id: "import",
    title: "Import",
    phase: "extract",
    icon: "download",
    status: "ready",
    scope: "estate",
    summary: "Bulk-import every asset and its query text, flag what changed since the last run, and exclude what should never reach a translator.",

    steps: STEPS,

    notes: [
      "The first stage with real evidence. Qualify & Scope sized the estate from discovery metadata; this reads the assets themselves, so every count here supersedes an estimate rather than confirming one.",
      "A failing asset type does not abandon the run. Failures are reported against the specific objects and the reason they were rejected, and the next run re-pulls only what was missed.",
      "The delta is what makes a re-import cheap. Without it every run looks like a first run, and the only way to find the 49 assets that moved is to re-read all 3,088.",
      "Blocked and rework are opposite cost shapes — one leaves the scope, the other consumes consultant hours. The catalog is the same list Qualify & Scope used; only the evidence underneath it changed.",
      "Dead-asset detection already existed and was informational. The feature is the enforcement: excluded by default, visible rather than deleted, overridable per asset for the dormant-on-purpose case.",
      "Version history compares an asset against its own previous import. The validation diff compares source against translated output. Conflating them is the most common misreading of this stage.",
    ],

    render(root, ctx) {
      root.append(
        ctx.pageHeader([
          button("Re-import inventory", { variant: "default", iconName: "refresh" }),
          button("Export inventory", { variant: "emphasized", iconName: "fileText" }),
        ]),
        stepper(),
        PANELS[currentStep()](ctx)
      );
    },
  });
})();
