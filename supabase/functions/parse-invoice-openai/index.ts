const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type InvoiceRequest = {
  fileName?: string;
  mime?: string;
  dataUrl?: string;
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
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return json({ error: "Missing OPENAI_API_KEY secret" }, 500);

  const body = (await req.json()) as InvoiceRequest;
  if (!body.dataUrl) return json({ error: "Missing dataUrl" }, 400);

  const mime = body.mime || "";
  const isPdf = mime.includes("pdf") || body.fileName?.toLowerCase().endsWith(".pdf");
  const base64 = body.dataUrl.includes(",") ? body.dataUrl.split(",")[1] : body.dataUrl;

  const fileInput = isPdf
    ? { type: "input_file", filename: body.fileName || "invoice.pdf", file_data: base64 }
    : { type: "input_image", image_url: body.dataUrl, detail: "high" };

  const schema = {
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
      "warnings",
    ],
  };

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
              text:
                "請辨識這張台灣發票、收據或請款憑據。只輸出 JSON。金額請轉成數字；日期用 YYYY-MM-DD；若看不清楚請把 confidence 降低並在 warnings 說明。buyer 指買受人，seller 指開立方。accounting_subject_suggestion 請依內容用繁體中文建議會計科目，例如旅費、文具用品、勞務費、租金支出、其他費用。",
            },
            fileInput,
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "invoice_ocr_result",
          schema,
          strict: false,
        },
      },
    }),
  });

  const payload = await openaiRes.json();
  if (!openaiRes.ok) return json({ error: payload.error?.message || "OpenAI request failed" }, 502);

  try {
    return json({ invoice: JSON.parse(outputText(payload)) });
  } catch {
    return json({ error: "OpenAI returned non-JSON output", raw: outputText(payload) }, 502);
  }
});
