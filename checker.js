// Apple Store pickup stock checker. Runs inside your own apple.com tab via the bookmarklet
// that install.html builds. See SPEC.md.
//
// Everything stockChecker uses is defined inside it: its source text is what goes into the
// bookmarklet, so it can't reach anything outside itself.
function stockChecker(config) {
  const MIN_INTERVAL_SECONDS = 30;
  const MAX_BACKOFF_SECONDS = 600;
  const FAILURE_ALERT_AFTER = 10;
  const STORAGE_KEY = "duoChecker.seen";
  const BUY_URL = "https://www.apple.com/shop/buy-iphone/iphone-duo";
  const NTFY_URL = "https://ntfy.sh/";

  // ---- Pure helpers (no DOM, no network) ----

  function validateConfig(c) {
    const fail = (msg) => { throw new Error(msg); };
    if (!c || typeof c !== "object") fail("settings are missing");
    if (!/^\d{5}$/.test(String(c.zip))) fail(`zip must be a 5-digit US ZIP code, got "${c.zip}"`);
    const maxMiles = Number(c.maxMiles);
    if (!(maxMiles > 0)) fail("maxMiles must be a positive number");
    const interval = Number(c.intervalSeconds);
    if (!Number.isInteger(interval) || interval < MIN_INTERVAL_SECONDS) fail(`intervalSeconds must be a whole number >= ${MIN_INTERVAL_SECONDS}`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(c.ntfyTopic || "")) fail("ntfyTopic must be 1-64 letters, digits, '-' or '_'");
    if (!Array.isArray(c.watch) || c.watch.length === 0) fail("pick at least one model to watch");
    c.watch.forEach((w, i) => {
      if (!w || !w.part || !w.name) fail(`watch[${i}] needs a part and a name`);
    });
    return {
      zip: String(c.zip),
      maxMiles,
      intervalSeconds: interval,
      ntfyTopic: c.ntfyTopic,
      carrier: c.carrier || "UNLOCKED/US",
      notifyOnSellout: Boolean(c.notifyOnSellout),
      watch: c.watch.map((w) => ({ part: w.part, name: w.name })),
    };
  }

  function buildUrl(parts, carrier, zip) {
    const params = new URLSearchParams({ fae: "true", pl: "true", "mts.0": "regular", cppart: carrier });
    parts.forEach((part, i) => params.append(`parts.${i}`, part));
    params.append("location", zip);
    return `/shop/fulfillment-messages?${params.toString().replaceAll("%2F", "/")}`;
  }

  function parseMiles(text) {
    // "7.83 mi" -> 7.83. Unknown distances never pass the distance filter.
    const match = /^\s*([\d.]+)\s*mi\b/.exec(text || "");
    return match ? Number(match[1]) : Infinity;
  }

  function parseResponse(data) {
    const stores = data?.body?.content?.pickupMessage?.stores;
    if (!Array.isArray(stores)) throw new Error("unexpected response format: no pickup stores");
    return stores.flatMap((store) =>
      Object.entries(store.partsAvailability || {}).map(([part, info]) => ({
        storeNumber: store.storeNumber,
        storeName: store.storeName,
        miles: parseMiles(store.storeDistanceWithUnit),
        part,
        available: info.pickupDisplay === "available",
        quote: info.pickupSearchQuote || "",
      })),
    );
  }

  const key = (r) => `${r.storeNumber}|${r.part}`;

  function nearby(results, maxMiles) {
    return results.filter((r) => r.miles <= maxMiles);
  }

  function changes(seen, results) {
    // seen: { "R746|MK1F4LL/A": true } for everything that was available at the last check.
    return {
      arrivals: results.filter((r) => r.available && !seen[key(r)]),
      sellouts: results.filter((r) => !r.available && seen[key(r)]),
    };
  }

  function nextSeen(results, unsent = []) {
    // Arrivals whose push failed stay unseen, so the next check tries again.
    const skip = new Set(unsent.map(key));
    return Object.fromEntries(results.filter((r) => r.available && !skip.has(key(r))).map((r) => [key(r), true]));
  }

  function nextInterval(baseSeconds, failures) {
    return failures === 0 ? baseSeconds : Math.min(baseSeconds * 2 ** failures, MAX_BACKOFF_SECONDS);
  }

  function jitter(seconds, random = Math.random) {
    return seconds * (0.8 + 0.4 * random());
  }

  function arrivalMessage(item, names) {
    return {
      title: `${names[item.part] || item.part} at ${item.storeName}`,
      message: `Available for pickup ${item.miles.toFixed(1)} mi away. Apple says: ${item.quote}`,
      click: BUY_URL,
      priority: 5,
      tags: ["iphone"],
    };
  }

  function selloutMessage(item, names) {
    return {
      title: `${names[item.part] || item.part} sold out at ${item.storeName}`,
      message: "No longer available for pickup.",
      priority: 3,
      tags: ["x"],
    };
  }

  function statusMessage(title, message, priority = 4) {
    return { title, message, priority, tags: ["warning"] };
  }

  if (config && config.exposeInternals) {
    return {
      validateConfig, buildUrl, parseMiles, parseResponse, nearby, changes, nextSeen,
      nextInterval, jitter, arrivalMessage, selloutMessage, statusMessage,
    };
  }

  // ---- Runtime (in the apple.com tab) ----

  if (window.__duoChecker) {
    window.__duoChecker.togglePanel();
    return;
  }
  if (location.hostname !== "www.apple.com") {
    alert("Duo Checker: open www.apple.com in this tab first, then click the bookmark again.");
    return;
  }
  let cfg;
  try {
    cfg = validateConfig(config);
  } catch (e) {
    alert(`Duo Checker settings problem: ${e.message}. Make a new bookmark from install.html.`);
    return;
  }

  const names = Object.fromEntries(cfg.watch.map((w) => [w.part, w.name]));
  const originalTitle = document.title;
  const state = {
    seen: loadSeen(),
    results: [],
    failures: 0,
    failureAlertSent: false,
    lastCheck: null,
    nextCheck: null,
    lastError: null,
    timer: null,
    renderTimer: null,
  };

  function loadSeen() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  function saveSeen() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.seen));
    } catch (e) {
      console.warn("[Duo Checker] could not save state:", e);
    }
  }

  async function publish(msg) {
    try {
      // A plain-text body keeps this a "simple" cross-origin request (no CORS preflight).
      const response = await fetch(NTFY_URL, { method: "POST", body: JSON.stringify({ topic: cfg.ntfyTopic, ...msg }) });
      if (!response.ok) throw new Error(`ntfy returned HTTP ${response.status}`);
      return true;
    } catch (e) {
      console.warn("[Duo Checker] push failed:", e);
      state.lastError = `push failed: ${e.message}`;
      return false;
    }
  }

  async function fetchNearby() {
    const url = buildUrl(cfg.watch.map((w) => w.part), cfg.carrier, cfg.zip);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Apple returned HTTP ${response.status}`);
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Apple returned a response that isn't JSON");
    }
    return nearby(parseResponse(data), cfg.maxMiles);
  }

  async function tick() {
    try {
      const results = await fetchNearby();
      if (state.failureAlertSent) await publish(statusMessage("Duo Checker recovered", "Stock checks are working again.", 3));
      state.failures = 0;
      state.failureAlertSent = false;
      state.lastError = null;

      const { arrivals, sellouts } = changes(state.seen, results);
      const unsent = [];
      for (const item of arrivals) {
        if (!(await publish(arrivalMessage(item, names)))) unsent.push(item);
      }
      if (cfg.notifyOnSellout) {
        for (const item of sellouts) await publish(selloutMessage(item, names));
      }
      state.seen = nextSeen(results, unsent);
      saveSeen();
      state.results = results;
    } catch (e) {
      state.failures += 1;
      state.lastError = e.message;
      console.warn("[Duo Checker] check failed:", e);
      if (state.failures >= FAILURE_ALERT_AFTER && !state.failureAlertSent) {
        state.failureAlertSent = await publish(
          statusMessage("Duo Checker: checks are failing", `${state.failures} failed checks in a row. Last error: ${e.message}`),
        );
      }
    }
    state.lastCheck = new Date();
    schedule();
    render();
  }

  function schedule() {
    const seconds = jitter(nextInterval(cfg.intervalSeconds, state.failures));
    state.nextCheck = new Date(Date.now() + seconds * 1000);
    state.timer = setTimeout(tick, seconds * 1000);
  }

  // ---- Panel ----

  function el(tag, style, ...children) {
    const node = document.createElement(tag);
    Object.assign(node.style, style);
    node.append(...children);
    return node;
  }

  function button(label, onClick) {
    const b = el("button", { font: "inherit", padding: "4px 10px", marginRight: "6px", borderRadius: "6px", border: "1px solid #bbb", background: "#f5f5f7", color: "#1d1d1f", cursor: "pointer" }, label);
    b.addEventListener("click", onClick);
    return b;
  }

  const panel = el("div", {
    position: "fixed", right: "16px", bottom: "16px", zIndex: "2147483647", width: "320px", maxHeight: "60vh", overflowY: "auto",
    background: "#fff", color: "#1d1d1f", border: "1px solid #d2d2d7", borderRadius: "12px", boxShadow: "0 8px 30px rgba(0,0,0,.18)",
    font: "13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif", padding: "12px 14px",
  });
  const body = el("div", {});
  const testButton = button("Test notification", async () => {
    testButton.disabled = true;
    const ok = await publish(statusMessage("Duo Checker test", "Notifications are working.", 3));
    testButton.textContent = ok ? "Sent ✓" : "Failed ✗";
    setTimeout(() => { testButton.textContent = "Test notification"; testButton.disabled = false; }, 3000);
    render();
  });
  panel.append(
    el("div", { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" },
      el("strong", { fontSize: "14px" }, "Duo Checker"),
      button("Hide", () => togglePanel())),
    body,
    el("div", { marginTop: "10px" }, testButton, button("Stop", () => stop())),
  );
  document.body.append(panel);

  function render() {
    const now = Date.now();
    const time = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const lines = [];
    lines.push(el("div", { color: "#6e6e73" },
      state.lastCheck ? `Last check ${time(state.lastCheck)}` : "First check running…",
      state.nextCheck ? ` · next in ${Math.max(0, Math.round((state.nextCheck - now) / 1000))}s` : ""));
    if (state.lastError) lines.push(el("div", { color: "#d70015" }, `⚠ ${state.lastError}${state.failures ? ` (${state.failures} in a row)` : ""}`));

    const stores = [...new Map(state.results.map((r) => [r.storeNumber, r])).values()].sort((a, b) => a.miles - b.miles);
    if (state.lastCheck && stores.length === 0 && !state.lastError) {
      lines.push(el("div", { marginTop: "8px" }, `No Apple Stores within ${cfg.maxMiles} mi of ${cfg.zip}.`));
    }
    for (const store of stores) {
      const items = state.results.filter((r) => r.storeNumber === store.storeNumber);
      const available = items.filter((r) => r.available);
      lines.push(el("div", { marginTop: "8px", fontWeight: "600" }, `${store.storeName} · ${store.miles.toFixed(1)} mi`));
      if (available.length === 0) {
        lines.push(el("div", { color: "#6e6e73" }, `None of your ${items.length} models available`));
      }
      for (const r of available) {
        lines.push(el("div", { color: "#008009", fontWeight: "600" }, `● ${names[r.part] || r.part}: ${r.quote}`));
      }
    }
    body.replaceChildren(...lines);

    const anyAvailable = state.results.some((r) => r.available);
    document.title = anyAvailable ? `🟢 ${originalTitle}` : originalTitle;
  }

  function togglePanel() {
    panel.style.display = panel.style.display === "none" ? "" : "none";
  }

  function stop() {
    clearTimeout(state.timer);
    clearInterval(state.renderTimer);
    panel.remove();
    document.title = originalTitle;
    delete window.__duoChecker;
  }

  window.__duoChecker = { togglePanel, stop };
  state.renderTimer = setInterval(render, 5000);
  render();
  tick();
}

if (typeof module !== "undefined") module.exports = { stockChecker };
