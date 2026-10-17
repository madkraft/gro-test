import assert from "node:assert/strict";
import { reconcile, type SyncedItem } from "./reconcile.ts";

const item = (over: Partial<SyncedItem>): SyncedItem => ({
  id: over.item ?? "x",
  item: "x",
  category: "❓ Inne",
  bought: false,
  createdAt: "2026-01-01",
  ...over,
});

// Added in app → sent to Reminders.
let r = reconcile([item({ item: "mleko" })], []);
assert.deepEqual(r.add, ["mleko"]);
assert.equal(r.items[0].reminderTitle, "mleko");

// Added on both sides independently → linked, not duplicated.
r = reconcile([item({ item: "Mleko" })], ["mleko "]);
assert.deepEqual([r.add, r.imported], [[], []]);

// Added in Reminders → imported.
r = reconcile([], ["chleb"]);
assert.deepEqual(r.imported, ["chleb"]);

// Completed in Reminders → bought in app.
r = reconcile([item({ item: "masło", reminderTitle: "masło" })], []);
assert.equal(r.items[0].bought, true);

// Bought in app → completed in Reminders, once.
r = reconcile([item({ item: "jajka", reminderTitle: "jajka", bought: true })], ["jajka"]);
assert.deepEqual([r.complete, r.imported], [["jajka"], []]);
r = reconcile(r.items, ["jajka"]);
assert.deepEqual(r.complete, []);
assert.deepEqual(r.imported, ["jajka"], "a re-added reminder with the same title is a new item");

// Renamed in app → still matched by reminder title.
r = reconcile([item({ item: "mleko 2%", reminderTitle: "mleko" })], ["mleko"]);
assert.deepEqual([r.items[0].bought, r.add, r.imported], [false, [], []]);

// Bought in app before ever syncing → ignored.
r = reconcile([item({ item: "ser", bought: true })], []);
assert.deepEqual([r.add, r.complete], [[], []]);

console.log("ok");
