/* ============================================================================
   MODULE: Prioritize & Plan
   ----------------------------------------------------------------------------
   Flow-diagram stage: Extract → Prioritize & Plan
   The fan-out point. Everything before this stage is one linear track over the
   whole estate; everything after it runs once per wave.

   The live product asks for the plan in the wrong order: create waves, create
   groups, create assignments, then open the explorer and attach assets one by
   one. Its own screenshots show the cost — "4,108 unassigned assets" in the
   wave builder, and 13,946 assignments reconciled against a manifest holding
   13,937. Both are failures of PER-ASSET stored membership.

   The fix is not to stop storing membership. It is to store it one layer up:

     declare priority on 19 applications  → a seeded proposal
     the EPM reorganises the proposal     → 19 stored placements
     2,908 assets inherit their wave      → nothing stored per asset

   Revised Oct 21 2026. The previous build resolved wave membership from a
   capacity ceiling and never stored it, which implemented half of the approved
   Priority-Driven Wave Generator PRD — "proposes wave grouping and order from
   app priority, respecting dependency checks" — and dropped the other half:
   "still EPM-adjustable". A consultant learns things the generator cannot see:
   a filing date, a change freeze, a shared release train. The seed proposes 4
   waves; this project committed 6. That delta is the stage's argument.

   Capacity modelling has been removed. Translation throughput is a rate, not a
   wave-size cap — a bigger wave takes longer, it does not fail — and review
   bandwidth is a scoping and progress question. `capacity-planner` is parked
   in data/features.js rather than re-homed.

   Two P3 features land here:
     Priority-Driven Wave Generator  — seed() in data/planning.js, then edit
     Support Wave Assignment for Non-Dashboard Asset Types — the orphan queue

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, progress, fmt } = DMA.ui;

  const STEPS = [
    { id: "priority",    label: "Set priority" },
    { id: "waves",       label: "Organize waves" },
    { id: "calibration", label: "Calibration set" },
    { id: "owners",      label: "Owners & commit" },
  ];

  const wrap = { whiteSpace: "normal" };
  const P = () => DMA.data.planning;

  /* --- Session state -------------------------------------------------------
     Three independent edit buffers, none written back to the fixture: tier
     changes (which re-seed the proposal), placement changes (which move an
     application between committed waves), and orphan decisions. Each resets
     cleanly, which is what makes "discard" honest. */
  function step() {
    const id = DMA.store.session.planStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  const tierEdits    = () => DMA.store.session.planTiers || {};
  const placeEdits   = () => DMA.store.session.planPlacement || {};
  const orphanEdits  = () => DMA.store.session.planOrphans || {};
  const extraWaves   = () => DMA.store.session.planExtraWaves || [];

  function waveList() {
    /* `!= null` rather than a truthy test: order 0 is a legitimate position and
       a truthy test would silently ignore it, leaving the wave where it was. */
    const reorder = DMA.store.session.planWaveOrder || null;
    return P()
      .waves.concat(extraWaves())
      .map((w) => (reorder && reorder[w.id] != null ? { ...w, order: reorder[w.id] } : w))
      .sort((a, b) => a.order - b.order);
  }

  function placement() {
    return { ...P().placement, ...placeEdits() };
  }

  function dirty() {
    return (
      Object.keys(tierEdits()).length > 0 ||
      Object.keys(placeEdits()).length > 0 ||
      Object.keys(orphanEdits()).length > 0 ||
      extraWaves().length > 0
    );
  }

  const plan   = () => P().committed(placement(), waveList(), orphanEdits());
  const viols  = () => P().violations(placement(), waveList());
  const tally  = () => P().orphanTally(orphanEdits());

  function setTier(appId, tierId) {
    const t = { ...tierEdits() };
    const declared = P().appById(appId).tier;
    if (tierId === declared) delete t[appId];
    else t[appId] = tierId;
    DMA.store.setSession("planTiers", t);
  }

  function setPlacement(appId, waveId) {
    const p = { ...placeEdits() };
    if (P().placement[appId] === waveId) delete p[appId];
    else p[appId] = waveId;
    DMA.store.setSession("planPlacement", p);
  }

  function setOrphan(orpId, value) {
    const o = { ...orphanEdits() };
    const base = P().unmapped.find((x) => x.id === orpId);
    const original = base.state === "assigned" ? base.wave : base.state;
    if (value === original) delete o[orpId];
    else o[orpId] = value;
    DMA.store.setSession("planOrphans", o);
  }

  function addWave() {
    const list = waveList();
    const id = Math.max(0, ...list.map((w) => w.id)) + 1;
    DMA.store.setSession("planExtraWaves", extraWaves().concat([
      { id, order: list.length + 1, name: `Wave ${id}`, note: "Created by hand. Nothing placed in it yet.", added: true },
    ]));
  }

  function moveWave(waveId, delta) {
    /* Reordering rewrites `order` only. Membership is keyed on the wave id, so
       a reorder never touches a single placement — which is the whole reason
       ids and order are separate fields. */
    const list = waveList();
    const i = list.findIndex((w) => w.id === waveId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const reordered = list.slice();
    const [moved] = reordered.splice(i, 1);
    reordered.splice(j, 0, moved);
    const orderById = {};
    reordered.forEach((w, k) => (orderById[w.id] = k + 1));
    DMA.store.setSession("planWaveOrder", orderById);
    DMA.store.setSession(
      "planExtraWaves",
      extraWaves().map((w) => ({ ...w, order: orderById[w.id] }))
    );
  }

  function resetAll() {
    DMA.store.session.planPlacement = {};
    DMA.store.session.planOrphans = {};
    DMA.store.session.planExtraWaves = [];
    DMA.store.session.planWaveOrder = null;
    DMA.store.setSession("planTiers", {});
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

  const tierDef = (id) => P().tiers.find((t) => t.id === id) || P().tiers[3];
  const initials = (n) => n.split(" ").map((x) => x[0]).join("");

  const stepper = () => {
    const active = step();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Prioritize and plan steps" });
    STEPS.forEach((s, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(s.id === active),
            onClick: () => DMA.store.setSession("planStep", s.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, s.label)
        )
      );
    });
    return row;
  };

  /* --- Step 1: Set priority -------------------------------------------------
     Two populations, and they are genuinely different problems. Nineteen
     applications need a tier, which seeds the proposal. Forty-seven orphaned
     assets need a home, which no tier can give them because they belong to no
     application. The live product has nowhere to put the second group, which
     is how an estate accumulates assets nobody ever placed. */
  function stepPriority() {
    const p = P();
    const apps = p.effectiveTiers(tierEdits());
    const promoted = apps.filter((a) => a.effectiveRank < a.declaredRank);
    const changed = tierEdits();
    const t = tally();

    const appRow = (app) => {
      const current = changed[app.id] || app.tier;
      const isChanged = Boolean(changed[app.id]);
      const eff = tierDef(app.effectiveTier);

      return el(
        "div",
        { class: ["dma-appcard", isChanged ? "dma-appcard--changed" : null] },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("span", { class: "dt-text-medium dt-grow" }, app.name),
          el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, `${fmt.num(app.assets)} assets`)
        ),
        el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, app.basis),
        el(
          "div",
          { class: "dma-tierpick", role: "group", "aria-label": `Priority for ${app.name}` },
          p.tiers.map((tier) =>
            el(
              "button",
              {
                class: ["dma-tierpick__opt", current === tier.id ? "dma-tierpick__opt--on" : null],
                "data-tone": tier.tone,
                "aria-pressed": String(current === tier.id),
                title: tier.definition,
                onClick: () => setTier(app.id, tier.id),
              },
              tier.label
            )
          )
        ),
        app.pulledForwardBy.length
          ? el(
              "div",
              { class: "dma-promote" },
              icon("gitBranch", 13),
              el(
                "span",
                { style: wrap },
                `Effective priority ${eff.label} — ${app.pulledForwardBy.join(" and ")} cannot ship without it.`
              )
            )
          : el(
              "div",
              { class: "dt-text-small dt-text-subdued", style: wrap },
              app.dependentCount
                ? `${app.dependentCount} application${app.dependentCount === 1 ? "" : "s"} depend on it.`
                : "Nothing depends on it."
            )
      );
    };

    const orphanRow = (o) => {
      const live = p.orphanStates(orphanEdits()).find((x) => x.id === o.id);
      const tone = live.state === "assigned" ? "success" : live.state === "pending" ? "warning" : "neutral";
      return el(
        "div",
        { class: ["dma-orphan", `dma-orphan--${live.state}`] },
        el(
          "div",
          { class: "dt-row dt-gap-8" },
          el("span", { class: "dt-text-medium dt-grow" }, live.label),
          badge(`${live.count} assets`, "neutral", { iconName: "layers" }),
          badge(live.type, "neutral")
        ),
        el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, live.reason),
        el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, live.evidence),
        el(
          "div",
          { class: "dt-row dt-gap-8 dt-wrap" },
          el("span", { class: "dt-text-small dt-text-subdued" }, "Assign to"),
          waveList().map((w) =>
            el(
              "button",
              {
                class: ["dma-orphan__opt", live.state === "assigned" && live.wave === w.id ? "dma-orphan__opt--on" : null],
                "aria-pressed": String(live.state === "assigned" && live.wave === w.id),
                onClick: () => setOrphan(o.id, w.id),
              },
              String(w.order)
            )
          ),
          el(
            "button",
            {
              class: ["dma-orphan__opt", "dma-orphan__opt--drop", live.state === "out-of-scope" ? "dma-orphan__opt--on" : null],
              "aria-pressed": String(live.state === "out-of-scope"),
              onClick: () => setOrphan(o.id, "out-of-scope"),
            },
            "Out of scope"
          )
        ),
        live.state === "assigned" && live.by
          ? el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, `Placed by ${live.by}${live.at ? ` · ${fmt.date(live.at)}` : ""}`)
          : live.state === "out-of-scope" && live.why
            ? el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, live.why)
            : null
      );
    };

    const pending = p.unmapped.filter((o) => o.state === "pending" || orphanEdits()[o.id] !== undefined);
    const settled = p.unmapped.filter((o) => !pending.includes(o));

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Applications", String(p.applications.length), `${fmt.num(p.applications.reduce((n, a) => n + a.assets, 0))} assets inherit a wave from one of these`, { iconName: "layers" }),
        kpi("Promoted by a dependent", String(promoted.length), promoted.length ? promoted.map((a) => a.short).join(", ") : "No promotions", { iconName: "gitBranch", tone: "primary" }),
        kpi("Unmapped assets", String(t.total), `${t.groups} orphan groups · no application attribution`, { iconName: "helpCircle" }),
        kpi("Awaiting a decision", String(t.pending), t.pending ? `${t.pendingGroups} groups · blocks nothing yet` : "Queue is clear", {
          iconName: t.pending ? "alert" : "checkCircle",
          tone: t.pending ? "warning" : "success",
        })
      ),
      banner(
        "info",
        "A tier is not a wave. It seeds the proposal on the next step, which the EPM then reorganises — the four tiers exist so that nineteen applications can be sorted with four judgements instead of nineteen, and so the dependency graph can settle the rest. An application inherits the highest priority of anything that transitively depends on it, which is why Platform Shared Services is declared Low and still ships first.",
        { title: "Priority is the seed, not the plan" }
      ),
      card(
        {
          title: "Declared priority",
          subtitle: `${p.applications.length} applications · ${Object.keys(changed).length} changed this session`,
        },
        el("div", { class: "dma-appgrid" }, apps.map(appRow))
      ),
      card(
        {
          title: "Unmapped assets",
          subtitle: `${t.total} of 2,955 carry no application — ${t.assigned} placed, ${t.pending} pending, ${t.outOfScope} out of scope`,
        },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          banner(
            t.pending ? "warning" : "success",
            "These were written against the shared index, authored in a personal namespace, or point at a source that no longer exists. No application owns them, so no tier reaches them and nothing inherits a wave on their behalf. They are grouped by why they are orphaned, because that is the unit a human can decide on — ruling on \u201cscratch dashboards by departed authors\u201d once beats ruling on six dashboards separately. Assets left pending are counted in neither a wave nor the excluded total, which is deliberate: the reconciliation gap is shown rather than hidden.",
            {
              title: t.pending
                ? `${t.pendingGroups} group${t.pendingGroups === 1 ? "" : "s"} still need a decision — ${t.pending} assets`
                : "Every unmapped group has been decided",
            }
          ),
          pending.length ? el("div", { class: "dma-appgrid" }, pending.map(orphanRow)) : null,
          settled.length
            ? el(
                "details",
                { class: "dma-details" },
                el("summary", {}, `Settled groups (${settled.length})`),
                el("div", { class: "dma-appgrid", style: { marginTop: "var(--dt-spacing-12)" } }, settled.map(orphanRow))
              )
            : null
        )
      )
    );
  }

  /* --- Step 2: Organize waves ----------------------------------------------
     The step the previous build did not have. It showed a generated plan and
     offered no way to disagree with it, which made the stage a report rather
     than a tool. Here the seed is a starting point and everything about the
     committed plan is editable: membership, wave count, wave order.

     The only thing that is not editable is the dependency rule, and it is
     checked live rather than enforced by construction — a human is allowed to
     make the mistake, but not to miss it. */
  function stepWaves() {
    const p = P();
    const pl = plan();
    const d = p.seedDelta(tierEdits());
    const dep = p.departures(tierEdits());
    const v = viols();
    const t = tally();
    const list = waveList();
    const byId = Object.fromEntries(p.effectiveTiers(tierEdits()).map((a) => [a.id, a]));

    const waveCard = (w, i) => {
      const members = w.apps.map((a) => byId[a.id]).filter(Boolean);
      const ranks = members.map((m) => m.effectiveRank);
      const best = ranks.length ? Math.min(...ranks) : 3;
      const waveTier = p.tiers.find((x) => x.rank === best) || p.tiers[3];
      const broken = v.filter((x) => x.appWave === w.order);

      return el(
        "div",
        { class: ["dma-wave", broken.length ? "dma-wave--broken" : null] },
        el(
          "div",
          { class: "dma-wave__head" },
          el("span", { class: "dma-wave__num" }, String(w.order)),
          el(
            "div",
            { class: "dt-stack dt-gap-4 dt-grow" },
            el("span", { class: "dt-text-semibold" }, w.name),
            el("span", { class: "dt-text-small dt-text-subdued dt-tnum" },
              `${fmt.num(w.assets)} assets · ${w.apps.length} application${w.apps.length === 1 ? "" : "s"}${w.orphanAssets ? ` · ${w.orphanAssets} orphaned` : ""}`)
          ),
          badge(waveTier.label, waveTier.tone, { iconName: "flag" }),
          el(
            "div",
            { class: "dt-row dt-gap-4" },
            el("button", { class: "dma-wave__move", "aria-label": `Move ${w.name} earlier`, disabled: i === 0, onClick: () => moveWave(w.id, -1) }, icon("chevronU", 14)),
            el("button", { class: "dma-wave__move", "aria-label": `Move ${w.name} later`, disabled: i === pl.waves.length - 1, onClick: () => moveWave(w.id, 1) }, icon("chevronD", 14))
          )
        ),
        w.note ? el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, w.note) : null,
        members.length
          ? el(
              "div",
              { class: "dt-stack dt-gap-6" },
              members.map((m) => {
                const off = m.effectiveRank !== best;
                const basis = p.placementBasis[m.id];
                return el(
                  "div",
                  { class: ["dma-waveapp", off ? "dma-waveapp--off" : null] },
                  el(
                    "div",
                    { class: "dt-stack dt-gap-4 dt-grow" },
                    el(
                      "div",
                      { class: "dt-row dt-gap-8" },
                      el("span", { class: "dt-text-small dt-text-medium" }, m.name),
                      badge(tierDef(m.effectiveTier).label, tierDef(m.effectiveTier).tone),
                      el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, `${fmt.num(m.assets)}`)
                    ),
                    basis ? el("span", { class: "dt-text-small dt-text-subdued", style: wrap }, basis.why) : null
                  ),
                  el(
                    "div",
                    { class: "dma-movepick", role: "group", "aria-label": `Move ${m.name} to another wave` },
                    list.map((target) =>
                      el(
                        "button",
                        {
                          class: ["dma-movepick__opt", target.id === w.id ? "dma-movepick__opt--on" : null],
                          "aria-pressed": String(target.id === w.id),
                          title: `Move ${m.name} to ${target.name}`,
                          onClick: () => setPlacement(m.id, target.id),
                        },
                        String(target.order)
                      )
                    )
                  )
                );
              })
            )
          : el("div", { class: "dma-wave__empty" }, "Nothing placed here yet. Use the wave numbers on any application to move it in."),
        w.orphans.length
          ? el(
              "div",
              { class: "dt-stack dt-gap-4" },
              w.orphans.map((o) =>
                el(
                  "div",
                  { class: "dma-waveorphan" },
                  icon("helpCircle", 12),
                  el("span", { style: wrap }, `${o.label} — ${o.count} orphaned assets`)
                )
              )
            )
          : null,
        broken.length
          ? el(
              "div",
              { class: "dt-stack dt-gap-4" },
              broken.map((x) =>
                el(
                  "div",
                  { class: "dma-violation" },
                  icon("alert", 13),
                  el("span", { style: wrap }, `${x.app} depends on ${x.dep}, which is in Wave ${x.depWave}. A dependency must ship with or before its dependent.`)
                )
              )
            )
          : null
      );
    };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Proposed", String(d.seedWaves), "One wave per priority tier", { iconName: "zap" }),
        kpi("Committed", String(list.length), `${list.length - d.seedWaves >= 0 ? "+" : ""}${list.length - d.seedWaves} against the proposal`, { iconName: "layers", tone: "primary" }),
        kpi("Out of tier order", String(dep.length), dep.length ? `${dep.filter((x) => x.basis).length} with a recorded reason` : "Every application in tier order", { iconName: "gitBranch" }),
        kpi("Dependency violations", String(v.length), v.length ? "Blocks commit" : "Checked live on every move", {
          iconName: v.length ? "alert" : "checkCircle",
          tone: v.length ? "critical" : "success",
        })
      ),
      banner(
        v.length ? "critical" : "info",
        v.length
          ? "A dependency may ship with or before its dependent, never after. The plan cannot be committed until this clears."
          : `The seed proposes ${d.seedWaves} waves — one per priority tier — because priority is the only business input it has. It does not know about the Nov 3 filing cycle, the partner notice period, or the site rollout. This project committed ${list.length}, and ${d.splitCount} of the four tiers now span more than one wave. Wave count is not a property of the model: one wave per application is as valid as one for the whole estate.`,
        { title: v.length ? `${v.length} dependency violation${v.length === 1 ? "" : "s"}` : "The seed proposes, the EPM disposes" }
      ),
      card(
        {
          title: "Where each proposed tier landed",
          subtitle: "The system's grouping, and what a human who had talked to the client did to it",
          flush: true,
        },
        table(
          [
            {
              label: "Proposed wave",
              width: "190px",
              render: (s) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-medium" }, s.seedName),
                  el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, `${fmt.num(s.seedAssets)} assets`)
                ),
            },
            {
              label: "Committed into",
              render: (s) =>
                el(
                  "div",
                  { class: "dt-row dt-gap-6 dt-wrap" },
                  s.into.map((w) => badge(`${w.order} — ${w.name}`, s.into.length > 1 ? "primary" : "neutral", { iconName: "layers" }))
                ),
            },
            {
              label: "",
              width: "120px",
              render: (s) =>
                s.into.length > 1
                  ? badge(`Split ${s.into.length} ways`, "primary")
                  : badge("Kept whole", "neutral"),
            },
          ],
          d.splits
        )
      ),
      dep.length
        ? card(
            {
              title: "Shipping out of tier order",
              subtitle: `${dep.length} applications sit in a wave of a different priority — each needs a reason the system could not infer`,
              flush: true,
            },
            table(
              [
                {
                  label: "Application",
                  width: "190px",
                  render: (x) =>
                    el(
                      "div",
                      { class: "dt-stack dt-gap-4" },
                      el("span", { class: "dt-text-medium" }, x.app.name),
                      el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, `${fmt.num(x.app.assets)} assets`)
                    ),
                },
                {
                  label: "Moved",
                  width: "210px",
                  render: (x) =>
                    el(
                      "div",
                      { class: "dt-row dt-gap-6" },
                      badge(tierDef(x.appTier).label, tierDef(x.appTier).tone),
                      icon("arrowRight", 12),
                      badge(`Wave ${x.wave}`, "primary", { iconName: "layers" })
                    ),
                },
                {
                  label: "Why",
                  render: (x) =>
                    x.basis
                      ? el(
                          "div",
                          { class: "dt-stack dt-gap-4" },
                          el("span", { class: "dt-text-small dt-text-secondary", style: wrap }, x.basis.why),
                          el("span", { class: "dt-text-small dt-text-subdued" }, `${x.basis.by} · ${fmt.date(x.basis.at)}`)
                        )
                      : el("span", { class: "dt-text-small dt-text-critical", style: wrap }, "No reason recorded. A move nobody can explain is a move that gets re-litigated at the next re-plan."),
                },
              ],
              dep
            )
          )
        : null,
      card(
        {
          title: "The committed plan",
          subtitle: `${list.length} waves · ${fmt.num(pl.totalAssets)} assets placed · ${t.pending + t.outOfScope} not in any wave`,
          actions: [button("Add a wave", { variant: "default", size: "sm", iconName: "plus", onClick: addWave })],
        },
        el("div", { class: "dt-stack dt-gap-12" }, pl.waves.map(waveCard))
      ),
      el(
        "div",
        { class: "dma-reconcile" },
        el("span", { class: "dt-text-small dt-text-subdued", style: wrap },
          `${fmt.num(pl.totalAssets)} in waves + ${t.pending} pending + ${t.outOfScope} out of scope = ${fmt.num(pl.totalAssets + t.pending + t.outOfScope)} assets. The estate reconciles because nothing is assigned twice and nothing is silently dropped — 19 placements and ${t.groups} orphan decisions account for all of it.`)
      )
    );
  }

  /* --- Step 3: Calibration set ---------------------------------------------
     Unchanged by the re-design: a sample overlay, not a wave. Every row keeps
     its home wave, which is now read from the stored placement rather than a
     generator. */
  function stepCalibration() {
    const p = P();
    const cal = p.calibration;
    const place = placement();
    const list = waveList();
    const orderOf = (appId) => (list.find((w) => w.id === place[appId]) || { order: "—" }).order;
    const wavesTouched = new Set(cal.sample.map((s) => orderOf(s.app))).size;

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Calibration assets", String(cal.target), `Drawn from ${cal.sample.length} applications across ${wavesTouched} waves`, { iconName: "zap" }),
        kpi("Translation patterns covered", fmt.pct(cal.patternsCovered, 0), "Of every SPL pattern in the estate", { iconName: "check", tone: "success" }),
        kpi("Deploys to", cal.environment, "Never to production from here", { iconName: "shield" }),
        kpi("Assets removed from a wave", "0", "Every calibration asset keeps its home wave", { iconName: "layers", tone: "success" })
      ),
      banner("info", cal.rule, { title: "A sample overlay, not a seventh wave" }),
      card(
        { title: "Why this is not a wave" },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: wrap },
            "A wave is a partition — every in-scope asset is in exactly one, and every wave eventually ships to production. A calibration wave breaks both halves of that. Its assets would either never reach production, which strands 214 of them, or reach it twice, which is worse. Modelling it as a seventh partition forces a choice between those two."
          ),
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: wrap },
            "As an overlay there is no choice to make. Each of the 214 has a home wave and keeps it. They are translated early into non-prod, the profile is tuned on the result, and they deploy to production on their home wave's schedule alongside everything else in it. The only thing the overlay changes is when they are translated, which is exactly what calibration needs and nothing more."
          )
        )
      ),
      card(
        { title: "The sample", subtitle: `${cal.target} assets · selected for pattern coverage, not for priority`, flush: true },
        table(
          [
            { label: "Application", width: "200px", render: (s) => el("span", { class: "dt-text-medium" }, p.appById(s.app).name) },
            { label: "Assets", width: "80px", render: (s) => el("span", { class: "dt-tnum" }, String(s.assets)) },
            { label: "Home wave", width: "120px", render: (s) => badge(`Wave ${orderOf(s.app)}`, "neutral", { iconName: "layers" }) },
            { label: "Pattern it contributes", render: (s) => el("span", { class: "dt-text-small dt-text-secondary", style: wrap }, s.pattern) },
          ],
          cal.sample
        )
      ),
      card(
        { title: "Why the selection criterion is different" },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: wrap },
            "Every other grouping on this stage sorts by business priority. This one sorts by translation-pattern coverage, because the output is a profile that has to generalise to all 2,955 assets. A profile tuned on the 214 most important assets generalises to the rest only by luck."
          ),
          el(
            "div",
            { class: "dt-text-small dt-text-secondary", style: wrap },
            "That is why Corporate IT is in the table. It is a Cleanup-wave application nobody is waiting on, and it contributes 12 assets because it carries a legacy rex extraction pattern that 131 assets elsewhere share. Leaving it out to keep the sample \u201cimportant\u201d would cost those 131 assets a tuned profile."
          ),
          el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, cal.uncovered)
        )
      ),
      el(
        "div",
        { class: "dma-gate" },
        el(
          "div",
          { class: "dt-row dt-gap-12" },
          el("span", { class: "dt-text-success", style: { display: "inline-flex" } }, icon("checkCircle", 20)),
          el(
            "div",
            { class: "dt-stack dt-gap-4 dt-grow" },
            el("div", { class: "dt-text-semibold" }, "Calibration runs once, before Wave 1"),
            el(
              "div",
              { class: "dt-text-small dt-text-secondary", style: wrap },
              "It blocks the first wave and is advisory after that — the Calibrate stage is sample-scoped for exactly this reason, and no wave is ever 'at' Calibrate. Re-running it mid-project is allowed and produces a new profile version; it does not re-open any wave."
            )
          ),
          button("Send sample to Calibrate", { variant: "emphasized", iconName: "zap" })
        )
      )
    );
  }

  /* --- Step 4: Owners & commit ---------------------------------------------
     Waves and assignees stay separate entities that inform each other, per the
     Oct 19 2026 decision — but ownership is now one-to-many. A 540-asset wave
     spanning three applications is rarely one person's job, and forcing a
     single owner per wave pushes teams back into the nested per-person groups
     that strand assets in the live product. */
  function stepOwners() {
    const p = P();
    const pl = plan();
    const v = viols();
    const t = tally();
    const ownerById = Object.fromEntries(p.owners.map((o) => [o.id, o]));
    const list = waveList();
    const staffed = list.filter((w) => p.assignment.some((a) => a.wave === w.id && a.accountable)).length;
    const blocked = v.length > 0;

    const people = (w) => {
      const a = p.assignment.find((x) => x.wave === w.id);
      if (!a) return [];
      return [{ id: a.accountable, accountable: true }].concat((a.contributors || []).map((id) => ({ id, accountable: false })));
    };

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      el(
        "div",
        { class: "dt-grid dt-grid-4" },
        kpi("Waves", String(list.length), `${staffed} with an accountable owner`, { iconName: "layers" }),
        kpi("Team", String(p.owners.length), `${p.owners.reduce((n, o) => n + o.capacity, 0)} FTE across the project`, { iconName: "users" }),
        kpi("Assets placed", fmt.num(pl.totalAssets), `${t.pending + t.outOfScope} not in any wave`, { iconName: "check" }),
        kpi("Ready to commit", blocked ? "No" : "Yes", blocked ? `${v.length} dependency violations` : "No violations", {
          iconName: blocked ? "alert" : "checkCircle",
          tone: blocked ? "critical" : "success",
        })
      ),
      banner(
        "info",
        "A wave is a unit of delivery. An owner is a person. Neither defines the other, so a wave can change hands without touching a single asset, and assets can be handed between reviewers without the wave moving. One person is accountable for sign-off; any number can be contributing. The live product nests per-person groups inside waves, which makes both of those a re-assignment — and a re-assignment that misses rows is how 4,108 assets end up with no wave at all.",
        { title: "Waves and assignees are separate entities" }
      ),
      card(
        { title: "Wave ownership", subtitle: "One accountable owner, any number of contributors", flush: true },
        table(
          [
            {
              label: "Wave",
              width: "230px",
              render: (w) =>
                el(
                  "div",
                  { class: "dt-stack dt-gap-4" },
                  el("span", { class: "dt-text-medium" }, `Wave ${w.order} — ${w.name}`),
                  el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, `${fmt.num(w.assets)} assets · ${w.apps.length} applications`)
                ),
            },
            {
              label: "Team",
              width: "260px",
              render: (w) => {
                const ps = people(w);
                if (!ps.length) return button("Assign owner", { variant: "default", size: "sm", iconName: "users" });
                return el(
                  "div",
                  { class: "dt-stack dt-gap-6" },
                  ps.map((x) => {
                    const o = ownerById[x.id];
                    if (!o) return null;
                    return el(
                      "div",
                      { class: "dma-owner" },
                      el("span", { class: ["dma-owner__initials", x.accountable ? "dma-owner__initials--lead" : null] }, initials(o.name)),
                      el(
                        "div",
                        { class: "dt-stack dt-gap-4 dt-grow" },
                        el("span", { class: "dt-text-small dt-text-medium" }, o.name),
                        el("span", { class: "dt-text-small dt-text-subdued" }, x.accountable ? "Accountable" : "Contributing")
                      )
                    );
                  })
                );
              },
            },
            {
              label: "Why",
              render: (w) => {
                const a = p.assignment.find((x) => x.wave === w.id);
                return el("span", { class: "dt-text-small dt-text-secondary", style: wrap }, a ? a.note : "Unassigned. The wave still ships — ownership is an overlay, not a gate.");
              },
            },
            { label: "", width: "140px", render: () => button("Add person", { variant: "default", size: "sm", iconName: "plus" }) },
          ],
          pl.waves
        )
      ),
      card(
        { title: "The team", subtitle: "Who is carrying which waves" },
        el(
          "div",
          { class: "dt-stack dt-gap-8" },
          p.owners.map((o) => {
            const lead = p.assignment.filter((a) => a.accountable === o.id).length;
            const contrib = p.assignment.filter((a) => (a.contributors || []).includes(o.id)).length;
            return el(
              "div",
              { class: "dma-gateitem" },
              el("span", { class: "dma-owner__initials" }, initials(o.name)),
              el(
                "div",
                { class: "dt-stack dt-gap-4 dt-grow" },
                el("span", { class: "dt-text-medium" }, o.name),
                el("span", { class: "dt-text-small dt-text-subdued", style: wrap }, o.role + (o.note ? ` — ${o.note}` : ""))
              ),
              badge(o.capacity ? `${o.capacity} FTE` : "Not allocated", o.capacity ? "info" : "neutral", { iconName: "clock" }),
              badge(`${lead} accountable`, lead ? "primary" : "neutral", { iconName: "layers" }),
              badge(`${contrib} contributing`, contrib ? "info" : "neutral", { iconName: "users" })
            );
          })
        )
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
            el("div", { class: "dt-text-semibold" }, dirty() ? `Re-commit the plan — ${list.length} waves` : `Plan committed — ${list.length} waves`),
            el(
              "div",
              { class: "dt-text-small dt-text-secondary", style: wrap },
              blocked
                ? "The plan cannot be committed while a dependency ships after its dependent."
                : dirty()
                  ? "Committing writes the wave records and the 19 placements. Waves already translated keep their membership — a committed wave is not re-planned underneath the work already done against it."
                  : `Committed ${fmt.date("2026-10-07T10:00:00Z")} by Martin Hale. Waves 1 and 2 have since published, so their membership is frozen; Waves 4–6 are still open to re-planning.`
            )
          ),
          dirty()
            ? el(
                "div",
                { class: "dt-row dt-gap-8" },
                button("Discard changes", { variant: "default", onClick: resetAll }),
                button(`Commit — ${list.length} waves`, { variant: "emphasized", iconName: "check", disabled: blocked })
              )
            : button("Plan committed", { variant: "emphasized", iconName: "check", disabled: true })
        ),
        el(
          "div",
          { class: "dt-text-small dt-text-subdued", style: wrap },
          `Committing writes ${list.length} wave records, 19 application placements and ${t.groups} orphan decisions. No asset row is written, which is why there is no reconciliation step between the plan and the inventory — there are not two copies of the membership to reconcile.`
        )
      )
    );
  }

  const PANELS = {
    priority: stepPriority,
    waves: stepWaves,
    calibration: stepCalibration,
    owners: stepOwners,
  };

  /* --- Registration ---------------------------------------------------------- */
  DMA.register({
    id: "prioritize-plan",
    title: "Prioritize & Plan",
    phase: "extract",
    icon: "layers",
    status: "ready",
    scope: "estate",
    summary: "Declare priority on 19 applications to seed a proposal, then organise the waves by hand. Placement is stored on the application; every asset inside it inherits.",

    steps: STEPS,

    notes: [
      "Priority seeds the plan; it does not decide it. The seed proposes one wave per tier — four here — and this project committed six, because the EPM knew about a Nov 3 filing cycle the generator cannot see. The delta between proposal and commitment is computed, not stored.",
      "Wave membership is stored on the application, and every asset inside it inherits. Nineteen placements reach 2,908 assets. The live product stores a wave on each asset instead, which is why its own UI reconciles 13,946 assignments against a manifest of 13,937 and warns about 4,108 unassigned.",
      "Waves are first-class and fully editable — create, rename, reorder, delete. Six is what this project chose, not a property of the model; one wave per application is equally valid. Reordering rewrites only the display order, never membership, because ids and order are separate fields.",
      "An application inherits the highest priority of anything that transitively depends on it. Platform Shared Services is declared Low and still ships first, because Payments Core cannot ship without it.",
      "Dependency checking moved from 'unreachable by construction' to 'run live on every move'. A human is allowed to make the mistake; they are not allowed to miss it.",
      "Three applications ship out of tier order, and each carries a recorded reason — a shared release train, a partner notice period, a site rollout. A move nobody can explain is a move that gets re-litigated at the next re-plan.",
      "Forty-seven assets carry no application attribution at all, so no tier reaches them. They get their own queue, grouped by why they are orphaned, with two actions: assign to a wave, or mark out of scope. Nine are still pending and are counted in neither a wave nor the excluded total — the reconciliation gap is shown rather than hidden.",
      "Calibration is a sample overlay, not a seventh wave. 214 assets drawn for translation-pattern coverage rather than priority; each keeps its home wave and deploys to production on that wave's schedule.",
      "Ownership is one-to-many and still a separate entity from the wave. One person accountable, any number contributing — a wave can change hands without touching an asset.",
      "Capacity modelling was removed from this stage on Oct 21 2026. Translation throughput is a rate, not a wave-size cap: a larger wave takes longer, it does not fail. Review bandwidth is a scoping and progress-monitoring question. See data/features.js — capacity-planner is parked rather than re-homed.",
    ],

    render(root, ctx) {
      root.append(
        ctx.pageHeader([
          dirty() ? button("Discard changes", { variant: "default", iconName: "refresh", onClick: resetAll }) : null,
          button("Re-seed from priority", { variant: "default", iconName: "zap" }),
          button("Export plan", { variant: "emphasized", iconName: "fileText" }),
        ]),
        stepper(),
        PANELS[step()](ctx)
      );
    },
  });
})();
