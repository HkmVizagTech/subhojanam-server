// What the DRM feed says about a subscription: its state is the strongest any of its rows carries, so
// a cancelled / ended subscription is not reported as running just because the webhook wrote the status
// on an older charge's row. No database: plain objects.
//   node scripts/test-subscription-state.js
const { collapseSubscriptionRows, mapSubscriptionOf } = require("../src/controllers/internal.controller");

let failures = 0;
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) return console.log(`  ok   ${label}`);
  failures++;
  console.error(`  FAIL ${label}\n       expected ${e}\n       got      ${a}`);
};
const row = (status, day, extra = {}) => ({ isRecurring: true, subscriptionId: "sub_1", amount: 500, status, createdAt: new Date(`2026-10-${String(day).padStart(2, "0")}T10:00:00Z`), ...extra });

// newest first, as the by-mobile lookup returns them
console.log("\n--- one row on its own ---");
check("paid -> active, one charge", [mapSubscriptionOf(row("paid", 20)).status, mapSubscriptionOf(row("paid", 20)).chargeCount], ["active", 1]);
check("created -> pending, no charge", [mapSubscriptionOf(row("created", 20)).status, mapSubscriptionOf(row("created", 20)).chargeCount], ["pending", 0]);
check("cancelled / halted -> cancelled", [mapSubscriptionOf(row("cancelled", 1)).status, mapSubscriptionOf(row("halted", 1)).status], ["cancelled", "cancelled"]);
check("completed -> completed (it ended)", mapSubscriptionOf(row("completed", 1)).status, "completed");
check("a one-time donation is not a subscription", mapSubscriptionOf({ isRecurring: false, subscriptionId: "x", status: "paid" }), null);

console.log("\n--- the rows of one subscription ---");
let [s] = collapseSubscriptionRows([row("paid", 25), row("cancelled", 15), row("paid", 5)]);
check("a cancelled row ANYWHERE cancels it, though the newest is paid", s.status, "cancelled");
check("and the charges are still counted", [s.chargeCount, s.lastChargedAt.toISOString().slice(0, 10)], [2, "2026-10-25"]);
[s] = collapseSubscriptionRows([row("paid", 25), row("completed", 20), row("paid", 5)]);
check("an ended (completed) row ends it", s.status, "completed");
[s] = collapseSubscriptionRows([row("paid", 25), row("active", 20), row("created", 5)]);
check("paid and active rows keep it active", s.status, "active");
[s] = collapseSubscriptionRows([row("created", 5)]);
check("only a created row: pending", s.status, "pending");
[s] = collapseSubscriptionRows([row("cancelled", 25), row("paid", 20)]);
check("cancelled beats paid when cancelled is the newest too", s.status, "cancelled");
const two = collapseSubscriptionRows([row("paid", 25), row("paid", 20, { subscriptionId: "sub_2" })]);
check("two subscriptions stay two", two.map((x) => x.subscriptionId).sort(), ["sub_1", "sub_2"]);

if (failures) { console.error(`\n${failures} FAILED`); process.exit(1); }
console.log("\nall passed");
process.exit(0);
