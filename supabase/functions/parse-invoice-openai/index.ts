const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InvoiceRequest = {
  fileName?: string;
  mime?: string;
  dataUrl?: string;
  mode?: "invoice" | "expense_items" | "passbook";
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

  const mime = body.mime || "";
  const isPdf = mime.includes("pdf") || body.fileName?.toLowerCase().endsWith(".pdf");
  const fileInput = isPdf
    ? { type: "input_file", filename: body.fileName || "invoice.pdf", file_data: body.dataUrl }
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
      "items",
      "warnings",
    ],
  };

  const isPassbook = body.mode === "passbook";
  const schema = isPassbook ? passbookSchema : invoiceSchema;
  const prompt = isPassbook
    ? "請辨識這張台灣銀行存摺封面或帳戶資料截圖。只輸出 JSON。請抓取 account_name（戶名/收款人）、bank_name（銀行名稱，例如兆豐銀行、玉山銀行）、branch_name（分行名稱，若看不到填空字串）、account_number（帳號，保留原格式但移除多餘空白）、bank_code（銀行代號，例如 017，若看不到填空字串）、confidence、warnings。若不是存摺封面或看不清楚，請降低 confidence 並在 warnings 說明。"
    : "請辨識這張台灣發票、收據或請款憑據。只輸出 JSON。金額請轉成數字；日期用 YYYY-MM-DD；若看不清楚請把 confidence 降低並在 warnings 說明。buyer 指買受人，seller 指開立方。items 請列出每個商品或費用項目，包含 item_name、quantity、unit、unit_price、total_amount；unit 請填單位，例如個、張、式、月、次、份，若看不到請填空字串；若憑據只看得到總額，items 請放一筆摘要列。accounting_subject_suggestion 請依內容用繁體中文建議會計科目，例如旅費、文具用品、勞務費、租金支出、其他費用。";

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
          name: isPassbook ? "passbook_ocr_result" : "invoice_ocr_result",
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
    return json(isPassbook ? { passbook: parsed } : { invoice: parsed });
  } catch (err) {
    return json({ error: "OpenAI returned non-JSON output", detail: err instanceof Error ? err.message : String(err), raw: outputText(payload) }, 502);
  }
});
