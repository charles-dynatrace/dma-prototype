/* ============================================================================
   MODULE: Handle Manual Exceptions
   ----------------------------------------------------------------------------
   Flow-diagram stage: Transform → Manual Exception Handling

   The one stage where a person does the translation. Everything upstream of
   here is automation reporting what it could and could not do; this is where
   someone opens the asset, reads the SPL, writes down what the query was
   actually for, and gets a working result into the tenant.

   ----------------------------------------------------------------------------
   ONE QUEUE, FOUR INLETS

   298 assets arrive from four different places, and the queue is deliberately
   one queue rather than four:

     113  Translate blocked it        no runnable DQL after the one retry
     135  Validate triaged it         runnable, wrong answer, human chose rework
       4  Validate failed it live     already in the tenant and already wrong
     ───
     252  had an automated attempt
    + 46  no automated path           lookups and macros, never attempted
     ───
     298  in the queue

   Four inlets, one worklist, because the person doing the work does the same
   work either way — read, understand, write DQL, prove it. What differs is
   where the row came from and what evidence it brought, and that is an origin
   badge and a detail line, not four separate screens.

   The 46 are the exception to the exception. They never entered a translation
   run, so they have no block reason, no confidence score and nothing to
   retranslate — there was never an attempt to fail. Their workspace drops the
   retranslate control entirely and the context box becomes the specification.
   They also carry the 252/298 distinction into every rate on this screen, so
   nobody divides a correction count by the wrong denominator.

   ----------------------------------------------------------------------------
   TWO LAYOUTS, BECAUSE A DASHBOARD IS NOT A QUERY

   A dashboard is worked tile by tile: twelve panels, four of them blocked,
   and the asset publishes whole or not at all. An alert or a saved search is
   one query — giving it a one-item sidebar would be a frame around nothing.
   So there are two workspaces, and the data layer makes that cheap: a
   single-query asset carries `query`, which is a tile with n: 1, so every
   renderer below treats the two identically.

   ----------------------------------------------------------------------------
   THIS STAGE PUBLISHES ONE ASSET. DEPLOY PUBLISHES WAVES.

   A fix is worthless sitting in a queue, so Exceptions can publish the asset
   it just fixed without waiting for the wave. What it cannot do is skip the
   gate: the single-asset publish runs the SAME pre-deploy health check a wave
   runs, and that check can and does block it — Wave 3 and Wave 4 assets reach
   `resolved` and stop there, because publishing one asset into a tenant that
   has none of the assets beside it is not a fix, it is a loose end.

   ----------------------------------------------------------------------------
   ONE OPERATOR, SIX STATES

   There is no second reviewer in this prototype — one person fixes and
   publishes. `Needs review` and `Sent back` are still real states, and that
   only works if the same operator can reach them: Send back hands the asset
   to whoever owns it with a written comment and stops the clock. Without that
   action, "Sent back · awaiting fix 12" would be a number on a screen with
   nothing behind it.

   ----------------------------------------------------------------------------
   WHAT THIS STAGE DELIBERATELY DOES NOT DO

   No AI diagnosis of why a translation failed and no AI-suggested fix. The
   human reads the finding, writes the context, and owns the result. No
   similarity score and no diff — P2, and Validate's. No model selection or
   retry policy — Translate's.

   Status: ready.
   Dependencies allowed: DMA.ui, DMA.data, DMA.store. Never another module.
   ========================================================================== */

