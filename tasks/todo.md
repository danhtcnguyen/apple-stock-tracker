# Tasks: Apple Stock Tracker (bookmarklet)

See [plan.md](plan.md) and [SPEC.md](../SPEC.md).

## Task 1: Pure helpers + tests
- Acceptance: build URL; parse a real response into `{storeNumber, storeName, miles, part, available, quote}`;
  distance filter; new-arrival / sell-out detection; backoff; ntfy payload; config validation.
  All 8 part numbers appear in a real response.
- Verify: `node --test tests/`
- Files: `checker.js`, `tests/checker.test.js`, `tests/fixtures/*.json`

## Task 2: Runtime
- Acceptance: one request per interval with jitter; backoff and failing/recovered pushes;
  alerts saved to localStorage; panel with status, stores × models, Stop and Test buttons;
  a second click toggles the panel instead of starting a second checker; refuses to run off apple.com.
- Verify: `node --test tests/`; run in the built-in browser on apple.com and compare with Apple's pickup panel
- Files: `checker.js`

## Task 3: install.html
- Acceptance: form (topic, ZIP, miles, interval, models) → draggable bookmarklet link; random topic suggested; inputs validated.
- Verify: open the page, generate the link, run its code on apple.com
- Files: `install.html`

## Checkpoint A
- [ ] Panel matches Apple's own pickup panel for 75010
- [ ] Test push reaches your phone

## Task 4: Docs and cleanup
- Acceptance: README (install, keep the tab alive, troubleshooting); `.gitignore`; old `tracker/`, `config*.json`,
  `.venv` and the Playwright browser cache removed.
- Verify: walk through the README

## Checkpoint B
- [ ] 1-hour background-tab run, checks about once a minute, no console errors
- [ ] All SPEC.md success criteria met
