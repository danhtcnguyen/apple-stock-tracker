# Implementation Plan: Apple Stock Tracker (bookmarklet)

## Overview

Build the in-tab checker described in [SPEC.md](../SPEC.md): `checker.js` runs inside my
own apple.com tab via a bookmarklet, polls the pickup endpoint for all 8 unlocked iPhone
Duo models near 75010 every ~60 s, and sends an ntfy push when one appears within
15 miles. Tasks are in [todo.md](todo.md).

The first plan (Python + Playwright on the Mac) was dropped on 2026-10-28: Apple
answers automated clients with HTTP 541, and getting around that is out of bounds.

## Architecture Decisions

- **One self-contained function.** `stockChecker(config)` holds everything, because a
  bookmarklet is a single serialized expression. `install.html` builds
  `javascript:(<stockChecker source>)(<config JSON>)`.
- **Pure helpers vs effects.** Parsing, filtering, transitions, backoff and payload
  building are pure functions inside `stockChecker`. `exposeInternals: true` returns them
  for Node tests without touching the DOM or network.
- **State in the page's localStorage** (apple.com origin), so a reload doesn't re-alert.
- **ntfy JSON publish with a plain-text body**, a "simple" CORS request with no preflight.
- **Fixture from a real response**, trimmed to the fields we use.

## Task List

- [x] Task 1: Pure helpers + tests, from a real fixture
- [x] Task 2: Runtime: loop, backoff, alerts, panel
- [x] Task 3: install.html bookmarklet generator
- [x] Checkpoint: works on apple.com in a real browser; test push reached ntfy (your phone not yet checked)
- [x] Task 4: README, .gitignore, old Python/Playwright code removed
- [ ] Checkpoint: 1-hour background-tab run; all success criteria met

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Chrome discards or freezes the background tab | High | README: exclude apple.com from Memory Saver; panel shows last check time |
| Mac sleeps | Med | README: keep awake while tracking (e.g. `caffeinate -d`) |
| Apple starts rejecting even in-tab checks | Med | Backoff + "checker is failing" push; 60 s default |
| Response format changes | Med | Parser errors count as failures, so the failing push fires |
| Bookmarklet too long for the browser | Low | Code is a few KB; Chrome allows much longer URLs |
