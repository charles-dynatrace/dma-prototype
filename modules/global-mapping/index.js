/* ============================================================================
   MODULE: Global Mapping Configurations
   ----------------------------------------------------------------------------
   Flow-diagram stage: Extract → Global Mapping Configurations
   Sits BEFORE Prioritize & Plan, because bucket strategy determines ingest
   footprint, which is what wave sizing depends on.

   The live product makes you navigate this stage by object type — five tabs,
   1,236 index rows in the first one — so the same decision is taken 1,236
   times with nothing above the list to take it once. This screen inverts
   that: seven decisions, each made once, with triage pointing at the few
   objects that genuinely differ.

   Three features, four steps:
     Context-Injection Engine  — a suggested default on every rule
     Mapping Confidence Triage — Fits Default / Needs Configuration / Uncertain
     Rule-set confirmation     — the project-scope half of the archived
                                 Global + Per-Asset Overrides PRD; the
                                 per-asset half belongs to Wave Mapping

   Deliberately absent: LOE and complexity scoring. Every table in the live
   product carries them and they change no decision taken here.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, stackedProgress, fmt } = DMA.ui;

  const STEPS = [
    { id: "rules",   label: "Rule set" },
    { id: "fields",  label: "Field handling" },
    { id: "triage",  label: "Triage" },
    { id: "confirm", label: "Confirm & lock" },
  ];

  const CLASSES = {
    fits:      { label: "Fits Default",       tone: "success",  icon: "check" },
    needs:     { label: "Needs Configuration", tone: "warning",  icon: "sliders" },
    uncertain: { label: "Uncertain",           tone: "critical", icon: "helpCircle" },
  };

  function currentStep() {
    const id = DMA.store.session.globalMapStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  /* The rule editor is a drill-down inside step 1, not a modal — it carries a
     resolution table and an impact panel, and both want the full width. */
  function currentRule() {
    const id = DMA.store.session.globalMapRule;
    return DMA.data.mapping.globalRules.some((r) => r.id === id) ? id : null;
  }

  function openRule(id) {
    delete DMA.store.session.globalMapStrategy;
    DMA.store.setSession("globalMapRule", id);
  }

  function stepper() {
    const active = currentStep();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Global mapping steps" });

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
              DMA.store.session.globalMapRule = null;
              DMA.store.setSession("globalMapStep", step.id);
            },
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

  const wrap = { whiteSpace: "normal" };

  /* A rule's triage split, as a bar plus the three counts. Rules with a single
     decision get the counts only — a 100% bar for one item is noise. */
  function triageSplit(t) {
    const total = t.fits + t.needs + t.uncertain;
    const pct = (n) => (n / total) * 100;
    return el(
      "div",
      { class: "dt-stack dt-gap-6" },
      total > 4
        ? stackedProgress([
            { value: pct(t.fits), tone: "success", label: CLASSES.fits.label },
            { value: pct(t.needs), tone: "warning", label: CLASSES.needs.label },
            { value: pct(t.uncertain), tone: "critical", label: CLASSES.uncertain.label },
          ])
        : null,
      el(
        "div",
        { class: "dt-row dt-gap-8 dt-wrap" },
        el("span", { class: "dt-text-small dt-text-success" }, `${fmt.num(t.fits)} fits`),
        t.needs ? el("span", { class: "dt-text-small dt-text-warning" }, `${fmt.num(t.needs)} needs input`) : null,
        t.uncertain ? el("span", { class: "dt-text-small dt-text-critical" }, `${fmt.num(t.uncertain)} uncertain`) : null
      )
    );
  }

  /* --- Step 1a: the rule editor --------------------------------------------
     The screen that answers "how do 1,236 objects get updated". They do not.
     One value is stored at project scope and every row is resolved from it on
     read; the only per-object storage is an override. Everything below exists
     to make that legible — the decision, what it resolves to, what changing it
     would cost, and the handful of objects the rule cannot reach. */
  function ruleEditor(ruleId) {
    const rs = DMA.data.ruleset;
    const rule = DMA.data.mapping.globalRules.find((r) => r.id === ruleId);
    const state = rs.rules[ruleId];
    const ed = rs.editor[ruleId] || null;
    const selectedId = ed ? DMA.store.session.globalMapStrategy || ed.confirmed : null;
    const strategy = ed ? ed.strategies.find((s) => s.id === selectedId) : null;
    const confirmedStrategy = ed ? ed.strategies.find((s) => s.id === ed.confirmed) : null;
    const changed = Boolean(ed) && selectedId !== ed.confirmed;

    const frozen = rs.lockState.filter((w) => w.state === "locked");
    const frozenAssets = frozen.reduce((n, w) => n + w.assets, 0);
    const exceptions = ed ? ed.sample.filter((r) => r.state !== "rule") : [];

    const header = el(
      "div",
      { class: "dt-stack dt-gap-12" },
      el(
        "div",
        { class: "dt-row" },
        button("All rules", { variant: "subtle", size: "sm", iconName: "chevronL", onClick: () => DMA.store.setSession("globalMapRule", null) })
      ),
      el(
        "div",
        { class: "dma-pagehead" },
        el(
          "div",
          { class: "dt-stack dt-gap-6 dt-grow" },
          el(
            "div",
            { class: "dma-pagehead__title" },
            el("h3", {}, rule.name),
            badge(`${fmt.num(state.decides)} ${state.decidesLabel}`, "neutral", { iconName: "database" })
          ),
          el("div", { class: "dt-text-secondary", style: wrap }, rule.detail)
        ),
        state.state === "edited" ? badge("Default edited", "warning", { iconName: "edit" }) : badge("Default accepted", "success", { iconName: "check" })
      )
    );

    const premise = banner(
      "info",
      ed
        ? `One value is stored for this rule. The ${fmt.num(state.decides)} index rows are resolved from it every time they are read — nothing is written per index, which is why changing the pattern below re-points all of them at once. The only thing stored per object is an override, and there are ${ed.overrides} of those out of ${fmt.num(state.decides)}.`
        : `One value is stored for this rule. All ${fmt.num(state.decides)} ${state.decidesLabel} are resolved from it on read, not written individually. Per-object storage only happens when someone sets an override.`,
      { title: "A rule is one stored value, not a bulk edit" }
    );

    /* --- The decision ---------------------------------------------------- */
    const choice = (s) =>
      el(
        "button",
        {
          class: ["dma-choice", s.id === selectedId ? "dma-choice--selected" : null],
          "aria-pressed": String(s.id === selectedId),
          onClick: () => DMA.store.setSession("globalMapStrategy", s.id),
        },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("span", { class: "dt-text-medium dt-grow" }, s.label),
          s.id === ed.confirmed ? badge("Confirmed in v3", "success", { iconName: "check" }) : null,
          s.recommended && s.id !== ed.confirmed ? badge("Recommended", "info") : null
        ),
        el("code", { class: "dma-code" }, s.pattern),
        el("div", { class: "dt-text-small dt-text-secondary" }, `${fmt.num(s.buckets)} bucket${s.buckets === 1 ? "" : "s"}`),
        el("div", { class: "dt-text-small dt-text-success", style: wrap }, s.gain),
        el("div", { class: "dt-text-small dt-text-warning", style: wrap }, s.cost)
      );

    const decisionCard = ed
      ? card(
          {
            title: "The decision",
            subtitle: "Four options, not 1,236 edits. Every index in the estate resolves from whichever one is selected.",
          },
          el("div", { class: "dt-grid dt-grid-2 dt-gap-12" }, ed.strategies.map(choice))
        )
      : card(
          { title: "The decision", subtitle: "One value, applied estate-wide" },
          el(
            "div",
            { class: "dt-stack dt-gap-8" },
            el(
              "div",
              { class: "dma-rule__value" },
              el("span", { class: "dt-text-small dt-text-subdued" }, "Suggested"),
              el("code", { class: ["dma-code", state.state === "edited" ? "dma-code--from" : null] }, state.suggested)
            ),
            state.state === "edited"
              ? el(
                  "div",
                  { class: "dma-rule__value" },
                  el("span", { class: "dt-text-small dt-text-subdued" }, "In effect"),
                  el("code", { class: "dma-code dma-code--to" }, state.editedTo)
                )
              : null,
            el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, `Suggested because: ${state.basis}`),
            el("div", { class: "dt-row dt-gap-8" }, el("span", { class: "dt-grow" }), button("Change value", { variant: "default", size: "sm", iconName: "edit" }))
          )
        );

    /* --- What it resolves to ---------------------------------------------- */
    const SOURCE = {
      rule: { label: "Resolved by rule", tone: "neutral" },
      override: { label: "Stored override", tone: "info" },
      needs: { label: "Needs Configuration", tone: "warning" },
      uncertain: { label: "Uncertain", tone: "critical" },
    };

    const resolutionCard = ed
      ? card(
          {
            title: "What this resolves to",
            subtitle: `${ed.sample.length} of ${fmt.num(state.decides)} indexes · the "Resolves to" column is computed, never stored`,
            flush: true,
          },
          table(
            [
              {
                label: "Splunk index",
                width: "210px",
                render: (r) =>
                  el(
                    "div",
                    { class: "dt-stack dt-gap-4", style: { alignItems: "flex-start" } },
                    el("code", { class: "dma-code" }, r.name),
                    el("span", { class: "dt-text-small dt-text-subdued" }, `${r.app} · ${r.wave ? `Wave ${r.wave}` : "unassigned"}`)
                  ),
              },
              {
                label: "Source settings",
                width: "140px",
                render: (r) =>
                  el(
                    "div",
                    { class: "dt-stack dt-gap-4" },
                    el("span", { class: "dt-text-small dt-tnum" }, `${fmt.num(r.retention)}d retention`),
                    el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, `${fmt.num(r.gb)} GB/day`)
                  ),
              },
              {
                label: "Resolves to",
                render: (r) => {
                  const res = DMA.data.ruleset.resolveBucket(selectedId, r);
                  return res.bucket
                    ? el("code", { class: ["dma-code", res.source === "override" ? "dma-code--to" : null] }, res.bucket)
                    : el("span", { class: "dt-text-small dt-text-secondary", style: wrap }, r.note);
                },
              },
              {
                label: "Source",
                width: "180px",
                render: (r) => {
                  const res = DMA.data.ruleset.resolveBucket(selectedId, r);
                  return badge(SOURCE[res.source].label, SOURCE[res.source].tone);
                },
              },
            ],
            ed.sample
          ),
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: { ...wrap, padding: "var(--dt-spacing-12)" } },
            `The other ${fmt.num(state.decides - ed.sample.length)} indexes resolve the same way and are not listed, because there is nothing to review in them — they are the pattern applied. Switch the strategy above and every row in this table recomputes, including the ${ed.overrides} overrides, which keep their stored value because an override is the only thing in this rule that is actually written per object.`
          )
        )
      : card(
          { title: "What this resolves to" },
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: wrap },
            `This value resolves ${fmt.num(state.decides)} ${state.decidesLabel}${state.reach ? `, reaching ${fmt.num(state.reach)} assets` : ""}. None of them holds a stored copy, so changing the value above changes all of them at once and nothing has to be re-entered.`
          )
        );

    /* --- Impact ------------------------------------------------------------ */
    /* The honest answer to "can I just change this for the open waves". No —
       an index cannot land in two buckets, which is why this rule is global
       in the first place. */
    const impactCard = ed
      ? card(
          { title: "Impact of this change" },
          changed
            ? el(
                "div",
                { class: "dt-stack dt-gap-12" },
                el(
                  "div",
                  { class: "dt-grid dt-grid-3 dt-gap-12" },
                  el(
                    "div",
                    { class: "dma-delta" },
                    el("div", { class: "dt-text-small dt-text-subdued" }, "Buckets"),
                    el(
                      "div",
                      { class: "dma-diff__values" },
                      el("code", { class: "dma-code dma-code--from" }, fmt.num(confirmedStrategy.buckets)),
                      el("span", { class: "dt-text-subdued", style: { display: "inline-flex" } }, icon("arrowRight", 12)),
                      el("code", { class: "dma-code dma-code--to" }, fmt.num(strategy.buckets))
                    )
                  ),
                  el(
                    "div",
                    { class: "dma-delta" },
                    el("div", { class: "dt-text-small dt-text-subdued" }, "Assets re-pointed"),
                    el("div", { class: "dt-text-medium dt-text-warning" }, `${fmt.num(DMA.data.project.assets.total)} — every translated query names a bucket`)
                  ),
                  el(
                    "div",
                    { class: "dma-delta" },
                    el("div", { class: "dt-text-small dt-text-subdued" }, "Frozen assets affected"),
                    el("div", { class: "dt-text-medium dt-text-critical" }, `${fmt.num(frozenAssets)} in Waves ${frozen.map((w) => w.wave).join(", ")}`)
                  )
                ),
                banner(
                  "critical",
                  `Waves ${frozen.map((w) => w.wave).join(", ")} already ingest against ${confirmedStrategy.pattern}. Applying ${strategy.pattern} to the open waves alone would write the same index to two different buckets and split the data — which is the exact failure this rule is global to prevent. There is no partial path: all ${fmt.num(frozenAssets)} frozen assets have to come back through manual review with it.`,
                  { title: "An index cannot land in two buckets" }
                ),
                el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, strategy.cost)
              )
            : el(
                "div",
                { class: "dt-text-small dt-text-secondary", style: wrap },
                `No change. ${confirmedStrategy.label} is the strategy rule set v${rs.confirmation.version} was confirmed with, and ${fmt.num(frozenAssets)} assets across Waves ${frozen.map((w) => w.wave).join(", ")} are already ingesting against it. Select a different option above to see what moving would cost.`
              )
        )
      : null;

    /* --- Exceptions -------------------------------------------------------- */
    const EX_TONE = { override: "info", needs: "warning", uncertain: "critical" };
    const EX_CLASS = { override: "dma-action", needs: "dma-action dma-action--needsinput", uncertain: "dma-action dma-action--blocking" };

    const exceptionCard = ed
      ? card(
          {
            title: "The objects the rule cannot reach",
            subtitle: `${exceptions.length} in this sample · ${ed.overrides} overrides and ${state.triage.needs + state.triage.uncertain} unresolved across all ${fmt.num(state.decides)}`,
          },
          el(
            "div",
            { class: "dt-stack dt-gap-8" },
            exceptions.map((r) =>
              el(
                "div",
                { class: EX_CLASS[r.state] },
                el(
                  "div",
                  { class: "dt-row dt-gap-8" },
                  el("code", { class: "dma-code", style: { flex: "none" } }, r.name),
                  el("span", { class: "dt-grow" }),
                  badge(SOURCE[r.state].label, EX_TONE[r.state], { iconName: r.state === "override" ? "flag" : r.state === "needs" ? "sliders" : "helpCircle" })
                ),
                r.state === "override"
                  ? el(
                      "div",
                      { class: "dt-stack dt-gap-4" },
                      el(
                        "div",
                        { class: "dma-diff__values" },
                        el("code", { class: "dma-code dma-code--from" }, `logs:${r.name}`),
                        el("span", { class: "dt-text-subdued", style: { display: "inline-flex" } }, icon("arrowRight", 12)),
                        el("code", { class: "dma-code dma-code--to" }, r.overrideTo)
                      ),
                      el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, r.overrideWhy),
                      el("div", { class: "dt-text-small dt-text-subdued" }, `${r.overrideBy} · ${fmt.date(r.overrideAt)}`)
                    )
                  : el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, r.note),
                el(
                  "div",
                  { class: "dt-row dt-gap-8" },
                  el("span", { class: "dt-grow" }),
                  r.state === "override"
                    ? button("Remove override", { variant: "default", size: "sm", iconName: "x" })
                    : button("Set bucket for this index", { variant: "emphasized", size: "sm", iconName: "sliders" })
                )
              )
            )
          )
        )
      : card(
          { title: "The objects the rule cannot reach", subtitle: `${state.triage.needs + state.triage.uncertain} unresolved` },
          el(
            "div",
            { class: "dt-stack dt-gap-8" },
            rs.queue.filter((q) => q.rule === ruleId).length
              ? rs.queue
                  .filter((q) => q.rule === ruleId)
                  .map((q) =>
                    el(
                      "div",
                      { class: q.cls === "uncertain" ? "dma-action dma-action--blocking" : "dma-action dma-action--needsinput" },
                      el(
                        "div",
                        { class: "dt-row dt-gap-8" },
                        el("code", { class: "dma-code", style: { flex: "none" } }, q.object),
                        el("span", { class: "dt-grow" }),
                        badge(CLASSES[q.cls].label, CLASSES[q.cls].tone, { iconName: CLASSES[q.cls].icon })
                      ),
                      el("div", { class: "dt-text-small", style: wrap }, q.required)
                    )
                  )
              : el("div", { class: "dt-text-small dt-text-subdued" }, "Nothing outstanding. Every object this rule covers resolves cleanly.")
          )
        );

    /* --- Apply ------------------------------------------------------------- */
    const applyBar = el(
      "div",
      { class: ["dma-gate", changed ? "dma-gate--blocked" : null] },
      el(
        "div",
        { class: "dt-row dt-gap-12" },
        el(
          "span",
          { class: changed ? "dt-text-critical" : "dt-text-subdued", style: { display: "inline-flex" } },
          icon(changed ? "alert" : "check", 20)
        ),
        el(
          "div",
          { class: "dt-stack dt-gap-4 dt-grow" },
          el("div", { class: "dt-text-semibold" }, changed ? `Apply to ${fmt.num(state.decides)} ${state.decidesLabel}` : "Nothing to apply"),
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: wrap },
            changed
              ? `One write at project scope. Every index resolves from it immediately, and the ${ed.overrides} overrides are left alone.`
              : "The rule matches what was confirmed. Changes here are a single value, applied everywhere at once."
          )
        ),
        changed
          ? el(
              "div",
              { class: "dt-row dt-gap-8" },
              button("Discard", { variant: "default", onClick: () => DMA.store.setSession("globalMapStrategy", ed.confirmed) }),
              button(`Apply — returns ${fmt.num(frozenAssets)} assets to translation`, { variant: "critical", iconName: "refresh" })
            )
          : button("Apply", { variant: "emphasized", iconName: "check", disabled: true })
      )
    );

    return el("div", { class: "dt-stack dt-gap-16" }, header, premise, decisionCard, resolutionCard, impactCard, exceptionCard, applyBar);
  }

  /* --- Step 1: Rule set ----------------------------------------------------- */
  /* Seven rules, each with a suggested default already filled in. The point of
     the screen is that it is seven things long, not 1,236. */
  function stepRules() {
    const open = currentRule();
    if (open) return ruleEditor(open);

    const rs = DMA.data.ruleset;
    const totals = rs.triageTotals();
    const conf = rs.confirmation;
    const objectCount = rs.objectTypes.reduce((n, o) => n + o.count, 0);
    const edited = Object.values(rs.rules).filter((r) => r.state === "edited").length;
    const ruleCount = DMA.data.mapping.globalRules.length;

    const ruleBlock = (rule) => {
      const state = rs.rules[rule.id];
      return el(
        "div",
        { class: ["dma-rule", state.state === "edited" ? "dma-rule--edited" : null] },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("div", { class: "dt-text-medium dt-grow" }, rule.name),
          el(
            "span",
            { class: "dt-text-small dt-text-subdued" },
            `${fmt.num(state.decides)} ${state.decidesLabel}${state.reach ? ` · reaches ${fmt.num(state.reach)} assets` : ""}`
          ),
          state.state === "edited"
            ? badge("Default edited", "warning", { iconName: "edit" })
            : badge("Default accepted", "success", { iconName: "check" })
        ),
        el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, rule.detail),
        el(
          "div",
          { class: "dma-rule__value" },
          el("span", { class: "dt-text-small dt-text-subdued" }, "Suggested"),
          el("code", { class: ["dma-code", state.state === "edited" ? "dma-code--from" : null] }, state.suggested)
        ),
        state.state === "edited"
          ? el(
              "div",
              { class: "dma-rule__value" },
              el("span", { class: "dt-text-small dt-text-subdued" }, "In effect"),
              el("code", { class: "dma-code dma-code--to" }, state.editedTo)
            )
          : null,
        el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, `Suggested because: ${state.basis}`),
        state.state === "edited"
          ? el(
              "div",
              { class: "dt-text-small dt-text-secondary", style: wrap },
              `Changed by ${state.editedBy}, ${fmt.date(state.editedAt)} — ${state.editedWhy}`
            )
          : null,
        el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, `Why this is global: ${rule.why}`),
        el(
          "div",
          { class: "dt-row dt-gap-12" },
          el("div", { class: "dt-grow" }, triageSplit(state.triage)),
          button("Edit rule", {
            variant: "default",
            size: "sm",
            iconName: "sliders",
            onClick: () => openRule(rule.id),
          })
        )
      );
    };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Global rules", String(ruleCount), "Each decided once, applied estate-wide", { iconName: "map" }),
        kpi("Configuration decisions", fmt.num(totals.total), `Across ${fmt.num(objectCount)} configuration objects`, { iconName: "database" }),
        kpi("Defaults accepted as-is", `${ruleCount - edited} of ${ruleCount}`, `${edited} edited before confirming`, {
          iconName: "check",
          tone: "success",
        }),
        kpi("Rule set version", `v${conf.version}`, `Confirmed ${fmt.date(conf.confirmedAt)} · v${conf.pendingVersion} pending`, {
          iconName: "lock",
        })
      ),
      banner(
        "info",
        "No rule starts blank. Each one opens with a value DMA derived from the imported configuration, together with the evidence behind it — so the work is reviewing a proposal rather than deriving one. Two of the seven were changed here, and both changes are recorded against a reason.",
        { title: "Every rule arrives with a suggested default" }
      ),
      card(
        {
          title: "Seven decisions, not five lists",
          subtitle: "What the live product asks you to navigate, and which single rule settles it here",
          flush: true,
        },
        table(
          [
            { label: "Today's tab", width: "190px", render: (o) => el("span", { class: "dt-text-medium" }, o.label) },
            { label: "Objects", width: "90px", render: (o) => el("span", { class: "dt-tnum" }, fmt.num(o.count)) },
            {
              label: "Settled here by",
              width: "210px",
              render: (o) => badge(DMA.data.ruleset.ruleName(o.decidedBy), "neutral", { iconName: "map" }),
            },
            { label: "Note", render: (o) => el("span", { class: "dt-text-small dt-text-secondary", style: wrap }, o.note) },
          ],
          rs.objectTypes
        )
      ),
      card(
        { title: "The rule set", subtitle: "Ordered by the decision, not by the object type it happens to touch" },
        el("div", { class: "dt-stack dt-gap-12" }, DMA.data.mapping.globalRules.map(ruleBlock))
      ),
      card(
        { title: "Why the decision surface is this uneven" },
        el(
          "div",
          { class: "dt-text-small dt-text-secondary", style: wrap },
          "One naming template reaches 2,955 assets. One bucket rule has to be right 1,236 times. Two query guardrails are two sentences. Organising by object type flattens all of that into lists of equal-looking rows, which is why a consultant spends the same attention on a guardrail as on the index that carries 840 GB a day. Organising by decision keeps the weight visible."
        )
      )
    );
  }

  /* --- Step 2: Field handling ---------------------------------------------- */
  /* The translator already rewrites seven fields and discards six more on every
     query it touches. None of that is configuration today — which is why the
     live Field Mappings tab reads 0 while thirteen decisions are being made. */
  function stepFields() {
    const m = DMA.data.mapping;
    const t = m.translator;
    const collisions = t.builtIns.filter((b) => b.collision).length;

    const layerRow = (scope, i) =>
      el(
        "div",
        { class: ["dma-layer", scope.readOnly ? "dma-layer--readonly" : null] },
        el("span", { class: "dma-layer__num" }, String(i)),
        el(
          "div",
          { class: "dt-stack dt-gap-4 dt-grow" },
          el(
            "div",
            { class: "dt-row dt-gap-8" },
            el("span", { class: "dt-text-medium dt-grow" }, scope.label),
            scope.setAt
              ? badge(scope.setAt === "global-mapping" ? "Set on this stage" : "Set at Wave Mapping", scope.setAt === "global-mapping" ? "primary" : "neutral")
              : badge("Built in", "info", { iconName: "lock" })
          ),
          el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, scope.note)
        )
      );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Built-in field mappings", String(t.builtIns.length), "Applied before any rule runs", { iconName: "zap" }),
        kpi("Fields discarded", String(t.dropped.length), "No target-side meaning — queries on them return nothing", {
          iconName: "x",
          tone: "warning",
        }),
        kpi("Target collisions", String(collisions), "Two source fields resolving to one target", { iconName: "alert", tone: "critical" }),
        kpi("Shown in the live product", "0", "The Field Mappings tab has never had a row in it", { iconName: "helpCircle" })
      ),
      banner(
        "warning",
        "These thirteen decisions are already being made on every translated query. Today they are behaviour rather than configuration, so the only way to discover that sourcetype and source collapse into one field is to notice a published dashboard filtering on both and returning nothing. Making them a visible, overridable layer costs nothing and removes a whole class of post-deploy surprise.",
        { title: "Layer zero was always there — it just had no surface" }
      ),
      card(
        {
          title: "The cascade",
          subtitle: "Applied in order. Each layer may override the one above it, and the UI always names which layer won.",
        },
        el("div", { class: "dt-stack dt-gap-8" }, m.scopes.map(layerRow)),
        el(
          "div",
          { class: "dt-text-small dt-text-secondary", style: { ...wrap, marginTop: "var(--dt-spacing-12)" } },
          m.principle + " Layers 2 and 3 are set at Wave Mapping; this stage owns layers 0 and 1 — layer 0 by making it visible, layer 1 by setting it."
        )
      ),
      card(
        {
          title: "Translator built-ins",
          subtitle: "Read-only by default, overridable per project",
          flush: true,
        },
        table(
          [
            { label: "Splunk field", width: "140px", render: (b) => el("code", { class: "dma-code" }, b.from) },
            {
              label: "",
              width: "32px",
              render: () => el("span", { class: "dt-text-subdued", style: { display: "inline-flex" } }, icon("arrowRight", 13)),
            },
            { label: "Dynatrace field", width: "160px", render: (b) => el("code", { class: "dma-code dma-code--to" }, b.to) },
            {
              label: "Behaviour",
              render: (b) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4", style: { alignItems: "flex-start" } },
                  el("span", { class: "dt-text-small dt-text-secondary", style: wrap }, b.why),
                  b.collision ? badge(`Collides on ${b.collision}`, "critical", { iconName: "alert" }) : null
                ),
            },
            {
              label: "",
              width: "110px",
              render: () => button("Override", { variant: "default", size: "sm", iconName: "edit" }),
            },
          ],
          t.builtIns
        )
      ),
      card(
        {
          title: "Fields the translator discards",
          subtitle: "Dropped is not the same as unmapped — a query filtering on one of these returns nothing, silently",
          actions: button("Map a dropped field", { variant: "default", size: "sm", iconName: "upload" }),
        },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          t.dropped.map((d) =>
            el(
              "div",
              { class: "dma-gateitem" },
              el("code", { class: "dma-code", style: { flex: "none", minWidth: "76px" } }, d.field),
              el("span", { class: "dt-text-small dt-text-secondary dt-grow", style: wrap }, d.why),
              badge("Dropped", "neutral", { iconName: "x" })
            )
          )
        )
      )
    );
  }

  /* --- Step 3: Triage ------------------------------------------------------- */
  /* The same three-bucket shape Asset-to-Asset Validation uses after
     translation, run before it. Fits Default is the pile nobody opens. */
  function stepTriage() {
    const rs = DMA.data.ruleset;
    const totals = rs.triageTotals();
    const touched = totals.needs + totals.uncertain;
    const filter = DMA.store.session.globalMapTriage || "all";
    const queue = filter === "all" ? rs.queue : rs.queue.filter((q) => q.cls === filter);

    const filterBtn = (id, label, count) =>
      el(
        "button",
        {
          class: ["dt-btn", "dt-btn--sm", filter === id ? "dt-btn--emphasized" : "dt-btn--default"],
          "aria-pressed": String(filter === id),
          onClick: () => DMA.store.setSession("globalMapTriage", id),
        },
        label,
        /* Not `dt-text-subdued`. That token is a fixed grey chosen to sit on a
           container background, and the selected filter is a filled purple
           button — grey on that fill measures 1.04:1, which is not "subdued",
           it is gone. Dimming `currentColor` instead means the count tracks
           whatever the button's own text colour is, so it stays legible on the
           filled and the outline variant, in both themes, with no second rule
           to keep in sync.

           0.8 rather than something lower because the selected button is the
           binding case: white on the dark-theme accent fill tops out at 4.31:1
           even undimmed, so the button's own label already misses AA and the
           count has very little headroom to spend. 0.8 buys the hierarchy
           (3.36:1 dark, 4.86:1 light) without pretending the ceiling is higher
           than it is — raising it is a token fix in the accent colour, not a
           fix here. */
        el("span", { style: { opacity: 0.8 } }, String(count))
      );

    const queueItem = (q) => {
      const c = CLASSES[q.cls];
      return el(
        "div",
        { class: ["dma-action", q.cls === "uncertain" ? "dma-action--blocking" : "dma-action--needsinput"] },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("code", { class: "dma-code", style: { flex: "none" } }, q.object),
          el("span", { class: "dt-grow" }),
          badge(DMA.data.ruleset.ruleName(q.rule), "neutral", { iconName: "map" }),
          badge(c.label, c.tone, { iconName: c.icon })
        ),
        el("div", { class: "dt-text-small", style: wrap }, q.required),
        el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, q.context),
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("span", { class: "dt-grow dt-text-small dt-text-subdued" }, q.id),
          button("Open", { variant: "default", size: "sm", iconName: "chevronR" }),
          button(q.cls === "uncertain" ? "Resolve" : "Supply input", { variant: "emphasized", size: "sm", iconName: "sliders" })
        )
      );
    };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Fits Default", fmt.num(totals.fits), `${fmt.pct((totals.fits / totals.total) * 100, 1)} of the decision surface — applied, editable, unopened`, {
          iconName: "check",
          tone: "success",
        }),
        kpi("Needs Configuration", fmt.num(totals.needs), "Structurally clear, waiting on one named input", { iconName: "sliders", tone: "warning" }),
        kpi("Uncertain", fmt.num(totals.uncertain), "Low confidence — blocks confirmation until resolved", { iconName: "helpCircle", tone: "critical" }),
        kpi("Reviewer touches", fmt.num(touched), `Instead of all ${fmt.num(totals.total)}`, { iconName: "users" })
      ),
      card(
        { title: "Where the attention goes", subtitle: `${fmt.num(totals.total)} configuration decisions across the estate` },
        stackedProgress([
          { value: (totals.fits / totals.total) * 100, tone: "success", label: CLASSES.fits.label },
          { value: (totals.needs / totals.total) * 100, tone: "warning", label: CLASSES.needs.label },
          { value: (totals.uncertain / totals.total) * 100, tone: "critical", label: CLASSES.uncertain.label },
        ]),
        el(
          "div",
          { class: "dt-text-small dt-text-secondary", style: { ...wrap, marginTop: "var(--dt-spacing-12)" } },
          "Needs Configuration is a third bucket, not a softer Uncertain. It means the mapping is structurally clear and one specific input is missing — a bucket that does not exist yet, a lookup with no key column. Uncertain means DMA does not know what the right answer looks like. Collapsing the two produces a single queue of 205 items that all read 'needs review', and the 42 that actually need judgement get the same two minutes as the 163 that need a name typed in."
        )
      ),
      card(
        { title: "Triage by rule", subtitle: "Confidence is not evenly distributed — two rules carry 36 of the 42 Uncertain", flush: true },
        table(
          [
            { label: "Rule", width: "230px", render: (r) => el("span", { class: "dt-text-medium" }, r.name) },
            {
              label: "Decisions",
              width: "150px",
              render: (r) =>
                el("span", { class: "dt-text-small dt-text-secondary" }, `${fmt.num(rs.rules[r.id].decides)} ${rs.rules[r.id].decidesLabel}`),
            },
            { label: "Classification", render: (r) => triageSplit(rs.rules[r.id].triage) },
          ],
          DMA.data.mapping.globalRules
        )
      ),
      card(
        {
          title: "Resolution queue",
          subtitle: `A sample of the ${fmt.num(touched)} — every row names the specific input required, never "needs review"`,
          actions: el(
            "div",
            { class: "dt-row dt-gap-8" },
            filterBtn("all", "All", rs.queue.length),
            filterBtn("needs", CLASSES.needs.label, rs.queue.filter((q) => q.cls === "needs").length),
            filterBtn("uncertain", CLASSES.uncertain.label, rs.queue.filter((q) => q.cls === "uncertain").length)
          ),
        },
        el("div", { class: "dt-stack dt-gap-8" }, queue.map(queueItem))
      )
    );
  }

  /* --- Step 4: Confirm & lock ----------------------------------------------- */
  /* One decision over the rule set, not 2,955 decisions over assets. The
     per-asset confirmation belongs to Wave Mapping, where the asset is. */
  function stepConfirm() {
    const rs = DMA.data.ruleset;
    const totals = rs.triageTotals();
    const conf = rs.confirmation;
    const lock = DMA.data.mapping.lock;
    const locked = rs.lockState.filter((w) => w.state === "locked");
    const reopened = rs.lockState.filter((w) => w.state === "reopened");
    const open = rs.lockState.filter((w) => w.state === "open");
    const blocked = totals.uncertain > 0;

    const STATE = {
      locked:   { label: "Locked", tone: "neutral", icon: "lock" },
      reopened: { label: "Re-opened by manual review", tone: "warning", icon: "refresh" },
      open:     { label: "Open", tone: "success", icon: "edit" },
    };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Confirmed rule set", `v${conf.version}`, `${fmt.date(conf.confirmedAt)} · ${conf.confirmedBy}`, { iconName: "checkCircle", tone: "success" }),
        kpi("Blocking confirmation", fmt.num(totals.uncertain), `Uncertain decisions · v${conf.pendingVersion} cannot be confirmed above 0`, {
          iconName: "alert",
          tone: "critical",
        }),
        kpi("Waves frozen", String(locked.length), `${fmt.num(locked.reduce((n, w) => n + w.assets, 0))} assets translated against v${conf.version}`, {
          iconName: "lock",
        }),
        kpi("Waves still editable", String(open.length + reopened.length), `${reopened.length} returned through manual review`, { iconName: "edit" })
      ),
      el(
        "div",
        { class: ["dma-gate", blocked ? "dma-gate--blocked" : null] },
        el(
          "div",
          { class: "dt-row dt-gap-12" },
          el("span", { class: blocked ? "dt-text-critical" : "dt-text-success", style: { display: "inline-flex" } }, icon(blocked ? "alert" : "checkCircle", 20)),
          el(
            "div",
            { class: "dt-stack dt-gap-4 dt-grow" },
            el("div", { class: "dt-text-semibold" }, `Confirm rule set v${conf.pendingVersion}`),
            el(
              "div",
              { class: "dt-text-small dt-text-secondary", style: wrap },
              blocked
                ? `${fmt.num(totals.uncertain)} Uncertain decisions are outstanding. ${conf.rule}`
                : conf.rule
            )
          ),
          button(`Confirm v${conf.pendingVersion}`, { variant: "emphasized", iconName: "check", disabled: blocked })
        ),
        el(
          "div",
          { class: "dt-text-small dt-text-subdued", style: wrap },
          `${fmt.num(totals.needs)} Needs Configuration decisions carry forward — their inputs are known and can be supplied per wave. The guardrail is on Uncertain only, because an Uncertain decision is one where nobody has yet decided what correct looks like.`
        )
      ),
      banner(
        "info",
        "This stage confirms the rule set — one decision, seven rules. It does not confirm 2,955 assets. Per-asset confirmation happens at Wave Mapping, where the asset, its application override and its wave are all on screen at once. Splitting the gate that way is what stops the project-level sign-off from degenerating into a 2,955-row checklist nobody reads.",
        { title: "One gate here, a different gate at Wave Mapping" }
      ),
      card(
        { title: "Lock state by wave", subtitle: lock.waveScoped, flush: true },
        table(
          [
            {
              label: "Wave",
              width: "190px",
              render: (w) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-medium" }, `Wave ${w.wave} — ${w.name}`),
                  el("span", { class: "dt-text-small dt-text-subdued" }, `${fmt.num(w.assets)} assets`)
                ),
            },
            {
              label: "State",
              width: "190px",
              render: (w) => badge(STATE[w.state].label, STATE[w.state].tone, { iconName: STATE[w.state].icon }),
            },
            {
              label: "Since",
              width: "150px",
              render: (w) =>
                w.at
                  ? el(
                      "div",
                      { class: "dt-stack dt-gap-4" },
                      el("span", {}, fmt.date(w.at)),
                      el("span", { class: "dt-text-small dt-text-subdued" }, w.by)
                    )
                  : el("span", { class: "dt-text-subdued" }, "—"),
            },
            { label: "Detail", render: (w) => el("span", { class: "dt-text-small dt-text-secondary", style: wrap }, w.detail) },
          ],
          rs.lockState
        )
      ),
      card(
        { title: "The door back", subtitle: reopened.length ? `Exercised once — Wave ${reopened[0].wave}, ${fmt.date(reopened[0].at)}` : "Not yet exercised" },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, lock.rule),
          el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, lock.unlockPath),
          reopened.map((w) =>
            el(
              "div",
              { class: "dma-action dma-action--needsinput" },
              el(
                "div",
                { class: "dt-row dt-gap-8" },
                el("div", { class: "dt-text-medium dt-grow" }, `Wave ${w.wave} — ${w.name}`),
                badge(`${fmt.num(w.assets)} assets returned to translation`, "warning", { iconName: "refresh" })
              ),
              el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, w.detail),
              el("div", { class: "dt-text-small dt-text-subdued" }, `${w.by} · ${fmt.date(w.at)}`)
            )
          )
        )
      ),
      card(
        { title: "Why this locks and the translation profile does not" },
        el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, lock.contrast)
      )
    );
  }

  const PANELS = {
    rules: stepRules,
    fields: stepFields,
    triage: stepTriage,
    confirm: stepConfirm,
  };

  /* --- Registration ---------------------------------------------------------- */
  DMA.register({
    id: "global-mapping",
    title: "Global Mapping Configurations",
    shortTitle: "Global Mapping",
    phase: "extract",
    icon: "map",
    status: "ready",
    scope: "estate",
    summary: "Seven project-wide rules, each proposed with a default, triaged by confidence, and confirmed once before any translation consumes them.",

    ruleSet: "globalRules",
    steps: STEPS,

    notes: [
      "Organised by decision, not by object type. The live product splits this stage into five lists — 1,236 indexes in the first one — so the same bucket decision gets taken 1,236 times with no surface above the list to take it once.",
      "Nothing starts blank. Every rule opens with a value derived from the imported configuration plus the evidence behind it, so the work is reviewing a proposal rather than deriving one.",
      "The translator's thirteen built-in field decisions are shown as cascade layer zero. They already happen on every translated query; the live Field Mappings tab reads 0 because they have no surface, not because they do not exist.",
      "Needs Configuration is a third bucket, not a softer Uncertain. One is waiting on a named input, the other is waiting on judgement, and a single 'needs review' queue gives both the same two minutes.",
      "This stage confirms the rule set — one decision. Per-asset confirmation belongs to Wave Mapping, where the asset, its application override and its wave are all on screen together.",
      "Rules lock per wave on first translation. Wave 4 shows the only door back: a manual review that explicitly returns its 518 assets to translation after the re-plan introduced indexes the confirmed set had never classified.",
      "No LOE or complexity score anywhere on this stage. Every table in the live product carries them and neither changes a decision taken here.",
    ],

    render(root, ctx) {
      root.append(
        ctx.pageHeader([
          button("Re-run triage", { variant: "default", iconName: "refresh" }),
          button("Export rule set", { variant: "emphasized", iconName: "fileText" }),
        ]),
        stepper(),
        PANELS[currentStep()](ctx)
      );
    },
  });
})();
