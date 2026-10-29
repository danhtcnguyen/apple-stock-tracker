const test = require("node:test");
const assert = require("node:assert/strict");
const { stockChecker } = require("../checker.js");

const h = stockChecker({ exposeInternals: true });
const unavailable = require("./fixtures/pickup_unavailable.json");
// Same real response, with MK1F4 available at Galleria Dallas (7.8 mi) and MK1E4 at Southlake (16.1 mi).
const available = require("./fixtures/pickup_available.json");

const PARTS = ["MK1E4LL/A", "MK1F4LL/A", "MK1G4LL/A", "MK1H4LL/A", "MK1J4LL/A", "MK1L4LL/A", "MK1Q4LL/A", "MK1R4LL/A"];
const names = { "MK1F4LL/A": "iPhone Duo 256GB Night Sky" };
const validConfig = {
  zip: "75010", maxMiles: 15, intervalSeconds: 60, ntfyTopic: "duo-abc123",
  watch: [{ part: "MK1F4LL/A", name: "iPhone Duo 256GB Night Sky" }],
};

test("buildUrl matches the request Apple's own page makes", () => {
  assert.equal(
    h.buildUrl(["MK1F4LL/A", "MK1E4LL/A"], "UNLOCKED/US", "75010"),
    "/shop/fulfillment-messages?fae=true&pl=true&mts.0=regular&cppart=UNLOCKED/US&parts.0=MK1F4LL/A&parts.1=MK1E4LL/A&location=75010",
  );
});

test("parseResponse reads every store and part from a real response", () => {
  const results = h.parseResponse(unavailable);
  assert.equal(results.length, 5 * 8);
  assert.deepEqual([...new Set(results.map((r) => r.part))].sort(), PARTS);
  assert.deepEqual(results[0], {
    storeNumber: "R746", storeName: "Galleria Dallas", miles: 7.83, part: "MK1E4LL/A",
    available: false, quote: "Currently unavailable",
  });
});

test("parseResponse rejects an unexpected shape", () => {
  assert.throws(() => h.parseResponse({ body: {} }), /unexpected response format/);
  assert.throws(() => h.parseResponse(null), /unexpected response format/);
});

test("parseMiles", () => {
  assert.equal(h.parseMiles("12.76 mi"), 12.76);
  assert.equal(h.parseMiles(""), Infinity);
  assert.equal(h.parseMiles("20 km"), Infinity);
});

test("nearby keeps only stores within maxMiles", () => {
  const stores = new Set(h.nearby(h.parseResponse(unavailable), 15).map((r) => r.storeName));
  assert.deepEqual([...stores], ["Galleria Dallas", "NorthPark Center"]);
});

test("one alert when stock appears nearby; none on the next check", () => {
  const results = h.nearby(h.parseResponse(available), 15);
  const first = h.changes({}, results);
  assert.deepEqual(first.arrivals.map((r) => `${r.storeNumber} ${r.part}`), ["R746 MK1F4LL/A"]);

  const seen = h.nextSeen(results);
  assert.deepEqual(seen, { "R746|MK1F4LL/A": true });
  assert.equal(h.changes(seen, results).arrivals.length, 0);
});

test("stock at 16 mi never alerts with a 15 mi limit", () => {
  const results = h.nearby(h.parseResponse(available), 15);
  assert.ok(!results.some((r) => r.storeNumber === "R151"));
});

test("saved state survives a reload: no re-alert", () => {
  const results = h.nearby(h.parseResponse(available), 15);
  const reloaded = JSON.parse(JSON.stringify(h.nextSeen(results)));
  assert.equal(h.changes(reloaded, results).arrivals.length, 0);
});

test("sell-out is detected, and stock coming back alerts again", () => {
  const withStock = h.nearby(h.parseResponse(available), 15);
  const without = h.nearby(h.parseResponse(unavailable), 15);
  const seen = h.nextSeen(withStock);
  assert.deepEqual(h.changes(seen, without).sellouts.map((r) => r.part), ["MK1F4LL/A"]);
  const afterSellout = h.nextSeen(without);
  assert.equal(h.changes(afterSellout, withStock).arrivals.length, 1);
});

test("an arrival whose push failed stays unseen so it's retried", () => {
  const results = h.nearby(h.parseResponse(available), 15);
  const { arrivals } = h.changes({}, results);
  const seen = h.nextSeen(results, arrivals);
  assert.equal(h.changes(seen, results).arrivals.length, 1);
});

test("backoff doubles per failure, caps at 10 minutes, resets on success", () => {
  assert.equal(h.nextInterval(60, 0), 60);
  assert.equal(h.nextInterval(60, 1), 120);
  assert.equal(h.nextInterval(60, 3), 480);
  assert.equal(h.nextInterval(60, 4), 600);
  assert.equal(h.nextInterval(60, 20), 600);
});

test("jitter stays within ±20%", () => {
  assert.ok(Math.abs(h.jitter(60, () => 0) - 48) < 1e-9);
  assert.ok(Math.abs(h.jitter(60, () => 1) - 72) < 1e-9);
});

test("arrival push has model, store, distance and a buy link", () => {
  const item = h.nearby(h.parseResponse(available), 15).find((r) => r.available);
  assert.deepEqual(h.arrivalMessage(item, names), {
    title: "iPhone Duo 256GB Night Sky at Galleria Dallas",
    message: "Available for pickup 7.8 mi away. Apple says: Available Today",
    click: "https://www.apple.com/shop/buy-iphone/iphone-duo",
    priority: 5,
    tags: ["iphone"],
  });
});

test("validateConfig accepts good settings and fills defaults", () => {
  const cfg = h.validateConfig(validConfig);
  assert.equal(cfg.carrier, "UNLOCKED/US");
  assert.equal(cfg.notifyOnSellout, false);
  assert.equal(h.validateConfig({ ...validConfig, intervalSeconds: 30 }).intervalSeconds, 30);
});

test("validateConfig rejects bad settings", () => {
  const bad = (patch) => () => h.validateConfig({ ...validConfig, ...patch });
  assert.throws(bad({ zip: "7501" }), /zip/);
  assert.throws(bad({ maxMiles: 0 }), /maxMiles/);
  assert.throws(bad({ intervalSeconds: 20 }), /intervalSeconds/);
  assert.throws(bad({ ntfyTopic: "has spaces" }), /ntfyTopic/);
  assert.throws(bad({ watch: [] }), /at least one model/);
});
