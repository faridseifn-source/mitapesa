const { AnalyticsAssistantProvider } = require("./AnalyticsAssistantProvider");

// gpt-4o-mini: $0.15/M input tokens, $0.60/M output tokens — same
// verified pricing OpenAiVoiceParserProvider uses, same model, for
// consistency and because these are both short, structured tasks well
// within its capability.
const INPUT_COST_PER_TOKEN = 0.15 / 1_000_000;
const OUTPUT_COST_PER_TOKEN = 0.60 / 1_000_000;

const SUPPORTED_INTENTS = ["breakdown", "trend", "comparison", "ranking", "single_value", "unsupported"];
const SUPPORTED_METRICS = ["sum", "average", "count"];
const SUPPORTED_GROUP_BY = ["category", "month", "week", "merchant"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * IMPORTANT — a real, disclosed limitation of this implementation: this
 * was built and reviewed without the ability to make a live test call
 * against OpenAI's API (no network access in the development sandbox
 * this was built in). The request/response shape below matches OpenAI's
 * documented Chat Completions + JSON-mode API as of this writing, but
 * the first real deploy is the actual first live test of this exact
 * code path. Same posture as OpenAiVoiceParserProvider before its own
 * first live use — treat a failure here as "check the Render logs,"
 * not "assume the whole feature is broken."
 */
class OpenAiAnalyticsAssistantProvider extends AnalyticsAssistantProvider {
  constructor({ apiKey }) {
    super();
    this.apiKey = apiKey;
  }

