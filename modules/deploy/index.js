/* ============================================================================
   MODULE: Deploy
   ----------------------------------------------------------------------------
   Flow-diagram stage: Load → Deploy

   ----------------------------------------------------------------------------
   THIS STAGE IS A MONITOR, NOT A PUBLISHING CONSOLE

   There is no "publish wave" button on this screen, and no approve-and-release
   step anywhere in it. That is the product, not a gap in the prototype. An
   asset that clears validation goes to the tenant on its own; an asset that
   Exceptions fixes goes on its own too. Putting a human behind a button here
   would invent a gate the product does not have, and would make the automation
   look like it needs supervision it does not need.

   So the question this screen answers is not "shall we go" but "is it out yet,
   and if not, what is holding it". Every number is a state. Every action routes
   to the stage that owns the fix, or clears the one thing this stage owns.

   ----------------------------------------------------------------------------
   THE HEALTH CHECK HOLDS ASSETS. IT DOES NOT HOLD WAVES.

   The P1 PRD is explicit that the check "blocks only the specific assets that
   fail, not the whole wave", and its metric is the hardest on the roadmap:
   0 waves skip the check, under any circumstance.

   Wave 3 is the worked example and the reason this distinction is drawn so
   loudly. 14 assets are held. 361 cleared the same check and are ready to go.
   Reading that as "Wave 3 is blocked" — which the Overview banner and the wave
   health badge used to say — overstates the check by about 360 assets and makes
   it look like ceremony standing between a finished wave and the tenant. It is
   not ceremony: its scope was widened after the Globex post-mortem to cover
   throttle risk alongside data flow, because both reached production undetected.

   The bar at the top of every wave card is the whole argument in one shape.
   Five segments over one population, and `held` is visibly a sliver.

   ----------------------------------------------------------------------------
   THREE FAILURES, THREE SURFACES

     Held          the check found it before anything was written. Nothing was
                   sent. The fix is upstream — usually one mapping rule.
     Refused       the write WAS attempted and the tenant said no. RBAC,
                   ownership, bucket. The fix is a target-side permission and
                   no amount of DQL work will move it.
     Live, wrong   already in the tenant and already incorrect. Doing nothing
                   has an ongoing cost, and the fix is a write over a live
                   object — the riskiest thing this product does.

   Steps 2 and 3 exist because collapsing these into one "failed" count would
   be the single most misleading number this stage could print.

   ----------------------------------------------------------------------------
   WHAT THIS STAGE DELIBERATELY DOES NOT DO

   No wave publish control. No sign-off ceremony. No rollback — Delta &
   Versioning's rollback explicitly excludes objects already written to a live
   tenant, so offering one here would be a promise the platform cannot keep;
   the honest answer for a live-and-wrong asset is a redeploy over the top.
   No DQL editing and no re-translation — Exceptions owns both.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, modal, emptyState, fmt } = DMA.ui;

  const STEPS = [
    { id: "monitor", label: "Monitor" },
    { id: "held",    label: "Held" },
    { id: "refused", label: "Refused & wrong" },
    { id: "record",  label: "Record" },
  ];

  const wrap = { whiteSpace: "normal" };
  const DP = () => DMA.data.deploy;
  const PR = () => DMA.data.project;

  function step() {
    const id = DMA.store.session.dpStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  const waveId = () => DMA.store.session.waveId || "all";
  const selectedWave = () => {
    const id = waveId();
    if (id === "all") return null;
    return PR().waves.find((w) => String(w.id) === String(id)) || null;
  };

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
  const when = (iso) => (iso ? fmt.dateShort(iso) : "—");

  /* ========================================================================
     SESSION LAYER

     Two things a viewer can do here, and both have to move the numbers above
     them or the demo is a slideshow:

       clear a finding     held → ready, and the check's state with it
       retry a refusal     open → resolved, the open-refusal count, and — if
                           the refused write was a redeploy over a live
                           object — the live-and-wrong queue with it

     Two actions and not three, because DS-2014 taught us that a redeploy and
     a refused write are the same event seen from two sides: the asset is live
     and wrong, its fix was submitted, and the tenant refused it. Giving that
     one asset a "retry" control in one table and a "redeploy" control in
     another would be two buttons for one thing, each able to contradict the
     other. There is one control, rendered in both places, writing one key.

     The defect class this exists to prevent was found on Validate: an action
     that restyles its own row while the KPI above it still reports the fixture.
     So nothing on this screen reads `DP().waveDeploy` directly. Everything
     goes through `wave()`, which is the fixture plus whatever this session has
     done to it, and `estate()` rolls up through `wave()` rather than through
     the data layer's own estate.
     ====================================================================== */

  const CLEARED = "dpCleared"; // findingId → { how, at }
  const RETRIED = "dpRetried"; // assetId   → { at }

  const bag = (key) => DMA.store.session[key] || {};
  const didClear = (id) => Boolean(bag(CLEARED)[id]);
  const didRetry = (id) => Boolean(bag(RETRIED)[id]);

  function remember(key, id, value) {
    const all = Object.assign({}, bag(key));
    all[id] = value;
    DMA.store.setSession(key, all);
  }

  function forget(key, id) {
    const all = Object.assign({}, bag(key));
    delete all[id];
    DMA.store.setSession(key, all);
  }

  /* The fixture wave, plus this session. A cleared finding moves one asset out
     of `held` and into `ready` — the population is conserved, so the bar can
     never be made to disagree with itself by clicking things. */
  function wave(id) {
    const r = DP().waveDeploy(id);
    if (!r || !r.reached) return r;

    const findings = r.findings.map((f) =>
      f.state === "held" && didClear(f.id)
        ? Object.assign({}, f, {
            state: "cleared",
            clearedAt: bag(CLEARED)[f.id].at,
            clearedBy: "You",
            how: bag(CLEARED)[f.id].how,
            session: true,
          })
        : f
    );
    const held = findings.filter((f) => f.state === "held").length;

    const rejections = r.rejections.map((x) =>
      x.state === "open" && didRetry(x.id)
        ? Object.assign({}, x, {
            state: "resolved",
            resolvedAt: bag(RETRIED)[x.id].at,
            how: "Retried in this session. The tenant accepted the write.",
            session: true,
          })
        : x
    );

    /* An asset can be live-and-wrong AND sitting in the refusal queue at the
       same time — DS-2014 is both, because its fix was submitted and the
       tenant refused the write. That refusal is not a second problem; it is
       the reason the first one is still true. So the row carries the refusal
       with it, and the one retry resolves both. */
    const liveAndWrong = r.liveAndWrong.map((a) => {
      const refusal = rejections.find((x) => x.id === a.id) || null;
      const landed = a.awaitingRedeploy && didRetry(a.id);
      return Object.assign({}, a, {
        refusal,
        blockedByRefusal: Boolean(refusal && refusal.state === "open"),
        awaitingRedeploy: a.awaitingRedeploy && !landed,
        redeployedAt: landed ? bag(RETRIED)[a.id].at : null,
        session: landed,
      });
    });

    return Object.assign({}, r, {
      findings,
      held,
      ready: r.ready + (r.held - held),
      checkState: r.checkState === "not-run" ? "not-run" : held ? "holding" : "clear",
      rejections,
      openRejections: rejections.filter((x) => x.state === "open").length,
      liveAndWrong,
    });
  }

  const waveRows = () => PR().waves.map((w) => wave(w.id)).filter(Boolean);

  function estate() {
    const rows = waveRows();
    const run = rows.filter((r) => r.reached);
    const add = (k) => run.reduce((a, r) => a + (r[k] || 0), 0);
    const lw = run.reduce((a, r) => a.concat(r.liveAndWrong), []);
    return {
      reached: true,
      waves: rows.length,
      wavesRun: run.length,
      wavesLive: run.filter((r) => r.live > 0).length,
      wavesChecked: run.filter((r) => r.checkState !== "not-run").length,
      wavesSkipped: 0,
      population: add("population"),
      live: add("live"),
      ready: add("ready"),
      awaitingCheck: add("awaitingCheck"),
      held: add("held"),
      upstream: add("upstream"),
      openVerdicts: add("openVerdicts"),
      inExceptions: add("inExceptions"),
      openRejections: add("openRejections"),
      /* A redeployed asset is live and right, so it leaves this count — the
         row stays in the table to show what happened, but a headline that
         still read 4 after the user fixed one would be the exact defect this
         session layer exists to prevent. */
      liveAndWrong: lw.filter((a) => !a.session).length,
      awaitingRedeploy: lw.filter((a) => a.awaitingRedeploy).length,
    };
  }

  /* One shape whether the scope is a wave or the estate, so the KPI row and
     the headline do not need to know which they are looking at. */
  function totals() {
    const w = selectedWave();
    if (!w) return estate();
    const r = wave(w.id);
    if (!r || !r.reached) return null;
    return Object.assign({}, r, {
      wavesRun: 1,
      wavesLive: r.live > 0 ? 1 : 0,
      wavesChecked: r.checkState !== "not-run" ? 1 : 0,
      wavesSkipped: 0,
      liveAndWrong: r.liveAndWrong.filter((a) => !a.session).length,
      awaitingRedeploy: r.liveAndWrong.filter((a) => a.awaitingRedeploy).length,
    });
  }

  /* Findings and rejections across whatever scope is selected, read through
     the session layer rather than off the fixture. */
  const scopedFindings = () => waveRows().filter((r) => r.reached).reduce((a, r) => a.concat(r.findings), [])
    .filter((f) => waveId() === "all" || String(f.wave) === String(waveId()));
  const scopedRejections = () => waveRows().filter((r) => r.reached).reduce((a, r) => a.concat(r.rejections), [])
    .filter((x) => waveId() === "all" || String(x.wave) === String(waveId()));
  const scopedLiveAndWrong = () => waveRows().filter((r) => r.reached).reduce((a, r) => a.concat(r.liveAndWrong), [])
    .filter((a) => waveId() === "all" || String(a.wave) === String(waveId()));

  /* ======================================================================== */

  const stepper = () => {
    const active = step();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Deployment monitoring steps" });
    STEPS.forEach((s, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(s.id === active),
            onClick: () => DMA.store.setSession("dpStep", s.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, s.label)
        )
      );
    });
    return row;
  };

  /* --- The deployment bar ---------------------------------------------------
     Five segments over one publish population. The data layer derives
     `upstream` by subtraction and asserts the five sum to the population on
     load, so this bar cannot be drawn with a gap or an overlap.

     `ready` and `awaitingCheck` are separate on purpose. Both have cleared
     validation; only one has cleared the check. Merging them would let Wave 4
     report 360 assets as deployable when nothing has looked at them yet, which
     is exactly the claim the check exists to stop anybody making. ---------- */
  const SEGMENTS = [
    { key: "live",          label: "Live in the tenant", tone: "success"  },
    { key: "ready",         label: "Ready",              tone: "info"     },
    { key: "held",          label: "Held by the check",  tone: "critical" },
    { key: "awaitingCheck", label: "Awaiting the check", tone: "warning"  },
    { key: "upstream",      label: "Still upstream",     tone: "neutral"  },
  ];

  function deployBar(r) {
    const total = r.population || 1;
    const bar = el("div", { class: "dma-dpbar", role: "img", "aria-label": `${fmt.num(r.live)} of ${fmt.num(r.population)} live` });
    SEGMENTS.forEach((s) => {
      const v = r[s.key] || 0;
      if (v <= 0) return;
      bar.append(
        el("span", {
          class: "dma-dpseg",
          dataset: { tone: s.tone },
          style: { width: `${(v / total) * 100}%` },
          title: `${s.label}: ${fmt.num(v)}`,
        })
      );
    });
    return bar;
  }

  function legend(r) {
    const row = el("div", { class: "dma-dplegend" });
    SEGMENTS.forEach((s) => {
      const v = r[s.key] || 0;
      if (v <= 0) return;
      row.append(
        el(
          "span",
          { class: "dma-dplegend__item" },
          el("span", { class: "dma-dpswatch", dataset: { tone: s.tone } }),
          el("span", { class: "dt-text-semibold" }, fmt.num(v)),
          el("span", { class: "dt-text-subdued" }, s.label)
        )
      );
    });
    return row;
  }

  const tenantChip = (t) =>
    t
      ? el(
          "span",
          { class: "dma-dptenant", dataset: { tenant: t.id }, title: t.detail },
          icon("server", 12),
          el("span", { class: "dt-mono" }, t.host)
        )
      : el("span", { class: "dt-text-small dt-text-subdued" }, "No destination yet");

  const CHECK_BADGE = {
    clear:     () => badge("Check clear", "success", { iconName: "checkCircle", title: "Ran, and nothing is held." }),
    holding:   (n) => badge(`${n} held`, "critical", { iconName: "alert", title: "Ran. These assets are held; the rest are not." }),
    "not-run": () => badge("Check not run", "neutral", { iconName: "clock", title: "No ready population to run it over yet. Not the same as clean." }),
  };

  const checkBadge = (r) => CHECK_BADGE[r.checkState](r.held);

  /* ========================================================================
     STEP 1 — MONITOR
     ====================================================================== */

  function headline(ctx, t) {
    if (t.held > 0) {
      return banner(
        "warning",
        `${fmt.num(t.held)} ${t.held === 1 ? "asset is" : "assets are"} held by the pre-deploy health check. ` +
          `${fmt.num(t.ready)} cleared the same check and will go out with the wave. The check holds assets, not waves.`,
        {
          title: "The check is holding, the wave is not blocked",
          action: button("Open held assets", { variant: "default", size: "sm", onClick: () => DMA.store.setSession("dpStep", "held") }),
        }
      );
    }
    if (t.liveAndWrong > 0) {
      return banner(
        "critical",
        `${fmt.num(t.liveAndWrong)} published ${t.liveAndWrong === 1 ? "asset is" : "assets are"} in the tenant and wrong. ` +
          `${fmt.num(t.awaitingRedeploy)} ${t.awaitingRedeploy === 1 ? "has" : "have"} a fix waiting to be written over the live object.`,
        {
          title: "Live and incorrect",
          action: button("Open", { variant: "critical", size: "sm", onClick: () => DMA.store.setSession("dpStep", "refused") }),
        }
      );
    }
    if (t.ready > 0) {
      return banner("info", `${fmt.num(t.ready)} assets have cleared validation and the health check. They write to the tenant with the wave.`, {
        title: "Cleared and waiting",
      });
    }
    return banner("success", `${fmt.num(t.live)} of ${fmt.num(t.population)} assets are live in the tenant and nothing is held.`, {
      title: "Nothing is holding",
    });
  }

  function waveCard(ctx, r) {
    if (!r.reached) {
      return el(
        "div",
        { class: "dma-dpwave dma-dpwave--idle" },
        el(
          "div",
          { class: "dma-dpwave__head" },
          el("span", { class: "dt-text-semibold" }, `Wave ${r.wave.id} — ${r.wave.name}`),
          badge("Not translated", "neutral")
        ),
        subdued(`${fmt.num(r.wave.assets)} assets planned. Nothing has been translated, so there is no publish population to report yet.`)
      );
    }

    const pct = r.population ? Math.round((r.live / r.population) * 100) : 0;
    return el(
      "div",
      { class: "dma-dpwave" },
      el(
        "div",
        { class: "dma-dpwave__head" },
        el("span", { class: "dt-text-semibold" }, `Wave ${r.wave.id} — ${r.wave.name}`),
        checkBadge(r),
        el("span", { style: { marginLeft: "auto" } }, tenantChip(r.tenant))
      ),
      el(
        "div",
        { class: "dma-dpwave__stat" },
        /* A green zero reads as a success. Nothing live is not a success and
           not a failure — it is a wave that has not written yet. */
        el("span", { class: ["dma-dpwave__big", r.live ? "dma-dpwave__big--live" : null] }, `${fmt.num(r.live)}`),
        el("span", { class: "dt-text-small dt-text-subdued" }, `of ${fmt.num(r.population)} live · ${pct}%`)
      ),
      deployBar(r),
      legend(r),
      el(
        "div",
        { class: "dma-dpwave__foot" },
        r.openVerdicts
          ? button(`${fmt.num(r.openVerdicts)} awaiting a verdict`, {
              variant: "default",
              size: "sm",
              iconName: "arrowRight",
              iconAfter: true,
              onClick: () => ctx.navigate("validate"),
            })
          : null,
        r.inExceptions
          ? button(`${fmt.num(r.inExceptions)} open in Exceptions`, {
              variant: "default",
              size: "sm",
              iconName: "arrowRight",
              iconAfter: true,
              onClick: () => ctx.navigate("exceptions"),
            })
          : null,
        r.openRejections
          ? button(`${fmt.num(r.openRejections)} refused by the tenant`, {
              variant: "default",
              size: "sm",
              iconName: "alert",
              onClick: () => DMA.store.setSession("dpStep", "refused"),
            })
          : null,
        r.held
          ? button(`${fmt.num(r.held)} held`, {
              variant: "default",
              size: "sm",
              iconName: "lock",
              onClick: () => DMA.store.setSession("dpStep", "held"),
            })
          : null
      )
    );
  }

  /* Why the five segments are the five they are, for one wave. Shown only in
     wave scope, because the interesting part is the subtraction and six of
     them side by side is a wall. */
  function reconciliation(ctx, r) {
    const row = (label, n, detail, rule) =>
      el(
        "div",
        { class: ["dma-dprec__row", rule ? "dma-dprec__row--rule" : null] },
        el("span", { class: "dma-dprec__n" }, n === null ? "—" : fmt.num(n)),
        el("div", {}, el("div", { class: "dt-text-semibold" }, label), detail ? subdued(detail) : null)
      );

    return card(
      { title: "Where the population comes from", subtitle: `Wave ${r.wave.id} · every figure re-derived from the stage that produced it` },
      el(
        "div",
        { class: "dma-dprec" },
        row("Assets in the wave", r.wave.assets, "Committed in Prioritize & Plan. Not the publish population."),
        row("Translatable", r.translatable, "Entered a translation run. Dashboards, alerts, saved searches."),
        row("Prerequisites", r.prerequisites, `Lookups and macros. ${fmt.num(r.provisioned)} provision automatically and are never published as assets.`),
        row("Hand-built prerequisites", r.handBuilt, "No automated path. Rebuilt in Exceptions, then published like any other asset.", true),
        row("Publish population", r.population, "Translatable plus the hand-built prerequisites. This is the denominator on the bar.", true),
        row("Auto-approved", r.autoApproved, "Validation found an exact match. No human looked at these."),
        row("Published on override", r.overridden, "A named human disagreed with the comparison and published anyway."),
        row("Published out of Exceptions", r.fromExceptions, "Fixed by hand, checked, and written."),
        row("Live in the tenant", r.live, "The three rows above it.", true)
      ),
      note(
        "None of these are typed here. They are read back from Translate, Validate and Exceptions on every render, so this stage cannot quietly disagree with the stage that fed it."
      )
    );
  }

  /* The P1 metric, stated the way the PRD states it. A metric nobody can audit
     is not a metric, so this card names the denominator rather than printing a
     reassuring percentage. */
  function checkMetric(ctx, t) {
    return card(
      { title: "Pre-deploy health check", subtitle: "P1 · the only gate in this stage, and it gates assets" },
      el(
        "div",
        { class: "dma-dpmetric" },
        el("span", { class: "dma-dpmetric__fig dt-text-success" }, "0"),
        el(
          "div",
          {},
          el("div", { class: "dt-text-semibold" }, "waves skipped the check"),
          subdued(
            `${fmt.num(t.wavesLive)} ${t.wavesLive === 1 ? "wave has" : "waves have"} written to a tenant, and the check ran over ` +
              `${t.wavesLive === 1 ? "it" : "both"} first. ${fmt.num(t.wavesChecked)} ${t.wavesChecked === 1 ? "wave has" : "waves have"} run it in total.`
          )
        )
      ),
      el(
        "div",
        { class: "dt-stack", style: { gap: "var(--dt-spacing-8)" } },
        DP().CHECKS.map((c) =>
          el(
            "div",
            { class: "dma-dpcheck" },
            el("span", { class: "dma-dpcheck__icon" }, icon(c.icon, 15)),
            el(
              "div",
              {},
              el(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
                el("span", { class: "dt-text-semibold" }, c.label),
                badge(c.family, c.family === "Data flow" ? "info" : "warning")
              ),
              note(c.what),
              subdued(`If it is missed: ${c.harm}`),
              c.addedBy ? subdued(`Added by the ${c.addedBy}.`) : null
            )
          )
        )
      ),
      note(
        "Exceptions runs the same check against a single asset at publish time. Same check, two scopes — not two checks, and neither can be skipped."
      )
    );
  }

  function monitorPanel(ctx) {
    const w = selectedWave();
    const t = totals();

    if (w && !t) {
      return emptyState(
        "clock",
        `Wave ${w.id} has not reached deployment`,
        `${fmt.num(w.assets)} assets are planned for this wave, but nothing has been translated yet. There is no publish population to monitor, which is not the same as a population of zero.`,
        button("Open Prioritize & Plan", { variant: "default", iconName: "arrowRight", iconAfter: true, onClick: () => ctx.navigate("prioritize-plan") })
      );
    }

    const rows = w ? [wave(w.id)] : waveRows();
    const stack = el("div", { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } });

    stack.append(
      headline(ctx, t),
      kpiRow(
        kpi("Live in the tenant", fmt.num(t.live), `of ${fmt.num(t.population)} in the publish population`, { iconName: "server", tone: "success" }),
        kpi("Cleared, waiting on the wave", fmt.num(t.ready), "through validation and the check", { iconName: "checkCircle", tone: "info" }),
        kpi("Held by the check", fmt.num(t.held), t.held ? "nothing was written for these" : "nothing is held", {
          iconName: "lock",
          tone: t.held ? "critical" : "success",
        }),
        kpi("Live and wrong", fmt.num(t.liveAndWrong), `${fmt.num(t.awaitingRedeploy)} with a fix waiting`, {
          iconName: "alert",
          tone: t.liveAndWrong ? "critical" : "success",
        })
      ),
      card(
        { title: w ? `Wave ${w.id}` : "Every wave", subtitle: "One publish population per wave, split five ways", flush: true },
        el("div", { class: ["dma-dpwaves", w ? "dma-dpwaves--single" : null] }, rows.map((r) => waveCard(ctx, r)))
      )
    );

    if (w && t.reached) stack.append(reconciliation(ctx, wave(w.id)));
    stack.append(checkMetric(ctx, t));

    return stack;
  }

  /* ========================================================================
     STEP 2 — HELD
     ====================================================================== */

  function clearModal(f) {
    const c = DP().checkById(f.check);
    const how = el("textarea", {
      class: "dt-textarea",
      rows: 3,
      placeholder: "What changed? e.g. scoped to wu_treasury_* in the Wave 3 mapping rule",
    });

    const m = modal(
      `Clear ${f.id}`,
      el(
        "div",
        { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
          el("span", { class: "dt-text-semibold" }, f.name),
          badge(f.type, "neutral"),
          badge(c.family, c.family === "Data flow" ? "info" : "warning")
        ),
        banner("warning", f.detail, { title: c.label }),
        note(`What the check is looking for: ${c.what}`),
        subdued(`If it is missed: ${c.harm}`),
        el("label", { class: "dt-field" }, el("span", { class: "dt-field__label" }, "How it was fixed"), how),
        subdued(
          "Clearing records that the finding no longer applies and re-runs the check against this asset. It does not publish anything — the asset goes out with its wave."
        )
      ),
      [
        button("Cancel", { variant: "default", onClick: () => m.close() }),
        button("Clear the finding", {
          variant: "emphasized",
          iconName: "check",
          onClick: () => {
            remember(CLEARED, f.id, {
              how: how.value.trim() || "Cleared in this session. No detail recorded.",
              at: new Date().toISOString(),
            });
            m.close();
          },
        }),
      ]
    );
    return m;
  }

  const FAMILIES = ["All families", "Data flow", "Throttle limit"];

  function heldPanel(ctx) {
    const family = DMA.store.session.dpFamily || FAMILIES[0];
    const showCleared = Boolean(DMA.store.session.dpShowCleared);

    const all = scopedFindings();
    const open = all.filter((f) => f.state === "held");
    const rows = all
      .filter((f) => (showCleared ? true : f.state === "held"))
      .filter((f) => family === FAMILIES[0] || DP().checkById(f.check).family === family)
      .sort((a, b) => (a.state === b.state ? a.wave - b.wave : a.state === "held" ? -1 : 1));

    const filters = el(
      "div",
      { class: "dma-dpfilters" },
      el(
        "select",
        {
          class: "dt-input",
          "aria-label": "Check family",
          onChange: (e) => DMA.store.setSession("dpFamily", e.target.value),
        },
        FAMILIES.map((f) => el("option", { value: f, selected: f === family }, f))
      ),
      el(
        "label",
        { class: "dt-text-small dt-text-secondary", style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-6)" } },
        el("input", {
          type: "checkbox",
          checked: showCleared,
          onChange: (e) => DMA.store.setSession("dpShowCleared", e.target.checked),
        }),
        "Show findings already cleared"
      ),
      el("span", { class: "dt-text-small dt-text-subdued", style: { marginLeft: "auto" } }, `${fmt.num(rows.length)} shown · ${fmt.num(open.length)} open`)
    );

    const sameRule = open.filter((f) => f.check === "throttle-bucket").length;

    const body = open.length
      ? table(
          [
            {
              label: "Asset",
              width: "26%",
              render: (f) =>
                el(
                  "div",
                  {},
                  el("div", { class: "dt-text-semibold" }, f.name),
                  subdued(`${f.id} · ${f.type} · ${f.app}`)
                ),
            },
            { label: "Wave", width: "7%", render: (f) => badge(`W${f.wave}`, "neutral") },
            {
              label: "Check",
              width: "16%",
              render: (f) => {
                const c = DP().checkById(f.check);
                return el("div", {}, badge(c.family, c.family === "Data flow" ? "info" : "warning"), subdued(c.label));
              },
            },
            { label: "What the check found", width: "33%", render: (f) => note(f.detail) },
            {
              label: "",
              width: "18%",
              render: (f) =>
                f.state === "held"
                  ? button("Clear", { variant: "default", size: "sm", iconName: "check", onClick: () => clearModal(f) })
                  : f.session
                  ? el(
                      "div",
                      { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
                      badge("Cleared", "success", { iconName: "check" }),
                      button("Undo", { variant: "default", size: "sm", onClick: () => forget(CLEARED, f.id) })
                    )
                  : el(
                      "div",
                      {},
                      badge("Cleared", "success", { iconName: "check" }),
                      subdued(`${f.clearedBy} · ${when(f.clearedAt)}`)
                    ),
            },
          ],
          rows
        )
      : emptyState(
          "checkCircle",
          "Nothing is held",
          waveId() === "all"
            ? "Every finding the check has raised has been cleared. The record of them is still here — turn on cleared findings to read it."
            : "The check found nothing outstanding in this wave."
        );

    return el(
      "div",
      { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
      sameRule >= 3
        ? banner(
            "info",
            `${fmt.num(sameRule)} of the ${fmt.num(open.length)} open findings are the same mistake: a mapping rule that scopes buckets was applied to the earlier waves and never carried into this one. One change in Global Mapping clears most of this list.`,
            {
              title: "Most of these are one rule, not one problem each",
              action: button("Open Global Mapping", { variant: "default", size: "sm", iconName: "arrowRight", iconAfter: true, onClick: () => ctx.navigate("global-mapping") }),
            }
          )
        : null,
      card({ title: "Held by the health check", subtitle: "Nothing was written for these. The fix is upstream of the tenant.", actions: filters, flush: !!open.length }, body),
      card(
        { title: "What holding means" },
        note(
          "A held asset was never sent. The check runs over the wave's ready population before the first write, keeps back the rows that fail it, and lets everything else through — so a wave with findings still deploys, minus those rows."
        ),
        note(
          "Clearing a finding here records that it no longer applies and returns the asset to the ready population. It does not publish: the asset goes out with its wave, like every other asset in it."
        )
      )
    );
  }

  /* ========================================================================
     STEP 3 — REFUSED & WRONG
     ====================================================================== */

  /* One modal for both surfaces. `overLive` is true when the refused write was
     a redeploy over an object that is already in the tenant — the riskiest
     write this product makes, and the only one that needs its own warning. */
  function retryModal(x, overLive) {
    const reason = DP().REJECTION_REASONS[x.reason];
    const wv = PR().waves.find((w) => String(w.id) === String(x.wave));
    const tenant = wv ? DP().tenantFor(wv) : null;
    const prod = tenant && tenant.id === "prod";

    const m = modal(
      overLive ? `Redeploy ${x.id} over the live object` : `Retry the write — ${x.id}`,
      el(
        "div",
        { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
          el("span", { class: "dt-text-semibold" }, x.name),
          badge(x.type, "neutral"),
          tenant ? badge(tenant.label, prod ? "critical" : "info") : null
        ),
        banner("critical", x.detail, { title: reason.label }),
        note(`How this is fixed: ${reason.fix}`),
        overLive
          ? banner(
              prod ? "critical" : "warning",
              `This asset is already in ${prod ? "the production tenant" : "the staging tenant"} and is wrong. The corrected version is written over the live object — there is no second copy, and no rollback to the one it replaces.`,
              { title: "This write goes over something that is live" }
            )
          : null,
        overLive
          ? note(
              "Delta & Versioning can roll back a translation. It explicitly cannot roll back an object already written to a tenant, which is why the honest control here is a redeploy rather than an undo."
            )
          : null,
        subdued(
          "Retrying assumes the underlying permission or mapping has been corrected in the target. DMA cannot grant itself the scope it was refused."
        )
      ),
      [
        button("Cancel", { variant: "default", onClick: () => m.close() }),
        button(overLive ? "Write over the live object" : "Retry the write", {
          variant: prod && overLive ? "critical" : "emphasized",
          iconName: overLive ? "upload" : "refresh",
          onClick: () => {
            remember(RETRIED, x.id, { at: new Date().toISOString() });
            m.close();
          },
        }),
      ]
    );
    return m;
  }

  function refusedPanel(ctx) {
    const rejections = scopedRejections();
    const open = rejections.filter((x) => x.state === "open");
    const lw = scopedLiveAndWrong();
    const stillWrong = lw.filter((a) => !a.session);
    const waiting = lw.filter((a) => a.awaitingRedeploy);

    const explainer = el(
      "div",
      { class: "dma-dpsplit" },
      el(
        "div",
        { class: "dma-dpsplit__half" },
        el("div", { class: "dt-text-semibold" }, "Refused by the tenant"),
        note(
          "The write was attempted and the target said no. Nothing about the translation is wrong — the account cannot write there, the owner does not exist, or the bucket was never provisioned."
        ),
        subdued("Fixed in the target, not in DMA. Every one of these is somebody else's permission to grant.")
      ),
      el(
        "div",
        { class: "dma-dpsplit__half" },
        el("div", { class: "dt-text-semibold" }, "Live and wrong"),
        note(
          "Already in the tenant, already incorrect. Found by a human after publication, not by the comparison — three of the four were correct translations wired to the wrong thing."
        ),
        subdued("Every hour one of these stays up is an hour somebody may be trusting it. Doing nothing is a decision.")
      )
    );

    const reasonCell = (x) => {
      const r = DP().REJECTION_REASONS[x.reason];
      return el("div", {}, badge(r.label, "critical", { iconName: r.icon, title: r.detail }), subdued(r.fix));
    };

    const rejectionTable = rejections.length
      ? table(
          [
            {
              label: "Asset",
              width: "24%",
              render: (x) => el("div", {}, el("div", { class: "dt-text-semibold" }, x.name), subdued(`${x.id} · ${x.type} · ${x.app}`)),
            },
            { label: "Wave", width: "7%", render: (x) => badge(`W${x.wave}`, "neutral") },
            { label: "Why the tenant refused", width: "22%", render: reasonCell },
            { label: "Detail", width: "28%", render: (x) => note(x.detail) },
            {
              label: "",
              width: "19%",
              /* One of these three refusals is a redeploy that was refused,
                 so its control is labelled for what it actually does. Same
                 modal, same session key, different stakes — and a row that
                 writes over a live object should not look like the two that
                 are creating something new. */
              render: (x) => {
                const overLive = lw.some((a) => a.id === x.id);
                return x.state === "open"
                  ? button(overLive ? "Redeploy" : "Retry the write", {
                      variant: overLive ? "critical" : "default",
                      size: "sm",
                      iconName: overLive ? "upload" : "refresh",
                      title: overLive ? "This asset is already live and wrong. The retry writes over it." : null,
                      onClick: () => retryModal(x, overLive),
                    })
                  : x.session
                  ? el(
                      "div",
                      { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
                      badge("Accepted", "success", { iconName: "check" }),
                      button("Undo", { variant: "default", size: "sm", onClick: () => forget(RETRIED, x.id) })
                    )
                  : el("div", {}, badge("Resolved", "success", { iconName: "check" }), subdued(`${when(x.resolvedAt)} · ${x.how}`));
              },
            },
          ],
          rejections.slice().sort((a, b) => (a.state === b.state ? a.wave - b.wave : a.state === "open" ? -1 : 1))
        )
      : emptyState("server", "No write has been refused", "Only a wave that has written to a tenant can have a refusal. Nothing in this scope has written yet.");

    const lwTable = lw.length
      ? table(
          [
            {
              label: "Asset",
              width: "26%",
              render: (a) => el("div", {}, el("div", { class: "dt-text-semibold" }, a.name), subdued(`${a.id} · ${a.type} · ${a.app}`)),
            },
            { label: "Wave", width: "8%", render: (a) => badge(`W${a.wave}`, "neutral") },
            {
              label: "Where it is live",
              width: "22%",
              render: (a) => el("div", {}, badge(a.tenant, a.tenant === "Production" ? "critical" : "info", { iconName: "server" })),
            },
            {
              label: "State of the fix",
              width: "24%",
              render: (a) =>
                a.session
                  ? el("div", {}, badge("Redeployed in this session", "success", { iconName: "check" }), subdued(when(a.redeployedAt)))
                  : a.blockedByRefusal
                  ? el(
                      "div",
                      {},
                      badge("Fix submitted · refused", "critical", { iconName: "lock" }),
                      subdued(`${DP().REJECTION_REASONS[a.refusal.reason].label}. The write never landed, so it is still live and still wrong.`)
                    )
                  : a.awaitingRedeploy
                  ? badge("Fixed · not yet written", "warning", { iconName: "clock" })
                  : badge("Still being worked in Exceptions", "neutral", { iconName: "edit" }),
            },
            {
              label: "",
              width: "20%",
              render: (a) =>
                a.session
                  ? button("Undo", { variant: "default", size: "sm", onClick: () => forget(RETRIED, a.id) })
                  : a.blockedByRefusal
                  ? button("Redeploy over the live object", {
                      variant: "critical",
                      size: "sm",
                      iconName: "upload",
                      onClick: () => retryModal(a.refusal, true),
                    })
                  : a.awaitingRedeploy
                  ? subdued("Goes out with the wave's next write.")
                  : button("Open in Exceptions", { variant: "default", size: "sm", iconName: "arrowRight", iconAfter: true, onClick: () => ctx.navigate("exceptions") }),
            },
          ],
          lw
        )
      : emptyState("checkCircle", "Nothing live is known to be wrong", "No published asset in this scope has failed a human review in the tenant.");

    return el(
      "div",
      { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
      kpiRow(
        kpi("Refused by the tenant", fmt.num(open.length), `${fmt.num(rejections.length - open.length)} already resolved and retried`, {
          iconName: "lock",
          tone: open.length ? "critical" : "success",
        }),
        kpi("Live and wrong", fmt.num(stillWrong.length), `${fmt.num(waiting.length)} with a fix waiting to be written`, {
          iconName: "alert",
          tone: stillWrong.length ? "critical" : "success",
        })
      ),
      card({ title: "Two failures that look alike and are not" }, explainer),
      card(
        { title: "Refused by the tenant", subtitle: "The write happened. The target said no.", flush: !!rejections.length },
        rejectionTable
      ),
      card(
        { title: "Live and wrong", subtitle: "In the tenant, incorrect, and costing something right now.", flush: !!lw.length },
        lwTable
      ),
      card(
        { title: "Why there is no rollback here" },
        note(
          "Delta & Versioning keeps a version history of every translation and can roll one back. What it explicitly cannot do is roll back an object that has already been written to a live tenant — the tenant is not DMA's to version."
        ),
        note("So the only honest control for a live-and-wrong asset is a redeploy over the top, and this screen names it that way rather than offering an undo that would not work.")
      )
    );
  }

  /* ========================================================================
     STEP 4 — RECORD
     ====================================================================== */

  function recordPanel(ctx) {
    const rows = waveRows().filter((r) => r.reached);
    const events = DP().eventsFor(waveId());

    const recordTable = table(
      [
        { label: "Wave", width: "20%", render: (r) => el("div", {}, el("div", { class: "dt-text-semibold" }, `Wave ${r.wave.id}`), subdued(r.wave.name)) },
        { label: "Destination", width: "26%", render: (r) => tenantChip(r.tenant) },
        { label: "Published", width: "14%", render: (r) => (r.wave.published ? note(when(r.wave.published)) : subdued("Not yet")) },
        {
          label: "Written",
          width: "14%",
          render: (r) => el("div", {}, el("span", { class: "dt-text-semibold" }, fmt.num(r.live)), subdued(`of ${fmt.num(r.population)}`)),
        },
        {
          label: "Health check",
          width: "14%",
          render: (r) => checkBadge(r),
        },
        {
          label: "First-write refusals",
          width: "12%",
          render: (r) =>
            r.rejections.length
              ? el("div", {}, el("span", { class: "dt-text-semibold" }, fmt.num(r.rejections.length)), subdued(`${fmt.num(r.openRejections)} open`))
              : subdued("—"),
        },
      ],
      rows
    );

    const feed = el(
      "div",
      { class: "dma-dpevents" },
      events.length
        ? events.map((e) =>
            el(
              "div",
              { class: "dma-dpevent" },
              el("span", { class: "dma-dpevent__dot", dataset: { kind: e.kind } }),
              el(
                "div",
                { class: "dma-dpevent__body" },
                el(
                  "div",
                  { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
                  badge(`W${e.wave}`, "neutral"),
                  badge(e.kind, DP().EVENT_TONE[e.kind] || "neutral"),
                  el("span", { class: "dt-text-small dt-text-subdued" }, when(e.at))
                ),
                note(e.text),
                subdued(e.actor)
              )
            )
          )
        : emptyState("fileText", "Nothing recorded yet", "This wave has not written to a tenant, so there is nothing in the deployment record for it.")
    );

    return el(
      "div",
      { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
      card({ title: "Publish record", subtitle: "Shipped capability — publish status is recorded for audit and reporting", flush: true }, recordTable),
      card({ title: "Deployment record", subtitle: "Written as events, because every useful question about a deployment is a question about when" }, feed),
      card(
        { title: "Promotion to production" },
        note(
          "Wave 2 is live in the staging tenant and has not been promoted. That promotion is a customer sign-off, and it is made outside DMA — in a change-approval process this product has no visibility into and should not pretend to own."
        ),
        note(
          "What DMA does is record it: which tenant, which assets, when, and who signed. Wave 1 shows the finished shape — signed off on Oct 9 and written to production the same morning."
        ),
        el(
          "div",
          { class: "dma-dpnote" },
          icon("info", 15),
          subdued(
            "The one control this stage could plausibly have offered — an approve-and-release button — is deliberately absent. Assets that clear validation and the check deploy on their own, and inventing a human gate here would misrepresent how the product works."
          )
        )
      )
    );
  }

  /* ======================================================================== */

  const PANELS = {
    monitor: monitorPanel,
    held: heldPanel,
    refused: refusedPanel,
    record: recordPanel,
  };

  DMA.register({
    id: "deploy",
    title: "Deploy",
    phase: "load",
    icon: "upload",
    status: "ready",
    scope: "wave",
    summary: "Watch each wave reach the tenant, and see what is holding whatever has not.",

    steps: STEPS,

    notes: [
      "There is no publish control on this screen. Assets that clear validation deploy on their own, and assets that Exceptions fixes publish themselves — so the one button this stage could obviously have had would invent a gate the product does not have. The stage reports; it does not release.",
      "The health check blocks assets, not waves. Wave 3 has 14 held and 361 cleared and ready. Calling that \"Wave 3 is blocked\" — which the Overview banner and the wave health badge used to do — overstates the check by about 360 assets and makes a real safety gate look like ceremony.",
      "Ready and awaiting-the-check are counted separately. Both have cleared validation; only one has cleared the check. Merging them would report Wave 4's 360 validated assets as deployable when nothing has looked at them yet, which is precisely the claim the check exists to prevent.",
      "Three failure modes, three surfaces, because they are not the same failure. Held means nothing was sent and the fix is upstream. Refused means the write happened and the tenant said no, which is a permission nobody in DMA can grant. Live and wrong means it is already out there and already costing something.",
      "Nine of Wave 3's fourteen findings are one mapping rule that was never carried forward from Waves 1–2. The screen says so and links to Global Mapping, because fourteen rows that are really one problem should not be worked fourteen times.",
      "The cleared findings from Waves 1 and 2 stay in the record. The check's metric is that no wave ever skips it, and that is only provable from history — a screen that showed only open findings would make the metric unauditable.",
      "No rollback. Delta & Versioning can roll back a translation but explicitly cannot roll back an object already written to a live tenant, so the control offered for a live-and-wrong asset is a redeploy over the top, named as exactly that.",
      "Every population is re-derived from Translate, Validate and Exceptions on each render rather than stored here, and the five segments of the deployment bar are asserted to sum to the publish population on load. A bar whose segments overlap is worth less than the realism that would buy.",
    ],

    render(root, ctx) {
      const w = selectedWave();
      const t = totals();

      root.append(
        // The shell renders the wave scope picker into this header and its
        // first option is All waves, so the "All waves" button that used to
        // sit here is gone rather than sitting next to its own replacement.
        ctx.pageHeader(
          [
            button("Export deployment record", { variant: "default", iconName: "download" }),
            t && t.held
              ? button(`${fmt.num(t.held)} held`, { variant: "emphasized", iconName: "lock", onClick: () => DMA.store.setSession("dpStep", "held") })
              : button("Monitor", { variant: "emphasized", iconName: "server", onClick: () => DMA.store.setSession("dpStep", "monitor") }),
          ].filter(Boolean)
        ),
        el(
          "div",
          { class: "dma-dpwavestrip" },
          el("span", { class: "dt-text-semibold" }, w ? `Wave ${w.id} — ${w.name}` : "All waves"),
          t
            ? badge(`${fmt.num(t.live)} live`, t.live ? "success" : "neutral", { iconName: "server" })
            : badge("Not reached", "neutral", { iconName: "clock" }),
          t && t.held ? badge(`${fmt.num(t.held)} held`, "critical", { iconName: "lock" }) : null,
          subdued(
            t
              ? `${fmt.num(t.population)} in the publish population · ${fmt.num(t.ready)} cleared and waiting · ${fmt.num(t.upstream)} still upstream`
              : `${fmt.num(w.assets)} assets planned · nothing translated yet`
          )
        ),
        stepper(),
        PANELS[step()](ctx)
      );
    },
  });
})();
