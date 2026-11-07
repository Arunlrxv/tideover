// The rules a Trezu template must meet, restated from Trezu's docs/CUSTOM_PROPOSAL_TEMPLATES.md
// and nt-fe/features/proposal-templates/manifest.ts. This is our reading of those rules, not a
// run of Trezu's parser, which has not been tried on these templates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createFundTemplate, fundTemplates } from "../src/lib/trezu.mjs";

const all = [
  createFundTemplate({
    factory: "funds.x.testnet",
    dao: "d.sputnikv2.testnet",
    token: "usd.testnet",
    deposit: "6000",
    rules: { dues: "0", min_group: 5 },
    dues: "10000000",
  }),
  ...fundTemplates("harbor.funds.x.testnet"),
];

const TYPES = ["account", "token", "uint", "amount", "text", "number", "select", "bool", "json"];
const ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

function placeholders(value, out = new Set()) {
  if (typeof value === "string") for (const m of value.matchAll(/\{\{(\w+)\}\}/g)) out.add(m[1]);
  else if (value && typeof value === "object") for (const v of Object.values(value)) placeholders(v, out);
  return out;
}

test("every template has a safe id and a real target", () => {
  for (const t of all) {
    assert.equal(t.version, 1);
    assert.match(t.id, /^[a-zA-Z0-9_-]+$/);
    assert.ok(!["create", "new", "about"].includes(t.id.toLowerCase()));
    assert.match(t.binding.receiver_id, ACCOUNT);
    assert.match(t.binding.method_name, /^[A-Za-z_][A-Za-z0-9_]*$/);
  }
});

test("amounts stay digit strings", () => {
  for (const t of all) {
    assert.match(t.binding.deposit, /^\d+$/);
    assert.match(t.binding.gas, /^\d+$/);
  }
});

test("every placeholder is declared, and names are unique", () => {
  for (const t of all) {
    const names = new Set(t.fields.map((f) => f.name));
    assert.equal(names.size, t.fields.length, t.id);
    for (const p of [...placeholders(t.args), ...placeholders(t.summary)]) assert.ok(names.has(p), `${t.id}: ${p}`);
  }
});

test("each field is one Trezu accepts", () => {
  for (const t of all) {
    for (const f of t.fields) {
      const where = `${t.id}.${f.name}`;
      assert.match(f.name, /^[a-zA-Z0-9_]+$/, where);
      assert.ok(f.label.trim(), where);
      assert.ok(TYPES.includes(f.type), where);
      assert.ok(f.type !== "bool" || f.required === undefined, where);
      if (f.validation?.pattern) {
        assert.ok(["text", "number"].includes(f.type), where);
        assert.doesNotThrow(() => new RegExp(f.validation.pattern), where);
      }
      if (f.default !== undefined) {
        if (["account", "token", "text"].includes(f.type)) assert.ok(typeof f.default === "string" && f.default.length > 0, where);
        if (["uint", "amount"].includes(f.type)) assert.match(f.default, /^\d+$/, where);
        if (f.type === "number") assert.equal(typeof f.default, "number", where);
      }
    }
  }
});

test("the install form sets the dues and leaves the other rules alone", () => {
  assert.deepEqual(all[0].args.rules, { dues: "{{dues}}", min_group: 5 });
});
