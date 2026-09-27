(function (global) {
  "use strict";
  var active = null,
    components = {
      gross_salary: "應發薪資（借）",
      deduction: "員工扣款（貸）",
      net_payable: "應付實發薪資（貸）",
      employer_cost: "雇主負擔成本（借）",
      employer_payable: "雇主負擔應付（貸）",
    };
  function cents(value) {
    var s = String(value == null ? "" : value).trim();
    if (!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(s)) throw Error("AMOUNT");
    var p = s.split("."),
      n = Number(p[0]) * 100 + Number((p[1] || "").padEnd(2, "0"));
    if (!Number.isSafeInteger(n) || n <= 0) throw Error("AMOUNT");
    return n;
  }
  function money(n) {
    return new Intl.NumberFormat("zh-TW", {
      style: "currency",
      currency: "TWD",
      minimumFractionDigits: 2,
    }).format(n / 100);
  }
  function validate(entries, source) {
    if (!Array.isArray(entries) || entries.length < 2 || entries.length > 100)
      throw Error("ENTRIES");
    if (
      !source ||
      !Number.isSafeInteger(source.totalNetCents) ||
      source.totalNetCents <= 0
    )
      throw Error("BALANCE");
    var totals = {
        gross_salary: 0,
        deduction: 0,
        net_payable: 0,
        employer_cost: 0,
        employer_payable: 0,
      },
      depts = {};
    entries.forEach(function (e) {
      if (
        !components[e.component] ||
        !e.ac ||
        !e.dept ||
        e.t !==
          (["gross_salary", "employer_cost"].includes(e.component)
            ? "dr"
            : "cr") ||
        !(
          ["gross_salary", "employer_cost"].includes(e.component)
            ? /^[56]/
            : /^2/
        ).test(e.ac)
      )
        throw Error("ENTRIES");
      var n = cents(e.amt);
      totals[e.component] += n;
      var d = depts[e.dept] || (depts[e.dept] = { balance: 0, employer: 0 });
      d.balance += e.t === "dr" ? n : -n;
      if (e.component === "employer_cost") d.employer += n;
      if (e.component === "employer_payable") d.employer -= n;
      if (
        !Number.isSafeInteger(totals[e.component]) ||
        !Number.isSafeInteger(d.balance) ||
        !Number.isSafeInteger(d.employer)
      )
        throw Error("AMOUNT");
    });
    if (
      totals.net_payable !== source.totalNetCents ||
      !Number.isSafeInteger(totals.net_payable + totals.deduction) ||
      totals.gross_salary !== totals.net_payable + totals.deduction ||
      totals.employer_cost !== totals.employer_payable ||
      Object.keys(depts).some(function (k) {
        return depts[k].balance || depts[k].employer;
      })
    )
      throw Error("BALANCE");
    return totals;
  }
  function node(tag, text, parent) {
    var n = document.createElement(tag);
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function button(text, parent, fn) {
    var b = node("button", text, parent);
    b.type = "button";
    b.className = "btn-s";
    b.style.minHeight = "44px";
    if (fn) b.addEventListener("click", fn);
    return b;
  }
  function field(text, parent, tag) {
    var label = node("label", text, parent);
    label.className = "fg";
    var input = node(tag || "input", null, label);
    input.required = true;
    input.setAttribute("aria-label", text);
    return input;
  }
  function option(select, value, label) {
    var o = node("option", label, select);
    o.value = value;
  }
  function dispose() {
    if (active) {
      active.alive = false;
      active.rows = [];
      active.pending = null;
      active.element.replaceChildren();
    }
    active = null;
  }
  function valid(ctx, g) {
    if (!ctx.alive || active !== ctx) return false;
    if (!ctx.isCurrent() || !ctx.element.isConnected) {
      ctx.alive = false;
      ctx.rows = [];
      ctx.pending = null;
      ctx.element.replaceChildren();
      return false;
    }
    return g == null || ctx.generation === g;
  }
  function message(ctx, text) {
    if (valid(ctx)) ctx.message.textContent = text;
  }
  function denied(ctx, error) {
    if (
      valid(ctx) &&
      error &&
      (["42501", "PGRST301", "PGRST302", "PGRST303"].includes(error.code) ||
        [401, 403].includes(Number(error.status || error.statusCode)) ||
        (error.context && [401, 403].includes(error.context.status)))
    ) {
      ctx.generation++;
      ctx.rows = [];
      ctx.pending = null;
      ctx.busy = false;
      ctx.body.replaceChildren();
      message(
        ctx,
        "目前沒有此薪資帳務的查看權限，已清除資料。請主管核對薪資資料授權。",
      );
      return true;
    }
    return false;
  }
  function timeout(p) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        reject(Error("TIMEOUT"));
      }, 8000);
      Promise.resolve(p).then(
        function (v) {
          clearTimeout(timer);
          resolve(v);
        },
        function (e) {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }
  async function call(ctx, name, args, g) {
    var r = await timeout(ctx.client.rpc(name, args));
    if (r.error) throw r.error;
    if (!valid(ctx, g)) throw Error("STALE");
    return r.data;
  }
  async function digest(file) {
    return Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      ),
    )
      .map(function (v) {
        return v.toString(16).padStart(2, "0");
      })
      .join("");
  }
  async function verifyFile(ctx, e, g) {
    if (!valid(ctx, g)) throw Error("STALE");
    if (
      !e ||
      e.bucket !== "finance-payroll-evidence" ||
      typeof e.path !== "string" ||
      !e.path ||
      !/^[a-f0-9]{64}$/.test(e.sha256) ||
      !Number.isSafeInteger(e.size) ||
      e.size < 1 ||
      e.size > 10485760
    )
      throw Error("EVIDENCE_HASH");
    var r = await timeout(ctx.client.storage.from(e.bucket).download(e.path));
    if (r.error) throw r.error;
    if (
      !r.data ||
      r.data.size !== e.size ||
      (await digest(r.data)) !== e.sha256
    )
      throw Error("EVIDENCE_HASH");
    if (!valid(ctx, g)) throw Error("STALE");
    return r.data;
  }
  function shell(ctx) {
    ctx.element.replaceChildren();
    ctx.element.className = "card";
    ctx.element.style.cssText =
      "padding:16px;margin-top:24px;min-width:0;overflow-wrap:anywhere";
    node("h2", "薪資應計與部門成本", ctx.element).style.fontSize = "20px";
    node(
      "p",
      "依人資核准月份登錄應發薪資、扣款及雇主負擔，覆核後才認列部門費用。實發付款結算另行處理。",
      ctx.element,
    );
    var tools = node("div", null, ctx.element);
    tools.style.cssText =
      "display:flex;gap:12px;flex-wrap:wrap;align-items:end";
    ctx.period = field("薪資月份", tools);
    ctx.period.type = "month";
    ctx.period.value = ctx.initialPeriod;
    ctx.period.addEventListener("change", function () {
      load(ctx);
    });
    ctx.entity = field("公司", tools, "select");
    ctx.entity.required = false;
    option(ctx.entity, "", "全部授權公司");
    Array.from(
      new Set(
        ctx.obligations.map(function (o) {
          return o.legalEntityCode;
        }),
      ),
    )
      .filter(Boolean)
      .sort()
      .forEach(function (id) {
        option(ctx.entity, id, id);
      });
    ctx.entity.addEventListener("change", function () {
      load(ctx);
    });
    button("重新讀取薪資應計", tools, function () {
      load(ctx);
    });
    ctx.message = node("p", "", ctx.element);
    ctx.message.setAttribute("role", "status");
    ctx.message.setAttribute("aria-live", "polite");
    ctx.body = node("div", null, ctx.element);
  }
  async function load(ctx) {
    if (!valid(ctx) || ctx.busy) return;
    var g = ++ctx.generation;
    ctx.rows = [];
    ctx.body.replaceChildren();
    message(ctx, "正在核對本月薪資應計…");
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ctx.period.value)) {
      message(ctx, "請選擇有效的薪資月份後重新讀取。");
      return;
    }
    try {
      var data = await call(
        ctx,
        "finance_payroll_accrual_list_v1",
        { p_entity_id: ctx.entity.value || null, p_period: ctx.period.value },
        g,
      );
      if (!data || !Array.isArray(data.items)) throw Error("RESPONSE");
      ctx.rows = data.items;
      if (
        ctx.pending &&
        ctx.rows.some(function (r) {
          return r.id === ctx.pending.id;
        })
      )
        ctx.pending = null;
      render(ctx);
      message(
        ctx,
        ctx.rows.length
          ? "本月 " + ctx.rows.length + " 筆，送審內容須由另一位主管覆核。"
          : "本月尚無薪資應計。請會計依核准清冊及原始佐證送審。",
      );
    } catch (error) {
      if (denied(ctx, error) || !valid(ctx, g)) return;
      message(ctx, "薪資應計暫時無法確認，請重新讀取。既有資料不會當成零筆。");
    }
  }
  function render(ctx) {
    if (!valid(ctx)) return;
    ctx.body.replaceChildren();
    if (ctx.pending)
      button("重試原送審內容", ctx.body, function () {
        savePending(ctx);
      });
    if (ctx.role === "accountant") draftForm(ctx);
    ctx.rows.forEach(function (row) {
      var card = node("section", null, ctx.body);
      card.style.cssText =
        "border-top:1px solid #efd4b8;padding:16px 0;margin-top:16px";
      node(
        "h3",
        row.period +
          " · " +
          row.entityId +
          " · " +
          ({
            submitted: "待獨立覆核",
            returned: "已退回補正",
            posted: "已應計入帳",
          }[row.status] || row.status),
        card,
      ).style.fontSize = "16px";
      node(
        "p",
        "應發 " +
          money(row.grossCents) +
          " ／ 扣款 " +
          money(row.deductionCents) +
          " ／ 實發 " +
          money(row.netCents) +
          " ／ 雇主成本 " +
          money(row.employerCents),
        card,
      );
      if (row.voucherId) node("p", "應計傳票：" + row.voucherId, card);
      node("p", "佐證編號：" + row.evidence.reference, card);
      var detail = node("details", null, card);
      node("summary", "查看部門借貸分錄", detail);
      row.entries.forEach(function (e) {
        node(
          "p",
          e.dept +
            " · " +
            components[e.component] +
            " · " +
            e.ac +
            " " +
            e.an +
            " " +
            money(cents(e.amt)),
          detail,
        );
      });
      if (
        row.status === "submitted" &&
        ["ceo", "admin_director"].includes(ctx.role) &&
        row.authorId !== ctx.userId
      )
        reviewForm(ctx, row, card);
    });
  }
  function draftForm(ctx) {
    var form = node("form", null, ctx.body);
    form.dataset.payrollDraft = "true";
    form.style.cssText = "display:grid;gap:12px;margin-top:16px;min-width:0";
    node("h3", "新增部門薪資應計", form);
    var source = field("人資核准批次", form, "select");
    option(source, "", "請選擇核准批次");
    var choices = ctx.obligations.filter(function (o) {
      return (
        o.amountsVisible &&
        o.period === ctx.period.value &&
        !ctx.rows.some(function (r) {
          return r.obligationId === o.obligationId && r.status !== "returned";
        })
      );
    });
    choices.forEach(function (o) {
      option(
        source,
        o.obligationId,
        o.period +
          " · " +
          o.legalEntityCode +
          " · 實發 " +
          money(o.totalNetCents),
      );
    });
    var lines = node("div", null, form);
    function add(component) {
      var row = node("div", null, lines);
      row.dataset.payrollEntry = "true";
      row.style.cssText =
        "display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;border:1px solid #ddd;border-radius:8px;padding:12px;margin:8px 0;min-width:0";
      var kind = field("項目", row, "select");
      Object.keys(components).forEach(function (k) {
        option(kind, k, components[k]);
      });
      kind.value = component || "gross_salary";
      kind.dataset.component = "true";
      var dept = field("部門", row, "select");
      dept.dataset.dept = "true";
      var ac = field("科目", row, "select");
      ac.dataset.account = "true";
      function update() {
        var chosen = choices.find(function (o) {
          return o.obligationId === source.value;
        });
        var keep = dept.value;
        dept.replaceChildren();
        option(dept, "", "請選部門");
        ctx.departments
          .filter(function (d) {
            return (
              chosen && d.eid === chosen.legalEntityCode && d.active !== false
            );
          })
          .forEach(function (d) {
            option(dept, d.c, d.c + " " + d.n);
          });
        dept.value = keep;
        var old = ac.value;
        ac.replaceChildren();
        option(ac, "", "請選科目");
        var expense = ["gross_salary", "employer_cost"].includes(kind.value);
        ctx.accounts
          .filter(function (a) {
            return a.on !== false && (expense ? /^[56]/ : /^2/).test(a.c);
          })
          .forEach(function (a) {
            option(ac, a.c, a.c + " " + a.n);
          });
        ac.value = old;
      }
      kind.addEventListener("change", update);
      source.addEventListener("change", update);
      update();
      var amount = field("金額（元）", row);
      amount.dataset.amount = "true";
      amount.inputMode = "decimal";
      amount.placeholder = "依原始清冊填寫";
      button("移除此列", row, function () {
        row.remove();
      });
    }
    ["gross_salary", "deduction", "net_payable"].forEach(add);
    button("新增部門／雇主成本分錄", form, function () {
      if (lines.children.length < 100) add();
    });
    var ref = field("原始清冊／查核紀錄編號", form);
    ref.name = "reference";
    ref.maxLength = 200;
    var file = field("原始佐證文件（10 MB 以內）", form);
    file.type = "file";
    file.name = "evidence";
    file.accept = ".pdf,.xlsx,.csv,.png,.jpg,.jpeg";
    var confirm = field("我已核對應發、扣款、實發、雇主成本及部門分攤", form);
    confirm.type = "checkbox";
    confirm.style.cssText = "display:inline;width:20px;height:20px";
    var submit = button("送交主管獨立覆核", form);
    submit.type = "submit";
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!valid(ctx) || ctx.busy || !form.reportValidity()) return;
      try {
        if (ctx.pending) throw Error("PENDING");
        var obligation = choices.find(function (o) {
          return o.obligationId === source.value;
        });
        var entries = Array.from(lines.children).map(function (r) {
          var c = r.querySelector("[data-component]").value;
          return {
            component: c,
            t: ["gross_salary", "employer_cost"].includes(c) ? "dr" : "cr",
            ac: r.querySelector("[data-account]").value,
            dept: r.querySelector("[data-dept]").value,
            amt: r.querySelector("[data-amount]").value.trim(),
          };
        });
        validate(entries, obligation);
        var chosen = file.files[0];
        if (!chosen || chosen.size < 1 || chosen.size > 10485760)
          throw Error("FILE");
        ctx.pending = {
          id: crypto.randomUUID(),
          obligationId: obligation.obligationId,
          entries: entries,
          file: chosen,
          reference: ref.value.trim(),
        };
        await savePending(ctx);
      } catch (error) {
        if (valid(ctx))
          message(
            ctx,
            error.message === "BALANCE"
              ? "借貸、核准實發或部門分攤不一致，尚未送審。"
              : error.message === "PENDING"
                ? "上次結果尚待確認，請重新讀取或重試原送審內容。"
                : "請確認金額至小數二位、部門、科目及 10 MB 以内佐證文件。",
          );
      }
    });
  }
  async function savePending(ctx) {
    if (!valid(ctx) || ctx.busy || !ctx.pending) return;
    ctx.busy = true;
    var g = ctx.generation,
      p = ctx.pending;
    message(ctx, "正在保存原始佐證並送審…");
    try {
      var sha = await digest(p.file);
      if (!valid(ctx, g)) return;
      var prepared = await call(
        ctx,
        "finance_payroll_accrual_evidence_prepare_v1",
        { p_request_id: p.id, p_obligation_id: p.obligationId },
        g,
      );
      if (
        !prepared ||
        prepared.bucket !== "finance-payroll-evidence" ||
        typeof prepared.path !== "string" ||
        !prepared.path.endsWith("/" + p.obligationId + "/" + p.id + "/source")
      )
        throw Error("RESPONSE");
      var evidence = {
        reference: p.reference,
        sha256: sha,
        bucket: prepared.bucket,
        path: prepared.path,
        size: p.file.size,
        name: p.file.name,
      };
      // Reuse an immutable copy after a lost response; never overwrite evidence.
      var copied = false;
      try {
        await verifyFile(ctx, evidence, g);
        copied = true;
      } catch (copyError) {
        if (!valid(ctx, g) || denied(ctx, copyError)) return;
        if (copyError.message === "EVIDENCE_HASH") throw copyError;
      }
      if (!copied) {
        var uploadError = null;
        try {
          var upload = await timeout(
            ctx.client.storage
              .from(prepared.bucket)
              .upload(prepared.path, p.file, { upsert: false }),
          );
          uploadError = upload && upload.error;
        } catch (error) {
          uploadError = error;
        }
        if (!valid(ctx, g) || denied(ctx, uploadError)) return;
        if (uploadError) {
          // A failed transport response may follow a completed storage write.
          await verifyFile(ctx, evidence, g);
        }
      }
      await verifyFile(ctx, evidence, g);
      var saved = await call(
        ctx,
        "finance_payroll_accrual_save_v1",
        {
          p_request_id: p.id,
          p_obligation_id: p.obligationId,
          p_entries: p.entries,
          p_evidence: evidence,
        },
        g,
      );
      if (!saved || saved.ok !== true) throw Error("RESPONSE");
      ctx.pending = null;
      ctx.busy = false;
      await load(ctx);
    } catch (error) {
      if (denied(ctx, error) || !valid(ctx, g)) return;
      if (/^(22023|23514|23505|40001)$/.test(error.code || ""))
        ctx.pending = null;
      message(
        ctx,
        error.message === "EVIDENCE_HASH"
          ? "佐證檔案指紋不一致，已停止送審。請核對原件。"
          : /APPROVED_GROSS_DEDUCTION/.test(error.message)
            ? "應發與扣款不符合人資核准來源，尚未送審。請會計核對清冊。"
            : /SETTLEMENT_ALREADY_EXPENSED|PRIOR_SETTLEMENT/.test(error.message)
              ? "既有付款傳票與應計科目不一致，已阻止重複認列。請會計先完成更正。"
              : /期間已關閉/.test(error.message)
                ? "薪資來源月份已關帳，尚未送審。請依正式補正程序處理。"
                : "尚未確認送審結果。請重新讀取或重試原內容；系統會保留相同識別碼避免重複登錄。",
      );
    } finally {
      if (valid(ctx, g)) {
        ctx.busy = false;
        if (ctx.pending && !ctx.body.querySelector("[data-payroll-retry]")) {
          var retry = button("重試原送審內容", ctx.body, function () {
            savePending(ctx);
          });
          retry.dataset.payrollRetry = "true";
        }
      }
    }
  }
  function reviewForm(ctx, row, card) {
    var form = node("form", null, card);
    form.style.cssText = "display:grid;gap:12px;max-width:640px";
    var checked = false;
    button("下載並核對原始佐證", form, async function () {
      var g = ctx.generation;
      try {
        var file = await verifyFile(ctx, row.evidence, g);
        if (!valid(ctx, g)) return;
        checked = true;
        var url = URL.createObjectURL(file),
          link = node("a", null, document.body);
        link.href = url;
        link.download = row.evidence.name || "薪資應計佐證";
        link.click();
        link.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 1000);
        message(ctx, "已核對保存原件的 SHA-256，請再確認文件內容及部門分攤。");
      } catch (error) {
        checked = false;
        if (!denied(ctx, error) && valid(ctx, g))
          message(ctx, "原始佐證未能核對，請重新下載；尚未入帳。");
      }
    });
    var reason = field("覆核／退回原因", form);
    reason.maxLength = 500;
    var confirm = field("我已核對原件、核准清冊及各部門分攤", form);
    confirm.type = "checkbox";
    confirm.style.cssText = "display:inline;width:20px;height:20px";
    var approve = button("核准應計並入帳", form, function () {
      act(false);
    });
    approve.dataset.payrollApprove = "true";
    button("退回會計補正", form, function () {
      act(true);
    });
    async function act(returned) {
      if (!valid(ctx) || ctx.busy || !reason.value.trim()) return;
      if (!returned && (!checked || !confirm.checked)) {
        message(ctx, "請先下載核對原件並確認覆核內容。尚未入帳。");
        return;
      }
      ctx.busy = true;
      var g = ctx.generation;
      try {
        var reviewed = await call(
          ctx,
          returned
            ? "finance_payroll_accrual_return_v1"
            : "finance_payroll_accrual_review_v1",
          {
            p_id: row.id,
            p_expected_version: row.version,
            p_reason: reason.value.trim(),
          },
          g,
        );
        if (!reviewed || reviewed.ok !== true) throw Error("RESPONSE");
        ctx.busy = false;
        await load(ctx);
        if (!returned && valid(ctx) && ctx.afterPost) await ctx.afterPost();
      } catch (error) {
        if (!denied(ctx, error) && valid(ctx, g))
          message(
            ctx,
            /期間已關閉/.test(error.message)
              ? "薪資月份已關帳，尚未入帳。請依正式補正程序處理。"
              : "覆核結果尚未確認，請重新讀取；相同版本重試不會重複產生傳票。",
          );
      } finally {
        if (valid(ctx, g)) ctx.busy = false;
      }
    }
  }
  global.FinancePayrollAccrual = {
    mount: function (element, options) {
      dispose();
      var ctx = Object.assign(
        {
          element: element,
          alive: true,
          rows: [],
          pending: null,
          generation: 0,
          busy: false,
          role: "",
          accounts: [],
          departments: [],
          obligations: [],
          isCurrent: function () {
            return true;
          },
        },
        options,
      );
      ctx.initialPeriod =
        (ctx.obligations[0] || {}).period ||
        new Date().toISOString().slice(0, 7);
      active = ctx;
      shell(ctx);
      load(ctx);
    },
    dispose: dispose,
    cents: cents,
    validate: validate,
    digest: digest,
  };
  if (typeof module !== "undefined" && module.exports)
    module.exports = global.FinancePayrollAccrual;
})(typeof window !== "undefined" ? window : globalThis);