(function () {
  "use strict";

  const { el, icon, button, badge, card, table, banner, progress, field, modal, emptyState, fmt } = DMA.ui;

  const STEPS = [
    { id: "queue",     label: "Queue" },
    { id: "workspace", label: "Workspace" },
    { id: "publish",   label: "Publish" },
    { id: "record",    label: "Record" },
  ];

  const wrap = { whiteSpace: "normal" };
  const X = () => DMA.data.exceptions;
  const PR = () => DMA.data.project;

  function step() {
    const id = DMA.store.session.exStep;
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

  const stateBadge = (s) => {
    const d = X().STATES[s];
    return badge(d.label, d.tone, { iconName: d.icon, title: d.detail });
  };
  const streamBadge = (id) => {
    const s = X().streamById(id);
    return badge(s.short, s.tone, { iconName: s.icon, title: s.detail });
  };

  /* --- Session layer -------------------------------------------------------
     Everything a viewer does in the demo — context written, DQL edited, a tile
     validated, an asset sent back or published — lands here and shadows the
     fixture. Every count on the page reads THROUGH this, never around it.

     The failure mode this exists to prevent was found on Validate: an action
     that restyles its own row while the KPI above it still reports the
     fixture. If a user can move a number, the number has to be derived. ---- */

  const SKEY = "exSession";
  const sess = () => DMA.store.session[SKEY] || {};

  function patch(id, fn) {
    const all = JSON.parse(JSON.stringify(sess()));
    all[id] = all[id] || { asset: {}, tiles: {}, comments: [] };
    fn(all[id]);
    DMA.store.setSession(SKEY, all);
  }

  /* The fixture asset plus whatever this session has done to it. */
  function view(a) {
    if (!a) return null;
    const o = sess()[a.id];
    if (!o) return a;

    const tiles = X().tilesOf(a).map((t) => {
      const ot = (o.tiles || {})[t.n];
      if (!ot) return t;
      return Object.assign({}, t, ot, {
        attempts: (t.attempts || []).concat(ot.attempts || []),
      });
    });

    const merged = Object.assign({}, a, o.asset || {});
    if (a.tiles) merged.tiles = tiles;
    else merged.query = tiles[0];
    merged.comments = (a.comments || []).concat(o.comments || []);
    return merged;
  }

  const open = (id) => view(X().byId(id));

  /* Queue totals with this session's decisions applied on top of the fixture.
     Only assets whose state actually MOVED are counted, so re-rendering or
     revisiting the step can never double-count one decision. */
  function queueState(id) {
    const base = X().estate(id);
    const states = Object.assign({}, base.states);
    Object.keys(sess()).forEach((assetId) => {
      const a = X().byId(assetId);
      if (!a) return;
      if (id && id !== "all" && String(a.wave) !== String(id)) return;
      const next = (sess()[assetId].asset || {}).state;
      if (!next || next === a.state) return;
      states[a.state] -= 1;
      states[next] += 1;
    });
    const stillOpen = X().OPEN_STATES.reduce((x, k) => x + states[k], 0);
    const done = X().DONE_STATES.reduce((x, k) => x + states[k], 0);
    return Object.assign({}, base, {
      states,
      open: stillOpen,
      done,
      clearedRate: base.total ? (done / base.total) * 100 : 0,
    });
  }

  /* --- Navigation ----------------------------------------------------------- */

  function openAsset(id, tileN) {
    DMA.store.setSession("exAssetId", id);
    DMA.store.setSession("exTileN", tileN);
    DMA.store.setSession("exStep", "workspace");
  }

  const currentAsset = () => open(DMA.store.session.exAssetId);

  /* A dashboard is worked in panels; an alert or a saved search is one query.
     Every sentence that counts the unit asks for its name here rather than
     hard-coding "panel", which reads as a bug on a single-query asset. */
  const noun = (a, n) => (a.layout === "tiles" ? (n === 1 ? "panel" : "panels") : n === 1 ? "query" : "queries");
  const rowsLabel = (n) => `${fmt.num(n)} ${n === 1 ? "row" : "rows"}`;

  /* Most tiles carry a scripted result for the hand-written path. The few that
     do not still have to return something, and "1 row" reads as a bug rather
     than a result. Derived from the asset id so the same edit always returns
     the same count — a demo that reports a different number on every replay
     invites the room to ask what the number means. */
  function improvisedRows(a, tile) {
    let h = 0;
    const s = `${a.id}:${tile.n}`;
    for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 9973;
    return 40 + (h % 1800);
  }

  function currentTile(a) {
    const tiles = X().tilesOf(a);
    const n = DMA.store.session.exTileN;
    return tiles.find((t) => t.n === n) || tiles.find((t) => t.state === "blocked") || tiles[0] || null;
  }

  const stepper = () => {
    const active = step();
    const row = el("div", { class: "dma-steps", role: "tablist", "aria-label": "Exception handling steps" });
    STEPS.forEach((s, i) => {
      if (i > 0) row.append(el("span", { class: "dma-steps__sep" }, icon("chevronR", 12)));
      row.append(
        el(
          "button",
          {
            class: "dma-step",
            role: "tab",
            "aria-selected": String(s.id === active),
            onClick: () => DMA.store.setSession("exStep", s.id),
          },
          el("span", { class: "dma-step__num" }, String(i + 1)),
          el("span", {}, s.label)
        )
      );
    });
    return row;
  };

  /* ========================================================================
     STEP 1 — QUEUE
     ====================================================================== */

  const FILTERS = [
    { key: "exStream", label: "Origin", all: "All origins", options: () => X().STREAMS.map((s) => ({ v: s.id, l: s.label })) },
    { key: "exType",   label: "Type",   all: "All types",   options: () => X().TYPES.map((t) => ({ v: t, l: t })) },
    { key: "exState",  label: "State",  all: "Any state",   options: () => X().STATE_ORDER.map((s) => ({ v: s, l: X().STATES[s].label })) },
  ];

  function filterBar() {
    const row = el("div", { class: "dma-exfilters" });
    FILTERS.forEach((f) => {
      const sel = el(
        "select",
        {
          class: "dt-input",
          "aria-label": f.label,
          onChange: (e) => DMA.store.setSession(f.key, e.target.value),
        },
        el("option", { value: "all" }, f.all),
        ...f.options().map((o) => el("option", { value: o.v }, o.l))
      );
      sel.value = DMA.store.session[f.key] || "all";
      row.append(sel);
    });
    row.append(
      button("Clear", {
        variant: "subtle",
        iconName: "x",
        onClick: () => FILTERS.forEach((f) => DMA.store.setSession(f.key, "all")),
      })
    );
    return row;
  }

  function filteredRows() {
    const wantState = DMA.store.session.exState || "all";
    return X()
      .assetsFor({
        wave: waveId(),
        stream: DMA.store.session.exStream || "all",
        type: DMA.store.session.exType || "all",
      })
      .map(view)
      .filter((a) => wantState === "all" || a.state === wantState);
  }

  /* The four inlets, as cards. `derived` is printed because it is the point:
     three of these four numbers are re-read from the stage that produced them
     every time this screen paints, so Exceptions cannot drift from Translate
     or Validate without someone editing those stages. */
  function inletCards(q) {
    return el(
      "div",
      { class: "dt-grid dt-grid-4" },
      ...X().STREAMS.map((s) =>
        el(
          "div",
          { class: "dma-exinlet", "data-tone": s.tone },
          el("div", { class: "dma-exinlet__head" }, icon(s.icon, 14), el("span", { class: "dt-text-semibold" }, s.label)),
          el("div", { class: "dma-exinlet__n dt-tnum" }, fmt.num(q.streams[s.id])),
          subdued(s.detail),
          el("div", { class: "dma-exinlet__foot" }, icon("arrowRight", 11), el("span", {}, s.remedy)),
          el(
            "code",
            { class: "dma-code dt-text-small", title: s.derived ? "Re-derived on every render" : "Owned by this stage" },
            s.derived || "owned here"
          )
        )
      )
    );
  }

  /* A row names its dependency inline. LK-2101 blocking SS-2044 is the whole
     argument for the fourth stream being upstream work rather than a sidecar:
     the saved search cannot be fixed until the lookup it reads exists. */
  function assetCell(a) {
    const deps = X()
      .blockedByOf(a.id)
      .filter((d) => {
        const dep = open(d);
        return dep && X().OPEN_STATES.includes(dep.state);
      });
    return el(
      "div",
      { class: "dt-stack dt-gap-2" },
      el("span", { class: "dt-text-medium" }, a.name),
      el(
        "span",
        { class: "dt-text-small dt-text-subdued" },
        a.id + (a.rebuild ? " · rebuild from intent" : "") + (deps.length ? ` · waiting on ${deps.join(", ")}` : "")
      )
    );
  }

  function progressCell(a) {
    const p = X().progressOf(a);
    if (p.total <= 1) return subdued(p.blocked ? "blocked" : "runs");
    return el(
      "div",
      { class: "dma-exmini" },
      el("span", { class: "dt-text-small dt-tnum" }, `${p.validated}/${p.total}`),
      progress((p.validated / p.total) * 100, p.blocked ? "warning" : "success")
    );
  }

  function queuePanel(ctx) {
    const q = queueState(waveId());
    const rows = filteredRows();
    const wave = selectedWave();
    const openPct = q.total ? (q.open / q.total) * 100 : 0;

    /* A wave with no queue is not an empty table, it is a wave that has not
       produced an exception yet — and the reason sits in Translate, not here.
       Four zeroed inlet cards would read as "nothing went wrong", which is a
       different and much more flattering claim. */
    if (wave && !X().hasQueue(wave.id)) {
      const tr = DMA.data.waveStageStatus(wave, "translate");
      return card(
        {},
        emptyState(
          "clock",
          `Wave ${wave.id} has not reached this stage`,
          tr === "not-started"
            ? `Nothing in Wave ${wave.id} has been translated, so nothing can have failed. Exceptions fills from Translate and Validate; until one of them runs on this wave there is no work here.`
            : `Wave ${wave.id} is still translating. Anything it blocks will arrive here as it goes — this queue is an output of that run, not a separate backlog.`,
          button("Look at all waves", {
            variant: "emphasized",
            iconName: "layers",
            onClick: () => DMA.store.setSession("waveId", "all"),
          })
        )
      );
    }

    return el(
      "div",
      { class: "dt-stack dt-gap-20" },

      kpiRow(
        kpi("In the queue", fmt.num(q.total), wave ? `Wave ${wave.id}` : "The four waves that have translated", { iconName: "layers" }),
        kpi("Open", fmt.num(q.open), `${fmt.pct(openPct, 1)} of the queue still needs a person`, {
          tone: "warning",
          iconName: "clock",
          bar: progress(openPct, "warning"),
        }),
        kpi("Cleared", fmt.num(q.done), `${fmt.pct(q.clearedRate, 1)} resolved or published`, {
          tone: "success",
          iconName: "check",
          bar: progress(q.clearedRate, "success"),
        }),
        kpi("Had an automated attempt", fmt.num(q.attempted), `${fmt.num(q.noPath)} never entered a translation run`, {
          iconName: "zap",
        })
      ),

      card(
        { title: "Where these came from", subtitle: "Four inlets, one worklist" },
        el(
          "div",
          { class: "dt-stack dt-gap-16" },
          inletCards(q),
          note(
            "One queue and not four, because the work is the same work: read the asset, understand what it was for, write DQL that does it, prove it. What differs is the evidence each row arrived with — a block reason, a validation finding, a reviewer's comment, or in 46 cases nothing at all."
          )
        )
      ),

      card(
        { title: "Lifecycle", subtitle: "One operator fixes and publishes" },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          el(
            "div",
            { class: "dma-exlife" },
            ...X().STATE_ORDER.map((s) => {
              const d = X().STATES[s];
              return el(
                "button",
                {
                  class: "dma-exlife__cell",
                  "data-tone": d.tone,
                  "aria-pressed": String((DMA.store.session.exState || "all") === s),
                  title: d.detail,
                  onClick: () =>
                    DMA.store.setSession("exState", (DMA.store.session.exState || "all") === s ? "all" : s),
                },
                el("span", { class: "dma-exlife__n dt-tnum" }, fmt.num(q.states[s])),
                el("span", { class: "dma-exlife__l" }, d.label)
              );
            })
          ),
          note(
            "There is no second reviewer. Needs review and Sent back are reachable by the same person who did the work — Send back hands the asset to whoever owns it, with a written comment, and stops the clock on it."
          )
        )
      ),

      card(
        { title: "Worklist", subtitle: `${fmt.num(rows.length)} rows carried in full — every one opens` },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          filterBar(),
          rows.length
            ? table(
                [
                  { label: "Asset", render: assetCell },
                  { label: "Type", render: (a) => subdued(a.type) },
                  { label: "Origin", render: (a) => streamBadge(a.stream) },
                  { label: "Wave", render: (a) => el("span", { class: "dt-tnum" }, String(a.wave)) },
                  { label: "Progress", render: progressCell },
                  { label: "State", render: (a) => stateBadge(a.state) },
                  { label: "Owner", render: (a) => (a.assignee ? badge(a.assignee, "neutral", { iconName: "users" }) : subdued("unassigned")) },
                  { label: "Opened", render: (a) => el("span", { class: "dt-text-small dt-text-subdued dt-tnum" }, when(a.openedAt)) },
                  { label: "", render: () => icon("chevronR", 14) },
                ],
                rows,
                { onRowClick: (a) => openAsset(a.id) }
              )
            : emptyState("filter", "Nothing matches those filters", "Clear a filter or pick another wave."),
          subdued(
            "A worked sample, not the population. The counts above are the whole queue; these are the rows this prototype carries in full, so every one of them opens."
          )
        )
      )
    );
  }

  /* ========================================================================
     STEP 2 — WORKSPACE
     ------------------------------------------------------------------------
     Two layouts off one shape. `tilesOf()` returns a list either way, so the
     only structural difference is whether a tile rail is drawn beside the
     pane — a dashboard needs one because the tile is the unit of work, an
     alert does not because a one-item sidebar is a frame around nothing.
     ====================================================================== */

  /* Draft text lives OUTSIDE DMA.store on purpose. A keystroke must not
     re-render: setSession re-paints the whole module, and a re-paint between
     mousedown and click on the Retranslate button would destroy the button
     before its click ever landed. Drafts are transient; committing one — a
     retranslation, a validated tile — is what reaches the session. */
  const DRAFTS = { ctx: {}, dql: {} };
  const dkey = (a, t) => `${a.id}:${t.n}`;

  const ctxDraft = (a, t) => DRAFTS.ctx[dkey(a, t)] || "";
  const dqlDraft = (a, t) => {
    const k = dkey(a, t);
    return DRAFTS.dql[k] !== undefined ? DRAFTS.dql[k] : t.dql || "";
  };

  const MIN_CONTEXT = 25;

  /* --- Mutations -----------------------------------------------------------
     One entry point. The asset's state is re-derived from its tiles inside the
     same write, so a tile going green and the badge in the header cannot
     disagree — `stateLocked` is how an explicit decision (sent back,
     published, approved) opts out of that derivation. */
  function mutate(id, fn) {
    const fixture = X().byId(id);
    const all = JSON.parse(JSON.stringify(sess()));
    const o = (all[id] = all[id] || { asset: {}, tiles: {}, comments: [] });
    o.tiles = o.tiles || {};
    o.asset = o.asset || {};
    fn(o);

    if (!o.asset.stateLocked) {
      const tiles = X().tilesOf(fixture).map((t) => Object.assign({}, t, o.tiles[t.n] || {}));
      const blocked = tiles.filter((t) => t.state !== "validated").length;
      const cur = o.asset.state || fixture.state;
      if (cur !== "published" && cur !== "sent-back" && cur !== "resolved") {
        o.asset.state = blocked === 0 ? "needs-review" : "in-progress";
      }
    }
    DMA.store.setSession(SKEY, all);
  }

  const touch = (o, n) => (o.tiles[n] = o.tiles[n] || { attempts: [] });

  /* Regenerate this tile's DQL from its SPL plus the written context. The
     outcome is scripted per tile in the fixture rather than computed, because
     a prototype that always succeeds would be arguing something the PRD
     explicitly denies: context does not always work. */
  function retranslate(a, tile) {
    const text = ctxDraft(a, tile).trim();
    if (text.length < MIN_CONTEXT) return;
    const r = tile.retry || {
      outcome: "improved",
      note: "Regenerated with the context applied. It runs, and the result still differs from the original.",
    };
    const nextN = (tile.attempts || []).length + 1;
    const now = new Date().toISOString();

    mutate(a.id, (o) => {
      const ot = touch(o, tile.n);
      ot.attempts = (ot.attempts || []).concat([
        { n: nextN, at: now, by: "you", context: text, outcome: r.outcome, note: r.note },
      ]);
      if (r.dql) ot.dql = r.dql;
      if (r.result) ot.result = r.result;
      if (r.notes) ot.notes = Object.assign({}, tile.notes, r.notes);
      if (r.outcome === "resolved") {
        ot.state = "validated";
        ot.blockers = [];
        ot.editedBy = "you";
        ot.editedAt = now;
      }
    });

    delete DRAFTS.dql[dkey(a, tile)];
    DRAFTS.ctx[dkey(a, tile)] = "";
  }

  /* Run the tile's DQL. A query nobody has touched reproduces the result it
     already has — validating an unedited failing query fails again, which is
     the only honest thing for it to do. An edited one lands. */
  function validateTile(a, tile) {
    const edited = DRAFTS.dql[dkey(a, tile)] !== undefined && DRAFTS.dql[dkey(a, tile)] !== tile.dql;
    const now = new Date().toISOString();

    mutate(a.id, (o) => {
      const ot = touch(o, tile.n);
      if (edited) {
        ot.dql = DRAFTS.dql[dkey(a, tile)];
        const hw = tile.handWritten;
        ot.result = hw ? hw.result : { rows: (tile.result && tile.result.rows) || improvisedRows(a, tile), executedAt: now };
        ot.state = "validated";
        ot.blockers = [];
        ot.editedBy = "you";
        ot.editedAt = now;
        ot.handNote = hw ? hw.note : "Hand-written and validated against the tenant.";
      } else if (tile.result && !tile.result.error) {
        ot.state = "validated";
        ot.result = Object.assign({}, tile.result, { executedAt: now });
      } else {
        ot.result = Object.assign({}, tile.result || {}, {
          error: (tile.result && tile.result.error) || "The query did not run.",
        });
      }
    });
    delete DRAFTS.dql[dkey(a, tile)];
  }

  /* --- The actions that move an asset, not a tile -------------------------- */

  function sendBackModal(a) {
    let text = "";
    const to = el(
      "select",
      { class: "dt-input" },
      el("option", { value: "The asset's owner" }, "The asset's owner"),
      el("option", { value: "Global Mapping" }, "Global Mapping (a mapping value is missing)"),
      el("option", { value: "The data owner" }, "The data owner (the source is the problem)")
    );
    const ta = el("textarea", {
      class: "dt-input dma-exbox__input",
      rows: 5,
      placeholder: "What do they need to answer, and what is waiting on it?",
      onInput: (e) => {
        text = e.target.value;
        go.disabled = text.trim().length < MIN_CONTEXT;
      },
    });

    const go = button("Send it back", {
      variant: "emphasized",
      iconName: "arrowLeft",
      disabled: true,
      onClick: () => {
        mutate(a.id, (o) => {
          o.asset.state = "sent-back";
          o.asset.stateLocked = true;
          o.asset.sentBack = { at: new Date().toISOString(), by: "you", to: to.value, comment: text.trim() };
        });
        m.close();
      },
    });

    const m = modal(
      `Send ${a.id} back`,
      el(
        "div",
        { class: "dt-stack dt-gap-16" },
        note(
          "Sending back does not close the exception — it stops the clock on it and names who has to answer. The asset stays in the queue, visibly waiting on someone, which is the difference between a blocker and a silence."
        ),
        field("Hand it to", to),
        field("Comment", ta, `At least ${MIN_CONTEXT} characters. This is the whole of what they will see.`)
      ),
      [go]
    );
    return m;
  }

  function approve(a) {
    mutate(a.id, (o) => {
      o.asset.state = "resolved";
      o.asset.stateLocked = true;
    });
    DMA.store.setSession("exStep", "publish");
  }

  /* --- Header --------------------------------------------------------------- */

  function assetHeader(a) {
    const p = X().progressOf(a);
    const health = X().healthFor(a);
    const done = p.blocked === 0;

    return el(
      "div",
      { class: "dma-exhead" },
      el(
        "div",
        { class: "dt-stack dt-gap-4 dt-grow" },
        el(
          "div",
          { class: "dt-row dt-gap-8 dt-wrap" },
          el("span", { class: "dt-text-semibold" }, a.name),
          streamBadge(a.stream),
          stateBadge(a.state),
          a.rebuild ? badge("Rebuild from intent", "info", { iconName: "helpCircle" }) : null
        ),
        subdued(
          `${a.id} · ${a.type} · Wave ${a.wave} · ${
            a.layout === "tiles" ? `${p.validated} of ${p.total} panels validated` : p.blocked ? "query blocked" : "query runs"
          } · opened ${when(a.openedAt)}${a.assignee ? ` · ${a.assignee}` : ""}`
        )
      ),
      el(
        "div",
        { class: "dt-row dt-gap-8 dt-wrap" },
        button("Queue", { variant: "default", iconName: "chevronL", onClick: () => DMA.store.setSession("exStep", "queue") }),
        a.state === "sent-back"
          ? null
          : button("Send back", { variant: "default", iconName: "arrowLeft", onClick: () => sendBackModal(a) }),
        button(done ? "Approve & go to publish" : `${p.blocked} still blocked`, {
          variant: done ? "emphasized" : "default",
          iconName: done ? "check" : "lock",
          disabled: !done,
          title: done
            ? health.ok
              ? `Every ${noun(a, 1)} runs and the pre-deploy check passes.`
              : `Every ${noun(a, 1)} runs. The pre-deploy check still has something to say.`
            : a.layout === "tiles"
            ? "A dashboard publishes whole or not at all."
            : "The query does not run yet.",
          onClick: () => approve(a),
        })
      )
    );
  }

  /* The evidence the row arrived with. Four inlets means four different kinds
     of evidence, and the panel says which one this is rather than flattening
     them into "failed". */
  function originBlock(a) {
    const s = X().streamById(a.stream);
    return el(
      "div",
      { class: "dma-exorigin", "data-tone": s.tone },
      el(
        "div",
        { class: "dt-row dt-gap-8 dt-wrap" },
        icon(s.icon, 14),
        el("span", { class: "dt-text-semibold" }, a.origin.label),
        subdued(`${s.label} · ${when(a.origin.at)}${a.origin.by ? ` · ${a.origin.by}` : ""}`)
      ),
      note(a.origin.detail)
    );
  }

  function sentBackBlock(a) {
    if (a.state !== "sent-back" || !a.sentBack) return null;
    return banner("critical", a.sentBack.comment, {
      title: `Sent back to ${a.sentBack.to} on ${when(a.sentBack.at)} by ${a.sentBack.by}`,
      action: button("Take it back", {
        variant: "default",
        iconName: "refresh",
        onClick: () =>
          mutate(a.id, (o) => {
            o.asset.state = "in-progress";
            o.asset.stateLocked = false;
            o.asset.sentBack = null;
          }),
      }),
    });
  }

  /* --- Tile rail (dashboards only) ------------------------------------------ */

  function tileRail(a, active) {
    return el(
      "div",
      { class: "dma-extiles" },
      el("div", { class: "dma-extiles__head" }, `${X().tilesOf(a).length} panels`),
      ...X()
        .tilesOf(a)
        .map((t) =>
          el(
            "button",
            {
              class: "dma-extile",
              "data-state": t.state,
              "aria-current": String(t.n === active.n),
              onClick: () => DMA.store.setSession("exTileN", t.n),
            },
            el("span", { class: "dma-extile__n dt-tnum" }, String(t.n)),
            el(
              "span",
              { class: "dma-extile__body" },
              el("span", { class: "dma-extile__name dt-truncate" }, t.name),
              el("span", { class: "dma-extile__type dt-text-small" }, t.splunkType)
            ),
            icon(t.state === "validated" ? "check" : "alert", 13, "dma-extile__mark")
          )
        )
    );
  }

  /* --- The SPL pane --------------------------------------------------------- */

  function splBlock(tile) {
    return el(
      "div",
      { class: "dt-stack dt-gap-8" },
      el(
        "pre",
        { class: "dma-exspl" },
        ...X()
          .tokenize(tile.spl, tile.marks)
          .map((p) => el("span", { class: "dma-extok", "data-kind": p.k }, p.t))
      ),
      el(
        "div",
        { class: "dma-exlegend" },
        ...X().SPL_LEGEND.map((l) =>
          el(
            "span",
            { class: "dma-exlegend__item", title: l.detail },
            el("span", { class: "dma-extok", "data-kind": l.id }, "  "),
            el("span", { class: "dt-text-small dt-text-subdued" }, l.label)
          )
        )
      )
    );
  }

  /* --- The context box — the control Charles asked for ----------------------
     Below the SPL, above the DQL, in the order the work happens: read what it
     was, say what it meant, look at what came back. It is a free-text field
     and nothing on this screen writes into it for you. */
  function contextBox(a, tile) {
    const rebuilt = !!a.rebuild;
    const ta = el("textarea", {
      class: "dt-input dma-exbox__input",
      rows: 4,
      placeholder: rebuilt
        ? "What is this for, what does it need to contain, and who maintains it? There is no source query to translate — this is the specification."
        : "What did this query actually mean? Field renames, units, what a filter was for, which rows must survive. Written in plain language.",
      onInput: (e) => {
        DRAFTS.ctx[dkey(a, tile)] = e.target.value;
        const n = e.target.value.trim().length;
        count.textContent = n < MIN_CONTEXT ? `${MIN_CONTEXT - n} more characters` : `${n} characters`;
        if (go) go.disabled = n < MIN_CONTEXT;
      },
    });
    ta.value = ctxDraft(a, tile);

    const count = el(
      "span",
      { class: "dt-text-small dt-text-subdued" },
      ctxDraft(a, tile).trim().length < MIN_CONTEXT
        ? `${MIN_CONTEXT - ctxDraft(a, tile).trim().length} more characters`
        : `${ctxDraft(a, tile).trim().length} characters`
    );

    const go = rebuilt
      ? null
      : button("Retranslate with this context", {
          variant: "emphasized",
          iconName: "refresh",
          disabled: ctxDraft(a, tile).trim().length < MIN_CONTEXT,
          onClick: () => retranslate(a, tile),
        });

    return el(
      "div",
      { class: "dma-exbox" },
      el(
        "div",
        { class: "dma-exbox__head" },
        icon("fileText", 13),
        el("span", { class: "dt-text-semibold" }, rebuilt ? "Specification" : "Translation context"),
        el("span", { class: "dt-grow" }),
        count
      ),
      subdued(
        rebuilt
          ? "This asset has no automated path, so there is nothing to retranslate. What you write here is the specification the rebuild is measured against — and it is what the next person reads when they ask why this exists."
          : "Written in plain language and fed to the translator alongside the original SPL, not instead of it. Regeneration starts from the SPL every time; the context only resolves what the SPL could not say."
      ),
      ta,
      go ? el("div", { class: "dt-row dt-gap-8" }, go, subdued("Every round is kept below, context and outcome together.")) : null
    );
  }

  /* --- The DQL editor ------------------------------------------------------- */

  function dqlBlock(a, tile) {
    const k = dkey(a, tile);
    const ta = el("textarea", {
      class: "dt-input dma-exdql__input dt-mono",
      rows: Math.min(16, Math.max(5, String(tile.dql || "").split("\n").length + 1)),
      spellcheck: "false",
      placeholder: "No DQL was produced. Write it, or add context above and regenerate.",
      onInput: (e) => {
        DRAFTS.dql[k] = e.target.value;
        run.disabled = !e.target.value.trim();
        dirty.hidden = e.target.value === (tile.dql || "");
      },
    });
    ta.value = dqlDraft(a, tile);

    const dirty = el("span", { class: "dt-text-small dt-text-warning", hidden: true }, "edited, not yet run");

    const run = button(tile.state === "validated" ? "Re-run and validate" : `Validate this ${noun(a, 1)}`, {
      variant: "emphasized",
      iconName: "play",
      disabled: !dqlDraft(a, tile).trim(),
      onClick: () => validateTile(a, tile),
    });

    return el(
      "div",
      { class: "dma-exdql" },
      el(
        "div",
        { class: "dma-exbox__head" },
        icon("edit", 13),
        el("span", { class: "dt-text-semibold" }, "DQL"),
        tile.editedBy ? badge(`edited by ${tile.editedBy}`, "info", { iconName: "users" }) : null,
        el("span", { class: "dt-grow" }),
        dirty
      ),
      ta,
      el(
        "div",
        { class: "dt-row dt-gap-8 dt-wrap" },
        run,
        button("Revert", {
          variant: "subtle",
          iconName: "refresh",
          onClick: () => {
            delete DRAFTS.dql[k];
            DMA.store.setSession("exTileN", tile.n);
          },
        }),
        subdued("Editing is free-form. Nothing on this screen writes DQL for you.")
      )
    );
  }

  function resultBlock(tile) {
    const r = tile.result || {};
    if (r.error) {
      return el(
        "div",
        { class: "dma-exresult", "data-state": "error" },
        el("div", { class: "dt-row dt-gap-8" }, icon("x", 14), el("span", { class: "dt-text-semibold" }, "Did not return a usable result")),
        note(r.error)
      );
    }
    return el(
      "div",
      { class: "dma-exresult", "data-state": "ok" },
      el(
        "div",
        { class: "dt-row dt-gap-8 dt-wrap" },
        icon("check", 14),
        el("span", { class: "dt-text-semibold" }, rowsLabel(r.rows || 0)),
        subdued(`run ${when(r.executedAt)} · this prototype replays a recorded run rather than querying a tenant`)
      ),
      tile.handNote ? note(tile.handNote) : null
    );
  }

  function blockersBlock(tile) {
    if (!tile.blockers || !tile.blockers.length) return null;
    return el(
      "div",
      { class: "dt-stack dt-gap-8" },
      ...tile.blockers.map((b) =>
        el(
          "div",
          { class: "dma-exblocker", "data-tone": b.tone },
          el("div", { class: "dt-row dt-gap-8" }, icon(b.tone === "critical" ? "x" : "alert", 13), el("span", { class: "dt-text-semibold" }, b.label)),
          note(b.detail)
        )
      )
    );
  }

  /* Every round of context, kept verbatim with what it produced. Three rounds
     that all came back "still failing" is the most useful thing this panel can
     tell the next person to open the asset. */
  function attemptsBlock(a, tile) {
    if (!tile.attempts || !tile.attempts.length) {
      return subdued(`No retranslation has been attempted on this ${noun(a, 1)} yet.`);
    }
    return el(
      "div",
      { class: "dt-stack dt-gap-12" },
      ...tile.attempts.map((at) => {
        const o = X().OUTCOMES[at.outcome];
        return el(
          "div",
          { class: "dma-exattempt", "data-tone": o.tone },
          el(
            "div",
            { class: "dt-row dt-gap-8 dt-wrap" },
            el("span", { class: "dt-text-semibold" }, `Attempt ${at.n}`),
            badge(o.label, o.tone, { iconName: o.icon, title: o.detail }),
            subdued(`${at.by} · ${when(at.at)}`)
          ),
          el("div", { class: "dma-exattempt__ctx" }, at.context),
          note(at.note)
        );
      })
    );
  }

  function notesBlock(tile) {
    return el(
      "dl",
      { class: "dma-exnotes" },
      ...X().NOTE_SECTIONS.flatMap((s) => [
        el("dt", {}, s.label),
        el("dd", { style: wrap }, (tile.notes && tile.notes[s.id]) || "—"),
      ])
    );
  }

  function depsBlock(a, tile) {
    const d = tile.deps || { indexes: [], lookups: [], macros: [] };
    const rows = [
      ["Indexes", d.indexes, "database"],
      ["Lookups", d.lookups, "fileText"],
      ["Macros", d.macros, "zap"],
    ].filter(([, list]) => list && list.length);

    const waiting = X()
      .blockedByOf(a.id)
      .map((id) => open(id))
      .filter((x) => x && X().OPEN_STATES.includes(x.state));

    return el(
      "div",
      { class: "dt-stack dt-gap-12" },
      rows.length
        ? el(
            "div",
            { class: "dt-stack dt-gap-8" },
            ...rows.map(([label, list, ic]) =>
              el(
                "div",
                { class: "dt-row dt-gap-8 dt-wrap" },
                icon(ic, 13),
                el("span", { class: "dt-text-small dt-text-secondary" }, label),
                ...list.map((x) => el("code", { class: "dma-code dt-text-small" }, x))
              )
            )
          )
        : subdued(`This ${noun(a, 1)} reads nothing outside its own bucket.`),
      waiting.length
        ? banner(
            "warning",
            waiting.map((x) => `${x.id} — ${x.name} (${X().STATES[x.state].label})`).join(" · "),
            {
              title: `Waiting on ${waiting.length === 1 ? "an asset" : `${waiting.length} assets`} in this queue`,
              action: button(`Open ${waiting[0].id}`, {
                variant: "default",
                iconName: "externalLink",
                onClick: () => openAsset(waiting[0].id),
              }),
            }
          )
        : null,
      (a.blocks || []).length
        ? note(
            `Fixing this unblocks ${(a.blocks || []).join(", ")}. Prerequisites want doing first in a wave, not last — they are cheap individually and everything downstream of them stops.`
          )
        : null
    );
  }

  function commentsBlock(a) {
    if (!a.comments || !a.comments.length) return subdued("No comments on this asset.");
    return el(
      "div",
      { class: "dt-stack dt-gap-12" },
      ...a.comments.map((c) =>
        el(
          "div",
          { class: "dma-excomment", "data-resolved": String(!!c.resolved) },
          el(
            "div",
            { class: "dt-row dt-gap-8 dt-wrap" },
            badge(c.by, "neutral", { iconName: "users" }),
            subdued(when(c.at)),
            c.resolved ? badge("Resolved", "success", { iconName: "check" }) : badge("Open", "warning", { iconName: "clock" })
          ),
          note(c.text),
          ...(c.replies || []).map((r) =>
            el(
              "div",
              { class: "dma-excomment__reply" },
              el("div", { class: "dt-row dt-gap-8 dt-wrap" }, badge(r.by, "neutral", { iconName: "users" }), subdued(when(r.at))),
              note(r.text)
            )
          )
        )
      )
    );
  }

  /* --- The pane ------------------------------------------------------------- */

  function tilePane(a, tile) {
    const multi = X().tilesOf(a).length > 1;
    return el(
      "div",
      { class: "dt-stack dt-gap-16 dt-grow", style: { minWidth: 0 } },

      card(
        {
          title: multi ? `Panel ${tile.n} — ${tile.name}` : tile.name,
          subtitle: `${tile.splunkType} → ${tile.dtType}`,
          actions: [tile.state === "validated" ? badge("Validated", "success", { iconName: "check" }) : badge("Blocked", "critical", { iconName: "x" })],
        },
        el(
          "div",
          { class: "dt-stack dt-gap-16" },
          blockersBlock(tile),
          el("div", { class: "dma-exbox__head" }, icon("search", 13), el("span", { class: "dt-text-semibold" }, "Original SPL")),
          splBlock(tile),
          contextBox(a, tile),
          dqlBlock(a, tile),
          resultBlock(tile)
        )
      ),

      card({ title: "Rounds", subtitle: "Every context written, and what it produced" }, attemptsBlock(a, tile)),
      card({ title: "Translation notes", subtitle: "The same six headings on every asset" }, notesBlock(tile)),
      card({ title: "Dependencies", subtitle: "What this reads, and what reads it" }, depsBlock(a, tile)),
      card({ title: "Comments", subtitle: "Carried from Validate and added here" }, commentsBlock(a))
    );
  }

  function workspacePanel() {
    const a = currentAsset();
    if (!a) {
      return card(
        {},
        emptyState(
          "edit",
          "No asset open",
          "Pick a row from the queue to open its workspace.",
          button("Back to the queue", { variant: "emphasized", onClick: () => DMA.store.setSession("exStep", "queue") })
        )
      );
    }

    const tile = currentTile(a);
    const multi = X().tilesOf(a).length > 1;

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      assetHeader(a),
      sentBackBlock(a),
      originBlock(a),
      multi
        ? el("div", { class: "dma-exwork" }, tileRail(a, tile), tilePane(a, tile))
        : tilePane(a, tile)
    );
  }

  /* ========================================================================
     STEP 3 — PUBLISH
     ------------------------------------------------------------------------
     One asset, through the same gate a wave goes through. The gate is shown
     whether it passes or not, and when it fails the screen says what the
     alternative is rather than greying a button and leaving you to guess.
     ====================================================================== */

  const OPT_KEY = "exOpts";
  function optOn(id) {
    const s = DMA.store.session[OPT_KEY];
    if (s && id in s) return s[id];
    return X().PUBLISH_OPTIONS.find((o) => o.id === id).on;
  }
  function toggleOpt(id) {
    const s = Object.assign({}, DMA.store.session[OPT_KEY] || {});
    s[id] = !optOn(id);
    DMA.store.setSession(OPT_KEY, s);
  }

  const CHECK_ICON = { pass: "check", warn: "alert", fail: "x" };
  const CHECK_TONE = { pass: "success", warn: "warning", fail: "critical" };

  function healthBlock(health) {
    return el(
      "div",
      { class: "dt-stack dt-gap-8" },
      ...health.checks.map((c) =>
        el(
          "div",
          { class: "dma-excheck", "data-state": c.state },
          el("span", { class: "dma-excheck__mark" }, icon(CHECK_ICON[c.state], 13)),
          el(
            "div",
            { class: "dt-stack dt-gap-2 dt-grow" },
            el("span", { class: "dt-text-medium" }, c.label),
            note(c.detail)
          ),
          badge(c.state === "pass" ? "Pass" : c.state === "warn" ? "Warning" : "Blocks", CHECK_TONE[c.state])
        )
      )
    );
  }

  /* The comment header that ends up inside every published query. It is the
     only traceability that survives someone opening this in the tenant in six
     months with no access to DMA, so it is previewed rather than described.

     Every line is built from the asset that is open. The fixture's `sample`
     strings are the shape, not the content: printing them verbatim would show
     one asset's SPL and another person's name on every screen, which is the
     one thing a traceability preview must never do. */
  function headerLines(a) {
    const tiles = X().tilesOf(a);
    const lead = tiles[0] || {};
    const edited = tiles.filter((t) => t.editedBy);
    const who = (edited[0] || {}).editedBy || a.assignee || "unassigned";
    const whenEdited = (edited[0] || {}).editedAt || a.publishedAt;
    const out = [];

    X().PUBLISH_OPTIONS.forEach((o) => {
      if (!optOn(o.id)) return;
      if (o.id === "version") out.push(o.sample);
      if (o.id === "spl") {
        out.push(`// source: ${a.id} · ${a.name}`);
        if (tiles.length > 1) out.push(`// ${tiles.length} panels — each carries its own source line`);
        if (lead.spl) out.push(`// ${tiles.length > 1 ? `panel ${lead.n}: ` : ""}${lead.spl}`);
      }
      if (o.id === "mappings") {
        /* Across every tile, not just the lead one — this option is the reason
           a wide dashboard's header is longer than its query, and showing one
           panel's dependencies would understate exactly the cost it warns
           about. */
        const seen = [];
        tiles.forEach((t) => {
          const d = t.deps || {};
          [["index", d.indexes], ["lookup", d.lookups], ["macro", d.macros]].forEach(([kind, list]) =>
            (list || []).forEach((x) => {
              const line = `${kind} ${x}`;
              if (seen.indexOf(line) === -1) seen.push(line);
            })
          );
        });
        out.push(seen.length ? `// reads: ${seen.join(" · ")}` : "// reads: nothing outside its own bucket");
      }
      if (o.id === "manual") {
        out.push(
          edited.length
            ? `// manually corrected · ${who} · ${String(whenEdited || "").slice(0, 10) || "pending"}`
            : `// awaiting correction · assigned to ${a.assignee || "nobody"}`
        );
      }
    });
    return out;
  }

  function headerPreview(a) {
    const lines = headerLines(a);
    if (!lines.length) return subdued("Nothing will be embedded. The published query will carry no trace of where it came from.");
    return el("pre", { class: "dma-exspl" }, lines.join("\n"));
  }

  function publishPanel() {
    const a = currentAsset();
    if (!a) {
      return card(
        {},
        emptyState(
          "upload",
          "No asset open",
          "Publishing is per asset on this stage. Open one from the queue first.",
          button("Back to the queue", { variant: "emphasized", onClick: () => DMA.store.setSession("exStep", "queue") })
        )
      );
    }

    const health = X().healthFor(a);
    const p = X().progressOf(a);
    const live = a.state === "published";

    return el(
      "div",
      { class: "dt-stack dt-gap-16" },
      assetHeader(a),

      live
        ? banner("success", `${a.id} is in the tenant as of ${when(a.publishedAt || new Date().toISOString())}.`, {
            title: "Published from this stage",
          })
        : health.ok
        ? banner("info", "Every check passed. This asset can go to the tenant ahead of its wave.", {
            title: "Pre-deploy health check — passed",
          })
        : banner("warning", health.summary, { title: "Pre-deploy health check — not clear" }),

      card(
        {
          title: "Pre-deploy health check",
          subtitle: "The same gate a wave runs, on one asset",
          actions: [badge(health.ok ? "Clear" : `${health.failed.length} blocking`, health.ok ? "success" : "critical")],
        },
        el(
          "div",
          { class: "dt-stack dt-gap-16" },
          healthBlock(health),
          note(
            "Exceptions publishes one asset; Deploy publishes waves. The single-asset path exists because a fix sitting in a queue is worth nothing — but it runs the gate rather than going around it, and the gate is allowed to stop it."
          )
        )
      ),

      health.blockedByWave && !live
        ? card(
            { title: "What happens instead", subtitle: `Wave ${a.wave} has not deployed` },
            el(
              "div",
              { class: "dt-stack dt-gap-12" },
              note(
                `The correction is done and it is not lost. Returning ${a.id} to its wave marks it resolved: Deploy picks it up with the rest of Wave ${a.wave}, and it reaches the tenant beside the assets it belongs with rather than on its own.`
              ),
              el(
                "div",
                { class: "dt-row dt-gap-8 dt-wrap" },
                button(`Return it to Wave ${a.wave}`, {
                  variant: "emphasized",
                  iconName: "check",
                  disabled: p.blocked > 0,
                  title: p.blocked > 0 ? `Not every ${noun(a, 1)} runs yet.` : "",
                  onClick: () => {
                    mutate(a.id, (o) => {
                      o.asset.state = "resolved";
                      o.asset.stateLocked = true;
                    });
                    DMA.store.setSession("exStep", "queue");
                  },
                }),
                subdued("Resolved, waiting on Deploy. Nothing further is needed here.")
              )
            )
          )
        : null,

      card(
        { title: "What gets embedded", subtitle: "Comments carried into every published query" },
        el(
          "div",
          { class: "dt-stack dt-gap-16" },
          el(
            "div",
            { class: "dt-stack dt-gap-8" },
            ...X().PUBLISH_OPTIONS.map((o) =>
              el(
                "label",
                { class: "dma-exopt" },
                el("input", {
                  type: "checkbox",
                  checked: optOn(o.id),
                  onChange: () => toggleOpt(o.id),
                }),
                el(
                  "div",
                  { class: "dt-stack dt-gap-2 dt-grow" },
                  el("span", { class: "dt-text-medium" }, o.label),
                  note(o.detail)
                )
              )
            )
          ),
          el("div", { class: "dt-stack dt-gap-6" }, el("span", { class: "dt-text-small dt-text-secondary" }, "Preview"), headerPreview(a))
        )
      ),

      card(
        { title: "Publish", subtitle: live ? "Already in the tenant" : `${p.validated} of ${p.total} ${noun(a, p.total)} validated` },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          el(
            "div",
            { class: "dt-row dt-gap-8 dt-wrap" },
            button(live ? "Published" : "Publish to the tenant", {
              variant: "emphasized",
              iconName: live ? "check" : "upload",
              disabled: live || !health.ok,
              onClick: () =>
                mutate(a.id, (o) => {
                  o.asset.state = "published";
                  o.asset.stateLocked = true;
                  o.asset.publishedAt = new Date().toISOString();
                }),
            }),
            button("Back to the workspace", {
              variant: "default",
              iconName: "chevronL",
              onClick: () => DMA.store.setSession("exStep", "workspace"),
            })
          ),
          note(
            a.layout === "tiles"
              ? "The dashboard publishes whole. A panel that does not run is not published as an empty panel — the asset waits."
              : "One query, one asset. The published version replaces whatever is in the tenant under the same name."
          )
        )
      )
    );
  }

  /* ========================================================================
     STEP 4 — RECORD
     ------------------------------------------------------------------------
     The PRD's metric is the delta between the auto-translated result and the
     manually corrected one. It is a number that needs its denominator said
     out loud, because most of this queue scored zero by construction.
     ====================================================================== */

  function recordPanel() {
    const q = queueState(waveId());
    const d = X().delta;
    const gain = d.manualMean - d.autoMean;

    return el(
      "div",
      { class: "dt-stack dt-gap-20" },

      kpiRow(
        kpi("Corrected", fmt.num(d.corrected), "Resolved or published across the estate", { iconName: "check", tone: "success" }),
        kpi("Auto-translated score", d.autoMean.toFixed(2), `${fmt.num(d.zeroScored)} of them scored 0 — no runnable DQL to score`, { iconName: "zap" }),
        kpi("After correction", d.manualMean.toFixed(2), `+${gain.toFixed(2)} on the corrected population`, { iconName: "users", tone: "success" }),
        kpi("Corrections captured", fmt.num(d.captured), "Individual edits written to the training set", { iconName: "database" })
      ),

      card(
        { title: "Reading the delta honestly", subtitle: "The PRD's metric, with its denominator" },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          note(
            `+${gain.toFixed(
              2
            )} looks like a model improvement and it is not. ${fmt.num(d.zeroScored)} of the ${fmt.num(d.corrected)} corrected assets scored zero because Translate produced no runnable DQL at all, and no runnable DQL is a score of zero rather than a bad score. The delta measures work a person did, and it is worth having for exactly that reason — it is the size of the manual bill, not the size of the model's mistake.`
          ),
          el(
            "div",
            { class: "dma-exscale" },
            el("div", { class: "dma-exscale__row" }, el("span", { class: "dt-text-small" }, "Auto"), progress(d.autoMean * 100, "critical"), el("span", { class: "dt-tnum dt-text-small" }, d.autoMean.toFixed(2))),
            el("div", { class: "dma-exscale__row" }, el("span", { class: "dt-text-small" }, "Corrected"), progress(d.manualMean * 100, "success"), el("span", { class: "dt-tnum dt-text-small" }, d.manualMean.toFixed(2)))
          ),
          note(
            `And the rate that sits above it: ${fmt.num(q.done)} of ${fmt.num(q.total)} cleared, ${fmt.pct(
              q.clearedRate,
              1
            )}. Divide by ${fmt.num(q.attempted)} instead and it reads ${fmt.pct(
              (q.done / q.attempted) * 100,
              1
            )} — the 46 with no automated path are in the queue and were never in a translation run, so both numbers are true and only one of them answers "how good is the automation".`
          )
        )
      ),

      card(
        { title: "What is in the queue", subtitle: "Type against origin — the five tabs are not Translate's three" },
        table(
          [
            { label: "Type", render: (r) => el("span", { class: "dt-text-medium" }, r.type) },
            ...X().STREAMS.map((s) => ({
              label: s.short,
              render: (r) => el("span", { class: "dt-tnum" }, r[s.id] ? fmt.num(r[s.id]) : "—"),
            })),
            { label: "Total", render: (r) => el("span", { class: "dt-tnum dt-text-semibold" }, fmt.num(r.total)) },
          ],
          X().TYPES.map((t) => {
            const row = { type: t };
            row.total = X().STREAMS.reduce((acc, s) => {
              row[s.id] = X().byType[s.id][t];
              return acc + row[s.id];
            }, 0);
            return row;
          })
        )
      ),

      card(
        { title: "Where every wave stands", subtitle: "Six states, four waves" },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          table(
            [
              { label: "Wave", render: (r) => el("span", { class: "dt-text-medium" }, `Wave ${r.wave}`) },
              ...X().STATE_ORDER.map((s) => ({
                label: X().STATES[s].label,
                render: (r) => el("span", { class: ["dt-tnum", r[s] ? null : "dt-text-subdued"] }, fmt.num(r[s])),
              })),
            ],
            X().statesByWave
          ),
          note(
            "Waves 3 and 4 have nothing published and that is not an omission — neither wave has deployed, so nothing from them can be live. A fix in those waves reaches Resolved and waits for Deploy, which is the gate on the previous step doing its job rather than a queue stalling."
          )
        )
      ),

      card(
        { title: "What the training set gets", subtitle: `${fmt.num(d.captured)} corrections, written as they were made` },
        el(
          "div",
          { class: "dt-stack dt-gap-12" },
          note(
            "Every round on this stage is captured with the context verbatim, the DQL before and after, and the outcome — including the rounds that failed. A correction that did not work is the more useful record of the two: it is the only evidence that a given gap is a capability problem rather than a vocabulary one."
          ),
          el(
            "div",
            { class: "dt-stack dt-gap-8" },
            ...Object.keys(X().OUTCOMES).map((k) => {
              const o = X().OUTCOMES[k];
              return el(
                "div",
                { class: "dma-exblocker", "data-tone": o.tone },
                el("div", { class: "dt-row dt-gap-8" }, icon(o.icon, 13), el("span", { class: "dt-text-semibold" }, o.label)),
                note(o.detail)
              );
            })
          ),
          note(
            "No AI diagnosis and no suggested fix anywhere on this stage. The person reads the finding, writes the context, and owns the result — the capture is a record of what they did, not a loop that closes itself."
          )
        )
      )
    );
  }

  const PANELS = {
    queue: queuePanel,
    workspace: workspacePanel,
    publish: publishPanel,
    record: recordPanel,
  };

  /* ======================================================================== */

  DMA.register({
    id: "exceptions",
    title: "Handle Manual Exceptions",
    shortTitle: "Exceptions",
    phase: "transform",
    icon: "alert",
    status: "ready",
    scope: "wave",
    summary:
      "The one stage where a person does the translation — read the asset, write the context, correct the DQL, prove it, publish it.",

    steps: STEPS,

    notes: [
      "298 in one queue from four inlets: 113 Translate blocked, 135 Validate triaged, 4 failed after going live, and 46 with no automated path at all. One worklist and not four, because the work is identical — what differs is the evidence each row arrived with.",
      "252 of the 298 had an automated attempt. The other 46 are lookups and macros out of the 371 prerequisites: they never entered a translation run, so they have no block reason and no confidence score. Keeping that split visible is what stops a correction rate being divided by the wrong denominator.",
      "Three of the four inlet counts are re-derived from Translate and Validate on every render rather than stored here, so this stage cannot quietly disagree with the stage that fed it.",
      "Two workspaces. A dashboard is worked tile by tile and publishes whole or not at all; an alert or a saved search is one query, and a one-item sidebar would be a frame around nothing.",
      "This stage publishes one asset; Deploy publishes waves. The single-asset publish runs the same pre-deploy health check a wave runs, and that check blocks it — Wave 3 and Wave 4 fixes reach Resolved and wait, because publishing one asset into a tenant without the assets beside it is a loose end, not a fix.",
      "One operator fixes and publishes — no second reviewer in this prototype. Needs review and Sent back are still real states because Send back is an action the same person can take: it hands the asset to its owner with a written comment and stops the clock.",
      "No AI diagnosis and no AI-suggested fix. The human reads the finding, writes the context, and owns the result. No similarity score and no diff either — that is P2, and it belongs to Validate.",
    ],

    render(root, ctx) {
      const wave = selectedWave();
      const q = queueState(waveId());

      root.append(
        // The shell renders the wave scope picker into this header and its
        // first option is All waves, so the "All waves" button that used to
        // sit here is gone rather than sitting next to its own replacement.
        // The "Look at all waves" call to action inside the not-reached empty
        // state stays — that one is the answer to a dead end, not chrome.
        ctx.pageHeader(
          [
            button("Export corrections", { variant: "default", iconName: "download" }),
            button(`Open queue ${fmt.num(q.open)}`, {
              variant: "emphasized",
              iconName: "flag",
              onClick: () => DMA.store.setSession("exStep", "queue"),
            }),
          ].filter(Boolean)
        ),
        el(
          "div",
          { class: "dma-exwave" },
          el("span", { class: "dt-text-semibold" }, wave ? `Wave ${wave.id} — ${wave.name}` : "All waves"),
          badge(`${fmt.num(q.open)} open`, q.open ? "warning" : "success", { iconName: "clock" }),
          subdued(
            `${fmt.num(q.total)} in the queue · ${fmt.num(q.attempted)} had an automated attempt · ${fmt.num(q.noPath)} never did`
          )
        ),
        stepper(),
        PANELS[step()]()
      );
    },
  });
})();
