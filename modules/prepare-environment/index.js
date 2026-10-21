/* ============================================================================
   MODULE: Prepare Environment
   ----------------------------------------------------------------------------
   Flow-diagram stage: Setup Project → Prepare Environment

   Run by the ARCHITECT, not the SSD who ran Qualify & Scope. Different person,
   different question: Qualify & Scope asks what we are migrating, this asks
   whether the place we are migrating into can receive it.

   Runs in PARALLEL with Import & Qualify. The PRD guardrail is ~0 added
   sequential days, so the screen states what it runs alongside rather than
   implying a queue.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, progress, fmt } = DMA.ui;

  const STEPS = [
    { id: "assess",   label: "Assess environment" },
    { id: "actions",  label: "Architect actions" },
    { id: "template", label: "Applied defaults" },
    { id: "gate",     label: "Readiness gate" },
  ];

  function currentStep() {
    const id = DMA.store.session.envStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  function stepper() {
    const active = currentStep();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Prepare Environment steps" });

    STEPS.forEach((step, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(step.id === active),
            onClick: () => DMA.store.setSession("envStep", step.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, step.label)
        )
      );
    });

    return row;
  }

  const SIGNAL_TONE = { pass: "success", fail: "critical", warn: "warning", pending: "subdued" };
  const SIGNAL_ICON = { pass: "check", fail: "x", warn: "alert", pending: "clock" };

  function signalRow(s) {
    return el(
      "li",
      { class: "dma-signal" },
      el("span", { class: `dt-text-${SIGNAL_TONE[s.state]}`, style: { display: "inline-flex", marginTop: "2px" } }, icon(SIGNAL_ICON[s.state], 13)),
      el(
        "div",
        { class: "dt-stack dt-gap-4 dt-grow" },
        el("span", { class: "dt-text-small" }, s.label),
        el("span", { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } }, s.detail)
      )
    );
  }

  /* --- Step 1: Assess environment ----------------------------------------- */
  /* The Transformation Journey shape — domains scored against a required
     level — applied to tenant state instead of organisational practice. */
  function stepAssess() {
    const env = DMA.data.environment;
    const bar = env.requiredLevel;
    const overall = env.overallLevel();
    const level = env.levels.find((l) => l.level === Math.floor(overall)) || env.levels[0];
    const shortOf = env.domains.filter((d) => d.current < bar);

    const scale = el(
      "div",
      { class: "dma-scale" },
      env.levels.map((l) =>
        el(
          "div",
          { class: ["dma-scale__step", l.level === bar ? "dma-scale__step--bar" : null, l.level <= Math.floor(overall) ? "dma-scale__step--reached" : null] },
          el("div", { class: "dma-scale__num" }, String(l.level)),
          el("div", { class: "dt-text-small dt-text-semibold" }, l.name),
          el("div", { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } }, l.detail),
          l.level === bar ? el("div", { class: "dma-scale__flag" }, "Required to import") : null
        )
      )
    );

    const domainCard = (d) => {
      const met = d.current >= bar;
      return el(
        "div",
        { class: ["dma-domain", met ? null : "dma-domain--short"] },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el(
            "div",
            { class: "dt-stack dt-gap-4 dt-grow" },
            el("div", { class: "dt-text-medium" }, d.name),
            el("div", { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } }, d.what)
          ),
          el(
            "div",
            { class: "dma-domain__score" },
            el("span", { class: ["dma-domain__current", met ? "dt-text-success" : "dt-text-warning"] }, d.current.toFixed(1)),
            el("span", { class: "dt-text-small dt-text-subdued" }, `/ ${bar.toFixed(1)}`)
          )
        ),
        progress((d.current / 5) * 100, met ? "success" : "warning"),
        d.manualOnly
          ? badge(`Not system-checkable · ${d.owner}`, "neutral", {
              iconName: "lock",
              title: "Access control is owned by the platform-IAM team. DMA tracks it as a sign-off line rather than checking it.",
            })
          : null,
        el("ul", { class: "dma-signals" }, d.signals.map(signalRow))
      );
    };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      banner("info", env.parallel.note, {
        title: `Running in parallel with ${env.parallel.stage}`,
        action: badge(`+${env.parallel.addedDays} days to critical path`, "success"),
      }),
      card(
        {
          title: "Environment maturity",
          subtitle: `Assessed by ${env.architect.name}, ${env.architect.role} · ${env.tenant.generation} · ${env.tenant.region}`,
          actions: badge(`Overall ${overall.toFixed(1)} — ${level.name}`, overall >= bar ? "success" : "warning"),
        },
        scale,
        el(
          "div",
          { style: { marginTop: "var(--dt-spacing-16)" } },
          shortOf.length
            ? banner(
                "warning",
                `${shortOf.length} of ${env.domains.length} domains sit below the Migration-ready bar: ${shortOf.map((d) => d.name).join(", ")}. Each one has produced a named action rather than a generic "not ready" flag.`
              )
            : banner("success", "Every domain is at or above the Migration-ready bar.")
        )
      ),
      card(
        { title: "Readiness by domain", subtitle: "Scores are computed from the signals beneath them — nothing here is typed in by hand" },
        el("div", { class: "dma-domains" }, env.domains.map(domainCard))
      )
    );
  }

  /* --- Step 2: Architect actions ------------------------------------------ */
  /* The reason the assessment exists. A score nobody can act on is a report. */
  function stepActions() {
    const env = DMA.data.environment;
    const open = env.openActions();
    const blocking = env.openActions(true);
    const resolved = env.actions.filter((a) => a.status === "resolved");
    const domainName = (id) => env.domains.find((d) => d.id === id)?.name || id;

    const actionRow = (a) =>
      el(
        "div",
        { class: ["dma-action", a.blocking ? "dma-action--blocking" : null, a.status === "resolved" ? "dma-action--done" : null] },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el(
            "div",
            { class: "dt-stack dt-gap-4 dt-grow" },
            el("div", { class: "dt-text-medium" }, a.title),
            el("div", { class: "dt-text-small dt-text-subdued" }, domainName(a.domain))
          ),
          a.status === "resolved"
            ? badge(`Resolved ${fmt.dateShort(a.resolvedAt)}`, "success", { iconName: "check" })
            : a.blocking
            ? badge("Blocks import", "critical")
            : badge("Advisory", "neutral")
        ),
        el("div", { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } }, a.detail),
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el(
            "span",
            { class: "dt-text-small dt-text-subdued dt-grow dt-row dt-gap-4" },
            icon(a.external ? "externalLink" : "users", 12),
            a.owner
          ),
          a.status === "open" && a.autoFix ? button(a.autoFixLabel, { variant: "emphasized", size: "sm", iconName: "zap" }) : null,
          a.status === "open" && !a.autoFix && !a.external ? button("Mark resolved", { variant: "default", size: "sm", iconName: "check" }) : null,
          a.status === "open" && a.external ? button("Request confirmation", { variant: "default", size: "sm", iconName: "bell" }) : null
        )
      );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      banner(
        blocking.length ? "warning" : "success",
        blocking.length
          ? `${blocking.length} of ${open.length} open actions block the import. Each names the specific object at fault — which index lacks a bucket, which forwarder went silent — because "environment not ready" is not something anyone can act on.`
          : "No blocking actions outstanding.",
        { title: blocking.length ? "Blocking actions outstanding" : "Environment clear" }
      ),
      card(
        { title: "Open actions", subtitle: `Owned by ${env.architect.name} unless stated otherwise` },
        el("div", { class: "dt-stack dt-gap-12" }, open.map(actionRow))
      ),
      resolved.length
        ? card(
            { title: "Resolved", subtitle: "Kept visible so the environment has a history, not just a current state" },
            el("div", { class: "dt-stack dt-gap-12" }, resolved.map(actionRow))
          )
        : null
    );
  }

  /* --- Step 3: Applied defaults ------------------------------------------- */
  function stepTemplate() {
    const t = DMA.data.environment.template;
    const totalOverrides = t.items.reduce((n, i) => n + i.overrides, 0);

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      banner(
        "info",
        "DMA is making configuration decisions on the customer's tenant, so nothing is applied silently. Every default is previewed, every override is recorded, and the template itself is config-managed — PM/ops can change it without an engineering release.",
        { title: `${t.name} ${t.version}` }
      ),
      card(
        {
          title: "Applied defaults",
          subtitle: `${t.source} · applied ${fmt.date(t.appliedAt)} by ${t.appliedBy}`,
          actions: badge(`${totalOverrides} overrides`, totalOverrides ? "warning" : "neutral"),
          flush: true,
        },
        table(
          [
            {
              label: "Default",
              render: (r) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-medium" }, r.label),
                  r.note ? el("span", { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } }, r.note) : null
                ),
            },
            { label: "Applied", width: "100px", render: (r) => fmt.num(r.applied) },
            {
              label: "Overridden",
              width: "110px",
              render: (r) =>
                r.overrides
                  ? el("span", { class: "dt-text-warning dt-text-semibold" }, fmt.num(r.overrides))
                  : el("span", { class: "dt-text-subdued" }, "—"),
            },
            {
              label: "",
              width: "110px",
              render: () => button("Override", { variant: "default", size: "sm", iconName: "edit" }),
            },
          ],
          t.items
        )
      ),
      card(
        { title: "Why overrides are recorded, not hidden" },
        el(
          "div",
          { class: "dt-text-small dt-text-secondary", style: { whiteSpace: "normal" } },
          "An override changes this environment only — it never edits the template other projects inherit. Keeping the count visible is what makes it possible to tell a tenant that genuinely needed special handling from one where the template was simply wrong and should be updated at source."
        )
      )
    );
  }

  /* --- Step 4: Readiness gate --------------------------------------------- */
  /* The stage's exit. Blocking by design: the signals already exist, so the
     only thing a soft warning would add is someone to blame later. */
  function stepGate() {
    const g = DMA.data.environment.gate;
    const blockers = DMA.data.environment.gateBlockers();
    const passed = g.items.filter((i) => i.status === "pass").length;

    const GATE_TONE = { pass: "success", fail: "critical", pending: "warning" };
    const GATE_ICON = { pass: "checkCircle", fail: "x", pending: "clock" };

    const gateRow = (i) =>
      el(
        "div",
        /* No `--pass` modifier. A passing item is the base style — only fail
           and pending tint the row, because a gate where every row is coloured
           is a gate where nothing stands out. Templating the status in blindly
           emitted `dma-gateitem--pass`, a class with no rule behind it, which
           reads as an undefined selector in a CSS audit and invites someone to
           either delete the real modifiers or add a tint nobody asked for. */
        { class: ["dma-gateitem", i.status !== "pass" ? `dma-gateitem--${i.status}` : null] },
        el("span", { class: `dt-text-${GATE_TONE[i.status]}`, style: { display: "inline-flex" } }, icon(GATE_ICON[i.status], 16)),
        el(
          "div",
          { class: "dt-stack dt-gap-4 dt-grow" },
          el("div", { class: "dt-text-medium" }, i.label),
          el("div", { class: "dt-text-small dt-text-subdued", style: { whiteSpace: "normal" } }, i.detail)
        ),
        badge(i.kind === "auto" ? "Auto" : "Manual", i.kind === "auto" ? "info" : "neutral", {
          title:
            i.kind === "auto"
              ? "Derived from a signal DMA already computes — no manual re-entry"
              : "Cannot be system-verified. Requires an explicit confirmation, recorded with who and when.",
        }),
        i.kind === "manual" && i.status === "pending"
          ? button("Confirm", { variant: "default", size: "sm", disabled: i.id === "signoff" && blockers.length > 1, title: i.id === "signoff" && blockers.length > 1 ? "Unlocks once every item above passes" : null })
          : null
      );

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      banner(
        "warning",
        `Signed off ${fmt.date(g.originalSignOff.at)} by ${g.originalSignOff.by} for ${g.originalSignOff.scope}. Re-opened ${fmt.date(g.reopenedAt)} — ${g.reopenedBy}. The environment is re-assessed as scope grows, so a sign-off covers a scope rather than the project.`,
        { title: "Gate re-opened" }
      ),
      card(
        {
          title: "Readiness checklist",
          subtitle: "Import & Qualify cannot proceed for the new scope until every item passes",
          actions: badge(`${passed} of ${g.items.length} passed`, blockers.length ? "warning" : "success"),
        },
        el("div", { class: "dt-stack dt-gap-8" }, g.items.map(gateRow))
      ),
      card(
        { title: "What this gate deliberately is not" },
        el(
          "ul",
          { class: "dt-stack dt-gap-6", style: { margin: 0, paddingLeft: "18px" } },
          [
            "Not bypassable. A warning everyone clicks through is the state we already have.",
            "Not a rules-authoring UI. The criteria list is config-managed by PM/ops; consultants confirm it, they do not define it.",
            "Not a default pass. Anything DMA cannot verify — IAM above — needs a person to say so, recorded with their name and the time.",
          ].map((t) => el("li", { class: "dt-text-small dt-text-secondary" }, t))
        )
      )
    );
  }

  const PANELS = {
    assess: stepAssess,
    actions: stepActions,
    template: stepTemplate,
    gate: stepGate,
  };

  /* --- Registration ------------------------------------------------------- */
  DMA.register({
    id: "prepare-environment",
    title: "Prepare Environment",
    phase: "setup",
    icon: "server",
    status: "ready",
    scope: "estate",
    summary: "Confirm the target Dynatrace environment is mature enough to import into. Runs in parallel with Import & Qualify.",

    steps: STEPS,

    notes: [
      "Run by the Architect, not the SSD. Qualify & Scope asks what we are migrating; this asks whether the tenant can receive it — different question, different person, different evidence.",
      "The maturity model borrows its shape from the Dynatrace Transformation Journey — six domains, 1–5 scoring, current against a required level — but scores tenant state rather than organisational practice. The bar is level 4, Migration-ready, not level 5: a migration needs a sufficient environment, not an optimised one.",
      "Scoring is not the deliverable. Every domain below the bar emits a specific owned action naming the object at fault, because 'environment not ready' is not something an Architect can act on.",
      "IAM, SSO, and RBAC stay outside DMA's reach — the platform-IAM team owns them. They are tracked as manual sign-off lines so the boundary is visible instead of being quietly absorbed.",
      "First iteration is the checklist. The maturity assessment and generated actions are the target state and are marked Proposed in the roadmap overlay.",
    ],

    render(root, ctx) {
      root.append(
        ctx.pageHeader([
          button("Re-assess environment", { variant: "default", iconName: "refresh" }),
          button("Export readiness report", { variant: "emphasized", iconName: "fileText" }),
        ]),
        stepper(),
        PANELS[currentStep()](ctx)
      );
    },
  });
})();
