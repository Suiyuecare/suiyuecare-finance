const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InvoiceRequest = {
  fileName?: string;
  mime?: string;
  dataUrl?: string;
  mode?: "invoice" | "expense_items" | "passbook" | "hr_expense_items" | "hr_labor_fee";
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function outputText(payload: any) {
  if (payload.output_text) return payload.output_text;
  const chunks: string[] = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      else if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function parseModelJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    if (start < 0) throw new Error("missing JSON object");

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === "\"") inString = false;
      } else if (ch === "\"") {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) return JSON.parse(text.slice(start, i + 1));
      }
    }
    throw new Error("incomplete JSON object");
  }
}

async function getOpenAIKey() {
  const directKey = Deno.env.get("OPENAI_API_KEY");
  if (directKey) return directKey;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return "";

  const res = await fetch(`${supabaseUrl}/rest/v1/rpc/get_openai_invoice_key`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });

  if (!res.ok) return "";
  const value = await res.json();
  return typeof value === "string" ? value : "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = await getOpenAIKey();
  if (!apiKey) return json({ error: "Missing OPENAI_API_KEY secret or Vault key" }, 500);

  const body = (await req.json()) as InvoiceRequest;
  if (!body.dataUrl) return json({ error: "Missing dataUrl" }, 400);

  const mime = (body.mime || "").toLowerCase();
  const fileName = body.fileName || "upload";
  const lowerName = fileName.toLowerCase();
  const isFileLike =
    mime.includes("pdf") ||
    mime.includes("word") ||
    mime.includes("officedocument") ||
    mime.includes("excel") ||
    mime.includes("spreadsheet") ||
    mime.includes("csv") ||
    mime.includes("text/plain") ||
    /\.(pdf|doc|docx|xls|xlsx|csv|txt)$/i.test(lowerName);
  const fileInput = isFileLike
    ? { type: "input_file", filename: fileName, file_data: body.dataUrl }
    : { type: "input_image", image_url: body.dataUrl, detail: "high" };

  const passbookSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      account_name: { type: "string" },
      bank_name: { type: "string" },
      branch_name: { type: "string" },
      account_number: { type: "string" },
      bank_code: { type: "string" },
      confidence: { type: "number" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["account_name", "bank_name", "branch_name", "account_number", "bank_code", "confidence", "warnings"],
  };

  const invoiceSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      invoice_number: { type: "string" },
      invoice_date: { type: "string" },
      seller_name: { type: "string" },
      seller_tax_id: { type: "string" },
      buyer_name: { type: "string" },
      buyer_tax_id: { type: "string" },
      description: { type: "string" },
      amount_excluding_tax: { type: "number" },
      tax_amount: { type: "number" },
      total_amount: { type: "number" },
      currency: { type: "string" },
      confidence: { type: "number" },
      accounting_subject_suggestion: { type: "string" },
      usage_context_suggestion: { type: "string" },
      tax_treatment_suggestion: { type: "string" },
      assetization_suggestion: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_name: { type: "string" },
            quantity: { type: "number" },
            unit: { type: "string" },
            unit_price: { type: "number" },
            total_amount: { type: "number" },
          },
          required: ["item_name", "quantity", "unit", "unit_price", "total_amount"],
        },
      },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: [
      "invoice_number",
      "invoice_date",
      "seller_name",
      "seller_tax_id",
      "buyer_name",
      "buyer_tax_id",
      "description",
      "amount_excluding_tax",
      "tax_amount",
      "total_amount",
      "currency",
      "confidence",
      "accounting_subject_suggestion",
      "usage_context_suggestion",
      "tax_treatment_suggestion",
      "assetization_suggestion",
      "items",
      "warnings",
    ],
  };

  const hrLaborSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      employee_no: { type: "string" },
      payee_name: { type: "string" },
      labor_fee_type: { type: "string", description: "9A 或 9B；若文件無法判斷請填空字串" },
      labor_period: { type: "string", description: "勞務報酬單上的勞務期間原文；若文件沒有請填空字串" },
      salary_month: { type: "string", description: "YYYY-MM-DD；以勞務期間月份加 1 個月的 15 日輸出，若無法判斷請填空字串" },
      payment_amount: { type: "number" },
      bank_name: { type: "string" },
      branch_name: { type: "string" },
      account_number: { type: "string" },
      id_number: { type: "string" },
      withholding_tax: { type: "number" },
      supplemental_premium: { type: "number" },
      confidence: { type: "number" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: [
      "employee_no",
      "payee_name",
      "labor_fee_type",
      "labor_period",
      "salary_month",
      "payment_amount",
      "bank_name",
      "branch_name",
      "account_number",
      "id_number",
      "withholding_tax",
      "supplemental_premium",
      "confidence",
      "warnings",
    ],
  };

  const hrExpenseSchema = {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            employee_no: { type: "string" },
            payee_name: { type: "string" },
            expense_type: {
              type: "string",
              description: "50薪資、獎金、9A勞務報酬單、9B勞務報酬單、勞保、健保、勞退、二代健保補充保費、資遣費或其他",
            },
            labor_period: { type: "string", description: "9A/9B 勞務報酬單的勞務期間原文；非勞報單或沒有期間請填空字串" },
            salary_month: { type: "string", description: "YYYY-MM-DD；9A/9B 以勞務期間月份加 1 個月的 15 日輸出，其他人事費用若文件有付款日/薪資日則填該日期，否則空字串" },
            payment_amount: { type: "number" },
            bank_name: { type: "string" },
            branch_name: { type: "string" },
            account_number: { type: "string" },
            note: { type: "string" },
          },
          required: [
            "employee_no",
            "payee_name",
            "expense_type",
            "labor_period",
            "salary_month",
            "payment_amount",
            "bank_name",
            "branch_name",
            "account_number",
            "note",
          ],
        },
      },
      confidence: { type: "number" },
      warnings: { type: "array", items: { type: "string" } },
    },
    required: ["rows", "confidence", "warnings"],
  };

  const isPassbook = body.mode === "passbook";
  const isHrLabor = body.mode === "hr_labor_fee";
  const isHrExpense = body.mode === "hr_expense_items";
  const schema = isPassbook ? passbookSchema : isHrLabor ? hrLaborSchema : isHrExpense ? hrExpenseSchema : invoiceSchema;
  const prompt = isPassbook
    ? "請辨識這張台灣銀行存摺封面或帳戶資料截圖。只輸出 JSON。請抓取 account_name（戶名/收款人）、bank_name（銀行名稱，例如兆豐銀行、玉山銀行）、branch_name（分行名稱，若看不到填空字串）、account_number（帳號，保留原格式但移除多餘空白）、bank_code（銀行代號，例如 017，若看不到填空字串）、confidence、warnings。若不是存摺封面或看不清楚，請降低 confidence 並在 warnings 說明。"
    : isHrLabor
      ? "請辨識這份台灣 9A/9B 勞務報酬單或接案人員勞報單。只輸出 JSON。請特別抓取：payee_name（所得人/收款人/姓名）、labor_fee_type（文件若標示 9A 就填 9A，標示 9B 就填 9B；無法判斷填空字串）、labor_period（勞務期間原文，例如 2026/06/01-2026/06/30 或 115年5月）、salary_month（薪資發放日，請以勞務期間月份加 1 個月的 15 日輸出 YYYY-MM-DD，例如勞務期間 2026/06 則輸出 2026-07-15；無法判斷填空字串，不要用檔名月份或今天日期猜測）、payment_amount（實際匯款/實領/應付金額，若只有給付總額則填給付總額）、bank_name、branch_name、account_number。若文件有 employee_no、身分證字號、扣繳稅額、補充保費，也請填入 employee_no、id_number、withholding_tax、supplemental_premium。帳號請以字串輸出、保留完整位數，不可使用科學記號，並移除多餘空白與破折號以外的雜訊。若看不清楚請降低 confidence 並在 warnings 說明。"
      : isHrExpense
        ? "請辨識這份台灣人事費用支出表、薪資表、獎金表、勞健保繳費表、勞退表、二代健保補充保費表、資遣費或其他人事費用明細。只輸出 JSON。請把每一位或每一筆支出轉成 rows。每列請抓取 employee_no（員工編號，沒有則空字串）、payee_name（姓名/收款人）、expense_type（請優先填 50薪資、獎金、9A勞務報酬單、9B勞務報酬單、勞保、健保、勞退、二代健保補充保費、資遣費、其他；若看到 9A 或 9B 必須分開填）、labor_period（9A/9B 勞報單請抓勞務期間原文，其他類型填空字串）、salary_month（9A/9B 請以勞務期間月份加 1 個月的 15 日輸出 YYYY-MM-DD，例如勞務期間 2026/06 則輸出 2026-07-15；其他類型若文件有薪資日或付款日才填，否則空字串）、payment_amount（實際匯款金額/應付金額）、bank_name、branch_name、account_number、note。銀行、分行、帳號若文件沒有請填空字串，不要猜測；帳號請以字串輸出、保留完整位數，不可使用科學記號。若看不清楚請降低 confidence 並在 warnings 說明。"
      : "請辨識這張台灣發票、收據或請款憑據。只輸出 JSON。金額請轉成數字；日期用 YYYY-MM-DD；若看不清楚請把 confidence 降低並在 warnings 說明。buyer 指買受人，seller 指開立方。items 請列出每個商品或費用項目，包含 item_name、quantity、unit、unit_price、total_amount；unit 請填單位，例如個、張、式、月、次、份，若看不到請填空字串；若憑據只看得到總額，items 請放一筆摘要列。會計科目建議請先判斷使用情境，再看商品品項與明細。accounting_subject_suggestion 請依內容用繁體中文建議，例如差旅費、交通費、文具用品、印刷費、勞務費、租金支出、保險費、修繕費、廣告費、郵電費、長照服務成本、課程活動成本、固定資產待確認、其他費用。usage_context_suggestion 請填行政營運、長照服務、課程活動、差旅、人事、採購、股東往來、公司間往來或不確定。tax_treatment_suggestion 請填發票可扣抵、非發票不扣抵或需會計確認。assetization_suggestion 請說明是否可能需要資產化，若否請填不需資產化。";

  const openaiRes = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("OPENAI_INVOICE_MODEL") || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: prompt,
            },
            fileInput,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: isPassbook ? "passbook_ocr_result" : isHrLabor ? "hr_labor_fee_ocr_result" : isHrExpense ? "hr_expense_ocr_result" : "invoice_ocr_result",
          schema,
          strict: false,
        },
      },
    }),
  });

  const payload = await openaiRes.json();
  if (!openaiRes.ok) return json({ error: payload.error?.message || "OpenAI request failed" }, 502);

  try {
    const parsed = parseModelJson(outputText(payload));
    return json(isPassbook ? { passbook: parsed } : isHrLabor ? { hr_labor: parsed } : isHrExpense ? { hr_expense: parsed } : { invoice: parsed });
  } catch (err) {
    return json({ error: "OpenAI returned non-JSON output", detail: err instanceof Error ? err.message : String(err), raw: outputText(payload) }, 502);
  }
});
