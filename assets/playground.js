/* ==========================================================================
   COP4667 Android Development — Teaching Guide
   playground.js — LIVE, EDITABLE, RUNNABLE code (progressive enhancement)
   --------------------------------------------------------------------------
   Turns any  <div class="codeblock" data-run="kotlin|compose"> … </div>
   into a live editor with a Run button, backed by JetBrains' Kotlin Playground
   (loaded on demand from unpkg). Compilation happens on JetBrains' REMOTE
   server, so this needs internet — student code is sent there to compile.

     data-run="kotlin"   -> data-target-platform="java"  (JVM, console output)
                            RELIABLE. The <code> must be a COMPLETE program
                            (a fun main(), or use //sampleStart … //sampleEnd).

     data-run="compose"  -> data-target-platform="compose-wasm" (renders UI)
                            EXPERIMENTAL. May be slow or unsupported by the
                            public server. We always show the static code +
                            a link to the offline visual simulator + Android
                            Studio so the lesson NEVER breaks.

   If the library can't load (offline / firewall / CDN blocked) every block
   gracefully falls back to its original static, copyable code.
   No build step. Safe to include on any page (no-ops when no [data-run]).
   ========================================================================== */
(function () {
  'use strict';

  var PG_SRC        = 'https://unpkg.com/kotlin-playground@1';
  var LOAD_TIMEOUT  = 12000; // ms to wait for the playground library before falling back
  var KOTLIN_VERSION = '';   // optional compiler pin, e.g. '2.0.0'; blank = server default
  var COMPOSE_SERVER = '';   // optional compose-capable server URL override; blank = default
  var seq = 0;
  // The Kotlin compiler server rejects requests from a file:// page (Origin: null is
  // CORS-blocked). Over http(s) it returns Access-Control-Allow-Origin:*, so Run works.
  var IS_FILE = location.protocol === 'file:';

  function ready(fn) {
    if (document.readyState !== 'loading') { fn(); }
    else { document.addEventListener('DOMContentLoaded', fn); }
  }

  // Relative path to the visual Compose simulator, depending on this page's folder.
  function simPath() {
    var inSub = /\/(sessions|labs|assessments)\//.test(location.pathname);
    return (inSub ? '../' : '') + 'labs/compose-playground.html';
  }

  function loadScript(src, cb) {
    var done = false;
    var s = document.createElement('script');
    s.src = src; s.async = true;
    var timer = setTimeout(function () { if (!done) { done = true; cb(false); } }, LOAD_TIMEOUT);
    s.onload  = function () { if (!done) { done = true; clearTimeout(timer); cb(true); } };
    s.onerror = function () { if (!done) { done = true; clearTimeout(timer); cb(false); } };
    document.head.appendChild(s);
  }

  function codeText(block) {
    var node = block.querySelector('pre code') || block.querySelector('code') || block.querySelector('pre');
    return node ? node.textContent.replace(/\s+$/, '') : '';
  }

  // Build the toolbar + mount point + fallback box on each runnable block up front,
  // so the page looks intentional even before (or without) the remote library.
  function prepare(block) {
    block.classList.add('tg-run');
    var kind = block.getAttribute('data-run') === 'compose' ? 'compose' : 'kotlin';

    var bar = document.createElement('div');
    bar.className = 'tg-run__bar no-print';
    bar.innerHTML =
      '<span class="tg-run__badge">&#9658; Live ' + (kind === 'compose' ? 'Compose' : 'Kotlin') + '</span>' +
      '<span class="tg-run__hint">editable &middot; runs on JetBrains&rsquo; compiler &middot; needs internet</span>' +
      '<span class="tg-run__status" data-role="status">loading runner&hellip;</span>';
    block.insertBefore(bar, block.firstChild);

    var mount = document.createElement('div');
    mount.className = 'tg-run__mount no-print';
    mount.setAttribute('data-role', 'mount');
    mount.hidden = true;
    block.appendChild(mount);

    var fb = document.createElement('div');
    fb.className = 'tg-run__fallback no-print';
    fb.setAttribute('data-role', 'fallback');
    fb.hidden = true;
    block.appendChild(fb);
  }

  // One-time page banner shown when opened as a file:// (Run can't reach the compiler).
  function fileBanner() {
    if (document.getElementById('tg-file-banner')) { return; }
    var b = document.createElement('div');
    b.id = 'tg-file-banner';
    b.className = 'callout callout--warn no-print';
    b.innerHTML =
      '<span class="callout__icon" aria-hidden="true">&#9658;</span>' +
      '<div class="callout__body"><span class="callout__label">Live &ldquo;Run&rdquo; needs a local server</span>' +
      '<p>This page was opened as a <code>file://</code>, and the Kotlin compiler blocks code sent from files ' +
      '(the browser sends <code>Origin: null</code>). To actually run code in the page: ' +
      '<strong>double-click <code>serve.command</code></strong> in the <em>teaching-guide</em> folder ' +
      '(it serves at <code>http://localhost:8765</code>), then open the guide from there. ' +
      'Or press <strong>Copy</strong> on any snippet and paste it into ' +
      '<a target="_blank" rel="noopener" href="https://play.kotlinlang.org/">play.kotlinlang.org &#8599;</a>. ' +
      'Everything else on the page works as-is.</p></div>';
    var host = document.querySelector('main') || document.body;
    host.insertBefore(b, host.firstChild);
  }

  function fallbackHTML(kind, reason) {
    var sim = simPath();
    var pg = '<a class="btn btn--sm" target="_blank" rel="noopener" href="https://play.kotlinlang.org/">Open Kotlin Playground &#8599;</a>';
    if (reason === 'file') {
      if (kind === 'compose') {
        return '<strong>Run needs a local server.</strong> Open the guide via <code>serve.command</code> (http://localhost:8765) to run here, ' +
               'see it render in the offline <a class="btn btn--sm" target="_blank" rel="noopener" href="' + sim + '">visual simulator &#8599;</a>, ' +
               'or build it in <strong>Android Studio</strong>.';
      }
      return '<strong>Run needs a local server.</strong> Open the guide via <code>serve.command</code> (http://localhost:8765) to run here, ' +
             'or Copy the code above and ' + pg + '.';
    }
    if (kind === 'compose') {
      return '<strong>Live Compose runner unavailable.</strong> The code above is correct and copyable. ' +
             'See it render in the offline <a class="btn btn--sm" target="_blank" rel="noopener" href="' + sim + '">visual Compose simulator &#8599;</a> ' +
             'or build &amp; run it for real in <strong>Android Studio</strong> &mdash; where all Compose lessons ultimately run.';
    }
    return '<strong>Live Kotlin runner unavailable.</strong> The code above is correct and copyable. ' +
           'Copy it and paste into ' + pg + ', or run it in <strong>Android Studio</strong>.';
  }

  function showFallback(block, reason) {
    var kind = block.getAttribute('data-run') === 'compose' ? 'compose' : 'kotlin';
    block.classList.remove('is-live');
    var mount = block.querySelector('[data-role=mount]'); if (mount) { mount.hidden = true; }
    var status = block.querySelector('[data-role=status]');
    if (status) {
      status.textContent = reason === 'file' ? 'serve over http to Run'
                         : reason === 'offline' ? 'offline — showing code'
                         : 'runner unavailable — showing code';
    }
    var fb = block.querySelector('[data-role=fallback]');
    if (fb) { fb.innerHTML = fallbackHTML(kind, reason); fb.hidden = false; }
  }

  function initLive(block) {
    var kind = block.getAttribute('data-run') === 'compose' ? 'compose' : 'kotlin';
    var code = codeText(block);
    var mount = block.querySelector('[data-role=mount]');
    var status = block.querySelector('[data-role=status]');
    if (!mount || !code) { showFallback(block, 'error'); return; }

    var cls = 'tg-live-' + (++seq);
    var el = document.createElement('code');
    el.className = cls;
    el.textContent = code;
    el.setAttribute('theme', 'idea');
    el.setAttribute('match-brackets', 'true');
    el.setAttribute('auto-indent', 'true');
    el.setAttribute('indent', '4');
    el.setAttribute('lines', 'true');
    if (KOTLIN_VERSION) { el.setAttribute('data-version', KOTLIN_VERSION); }
    if (kind === 'compose') {
      el.setAttribute('data-target-platform', 'compose-wasm');
      el.setAttribute('data-output-height', '420');
    } else {
      el.setAttribute('data-target-platform', 'java');
    }
    mount.appendChild(el);
    mount.hidden = false;
    block.classList.add('is-live');

    try {
      var opts = {
        callback: function () { if (status) { status.textContent = kind === 'compose' ? 'press Run to compile Compose' : 'ready — press Run'; } }
      };
      if (kind === 'compose' && COMPOSE_SERVER) { opts.server = COMPOSE_SERVER; }
      window.KotlinPlayground('.' + cls, opts);
      if (status) { status.textContent = kind === 'compose' ? 'compiling on first Run…' : 'ready — press Run'; }
    } catch (e) {
      showFallback(block, 'error');
      return;
    }

    // Compose is experimental: always offer the always-works paths alongside the live editor.
    if (kind === 'compose') {
      var also = document.createElement('div');
      also.className = 'tg-run__also no-print';
      also.innerHTML = 'Compose-on-web is experimental &mdash; if it fails to compile here, ' +
        'use the offline <a class="btn btn--sm" target="_blank" rel="noopener" href="' + simPath() + '">visual simulator &#8599;</a> ' +
        'or run it in <strong>Android Studio</strong>.';
      block.appendChild(also);
    }
  }

  ready(function () {
    var blocks = Array.prototype.slice.call(document.querySelectorAll('.codeblock[data-run], [data-run="kotlin"], [data-run="compose"]'));
    if (!blocks.length) { return; }
    blocks.forEach(prepare);

    // file:// origin is CORS-blocked by the Kotlin compiler — don't mount editors whose
    // Run would silently fail. Show the static code + how to enable live Run instead.
    if (IS_FILE) {
      fileBanner();
      blocks.forEach(function (b) { showFallback(b, 'file'); });
      return;
    }

    // navigator.onLine is a hint; we still try, and rely on timeout/onerror as the real signal.
    loadScript(PG_SRC, function (ok) {
      if (!ok || typeof window.KotlinPlayground === 'undefined') {
        blocks.forEach(function (b) { showFallback(b, 'offline'); });
        return;
      }
      blocks.forEach(initLive);
    });
  });
})();
