/* ============================================================================
   DMA.ui — shared rendering primitives
   ----------------------------------------------------------------------------
   The ONLY things a module may depend on are DMA.ui, DMA.store, and DMA.data.
   Modules must never import or reference another module.
   ========================================================================== */

window.DMA = window.DMA || {};

DMA.ui = (function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* --- el(tag, props, ...children) -------------------------------------- */
  function el(tag, props, ...children) {
    const node = document.createElement(tag);

    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (value === null || value === undefined || value === false) continue;

        if (key === "class" || key === "className") {
          node.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : value;
        } else if (key === "style" && typeof value === "object") {
          Object.assign(node.style, value);
        } else if (key === "dataset" && typeof value === "object") {
          Object.assign(node.dataset, value);
        } else if (key.startsWith("on") && typeof value === "function") {
          node.addEventListener(key.slice(2).toLowerCase(), value);
        } else if (key === "text") {
          node.textContent = value;
        } else if (key === "html") {
          // Only ever called with prototype-authored markup, never user input.
          node.innerHTML = value;
        } else {
          node.setAttribute(key, value === true ? "" : String(value));
        }
      }
    }

    append(node, children);
    return node;
  }

  function append(node, children) {
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /* --- Icons ------------------------------------------------------------- */
  const ICONS = {
    overview:   ["M3 3h7v8H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 15h7v6H3z"],
    search:     ["M11 3a8 8 0 100 16 8 8 0 000-16zM21 21l-4.35-4.35"],
    server:     ["M4 3h16a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1zM4 14h16a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1v-5a1 1 0 011-1zM7 6.5h.01M7 17.5h.01"],
    download:   ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"],
    map:        ["M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4zM8 2v16M16 6v16"],
    layers:     ["M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"],
    zap:        ["M13 2L3 14h9l-1 8 10-12h-9l1-8z"],
    checkCircle:["M22 11.08V12a10 10 0 11-5.93-9.14M22 4L12 14.01l-3-3"],
    alert:      ["M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01"],
    upload:     ["M16 16l-4-4-4 4M12 12v9M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"],
    flag:       ["M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22V15"],
    check:      ["M20 6L9 17l-5-5"],
    x:          ["M18 6L6 18M6 6l12 12"],
    chevronR:   ["M9 18l6-6-6-6"],
    chevronL:   ["M15 18l-6-6 6-6"],
    chevronD:   ["M6 9l6 6 6-6"],
    chevronU:   ["M18 15l-6-6-6 6"],
    plus:       ["M12 5v14M5 12h14"],
    arrowRight: ["M5 12h14M12 5l7 7-7 7"],
    clock:      ["M12 2a10 10 0 100 20 10 10 0 000-20zM12 6v6l4 2"],
    info:       ["M12 2a10 10 0 100 20 10 10 0 000-20zM12 16v-4M12 8h.01"],
    database:   ["M12 2c4.97 0 9 1.34 9 3s-4.03 3-9 3-9-1.34-9-3 4.03-3 9-3zM21 12c0 1.66-4.03 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"],
    shield:     ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
    sliders:    ["M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"],
    sun:        ["M12 7a5 5 0 100 10 5 5 0 000-10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"],
    moon:       ["M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"],
    externalLink:["M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"],
    play:       ["M6 3l14 9-14 9V3z"],
    edit:       ["M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"],
    refresh:    ["M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"],
    fileText:   ["M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8"],
    users:      ["M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 3a4 4 0 100 8 4 4 0 000-8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"],
    lock:       ["M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2zM7 11V7a5 5 0 0110 0v4"],
    filter:     ["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"],
    link:       ["M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"],
    gitBranch:  ["M6 3v12M18 6a3 3 0 100 6 3 3 0 000-6zM6 21a3 3 0 100-6 3 3 0 000 6zM18 9a9 9 0 01-9 9"],
    helpCircle: ["M12 2a10 10 0 100 20 10 10 0 000-20zM9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"],
    archive:    ["M21 8v13H3V8M1 3h22v5H1zM10 12h4"],
    bell:       ["M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"],
    pause:      ["M6 4h4v16H6zM14 4h4v16h-4z"],
    eye:        ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 9a3 3 0 100 6 3 3 0 000-6z"],
    arrowLeft:  ["M19 12H5M12 19l-7-7 7-7"],
    save:       ["M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z", "M17 21v-8H7v8M7 3v5h8"],
  };

  function icon(name, size = 16, extraClass) {
    const paths = ICONS[name] || ICONS.info;
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", size);
    svg.setAttribute("height", size);
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    svg.style.flex = "none";
    if (extraClass) svg.setAttribute("class", extraClass);
    for (const d of paths) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return svg;
  }

  /* --- Component factories ---------------------------------------------- */
  function button(label, opts = {}) {
    const { variant = "default", size, iconName, iconAfter, onClick, disabled, title, block } = opts;
    return el(
      "button",
      {
        class: [
          "dt-btn",
          `dt-btn--${variant}`,
          size === "sm" ? "dt-btn--sm" : size === "lg" ? "dt-btn--lg" : null,
          block ? "dt-btn--block" : null,
          !label ? "dt-btn--icon" : null,
        ],
        onClick,
        disabled,
        title,
        "aria-label": !label && title ? title : null,
      },
      iconName && !iconAfter ? icon(iconName, size === "sm" ? 13 : 15) : null,
      label || null,
      iconName && iconAfter ? icon(iconName, size === "sm" ? 13 : 15) : null
    );
  }

  function badge(label, tone = "neutral", opts = {}) {
    return el(
      "span",
      { class: `dt-badge dt-badge--${tone}`, title: opts.title },
      opts.dot ? el("span", { class: "dt-badge__dot" }) : null,
      opts.iconName ? icon(opts.iconName, 11) : null,
      label
    );
  }

  function card(opts = {}, ...children) {
    const { title, subtitle, actions, flush, footer } = opts;
    return el(
      "section",
      { class: "dt-card", "aria-label": title },
      title
        ? el(
            "header",
            { class: "dt-card__header" },
            el(
              "div",
              { class: "dt-stack dt-grow" },
              el("div", { class: "dt-card__title" }, title),
              subtitle ? el("div", { class: "dt-text-small dt-text-secondary" }, subtitle) : null
            ),
            actions ? el("div", { class: "dt-row dt-gap-8" }, actions) : null
          )
        : null,
      el("div", { class: ["dt-card__body", flush ? "dt-card__body--flush" : null] }, ...children),
      footer ? el("div", { class: "dt-card__footer" }, footer) : null
    );
  }

  function field(label, control, hint) {
    return el(
      "label",
      { class: "dt-field" },
      el("span", { class: "dt-field__label" }, label),
      control,
      hint ? el("span", { class: "dt-field__hint" }, hint) : null
    );
  }

  function progress(value, tone) {
    return el(
      "div",
      { class: "dt-progress", role: "progressbar", "aria-valuenow": Math.round(value), "aria-valuemin": 0, "aria-valuemax": 100 },
      el("div", {
        class: ["dt-progress__fill", tone ? `dt-progress__fill--${tone}` : null],
        style: { width: `${Math.max(0, Math.min(100, value))}%` },
      })
    );
  }

  function stackedProgress(segments) {
    return el(
      "div",
      { class: "dt-progress dt-progress--stacked" },
      segments
        .filter((s) => s.value > 0)
        .map((s) =>
          el("div", {
            class: ["dt-progress__fill", s.tone ? `dt-progress__fill--${s.tone}` : null],
            style: { width: `${s.value}%` },
            title: s.label ? `${s.label}: ${s.value.toFixed(1)}%` : null,
          })
        )
    );
  }

  function banner(tone, message, opts = {}) {
    const iconMap = { info: "info", success: "checkCircle", warning: "alert", critical: "alert" };
    return el(
      "div",
      { class: `dt-banner dt-banner--${tone}`, role: tone === "critical" ? "alert" : "status" },
      icon(iconMap[tone] || "info", 16),
      el(
        "div",
        { class: "dt-stack dt-gap-4 dt-grow dt-banner__body" },
        opts.title ? el("div", { class: "dt-text-semibold" }, opts.title) : null,
        el("div", {}, message)
      ),
      opts.action || null
    );
  }

  function emptyState(iconName, title, description, action) {
    return el(
      "div",
      { class: "dt-empty" },
      icon(iconName, 32, "dt-empty__icon"),
      el("div", { class: "dt-text-semibold" }, title),
      description ? el("div", { class: "dt-text-small dt-text-secondary", style: { maxWidth: "44ch" } }, description) : null,
      action || null
    );
  }

  /* A row click must not fire when the click landed on a control inside the
     row. Without this guard a table cannot have both a row-level detail view
     and per-row action buttons: pressing "Override" would open the override
     modal AND the row's detail modal, stacked. The row handler is the fallback
     for the inert parts of the row, so anything interactive wins. */
  const INTERACTIVE = "button, a, select, input, textarea, label, [role=button]";

  function table(columns, rows, opts = {}) {
    const rowClick = opts.onRowClick
      ? (row) => (e) => {
          if (e.target.closest && e.target.closest(INTERACTIVE)) return;
          opts.onRowClick(row);
        }
      : null;

    return el(
      "div",
      { style: { overflowX: "auto" } },
      el(
        "table",
        { class: ["dt-table", opts.onRowClick ? "dt-table--clickable" : null] },
        el("thead", {}, el("tr", {}, columns.map((c) => el("th", { style: c.width ? { width: c.width } : null }, c.label)))),
        el(
          "tbody",
          {},
          rows.map((row) =>
            el(
              "tr",
              {
                onClick: rowClick ? rowClick(row) : null,
                tabindex: opts.onRowClick ? 0 : null,
              },
              columns.map((c) => el("td", {}, c.render(row)))
            )
          )
        )
      )
    );
  }

  function tooltip(child, text) {
    return el("span", { class: "dt-tip", tabindex: 0 }, child, el("span", { class: "dt-tip__content", role: "tooltip" }, text));
  }

  function modal(titleText, body, footerNodes, opts = {}) {
    const close = () => scrim.remove();
    const scrim = el(
      "div",
      {
        class: "dt-modal-scrim",
        onClick: (e) => { if (e.target === scrim) close(); },
      },
      el(
        "div",
        { class: ["dt-modal", opts.wide ? "dt-modal--wide" : null], role: "dialog", "aria-modal": "true", "aria-label": titleText },
        el(
          "header",
          { class: "dt-card__header" },
          el("div", { class: "dt-card__title dt-grow" }, titleText),
          button("", { variant: "subtle", iconName: "x", title: "Close", onClick: close })
        ),
        el("div", { class: "dt-card__body" }, body),
        footerNodes ? el("div", { class: "dt-card__footer dt-row dt-gap-8", style: { justifyContent: "flex-end" } }, footerNodes) : null
      )
    );
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
    document.body.append(scrim);
    return { close };
  }

  /* --- Roadmap tier chip (prototype affordance, not product UI) ---------- */
  function tierChip(tier) {
    if (!tier) return null;
    const label = tier === "live" ? "Live today" : tier.toUpperCase();
    return el("span", {
      class: "dma-tier",
      dataset: { tier },
      text: label,
      title: tier === "live" ? "Already shipped in the live DMA platform" : `Roadmap tier ${tier.toUpperCase()}`,
    });
  }

  /* --- Formatting -------------------------------------------------------- */
  const fmt = {
    num: (n) => Number(n).toLocaleString("en-US"),
    pct: (n, digits = 0) => `${Number(n).toFixed(digits)}%`,
    hours: (n) => `${Number(n).toLocaleString("en-US")} hrs`,
    date: (iso) =>
      new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    dateShort: (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    duration: (mins) => {
      if (mins < 60) return `${Math.round(mins)}m`;
      const h = Math.floor(mins / 60);
      const m = Math.round(mins % 60);
      return m ? `${h}h ${m}m` : `${h}h`;
    },
  };

  return {
    el, append, clear, icon, button, badge, card, field, progress, stackedProgress,
    banner, emptyState, table, tooltip, modal, tierChip, fmt,
  };
})();
