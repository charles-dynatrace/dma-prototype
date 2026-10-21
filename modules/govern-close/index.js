/* ============================================================================
   MODULE: Govern & Close
   ----------------------------------------------------------------------------
   Flow-diagram stage: Govern & Close → Govern & Close

   ----------------------------------------------------------------------------
   THIS STAGE IS HALF-EMPTY ON PURPOSE, AND SAYS WHICH HALF

   It carries two P3 features with two different triggers:

     Optimization-Opportunity Flagging   fires per wave, at publish. Waves 1
                                         and 2 are live, so it has already run
                                         twice over 858 assets.
     Retention / Close-Out Policy        fires once, at project close. Four
                                         waves have not published. It has never
                                         run and cannot run today.

   The lazy build is one screen that says "opens when the project closes".
   That would hide a pass which has already produced sixteen findings, and it
   would make the cleanup look like a live capability rather than a preview.

   So the Organise and Flags steps are populated, the Close-out step is a
   preview behind a gate, and the gate shows its arithmetic — four waves
   unpublished, four assets live and wrong, 156 open verdicts. "Not started"
   becomes a number instead of a greyed-out label.

   ----------------------------------------------------------------------------
   THERE IS NO FIX BUTTON ANYWHERE ON THIS SCREEN

   The easiest thing to demo here would be a one-click "optimise". Both PRDs
   rule it out in their own words:

     - "Actually performing the optimization work itself (rewriting an
       inefficient query, switching an asset from logs to native) ... is a
       services engagement or separate follow-on work."
     - "Likely-duplicate assets are flagged for review, not automatically
       merged or deleted."
     - "No optimization action is taken automatically — every flag requires
       explicit human review and action."

   The two features answer that constraint differently:

     Dedupe        keeps its review controls — confirm, dismiss. A duplicate
                   verdict is a judgement about the customer's estate that
                   DMA is holding the evidence for, so it belongs here.
     Optimisation  has no controls at all. Its findings leave as a standalone
                   report that Professional Services reads with the customer
                   after the migration. It used to run an accept/dismiss
                   queue; that was this product implying it owns a backlog
                   the PRD explicitly hands to a services engagement, and it
                   recorded a decision made in a room DMA is not in.

   Retention keeps its one control — record an exception — for the same
   reason dedupe does: the reason text is the audit trail.

   ----------------------------------------------------------------------------
   QUERY EFFICIENCY IS TWO FLAGS

   An acceptance criterion, not a nicety — the two Globex patterns must be
   "their own distinct, labeled flag types — not folded into a single generic
   'query efficiency' flag". They are kept apart here because they have
   different owners: parse-before-filter is a query rewrite, repeated-parse is
   an OpenPipeline change made by somebody who may never read the query.

   ----------------------------------------------------------------------------
   WHAT THIS STAGE DELIBERATELY DOES NOT DO

     - User Enablement / the CS handoff. Both PRDs put it explicitly outside
       DMA's system scope. The stub summary for this module used to lead with
       "Hand off to enablement", which claimed the one thing the feature set
       is clearest about not owning.
     - Retention for the migrated production assets. That is the customer's
       governance decision about their own tenant.
     - Team-based object ownership assignment — customer/PS process.
     - Merging a duplicate, rewriting a query, or repointing an asset.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, modal, emptyState, fmt } = DMA.ui;

  const STEPS = [
    { id: "organise", label: "Organise" },
    { id: "flags",    label: "Optimisation flags" },
    { id: "closeout", label: "Close-out policy" },
    { id: "record",   label: "Record" },
  ];

  const wrap = { whiteSpace: "normal" };
  const GC = () => DMA.data.governClose;
  const PR = () => DMA.data.project;

  function step() {
    const id = DMA.store.session.gcStep;
    return STEPS.some((s) => s.id === id) ? id : STEPS[0].id;
  }

  /* --- Local helpers (duplicated per module by design) ---------------------- */

  function kpi(label, value, meta, opts = {}) {
    return el(
      "div",
      { class: "dma-kpi" },
      el("div", { class: "dma-kpi__label" }, opts.iconName ? icon(opts.iconName, 13) : null, label),
      el("div", { class: ["dma-kpi__value", opts.tone ? `dt-text-${opts.tone}` : null] }, value),
      meta ? el("div", { class: "dma-kpi__meta" }, meta) : null
    );
  }

  const note = (t) => el("div", { class: "dt-text-small dt-text-secondary", style: wrap }, t);
  const subdued = (t) => el("div", { class: "dt-text-small dt-text-subdued", style: wrap }, t);
  const kpiRow = (...k) => el("div", { class: ["dt-grid", `dt-grid-${k.length}`] }, ...k);
  const when = (iso) => (iso ? fmt.dateShort(iso) : "—");

  /* ========================================================================
     SESSION LAYER

     Three review decisions, and each one has to move a number above it:

       dedupe verdict      open → confirmed or dismissed, and the duplicate
                           count with it
       flag verdict        open → accepted or dismissed, and the open-flag
                           count and the per-type tallies with it
       retention exception artifact → retained instead of deleted, and the
                           guardrail metric with it

     Every list on this screen reads through the three accessors below rather
     than off `DMA.data.governClose` directly. That is the defect class found
     on Validate — a row that restyles itself while the KPI above it still
     reports the fixture — and it is only avoidable by making the fixture
     unreachable from the render path.
     ====================================================================== */

  const DEDUPE = "gcDedupe"; // clusterId  → { verdict, at }
  const KEEP = "gcKeep"; //    artifactId → { reason, until, at }

  /* There is no FLAG bag. Optimisation findings are reported, not decided, so
     there is no per-flag session state to carry — see `flagsPanel`. */

  const bag = (key) => DMA.store.session[key] || {};

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

  /* The fixture plus this session. `kind` is never touched — what a cluster
     actually is does not change because somebody clicked dismiss, and keeping
     the two apart is what lets the screen show that two of the confirmed
     verdicts disagree with the system's own guess. */
  const dedupeRows = () =>
    GC().dedupe.map((d) => {
      const s = bag(DEDUPE)[d.id];
      return s
        ? Object.assign({}, d, { state: s.verdict, decidedBy: "You", decidedAt: s.at, note: s.note, session: true })
        : d;
    });

  /* Straight through. Dedupe rows get a session overlay because a verdict can
     be recorded here; flags cannot, so there is nothing to overlay. */
  const flagRows = () => GC().flags;

  const previewRows = () => GC().closeoutPreview(bag(KEEP));

  const count = (rows, state) => rows.filter((r) => r.state === state).length;

  /* ======================================================================== */

  const stepper = () => {
    const active = step();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Govern and close steps" });
    STEPS.forEach((s, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(s.id === active),
            onClick: () => DMA.store.setSession("gcStep", s.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, s.label)
        )
      );
    });
    return row;
  };

  /* The confidence a dedupe match carries. Drawn rather than printed because
     the useful judgement is "is this near the top or near the bottom of the
     range", and 72% vs 97% is a different decision at a glance. */
  const meter = (pct, tone) =>
    el(
      "div",
      { class: "dma-gcmeter", title: `${pct}% structural similarity` },
      el("span", { class: "dma-gcmeter__fill", dataset: { tone }, style: { width: `${pct}%` } })
    );

  const cluster = (d) =>
    el(
      "div",
      { class: "dma-gccluster" },
      d.assets.map((a) =>
        el(
          "div",
          { class: "dma-gccluster__item" },
          el("span", { class: "dt-mono dt-text-small dt-text-subdued" }, a.id),
          el("span", { class: "dt-text-small" }, a.name),
          badge(a.type, "neutral")
        )
      )
    );

  /* ========================================================================
     STEP 1 — ORGANISE

     Tag, group, dedupe. The first two are reported; the third is a queue,
     because a dedupe suggestion that acts on its own is the single most
     destructive thing this stage could be given permission to do.
     ====================================================================== */

  function dedupeModal(d, verdict) {
    const confirming = verdict === "confirmed";
    const why = el("textarea", {
      class: "dt-textarea",
      rows: 3,
      placeholder: confirming
        ? "Which one survives, and what repoints to it?"
        : "Why these are not duplicates — e.g. one dashboard per on-call rota",
    });

    const m = modal(
      confirming ? `Confirm ${d.id} as a duplicate` : `Dismiss ${d.id}`,
      el(
        "div",
        { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
        el("div", { class: "dt-text-semibold" }, d.title),
        cluster(d),
        banner("info", d.basis, { title: `${d.confidence}% structural similarity` }),
        d.kind === "intentional"
          ? banner(
              "warning",
              d.why,
              { title: "The system's own read is that these are not duplicates" }
            )
          : null,
        el("label", { class: "dt-field" }, el("span", { class: "dt-field__label" }, confirming ? "Consolidation plan" : "Reason"), why),
        subdued(
          confirming
            ? "Confirming records the decision and nothing else. DMA does not merge or delete a published asset — consolidation is done by hand, in the tenant, by whoever owns it."
            : "Dismissing keeps both assets and keeps the finding in the record, so a later reviewer can see this was looked at rather than missed."
        )
      ),
      [
        button("Cancel", { variant: "default", onClick: () => m.close() }),
        button(confirming ? "Confirm as duplicate" : "Not a duplicate", {
          variant: confirming ? "emphasized" : "default",
          iconName: confirming ? "check" : "x",
          onClick: () => {
            remember(DEDUPE, d.id, {
              verdict,
              at: new Date().toISOString(),
              note: why.value.trim() || (confirming ? "Confirmed in this session. No plan recorded." : "Dismissed in this session. No reason recorded."),
            });
            m.close();
          },
        }),
      ]
    );
    return m;
  }

  function organisePanel(ctx) {
    const live = GC().publishedWaves();
    const published = GC().published();
    const groups = GC().groups();
    const rows = dedupeRows();
    const open = rows.filter((d) => d.state === "open");
    const confirmed = count(rows, "confirmed");
    const flaggedAssets = rows.reduce((a, d) => a + d.assets.length, 0);

    const tagTable = table(
      [
        { label: "Tag", width: "22%", render: (t) => el("span", { class: "dt-mono dt-text-small" }, t.key) },
        { label: "Derived from", width: "44%", render: (t) => note(t.from) },
        {
          label: "Applied",
          width: "16%",
          render: (t) =>
            el(
              "div",
              {},
              el("span", { class: "dt-text-semibold dt-tnum" }, fmt.num(t.applied)),
              subdued(`of ${fmt.num(t.of)}`)
            ),
        },
        {
          label: "",
          width: "18%",
          render: (t) =>
            t.derivable
              ? badge("Applied", "success", { iconName: "check" })
              : badge("Nothing to apply", "warning", { iconName: "alert", title: t.gap }),
        },
      ],
      GC().tagCoverage()
    );

    const groupTable = table(
      [
        { label: "Group", width: "30%", render: (g) => el("div", {}, el("div", { class: "dt-text-semibold" }, g.name), subdued(`dt.owner = ${g.slug}`)) },
        { label: "Wave", width: "10%", render: (g) => badge(`W${g.wave}`, "neutral") },
        { label: "Tenant", width: "22%", render: (g) => (g.tenant ? badge(g.tenant.label, g.tenant.id === "prod" ? "critical" : "info", { iconName: "server" }) : subdued("—")) },
        { label: "Priority tier", width: "16%", render: (g) => DMA.ui.tierChip(g.tier) },
        { label: "Assets grouped", width: "22%", render: (g) => el("span", { class: "dt-text-semibold dt-tnum" }, fmt.num(g.live)) },
      ],
      groups
    );

    const dedupeTable = table(
      [
        {
          label: "Candidate",
          width: "30%",
          render: (d) =>
            el(
              "div",
              {},
              el("div", { class: "dt-text-semibold" }, d.title),
              subdued(`${d.id} · W${d.wave} · ${d.assets.length} assets`),
              cluster(d)
            ),
        },
        {
          label: "Similarity",
          width: "14%",
          render: (d) =>
            el(
              "div",
              {},
              el("span", { class: "dt-text-semibold dt-tnum" }, `${d.confidence}%`),
              meter(d.confidence, d.confidence >= 90 ? "critical" : d.confidence >= 80 ? "warning" : "neutral")
            ),
        },
        {
          label: "What matched",
          width: "30%",
          render: (d) =>
            el(
              "div",
              {},
              note(d.basis),
              d.kind === "intentional" ? subdued(`Likely intentional: ${d.why}`) : null
            ),
        },
        {
          label: "",
          width: "26%",
          render: (d) => {
            if (d.state === "open") {
              return el(
                "div",
                { class: "dma-gcverdict" },
                button("Duplicate", { variant: "default", size: "sm", iconName: "check", onClick: () => dedupeModal(d, "confirmed") }),
                button("Not a duplicate", { variant: "default", size: "sm", iconName: "x", onClick: () => dedupeModal(d, "dismissed") })
              );
            }
            const b =
              d.state === "confirmed"
                ? badge("Confirmed duplicate", "warning", { iconName: "check" })
                : badge("Not a duplicate", "neutral", { iconName: "x" });
            return el(
              "div",
              { class: "dma-gcverdict" },
              el("div", {}, b, subdued(`${d.decidedBy} · ${when(d.decidedAt)}`), d.note ? subdued(d.note) : null),
              d.session ? button("Undo", { variant: "default", size: "sm", onClick: () => forget(DEDUPE, d.id) }) : null
            );
          },
        },
      ],
      rows.slice().sort((a, b) => (a.state === b.state ? b.confidence - a.confidence : a.state === "open" ? -1 : 1))
    );

    return el(
      "div",
      { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
      banner(
        "info",
        `The organise pass runs when a wave publishes, not when the project closes — so it has run over Waves ${live
          .map((r) => r.wave.id)
          .join(" and ")} and over nothing else. The other ${fmt.num(PR().waves.length - live.length)} waves have not published, so there is nothing yet to tag, group or compare.`,
        { title: `${fmt.num(published)} published assets have been through it` }
      ),
      kpiRow(
        kpi("Assets organised", fmt.num(published), `${fmt.num(live.length)} of ${fmt.num(PR().waves.length)} waves live`, { iconName: "layers", tone: "info" }),
        kpi("Groups created", fmt.num(groups.length), "one per application in a live wave", { iconName: "users" }),
        kpi("Awaiting review", fmt.num(open.length), `${fmt.num(flaggedAssets)} assets across ${fmt.num(rows.length)} candidates`, {
          iconName: "filter",
          tone: open.length ? "warning" : "success",
        }),
        kpi("Confirmed duplicates", fmt.num(confirmed), confirmed ? "recorded, not merged" : "none confirmed yet", { iconName: "archive" })
      ),
      card(
        { title: "Tags applied automatically", subtitle: "Four rules, applied at publish with no per-project configuration", flush: true },
        tagTable
      ),
      card({ title: "Groups", subtitle: "One group per application present in a published wave", flush: true }, groupTable),
      banner(
        "warning",
        `${fmt.num(rows.filter((d) => d.kind === "intentional").length)} of the ${fmt.num(rows.length)} candidates are structurally identical and operationally distinct — four region-scoped fraud dashboards, a warn/page alert pair, an exec and an ops view of the same metric. A queue where every row were a real duplicate would teach a reviewer to stop reading.`,
        { title: "Not every match is a duplicate, and that is the hard part" }
      ),
      card(
        {
          title: "Likely duplicates",
          subtitle: "Flagged for review. Nothing here is merged, deleted, or changed by DMA.",
          flush: true,
        },
        dedupeTable
      ),
      el(
        "div",
        { class: "dma-gcnote" },
        icon("info", 15),
        subdued(
          "Confirming a duplicate records a decision and repoints nothing. A published asset lives in the customer's tenant, and an automated merge would be this product deleting something a human is looking at — which is why the PRD's acceptance criterion is \"flagged for review, not automatically merged or deleted\"."
        )
      )
    );
  }

  /* ========================================================================
     STEP 2 — OPTIMISATION FLAGS

     THIS STEP HAS NO CONTROLS, AND THAT IS THE DESIGN

     It used to run a triage queue: Accept into follow-on, Dismiss, each
     behind a modal that recorded a verdict and a note. That was wrong, and
     not subtly. The PRD hands optimisation work to "a services engagement or
     separate follow-on work" — so a backlog inside DMA was this product
     claiming a queue it does not own and cannot action. Worse, it put the
     decision in the wrong room: these findings are reviewed WITH the
     customer, by Professional Services, after the migration. DMA is not in
     that conversation and should not be pre-recording its outcome.

     So the findings leave as a report. The screen's whole job is to show
     what the pass found and let someone export it. The reader is a PS
     consultant preparing a client conversation, which is why every row
     carries evidence, impact and owner, and why no row carries a verdict.
     ====================================================================== */

  function typeCard(t, rows) {
    const n = rows.filter((f) => f.type === t.id).length;
    return el(
      "div",
      { class: "dma-gctype", dataset: { family: t.family } },
      el(
        "div",
        { class: "dma-gctype__head" },
        icon(t.icon, 15),
        el("span", { class: "dt-text-semibold" }, t.label),
        t.globex ? badge("Globex", "info", { title: t.source }) : null
      ),
      el(
        "div",
        { class: "dma-gctype__stat" },
        el("span", { class: "dma-gctype__n" }, fmt.num(n)),
        subdued(n === 1 ? "finding" : "findings")
      ),
      note(t.what),
      subdued(`Fix: ${t.fix}`),
      subdued(`Owner: ${t.owner}`)
    );
  }

  const FAMILIES = ["All families", "Cost", "Query efficiency", "Usability"];

  function flagsPanel(ctx) {
    const family = DMA.store.session.gcFamily || FAMILIES[0];

    const all = flagRows();
    const rows = all
      .filter((f) => family === FAMILIES[0] || GC().flagType(f.type).family === family)
      .sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));

    /* Sorted by flag type, not by wave or severity. The report is read a
       section at a time by whoever owns that fix — the OpenPipeline change is
       one conversation and the query rewrites are another — so grouping by
       type is grouping by who does the work. Severity order would scatter
       each owner's rows through the document. */

    const waves = new Set(all.map((f) => f.wave));

    /* No "show reviewed" toggle, because nothing here gets reviewed in DMA.
       The family filter stays — it is how a consultant pulls the cost rows out
       for a cost conversation. */
    const filters = el(
      "div",
      { class: "dma-gcfilters" },
      el(
        "select",
        { class: "dt-input", "aria-label": "Flag family", onChange: (e) => DMA.store.setSession("gcFamily", e.target.value) },
        FAMILIES.map((f) => el("option", { value: f, selected: f === family }, f))
      ),
      el(
        "span",
        { class: "dt-text-small dt-text-subdued", style: { marginLeft: "auto" } },
        family === FAMILIES[0] ? `${fmt.num(rows.length)} findings` : `${fmt.num(rows.length)} of ${fmt.num(all.length)} findings`
      )
    );

    const body = rows.length
      ? table(
          [
            {
              label: "Asset",
              width: "24%",
              render: (f) =>
                el(
                  "div",
                  {},
                  el("div", { class: "dt-text-semibold" }, f.asset.name),
                  subdued(`${f.asset.id} · ${f.asset.type} · W${f.wave}`)
                ),
            },
            {
              label: "Flag",
              width: "18%",
              render: (f) => {
                const t = GC().flagType(f.type);
                return el("div", {}, badge(t.label, t.tone, { iconName: t.icon, title: t.what }), subdued(t.family));
              },
            },
            {
              label: "What was found",
              width: "34%",
              render: (f) =>
                el(
                  "div",
                  {},
                  note(f.detail),
                  el("div", { class: "dma-gcevidence dt-mono" }, f.evidence),
                  subdued(f.impact)
                ),
            },
            /* Where the Accept/Dismiss buttons used to be. A report row has to
               answer "who picks this up" or the consultant reading it has to
               go and work it out per row — and that is the column the old
               verdict buttons were crowding out. */
            {
              label: "Who fixes it",
              width: "24%",
              render: (f) => {
                const t = GC().flagType(f.type);
                return el("div", {}, note(t.fix), subdued(t.owner));
              },
            },
          ],
          rows
        )
      : emptyState(
          "search",
          "No findings in this family",
          "The pass found nothing of this kind across the published waves. Switch the filter to read the rest of the report."
        );

    const types = Object.keys(GC().FLAG_TYPES).map((k) => typeCard(GC().FLAG_TYPES[k], all));

    return el(
      "div",
      { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
      /* Counts, not states. There is no "open vs closed" split to report any
         more, so the KPIs describe the report's coverage instead — what it
         looked at, what it found, and how far across the estate it reached.
         None of them is a number anybody should be targeted on. */
      kpiRow(
        kpi("Findings", fmt.num(all.length), `across ${fmt.num(GC().published())} published assets`, { iconName: "flag", tone: "info" }),
        kpi("Assets affected", fmt.num(new Set(all.map((f) => f.asset.id)).size), "one finding per asset in this pass", { iconName: "layers" }),
        kpi("Waves covered", fmt.num(waves.size), `waves ${[...waves].sort().join(" and ")} are live`, { iconName: "gitBranch" }),
        kpi("Flag types", fmt.num(Object.keys(GC().FLAG_TYPES).length), "two of them are the Globex patterns", { iconName: "search" })
      ),
      banner(
        "info",
        "These findings are not a work queue. DMA does not rewrite a query, repoint a data source or change a pipeline — the PRD hands that to \"a services engagement or separate follow-on work\". The report is the deliverable: Professional Services reads it with the customer after the migration, and every decision about what to act on is made in that conversation.",
        { title: "This is a context document, not a backlog" }
      ),
      card(
        {
          title: "Optimisation report",
          subtitle: `${fmt.num(all.length)} findings across waves ${[...waves].sort().join(" and ")} · prepared for the post-migration review`,
          actions: button("Export optimisation report", { variant: "emphasized", iconName: "fileText" }),
        },
        note(
          "A standalone export, separate from the closeout record. The two leave at different moments and go to different people: this one goes to Professional Services while the project is still open, and the closeout record is produced when the project closes."
        ),
        subdued("Contains every finding below with its evidence, measured impact, suggested fix and owner. No DMA recommendation and no priority order — ranking these is the customer's call, made with their own cost and roadmap context in the room.")
      ),
      banner(
        "info",
        "The Globex post-mortem named two recurring query-efficiency patterns, and they are kept as separate flag types rather than one generic \"query efficiency\" row. They are not the same job: parse-before-filter is a query rewrite, and re-parsing raw data is fixed upstream in OpenPipeline by somebody who may never open the query.",
        { title: "Query efficiency is two flags, not one" }
      ),
      card({ title: "What this pass looks for", subtitle: "Four labelled types across cost, query efficiency and usability" }, el("div", { class: "dma-gctypes" }, types)),
      card({ title: "Findings", subtitle: "Everything the pass surfaced. None of it has been acted on, and none of it has been ruled on.", actions: filters, flush: !!rows.length }, body),
      card(
        { title: "Why nothing on this screen is a decision" },
        note(
          "Every finding names a change to a live asset in a customer's tenant. DMA flags the opportunity; acting on it is a services engagement, and the PRD scopes it out in those words."
        ),
        note(
          "There is no accept or dismiss here either, which is the newer half of that line. Those are judgements made with the customer looking at their own costs — recording them in DMA would put the decision in the wrong room and give the project a backlog nobody agreed to own."
        ),
        note(
          "The outcome metric is deliberately modest: at least one flagged opportunity per project, tracked as a count and not a target. A stage measured on flag volume would start inventing them."
        )
      )
    );
  }

  /* ========================================================================
     STEP 3 — CLOSE-OUT POLICY
     ====================================================================== */

  function keepModal(p) {
    const reason = el("textarea", {
      class: "dt-textarea",
      rows: 3,
      placeholder: "Why this artifact outlives the project — e.g. Group Internal Audit requires the signed release record",
    });
    const until = el("input", { class: "dt-input", type: "date", value: "2027-10-21" });
    const err = el("div", { class: "dt-text-small dt-text-critical", style: wrap });

    const m = modal(
      `Retain ${p.artifact.name} past policy`,
      el(
        "div",
        { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
        el(
          "div",
          { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
          badge(p.cls.label, p.cls.tone, { iconName: p.cls.icon }),
          el("span", { class: "dt-text-small dt-text-subdued" }, p.artifact.id)
        ),
        note(p.artifact.detail),
        banner("warning", `Default policy: ${p.rule.label}. ${p.rule.detail}`, { title: "What would happen without an exception" }),
        el("label", { class: "dt-field" }, el("span", { class: "dt-field__label" }, "Reason — required"), reason),
        el("label", { class: "dt-field" }, el("span", { class: "dt-field__label" }, "Retain until"), until),
        err,
        subdued(
          "The guardrail metric for this policy is 100% of artifacts revoked or explicitly extended with a reason. An exception with no reason would satisfy the first half of that sentence and defeat the second, so the reason is not optional."
        )
      ),
      [
        button("Cancel", { variant: "default", onClick: () => m.close() }),
        button("Record the exception", {
          variant: "emphasized",
          iconName: "save",
          onClick: () => {
            const text = reason.value.trim();
            if (!text) {
              err.textContent = "A retention exception without a reason is the thing this policy exists to stop. Say why.";
              return;
            }
            remember(KEEP, p.artifact.id, { reason: text, until: until.value, by: "You", at: new Date().toISOString() });
            m.close();
          },
        }),
      ]
    );
    return m;
  }

  function closeoutPanel(ctx) {
    const gate = GC().closeGate();
    const rows = previewRows();
    const policy = GC().POLICY;

    const credentials = rows.filter((p) => p.artifact.class === "credential");
    const decided = credentials.filter((p) => p.outcome === "revoke" || p.exception).length;
    const exceptions = rows.filter((p) => p.exception);
    const inUse = rows.filter((p) => p.artifact.inUse);

    const gateList = el(
      "div",
      { class: "dma-gcgate" },
      gate.reasons.map((r) =>
        el(
          "div",
          { class: "dma-gcgate__row" },
          el("span", { class: "dma-gcgate__dot", dataset: { tone: r.tone } }),
          el(
            "div",
            {},
            el("div", { class: "dt-text-semibold" }, r.label),
            subdued(r.detail)
          ),
          r.external
            ? badge("Outside DMA", "neutral", { title: "Recorded here, decided elsewhere." })
            : button("Open", {
                variant: "default",
                size: "sm",
                iconName: "arrowRight",
                iconAfter: true,
                onClick: () => ctx.navigate(r.module),
              })
        )
      )
    );

    const policyList = el(
      "div",
      { class: "dma-gcpolicy" },
      policy.rules.map((r) => {
        const c = GC().ARTIFACT_CLASSES[r.class];
        return el(
          "div",
          { class: "dma-gcpolicy__row" },
          el("span", { class: "dma-gcrule", dataset: { action: r.action } }, icon(r.action === "retain" ? "archive" : r.action === "revoke" ? "lock" : "x", 12), r.label),
          el(
            "div",
            {},
            el("div", { class: "dt-text-semibold" }, c.label),
            note(c.what),
            subdued(r.detail)
          )
        );
      })
    );

    const artifactTable = table(
      [
        {
          label: "Artifact",
          width: "26%",
          render: (p) =>
            el(
              "div",
              {},
              el("div", { class: "dt-text-semibold" }, p.artifact.name),
              subdued(`${p.artifact.id}${p.artifact.size ? ` · ${p.artifact.size}` : ""} · created ${when(p.artifact.createdAt)}`),
              note(p.artifact.detail)
            ),
        },
        {
          label: "Class",
          width: "16%",
          render: (p) => el("div", {}, badge(p.cls.label, p.cls.tone, { iconName: p.cls.icon, title: p.cls.why }), subdued(p.artifact.createdBy)),
        },
        {
          label: "Still in use",
          width: "20%",
          render: (p) =>
            p.artifact.inUse
              ? el("div", {}, badge("In use", "info", { iconName: "play" }), subdued(p.artifact.inUseWhy))
              : badge("Idle", "neutral", { title: "Nothing in the project reads this any more." }),
        },
        {
          label: "At close",
          width: "20%",
          render: (p) =>
            p.exception
              ? el(
                  "div",
                  {},
                  badge(`Retained until ${when(p.exception.until)}`, "success", { iconName: "archive" }),
                  subdued(p.exception.reason),
                  subdued(`${p.exception.by} · ${when(p.exception.at)}`)
                )
              : el(
                  "div",
                  {},
                  el("span", { class: "dma-gcrule", dataset: { action: p.rule.action } }, p.rule.label),
                  subdued(p.rule.detail)
                ),
        },
        {
          label: "",
          width: "18%",
          render: (p) =>
            p.sessionException
              ? button("Remove exception", { variant: "default", size: "sm", onClick: () => forget(KEEP, p.artifact.id) })
              : p.exception
              ? subdued("Configured by the customer.")
              : button("Retain past policy", { variant: "default", size: "sm", iconName: "archive", onClick: () => keepModal(p) }),
        },
      ],
      rows
    );

    return el(
      "div",
      { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
      banner(
        gate.canClose ? "success" : "warning",
        gate.canClose
          ? "Every wave has published and nothing is outstanding. The closeout sequence can run."
          : `The retention policy applies once, as part of the closeout sequence, and this project is not closeable yet — ${fmt.num(
              gate.reasons.length
            )} things are outstanding. Everything below is what would happen, not what has happened.`,
        {
          title: gate.canClose ? "Ready to close" : "This policy has not run",
          action: button("Close the project", {
            variant: "emphasized",
            iconName: "flag",
            disabled: !gate.canClose,
            title: gate.canClose ? null : "Blocked by the items below.",
          }),
        }
      ),
      kpiRow(
        kpi("Migration artifacts", fmt.num(rows.length), `${fmt.num(inUse.length)} still in use by an open stage`, { iconName: "archive", tone: "info" }),
        /* The guardrail metric, and it is about policy coverage rather than
           completed work — nothing has been revoked, because nothing has
           closed. "2 / 2 revoked" would be the easy misread, so the meta line
           says which of the two this is. */
        kpi("Credentials covered by policy", `${fmt.num(decided)} / ${fmt.num(credentials.length)}`, "none revoked yet — the project is open", {
          iconName: "lock",
          tone: decided === credentials.length ? "success" : "warning",
        }),
        kpi("Retention exceptions", fmt.num(exceptions.length), exceptions.length ? "each carries a recorded reason" : "none configured", { iconName: "shield" }),
        kpi("Blocking the close", fmt.num(gate.reasons.length), gate.reasons.length ? "resolved in other stages" : "nothing outstanding", {
          iconName: "alert",
          tone: gate.reasons.length ? "critical" : "success",
        })
      ),
      gate.reasons.length
        ? card({ title: "What is holding the close", subtitle: "Derived from the stages that own each item — none of it is resolved here" }, gateList)
        : null,
      card(
        { title: policy.name, subtitle: `${policy.version} · ${policy.source}` },
        policyList,
        el(
          "div",
          { class: "dma-gcnote" },
          icon("info", 15),
          subdued(
            "This governs artifacts the migration created — buckets, credentials, staging data, export files. It says nothing about retention for the 858 assets DMA published, which is the customer's governance decision about their own tenant and explicitly out of scope."
          )
        )
      ),
      card(
        { title: "What would happen at close", subtitle: "Preview against today's artifact inventory", flush: true },
        artifactTable
      ),
      card(
        { title: "Reopening a closed project" },
        note(
          "Closing is reversible and revocation is not. A deleted staging bucket can be recreated and a deleted export can be regenerated, but a revoked source token needs a new credential conversation with the customer before the project can read anything again."
        ),
        note(
          "That asymmetry is why revocation sits behind the close gate rather than running on a timer, and why the two credentials above are both marked in use — Waves 3 to 6 publish through one of them and delta re-import still reads through the other."
        )
      )
    );
  }

  /* ========================================================================
     STEP 4 — RECORD
     ====================================================================== */

  const OUT_OF_SCOPE = [
    {
      title: "User Enablement and the CS handoff",
      detail:
        "Both P3 PRDs put this outside DMA's system scope in the same words — \"an operational/CS process\", triggered after closeout, not performed by it. This module's own stub summary used to lead with \"hand off to enablement\", which claimed the one thing the feature set is clearest about not owning.",
      who: "Customer Success / education",
    },
    {
      title: "Retention for the migrated assets themselves",
      detail:
        "The policy above governs the migration's own artifacts. How long a published dashboard or its underlying data lives is a target-tenant governance question the customer answers for their whole estate, not for this project.",
      who: "Customer",
    },
    {
      title: "Performing the optimisation work",
      detail:
        "Rewriting an inefficient query, repointing an asset from logs to a native signal, adding a pipeline processor. Each flag names what would fix it and who owns it; none of them is a button.",
      who: "Professional Services",
    },
    {
      title: "Merging or deleting a duplicate",
      detail:
        "A confirmed duplicate is a recorded decision. Consolidation happens by hand, in the tenant, by whoever owns the asset.",
      who: "Customer / Professional Services",
    },
    {
      title: "Team-based object ownership assignment",
      detail: "Named as out of scope in the Optimization PRD. Handled through customer or PS-side process.",
      who: "Customer",
    },
  ];

  function recordPanel(ctx) {
    const dd = dedupeRows();
    const fl = flagRows();
    const rows = previewRows();
    const gate = GC().closeGate();

    const ledger = [
      { label: "Published assets organised", n: GC().published(), detail: `Waves ${GC().publishedWaves().map((r) => r.wave.id).join(" and ")}, tagged and grouped at publish` },
      { label: "Groups created", n: GC().groups().length, detail: "One per application present in a live wave" },
      { label: "Duplicate candidates raised", n: dd.length, detail: `${fmt.num(count(dd, "confirmed"))} confirmed · ${fmt.num(count(dd, "dismissed"))} dismissed · ${fmt.num(count(dd, "open"))} open` },
      /* No verdict breakdown. Flags are reported, not decided, so the honest
         detail line is what the report covers and where it goes — not a
         three-way split of states that no longer exist. */
      {
        label: "Optimisation findings reported",
        n: fl.length,
        detail: `${fmt.num(new Set(fl.map((f) => f.asset.id)).size)} assets across waves ${[...new Set(fl.map((f) => f.wave))].sort().join(" and ")} · exported for the Professional Services review`,
      },
      { label: "Migration artifacts inventoried", n: rows.length, detail: `${fmt.num(rows.filter((p) => p.exception).length)} carrying a retention exception` },
      { label: "Retention policy applications", n: 0, detail: "The policy has not run. The project is not closed." },
    ];

    const ledgerList = el(
      "div",
      { class: "dma-gcledger" },
      ledger.map((r) =>
        el(
          "div",
          { class: "dma-gcledger__row" },
          el("span", { class: "dma-gcledger__n" }, fmt.num(r.n)),
          el("div", {}, el("div", { class: "dt-text-small dt-text-semibold" }, r.label), subdued(r.detail))
        )
      )
    );

    const scopeList = el(
      "div",
      { class: "dma-gcoff" },
      OUT_OF_SCOPE.map((o) =>
        el(
          "div",
          { class: "dma-gcoff__row" },
          el("span", { class: "dma-gcoff__x" }, icon("x", 13)),
          el(
            "div",
            {},
            el(
              "div",
              { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
              el("span", { class: "dt-text-semibold" }, o.title),
              badge(o.who, "neutral")
            ),
            note(o.detail)
          )
        )
      )
    );

    const features = DMA.data.featuresFor("govern-close");

    return el(
      "div",
      { class: "dt-stack", style: { gap: "var(--dt-spacing-16)" } },
      card(
        { title: "Closeout record", subtitle: "Recorded per project for audit, whether or not the project has closed" },
        ledgerList,
        el(
          "div",
          { class: "dma-gcnote" },
          icon("info", 15),
          subdued(
            gate.canClose
              ? "The closeout sequence can run. Applying it writes a dated policy record against this project."
              : "The last line is a zero and will stay one until the project closes. A stage that reported its own policy as applied before it had run would make the adoption metric — 100% of closed projects — unauditable."
          )
        )
      ),
      card({ title: "What this stage does not do", subtitle: "Named exclusions, not gaps" }, scopeList),
      card(
        { title: "Roadmap position", subtitle: "Both features are P3 — last tier, and the stage looks like it" },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          features.map((f) =>
            el(
              "div",
              { class: "dma-gcfeature" },
              el(
                "div",
                { style: { display: "flex", alignItems: "center", gap: "var(--dt-spacing-8)", flexWrap: "wrap" } },
                DMA.ui.tierChip(f.tier),
                el("span", { class: "dt-text-semibold" }, f.name)
              ),
              note(f.what),
              subdued(`Metric: ${f.metric}`)
            )
          )
        ),
        note(
          "Nothing downstream waits on either of them, which is why they are last. The cost of that ordering is that every project before they ship ends the way this stage describes — published assets with no applied structure, and a source credential still active."
        )
      )
    );
  }

  /* ======================================================================== */

  const PANELS = {
    organise: organisePanel,
    flags: flagsPanel,
    closeout: closeoutPanel,
    record: recordPanel,
  };

  DMA.register({
    id: "govern-close",
    title: "Govern & Close",
    phase: "close",
    icon: "flag",
    status: "ready",
    scope: "estate",
    summary: "Organise what shipped, flag what could be better, and clean up what the migration itself left behind.",

    steps: STEPS,

    notes: [
      "Two features, two triggers. Optimisation flagging fires per wave at publish and has already run over Waves 1 and 2; the retention policy fires once at project close and has never run. Building this as one screen that \"opens when the project closes\" would have hidden a pass that has already produced sixteen findings.",
      "There is no fix button anywhere on this stage, and optimisation has no buttons at all. Its findings leave as a standalone export that Professional Services reads with the customer — \"every flag requires explicit human review\" never said the review happens in DMA, and an accept/dismiss queue in here was this product implying it owned a backlog the PRD hands to a services engagement. Dedupe keeps its review controls, because a duplicate verdict is a judgement DMA is holding the evidence for.",
      "Query efficiency is two labelled flag types, not one. The PRD makes it an acceptance criterion and the practical reason is ownership: parse-before-filter is a query rewrite, re-parsing raw data is an OpenPipeline change made by somebody who may never read the query.",
      "Three of the seven duplicate candidates are not duplicates — four region-scoped fraud dashboards, a warn/page alert pair, an exec and an ops view. A queue where every row were a genuine duplicate would train a reviewer to confirm without reading, and false-positive dedupe is the PRD's own named complexity driver.",
      "The close gate shows its arithmetic instead of greying itself out. Four waves unpublished, four assets live and wrong, 156 open verdicts, 14 held — each one derived from the stage that owns it and each one navigable. \"Not started\" becomes a number.",
      "A migration artifact is not a migrated asset. The policy governs the eight things DMA itself created — two credentials, two buckets, staging data, two exports, the version history — and says nothing about retention for the 858 assets it published, which is the customer's decision about their own tenant.",
      "A retention exception cannot be recorded without a reason, and the modal refuses to save one. The guardrail metric is 100% revoked or explicitly extended with a reason; an exception with a blank reason would satisfy the first half of that sentence and defeat the second.",
      "User Enablement is out of scope and the module says so twice. The stub summary this file replaced led with \"hand off to enablement\" — the one thing both PRDs are explicit DMA does not own.",
    ],

    render(root, ctx) {
      const gate = GC().closeGate();
      const live = GC().publishedWaves();
      const findings = flagRows().length;
      const openDupes = dedupeRows().filter((d) => d.state === "open").length;

      root.append(
        ctx.pageHeader(
          [
            /* Two exports, deliberately both in the header rather than one
               here and one buried in a step. They are separate deliverables
               on separate clocks: the optimisation report goes to Professional
               Services while the project is still open, and the closeout
               record is produced at close. Bundling them would have implied a
               single moment of handover that does not exist. */
            button("Export optimisation report", { variant: "default", iconName: "fileText" }),
            button("Export closeout record", { variant: "default", iconName: "download" }),
            button("Close the project", {
              variant: "emphasized",
              iconName: "flag",
              disabled: !gate.canClose,
              title: gate.canClose ? null : `Blocked — ${gate.reasons.length} items outstanding.`,
              onClick: () => DMA.store.setSession("gcStep", "closeout"),
            }),
          ].filter(Boolean)
        ),
        el(
          "div",
          { class: "dma-gcstrip" },
          el("span", { class: "dt-text-semibold" }, "Whole project"),
          badge(gate.canClose ? "Ready to close" : "Open", gate.canClose ? "success" : "info", { iconName: gate.canClose ? "check" : "clock" }),
          /* Informational, not a warning. Findings are not work owed by anyone
             inside DMA, so colouring them like the open duplicates — which
             genuinely are a queue on this screen — would put a to-do badge on
             a report. Duplicates keep the warning tone because they still
             carry a verdict somebody here has to give. */
          findings ? badge(`${fmt.num(findings)} optimisation findings`, "info", { iconName: "flag" }) : null,
          openDupes ? badge(`${fmt.num(openDupes)} duplicates to review`, "warning", { iconName: "filter" }) : null,
          subdued(
            `${fmt.num(GC().published())} assets organised across ${fmt.num(live.length)} of ${fmt.num(PR().waves.length)} waves · ` +
              `${fmt.num(GC().artifacts.length)} migration artifacts inventoried · retention policy not yet applied`
          )
        ),
        stepper(),
        PANELS[step()](ctx)
      );
    },
  });
})();
