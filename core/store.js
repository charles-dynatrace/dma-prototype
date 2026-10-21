/* ============================================================================
   DMA.store — app state + module registry
   ----------------------------------------------------------------------------
   Deliberately tiny. State lives here so that module files stay pure render
   functions and can be rewritten independently without touching each other.
   ========================================================================== */

window.DMA = window.DMA || {};

DMA.store = (function () {
  "use strict";

  const KEY = "dma-prototype-prefs";
  const listeners = new Set();

  const defaults = {
    theme: "light",
    tierOverlay: false,
  };

  let prefs = { ...defaults };
  try {
    Object.assign(prefs, JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch (_) {
    /* first run or private mode — fall back to defaults */
  }

  /* Transient, in-session state. Reset on reload so demos always start clean. */
  const session = {};

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch (_) {
      /* storage unavailable — prefs simply don't survive reload */
    }
  }

  function emit() {
    listeners.forEach((fn) => fn(prefs));
  }

  return {
    get prefs() { return prefs; },
    get session() { return session; },

    set(key, value) {
      prefs[key] = value;
      persist();
      emit();
    },

    toggle(key) {
      this.set(key, !prefs[key]);
    },

    /* Session state re-renders but never persists, so a reload resets the demo. */
    setSession(key, value) {
      session[key] = value;
      emit();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();

/* ============================================================================
   Module registry
   ----------------------------------------------------------------------------
   Every module self-registers here. This is the ONLY coupling point between
   a module and the rest of the app — which is what lets us rebuild any single
   module without touching another.

   Module contract:
     DMA.register({
       id:      'import',                 // URL hash segment, unique
       title:   'Import',                 // sidebar + rail label
       phase:   'Extract',                // flow-diagram phase grouping
       icon:    'download',               // DMA.ui icon key
       summary: 'one-line description',
       status:  'ready' | 'stub',         // stub => placeholder screen
       scope:   'estate'|'wave'|'sample', // what this stage operates on
       render(root, ctx) { ... }          // paint into root; return nothing
     })

   `scope` is what keeps the stage rail from duplicating the sidebar. The
   sidebar answers "where can I go"; the rail answers "what is this stage
   working on, and where has that work got to":

     estate  — the whole asset inventory. One pass, no parallelism.
     sample  — the calibration sample only. Calibrate alone.
     wave    — a single delivery wave. The rail turns into a wave selector,
               because from here on waves advance independently.

   The first `wave`-scoped module in registration order is the fan-out point:
   everything before it is one linear track, everything after runs six times
   over. The rail derives that boundary rather than hard-coding a stage id.
   ========================================================================== */
DMA.modules = [];

DMA.register = function (def) {
  if (DMA.modules.some((m) => m.id === def.id)) {
    console.warn(`[DMA] duplicate module id "${def.id}" ignored`);
    return;
  }
  DMA.modules.push(def);
};

DMA.getModule = function (id) {
  return DMA.modules.find((m) => m.id === id);
};

/* Flow-diagram phases, in order. Drives sidebar grouping and the stage rail. */
DMA.PHASES = [
  { id: "setup",     label: "Setup Project" },
  { id: "extract",   label: "Extract" },
  { id: "transform", label: "Transform" },
  { id: "load",      label: "Load" },
  { id: "close",     label: "Govern & Close" },
];
