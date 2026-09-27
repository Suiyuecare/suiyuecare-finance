"use strict";
// Pure Node contracts and money arithmetic; no browser or production connection.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "assets/engines/payroll-accrual-engine.js"),
  "utf8",
);
const box = { Intl, Blob, crypto: webcrypto, module: { exports: {} } };
vm.runInNewContext(source, box);
const engine = box.module.exports;
let checks = 0;
const check = (fn) => {
  fn();
  checks++;
};
const rows = [
  {
    t: "dr",
    ac: "6201",
    amt: "1300.00",
    dept: "D1",
    component: "gross_salary",
  },
  { t: "cr", ac: "2140", amt: "65.44", dept: "D1", component: "deduction" },
  { t: "cr", ac: "2134", amt: "1234.56", dept: "D1", component: "net_payable" },
  {
    t: "dr",
    ac: "6203",
    amt: "100.01",
    dept: "D1",
    component: "employer_cost",
  },
  {
    t: "cr",
    ac: "2150",
    amt: "100.01",
    dept: "D1",
    component: "employer_payable",
  },
];
check(() => assert.equal(engine.cents("0.30"), 30));
check(() => assert.equal(engine.cents("10.50"), 1050));
for (const bad of ["", "-1", "0", "0.001", "NaN", "1e3", "1000000000000"])
  check(() => assert.throws(() => engine.cents(bad), /AMOUNT/));
check(() =>
  assert.equal(
    engine.validate(rows, { totalNetCents: 123456 }).gross_salary,
    130000,
  ),
);
check(() =>
  assert.throws(() => engine.validate(rows, { totalNetCents: 1 }), /BALANCE/),
);
check(() =>
  assert.throws(
    () =>
      engine.validate(
        rows.map((r, i) => ({ ...r, dept: i === 2 ? "D2" : "D1" })),
        { totalNetCents: 123456 },
      ),
    /BALANCE/,
  ),
);
check(() =>
  assert.throws(
    () =>
      engine.validate([{ ...rows[0], ac: "1112" }, ...rows.slice(1)], {
        totalNetCents: 123456,
      }),
    /ENTRIES/,
  ),
);
check(() =>
  assert.throws(
    () => engine.validate(rows, { totalNetCents: Number.MAX_SAFE_INTEGER + 1 }),
    /BALANCE/,
  ),
);
const huge = Array.from({ length: 92 }, () => ({
  ...rows[0],
  amt: "999999999999.99",
}));
check(() =>
  assert.throws(
    () => engine.validate(huge, { totalNetCents: 123456 }),
    /AMOUNT/,
  ),
);
check(() =>
  assert(
    source.includes("ctx.busy = false;") &&
      source.includes("!ctx.element.isConnected"),
  ),
);
check(() =>
  assert(
    source.includes("saved.ok !== true") &&
      source.includes("reviewed.ok !== true"),
  ),
);
const bridge = fs.readFileSync(
  path.join(root, "assets/engines/hr-bridge-engine.js"),
  "utf8",
);
check(() =>
  assert(
    bridge.includes("current(ctx,payrollGeneration)&&payroll.isConnected"),
  ),
);
check(() =>
  assert(
    (bridge.match(/FinancePayrollAccrual\.dispose\(\)/g) || []).length >= 4,
  ),
);
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
check(() =>
  assert(
    index.includes("activeDataEnvironment()===hrBridgeEnvironment") &&
      index.includes("canAccessPage('hrbridge')"),
  ),
);
(async () => {
  check(() => assert.equal(typeof engine.digest, "function"));
  assert.equal(
    await engine.digest(new Blob(["fictional payroll evidence"])),
    require("node:crypto")
      .createHash("sha256")
      .update("fictional payroll evidence")
      .digest("hex"),
  );
  checks++;
  console.log("PASS payroll accrual Node contracts and exact money: " + checks);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
