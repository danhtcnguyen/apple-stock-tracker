# Spec: Apple Stock Tracker (iPhone Duo pickup alerts)

## Objective

A personal tool that watches Apple Store **in-store pickup** stock for the **iPhone Duo**
near ZIP **75010** and sends a **push notification to my phone (ntfy)** when a watched
model becomes available at a store within **25 miles**.

One user (me). No server, no accounts. It runs as a **bookmarklet in my own apple.com
browser tab**: I open apple.com, click the bookmark, and leave the tab open.

### User stories

- As the user, I pick which iPhone Duo models I care about, so I'm only alerted for
  phones I'd actually buy.
- As the user, I get a phone push within about a minute of a model appearing for pickup
  nearby, with the store, the model and a link to buy, so I can reserve it in time.
- As the user, I get one alert when stock appears, not one per check.
- As the user, I can glance at the apple.com tab and see when the last check ran, what's
  in stock nearby, and whether checks are failing.

## Why a bookmarklet (decided 2026-10-28)

Apple has no official stock API. The buy page calls an unofficial endpoint, which Apple
only answers for a person's real browser session. Automated clients get HTTP 541:
Python `urllib` and headless Chromium (Playwright) were both rejected, even with the
exact parameters below. Getting past that would mean evading Apple's bot detection,
which is out of bounds. Running in my own open tab uses the same session Apple's page
uses, at a gentle rate.

Apple's store pages send only `Content-Security-Policy: frame-ancestors 'none'`, so a
script on the page can POST to ntfy.sh.

## The data source (verified in a real browser 2026-10-28)

```
GET /shop/fulfillment-messages?fae=true&pl=true&mts.0=regular
    &cppart=UNLOCKED/US&parts.0=MK1F4LL/A&parts.1=MK1E4LL/A&location=75010
```

Response: `body.content.pickupMessage.stores[]` with `storeName`, `storeNumber`
(`R746`), `storeDistanceWithUnit` (`"7.83 mi"`) and `partsAvailability[<part>]` →
`pickupDisplay` (`"available"`/`"unavailable"`), `pickupSearchQuote`. It returns the
12 nearest stores. Several parts per request work.

Stores within 25 mi of 75010: **Galleria Dallas (R746, 7.8 mi)**, **NorthPark Center
(R144, 12.8 mi)**, **Knox Street (R042, 15.4 mi)**, **Southlake Town Square (R151, 16.1 mi)**.

| Storage | Star White | Night Sky | Price |
|---|---|---|---|
| 256GB | MK1E4LL/A | MK1F4LL/A | $1,999 |
| 512GB | MK1G4LL/A | MK1H4LL/A | $2,199 |
| 1TB   | MK1J4LL/A† | MK1L4LL/A | $2,599 |
| 2TB   | MK1Q4LL/A | MK1R4LL/A† | $3,199 |

† Inferred from the page's product list; confirmed when the first real check returns them.

## Behavior

- **Install page** (`install.html`, opened locally): enter the ntfy topic, ZIP and max miles,
  tick models, and get a "Duo Checker" link to drag to the bookmarks bar. Settings are
  baked into the bookmarklet.
- **Start:** click the bookmark on any `www.apple.com` page. Clicking it on another site
  shows a message instead. Clicking it again while running toggles the panel; it never
  starts a second checker.
- **Polling:** one request per check for all watched parts. Default interval **60 s**
  (minimum 30 s; below about 60 s only takes effect while the tab is in front), ±20% jitter. (Chrome throttles background-tab timers to about once a
  minute anyway.)
- **Backoff:** on a non-200 response, bad JSON or a network error, double the interval
  (cap 10 min); reset after a success. After 10 consecutive failures, send one ntfy
  "checker is failing" push, then one "recovered" push when checks work again.
- **Alert rule:** push when a (store, part) within max miles goes from not-available to
  available. No repeat while it stays available. Last-seen state is kept in the page's
  `localStorage`, so reloading the tab and restarting doesn't re-alert.
- **Push:** ntfy JSON publish (`POST https://ntfy.sh/`). Title like
  `iPhone Duo 256GB Night Sky at Galleria Dallas`, message with distance and Apple's
  pickup text, click URL to the model's buy page, priority 5 (urgent), tag `iphone`.
- **Panel:** small fixed box in the page corner showing last check time, next check,
  nearby stores × models (available highlighted), last error, and Stop and
  Test-notification buttons.
- The page title gets a `🟢` prefix while something is available, so it's visible from the tab strip.

## Tech Stack

- Plain browser JavaScript (ES2022), no dependencies, no build step.
- `install.html` loads `checker.js` and turns its `stockChecker` function into a
  `javascript:` bookmarklet URL.
- Tests: Node 24's built-in test runner (`node --test`).

## Commands

```
Tests:   node --test tests/
Install: open install.html        # then drag the link to the bookmarks bar
```

## Project Structure

```
checker.js        → stockChecker(config): the whole in-page checker (self-contained;
                    everything it uses is defined inside it, because it's serialized
                    into the bookmarklet)
install.html      → settings form + generated bookmarklet link
tests/
  checker.test.js → unit tests for the pure helpers
  fixtures/       → real Apple response (unavailable) + a copy with one part available
README.md
SPEC.md
```

## Code Style

```js
function newArrivals(seen, results) {
  // Available now, and not already reported as available last time.
  return results.filter((r) => r.available && !seen[key(r)]);
}
```

- `const`/`let`, arrow functions for callbacks, no classes, no globals except
  `window.__duoChecker` (the running instance).
- Pure helpers (parse, filter, transitions, backoff) don't touch the DOM or network, so
  `stockChecker({ ...config, exposeInternals: true })` returns them for tests without starting.

## Testing Strategy

- **Unit (node --test):** URL building, parsing the real fixture, miles parsing, distance
  filter, new-arrival and sell-out detection, backoff math, ntfy payload, config validation.
- **Manual:** run the bookmarklet on apple.com in a real browser; confirm the panel
  matches Apple's pickup panel and a test push reaches the phone.

## Boundaries

- **Always:** at most one request per interval; honor backoff; run tests before calling a
  task done.
- **Ask first:** intervals below 30 s; extra notification channels; adding dependencies.
- **Never:** add to bag or buy; touch Apple ID or sign-in; disguise automation or work
  around Apple's bot detection; commit the ntfy topic.

## Success Criteria

1. On apple.com, the panel lists the 4 stores within 25 mi with a status for all
   8 models, matching Apple's own pickup panel for 75010.
2. The Test-notification button delivers a push to the ntfy app on my phone.
3. With the available-fixture: exactly one alert; same input again: none; a store at 16 mi:
   none; after reload with saved state: none.
4. A simulated 541 doubles the interval, and a later success resets it.
5. The checker runs in a background tab for 1 hour with checks about once a minute and no
   errors in the console.
6. `node --test tests/` passes.

## Decisions

1. Models: all 8. Carrier: unlocked only (`UNLOCKED/US`).
2. Sell-out pushes: off by default.
3. Delivery: bookmarklet (no extension, no server).
