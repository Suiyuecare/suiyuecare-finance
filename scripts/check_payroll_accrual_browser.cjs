"use strict";
// Real local browser with fictional identities and mocked private services only.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { applyBuildEnvironment } = require("./finance_build_environment");
const root = path.resolve(__dirname, ".."),
  out =
    process.env.PAYROLL_ACCRUAL_EVIDENCE ||
    "/tmp/finance-payroll-accrual-20260927";
const anchor = "bootAuthGate();\n\n})();";
let html = applyBuildEnvironment(
  fs.readFileSync(path.join(root, "index.html"), "utf8"),
  { target: "local", supabaseUrl: "", supabaseAnonKey: "" },
);
assert(html.includes(anchor));
html = html
  .replace(
    anchor,
    "window.__payrollApp={run:async function(code){return await eval(code);}};\n" +
      anchor,
  )
  .replace(/<script\b[^>]*src=["']https?:[^>]*><\/script>/gi, "");
const server = http.createServer((req, res) => {
  const f = path.resolve(
    root,
    "." + new URL(req.url, "http://localhost").pathname,
  );
  if (f !== root && !f.startsWith(root + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  if (f === root || f === path.join(root, "index.html")) {
    res.setHeader("content-type", "text/html");
    return res.end(html);
  }
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  res.setHeader(
    "content-type",
    f.endsWith(".js")
      ? "application/javascript"
      : f.endsWith(".css")
        ? "text/css"
        : "application/octet-stream",
  );
  res.end(fs.readFileSync(f));
});
let browser,
  checks = 0;
const equal = (a, b, m) => {
  assert.deepEqual(a, b, m);
  checks++;
};
(async () => {
  fs.mkdirSync(out, { recursive: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.FINANCE_BROWSER_CHANNEL === "chromium"
      ? {}
      : { channel: process.env.PLAYWRIGHT_CHANNEL || "chrome" }),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ||
    /^(blob|data):/.test(route.request().url())
      ? route.continue()
      : route.abort(),
  );
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() => window.__payrollApp);
  await page.evaluate(() =>
    window.__payrollApp.run(
      "USERS=[{id:'fictional-accountant',n:'虛構會計',email:'accountant@example.invalid',role:'accountant',rL:'會計',eid:'F1',dc:'D1',active:true}];ENTS=[{id:'F1',n:'虛構法人',active:true}];DEPTS=[{c:'D1',n:'虛構第一課',eid:'F1',active:true}];ORG_CHART=[];REQS=[];INVS=[];BILLS=[];VOUCHERS=[];LEDGER=[];NOTIFS=[];quickLogin('accountant');nav('hrbridge');",
    ),
  );
  // Use the app navigation contract before mounting the mocked private service.
  // quickLogin schedules a dashboard animation frame. Direct DOM mounting used
  // to race that frame, which could legitimately dispose the test's HR child.
  equal(await page.evaluate(() => window.__payrollApp.run("S.page")), "hrbridge");
  await page.evaluate(() => {
    const tenant = "11111111-1111-4111-8111-111111111111",
      obligation = "22222222-2222-4222-8222-222222222222";
    const state = (window.__payroll = {
      tenant,
      obligation,
      rows: [],
      objects: {},
      calls: [],
      mode: "ok",
      identity: "accountant",
      afterPost: 0,
    });
    const hr = {
      obligationId: obligation,
      period: "2026-06",
      kind: "monthly",
      legalEntityCode: "F1",
      payDate: "2026-07-15",
      financeVersion: 1,
      status: "pending_applicant",
      amountsVisible: true,
      totalNetCents: 123456,
      route: [],
      events: [],
    };
    state.client = {
      rpc: async (name, args) => {
        state.calls.push({ name, args });
        if (name === "finance_hr_snapshot")
          return { data: { obligations: [hr] } };
        if (name === "finance_payroll_accrual_list_v1")
          return state.mode === "badList"
            ? { data: {} }
            : { data: { items: state.rows } };
        if (name === "finance_payroll_accrual_evidence_prepare_v1") {
          const data = {
            bucket: "finance-payroll-evidence",
            path:
              tenant + "/" + obligation + "/" + args.p_request_id + "/source",
          };
          if (state.mode === "holdPrepare")
            return await new Promise(
              (resolve) => (state.releasePrepare = () => resolve({ data })),
            );
          return { data };
        }
        if (name === "finance_payroll_accrual_save_v1") {
          if (state.mode === "denySave")
            return { error: { code: "42501", message: "SYNTHETIC_DENIAL" } };
          if (state.mode === "falseSave") return { data: { ok: false } };
          state.rows = [
            {
              id: args.p_request_id,
              obligationId: obligation,
              entityId: "F1",
              period: "2026-06",
              status: "submitted",
              version: 1,
              authorId: "accountant",
              entries: args.p_entries.map((e) => ({ ...e, an: "虛構科目" })),
              evidence: args.p_evidence,
              grossCents: 130000,
              deductionCents: 6544,
              netCents: 123456,
              employerCents: 0,
            },
          ];
          state.savedRow = state.rows[0];
          return { data: { ok: true } };
        }
        if (
          name === "finance_payroll_accrual_review_v1" ||
          name === "finance_payroll_accrual_return_v1"
        ) {
          if (state.mode === "denyReview")
            return { error: { code: "42501", message: "SYNTHETIC_DENIAL" } };
          if (state.mode === "falseReview") return { data: { ok: false } };
          state.rows = state.rows.map((r) => ({
            ...r,
            status: name.includes("return") ? "returned" : "posted",
            version: 2,
            voucherId: "PAYACC-FICTIONAL",
          }));
          return { data: { ok: true } };
        }
        return { data: {} };
      },
      functions: {
        invoke: async () =>
          __payroll.mode === "denyHr"
            ? { error: { code: "42501", message: "SYNTHETIC_PARENT_DENIAL" } }
            : { data: { accepted: true } },
      },
      storage: {
        from: (bucket) => ({
          upload: async (p, file, options) => {
            state.calls.push({ name: "storage.upload", path: p, options });
            state.objects[p] = new Blob([await file.arrayBuffer()]);
            if (state.mode === "lostUpload")
              throw Error("SYNTHETIC_LOST_RESPONSE");
            return { data: { path: p } };
          },
          download: async (p) => {
            state.calls.push({ name: "storage.download", path: p });
            return state.objects[p]
              ? {
                  data:
                    state.mode === "corrupt"
                      ? new Blob(["corrupted"])
                      : state.objects[p],
                }
              : {
                  error: {
                    status: 404,
                    code: "404",
                    message: "SYNTHETIC_MISSING",
                  },
                };
          },
        }),
      },
    };
    state.mount = (role) => {
      state.identity = role;
      const identity = role;
      document.querySelectorAll(".pg").forEach((p) => p.classList.remove("on"));
      const el = document.getElementById("pg-hrbridge");
      el.classList.add("on");
      document.getElementById("page-title").textContent = "虛構薪資應計驗收";
      FinanceHrBridge.mount(el, {
        client: state.client,
        userId: role,
        role,
        accounts: [
          { c: "6201", n: "薪資", on: true },
          { c: "2134", n: "應付薪資", on: true },
          { c: "2140", n: "扣款", on: true },
        ],
        departments: [{ c: "D1", n: "虛構第一課", eid: "F1", active: true }],
        isCurrent: () => state.identity === identity,
        afterPost: async () => {
          state.afterPost++;
        },
      });
    };
    state.mount("accountant");
  });
  const callCount = (name) =>
    page.evaluate(
      (n) => __payroll.calls.filter((c) => c.name === n).length,
      name,
    );
  const settle = async () => {
    await page.waitForTimeout(50);
  };
  await page.locator("[data-payroll-draft]").waitFor();
  async function fillDraft() {
    const form = page.locator("[data-payroll-draft]");
    await form
      .getByLabel("人資核准批次", { exact: true })
      .selectOption("22222222-2222-4222-8222-222222222222");
    const rows = form.locator("[data-payroll-entry]");
    for (const [i, ac, amt] of [
      [0, "6201", "1300.00"],
      [1, "2140", "65.44"],
      [2, "2134", "1234.56"],
    ]) {
      await rows.nth(i).locator("[data-dept]").selectOption("D1");
      await rows.nth(i).locator("[data-account]").selectOption(ac);
      await rows.nth(i).locator("[data-amount]").fill(amt);
    }
    await form
      .getByLabel("原始清冊／查核紀錄編號", { exact: true })
      .fill("FICTIONAL-PAYROLL-EVIDENCE");
    await form
      .locator("input[type=file]")
      .setInputFiles({
        name: "fictional-payroll.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "Fictional payroll approved gross1300 deduction65.44 net1234.56",
        ),
      });
    await form.locator("input[type=checkbox]").check();
  }
  await fillDraft();
  await page.evaluate(() => (__payroll.mode = "lostUpload"));
  await page
    .getByRole("button", { name: "送交主管獨立覆核", exact: true })
    .click();
  await page.getByRole("heading", { name: /待獨立覆核/ }).waitFor();
  equal(
    await callCount("finance_payroll_accrual_save_v1"),
    1,
    "lost upload response recovered by readback",
  );
  const evidence = await page.evaluate(() => ({
    saved: __payroll.calls.find(
      (c) => c.name === "finance_payroll_accrual_save_v1",
    ).args,
    upload: __payroll.calls.find((c) => c.name === "storage.upload"),
  }));
  equal(evidence.upload.options.upsert, false);
  equal(
    evidence.saved.p_evidence.sha256,
    require("node:crypto")
      .createHash("sha256")
      .update("Fictional payroll approved gross1300 deduction65.44 net1234.56")
      .digest("hex"),
  );
  equal(
    evidence.saved.p_entries.map((e) => e.amt),
    ["1300.00", "65.44", "1234.56"],
  );
  await page.evaluate(() => {
    __payroll.mode = "ok";
    __payroll.mount("accountant");
  });
  await page.getByRole("heading", { name: /待獨立覆核/ }).waitFor();
  equal(
    await page.locator("[data-payroll-approve]").count(),
    0,
    "author cannot approve own workpaper",
  );
  await page.evaluate(() => __payroll.mount("ceo"));
  await page.locator("[data-payroll-approve]").waitFor();
  await page
    .getByLabel("覆核／退回原因", { exact: true })
    .fill("虛構覆核：原件與分攤一致");
  await page.locator("[data-payroll-approve]").click();
  equal(
    await callCount("finance_payroll_accrual_review_v1"),
    0,
    "review requires original readback",
  );
  const dl = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下載並核對原始佐證", exact: true })
    .click();
  await (await dl).saveAs(path.join(out, "fictional-payroll-evidence.txt"));
  await page
    .getByLabel("我已核對原件、核准清冊及各部門分攤", { exact: true })
    .check();
  await page.locator("[data-payroll-approve]").click();
  await page.getByRole("heading", { name: /已應計入帳/ }).waitFor();
  equal(await page.evaluate(() => __payroll.afterPost), 1);
  // A false or denied independent review cannot appear posted or freeze reread.
  await page.evaluate(() => {
    __payroll.rows = [__payroll.savedRow];
    __payroll.mode = "falseReview";
    __payroll.mount("ceo");
  });
  await page.locator("[data-payroll-approve]").waitFor();
  await page.getByLabel("覆核／退回原因", { exact: true }).fill("虛構覆核重試");
  const retryDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下載並核對原始佐證", exact: true })
    .click();
  await retryDownload;
  await page
    .getByLabel("我已核對原件、核准清冊及各部門分攤", { exact: true })
    .check();
  await page.locator("[data-payroll-approve]").click();
  await page
    .getByText("覆核結果尚未確認，請重新讀取；相同版本重試不會重複產生傳票。", {
      exact: true,
    })
    .waitFor();
  equal(await page.evaluate(() => __payroll.afterPost), 1);
  await page.evaluate(() => (__payroll.mode = "denyReview"));
  await page.locator("[data-payroll-approve]").click();
  await page
    .getByText(
      "目前沒有此薪資帳務的查看權限，已清除資料。請主管核對薪資資料授權。",
      { exact: true },
    )
    .waitFor();
  equal(await page.locator("[data-payroll-approve]").count(), 0);
  await page.evaluate(() => (__payroll.mode = "ok"));
  await page
    .getByRole("button", { name: "重新讀取薪資應計", exact: true })
    .click();
  await page.locator("[data-payroll-approve]").waitFor();
  checks++;
  // Denied mutations clear sensitive data and release busy, permitting safe reread.
  await page.evaluate(() => {
    __payroll.rows = [];
    __payroll.mode = "denySave";
    __payroll.mount("accountant");
  });
  await page.locator("[data-payroll-draft]").waitFor();
  await fillDraft();
  await page
    .getByRole("button", { name: "送交主管獨立覆核", exact: true })
    .click();
  await page
    .getByText(
      "目前沒有此薪資帳務的查看權限，已清除資料。請主管核對薪資資料授權。",
      { exact: true },
    )
    .waitFor();
  equal(await page.locator("[data-payroll-draft]").count(), 0);
  await page.evaluate(() => (__payroll.mode = "ok"));
  await page
    .getByRole("button", { name: "重新讀取薪資應計", exact: true })
    .click();
  await page.locator("[data-payroll-draft]").waitFor();
  checks++;
  // Parent refresh disposes an in-flight child before its prepare response can upload.
  await fillDraft();
  await page.evaluate(() => (__payroll.mode = "holdPrepare"));
  await page
    .getByRole("button", { name: "送交主管獨立覆核", exact: true })
    .click();
  await page.waitForFunction(
    () => typeof __payroll.releasePrepare === "function",
  );
  const uploads = await callCount("storage.upload"),
    saves = await callCount("finance_payroll_accrual_save_v1");
  await page.getByRole("button", { name: "重新讀取", exact: true }).click();
  await page.locator("[data-payroll-draft]").waitFor();
  await page.evaluate(() => {
    __payroll.mode = "ok";
    __payroll.releasePrepare();
  });
  await settle();
  equal(await callCount("storage.upload"), uploads);
  equal(await callCount("finance_payroll_accrual_save_v1"), saves);
  // A denial from the parent HR operation also invalidates a detached child.
  await fillDraft();
  await page.evaluate(() => {
    __payroll.releasePrepare = null;
    __payroll.mode = "holdPrepare";
  });
  await page
    .getByRole("button", { name: "送交主管獨立覆核", exact: true })
    .click();
  await page.waitForFunction(
    () => typeof __payroll.releasePrepare === "function",
  );
  await page.evaluate(() => (__payroll.mode = "denyHr"));
  await page
    .getByRole("button", { name: "同步進度至人資", exact: true })
    .click();
  await page
    .getByText(
      "目前無權讀取此薪資資料，已清除畫面內容。請確認授權後重新讀取。",
      { exact: true },
    )
    .waitFor();
  await page.evaluate(() => {
    __payroll.mode = "ok";
    __payroll.releasePrepare();
  });
  await settle();
  equal(await callCount("storage.upload"), uploads);
  equal(await callCount("finance_payroll_accrual_save_v1"), saves);
  equal(await page.locator("[data-payroll-draft]").count(), 0);
  await page.evaluate(() => __payroll.mount("accountant"));
  await page.locator("[data-payroll-draft]").waitFor();
  // Corrupt stored bytes stop save; a non-ok RPC never becomes a successful submission.
  await fillDraft();
  await page.evaluate(() => (__payroll.mode = "corrupt"));
  await page
    .getByRole("button", { name: "送交主管獨立覆核", exact: true })
    .click();
  await page
    .getByText("佐證檔案指紋不一致，已停止送審。請核對原件。", { exact: true })
    .waitFor();
  equal(await callCount("finance_payroll_accrual_save_v1"), saves);
  await page.evaluate(() => {
    __payroll.mode = "falseSave";
    __payroll.mount("accountant");
  });
  await page.locator("[data-payroll-draft]").waitFor();
  await fillDraft();
  await page
    .getByRole("button", { name: "送交主管獨立覆核", exact: true })
    .click();
  await page
    .getByText(
      "尚未確認送審結果。請重新讀取或重試原內容；系統會保留相同識別碼避免重複登錄。",
      { exact: true },
    )
    .waitFor();
  equal(
    await page
      .getByRole("button", { name: "重試原送審內容", exact: true })
      .count(),
    1,
  );
  equal(await page.getByRole("heading", { name: /待獨立覆核/ }).count(), 0);
  await page.evaluate(() => {
    __payroll.mode = "badList";
    __payroll.mount("accountant");
  });
  await page
    .getByText("薪資應計暫時無法確認，請重新讀取。既有資料不會當成零筆。", {
      exact: true,
    })
    .waitFor();
  equal(await page.locator("[data-payroll-draft]").count(), 0);
  await page.evaluate(() => {
    __payroll.mode = "ok";
    __payroll.mount("accountant");
  });
  await page.locator("[data-payroll-draft]").waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      "overflow " + width,
    );
    await page.screenshot({
      path: path.join(out, "payroll-" + width + ".png"),
      fullPage: true,
    });
  }
  equal(errors, []);
  console.log(
    "PASS payroll accrual real browser: " +
      checks +
      " checks, verified bytes/upload, independent review, denial recovery, parent refresh/stale response, false RPC, corruption, desktop/mobile",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    await new Promise((r) => server.close(r));
  });
