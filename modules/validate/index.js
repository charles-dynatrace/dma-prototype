/* ============================================================================
   MODULE: Validate
   ----------------------------------------------------------------------------
   Flow-diagram stage: Transform → Auto-Validate & Route

   Compares every translated asset against its Splunk original, auto-approves
   the ones that match, and routes the rest to a human with a written finding.

   ----------------------------------------------------------------------------
   THE SHAPE: ONE MACHINE VERDICT, TWO HUMAN DISAGREEMENTS

   The comparison produces one of three classifications and nothing else:
   Match, Meaningful Difference, Uncertain. Every asset resolves to exactly
   one. That is the P0 PRD and it is not negotiable here.

   What this screen adds is that a human can disagree with that verdict in
   BOTH directions, and the two disagreements are different events happening
   at different points in the wave's life:

     TRIAGE        pre-deploy.  Machine said FAIL. The asset is not live.
     (step 2)      A human overrides it — publishes DQL nobody could prove
                   equivalent — or sends it to Exceptions for rework.

     LIVE REVIEW   post-deploy. Machine said PASS. The asset is already in the
     (step 3)      customer's tenant. A human confirms it, or fails it with a
                   comment, which routes a LIVE asset back into the manual
                   translation and validation workflow.

   These are deliberately two surfaces and not one filtered queue. The P1 PRD
   says the two entry points "may need different UI flows and different
   redeploy mechanics, not a single shared screen", and the reason is visible
   the moment you merge them: one list would flatten the difference between
   "not shipped yet" and "shipped and wrong", which is the most consequential
   distinction on this stage. A row in Triage costs a reviewer ten minutes. A
   row in Live Review has been paging someone's on-call since Oct 18.

   ----------------------------------------------------------------------------
   THE CUSTOMER IS A VALUE IN A FIELD, NOT A SECOND VIEW

   The customer reviews these assets in their own tenant, and the consultant
   reviews them too. That is two audiences for one screen — and this prototype
   has no persona switcher and is not getting one. So reviewer identity is an
   attribute of the validation record: every verdict and every review carries a
   name and a role, rendered as a badge. The PRD's immutable audit log (F-7)
   already requires us to persist exactly that, so attribution is not a
   concession to the single-view decision, it is a thing we owed anyway.

   ----------------------------------------------------------------------------
   WHAT THIS STAGE DELIBERATELY DOES NOT DO

   No DQL editor. No natural-language context box. No re-translate button.
   Validate owns the VERDICT and the ROUTING DECISION; Exceptions owns the
   REWORK. A failed review captures the comment and hands off — the same strict
   boundary Translate drew between "runnable" and "correct", applied one stage
   later. features.js attributes every one of those controls to `exceptions`,
   and building them twice is how two stages start disagreeing about an asset.

   No side-by-side diff either. Similarity Score + Diff View is P2. What P0
   asks for is a persisted confidence score (F-3) and a SPECIFIC written
   finding (F-5) — "returns 12,400 rows in Splunk and 9,810 in Dynatrace for
   the same time range", never a bare "different". Prose at that bar does the
   reviewer's job; a diff widget would only look like it did.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, progress, stackedProgress, field, modal, fmt } = DMA.ui;

  const STEPS = [
    { id: "comparison", label: "Comparison" },
    { id: "triage",     label: "Triage" },
    { id: "live",       label: "Live review" },
    { id: "record",     label: "Record" },
  ];

  const wrap = { whiteSpace: "normal" };
  const V = () => DMA.data.validation;
  const PR = () => DMA.data.project;

  function step() {
    const id = DMA.store.session.vaStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  function selectedWave() {
    const id = DMA.store.session.waveId;
    if (!id || id === "all") return null;
    return PR().waves.find((w) => String(w.id) === String(id)) || null;
  }

  /* Three modes, derived from the wave's position in the flow and never from a
     flag in this module — same rule Translate follows, for the same reason: the
     rail and this screen must not be able to disagree about Wave 6.

       complete      waves 1–2   compared, triaged, published. Live review open.
       in-progress   waves 3–4   compared. Triage open. Nothing is live.
       not-started   waves 5–6   has not translated. Nothing to compare. */
  const modeFor = (wave) => DMA.data.waveStageStatus(wave, "validate");

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

  const note = (t) => el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, t);
  const subdued = (t) => el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, t);
  const kpiRow = (...k) => el("div", { class: ["dt-grid", `dt-grid-${k.length}`] }, ...k);

  const appName = (id) => {
    const a = DMA.data.planning.applications.find((x) => x.id === id);
    return a ? a.name : id;
  };

  /* --- Demo state ----------------------------------------------------------
     A verdict or review the viewer records during the demo lives in the
     session and shadows the fixture. Everything downstream reads through
     `withState`, so a row, its audit trail and the record step cannot disagree
     about what a human decided. */
  const verdictKey = (a) => "vaV" + a.id;
  const reviewKey = (a) => "vaR" + a.id;

  const withState = (a) =>
    Object.assign({}, a, {
      verdict: DMA.store.session[verdictKey(a)] || a.verdict || null,
      review: DMA.store.session[reviewKey(a)] || a.review || null,
    });

  const rowsFor = (waveId, surface, type) => V().assetsFor(waveId, surface, type).map(withState);

  /* A verdict given in this session has to move the counters, not just the
     badge on its own row. The fixture's triage split is the state as the wave
     was left; every decision taken here is applied on top of it. Without this
     the demo reads as a dead end — you override an asset, the row restyles,
     and "Awaiting a verdict 82" sits there contradicting it.

     Only assets the fixture left undecided are counted, so re-rendering or
     revisiting the step can never double-count a decision. The per-wave totals
     (82 open in Wave 3) cover the whole routed population; the fixture carries
     a representative handful of those as inspectable rows, which is why
     deciding one row moves the total by exactly one. */
  function triageState(waveId) {
    const base = V().triageFor(waveId);
    if (!base) return base;
    let { overridden, toExceptions, open } = base;
    V()
      .assetsFor(waveId, "triage")
      .forEach((a) => {
        if (a.verdict) return; // already reflected in the fixture split
        const s = DMA.store.session[verdictKey(a)];
        if (!s) return;
        open -= 1;
        if (s.decision === "override") overridden += 1;
        else toExceptions += 1;
      });
    return Object.assign({}, base, { overridden, toExceptions, open });
  }

  /* Same rule for the post-deploy surface: a pass or a fail recorded here
     counts against the reviewed population immediately. The match/override
     split has to move with it — the whole argument of this stage is that those
     two failure sources are different quantities, so a banner that keeps
     reporting the fixture's 1-and-1 under a headline that now says 3 would be
     undermining the point it is making. */
  function liveState(waveId) {
    const base = V().liveFor(waveId);
    if (!base) return base;
    let { reviewed, confirmed, failed } = base;
    const failedFrom = Object.assign({}, base.failedFrom);
    V()
      .assetsFor(waveId, "live")
      .forEach((a) => {
        if (a.review) return;
        const s = DMA.store.session[reviewKey(a)];
        if (!s) return;
        reviewed += 1;
        if (s.decision === "confirmed") {
          confirmed += 1;
        } else {
          failed += 1;
          const viaOverride = (DMA.store.session[verdictKey(a)] || a.verdict || {}).decision === "override";
          failedFrom[viaOverride ? "override" : "match"] += 1;
        }
      });
    return Object.assign({}, base, { reviewed, confirmed, failed, failedFrom, unreviewed: base.population - reviewed });
  }

  /* --- Shared bits of row rendering ---------------------------------------- */

  function who(id, opts = {}) {
    const r = V().reviewer(id);
    return badge(r.name, V().ROLE_TONE[r.role] || "neutral", {
      title: r.label,
      iconName: opts.iconName || (r.role === "system" ? "zap" : "users"),
    });
  }

  /* The confidence score is P0 F-3 and it is shown as a number, not a bar.
     A bar invites "about 70%, close enough"; the whole argument of the
     threshold is that 0.89 and 0.91 are different decisions. */
  function confidence(a) {
    const t = V().AUTO_APPROVE_THRESHOLD;
    const tone = a.confidence >= t ? "success" : a.confidence >= 0.6 ? "warning" : "critical";
    return el(
      "span",
      { class: ["dma-vaconf", "dt-tnum", `dt-text-${tone}`], title: `Auto-approve threshold ${t.toFixed(2)}` },
      a.confidence.toFixed(2)
    );
  }

  const clsBadge = (a) => {
    const c = V().CLASSES[a.cls];
    return badge(c.short, c.tone, { iconName: c.icon, title: c.detail });
  };

  function stateBadge(a) {
    if (a.review) {
      const r = V().REVIEWS[a.review.decision];
      return badge(r.label, r.tone, { iconName: r.icon, title: r.detail });
    }
    if (a.verdict) {
      const v = V().VERDICTS[a.verdict.decision];
      return badge(v.label, v.tone, { iconName: v.icon, title: v.detail });
    }
    if (a.cls === "match") return badge("Auto-approved", "success", { iconName: "check" });
    return badge("Awaiting a verdict", "neutral", { iconName: "clock" });
  }

  const stepper = () => {
    const active = step();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Validation steps" });
    STEPS.forEach((s, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(s.id === active),
            onClick: () => DMA.store.setSession("vaStep", s.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, s.label)
        )
      );
    });
    return row;
  };

  function auditList(a) {
    return el(
      "div",
      { class: "dma-vaaudit" },
      V()
        .auditFor(a)
        .map((e) =>
          el(
            "div",
            { class: "dma-vaaudit__row", dataset: { tone: e.tone } },
            el("span", { class: "dma-vaaudit__dot" }),
            el(
              "div",
              { class: "dt-stack dt-gap-4 dt-grow" },
              el(
                "div",
                { class: "dt-row dt-gap-8" },
                el("span", { class: "dt-text-semibold" }, e.title),
                who(e.by),
                el("span", { class: "dt-grow" }),
                subdued(fmt.date(e.at))
              ),
              note(e.detail)
            )
          )
        )
    );
  }

  /* ==========================================================================
     The asset record
     --------------------------------------------------------------------------
     One modal for every surface, because an asset is one record no matter
     which queue you reached it from. It carries the signals that applied to
     its type, the written finding, and the full audit trail — which is the
     thing the PRD's Scenario D actually asks for: three months later, a
     customer wants to know how we know a dashboard nobody ever opened was
     translated correctly.
     ======================================================================== */

  function assetModal(a) {
    const v = V();
    const sigs = v.signalsFor(a.type);

    const body = el(
      "div",
      { class: "dt-stack dt-gap-16" },

      el(
        "div",
        { class: "dt-row dt-gap-8", style: { flexWrap: "wrap" } },
        clsBadge(a),
        stateBadge(a),
        badge(a.type.replace(/s$/, ""), "neutral"),
        badge(`Wave ${a.wave}`, "neutral"),
        a.live
          ? badge("Live in tenant", "info", { iconName: "server" })
          : badge("Not deployed", "neutral", { iconName: "clock" })
      ),

      el(
        "div",
        { class: "dma-vafinding", dataset: { tone: v.CLASSES[a.cls].tone } },
        el("span", { class: "dt-text-semibold" }, a.cls === "match" ? "What the comparison saw" : "What differs"),
        el("div", { style: wrap }, a.finding || a.evidence)
      ),

      el(
        "div",
        { class: "dt-stack dt-gap-8" },
        el("span", { class: "dt-text-semibold" }, `Signals used — ${sigs.length} of ${v.SIGNALS.length}`),
        note(
          `An asset is only ever scored on the signals that apply to its type. ${
            /^[aeiou]/.test(a.type.replace(/s$/, "").toLowerCase()) ? "An" : "A"
          } ${a.type.replace(/s$/, "").toLowerCase()} has ${
            sigs.length
          }; scoring it on all five and silently passing the inapplicable ones would inflate every confidence number on this page.`
        ),
        el(
          "div",
          { class: "dma-vasigs" },
          v.SIGNALS.map((s) => {
            const on = s.types.includes(a.type);
            return el(
              "div",
              { class: "dma-vasig", dataset: { on: String(on) } },
              icon(on ? "check" : "x", 13),
              el(
                "div",
                { class: "dt-stack dt-gap-2 dt-grow" },
                el("span", { class: on ? "dt-text-semibold" : null }, s.label),
                subdued(on ? s.detail : `Does not apply to ${a.type.toLowerCase()}.`)
              )
            );
          })
        )
      ),

      el(
        "div",
        { class: "dt-stack dt-gap-8" },
        el(
          "div",
          { class: "dt-row dt-gap-12" },
          el("span", { class: "dt-text-semibold dt-grow" }, "Audit trail"),
          subdued(`Confidence ${a.confidence.toFixed(2)} · threshold ${v.AUTO_APPROVE_THRESHOLD.toFixed(2)}`)
        ),
        note("Immutable. A re-translation adds a new entry and supersedes the old result; it never replaces it."),
        auditList(a)
      )
    );

    let handle;
    handle = modal(a.name, body, [button("Close", { variant: "default", onClick: () => handle.close() })], { wide: true });
  }

  /* ==========================================================================
     The action dialogs
     --------------------------------------------------------------------------
     An override publishes DQL the system could not prove equivalent, against a
     guardrail the PRD describes as "the metric we protect against, not
     optimize for". So it asks for a named owner and a reason, and it will not
     accept either one empty. That friction is the feature — it is what makes
     the override auditable three months later, and it is why overrides are
     counted in their own bucket rather than folded into the auto-approval
     rate.

     A live failure asks for a comment for the same reason pointed the other
     way: the comment is the only thing that travels with the asset into
     Exceptions, and "it's wrong" does not survive the handoff.
     ======================================================================== */

  const PEOPLE = ["ravi", "hanna", "rosa", "claire", "arjun", "martin"];

  function ownerSelect() {
    return el(
      "select",
      { class: "dt-input", "aria-label": "Owner" },
      el("option", { value: "" }, "Select an owner…"),
      PEOPLE.map((id) => {
        const r = V().reviewer(id);
        return el("option", { value: id }, `${r.name} — ${r.label}`);
      })
    );
  }

  function actionModal(a, kind) {
    const isOverride = kind === "override";
    const isFail = kind === "fail";
    const isConfirm = kind === "confirm";

    const owner = ownerSelect();
    const text = el("textarea", {
      class: "dt-textarea",
      rows: 4,
      placeholder: isOverride
        ? "Why is it safe to publish this despite the finding? Name the evidence you checked."
        : isFail
        ? "What is wrong with it in the tenant? This comment travels with the asset into Exceptions."
        : isConfirm
        ? "Optional — anything worth recording about what you checked."
        : "What needs to change? This is what the rework starts from.",
    });

    const minChars = isConfirm ? 0 : 20;
    const label = isOverride
      ? "Override and publish"
      : isFail
      ? "Fail and route to Exceptions"
      : isConfirm
      ? "Confirm as correct"
      : "Send to Exceptions";

    const go = button(label, {
      variant: isOverride || isFail ? "emphasized" : "default",
      iconName: isOverride ? "shield" : isFail ? "x" : isConfirm ? "check" : "arrowRight",
      disabled: true,
    });

    const sync = () => {
      go.disabled = !owner.value || text.value.trim().length < minChars;
    };
    owner.addEventListener("change", sync);
    text.addEventListener("input", sync);

    let handle;
    go.addEventListener("click", () => {
      const at = new Date().toISOString();
      if (isOverride || kind === "exception") {
        const v = { decision: isOverride ? "override" : "exception", by: owner.value, at };
        v[isOverride ? "reason" : "comment"] = text.value.trim();
        DMA.store.setSession(verdictKey(a), v);
      } else {
        DMA.store.setSession(reviewKey(a), {
          decision: isFail ? "failed" : "confirmed",
          by: owner.value,
          at,
          comment: text.value.trim() || undefined,
        });
      }
      handle.close();
    });

    const body = el(
      "div",
      { class: "dt-stack dt-gap-16" },

      el(
        "div",
        { class: "dt-row dt-gap-8", style: { flexWrap: "wrap" } },
        clsBadge(a),
        badge(a.type.replace(/s$/, ""), "neutral"),
        badge(`Wave ${a.wave}`, "neutral")
      ),

      el(
        "div",
        { class: "dma-vafinding", dataset: { tone: V().CLASSES[a.cls].tone } },
        el("span", { class: "dt-text-semibold" }, a.cls === "match" ? "What the comparison saw" : "What the comparison found"),
        el("div", { style: wrap }, a.finding || a.evidence)
      ),

      isOverride
        ? banner(
            "warning",
            "This publishes a query the comparison could not prove returns the same answer. It will not be counted as an auto-approval, and it is listed by name on the Record step for as long as the project exists.",
            { title: "You are overriding the system" }
          )
        : isFail
        ? banner(
            "critical",
            "This asset is already live in the customer's tenant. Failing it does not take it down — it re-enters the manual translation and validation workflow carrying your comment, and Deploy handles the redeploy.",
            { title: "This one is already in production" }
          )
        : null,

      field("Owner", owner, "Required. The audit entry is written against this person, not against whoever is driving the screen."),
      field(
        isConfirm ? "Note (optional)" : "Reason",
        text,
        isConfirm
          ? "Recorded on the asset's audit trail."
          : `Required, at least ${minChars} characters. A reason nobody can act on is the same as no reason.`
      )
    );

    handle = modal(
      isOverride
        ? `Override — ${a.name}`
        : isFail
        ? `Fail on review — ${a.name}`
        : isConfirm
        ? `Confirm — ${a.name}`
        : `Send to Exceptions — ${a.name}`,
      body,
      [button("Cancel", { variant: "default", onClick: () => handle.close() }), go],
      { wide: true }
    );
  }

  /* ==========================================================================
     Table plumbing shared by the asset surfaces
     ======================================================================== */

  function typeTabs(waveId, surface, sessionKey) {
    const v = V();
    const active = v.TYPES.includes(DMA.store.session[sessionKey]) ? DMA.store.session[sessionKey] : "all";

    const tab = (id, label, n) =>
      el(
        "button",
        {
          class: "dma-vatab",
          role: "tab",
          "aria-selected": String(id === active),
          onClick: () => DMA.store.setSession(sessionKey, id),
        },
        label,
        el("span", { class: "dma-vatab__n dt-tnum" }, fmt.num(n))
      );

    return {
      active: active === "all" ? null : active,
      node: el(
        "div",
        { class: "dma-vatabs", role: "tablist", "aria-label": "Asset type" },
        tab("all", "All", v.assetsFor(waveId, surface).length),
        v.TYPES.map((t) => tab(t, t, v.assetsFor(waveId, surface, t).length))
      ),
    };
  }

  const nameCol = {
    label: "Asset",
    render: (r) =>
      el(
        "div",
        { class: "dt-stack dt-gap-4" },
        el("span", { class: "dt-text-semibold" }, r.name),
        subdued(`${r.id} · ${appName(r.app)}`)
      ),
  };

  /* ==========================================================================
     Step 1 — Comparison
     --------------------------------------------------------------------------
     What the machine did, and the table of everything it approved. That table
     exists for a reason that is easy to miss: the PRD's UX goal is "quiet by
     default — the customer's reviewer does not see most translated assets at
     all", and a stage that is quiet by default still has to be able to show
     you the quiet part on request. An auto-approval nobody can look up is
     indistinguishable from an auto-approval that never happened.
     ======================================================================== */

  function signalMatrix() {
    const v = V();
    return el(
      "div",
      { class: "dma-vamatrix" },
      el(
        "div",
        { class: "dma-vamatrix__row dma-vamatrix__row--head" },
        el("span", { class: "dt-text-small dt-text-subdued" }, "Signal"),
        v.TYPES.map((t) => el("span", { class: "dma-vamatrix__th" }, t))
      ),
      v.SIGNALS.map((s) =>
        el(
          "div",
          { class: "dma-vamatrix__row" },
          el(
            "div",
            { class: "dt-stack dt-gap-2" },
            el("span", { class: "dt-text-semibold" }, s.label),
            subdued(s.detail)
          ),
          v.TYPES.map((t) =>
            el(
              "span",
              { class: "dma-vamatrix__cell", dataset: { on: String(s.types.includes(t)) } },
              icon(s.types.includes(t) ? "check" : "x", 14)
            )
          )
        )
      )
    );
  }

  function panelComparison(ctx, wave, mode) {
    const v = V();
    const c = v.comparisonFor(wave.id);

    if (!c || mode === "not-started") {
      return card(
        {},
        DMA.ui.emptyState(
          "checkCircle",
          "Nothing to compare",
          `Wave ${wave.id} has not translated. Validation compares translated output against the Splunk original, so there is no input to this stage until Translate has run.`,
          button("Open Translate", { variant: "default", iconName: "externalLink", onClick: () => ctx.navigate("translate") })
        )
      );
    }

    const t = triageState(wave.id);
    const rate = (c.match / c.validated) * 100;
    const tabs = typeTabs(wave.id, "approved", "vaType");
    const q = (DMA.store.session.vaQuery || "").toLowerCase();
    let rows = rowsFor(wave.id, "approved", tabs.active);
    const shown = rows.length;
    if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || appName(r.app).toLowerCase().includes(q));

    const search = el("input", {
      class: "dt-input",
      type: "search",
      placeholder: "Search name or application",
      value: DMA.store.session.vaQuery || "",
      "aria-label": "Search auto-approved assets",
      onChange: (e) => DMA.store.setSession("vaQuery", e.target.value),
    });

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      kpiRow(
        kpi("Compared", fmt.num(c.validated), "runnable DQL from this wave", { iconName: "database" }),
        kpi("Auto-approved", fmt.num(c.match), fmt.pct(rate, 1), { iconName: "check", tone: "success", bar: progress(rate, "success") }),
        kpi("Routed to a human", fmt.num(c.difference + c.uncertain), `${fmt.num(c.difference)} differences · ${fmt.num(c.uncertain)} uncertain`, {
          iconName: "alert",
          tone: "warning",
        }),
        kpi("Median confidence", c.medianConfidence.toFixed(2), `auto-approve at ≥ ${v.AUTO_APPROVE_THRESHOLD.toFixed(2)}`, { iconName: "shield" })
      ),

      card(
        { title: "The comparison", subtitle: `Ran ${fmt.date(c.ranAt)} · ${c.durationLabel} · no customer data left the tenant` },
        el(
          "div",
          { class: "dt-stack dt-gap-16" },
          stackedProgress([
            { value: (c.match / c.validated) * 100, tone: "success", label: "Match" },
            { value: (c.difference / c.validated) * 100, tone: "warning", label: "Meaningful difference" },
            { value: (c.uncertain / c.validated) * 100, tone: "critical", label: "Uncertain" },
          ]),
          el(
            "div",
            { class: "dma-vaclasses" },
            Object.keys(v.CLASSES).map((k) =>
              el(
                "div",
                { class: "dma-vaclass", dataset: { tone: v.CLASSES[k].tone } },
                el("div", { class: "dma-vaclass__n dt-tnum" }, fmt.num(c[k === "match" ? "match" : k])),
                el("div", { class: "dt-row dt-gap-6" }, icon(v.CLASSES[k].icon, 13), el("span", { class: "dt-text-semibold" }, v.CLASSES[k].label)),
                note(v.CLASSES[k].detail)
              )
            )
          ),
          note(
            "Every asset resolves to exactly one of the three. There is no fourth state and no partial credit — an asset the comparison cannot place lands in Uncertain by definition, which is what Uncertain is for."
          )
        )
      ),

      card(
        {
          title: "Everything this wave auto-approved",
          subtitle: `${fmt.num(c.match)} assets no human was asked to look at. The table exists so that "no human looked at it" never means "nobody can."`,
          flush: true,
        },
        el("div", { class: "dma-vatoolbar" }, tabs.node),
        el("div", { class: "dma-vafilters" }, search),
        rows.length
          ? table(
              [
                nameCol,
                { label: "Type", render: (r) => subdued(r.type.replace(/s$/, "")) },
                { label: "Confidence", render: confidence },
                { label: "Signals", render: (r) => subdued(`${v.signalsFor(r.type).length} of ${v.SIGNALS.length}`) },
                { label: "Status", render: stateBadge },
                { label: "Reviewed by", render: (r) => (r.review ? who(r.review.by) : subdued("Nobody — auto-approved")) },
                { label: "", render: () => icon("chevronR", 14) },
              ],
              rows,
              { onRowClick: assetModal }
            )
          : el("div", { style: { padding: "24px" } }, DMA.ui.emptyState("search", "No assets match", "Clear the search or pick another type.")),
        el(
          "div",
          { class: "dma-vafoot" },
          subdued(
            `Showing ${fmt.num(rows.length)} of ${fmt.num(shown)} sampled rows, drawn from ${fmt.num(
              c.match
            )} auto-approved in this wave. A prototype fixture, not the full population — every row opens, and every row has an audit trail.`
          )
        )
      ),

      card(
        { title: "Which signals an asset is scored on", subtitle: "PRD F-6: asset-type awareness. A saved search has no layout and never fires." },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          signalMatrix(),
          note(
            "A dashboard is compared on four signals, an alert on four, a saved search on three. Lookups and macros appear on none of them — they are prerequisites rather than translations, which is why this stage's denominator is 1,751 and not 2,955."
          ),
          note(
            "Weighting across signals is an engineering decision the PRD deliberately leaves open. What it does not leave open is that an asset must never be scored against a signal that cannot apply to it."
          )
        )
      ),

      t.open === 0
        ? banner(
            "success",
            `All ${fmt.num(c.difference + c.uncertain)} routed assets in this wave were dispositioned before it published — ${fmt.num(
              t.overridden
            )} overridden, ${fmt.num(t.toExceptions)} sent for rework.`,
            { title: "Triage closed" }
          )
        : banner("info", `${fmt.num(t.open)} assets in this wave are waiting for a human verdict.`, {
            title: "Triage is open",
            action: button("Open triage", {
              variant: "emphasized",
              size: "sm",
              iconName: "arrowRight",
              onClick: () => DMA.store.setSession("vaStep", "triage"),
            }),
          })
    );
  }

  /* ==========================================================================
     Step 2 — Triage (pre-deploy)
     --------------------------------------------------------------------------
     The machine said FAIL. Nothing here is live. Two ways out, and they are
     not symmetrical: sending an asset to Exceptions is the ordinary path and
     costs a reviewer a sentence, while an override publishes something nobody
     could prove correct and costs them a named owner and an argument.
     ======================================================================== */

  function panelTriage(ctx, wave, mode) {
    const v = V();
    const c = v.comparisonFor(wave.id);

    if (!c || mode === "not-started") {
      return card(
        {},
        DMA.ui.emptyState(
          "flag",
          "Nothing to triage",
          `Wave ${wave.id} has not been compared, so no asset has a finding to argue with yet.`,
          button("Open Translate", { variant: "default", iconName: "externalLink", onClick: () => ctx.navigate("translate") })
        )
      );
    }

    const t = triageState(wave.id);
    const rows = rowsFor(wave.id, "triage");
    const open = rows.filter((r) => !r.verdict);
    const closed = rows.filter((r) => r.verdict);

    const actions = (r) =>
      r.verdict
        ? el(
            "div",
            { class: "dt-row dt-gap-6" },
            stateBadge(r),
            button("", { variant: "subtle", size: "sm", iconName: "fileText", title: "Open the record", onClick: () => assetModal(r) })
          )
        : el(
            "div",
            { class: "dma-vaactions" },
            button("Override", {
              variant: "default",
              size: "sm",
              iconName: "shield",
              title: "Publish despite the finding",
              onClick: () => actionModal(r, "override"),
            }),
            button("Send to Exceptions", {
              variant: "emphasized",
              size: "sm",
              iconName: "arrowRight",
              iconAfter: true,
              onClick: () => actionModal(r, "exception"),
            })
          );

    const columns = [
      nameCol,
      { label: "Class", render: clsBadge },
      { label: "Confidence", render: confidence },
      { label: "Finding", render: (r) => el("div", { class: "dma-vatrunc", title: r.finding }, r.finding) },
      { label: "", render: actions },
    ];

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      kpiRow(
        kpi("Awaiting a verdict", fmt.num(t.open), t.open ? "nothing moves until these are decided" : "all dispositioned", {
          iconName: "clock",
          tone: t.open ? "warning" : "success",
        }),
        kpi("Overridden", fmt.num(t.overridden), "published without proof of equivalence", { iconName: "shield", tone: "info" }),
        kpi("Sent to Exceptions", fmt.num(t.toExceptions), "handed off for rework", { iconName: "arrowRight" }),
        kpi("Routed in total", fmt.num(c.difference + c.uncertain), `${fmt.pct(((c.difference + c.uncertain) / c.validated) * 100, 1)} of the wave`, {
          iconName: "alert",
        })
      ),

      mode === "complete"
        ? banner(
            "info",
            `Wave ${wave.id} published on ${fmt.dateShort(wave.published)}. Its triage is closed and shown here as a record — the ${fmt.num(
              t.overridden
            )} overrides are still tracked separately on the Record step.`,
            { title: "This wave is already live" }
          )
        : null,

      card(
        {
          title: open.length ? "Assets the comparison could not approve" : "What this wave decided",
          subtitle: "The finding is written out in full on every row. A reviewer should never have to re-derive what the system already knew.",
          flush: true,
        },
        rows.length
          ? table(columns, open.concat(closed), { onRowClick: assetModal })
          : el("div", { style: { padding: "24px" } }, DMA.ui.emptyState("check", "Nothing routed", "Every asset in this wave matched.")),
        el(
          "div",
          { class: "dma-vafoot" },
          subdued(
            `${fmt.num(rows.length)} sampled rows of ${fmt.num(c.difference + c.uncertain)} routed in this wave. Decisions recorded here are kept for the session.`
          )
        )
      ),

      card(
        { title: "Why an override costs more than a handoff", subtitle: "The guardrail the PRD says to protect rather than optimise" },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          el(
            "div",
            { class: "dma-vatwo" },
            el(
              "div",
              { class: "dma-vatwo__side" },
              el("div", { class: "dma-kpi__label" }, icon("arrowRight", 13), "Send to Exceptions"),
              el("div", { class: "dt-text-semibold" }, "A sentence and a click"),
              note(
                "The ordinary path. The asset goes for rework carrying the finding, and comes back through this comparison again. Nothing is claimed about it in the meantime."
              )
            ),
            el(
              "div",
              { class: "dma-vatwo__side dma-vatwo__side--heavy" },
              el("div", { class: "dma-kpi__label" }, icon("shield", 13), "Override"),
              el("div", { class: "dt-text-semibold" }, "A named owner and a reason"),
              note(
                "Publishes DQL the system could not prove equivalent. The reason is required, the owner is written into an immutable audit entry, and the asset is listed by name on the Record step."
              )
            )
          ),
          note(
            `Overrides are never counted as auto-approvals. The headline rate on this project is ${fmt.pct(
              v.estate().autoApprovalRate,
              1
            )} and it is ${fmt.num(v.estate().match)} assets the machine approved — not one of the ${fmt.num(
              v.estate().overridden
            )} a human waved through. Folding them in would let the system take credit for a human's judgement, and then quietly take the blame when that judgement turns out to be wrong.`
          ),
          note(
            "Which it does. One of the overrides in Wave 1 went live and started paging on-call ten days later — it is the first row on Live review."
          )
        )
      )
    );
  }

  /* ==========================================================================
     Step 3 — Live review (post-deploy)
     --------------------------------------------------------------------------
     The second entry point in the P1 PRD: an asset that already passed, is
     already deployed, and receives a comment after the fact. This is the only
     surface in the prototype where a human can tell the machine it was wrong
     about something that is already running.
     ======================================================================== */

  function panelLive(ctx, wave, mode) {
    const v = V();
    const l = liveState(wave.id);

    if (!l) {
      return card(
        {},
        DMA.ui.emptyState(
          "server",
          "Nothing is live yet",
          mode === "in-progress"
            ? `Wave ${wave.id} has been compared but not deployed. This surface only has a population once assets are running in the customer's tenant — until then every disagreement belongs in Triage.`
            : `Wave ${wave.id} has not translated, let alone deployed.`,
          mode === "in-progress"
            ? button("Open triage", { variant: "emphasized", iconName: "flag", onClick: () => DMA.store.setSession("vaStep", "triage") })
            : button("Open Deploy", { variant: "default", iconName: "externalLink", onClick: () => ctx.navigate("deploy") })
        )
      );
    }

    const tabs = typeTabs(wave.id, "live", "vaLiveType");
    const rows = rowsFor(wave.id, "live", tabs.active);
    const failed = rowsFor(wave.id, "live").filter((r) => r.review && r.review.decision === "failed");

    const actions = (r) =>
      r.review
        ? el(
            "div",
            { class: "dt-row dt-gap-6" },
            stateBadge(r),
            button("", { variant: "subtle", size: "sm", iconName: "fileText", title: "Open the record", onClick: () => assetModal(r) })
          )
        : el(
            "div",
            { class: "dma-vaactions" },
            button("Pass", { variant: "default", size: "sm", iconName: "check", onClick: () => actionModal(r, "confirm") }),
            button("Fail", { variant: "default", size: "sm", iconName: "x", title: "Route back for rework", onClick: () => actionModal(r, "fail") })
          );

    const columns = [
      nameCol,
      {
        label: "Approved by",
        render: (r) =>
          r.verdict && r.verdict.decision === "override" ? who(r.verdict.by, { iconName: "shield" }) : badge("DMA — auto", "neutral", { iconName: "zap" }),
      },
      { label: "Confidence", render: confidence },
      { label: "Live since", render: () => subdued(fmt.dateShort(l.deployedAt)) },
      { label: "Human review", render: (r) => (r.review ? who(r.review.by) : subdued("Not reviewed")) },
      { label: "", render: actions },
    ];

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      kpiRow(
        kpi("Live in the tenant", fmt.num(l.population), `${fmt.num(l.autoApprovedLive)} auto-approved · ${fmt.num(l.overriddenLive)} overridden`, {
          iconName: "server",
        }),
        kpi("Spot-checked", fmt.num(l.reviewed), `${fmt.pct((l.reviewed / l.population) * 100, 0)} of the population`, { iconName: "users" }),
        kpi("Confirmed", fmt.num(l.confirmed), "a human agreed with the machine", { iconName: "check", tone: "success" }),
        kpi("Failed on review", fmt.num(l.failed), l.failed ? "live and wrong" : "none", { iconName: "x", tone: l.failed ? "critical" : undefined })
      ),

      l.failed
        ? banner(
            "critical",
            `${fmt.num(l.failedFrom.match)} ${l.failedFrom.match === 1 ? "was" : "were"} auto-approved and ${fmt.num(
              l.failedFrom.override
            )} ${l.failedFrom.override === 1 ? "was a human override" : "were human overrides"}. Failing them does not take them down — each one re-enters the manual translation and validation workflow carrying the reviewer's comment, and Deploy handles the redeploy.`,
            {
              title: `${fmt.num(l.failed)} ${l.failed === 1 ? "asset" : "assets"} in Wave ${wave.id} ${
                l.failed === 1 ? "is" : "are"
              } live and wrong`,
              action: button("Open Exceptions", {
                variant: "emphasized",
                size: "sm",
                iconName: "arrowRight",
                iconAfter: true,
                onClick: () => ctx.navigate("exceptions"),
              }),
            }
          )
        : null,

      card(
        {
          title: `Published to ${PR().target.tenant}`,
          subtitle: `Live since ${fmt.dateShort(
            l.deployedAt
          )}. Anyone with access to the tenant can pass or fail any row — the reviewer's name and role are recorded on the asset.`,
          flush: true,
        },
        el("div", { class: "dma-vatoolbar" }, tabs.node),
        rows.length
          ? table(columns, rows, { onRowClick: assetModal })
          : el("div", { style: { padding: "24px" } }, DMA.ui.emptyState("search", "No assets of that type", "Pick another type.")),
        el(
          "div",
          { class: "dma-vafoot" },
          subdued(
            `${fmt.num(rows.length)} sampled rows of ${fmt.num(l.population)} live. ${fmt.num(
              l.unreviewed
            )} of the population has never been looked at by a human, which is the intended outcome rather than a backlog.`
          )
        )
      ),

      failed.length
        ? card(
            { title: "What the comparison could not have known", subtitle: "Every failure in this wave's sample, and why it got through" },
            el(
              "div",
              { class: "dt-stack dt-gap-8" },
              failed.map((r) =>
                el(
                  "div",
                  { class: "dma-vafail" },
                  el(
                    "div",
                    { class: "dt-row dt-gap-8", style: { flexWrap: "wrap" } },
                    el("span", { class: "dt-text-semibold dt-grow" }, r.name),
                    r.verdict && r.verdict.decision === "override"
                      ? badge("Was an override", "info", { iconName: "shield" })
                      : badge("Was auto-approved", "neutral", { iconName: "zap" }),
                    who(r.review.by)
                  ),
                  note(r.review.comment || "No comment recorded.")
                )
              ),
              note(
                "None of these is a translation fault in the ordinary sense. They are correct queries wired to the wrong thing — a notification route, a dashboard default timeframe, a per-range split that both sides pooled identically. The comparison could not have caught any of them, which is the argument for this surface existing rather than trusting the gate."
              ),
              note(
                `Across both published waves the machine's false-positive rate is ${fmt.pct(
                  v.estate().falsePositiveRate,
                  2
                )} and the reversal rate on human overrides is ${fmt.pct(
                  v.estate().overrideReversalRate,
                  1
                )}. Both numbers are worth having, and averaging them together would hide the interesting one.`
              )
            )
          )
        : null
    );
  }

  /* ==========================================================================
     Step 4 — Record
     --------------------------------------------------------------------------
     Scenario D in the PRD: three months after the migration a customer asks
     how we know a dashboard nobody ever reviewed was translated correctly.
     This step is the answer, and it has to hold for the 1,422 assets no human
     ever opened just as firmly as for the four that went wrong.
     ======================================================================== */

  function ledgerRow(label, n, total, tone, detail) {
    return el(
      "div",
      { class: "dma-valedger__row", dataset: { tone } },
      el("span", { class: "dma-valedger__n dt-tnum" }, fmt.num(n)),
      el("div", { class: "dt-stack dt-gap-2 dt-grow" }, el("span", { class: "dt-text-semibold" }, label), subdued(detail)),
      el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, fmt.pct((n / total) * 100, 1))
    );
  }

  function panelRecord(ctx) {
    const v = V();
    const e = v.estate();
    const p = PR().validation;
    /* Record is estate-scoped and does not move with the wave selector. Say so
       on the page rather than letting it look like a wave's own numbers: with a
       wave selected, the strip above can read "Not compared" while this panel
       reports 81.2%, and a reader is entitled to call that a contradiction. The
       rates here only exist at estate scope anyway — a false-positive rate
       derived from one wave's two reversals is noise, not a measurement. */
    const scopeNote = selectedWave()
      ? banner(
          "info",
          "These are project-wide figures and do not change with the wave selector. The false-positive and override-reversal rates are only meaningful across all four compared waves — derived from a single wave's handful of reversals they would be noise.",
          { title: "The record is kept for the project, not the wave" }
        )
      : null;
    /* An asset nobody ever opened, whose entire defence is its audit trail.
       Picked rather than hard-coded so it cannot go stale if the fixture
       changes. */
    const exemplar = v.assets.map(withState).find((a) => a.cls === "match" && a.live && !a.review);

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      scopeNote,

      kpiRow(
        kpi("Auto-approval rate", fmt.pct(e.autoApprovalRate, 1), `Target ≥${p.targetRate}% · stretch ≥${p.stretchRate}%`, {
          iconName: "checkCircle",
          tone: "success",
          bar: progress(e.autoApprovalRate, "success"),
        }),
        kpi("False-positive rate", fmt.pct(e.falsePositiveRate, 2), `${fmt.num(e.failedFromMatch)} of ${fmt.num(e.liveAutoApproved)} live auto-approvals reversed`, {
          iconName: "shield",
          tone: "success",
        }),
        kpi("Override reversal rate", fmt.pct(e.overrideReversalRate, 1), `${fmt.num(e.failedFromOverride)} of ${fmt.num(e.overridden)} overrides reversed`, {
          iconName: "alert",
          tone: "warning",
        }),
        kpi("Expert hours avoided", fmt.num(PR().effort.hoursAvoided), `of ${fmt.num(PR().effort.baselineReviewHours)} hr manual baseline`, {
          iconName: "zap",
        })
      ),

      card(
        { title: `Where all ${fmt.num(e.validated)} went`, subtitle: "Every asset Translate produced runnable DQL for, and exactly one outcome each" },
        el(
          "div",
          { class: "dt-stack dt-gap-16" },
          stackedProgress([
            { value: (e.match / e.validated) * 100, tone: "success", label: "Auto-approved" },
            { value: (e.overridden / e.validated) * 100, tone: "info", label: "Overridden" },
            { value: (e.toExceptions / e.validated) * 100, tone: "warning", label: "Sent to Exceptions" },
            { value: (e.open / e.validated) * 100, tone: "critical", label: "Awaiting a verdict" },
          ]),
          el(
            "div",
            { class: "dma-valedger" },
            ledgerRow("Auto-approved", e.match, e.validated, "success", "Matched on every applicable signal. No human was asked."),
            ledgerRow(
              "Overridden and published",
              e.overridden,
              e.validated,
              "info",
              "A human published them over the system's objection. Each has a named owner and a written reason."
            ),
            ledgerRow("Sent to Exceptions", e.toExceptions, e.validated, "warning", "Handed to the manual translation and validation workflow for rework."),
            ledgerRow("Awaiting a verdict", e.open, e.validated, "critical", "Waves 3 and 4. Nothing in them deploys until a human decides.")
          ),
          note(
            `${fmt.num(e.match + e.overridden + e.toExceptions + e.open)} accounted for against ${fmt.num(
              e.validated
            )} compared. The ${fmt.num(
              DMA.data.translation.estate().blocked
            )} assets Translate blocked are not in this total — they never produced DQL, so there was nothing to compare and they went straight to Exceptions.`
          )
        )
      ),

      card(
        { title: "Two rates that must not be averaged", subtitle: "The machine's error and the human's error are different quantities" },
        el(
          "div",
          { class: "dma-vatwo" },
          el(
            "div",
            { class: "dma-vatwo__side" },
            el("div", { class: "dma-kpi__label" }, icon("zap", 13), "The machine was wrong"),
            el("div", { class: "dma-vatwo__n dt-tnum" }, fmt.pct(e.falsePositiveRate, 2)),
            note(
              `${fmt.num(e.failedFromMatch)} of ${fmt.num(
                e.liveAutoApproved
              )} auto-approvals that reached the tenant were later failed by a human. The PRD sets this below 1% and calls it the metric to protect against rather than optimise for.`
            )
          ),
          el(
            "div",
            { class: "dma-vatwo__side dma-vatwo__side--heavy" },
            el("div", { class: "dma-kpi__label" }, icon("shield", 13), "The human was wrong"),
            el("div", { class: "dma-vatwo__n dt-tnum" }, fmt.pct(e.overrideReversalRate, 1)),
            note(
              `${fmt.num(e.failedFromOverride)} of ${fmt.num(
                e.overridden
              )} overrides was reversed after going live. A small number on a small base — but it is six times the machine's rate, and it only exists as a number because overrides are counted separately.`
            )
          )
        ),
        note(
          "Folding overrides into the auto-approval rate would move it by about a point and destroy both of these. It would also mean the system's headline accuracy figure silently improves every time a consultant waves something through, which is the exact incentive you do not want on a stage whose whole value proposition is that it can be trusted without being checked."
        )
      ),

      exemplar
        ? card(
            { title: "The asset nobody ever looked at", subtitle: "PRD Scenario D — three months on, a customer asks how we know this one was right" },
            el(
              "div",
              { class: "dt-stack dt-gap-12" },
              el(
                "div",
                { class: "dt-row dt-gap-8", style: { flexWrap: "wrap" } },
                el("span", { class: "dt-text-semibold dt-grow" }, exemplar.name),
                badge(`Wave ${exemplar.wave}`, "neutral"),
                clsBadge(exemplar),
                badge("Never reviewed by a human", "neutral", { iconName: "users" })
              ),
              note(exemplar.evidence),
              auditList(exemplar),
              note(
                "Comparison date, signals used, confidence score, classification, threshold in effect, asset revision. That is the whole of PRD F-7, and it is the only thing standing between an auto-approval and an audit finding."
              ),
              button("Open the full record", { variant: "default", iconName: "fileText", onClick: () => assetModal(exemplar) })
            )
          )
        : null,

      card(
        { title: "What Validate hands on", subtitle: "Where this stage stops" },
        el(
          "div",
          { class: "dma-varoute" },
          el(
            "div",
            { class: "dma-varoute__card", dataset: { tone: "success" } },
            el("div", { class: "dma-varoute__n dt-tnum" }, fmt.num(e.match + e.overridden)),
            el("div", { class: "dt-text-semibold" }, "Cleared for Deploy"),
            note("Auto-approved or overridden. Both are publishable; only one of them is the system's claim."),
            button("Open Deploy", { variant: "default", size: "sm", iconName: "arrowRight", iconAfter: true, onClick: () => ctx.navigate("deploy") })
          ),
          el(
            "div",
            { class: "dma-varoute__card", dataset: { tone: "warning" } },
            el("div", { class: "dma-varoute__n dt-tnum" }, fmt.num(e.toExceptions + e.failed)),
            el("div", { class: "dt-text-semibold" }, "Routed for rework"),
            note(
              `${fmt.num(e.toExceptions)} from pre-deploy triage and ${fmt.num(
                e.failed
              )} failed after going live. Exceptions owns the correction; this stage owns neither the editor nor the re-translate.`
            ),
            button("Open Exceptions", { variant: "default", size: "sm", iconName: "arrowRight", iconAfter: true, onClick: () => ctx.navigate("exceptions") })
          ),
          el(
            "div",
            { class: "dma-varoute__card", dataset: { tone: "critical" } },
            el("div", { class: "dma-varoute__n dt-tnum" }, fmt.num(e.open)),
            el("div", { class: "dt-text-semibold" }, "Still here"),
            note("Waves 3 and 4 have been compared but not decided. These are the rows this stage has a human for today."),
            button("Open triage", { variant: "default", size: "sm", iconName: "flag", onClick: () => DMA.store.setSession("vaStep", "triage") })
          )
        )
      )
    );
  }

  const PANELS = {
    comparison: panelComparison,
    triage: panelTriage,
    live: panelLive,
    record: panelRecord,
  };

  /* ==========================================================================
     Board view — no wave selected
     ======================================================================== */

  function waveBoard(ctx) {
    const v = V();
    const e = v.estate();
    const tr = DMA.data.translation.estate();

    const open = (id) => {
      DMA.store.setSession("vaStep", "comparison");
      DMA.store.setSession("waveId", String(id));
    };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },

      kpiRow(
        kpi("Compared", fmt.num(e.validated), `across ${e.wavesCompared} waves · not the ${fmt.num(PR().assets.total)} in scope`, { iconName: "database" }),
        kpi("Auto-approved", fmt.num(e.match), fmt.pct(e.autoApprovalRate, 1), { iconName: "check", tone: "success", bar: progress(e.autoApprovalRate, "success") }),
        kpi("Awaiting a verdict", fmt.num(e.open), "Waves 3 and 4", { iconName: "clock", tone: "warning" }),
        kpi("Live and wrong", fmt.num(e.failed), "failed by a human after publishing", { iconName: "alert", tone: e.failed ? "critical" : undefined })
      ),

      banner("info", "Validation runs per wave. Pick a wave in the scope control above, or open one below.", { title: "Select a wave to work on" }),

      card(
        { title: "The six waves", subtitle: "Comparison runs once per wave; the two human surfaces open at different points in its life." },
        table(
          [
            {
              label: "Wave",
              render: (w) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-semibold" }, `Wave ${w.id} — ${w.name}`),
                  subdued(`${fmt.num(w.assets)} assets in the wave`)
                ),
            },
            {
              label: "Compared",
              render: (w) => {
                const c = v.comparisonFor(w.id);
                return c ? el("span", { class: "dt-tnum" }, fmt.num(c.validated)) : subdued("—");
              },
            },
            {
              label: "Auto-approved",
              render: (w) => {
                const c = v.comparisonFor(w.id);
                if (!c) return subdued("—");
                return el("span", { class: "dt-tnum dt-text-success" }, fmt.pct((c.match / c.validated) * 100, 1));
              },
            },
            {
              label: "Routed",
              render: (w) => {
                const c = v.comparisonFor(w.id);
                return c ? el("span", { class: "dt-tnum" }, fmt.num(c.difference + c.uncertain)) : subdued("—");
              },
            },
            {
              label: "Triage",
              render: (w) => {
                const t = triageState(w.id);
                if (!t) return subdued("—");
                return t.open ? badge(`${fmt.num(t.open)} open`, "warning", { iconName: "clock" }) : badge("Closed", "success", { iconName: "check" });
              },
            },
            {
              label: "Live review",
              render: (w) => {
                const l = liveState(w.id);
                if (!l) return subdued("Not deployed");
                return l.failed
                  ? badge(`${fmt.num(l.failed)} failed`, "critical", { iconName: "x" })
                  : badge(`${fmt.num(l.reviewed)} checked`, "success", { iconName: "check" });
              },
            },
            {
              label: "",
              render: (w) => {
                const t = triageState(w.id);
                return button(modeFor(w) === "not-started" ? "Open" : "Open & review", {
                  variant: t && t.open ? "emphasized" : "default",
                  size: "sm",
                  iconName: "arrowRight",
                  iconAfter: true,
                  onClick: () => open(w.id),
                });
              },
            },
          ],
          PR().waves,
          {}
        )
      ),

      card(
        { title: `${fmt.num(e.validated)}, not ${fmt.num(PR().assets.total)}`, subtitle: "The one number on this stage that is easy to get wrong" },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          note(
            `Validation can only compare what Translate produced. Of ${fmt.num(
              PR().assets.total
            )} assets in scope, 371 are lookups and macros that never translate, 15 sit in no wave at all, and Waves 5–6 have not run. ${fmt.num(
              tr.ran
            )} assets ran and ${fmt.num(e.validated)} produced runnable DQL — those ${fmt.num(
              e.validated
            )} are the denominator for every rate on this screen.`
          ),
          note(
            `The other ${fmt.num(
              tr.blocked
            )} were blocked in Translate and went straight to Exceptions. They never reach a comparator, because there is nothing to compare: an asset with no executable DQL cannot be run against its original.`
          ),
          note(
            `Reporting against ${fmt.num(
              PR().assets.total
            )} would put 371 prerequisites and two un-run waves into the denominator and quietly pass them, which is how an 81% auto-approval rate becomes a 48% one that nobody can explain.`
          )
        )
      )
    );
  }

  /* ======================================================================== */

  DMA.register({
    id: "validate",
    title: "Validate",
    phase: "transform",
    icon: "checkCircle",
    status: "ready",
    scope: "wave",
    summary:
      "Auto-approve exact matches and route only meaningful differences to a human — then let that human disagree, before deployment or after it.",

    steps: STEPS,

    notes: [
      "1,751 compared, not 2,955. Validation's input is whatever Translate produced runnable DQL for: 371 lookups and macros never translate, 15 assets sit in no wave, Waves 5–6 have not run, and 113 were blocked and went straight to Exceptions. The estate rollup used to read 2,400 + 412 + 143 = 2,955, which would have meant validating assets that had never been translated.",
      "Quiet by default is the UX goal, and it is a demanding one. 1,422 assets were approved without a human seeing them, so the stage's credibility rests entirely on the audit trail behind each one — comparison date, signals used, confidence score, classification, threshold in effect. An auto-approval nobody can look up is indistinguishable from one that never happened.",
      "A human can disagree in both directions, and the two disagreements are different events. Pre-deploy: the machine said FAIL and a human overrides or routes it. Post-deploy: the machine said PASS, the asset is live in the tenant, and a human fails it with a comment. The P1 PRD says these two entry points need different flows, and merging them into one queue would flatten the difference between \"not shipped\" and \"shipped and wrong\".",
      "An override needs a named owner and a reason, and is counted in its own bucket. It publishes DQL the system could not prove equivalent, against a false-positive guardrail the PRD describes as \"the metric we protect against, not optimize for\". Folding 38 overrides into 1,422 auto-approvals would let the system take credit for a human's judgement — and then take the blame when that judgement is wrong.",
      "Which happens: the machine's false-positive rate on this project is 0.44%, the reversal rate on human overrides is 2.6%. Six times higher, on a much smaller base. Both numbers are worth having and averaging them together hides the interesting one.",
      "The customer is a value in a field, not a second view. Reviewer identity and role sit on the validation record — which the PRD's immutable audit log requires us to persist anyway — so one screen serves the consultant and the customer without a persona switcher.",
      "No DQL editor, no context box, no re-translate button. Validate owns the verdict and the routing decision; Exceptions owns the rework. Same strict boundary Translate drew between runnable and correct, one stage later, and features.js already attributes all three controls to Exceptions.",
      "No side-by-side diff either. That is P2. What P0 asks for is a confidence score and a specific written finding — \"returns 12,400 rows in Splunk and 9,810 in Dynatrace for the same 24-hour window\", never a bare \"different\". Prose at that bar does the reviewer's job; a diff widget would only look like it did.",
      "An asset is scored only on the signals that apply to its type: four for a dashboard, four for an alert, three for a saved search. Scoring everything on five and silently passing the inapplicable ones is the easiest way to inflate every confidence number on the page.",
      "Uncertain is not a weaker kind of difference, it is an admission. Treasury Daily Pack has six panels that returned nothing on either side — an empty result matching an empty result is not evidence, and the comparison says so rather than counting it as a match.",
      "Wave 1 came in at 77.9% against Calibrate's prediction of 78.0% ±2.4. That is the calibration stage collecting on its own claim, and it is the reason the prediction is worth making.",
      "Three of the four live failures are not translation faults at all: a correct alert wired to the old on-call schedule, a correct panel with the wrong default timeframe, a correct threshold that lost a per-BIN split. The comparison could not have caught any of them, which is the argument for the post-deploy surface existing rather than trusting the gate.",
    ],

    render(root, ctx) {
      const wave = selectedWave();

      if (!wave) {
        root.append(ctx.pageHeader([button("Export audit log", { variant: "default", iconName: "download" })]), waveBoard(ctx));
        return;
      }

      const mode = modeFor(wave);
      const v = V();
      const c = v.comparisonFor(wave.id);
      const t = triageState(wave.id);

      root.append(
        // The shell renders the wave scope picker into this header and its
        // first option is All waves, so the "All waves" button that used to
        // sit here is gone rather than sitting next to its own replacement.
        ctx.pageHeader([
          button("Export audit log", { variant: "default", iconName: "download", disabled: !c }),
          mode === "complete"
            ? button("Open live review", { variant: "emphasized", iconName: "server", onClick: () => DMA.store.setSession("vaStep", "live") })
            : mode === "in-progress"
            ? button(`Triage ${fmt.num(t.open)}`, { variant: "emphasized", iconName: "flag", onClick: () => DMA.store.setSession("vaStep", "triage") })
            : button("Not reachable", { variant: "default", iconName: "lock", disabled: true }),
        ]),
        el(
          "div",
          { class: "dma-vawave" },
          el("span", { class: "dt-text-semibold" }, `Wave ${wave.id} — ${wave.name}`),
          badge(
            mode === "complete" ? "Published & validated" : mode === "in-progress" ? "Compared · triage open" : "Not compared",
            mode === "complete" ? "success" : mode === "in-progress" ? "warning" : "neutral"
          ),
          subdued(
            c
              ? `${fmt.num(c.validated)} compared · ${fmt.num(c.match)} auto-approved · ${fmt.num(c.difference + c.uncertain)} routed`
              : `${fmt.num(wave.assets)} assets · nothing translated yet`
          )
        ),
        stepper(),
        PANELS[step()](ctx, wave, mode)
      );
    },
  });
})();
