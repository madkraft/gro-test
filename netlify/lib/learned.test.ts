import assert from "node:assert/strict";
import { categoryOf, learnCategories, pastNames } from "../../src/lib/learned.ts";

const it = (item: string, category: string, createdAt: string) => ({ id: createdAt, item, category, bought: true, createdAt });
const items = [
  it("Mleko", "🧊 Lodówka / mleczny", "1"),
  it("chleb", "❓ Inne", "2"),
  it("Chleb", "🥯 Piekarnia", "3"),
  it("mleko", "🥤 Napoje", "4"),
];
const learned = learnCategories(items);
assert.equal(learned.get("mleko"), "🥤 Napoje", "later categorization wins");
assert.equal(categoryOf(it("CHLEB ", "❓ Inne", "5"), learned), "🥯 Piekarnia");
assert.equal(categoryOf(it("ser", "❓ Inne", "5"), learned), "❓ Inne");
assert.deepEqual(pastNames(items).map((p) => [p.name, p.count]), [["mleko", 2], ["Chleb", 2]], "ties broken by most recent");
assert.deepEqual(pastNames([...items, it("ser", "❓ Inne", "9")]).map((p) => p.name), ["mleko", "Chleb", "ser"]);
console.log("ok");
