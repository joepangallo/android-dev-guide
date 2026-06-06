/* ==========================================================================
   COP4667 Android Development — Teaching Guide
   mastery.js — the shared MASTERY ENGINE  (companion to mastery.css)
   --------------------------------------------------------------------------
   A dependency-free, vanilla-JS learning instrument that works from file://.
   It is the STUDENT'S OWN self-directed progress system — never a gradebook.

   Exposes  window.MASTERY  with:

     MASTERY.progress     persistent progress + computed mastery
       .set(key,val) / .get(key) / .all()
       .markSolved(id) / .unsolve(id) / .isSolved(id) / .solvedCount(prefix)
       .recordQuiz(topic, correct, total)        record a retrieval-practice result
       .recordSrs(topic, cardId, sched)          record an SM-2 review signal
       .topicMastery(topic) -> 0..100            solved challenges + SRS maturity
       .globalPercent() -> 0..100                overall personal mastery
       .streak() -> { current, longest, today }  study-day streak
       on every change it emits a DOM "mastery:change" event on document.

     MASTERY.srs(mountSelector, deckObjOrScriptId)
       a correct SM-2 spaced-repetition trainer (Again/Hard/Good/Easy).

     MASTERY.challenges()
       delegated [data-challenge][data-topic] "Mark solved ✓ / Reset" controls.

     MASTERY.map(mountSelector, treeObjOrScriptId)
       a skill-tree / learning-path coloured by topicMastery, with prereq locks.

     MASTERY.reveal()
       delegated toggle for [data-reveal] spoilers and .ms-reveal blocks.

   Auto-inits on DOMContentLoaded: wires challenges + reveal globally, and
   auto-mounts any [data-srs] / [data-skillmap] hosts found on the page.

   Storage: localStorage, namespaced "tg:mastery:". All reads/writes are wrapped
   so a locked-down file:// browser degrades gracefully (in-memory fallback).
   ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ utils */
  var PREFIX = 'tg:mastery:';
  var DAY_MS = 86400000;

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  // In-memory fallback if localStorage throws (private mode / strict file://).
  var memStore = {};
  var lsOK = (function () {
    try {
      var k = PREFIX + '__probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  function rawGet(key) {
    if (lsOK) { try { return localStorage.getItem(PREFIX + key); } catch (e) {} }
    return Object.prototype.hasOwnProperty.call(memStore, key) ? memStore[key] : null;
  }
  function rawSet(key, str) {
    if (lsOK) { try { localStorage.setItem(PREFIX + key, str); return; } catch (e) {} }
    memStore[key] = str;
  }
  function rawDel(key) {
    if (lsOK) { try { localStorage.removeItem(PREFIX + key); return; } catch (e) {} }
    delete memStore[key];
  }

  function readJSON(key, fallback) {
    var s = rawGet(key);
    if (s === null || s === undefined) { return fallback; }
    try { return JSON.parse(s); } catch (e) { return fallback; }
  }
  function writeJSON(key, val) { rawSet(key, JSON.stringify(val)); }

  function todayKey(d) {
    d = d || new Date();
    // local-date key YYYY-MM-DD so streaks follow the student's wall clock
    var y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
    return y + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function dayNumber(d) {
    d = d || new Date();
    // whole local days since epoch (ignores time-of-day)
    return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / DAY_MS);
  }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
  function round(n) { return Math.round(n); }

  function emitChange(detail) {
    try {
      document.dispatchEvent(new CustomEvent('mastery:change', { detail: detail || {} }));
    } catch (e) {
      // very old engines: fall back to a plain event
      try {
        var ev = document.createEvent('Event');
        ev.initEvent('mastery:change', true, false);
        document.dispatchEvent(ev);
      } catch (e2) {}
    }
  }

  function escapeHTML(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Read a deck/tree from either a literal object/array or a <script type=...> id.
  function resolveData(source) {
    if (source && typeof source === 'object') { return source; }
    if (typeof source === 'string') {
      var node = document.getElementById(source) ||
                 document.getElementById(source.replace(/^#/, ''));
      if (node) {
        try { return JSON.parse(node.textContent); }
        catch (e) { console.warn('MASTERY: could not parse data in #' + source, e); }
      }
    }
    return null;
  }

  function resolveMount(sel) {
    if (!sel) { return null; }
    if (typeof sel === 'string') { return $(sel); }
    if (sel.nodeType === 1) { return sel; }
    return null;
  }

  /* ---- topic normalization ----
     The skill tree has 8 canonical nodes: kotlin, compose-ui, state, lists,
     architecture, data, networking, project. Content (quiz/SRS/challenge
     data-topic values) occasionally uses finer-grained or legacy aliases.
     This alias map rolls those orphans up to the canonical node so their
     mastery signals actually surface in the tree / stat strip instead of
     accumulating under a topic that no node iterates. Unknown topics pass
     through unchanged (so a brand-new topic still records, just unmapped). */
  var TOPIC_ALIASES = {
    // kotlin
    'collections': 'kotlin', 'classes': 'kotlin', 'control-flow': 'kotlin',
    'null-safety': 'kotlin', 'scope-functions': 'kotlin', 'functions': 'kotlin',
    'kotlin-basics': 'kotlin',
    // compose-ui
    'compose': 'compose-ui', 'ui': 'compose-ui',
    // state
    'recomposition': 'state',
    // architecture
    'lifecycle': 'architecture', 'intents': 'architecture', 'navigation': 'architecture',
    'components': 'architecture', 'ecosystem': 'architecture', 'activities': 'architecture',
    // data
    'persistence': 'data', 'room': 'data', 'sqlite': 'data', 'datastore': 'data',
    'storage': 'data', 'database': 'data',
    // networking
    'http': 'networking', 'rest': 'networking', 'retrofit': 'networking',
    'json': 'networking', 'api': 'networking',
    // project
    'capstone': 'project', 'integration': 'project'
  };
  function normalizeTopic(t) {
    if (!t) { return t; }
    var key = String(t).trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(TOPIC_ALIASES, key) ? TOPIC_ALIASES[key] : key;
  }

  /* ---- per-topic challenge inventory (honest mastery denominators) ----
     The solved-challenge component of topicMastery() must scale against the
     REAL number of [data-challenge][data-topic] blocks that exist for a topic
     across the guide — NOT against the count the student happens to have solved.
     These counts are derived from the distinct challenge ids in the guide
     (canonical topics only). If a topic is unknown here, topicMastery falls back
     to the legacy "solved / ever-solved" ratio so it still records sensibly. */
  var TOPIC_CHALLENGE_TARGETS = {
    kotlin: 20,
    architecture: 13,
    data: 13,
    'compose-ui': 12,
    state: 11,
    networking: 10,
    lists: 8,
    project: 2
  };

  /* =====================================================================
     A. PROGRESS  (the heart — solved challenges, quiz + SRS signals, mastery)
     ===================================================================== */

  // Persisted shapes:
  //   "kv"      -> { [key]: value }              generic set/get bucket
  //   "solved"  -> { [challengeId]: ts }         solved challenges
  //   "topics"  -> { [topic]: { quizSeen, quizRight, cards:{id:{ef,reps,int,due,lapses,quality,last}} } }
  //   "streak"  -> { last:dayNumber, current, longest, days:{ "YYYY-MM-DD": true } }

  function getKV()     { return readJSON('kv', {}); }
  function getSolved() { return readJSON('solved', {}); }
  function getTopics() { return readJSON('topics', {}); }
  function getStreak() { return readJSON('streak', { last: null, current: 0, longest: 0, days: {} }); }

  function topicEntry(topics, topic) {
    if (!topics[topic]) {
      topics[topic] = { quizSeen: 0, quizRight: 0, cards: {} };
    }
    if (!topics[topic].cards) { topics[topic].cards = {}; }
    return topics[topic];
  }

  // Bump the study-day streak whenever the student does any real activity.
  function touchStreak() {
    var st = getStreak();
    var dnum = dayNumber();
    var tkey = todayKey();
    if (st.days && st.days[tkey]) {
      return st; // already counted today
    }
    if (st.last === null) {
      st.current = 1;
    } else if (dnum === st.last + 1) {
      st.current = (st.current || 0) + 1;
    } else if (dnum === st.last) {
      st.current = st.current || 1;
    } else {
      st.current = 1; // a gap — streak resets
    }
    st.last = dnum;
    st.longest = Math.max(st.longest || 0, st.current);
    st.days = st.days || {};
    st.days[tkey] = true;
    writeJSON('streak', st);
    return st;
  }

  var progress = {
    /* ---- generic key/value bucket ---- */
    set: function (key, val) {
      var kv = getKV();
      kv[key] = val;
      writeJSON('kv', kv);
      emitChange({ kind: 'kv', key: key });
      return val;
    },
    get: function (key, fallback) {
      var kv = getKV();
      return Object.prototype.hasOwnProperty.call(kv, key) ? kv[key] : fallback;
    },
    all: function () {
      return {
        kv: getKV(),
        solved: getSolved(),
        topics: getTopics(),
        streak: getStreak()
      };
    },

    /* ---- solved challenges ---- */
    markSolved: function (id, topic) {
      if (!id) { return false; }
      topic = normalizeTopic(topic);
      var solved = getSolved();
      if (!solved[id]) {
        solved[id] = Date.now();
        writeJSON('solved', solved);
      }
      if (topic) {
        // remember which topic this challenge belongs to for mastery math
        var map = readJSON('challengeTopics', {});
        map[id] = topic;
        writeJSON('challengeTopics', map);
      }
      touchStreak();
      emitChange({ kind: 'solved', id: id, topic: topic });
      return true;
    },
    unsolve: function (id) {
      var solved = getSolved();
      if (solved[id]) {
        delete solved[id];
        writeJSON('solved', solved);
        emitChange({ kind: 'unsolved', id: id });
        return true;
      }
      return false;
    },
    isSolved: function (id) {
      var solved = getSolved();
      return !!solved[id];
    },
    solvedCount: function (prefix) {
      var solved = getSolved();
      var keys = Object.keys(solved);
      if (!prefix) { return keys.length; }
      return keys.filter(function (k) { return k.indexOf(prefix) === 0; }).length;
    },

    /* ---- retrieval-practice (quiz) signal ---- */
    recordQuiz: function (topic, correct, total) {
      topic = normalizeTopic(topic);
      if (!topic) { return; }
      var topics = getTopics();
      var t = topicEntry(topics, topic);
      t.quizSeen = (t.quizSeen || 0) + (Number(total) || 0);
      t.quizRight = (t.quizRight || 0) + (Number(correct) || 0);
      writeJSON('topics', topics);
      touchStreak();
      emitChange({ kind: 'quiz', topic: topic });
    },

    /* ---- SRS review signal (called by the trainer; sched is the SM-2 state) ---- */
    recordSrs: function (topic, cardId, sched) {
      topic = normalizeTopic(topic);
      if (!topic || !cardId || !sched) { return; }
      var topics = getTopics();
      var t = topicEntry(topics, topic);
      t.cards[cardId] = sched;
      writeJSON('topics', topics);
      touchStreak();
      emitChange({ kind: 'srs', topic: topic, cardId: cardId });
    },

    /* ---- computed mastery for one topic: 0..100 ----
       Blend of three independent personal signals (never a course grade):
         50%  solved challenges in this topic, scaled against the REAL number of
              challenges that exist for the topic (TOPIC_CHALLENGE_TARGETS),
              capped at 1 via min(solved / target, 1) — so solving 1 of 8 reads
              as ~12%, not 100%.
         35%  SRS maturity (how well-spaced / "stuck" the topic's cards are)
         15%  retrieval-practice accuracy (quiz hit rate), if any attempts
       Signals that have no data simply don't drag the score down — we
       renormalise over the signals that actually have evidence. */
    topicMastery: function (topic) {
      topic = normalizeTopic(topic);
      if (!topic) { return 0; }
      var topics = getTopics();
      var t = topics[topic];
      var chMap = readJSON('challengeTopics', {});
      var solved = getSolved();

      var parts = []; // { val:0..1, weight }

      // 1) solved challenges for this topic.
      //    Denominator = the true per-topic challenge inventory (target), so the
      //    ratio reflects coverage of all challenges, not just ones ever solved.
      //    Count solved ids whose (normalized) recorded topic matches.
      var solvedForTopic = 0, everSeenForTopic = 0;
      Object.keys(chMap).forEach(function (id) {
        if (normalizeTopic(chMap[id]) === topic) {
          everSeenForTopic++;
          if (solved[id]) { solvedForTopic++; }
        }
      });
      var target = TOPIC_CHALLENGE_TARGETS[topic];
      if (target && target > 0) {
        // honest denominator: real challenge count for the topic
        parts.push({ val: Math.min(solvedForTopic / target, 1), weight: 0.50 });
      } else if (everSeenForTopic > 0) {
        // unknown topic: fall back to legacy "solved / ever-solved" behavior
        parts.push({ val: solvedForTopic / everSeenForTopic, weight: 0.50 });
      }

      // 2) SRS maturity: mean per-card maturity, where a card matures as its
      //    interval grows (interval >= 21 days counts as fully mature).
      if (t && t.cards) {
        var ids = Object.keys(t.cards);
        if (ids.length) {
          var sum = 0;
          ids.forEach(function (id) {
            var c = t.cards[id];
            var interval = (c && c.interval) || 0;
            var reps = (c && c.repetition) || 0;
            // a freshly-learned card (reps>=1) is partly mature; 21d = mature.
            var m = clamp(interval / 21, 0, 1);
            if (reps >= 1) { m = Math.max(m, 0.15); }
            sum += m;
          });
          parts.push({ val: sum / ids.length, weight: 0.35 });
        }
      }

      // 3) quiz accuracy
      if (t && t.quizSeen > 0) {
        parts.push({ val: clamp(t.quizRight / t.quizSeen, 0, 1), weight: 0.15 });
      }

      if (!parts.length) { return 0; }
      var wsum = 0, acc = 0;
      parts.forEach(function (p) { wsum += p.weight; acc += p.val * p.weight; });
      return round((acc / wsum) * 100);
    },

    // List every topic the engine has seen any signal for (normalized to the
    // canonical vocabulary so orphan aliases roll up to their tree node and
    // don't appear as separate buckets).
    knownTopics: function () {
      var set = {};
      Object.keys(getTopics()).forEach(function (t) { var n = normalizeTopic(t); if (n) { set[n] = true; } });
      var chMap = readJSON('challengeTopics', {});
      Object.keys(chMap).forEach(function (id) { var n = normalizeTopic(chMap[id]); if (n) { set[n] = true; } });
      return Object.keys(set);
    },

    // Overall personal mastery: mean of known-topic masteries.
    globalPercent: function () {
      var topics = this.knownTopics();
      if (!topics.length) { return 0; }
      var self = this;
      var sum = topics.reduce(function (a, t) { return a + self.topicMastery(t); }, 0);
      return round(sum / topics.length);
    },

    streak: function () {
      var st = getStreak();
      return {
        current: st.current || 0,
        longest: st.longest || 0,
        today: !!(st.days && st.days[todayKey()])
      };
    },

    // Wipe everything (used by an optional reset control).
    resetAll: function () {
      ['kv', 'solved', 'topics', 'streak', 'challengeTopics', 'srsmeta'].forEach(rawDel);
      emitChange({ kind: 'reset' });
    }
  };

  /* =====================================================================
     B. SRS — a correct SM-2 spaced-repetition trainer
     ===================================================================== */

  // Map the four rating buttons to SM-2 "quality" grades (0..5).
  //   Again -> 2 (a lapse), Hard -> 3, Good -> 4, Easy -> 5.
  var QUALITY = { again: 2, hard: 3, good: 4, easy: 5 };

  // Pure SM-2 scheduler. Takes the prior card state + a quality (0..5) and
  // returns the next state. Initial ease factor 2.5.
  //   state: { ef, repetition, interval, due, lapses, last }
  function sm2(prev, quality, now) {
    now = now || Date.now();
    var ef = (prev && prev.ef) || 2.5;
    var repetition = (prev && prev.repetition) || 0;
    var interval = (prev && prev.interval) || 0;
    var lapses = (prev && prev.lapses) || 0;

    if (quality < 3) {
      // failed recall (Again): reset the learning, count a lapse, see again soon.
      repetition = 0;
      interval = 0; // due again this same session (treated as < 1 day)
      lapses += 1;
    } else {
      repetition += 1;
      if (repetition === 1) { interval = 1; }
      else if (repetition === 2) { interval = 6; }
      else { interval = Math.round(interval * ef); }
    }

    // SM-2 ease-factor update (applies for every grade; clamped at 1.3).
    ef = ef + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ef < 1.3) { ef = 1.3; }

    var due = (interval <= 0)
      ? now + 60000 * 1      // Again: ~1 min later (same session)
      : now + interval * DAY_MS;

    return {
      ef: Math.round(ef * 1000) / 1000,
      repetition: repetition,
      interval: interval,
      due: due,
      lapses: lapses,
      last: now
    };
  }

  // SRS per-session "new card" pacing, persisted per deck.
  function srsMeta() { return readJSON('srsmeta', {}); }
  function deckMeta(deckId) {
    var all = srsMeta();
    if (!all[deckId]) { all[deckId] = { introducedToday: 0, day: todayKey() }; }
    if (all[deckId].day !== todayKey()) { all[deckId] = { introducedToday: 0, day: todayKey() }; }
    return all[deckId];
  }
  function saveDeckMeta(deckId, meta) {
    var all = srsMeta();
    all[deckId] = meta;
    writeJSON('srsmeta', all);
  }

  var NEW_PER_DAY = 8; // gentle intro pacing for fresh cards

  function srs(mountSelector, source) {
    var mount = resolveMount(mountSelector);
    if (!mount) { console.warn('MASTERY.srs: mount not found', mountSelector); return null; }

    var deck = resolveData(source);
    if (!deck) { console.warn('MASTERY.srs: no deck data'); return null; }

    // Accept { id, cards:[...] } or a bare array of cards.
    var cards = Array.isArray(deck) ? deck : (deck.cards || []);
    var deckId = (deck && deck.id) ||
                 mount.getAttribute('data-deck-id') ||
                 ('deck-' + (mount.id || cards.length + '-' + (cards[0] && cards[0].id)));

    if (!cards.length) {
      mount.innerHTML = '<div class="ms-srs__empty"><strong>No cards yet.</strong></div>';
      return null;
    }

    mount.classList.add('ms-srs');
    var current = null;     // card being shown
    var revealed = false;

    // Load the persisted schedule for a card (topic-scoped via progress.topics).
    function schedFor(card) {
      var topics = getTopics();
      var t = topics[card.topic];
      if (t && t.cards && t.cards[card.id]) { return t.cards[card.id]; }
      return null;
    }

    function isDue(card, now) {
      var s = schedFor(card);
      if (!s) { return false; }      // brand-new cards are handled separately
      return s.due <= now;
    }
    function isNew(card) { return !schedFor(card); }

    function counts(now) {
      var due = 0, fresh = 0, mature = 0, learned = 0;
      cards.forEach(function (c) {
        var s = schedFor(c);
        if (!s) { fresh++; return; }
        learned++;
        if (s.interval >= 21) { mature++; }
        if (s.due <= now) { due++; }
      });
      return { due: due, fresh: fresh, mature: mature, learned: learned, total: cards.length };
    }

    // Choose the next card: due reviews first (soonest due), then new (paced).
    function pickNext() {
      var now = Date.now();
      var dueCards = cards.filter(function (c) { return isDue(c, now); });
      if (dueCards.length) {
        dueCards.sort(function (a, b) { return schedFor(a).due - schedFor(b).due; });
        return dueCards[0];
      }
      var meta = deckMeta(deckId);
      if (meta.introducedToday < NEW_PER_DAY) {
        var fresh = cards.filter(isNew);
        if (fresh.length) { return fresh[0]; }
      }
      return null; // nothing to review right now
    }

    function ratingButtons(card) {
      // Preview the interval each rating would schedule, so the choice is informed.
      var prev = schedFor(card);
      function previewLabel(q) {
        var next = sm2(prev, q, Date.now());
        if (next.interval <= 0) { return '&lt;1d'; }
        if (next.interval === 1) { return '1d'; }
        return next.interval + 'd';
      }
      return '' +
        '<div class="ms-rate" role="group" aria-label="How well did you recall this?">' +
          '<button class="ms-rate__btn ms-rate__btn--again" data-rate="again" type="button">Again<small>' + previewLabel(QUALITY.again) + '</small></button>' +
          '<button class="ms-rate__btn ms-rate__btn--hard"  data-rate="hard"  type="button">Hard<small>'  + previewLabel(QUALITY.hard)  + '</small></button>' +
          '<button class="ms-rate__btn ms-rate__btn--good"  data-rate="good"  type="button">Good<small>'  + previewLabel(QUALITY.good)  + '</small></button>' +
          '<button class="ms-rate__btn ms-rate__btn--easy"  data-rate="easy"  type="button">Easy<small>'  + previewLabel(QUALITY.easy)  + '</small></button>' +
        '</div>';
    }

    function render() {
      var now = Date.now();
      var c = counts(now);
      current = pickNext();
      revealed = false;

      var bar = '' +
        '<div class="ms-srs__bar">' +
          '<span class="ms-badge ms-badge--due">' + c.due + ' due</span>' +
          (deckMeta(deckId).introducedToday < NEW_PER_DAY
            ? '<span class="ms-badge ms-badge--new">' + Math.min(c.fresh, NEW_PER_DAY - deckMeta(deckId).introducedToday) + ' new</span>'
            : '') +
          '<span class="ms-badge ms-badge--mature">' + c.mature + ' mature</span>' +
          '<span class="ms-spacer"></span>' +
          '<span class="ms-badge">' + c.learned + '/' + c.total + ' learned</span>' +
        '</div>';

      if (!current) {
        mount.innerHTML = bar +
          '<div class="ms-srs__empty">' +
            '<strong>All caught up 🎉</strong>' +
            '<p class="muted">No cards are due right now. Spacing is working — come back later and the next reviews will be waiting.</p>' +
          '</div>';
        return;
      }

      mount.innerHTML = bar +
        '<div class="ms-card">' +
          '<div class="ms-card__topic">' + escapeHTML(current.topic || '') + (isNew(current) ? ' · new' : '') + '</div>' +
          '<div class="ms-card__face ms-card__front">' + (current.front || '') + '</div>' +
          '<div class="ms-card__back-wrap" hidden>' +
            '<hr class="ms-card__divider">' +
            '<div class="ms-card__face ms-card__back">' + (current.back || '') + '</div>' +
          '</div>' +
          '<div class="ms-card__actions">' +
            '<button class="ms-btn ms-srs__reveal" type="button" data-act="reveal">Show answer</button>' +
          '</div>' +
        '</div>';
    }

    function reveal() {
      revealed = true;
      var wrap = $('.ms-card__back-wrap', mount);
      var actions = $('.ms-card__actions', mount);
      if (wrap) { wrap.hidden = false; }
      if (actions) { actions.innerHTML = ratingButtons(current); }
    }

    function rate(name) {
      if (!current) { return; }
      var q = QUALITY[name];
      if (q === undefined) { return; }
      var prev = schedFor(current);
      var wasNew = !prev;
      var next = sm2(prev, q, Date.now());
      progress.recordSrs(current.topic, current.id, next);
      if (wasNew) {
        var meta = deckMeta(deckId);
        meta.introducedToday = (meta.introducedToday || 0) + 1;
        saveDeckMeta(deckId, meta);
      }
      render();
    }

    // Delegated clicks inside the mount.
    mount.addEventListener('click', function (e) {
      var revealBtn = e.target.closest('[data-act="reveal"]');
      if (revealBtn) { reveal(); return; }
      var rateBtn = e.target.closest('[data-rate]');
      if (rateBtn) { rate(rateBtn.getAttribute('data-rate')); return; }
    });

    // Keyboard: space/enter reveals; 1-4 rate when revealed.
    mount.setAttribute('tabindex', '0');
    mount.addEventListener('keydown', function (e) {
      if (!current) { return; }
      if (!revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); return; }
      if (revealed) {
        var m = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
        if (m[e.key]) { e.preventDefault(); rate(m[e.key]); }
      }
    });

    render();
    return { render: render, reveal: reveal, rate: rate, counts: function () { return counts(Date.now()); } };
  }

  /* =====================================================================
     C. CHALLENGES — delegated "Mark solved ✓ / Reset" for [data-challenge]
     ===================================================================== */

  function buildSolveControl(block) {
    if (block.querySelector('.ms-solve')) { return; } // already wired
    var id = block.getAttribute('data-challenge');
    var topic = block.getAttribute('data-topic') || '';
    if (!id) { return; }
    if (!topic) {
      // The contract requires every [data-challenge] to also carry [data-topic];
      // without it the solve records but never moves any topic's mastery.
      console.warn('MASTERY: [data-challenge="' + id + '"] is missing data-topic — its solve will not contribute to any topic mastery.', block);
    }

    var bar = document.createElement('div');
    bar.className = 'ms-solve no-print';
    bar.setAttribute('data-challenge-ctl', id);
    bar.innerHTML =
      '<span class="ms-solve__state"><span class="ms-tick">✓</span><span class="ms-solve__text">Not solved yet</span></span>' +
      '<span class="ms-spacer"></span>' +
      '<button class="ms-btn ms-btn--sm ms-solve__btn" type="button" data-solve="' + escapeHTML(id) + '" data-solve-topic="' + escapeHTML(topic) + '">Mark solved ✓</button>' +
      '<button class="ms-btn ms-btn--ghost ms-btn--sm ms-solve__reset" type="button" data-unsolve="' + escapeHTML(id) + '" hidden>Reset</button>';
    block.appendChild(bar);
    reflectSolve(block);
  }

  function reflectSolve(block) {
    var id = block.getAttribute('data-challenge');
    var bar = block.querySelector('.ms-solve');
    if (!bar) { return; }
    var solved = progress.isSolved(id);
    bar.classList.toggle('is-solved', solved);
    var text = bar.querySelector('.ms-solve__text');
    var solveBtn = bar.querySelector('[data-solve]');
    var resetBtn = bar.querySelector('[data-unsolve]');
    if (text) { text.textContent = solved ? 'Solved' : 'Not solved yet'; }
    if (solveBtn) { solveBtn.hidden = solved; }
    if (resetBtn) { resetBtn.hidden = !solved; }
  }

  function challenges(root) {
    root = root || document;
    // Build a control on each challenge block.
    $all('[data-challenge]', root).forEach(buildSolveControl);

    // One delegated handler for the whole document (idempotent).
    if (!challenges._wired) {
      challenges._wired = true;
      document.addEventListener('click', function (e) {
        var solveBtn = e.target.closest('[data-solve]');
        if (solveBtn) {
          var id = solveBtn.getAttribute('data-solve');
          var topic = solveBtn.getAttribute('data-solve-topic');
          progress.markSolved(id, topic);
          var block = solveBtn.closest('[data-challenge]');
          if (block) { reflectSolve(block); }
          return;
        }
        var unsolveBtn = e.target.closest('[data-unsolve]');
        if (unsolveBtn) {
          var uid = unsolveBtn.getAttribute('data-unsolve');
          progress.unsolve(uid);
          var b2 = unsolveBtn.closest('[data-challenge]');
          if (b2) { reflectSolve(b2); }
          return;
        }
      });

      // Keep controls in sync if progress changes elsewhere (e.g. another widget).
      document.addEventListener('mastery:change', function () {
        $all('[data-challenge]').forEach(reflectSolve);
      });
    }
  }

  /* =====================================================================
     D. MAP — skill-tree / learning-path coloured by topicMastery
     ===================================================================== */

  // Node geometry
  var COL_W = 188;   // horizontal gap between unit columns
  var ROW_H = 96;    // vertical gap between rows within a unit
  var NODE_W = 156;
  var PAD_L = 96;    // left rail for unit labels
  var PAD_T = 16;

  function map(mountSelector, source) {
    var mount = resolveMount(mountSelector);
    if (!mount) { console.warn('MASTERY.map: mount not found', mountSelector); return null; }
    var tree = resolveData(source);
    if (!tree || !tree.nodes || !tree.nodes.length) {
      console.warn('MASTERY.map: no tree data'); return null;
    }

    var nodes = tree.nodes;
    var byId = {};
    nodes.forEach(function (n) { byId[n.id] = n; });

    // Group by unit, preserving first-seen order of units.
    var unitOrder = [];
    var byUnit = {};
    nodes.forEach(function (n) {
      var u = (n.unit === undefined || n.unit === null) ? '' : String(n.unit);
      if (!byUnit[u]) { byUnit[u] = []; unitOrder.push(u); }
      byUnit[u].push(n);
    });

    // Assign each node a column (its unit index) and a row (its order in unit).
    var pos = {};
    var maxRows = 0;
    unitOrder.forEach(function (u, col) {
      byUnit[u].forEach(function (n, row) {
        pos[n.id] = {
          x: PAD_L + col * COL_W,
          y: PAD_T + row * ROW_H + 24 // +24 for the lane label
        };
      });
      maxRows = Math.max(maxRows, byUnit[u].length);
    });

    var width = PAD_L + unitOrder.length * COL_W;
    var height = PAD_T + 24 + maxRows * ROW_H;

    mount.classList.add('ms-map');

    function nodeState(n) {
      // locked if any prereq isn't mastered yet; else by this topic's mastery.
      var prereqs = n.prereqs || [];
      var unmet = prereqs.some(function (pid) {
        var pn = byId[pid];
        if (!pn) { return false; }
        return progress.topicMastery(pn.topic) < 80; // prereq considered "cleared" at 80%
      });
      var pct = progress.topicMastery(n.topic);
      if (unmet && pct < 80) { return { state: 'locked', pct: pct }; }
      if (pct >= 80) { return { state: 'mastered', pct: pct }; }
      return { state: 'progress', pct: pct };
    }

    function draw() {
      var legend =
        '<div class="ms-map__legend no-print">' +
          '<span><i class="ms-i-locked"></i> Locked (finish prerequisites)</span>' +
          '<span><i class="ms-i-progress"></i> In progress</span>' +
          '<span><i class="ms-i-mastered"></i> Mastered</span>' +
        '</div>';

      // Edges as an SVG layer underneath the nodes.
      var edgeSVG = '';
      nodes.forEach(function (n) {
        (n.prereqs || []).forEach(function (pid) {
          var a = pos[pid], b = pos[n.id];
          if (!a || !b) { return; }
          var ax = a.x + NODE_W, ay = a.y + 22;
          var bx = b.x, by = b.y + 22;
          var mx = (ax + bx) / 2;
          var cleared = progress.topicMastery((byId[pid] || {}).topic) >= 80;
          edgeSVG += '<path class="ms-map__edge' + (cleared ? ' is-cleared' : '') + '" d="M' +
            ax + ',' + ay + ' C' + mx + ',' + ay + ' ' + mx + ',' + by + ' ' + bx + ',' + by + '"></path>';
        });
      });

      // Unit lane labels.
      var lanes = '';
      unitOrder.forEach(function (u, col) {
        if (u === '') { return; }
        lanes += '<div class="ms-map__lane" style="left:' + (PAD_L + col * COL_W) + 'px;top:0">' +
          'Unit ' + escapeHTML(u) + '</div>';
      });

      // Nodes.
      var nodeHTML = '';
      nodes.forEach(function (n) {
        var p = pos[n.id];
        var s = nodeState(n);
        var locked = s.state === 'locked';
        var cls = 'ms-node is-' + s.state;
        var attrs = 'style="left:' + p.x + 'px;top:' + p.y + 'px"';
        var inner =
          '<span class="ms-node__label">' + escapeHTML(n.label || n.id) + '</span>' +
          '<span class="ms-node__meta">' +
            '<span class="ms-node__ring"></span>' +
            '<span>' + escapeHTML(n.topic || '') + '</span>' +
            '<span class="ms-node__pct">' + s.pct + '%</span>' +
          '</span>';
        if (locked || !n.href) {
          nodeHTML += '<div class="' + cls + '" ' + attrs +
            (locked ? ' aria-disabled="true" title="Finish prerequisites to unlock"' : '') +
            ' data-node="' + escapeHTML(n.id) + '">' + inner + '</div>';
        } else {
          nodeHTML += '<a class="' + cls + '" ' + attrs + ' href="' + escapeHTML(n.href) + '"' +
            ' data-node="' + escapeHTML(n.id) + '">' + inner + '</a>';
        }
      });

      mount.innerHTML =
        legend +
        '<div class="ms-map__canvas" style="height:' + height + 'px;min-width:' + width + 'px">' +
          '<svg class="ms-map__edges" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-hidden="true">' +
            edgeSVG +
          '</svg>' +
          lanes +
          nodeHTML +
        '</div>';
    }

    draw();
    // Live-update when any progress signal changes.
    document.addEventListener('mastery:change', draw);
    return { redraw: draw };
  }

  /* =====================================================================
     E. REVEAL — delegated spoiler / debug-answer toggles
     ===================================================================== */

  function reveal(root) {
    root = root || document;

    // Upgrade .ms-reveal blocks that use a header button pattern (optional).
    $all('.ms-reveal', root).forEach(function (block) {
      var btn = block.querySelector('.ms-reveal__btn');
      if (btn && !btn.hasAttribute('aria-expanded')) {
        btn.setAttribute('aria-expanded', block.classList.contains('is-open') ? 'true' : 'false');
      }
    });

    if (!reveal._wired) {
      reveal._wired = true;
      document.addEventListener('click', function (e) {
        // .ms-reveal accordion-style block
        var head = e.target.closest('.ms-reveal__btn');
        if (head) {
          var block = head.closest('.ms-reveal');
          if (block) {
            var open = block.classList.toggle('is-open');
            head.setAttribute('aria-expanded', open ? 'true' : 'false');
          }
          return;
        }
        // inline [data-reveal] spoiler — click to toggle blur
        var sp = e.target.closest('[data-reveal]');
        if (sp && !sp.classList.contains('ms-reveal')) {
          sp.classList.toggle('is-open');
        }
      });

      // Keyboard activation for inline spoilers.
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') { return; }
        var t = e.target;
        if (t && t.matches && t.matches('[data-reveal]') && !t.classList.contains('ms-reveal')) {
          e.preventDefault();
          t.classList.toggle('is-open');
        }
      });
    }

    // Make inline spoilers focusable / accessible.
    $all('[data-reveal]', root).forEach(function (sp) {
      if (sp.classList.contains('ms-reveal')) { return; }
      sp.classList.add('ms-spoiler');
      if (!sp.hasAttribute('tabindex')) { sp.setAttribute('tabindex', '0'); }
      if (!sp.hasAttribute('role')) { sp.setAttribute('role', 'button'); }
      if (!sp.hasAttribute('aria-label')) { sp.setAttribute('aria-label', 'Reveal hidden answer'); }
    });
  }

  /* =====================================================================
     STAT STRIP helper — optional convenience renderer
     ===================================================================== */

  function renderStats(mountSelector) {
    var mount = resolveMount(mountSelector);
    if (!mount) { return null; }

    function draw() {
      var pct = progress.globalPercent();
      var st = progress.streak();
      var solved = progress.solvedCount();
      mount.innerHTML =
        '<div class="ms-stats">' +
          '<div class="ms-stat ms-stat--mastery">' +
            '<span class="ms-stat__num">' + pct + '%</span>' +
            '<span class="ms-stat__label">Your mastery</span>' +
            '<div class="ms-meter"><span class="ms-meter__fill" style="width:' + pct + '%"></span></div>' +
          '</div>' +
          '<div class="ms-stat ms-stat--streak">' +
            '<span class="ms-stat__num">' + st.current + '</span>' +
            '<span class="ms-stat__label">Day streak</span>' +
            '<span class="ms-stat__sub">' + (st.today ? 'studied today ✓' : 'study today to keep it') + '</span>' +
          '</div>' +
          '<div class="ms-stat">' +
            '<span class="ms-stat__num">' + solved + '</span>' +
            '<span class="ms-stat__label">Challenges solved</span>' +
            '<span class="ms-stat__sub">longest streak: ' + st.longest + 'd</span>' +
          '</div>' +
        '</div>';
    }
    draw();
    document.addEventListener('mastery:change', draw);
    return { redraw: draw };
  }

  /* =====================================================================
     PUBLIC API + AUTO-INIT
     ===================================================================== */

  var MASTERY = {
    version: '1.0.0',
    progress: progress,
    srs: srs,
    challenges: challenges,
    map: map,
    reveal: reveal,
    stats: renderStats,
    // expose the pure scheduler for testing / advanced use
    _sm2: sm2,
    _util: { todayKey: todayKey, dayNumber: dayNumber, escapeHTML: escapeHTML, resolveData: resolveData }
  };

  function autoInit() {
    // Global delegated behaviors.
    challenges(document);
    reveal(document);

    // Auto-mount any declarative SRS decks: <div data-srs="deckScriptId"></div>
    $all('[data-srs]').forEach(function (host) {
      srs(host, host.getAttribute('data-srs'));
    });

    // Auto-mount any declarative skill maps: <div data-skillmap="treeScriptId"></div>
    $all('[data-skillmap]').forEach(function (host) {
      map(host, host.getAttribute('data-skillmap'));
    });

    // Auto-render any stat strips: <div data-mastery-stats></div>
    $all('[data-mastery-stats]').forEach(function (host) {
      renderStats(host);
    });
  }

  window.MASTERY = MASTERY;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
