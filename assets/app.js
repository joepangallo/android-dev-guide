/* ==========================================================================
   COP4667 Android Development — Teaching Guide Interactivity (app.js)
   --------------------------------------------------------------------------
   Vanilla JS, no dependencies. Auto-inits on DOMContentLoaded.
   Exposes window.TG with all public helpers.

   Features:
     1.  Copy buttons for .codeblock
     2.  Tabs (.tabs / [data-tab] / [data-tabpanel])
     3.  Accordion (.accordion__head -> .is-open with animated height)
     4.  Persistent checklists + progressbar sync ([data-persist] / .checklist)
     5.  Countdown timers ([data-timer="MM:SS"]) with Start/Pause/Reset + alert
     6.  Present mode ([data-present] over .slide sections)
     7.  Instructor-only toggle ([data-toggle-instructor]) — persisted
     8.  Theme toggle ([data-toggle-theme]) — persisted
     9.  Quiz engine  TG.quiz(mount, data|scriptId) + [data-quiz]
     10. Flashcards   TG.flashcards(mount, cards|scriptId) + [data-flashcards]
     11. Smooth-scroll anchors + optional [data-toc] section index
   ========================================================================== */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------- *
   *  Small utilities
   * ---------------------------------------------------------------------- */
  var TG = {};
  var STORAGE_PREFIX = "tg:cop4667:";

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        if (k === "class") node.className = props[k];
        else if (k === "html") node.innerHTML = props[k];
        else if (k === "text") node.textContent = props[k];
        else if (k === "on" && typeof props[k] === "object") {
          Object.keys(props[k]).forEach(function (evt) { node.addEventListener(evt, props[k][evt]); });
        } else if (k.indexOf("data-") === 0 || k.indexOf("aria-") === 0 || k === "role" || k === "type" || k === "href") {
          node.setAttribute(k, props[k]);
        } else {
          node[k] = props[k];
        }
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  // localStorage with graceful failure (file:// in some browsers blocks it)
  var store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem(STORAGE_PREFIX + key);
        return v === null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, val) {
      try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(val)); } catch (e) {}
    },
    remove: function (key) {
      try { localStorage.removeItem(STORAGE_PREFIX + key); } catch (e) {}
    }
  };

  // Monotonic id generator for ARIA wiring (only used when an element lacks an id)
  var _uidSeq = 0;
  function uid(prefix) { return (prefix || "tg") + "-" + (++_uidSeq); }
  function ensureId(node, prefix) {
    if (node && !node.id) node.id = uid(prefix);
    return node ? node.id : "";
  }

  // Stable slug from a string (for storage keys)
  function slug(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }
  function pageKey() { return slug(document.title || location.pathname || "page"); }

  // Fisher–Yates shuffle (returns a new array)
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------------------------------------------------------------------- *
   *  1. COPY BUTTONS
   * ---------------------------------------------------------------------- */
  function initCopyButtons(root) {
    $all(".codeblock", root).forEach(function (block) {
      if (block.querySelector(".codeblock__copy")) return; // already done
      var code = block.querySelector("code") || block.querySelector("pre");
      if (!code) return;

      var btn = el("button", {
        "class": "codeblock__copy",
        type: "button",
        "aria-label": "Copy code to clipboard",
        text: "Copy"
      });

      btn.addEventListener("click", function () {
        var text = code.innerText;
        copyText(text).then(function () {
          flashCopied(btn);
        }, function () {
          // fallback already attempted inside copyText
          flashCopied(btn);
        });
      });

      block.appendChild(btn);
    });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      try {
        var ta = el("textarea", { value: text });
        ta.style.position = "fixed"; ta.style.top = "-1000px";
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject();
      } catch (e) { reject(e); }
    });
  }
  function flashCopied(btn) {
    btn.textContent = "Copied";
    btn.classList.add("is-copied");
    clearTimeout(btn._copyTimer);
    btn._copyTimer = setTimeout(function () {
      btn.textContent = "Copy";
      btn.classList.remove("is-copied");
    }, 1600);
  }

  /* ---------------------------------------------------------------------- *
   *  2. TABS
   *  Structure:
   *    <div class="tabs">
   *      <button class="tab" data-tab="a">A</button> ...
   *    </div>
   *    <div class="tabpanel" data-tabpanel="a">...</div> ...
   *  Panels are matched within the nearest common parent of the .tabs group.
   * ---------------------------------------------------------------------- */
  function initTabs(root) {
    $all(".tabs", root).forEach(function (group) {
      if (group._tgInit) return; group._tgInit = true;

      var buttons = $all(".tab", group);
      if (!buttons.length) return;

      // Panel scope = parent that holds both tabs and panels
      var scope = group.parentElement || document;
      group.setAttribute("role", "tablist");

      function panelFor(key) {
        return scope.querySelector('[data-tabpanel="' + cssEscape(key) + '"]');
      }

      // ARIA linkage (additive — does NOT touch the data-tab/data-tabpanel contract):
      // give each tab+panel an id and cross-reference them so screen readers
      // announce the association (aria-controls / aria-labelledby).
      buttons.forEach(function (b) {
        b.setAttribute("role", "tab");
        var panel = panelFor(b.getAttribute("data-tab"));
        if (!panel) return;
        var tabId = ensureId(b, "tg-tab");
        var panelId = ensureId(panel, "tg-tabpanel");
        b.setAttribute("aria-controls", panelId);
        panel.setAttribute("role", "tabpanel");
        if (!panel.hasAttribute("aria-labelledby")) panel.setAttribute("aria-labelledby", tabId);
      });

      function activate(key) {
        buttons.forEach(function (b) {
          var on = b.getAttribute("data-tab") === key;
          b.setAttribute("aria-selected", on ? "true" : "false");
          b.setAttribute("role", "tab");
          b.tabIndex = on ? 0 : -1;
        });
        $all("[data-tabpanel]", scope).forEach(function (p) {
          // only toggle panels that belong to this tab group's keys
          if (buttons.some(function (b) { return b.getAttribute("data-tab") === p.getAttribute("data-tabpanel"); })) {
            var on = p.getAttribute("data-tabpanel") === key;
            p.hidden = !on;
            p.setAttribute("role", "tabpanel");
          }
        });
      }

      buttons.forEach(function (b, i) {
        b.addEventListener("click", function () { activate(b.getAttribute("data-tab")); });
        b.addEventListener("keydown", function (e) {
          var idx = i;
          if (e.key === "ArrowRight" || e.key === "ArrowDown") { idx = (i + 1) % buttons.length; }
          else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { idx = (i - 1 + buttons.length) % buttons.length; }
          else if (e.key === "Home") { idx = 0; }
          else if (e.key === "End") { idx = buttons.length - 1; }
          else return;
          e.preventDefault();
          buttons[idx].focus();
          activate(buttons[idx].getAttribute("data-tab"));
        });
      });

      // initial: first button marked active, else first
      var initial = buttons.filter(function (b) { return b.getAttribute("aria-selected") === "true" || b.classList.contains("active"); })[0] || buttons[0];
      activate(initial.getAttribute("data-tab"));
    });
  }

  // minimal CSS.escape polyfill for attribute selectors
  function cssEscape(s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  /* ---------------------------------------------------------------------- *
   *  3. ACCORDION
   * ---------------------------------------------------------------------- */
  function initAccordion(root) {
    $all(".accordion", root).forEach(function (acc) {
      if (acc._tgInit) return; acc._tgInit = true;

      $all(".accordion__item", acc).forEach(function (item) {
        var head = item.querySelector(".accordion__head");
        var body = item.querySelector(".accordion__body");
        if (!head || !body) return;

        // wrap inner content so we can animate height precisely
        if (!body.querySelector(".accordion__body-inner")) {
          var inner = el("div", { "class": "accordion__body-inner" });
          while (body.firstChild) inner.appendChild(body.firstChild);
          body.appendChild(inner);
        }

        // a11y wiring
        if (head.tagName !== "BUTTON") head.setAttribute("role", "button");
        head.setAttribute("aria-expanded", item.classList.contains("is-open") ? "true" : "false");
        head.tabIndex = head.tabIndex || 0;

        // associate the head with the region it controls (additive)
        var headId = ensureId(head, "tg-acc-head");
        var bodyId = ensureId(body, "tg-acc-body");
        head.setAttribute("aria-controls", bodyId);
        if (!body.hasAttribute("role")) body.setAttribute("role", "region");
        if (!body.hasAttribute("aria-labelledby")) body.setAttribute("aria-labelledby", headId);

        function setOpen(open) {
          item.classList.toggle("is-open", open);
          head.setAttribute("aria-expanded", open ? "true" : "false");
          var inner = body.querySelector(".accordion__body-inner");
          if (open) {
            body.style.height = inner.offsetHeight + "px";
            // after transition, allow natural growth
            clearTimeout(body._t);
            body._t = setTimeout(function () { if (item.classList.contains("is-open")) body.style.height = "auto"; }, 300);
          } else {
            body.style.height = inner.offsetHeight + "px"; // set explicit before collapsing
            void body.offsetHeight; // reflow
            body.style.height = "0px";
          }
        }

        // initialize collapsed/open height
        if (item.classList.contains("is-open")) { body.style.height = "auto"; }
        else { body.style.height = "0px"; }

        function toggle() { setOpen(!item.classList.contains("is-open")); }

        head.addEventListener("click", toggle);
        if (head.tagName !== "BUTTON") {
          head.addEventListener("keydown", function (e) {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
          });
        }
      });
    });
  }

  /* ---------------------------------------------------------------------- *
   *  4. PERSISTENT CHECKLISTS + PROGRESSBAR SYNC
   *  - Any .checklist or [data-persist] container.
   *  - Each checkbox gets a stable key (its [data-key] || index).
   *  - Storage key = page + container id/index.
   *  - If a [data-progress-for="ID"] progressbar exists and the container
   *    has id="ID", the bar updates with checked/total.
   * ---------------------------------------------------------------------- */
  function initChecklists(root) {
    var containers = $all(".checklist, [data-persist]", root).filter(function (c, i, arr) {
      return arr.indexOf(c) === i; // dedupe
    });

    containers.forEach(function (container, cIdx) {
      if (container._tgInit) return; container._tgInit = true;

      var boxes = $all('input[type="checkbox"]', container);
      if (!boxes.length) return;

      var containerId = container.id || ("checklist-" + cIdx);
      var storeKey = "check:" + pageKey() + ":" + containerId;
      var saved = store.get(storeKey, {});

      function itemKey(box, i) { return box.getAttribute("data-key") || box.id || ("i" + i); }

      function progressBar() {
        if (!container.id) return null;
        return document.querySelector('[data-progress-for="' + cssEscape(container.id) + '"]');
      }

      function syncProgress() {
        var total = boxes.length;
        var done = boxes.filter(function (b) { return b.checked; }).length;
        var pct = total ? Math.round((done / total) * 100) : 0;
        var bar = progressBar();
        if (bar) {
          var fill = bar.querySelector(".progressbar__fill") || bar;
          fill.style.width = pct + "%";
          bar.setAttribute("data-label", done + "/" + total);
          bar.setAttribute("role", "progressbar");
          bar.setAttribute("aria-valuenow", String(pct));
          bar.setAttribute("aria-valuemin", "0");
          bar.setAttribute("aria-valuemax", "100");
        }
      }

      function persist() {
        var state = {};
        boxes.forEach(function (b, i) { state[itemKey(b, i)] = b.checked; });
        store.set(storeKey, state);
        syncProgress();
      }

      // restore
      boxes.forEach(function (b, i) {
        var k = itemKey(b, i);
        if (Object.prototype.hasOwnProperty.call(saved, k)) b.checked = !!saved[k];
        b.addEventListener("change", persist);
      });
      syncProgress();

      // reset affordance (one per container) unless data-no-reset is set
      if (container.getAttribute("data-no-reset") === null && !container.querySelector(".checklist-reset")) {
        var reset = el("button", {
          "class": "checklist-reset no-print",
          type: "button",
          text: "↺ Reset checklist"
        });
        reset.addEventListener("click", function () {
          boxes.forEach(function (b) { b.checked = false; });
          store.remove(storeKey);
          syncProgress();
        });
        container.insertAdjacentElement("afterend", reset);
      }
    });
  }

  /* ---------------------------------------------------------------------- *
   *  5. COUNTDOWN TIMERS
   *  <div data-timer="05:00" data-label="Lab time"></div>
   *  Renders display + Start/Pause/Reset. Alerts (color + pulse) at 0.
   * ---------------------------------------------------------------------- */
  function parseTime(str) {
    var parts = String(str || "0:00").split(":").map(function (n) { return parseInt(n, 10) || 0; });
    if (parts.length === 1) return parts[0];                 // SS
    if (parts.length === 2) return parts[0] * 60 + parts[1]; // MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];       // HH:MM:SS
  }
  function fmtTime(total) {
    total = Math.max(0, Math.floor(total));
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return (h > 0 ? pad(h) + ":" : "") + pad(m) + ":" + pad(s);
  }

  function initTimers(root) {
    $all("[data-timer]", root).forEach(function (host) {
      if (host._tgInit) return; host._tgInit = true;
      host.classList.add("timer");

      var initial = parseTime(host.getAttribute("data-timer"));
      var label = host.getAttribute("data-label") || "Timer";
      var remaining = initial;
      var ticking = null;

      var display = el("div", { "class": "timer__display", text: fmtTime(remaining), "aria-live": "polite", role: "timer" });
      var startBtn = el("button", { "class": "timer__btn timer__btn--start", type: "button", text: "Start" });
      var pauseBtn = el("button", { "class": "timer__btn", type: "button", text: "Pause" });
      var resetBtn = el("button", { "class": "timer__btn", type: "button", text: "Reset" });

      host.innerHTML = "";
      host.appendChild(el("div", { "class": "timer__label", text: label }));
      host.appendChild(display);
      host.appendChild(el("div", { "class": "timer__controls" }, [startBtn, pauseBtn, resetBtn]));

      function render() {
        display.textContent = fmtTime(remaining);
        host.classList.toggle("is-warning", remaining > 0 && remaining <= 30 && ticking);
      }
      function stop() {
        clearInterval(ticking); ticking = null;
        host.classList.remove("is-running");
      }
      function start() {
        if (ticking || remaining <= 0) return;
        host.classList.add("is-running");
        host.classList.remove("is-done");
        ticking = setInterval(function () {
          remaining--;
          render();
          if (remaining <= 0) {
            stop();
            host.classList.remove("is-warning");
            host.classList.add("is-done");
            beep();
          }
        }, 1000);
      }
      function pause() { stop(); }
      function reset() {
        stop();
        remaining = initial;
        host.classList.remove("is-done", "is-warning");
        render();
      }

      startBtn.addEventListener("click", start);
      pauseBtn.addEventListener("click", pause);
      resetBtn.addEventListener("click", reset);
      render();
    });
  }

  // tiny WebAudio chime at 0 (best-effort, silent if unsupported/blocked)
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      o.start(); o.stop(ctx.currentTime + 0.55);
      setTimeout(function () { try { ctx.close(); } catch (e) {} }, 800);
    } catch (e) {}
  }

  /* ---------------------------------------------------------------------- *
   *  6. PRESENT MODE
   *  Stepping through sections marked .slide. Esc exits.
   * ---------------------------------------------------------------------- */
  var presentState = null;

  function initPresent(root) {
    $all("[data-present]", root).forEach(function (btn) {
      if (btn._tgInit) return; btn._tgInit = true;
      btn.addEventListener("click", function () { TG.present(); });
    });
  }

  TG.present = function () {
    var slides = $all(".slide");
    if (!slides.length) {
      alert("No .slide sections found on this page.");
      return;
    }
    if (presentState) return; // already open

    var idx = 0;
    var lastFocused = document.activeElement; // restore focus here on exit
    var overlay = el("div", { "class": "tg-present", role: "dialog", "aria-modal": "true", "aria-label": "Presentation mode" });
    var stage = el("div", { "class": "tg-present__stage" });
    var counter = el("div", { "class": "tg-present__counter" });
    var titleEl = el("div", { "class": "tg-present__title" });
    var prevBtn = el("button", { "class": "btn btn--ghost", type: "button", text: "‹ Prev" });
    var nextBtn = el("button", { "class": "btn", type: "button", text: "Next ›" });
    var exitBtn = el("button", { "class": "btn btn--ghost", type: "button", text: "Esc ✕" });

    var bar = el("div", { "class": "tg-present__bar" }, [titleEl, prevBtn, counter, nextBtn, exitBtn]);
    overlay.appendChild(stage);
    overlay.appendChild(bar);

    function showSlide(i) {
      idx = Math.max(0, Math.min(slides.length - 1, i));
      stage.innerHTML = "";
      var clone = slides[idx].cloneNode(true);
      // strip ids in clone to avoid duplicate ids in DOM
      $all("[id]", clone).forEach(function (n) { n.removeAttribute("id"); });
      clone.classList.add("tg-present__slide");
      stage.appendChild(clone);
      counter.textContent = (idx + 1) + " / " + slides.length;
      var heading = slides[idx].querySelector("h1,h2,h3");
      titleEl.textContent = heading ? heading.textContent : "";
      prevBtn.disabled = idx === 0;
      nextBtn.disabled = idx === slides.length - 1;
      stage.scrollTop = 0;
    }

    function next() { if (idx < slides.length - 1) showSlide(idx + 1); }
    function prev() { if (idx > 0) showSlide(idx - 1); }

    // Focusable controls live in the bottom bar; trap Tab within the overlay.
    function focusables() {
      return $all('button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])', overlay)
        .filter(function (n) { return n.offsetParent !== null || n === document.activeElement; });
    }
    function trapTab(e) {
      var f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      var first = f[0], last = f[f.length - 1];
      var active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !overlay.contains(active)) { e.preventDefault(); last.focus(); }
      } else {
        if (active === last || !overlay.contains(active)) { e.preventDefault(); first.focus(); }
      }
    }

    function onKey(e) {
      if (e.key === "Tab") { trapTab(e); return; }
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
      else if (e.key === "Escape") { exit(); }
      else if (e.key === "Home") { showSlide(0); }
      else if (e.key === "End") { showSlide(slides.length - 1); }
    }

    function exit() {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("tg-present-active");
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      presentState = null;
      if (document.fullscreenElement && document.exitFullscreen) { document.exitFullscreen().catch(function () {}); }
      // restore focus to the control that opened present mode
      if (lastFocused && typeof lastFocused.focus === "function") {
        try { lastFocused.focus(); } catch (e) {}
      }
    }

    nextBtn.addEventListener("click", next);
    prevBtn.addEventListener("click", prev);
    exitBtn.addEventListener("click", exit);
    document.addEventListener("keydown", onKey);

    document.documentElement.classList.add("tg-present-active");
    document.body.appendChild(overlay);
    if (overlay.requestFullscreen) { overlay.requestFullscreen().catch(function () {}); }
    presentState = { exit: exit };
    showSlide(0);
    // move focus into the dialog so keyboard/AT users start inside the overlay
    var openFocus = !nextBtn.disabled ? nextBtn : exitBtn;
    try { openFocus.focus(); } catch (e) {}
  };

  /* ---------------------------------------------------------------------- *
   *  7. INSTRUCTOR TOGGLE  (persisted; visible by default)
   * ---------------------------------------------------------------------- */
  function applyInstructor(visible) {
    document.documentElement.classList.toggle("tg-instructor-hidden", !visible);
    $all("[data-toggle-instructor]").forEach(function (b) {
      b.setAttribute("aria-pressed", visible ? "true" : "false");
      var lbl = b.querySelector(".tg-toggle-label");
      var txt = visible ? "Instructor: On" : "Instructor: Off";
      if (lbl) lbl.textContent = txt; else b.textContent = (b.getAttribute("data-icon") || "👩‍🏫") + " " + txt;
    });
  }
  TG.setInstructor = function (visible) {
    store.set("instructor:" + pageKey(), !!visible);
    applyInstructor(!!visible);
  };
  function initInstructorToggle(root) {
    var visible = store.get("instructor:" + pageKey(), true); // default visible
    applyInstructor(visible);
    $all("[data-toggle-instructor]", root).forEach(function (btn) {
      if (btn._tgInit) return; btn._tgInit = true;
      btn.addEventListener("click", function () {
        var cur = !document.documentElement.classList.contains("tg-instructor-hidden");
        TG.setInstructor(!cur);
      });
    });
  }

  /* ---------------------------------------------------------------------- *
   *  8. THEME TOGGLE  (persisted)
   * ---------------------------------------------------------------------- */
  function applyTheme(theme) {
    if (theme === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    $all("[data-toggle-theme]").forEach(function (b) {
      b.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
      var lbl = b.querySelector(".tg-toggle-label");
      var txt = theme === "dark" ? "🌙 Dark" : "☀️ Light";
      if (lbl) lbl.textContent = txt; else b.textContent = txt;
    });
  }
  TG.setTheme = function (theme) {
    store.set("theme", theme);
    applyTheme(theme);
  };
  function initThemeToggle(root) {
    var theme = store.get("theme", null);
    if (theme === null && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      theme = "dark";
    }
    applyTheme(theme || "light");
    $all("[data-toggle-theme]", root).forEach(function (btn) {
      if (btn._tgInit) return; btn._tgInit = true;
      btn.addEventListener("click", function () {
        var cur = document.documentElement.getAttribute("data-theme") === "dark";
        TG.setTheme(cur ? "light" : "dark");
      });
    });
  }

  /* ---------------------------------------------------------------------- *
   *  9. QUIZ ENGINE
   *  TG.quiz(mountSelector|element, dataObject|scriptElementId)
   *  Schema:
   *  { title, intro?, passingScore (0..1, default .7), shuffle?, topic?,
   *    questions:[ { id, type:"single"|"multi"|"truefalse"|"short",
   *      prompt, options?:[{id,text}],
   *      correct: ([ids] | boolean | "string"|[strings]),
   *      explanation, points? } ] }
   *
   *  RETRIEVAL PRACTICE -> MASTERY: on submit, grade() records the result as a
   *  retrieval-practice signal in the student's personal mastery. The topic is
   *  read from a `data-topic` attribute on the quiz mount element (preferred)
   *  or from `topic` in the quiz JSON. grade() dispatches a `tg:quiz`
   *  CustomEvent and calls window.MASTERY.progress.recordQuiz(topic, correct,
   *  total) when the mastery engine is present. No topic => grades locally only.
   * ---------------------------------------------------------------------- */
  function resolveData(source) {
    if (!source) return null;
    if (typeof source === "object") return source;
    // treat as script element id
    var node = document.getElementById(String(source));
    if (!node) return null;
    try { return JSON.parse(node.textContent); } catch (e) {
      console.error("TG: could not parse quiz/flashcard JSON in #" + source, e);
      return null;
    }
  }
  function resolveMount(mount) {
    return typeof mount === "string" ? $(mount) : mount;
  }

  TG.quiz = function (mount, source) {
    var host = resolveMount(mount);
    var data = resolveData(source);
    if (!host || !data || !data.questions) return null;

    host.classList.add("quiz");
    host.setAttribute("aria-label", data.title || "Quiz");
    var passing = typeof data.passingScore === "number" ? data.passingScore : 0.7;

    var questions = data.shuffle ? shuffle(data.questions) : data.questions.slice();

    // Remembers this quiz instance's last recorded retrieval-practice contribution
    // so a Retry REPLACES (not double-counts) the mastery signal. recordQuiz only
    // accumulates seen/right, so on a re-grade we record the DELTA against the prior
    // attempt — the net effect equals only the latest attempt's hit rate.
    var lastSignal = null; // { correct, total }

    function render() {
      host.innerHTML = "";
      if (data.title) host.appendChild(el("h3", { "class": "quiz__title", text: data.title }));
      if (data.intro) host.appendChild(el("p", { "class": "quiz__intro", text: data.intro }));

      var form = el("form", { "class": "quiz__form" });
      form.addEventListener("submit", function (e) { e.preventDefault(); grade(); });

      questions.forEach(function (q, qi) {
        var qBox = el("fieldset", { "class": "quiz__q quiz__" + (q.type || "single") });
        qBox.dataset.qid = q.id || ("q" + qi);
        var legend = el("legend", { "class": "quiz__q-prompt" }, [
          el("span", { "class": "quiz__num", text: String(qi + 1) }),
          el("span", { text: q.prompt })
        ]);
        qBox.appendChild(legend);

        var name = "q_" + (q.id || qi);

        if (q.type === "short") {
          var input = el("div", { "class": "quiz__short" }, [
            el("input", { type: "text", name: name, "aria-label": "Your answer", autocomplete: "off" })
          ]);
          qBox.appendChild(input);
        } else if (q.type === "truefalse") {
          var tfList = el("div", { "class": "quiz__options" });
          [["true", "True"], ["false", "False"]].forEach(function (pair) {
            tfList.appendChild(optionRow("radio", name, pair[0], pair[1]));
          });
          qBox.appendChild(tfList);
        } else {
          // single or multi
          var inputType = q.type === "multi" ? "checkbox" : "radio";
          var list = el("div", { "class": "quiz__options" });
          (q.options || []).forEach(function (opt) {
            list.appendChild(optionRow(inputType, name, opt.id, opt.text));
          });
          qBox.appendChild(list);
        }

        // placeholder for explanation/verdict (filled after grading)
        qBox.appendChild(el("div", { "class": "quiz__feedback", hidden: true }));
        form.appendChild(qBox);
      });

      var submit = el("button", { "class": "btn", type: "submit", text: "Submit answers" });
      var actions = el("div", { "class": "quiz__actions" }, [submit]);
      form.appendChild(actions);
      host.appendChild(form);
    }

    function optionRow(type, name, value, text) {
      var label = el("label", { "class": "quiz__option" });
      var input = el("input", { type: type, name: name, value: value });
      label.appendChild(input);
      label.appendChild(el("span", { text: text }));
      return label;
    }

    function normalize(s) { return String(s).trim().toLowerCase(); }

    function isQuestionCorrect(q, qBox) {
      var name = "q_" + (q.id || qBox.dataset.qid);
      if (q.type === "short") {
        var val = (qBox.querySelector('input[type="text"]') || {}).value || "";
        var accepted = Array.isArray(q.correct) ? q.correct : [q.correct];
        return accepted.some(function (a) { return normalize(a) === normalize(val); });
      }
      if (q.type === "truefalse") {
        var picked = qBox.querySelector('input[name="' + cssEscape(name) + '"]:checked');
        if (!picked) return false;
        var want = (q.correct === true || q.correct === "true") ? "true" : "false";
        return picked.value === want;
      }
      // single / multi
      var checked = $all('input[name="' + cssEscape(name) + '"]:checked', qBox).map(function (i) { return i.value; });
      var correct = (Array.isArray(q.correct) ? q.correct : [q.correct]).map(String);
      if (q.type === "single") {
        return checked.length === 1 && correct.indexOf(checked[0]) !== -1;
      }
      // multi: sets must match exactly
      if (checked.length !== correct.length) return false;
      return correct.every(function (c) { return checked.indexOf(c) !== -1; }) &&
             checked.every(function (c) { return correct.indexOf(c) !== -1; });
    }

    function grade() {
      var form = host.querySelector(".quiz__form");
      var earned = 0, possible = 0;
      var correctCount = 0; // questions answered correctly (for retrieval hit rate)

      questions.forEach(function (q, qi) {
        var qBox = form.querySelector('[data-qid="' + cssEscape(q.id || ("q" + qi)) + '"]');
        var pts = typeof q.points === "number" ? q.points : 1;
        possible += pts;
        var ok = isQuestionCorrect(q, qBox);
        if (ok) { earned += pts; correctCount++; }

        qBox.classList.remove("is-correct", "is-incorrect");
        qBox.classList.add(ok ? "is-correct" : "is-incorrect");

        // mark options visually (single/multi/truefalse)
        if (q.type !== "short") {
          var name = "q_" + (q.id || qBox.dataset.qid);
          var correctSet = (q.type === "truefalse")
            ? [(q.correct === true || q.correct === "true") ? "true" : "false"]
            : (Array.isArray(q.correct) ? q.correct : [q.correct]).map(String);
          $all('input[name="' + cssEscape(name) + '"]', qBox).forEach(function (inp) {
            var row = inp.closest(".quiz__option");
            if (!row) return;
            inp.disabled = true;
            if (correctSet.indexOf(inp.value) !== -1) row.classList.add("is-answer");
            else if (inp.checked) row.classList.add("is-wrongpick");
          });
        } else {
          qBox.querySelector('input[type="text"]').disabled = true;
        }

        // feedback (verdict + explanation)
        var fb = qBox.querySelector(".quiz__feedback");
        fb.hidden = false;
        fb.innerHTML = "";
        fb.appendChild(el("div", {
          "class": "quiz__verdict " + (ok ? "is-correct" : "is-incorrect"),
          text: ok ? "✓ Correct" : "✗ Not quite"
        }));
        if (q.type === "short" && !ok) {
          var acc = Array.isArray(q.correct) ? q.correct.join(" / ") : q.correct;
          fb.appendChild(el("div", { "class": "quiz__explain", html: "<strong>Accepted answer:</strong> " + escapeHtml(String(acc)) }));
        }
        if (q.explanation) {
          fb.appendChild(el("div", { "class": "quiz__explain", html: escapeHtml(q.explanation) }));
        }
      });

      var pct = possible ? Math.round((earned / possible) * 100) : 0;
      var passed = (possible ? earned / possible : 0) >= passing;

      // ---- RETRIEVAL-PRACTICE SIGNAL -> personal mastery -------------------
      // This is the bridge that was missing: every graded quiz feeds the
      // student's own mastery %. The mastery engine reserves 15% of a topic's
      // mastery for retrieval-practice accuracy (quiz hit rate) — without this
      // call that slice could never move. We score by QUESTIONS answered
      // correctly (not weighted points) so the hit-rate stays an honest
      // "how many did I recall" ratio. A `data-topic` on the quiz host (or in
      // the quiz JSON) routes the signal to the right skill-tree node; quizzes
      // with no topic still grade locally, they just don't move mastery.
      var topic = (host.getAttribute && host.getAttribute("data-topic")) || data.topic || "";
      if (topic) {
        // dispatch first so any listener (charts, stat strips) can react even
        // if MASTERY isn't present on this particular page.
        try {
          document.dispatchEvent(new CustomEvent("tg:quiz", {
            detail: {
              topic: topic,
              correct: correctCount,
              total: questions.length,
              earned: earned,
              possible: possible,
              percent: pct,
              passed: passed
            }
          }));
        } catch (e) { /* old engines: a missing CustomEvent is non-fatal */ }

        // Record into the student's personal mastery. recordQuiz() is purely
        // ADDITIVE (quizSeen += total, quizRight += correct), so a naive call on
        // every Retry would double-count the same quiz. To keep the hit rate
        // honest we record the DELTA against this instance's previous attempt,
        // making the cumulative contribution equal ONLY the latest attempt.
        if (window.MASTERY && window.MASTERY.progress &&
            typeof window.MASTERY.progress.recordQuiz === "function") {
          var prev = lastSignal || { correct: 0, total: 0 };
          window.MASTERY.progress.recordQuiz(
            topic,
            correctCount - prev.correct,
            questions.length - prev.total
          );
        }
        lastSignal = { correct: correctCount, total: questions.length };
      }

      // disable submit, show score + retry
      var actions = form.querySelector(".quiz__actions");
      actions.innerHTML = "";
      var retry = el("button", { "class": "btn btn--ghost", type: "button", text: "↺ Retry quiz" });
      retry.addEventListener("click", function () {
        questions = data.shuffle ? shuffle(data.questions) : data.questions.slice();
        render();
      });
      actions.appendChild(retry);

      var score = el("div", { "class": "quiz__score " + (passed ? "is-pass" : "is-fail") }, [
        el("span", { "class": "quiz__score-num", text: pct + "%" }),
        el("span", { text: (passed ? "Passed" : "Keep studying") + " — " + earned + "/" + possible + " points (need " + Math.round(passing * 100) + "% to pass)" })
      ]);
      score.setAttribute("role", "status");
      // place score right above the actions
      form.insertBefore(score, actions);
      score.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    render();
    return { regrade: grade, reset: render };
  };

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function initQuizzes(root) {
    $all("[data-quiz]", root).forEach(function (host) {
      if (host._tgInit) return; host._tgInit = true;
      TG.quiz(host, host.getAttribute("data-quiz"));
    });
  }

  /* ---------------------------------------------------------------------- *
   *  10. FLASHCARDS
   *  TG.flashcards(mount, cardsArray|scriptId)
   *  cards: [{front, back, tag?}]
   *  Flip on click, Prev/Next, Shuffle, progress, Got it / Review again filter
   * ---------------------------------------------------------------------- */
  TG.flashcards = function (mount, source) {
    var host = resolveMount(mount);
    var cards = resolveData(source);
    if (!host || !cards) return null;
    if (!Array.isArray(cards) && cards.cards) cards = cards.cards; // allow {cards:[...]}
    if (!Array.isArray(cards) || !cards.length) return null;

    host.classList.add("flashcards");

    var deck = cards.slice();      // active deck (filtered)
    var idx = 0;
    var reviewIds = {};            // indices marked "review again" (by original ref)

    var meta = el("div", { "class": "flashcards__meta" });
    var progress = el("span", { "class": "flashcards__progress" });
    var tagSlot = el("span", { "class": "muted" });
    meta.appendChild(tagSlot);
    meta.appendChild(progress);

    var flip = el("button", { "class": "flip-card", type: "button", "aria-label": "Flip card" });
    var inner = el("div", { "class": "flip-card__inner" });
    var front = el("div", { "class": "flip-card__face flip-card__front" });
    var back = el("div", { "class": "flip-card__face flip-card__back" });
    inner.appendChild(front); inner.appendChild(back);
    flip.appendChild(inner);

    var prevBtn = el("button", { "class": "btn btn--ghost btn--sm", type: "button", text: "‹ Prev" });
    var nextBtn = el("button", { "class": "btn btn--ghost btn--sm", type: "button", text: "Next ›" });
    var shuffleBtn = el("button", { "class": "btn btn--ghost btn--sm", type: "button", text: "🔀 Shuffle" });
    var gotBtn = el("button", { "class": "btn btn--sm", type: "button", text: "✓ Got it" });
    var reviewBtn = el("button", { "class": "btn btn--ghost btn--sm", type: "button", text: "↻ Review again" });
    var resetBtn = el("button", { "class": "btn btn--ghost btn--sm", type: "button", text: "Reset deck" });

    var controls = el("div", { "class": "flashcards__controls" }, [prevBtn, nextBtn, shuffleBtn, gotBtn, reviewBtn, resetBtn]);

    host.innerHTML = "";
    host.appendChild(meta);
    host.appendChild(flip);
    host.appendChild(controls);

    function render() {
      if (!deck.length) {
        front.innerHTML = ""; back.innerHTML = "";
        front.appendChild(el("div", { text: "🎉 Deck complete!" }));
        back.appendChild(el("div", { text: "All cards marked 'Got it'. Reset to review again." }));
        progress.textContent = "0 / 0";
        tagSlot.textContent = "";
        flip.classList.remove("is-flipped");
        return;
      }
      idx = (idx % deck.length + deck.length) % deck.length;
      var card = deck[idx];
      flip.classList.remove("is-flipped");
      front.innerHTML = ""; back.innerHTML = "";
      if (card.tag) front.appendChild(el("span", { "class": "tag flip-card__tag", text: card.tag }));
      front.appendChild(el("div", { html: escapeHtml(card.front) }));
      front.appendChild(el("div", { "class": "flip-card__hint", text: "click to reveal" }));
      back.appendChild(el("div", { html: escapeHtml(card.back) }));
      back.appendChild(el("div", { "class": "flip-card__hint", text: "click to flip back" }));
      tagSlot.textContent = card.tag || "";
      progress.textContent = (idx + 1) + " / " + deck.length;
    }

    flip.addEventListener("click", function () { flip.classList.toggle("is-flipped"); });
    prevBtn.addEventListener("click", function () { idx--; render(); });
    nextBtn.addEventListener("click", function () { idx++; render(); });
    shuffleBtn.addEventListener("click", function () { deck = shuffle(deck); idx = 0; render(); });
    gotBtn.addEventListener("click", function () {
      // remove current card from deck (mastered)
      if (deck.length) { deck.splice(idx, 1); render(); }
    });
    reviewBtn.addEventListener("click", function () {
      // keep in deck, just advance
      idx++; render();
    });
    resetBtn.addEventListener("click", function () { deck = cards.slice(); idx = 0; render(); });

    // keyboard support when card focused
    flip.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { idx++; render(); }
      else if (e.key === "ArrowLeft") { idx--; render(); }
    });

    render();
    return { render: render };
  };

  function initFlashcards(root) {
    $all("[data-flashcards]", root).forEach(function (host) {
      if (host._tgInit) return; host._tgInit = true;
      TG.flashcards(host, host.getAttribute("data-flashcards"));
    });
  }

  /* ---------------------------------------------------------------------- *
   *  11. SMOOTH SCROLL + TABLE OF CONTENTS
   * ---------------------------------------------------------------------- */
  function initSmoothScroll(root) {
    (root || document).addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest('a[href^="#"]');
      if (!a) return;
      var id = a.getAttribute("href").slice(1);
      if (!id) return;
      var target = document.getElementById(id) || document.querySelector('a[name="' + cssEscape(id) + '"]');
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      if (history.pushState) history.pushState(null, "", "#" + id);
      // move focus for a11y without jumping
      target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  }

  function initToc(root) {
    var tocHost = $("[data-toc]", root);
    if (!tocHost || tocHost._tgInit) return;
    tocHost._tgInit = true;

    var scopeSel = tocHost.getAttribute("data-toc") || "main";
    var scope = scopeSel === "" ? document : (document.querySelector(scopeSel) || document.querySelector("main") || document);
    var heads = $all("h2, h3", scope).filter(function (h) {
      return !h.closest(".tg-present") && h.getAttribute("data-toc-skip") === null;
    });
    if (!heads.length) { tocHost.classList.add("hidden"); return; }

    var list = el("ul", { "class": "tg-toc" });
    var links = [];
    heads.forEach(function (h, i) {
      if (!h.id) h.id = "sec-" + slug(h.textContent) + "-" + i;
      var a = el("a", { href: "#" + h.id, text: h.textContent.trim(), "class": h.tagName === "H3" ? "tg-toc--h3" : "" });
      links.push({ a: a, h: h });
      list.appendChild(el("li", {}, [a]));
    });
    tocHost.appendChild(list);

    // scroll-spy
    if ("IntersectionObserver" in window) {
      var spy = new IntersectionObserver(function (entries) {
        entries.forEach(function (ent) {
          if (ent.isIntersecting) {
            links.forEach(function (l) { l.a.classList.toggle("is-active", l.h === ent.target); });
          }
        });
      }, { rootMargin: "-10% 0px -75% 0px", threshold: 0 });
      heads.forEach(function (h) { spy.observe(h); });
    }
  }

  /* ---------------------------------------------------------------------- *
   *  ACCESSIBILITY: inject skip link if a <main> exists and none present
   * ---------------------------------------------------------------------- */
  function initSkipLink() {
    var main = document.querySelector("main");
    if (!main) return;
    if (!main.id) main.id = "main";
    if (document.querySelector(".tg-skip-link")) return;
    var link = el("a", { "class": "tg-skip-link", href: "#" + main.id, text: "Skip to content" });
    document.body.insertBefore(link, document.body.firstChild);
  }

  /* ---------------------------------------------------------------------- *
   *  MASTER INIT
   * ---------------------------------------------------------------------- */
  TG.init = function (root) {
    root = root || document;
    initSkipLink();
    initThemeToggle(root);        // theme first (affects rendering)
    initCopyButtons(root);
    initTabs(root);
    initAccordion(root);
    initChecklists(root);
    initPresent(root);
    initQuizzes(root);
    initFlashcards(root);
    initSmoothScroll(root);
    initToc(root);
  };

  // expose helpers for advanced/manual use
  TG.$ = $;
  TG.$all = $all;
  TG.shuffle = shuffle;
  TG.store = store;
  TG.initCopyButtons = initCopyButtons;
  TG.initTabs = initTabs;
  TG.initAccordion = initAccordion;
  TG.initChecklists = initChecklists;
  TG.version = "1.0.0";

  window.TG = TG;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { TG.init(); });
  } else {
    TG.init();
  }
})();