  async suggestProjectCategories({ description, language }) {
    const prompt = [
      "You help a customer of a Tanzanian personal finance app set up a spending project (for example building a house, a wedding, school fees, starting a business, a funeral, a farm). From their short description, suggest a practical starting set of spending categories to track that project's costs, the way a sensible person in Tanzania would budget it.",
      "Rules: 5 to 9 categories; each 1 to 4 words, in English, Title Case, no numbers, no amounts, no currency; always include \"Contingency\" as the last one; do not repeat; never include personal names, phone numbers or anything the customer did not describe.",
      `Also give a short friendly project title (max 5 words) in ${language === "sw" ? "Swahili" : "English"}.`,
      'Respond with ONLY a JSON object: {"title": string, "categories": [string, ...]}.',
      "If the description is not about a spending project, respond with {\"title\": null, \"categories\": []}.",
    ].join("\n");
    const data = await this._chatJson(prompt, `Project description: "${String(description).slice(0, 300)}"`, 300);
    const raw = Array.isArray(data.parsed?.categories) ? data.parsed.categories : [];
    const categories = [];
    for (const c of raw) {
      if (typeof c !== "string") continue;
      const n = c.trim().replace(/\s+/g, " ").slice(0, 40);
      if (n.length >= 2 && /^[\p{L}0-9 &'/-]+$/u.test(n) && !categories.some((x) => x.toLowerCase() === n.toLowerCase())) categories.push(n);
      if (categories.length >= 10) break;
    }
    const title = typeof data.parsed?.title === "string" ? data.parsed.title.trim().slice(0, 60) || null : null;
    return { title, categories, estimatedCostUsd: data.estimatedCostUsd };
  }

  async interpretQuestion({ question, today, categoryNames }) {
    const categoryList = categoryNames.length ? categoryNames.join(", ") : "Other";
    const prompt = [
      "You are reading a question a Tanzanian customer typed into their personal finance app, asking about their own expense history. Your only job is to translate their question into a structured query — you never see their actual transaction data, and you never compute a number yourself.",
      `Today's date is ${today}. Resolve any relative period (\"this month\", \"last 3 months\", \"this year\", \"mwezi huu\") into actual YYYY-MM-DD dates using that. If the customer doesn't name a period at all, default to the current calendar month.`,
      "Respond with a JSON object with exactly these fields:",
      `- "intent": exactly one of ${JSON.stringify(SUPPORTED_INTENTS)}. Use "breakdown" for \"where did my money go\"/spend split by category; "trend" for spend changing over time; "comparison" for two periods compared; "ranking" for \"what do I spend the most on\"/top categories or merchants; "single_value" for one specific number (e.g. \"how much did I spend on transport in August\"); "unsupported" if the question genuinely isn't about this customer's own expense history (e.g. investment advice, a general finance question, something unrelated entirely) or is too ambiguous to answer confidently.`,
      `- "metric": exactly one of ${JSON.stringify(SUPPORTED_METRICS)} — almost always "sum" unless the customer specifically asks for an average or a count of transactions.`,
      `- "groupBy": exactly one of ${JSON.stringify(SUPPORTED_GROUP_BY)}, or null. Required (non-null) for "breakdown" (usually "category"), "trend" (usually "month"), and "ranking" (usually "category" or "merchant"). Usually null for "single_value" and "comparison".`,
      '- "from" and "to": YYYY-MM-DD, the period to analyze, resolved per the date instructions above.',
      '- "compareFrom" and "compareTo": YYYY-MM-DD, only set (both, or neither) when intent is "comparison" — the second period being compared against "from"/"to". Null otherwise.',
      `- "categoryFilter": if the customer named one specific category to focus on, copy it exactly from this list: [${categoryList}]. Otherwise null. Never invent a category not in this list.`,
      '- "limit": for "ranking" only, how many results they asked for (default 5 if unspecified). Null for every other intent.',
      '- "clarification": null, unless intent is "unsupported" — in that case, one short, friendly sentence explaining why this can\'t be answered from their expense history, or what to ask instead.',
      "Respond with ONLY the JSON object, no other text.",
    ].join("\n");

    const data = await this._chatJson(prompt, `Question: "${question}"`, 400);
    const parsed = data.parsed;

    const clean = {
      intent: SUPPORTED_INTENTS.includes(parsed?.intent) ? parsed.intent : "unsupported",
      metric: SUPPORTED_METRICS.includes(parsed?.metric) ? parsed.metric : "sum",
      groupBy: SUPPORTED_GROUP_BY.includes(parsed?.groupBy) ? parsed.groupBy : null,
      from: typeof parsed?.from === "string" && DATE_RE.test(parsed.from) ? parsed.from : null,
      to: typeof parsed?.to === "string" && DATE_RE.test(parsed.to) ? parsed.to : null,
      compareFrom: typeof parsed?.compareFrom === "string" && DATE_RE.test(parsed.compareFrom) ? parsed.compareFrom : null,
      compareTo: typeof parsed?.compareTo === "string" && DATE_RE.test(parsed.compareTo) ? parsed.compareTo : null,
      categoryFilter: typeof parsed?.categoryFilter === "string" && categoryNames.includes(parsed.categoryFilter) ? parsed.categoryFilter : null,
      limit: typeof parsed?.limit === "number" && parsed.limit > 0 ? Math.min(Math.round(parsed.limit), 20) : null,
      clarification: typeof parsed?.clarification === "string" ? parsed.clarification.trim().slice(0, 300) || null : null,
    };
    // A query this app can't actually run yet (missing dates for a
    // date-scoped intent) is treated the same as "unsupported" — better
    // to ask the customer to rephrase than to run a query with a missing
    // boundary and risk scanning far more data than intended.
    if (clean.intent !== "unsupported" && (!clean.from || !clean.to)) {
      clean.intent = "unsupported";
      clean.clarification = clean.clarification || "I couldn't work out what time period you meant — could you rephrase with a specific period, like \"this month\" or \"the last 3 months\"?";
    }

    return { querySpec: clean, estimatedCostUsd: data.estimatedCostUsd };
  }

  async summarizeResults({ question, querySpec, results }) {
    const prompt = [
      "You are writing a short executive summary for a Tanzanian customer looking at their own personal expense data, based on real numbers already computed for you.",
      "CRITICAL: use only the exact numbers given to you below. Never calculate, estimate, round differently, or invent any figure not literally present in this data — if you're unsure how to phrase something without inventing a number, describe it qualitatively instead.",
      "Amounts are in TZS (Tanzanian Shillings) unless stated otherwise — write them naturally (e.g. \"TZS 450,000\", not a raw unformatted number).",
      "Write 2-4 short sentences, plain language, no headers or bullet points, as if briefly answering the customer directly. Reference their own question's phrasing lightly for tone, but every number must come from the data below.",
      `Their question: "${question}"`,
      `What was actually queried: ${JSON.stringify(querySpec)}`,
      `The real, computed results: ${JSON.stringify(results)}`,
      "Respond with ONLY the summary text, no JSON, no quotation marks around it.",
    ].join("\n");

    const data = await this._chatJson(prompt, null, 250, false);
    return { summary: data.text.trim(), estimatedCostUsd: data.estimatedCostUsd };
  }

  // Shared chat-completion call for both methods above. asJson controls
  // whether response_format: json_object is requested — interpretQuestion
  // needs structured output, summarizeResults is plain prose and forcing
  // JSON mode on it would require asking the model to wrap prose in a
  // JSON string for no real benefit.
  async _chatJson(systemPrompt, userContent, maxTokens, asJson = true) {
    const messages = userContent
      ? [{ role: "user", content: `${systemPrompt}\n\n${userContent}` }]
      : [{ role: "user", content: systemPrompt }];

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        ...(asJson ? { response_format: { type: "json_object" } } : {}),
        max_tokens: maxTokens,
        messages,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`OpenAI analytics request failed (${response.status}): ${errBody.slice(0, 300)}`);
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) throw new Error("OpenAI analytics response had no content");

    const usage = data?.usage;
    const estimatedCostUsd = usage
      ? (usage.prompt_tokens || 0) * INPUT_COST_PER_TOKEN + (usage.completion_tokens || 0) * OUTPUT_COST_PER_TOKEN
      : 0;

    if (!asJson) return { text: raw, estimatedCostUsd };

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`OpenAI analytics response wasn't valid JSON: ${raw.slice(0, 200)}`);
    }
    return { parsed, estimatedCostUsd };
  }
}

module.exports = { OpenAiAnalyticsAssistantProvider };
