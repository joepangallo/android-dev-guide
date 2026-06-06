# COP4667 — Android Development · Interactive Teaching Guide

A self-contained, interactive teaching guide for **COP4667 Android Development** (Keiser University, B.S. Software Engineering). Built with plain HTML/CSS/JS — no build step, no dependencies.

**▶ Live site:** https://joepangallo.github.io/cop4667-android-guide/

## What's inside

- **12 session plans** across 4 weeks (Kotlin + Jetpack Compose + Material 3) — objectives, lecture notes, guided live-coding, hands-on labs, assessments, and a "Master It" deep-practice section per session.
- **6 interactive concept labs** — lifecycle explorer, intents navigator, Compose playground, Kotlin cheat sheet, SQLite/Room CRUD simulator, networking pipeline visualizer.
- **Self-directed practice** — auto-checked coding challenges (live Kotlin), debug drills, a project ladder, and an SM-2 spaced-repetition deck, all feeding a personal mastery skill-tree.
- **Assessments** — pre-test, Quiz 1, post-test (normalized-gain comparison), and a key-terms flashcard deck.
- Maps to all **6 course learning outcomes (CLOs)**; targets Android 16 / API 36, current Compose/Retrofit/Room.

## Running it locally

Everything works by opening `index.html` directly **except** the live "Run" buttons, which need an `http://` origin (the Kotlin compiler blocks `file://`). To enable live Run:

```bash
# from this folder:
python3 -m http.server 8765
# then open http://localhost:8765
```

…or just **double-click `serve.command`** (macOS).

## Accessibility & themes

WCAG 2.2 AA color contrast, full keyboard support, ARIA-wired tabs/accordions, a focus-trapped present mode, light/dark themes, and print styles.
