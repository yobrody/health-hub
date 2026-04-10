var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// api/ai/analyze-food.js
var CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Health-Key"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
__name(json, "json");
async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
__name(onRequestOptions, "onRequestOptions");
function extractJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
  }
  const m = str.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
    }
  }
  return null;
}
__name(extractJSON, "extractJSON");
var PROMPT = /* @__PURE__ */ __name((desc) => `Analyze this food image${desc ? ` (user says: "${desc}")` : ""}.

Return ONLY valid JSON, no markdown:
{"name":"short food name","kcal":450,"protein_g":35,"carbs_g":40,"fat_g":12,"description":"one sentence description","confidence":"high"}

confidence: "high" if clearly visible, "medium" if partially visible, "low" if unclear.
Be realistic about portion sizes. If no food visible, set kcal to 0.`, "PROMPT");
async function onRequestPost(context) {
  const expected = context.env.HEALTH_API_KEY || "brody-health-hub-2026";
  const orKey = context.env.OPENROUTER_API_KEY;
  if (!orKey) return json({ error: "OpenRouter not configured" }, 503);
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const { image, mimeType = "image/jpeg", description = "" } = body;
  if (!image) return json({ error: "No image provided" }, 400);
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${orKey}`,
        "HTTP-Referer": "https://health-hub-dwz.pages.dev",
        "X-Title": "Health Hub"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        max_tokens: 300,
        provider: { order: ["Google"], allow_fallbacks: false },
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${image}` } },
            { type: "text", text: PROMPT(description) }
          ]
        }]
      })
    });
    if (!res.ok) {
      const err = await res.text();
      console.error("OpenRouter error:", err);
      return json({ error: "AI error", detail: err.slice(0, 100) }, 502);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "{}";
    const result = extractJSON(text);
    if (!result) throw new Error("No JSON in response");
    return json({
      name: result.name || description || "Unknown food",
      kcal: result.kcal || 0,
      protein_g: result.protein_g || 0,
      carbs_g: result.carbs_g || 0,
      fat_g: result.fat_g || 0,
      description: result.description || "",
      confidence: result.confidence || "medium"
    });
  } catch (e) {
    console.error("analyze-food error:", e);
    return json({
      name: description || "Unknown food",
      kcal: 0,
      protein_g: 0,
      carbs_g: 0,
      fat_g: 0,
      description: "Could not analyse \u2014 enter details manually",
      confidence: "low"
    });
  }
}
__name(onRequestPost, "onRequestPost");

// api/ai/meals.js
var CORS2 = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Health-Key"
};
var VPS_BASE = "http://128-140-33-150.nip.io:8080";
function json2(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS2 });
}
__name(json2, "json");
async function onRequestOptions2() {
  return new Response(null, { status: 204, headers: CORS2 });
}
__name(onRequestOptions2, "onRequestOptions");
function extractJSON2(str) {
  try {
    return JSON.parse(str);
  } catch {
  }
  const m = str.match(/\[[\s\S]*\]/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
    }
  }
  const m2 = str.match(/\{[\s\S]*\}/);
  if (m2) {
    try {
      const o = JSON.parse(m2[0]);
      return o.meals || o;
    } catch {
    }
  }
  return null;
}
__name(extractJSON2, "extractJSON");
async function onRequestPost2(context) {
  const expected = context.env.HEALTH_API_KEY || "brody-health-hub-2026";
  const orKey = context.env.OPENROUTER_API_KEY;
  if (!orKey) return json2({ error: "OpenRouter not configured", meals: [] }, 503);
  let fridgeItems = [];
  try {
    const kv = context.env.FRIDGE_META;
    const vpsRes = await fetch(`${VPS_BASE}/fridge`, {
      headers: { "X-Health-Key": expected, "Content-Type": "application/json" }
    });
    if (vpsRes.ok) {
      const fridgeData = await vpsRes.json();
      const zones = ["fridge", "freezer", "pantry", "condiments"];
      for (const zone of zones) {
        if (!Array.isArray(fridgeData[zone])) continue;
        for (const item of fridgeData[zone]) {
          let meta = {};
          if (kv) {
            try {
              const ms = await kv.get((item.name || "").toLowerCase().trim());
              if (ms) meta = JSON.parse(ms);
            } catch {
            }
          }
          fridgeItems.push({ name: item.name, zone, size: meta.size || null });
        }
      }
    }
  } catch (e) {
    console.error("Failed to fetch fridge:", e);
  }
  if (fridgeItems.length === 0) {
    return json2({ meals: [] });
  }
  const itemList = fridgeItems.map((i) => `- ${i.name}${i.size ? ` (${i.size})` : ""} [${i.zone}]`).join("\n");
  const prompt = `I have these ingredients in my fridge/pantry:
${itemList}

Suggest 3 meals I can make. Return ONLY valid JSON array, no markdown:
[{"name":"Meal Name","ingredients":["item1","item2"],"kcal_estimate":450},...]`;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${orKey}`,
        "HTTP-Referer": "https://health-hub-dwz.pages.dev",
        "X-Title": "Health Hub"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        max_tokens: 800,
        provider: { order: ["Google"], allow_fallbacks: false },
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      return json2({ error: `AI error ${res.status}`, meals: [] }, 502);
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "[]";
    const parsed = extractJSON2(text);
    const meals = Array.isArray(parsed) ? parsed : parsed?.meals || [];
    return json2({ meals: meals.slice(0, 3) });
  } catch (e) {
    return json2({ error: "AI request failed: " + String(e), meals: [] }, 502);
  }
}
__name(onRequestPost2, "onRequestPost");

// api/fridge/scan.js
var CORS3 = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Health-Key"
};
function json3(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS3 });
}
__name(json3, "json");
async function onRequestOptions3() {
  return new Response(null, { status: 204, headers: CORS3 });
}
__name(onRequestOptions3, "onRequestOptions");
function extractJSON3(str) {
  try {
    return JSON.parse(str);
  } catch {
  }
  let depth = 0, end = -1;
  for (let i = str.length - 1; i >= 0; i--) {
    if (str[i] === "}") {
      if (depth === 0) end = i;
      depth++;
    } else if (str[i] === "{") {
      depth--;
      if (depth === 0 && end !== -1) {
        try {
          return JSON.parse(str.slice(i, end + 1));
        } catch {
        }
      }
    }
  }
  const m = str.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch {
    }
  }
  return null;
}
__name(extractJSON3, "extractJSON");
var PROMPT2 = `Look at this grocery store receipt. Extract the purchased food and drink items.

Return ONLY valid JSON \u2014 no markdown, no explanation:
{"store":{"name":"store name","location":"address/area on receipt or null"},"items":[{"name":"readable name","size":"package size or null","cost":1.89,"section":"fridge"}]}

Rules:
- name: clean readable name (e.g. "greek yogurt" not "GREEK YOG 10%", "peanut butter" not "PNT BTR 340G")
- size: package size if visible on receipt (e.g. "340g", "1L") \u2014 null if not shown
- cost: item price as a number (e.g. 2.25) \u2014 null if not visible
- section: one of "fridge", "freezer", "pantry", "condiments"
  - fridge: dairy, fresh produce, eggs, fresh meat/fish, yogurt, juice, deli
  - freezer: frozen meals, ice cream, frozen veg/meat
  - pantry: canned goods, dry goods, snacks, coffee, tea, bread, nuts, spreads, chocolate
  - condiments: sauces, oils, vinegar, dressings, spices
- INCLUDE all food and drink items on the receipt
- SKIP non-food items (foil, bags, cleaning supplies, toiletries, packaging)
- SKIP totals, subtotals, VAT lines, discounts, store header rows
- If a name contains "/" (e.g. "edamame/mushroom") add both as separate items`;
async function onRequestPost3(context) {
  const expected = context.env.HEALTH_API_KEY || "brody-health-hub-2026";
  const orKey = context.env.OPENROUTER_API_KEY;
  if (!orKey) return json3({ error: "OpenRouter key not configured", items: [] }, 503);
  let imageBase64, imageMediaType = "image/jpeg";
  try {
    const body = await context.request.json();
    if (!body.image) return json3({ error: "No image provided" }, 400);
    imageBase64 = body.image;
    imageMediaType = body.mimeType || "image/jpeg";
  } catch (e) {
    return json3({ error: "Bad request: " + String(e) }, 400);
  }
  let claudeText = "";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${orKey}`,
        "HTTP-Referer": "https://health-hub-dwz.pages.dev",
        "X-Title": "Health Hub"
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        max_tokens: 1500,
        provider: { order: ["Google"], allow_fallbacks: false },
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${imageMediaType};base64,${imageBase64}` } },
            { type: "text", text: PROMPT2 }
          ]
        }]
      })
    });
    if (!res.ok) {
      const t = await res.text();
      return json3({ error: `AI error ${res.status}: ${t.slice(0, 150)}`, items: [] }, 502);
    }
    const data = await res.json();
    claudeText = data.choices?.[0]?.message?.content || "";
  } catch (e) {
    return json3({ error: "AI request failed: " + String(e), items: [] }, 502);
  }
  const parsed = extractJSON3(claudeText);
  if (!parsed) {
    return json3({ error: "Could not parse AI response", raw: claudeText.slice(0, 200), items: [] });
  }
  const store = parsed.store || null;
  const items = Array.isArray(parsed.items) ? parsed.items.filter((i) => i?.name).map((i) => ({
    name: i.name.toLowerCase().trim(),
    size: i.size || null,
    cost: typeof i.cost === "number" ? i.cost : null,
    section: ["fridge", "freezer", "pantry", "condiments"].includes(i.section) ? i.section : "fridge"
  })) : [];
  return json3({ items, store });
}
__name(onRequestPost3, "onRequestPost");

// api/stats/week.js
var CORS4 = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Health-Key"
};
var VPS_BASE2 = "http://128-140-33-150.nip.io:8080";
function json4(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS4 });
}
__name(json4, "json");
async function onRequestOptions4() {
  return new Response(null, { status: 204, headers: CORS4 });
}
__name(onRequestOptions4, "onRequestOptions");
async function onRequestGet(context) {
  const expected = context.env.HEALTH_API_KEY || "brody-health-hub-2026";
  const h = { "X-Health-Key": expected, "Content-Type": "application/json" };
  const [histRes, wkRes, goalsRes] = await Promise.allSettled([
    fetch(`${VPS_BASE2}/food/history?days=7`, { headers: h }),
    fetch(`${VPS_BASE2}/workouts?limit=50`, { headers: h }),
    fetch(`${VPS_BASE2}/goals`, { headers: h })
  ]);
  let food_by_day = [];
  if (histRes.status === "fulfilled" && histRes.value.ok) {
    try {
      const raw = await histRes.value.json();
      food_by_day = (Array.isArray(raw) ? raw : raw.value || []).slice(0, 7);
    } catch {
    }
  }
  if (food_by_day.length === 0) {
    for (let i = 6; i >= 0; i--) {
      const d = /* @__PURE__ */ new Date();
      d.setDate(d.getDate() - i);
      food_by_day.push({ date: d.toISOString().slice(0, 10), total_kcal: 0, logged: false });
    }
  }
  const logged_days = food_by_day.filter((d) => d.logged).length;
  const loggedKcals = food_by_day.filter((d) => d.logged).map((d) => d.total_kcal);
  const avg_kcal = loggedKcals.length ? Math.round(loggedKcals.reduce((a, b) => a + b, 0) / loggedKcals.length) : 0;
  let goal_kcal = 2200, goal_gym_days = 4;
  if (goalsRes.status === "fulfilled" && goalsRes.value.ok) {
    try {
      const g = await goalsRes.value.json();
      goal_kcal = g.parsed?.calories ?? g.calories ?? 2200;
      goal_gym_days = g.parsed?.gym_days ?? g.gym_days ?? 4;
    } catch {
    }
  }
  let workout_count = 0;
  if (wkRes.status === "fulfilled" && wkRes.value.ok) {
    try {
      const raw = await wkRes.value.json();
      const arr = Array.isArray(raw) ? raw : raw.value || [];
      const cutoff = /* @__PURE__ */ new Date();
      cutoff.setDate(cutoff.getDate() - 7);
      workout_count = arr.filter((w) => new Date(w.start_time) >= cutoff).length;
    } catch {
    }
  }
  return json4({ food_by_day, logged_days, avg_kcal, goal_kcal, workout_count, goal_gym_days });
}
__name(onRequestGet, "onRequestGet");

// api/[[path]].js
var VPS_BASE3 = "http://128-140-33-150.nip.io:8080";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Health-Key"
};
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
__name(jsonResp, "jsonResp");
async function onRequest(context) {
  const url = new URL(context.request.url);
  const backendPath = url.pathname.replace(/^\/api/, "") || "/";
  const targetUrl = `${VPS_BASE3}${backendPath}${url.search}`;
  const apiKey = context.env.HEALTH_API_KEY || "brody-health-hub-2026";
  const kv = context.env.FRIDGE_META;
  const reqHeaders = new Headers(context.request.headers);
  reqHeaders.set("X-Health-Key", apiKey);
  reqHeaders.delete("host");
  if (context.request.method === "GET" && backendPath === "/fridge") {
    try {
      const vpsRes = await fetch(targetUrl, { method: "GET", headers: reqHeaders });
      if (!vpsRes.ok) {
        return new Response(await vpsRes.text(), {
          status: vpsRes.status,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }
      const fridgeData = await vpsRes.json();
      if (kv) {
        for (const zone of ["fridge", "freezer", "pantry", "condiments"]) {
          if (!Array.isArray(fridgeData[zone])) continue;
          fridgeData[zone] = await Promise.all(
            fridgeData[zone].map(async (item) => {
              try {
                const key = (item.name || "").toLowerCase().trim();
                const metaStr = await kv.get(key);
                if (metaStr) {
                  const meta = JSON.parse(metaStr);
                  return { ...item, size: meta.size ?? null, cost: meta.cost ?? null, store: meta.store ?? null };
                }
              } catch {
              }
              return item;
            })
          );
        }
      }
      return new Response(JSON.stringify(fridgeData), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
      });
    } catch (err) {
      return jsonResp({ error: "API unreachable", detail: String(err) }, 502);
    }
  }
  if (context.request.method === "POST" && backendPath === "/fridge/item") {
    let body = {};
    try {
      body = await context.request.json();
    } catch {
    }
    const { name, section, size = null, cost = null, store = null } = body;
    let vpsStatus, vpsBody;
    try {
      const vpsRes = await fetch(targetUrl, {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({ name, section })
      });
      vpsStatus = vpsRes.status;
      vpsBody = await vpsRes.text();
    } catch (err) {
      return jsonResp({ error: "VPS unreachable: " + String(err) }, 502);
    }
    if (kv && name && (size !== null || cost !== null || store !== null)) {
      try {
        const key = name.toLowerCase().trim();
        await kv.put(key, JSON.stringify({
          size,
          cost,
          store,
          section: section || "fridge",
          added: (/* @__PURE__ */ new Date()).toISOString()
        }));
      } catch {
      }
    }
    return new Response(vpsBody, {
      status: vpsStatus,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
    });
  }
  const init = {
    method: context.request.method,
    headers: reqHeaders
  };
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    init.body = context.request.body;
  }
  try {
    const response = await fetch(targetUrl, init);
    const resHeaders = new Headers(response.headers);
    resHeaders.set("Access-Control-Allow-Origin", "*");
    resHeaders.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    resHeaders.set("Access-Control-Allow-Headers", "Content-Type, X-Health-Key");
    return new Response(response.body, { status: response.status, headers: resHeaders });
  } catch (err) {
    return jsonResp({ error: "API unreachable", detail: String(err) }, 502);
  }
}
__name(onRequest, "onRequest");
async function onRequestOptions5() {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, "Access-Control-Max-Age": "86400" }
  });
}
__name(onRequestOptions5, "onRequestOptions");

// ../.wrangler/tmp/pages-ER7XPA/functionsRoutes-0.5887118502536449.mjs
var routes = [
  {
    routePath: "/api/ai/analyze-food",
    mountPath: "/api/ai",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions]
  },
  {
    routePath: "/api/ai/analyze-food",
    mountPath: "/api/ai",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost]
  },
  {
    routePath: "/api/ai/meals",
    mountPath: "/api/ai",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions2]
  },
  {
    routePath: "/api/ai/meals",
    mountPath: "/api/ai",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost2]
  },
  {
    routePath: "/api/fridge/scan",
    mountPath: "/api/fridge",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions3]
  },
  {
    routePath: "/api/fridge/scan",
    mountPath: "/api/fridge",
    method: "POST",
    middlewares: [],
    modules: [onRequestPost3]
  },
  {
    routePath: "/api/stats/week",
    mountPath: "/api/stats",
    method: "GET",
    middlewares: [],
    modules: [onRequestGet]
  },
  {
    routePath: "/api/stats/week",
    mountPath: "/api/stats",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions4]
  },
  {
    routePath: "/api/:path*",
    mountPath: "/api",
    method: "OPTIONS",
    middlewares: [],
    modules: [onRequestOptions5]
  },
  {
    routePath: "/api/:path*",
    mountPath: "/api",
    method: "",
    middlewares: [],
    modules: [onRequest]
  }
];

// C:/Users/brody/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/path-to-regexp/dist.es2015/index.js
function lexer(str) {
  var tokens = [];
  var i = 0;
  while (i < str.length) {
    var char = str[i];
    if (char === "*" || char === "+" || char === "?") {
      tokens.push({ type: "MODIFIER", index: i, value: str[i++] });
      continue;
    }
    if (char === "\\") {
      tokens.push({ type: "ESCAPED_CHAR", index: i++, value: str[i++] });
      continue;
    }
    if (char === "{") {
      tokens.push({ type: "OPEN", index: i, value: str[i++] });
      continue;
    }
    if (char === "}") {
      tokens.push({ type: "CLOSE", index: i, value: str[i++] });
      continue;
    }
    if (char === ":") {
      var name = "";
      var j = i + 1;
      while (j < str.length) {
        var code = str.charCodeAt(j);
        if (
          // `0-9`
          code >= 48 && code <= 57 || // `A-Z`
          code >= 65 && code <= 90 || // `a-z`
          code >= 97 && code <= 122 || // `_`
          code === 95
        ) {
          name += str[j++];
          continue;
        }
        break;
      }
      if (!name)
        throw new TypeError("Missing parameter name at ".concat(i));
      tokens.push({ type: "NAME", index: i, value: name });
      i = j;
      continue;
    }
    if (char === "(") {
      var count = 1;
      var pattern = "";
      var j = i + 1;
      if (str[j] === "?") {
        throw new TypeError('Pattern cannot start with "?" at '.concat(j));
      }
      while (j < str.length) {
        if (str[j] === "\\") {
          pattern += str[j++] + str[j++];
          continue;
        }
        if (str[j] === ")") {
          count--;
          if (count === 0) {
            j++;
            break;
          }
        } else if (str[j] === "(") {
          count++;
          if (str[j + 1] !== "?") {
            throw new TypeError("Capturing groups are not allowed at ".concat(j));
          }
        }
        pattern += str[j++];
      }
      if (count)
        throw new TypeError("Unbalanced pattern at ".concat(i));
      if (!pattern)
        throw new TypeError("Missing pattern at ".concat(i));
      tokens.push({ type: "PATTERN", index: i, value: pattern });
      i = j;
      continue;
    }
    tokens.push({ type: "CHAR", index: i, value: str[i++] });
  }
  tokens.push({ type: "END", index: i, value: "" });
  return tokens;
}
__name(lexer, "lexer");
function parse(str, options) {
  if (options === void 0) {
    options = {};
  }
  var tokens = lexer(str);
  var _a = options.prefixes, prefixes = _a === void 0 ? "./" : _a, _b = options.delimiter, delimiter = _b === void 0 ? "/#?" : _b;
  var result = [];
  var key = 0;
  var i = 0;
  var path = "";
  var tryConsume = /* @__PURE__ */ __name(function(type) {
    if (i < tokens.length && tokens[i].type === type)
      return tokens[i++].value;
  }, "tryConsume");
  var mustConsume = /* @__PURE__ */ __name(function(type) {
    var value2 = tryConsume(type);
    if (value2 !== void 0)
      return value2;
    var _a2 = tokens[i], nextType = _a2.type, index = _a2.index;
    throw new TypeError("Unexpected ".concat(nextType, " at ").concat(index, ", expected ").concat(type));
  }, "mustConsume");
  var consumeText = /* @__PURE__ */ __name(function() {
    var result2 = "";
    var value2;
    while (value2 = tryConsume("CHAR") || tryConsume("ESCAPED_CHAR")) {
      result2 += value2;
    }
    return result2;
  }, "consumeText");
  var isSafe = /* @__PURE__ */ __name(function(value2) {
    for (var _i = 0, delimiter_1 = delimiter; _i < delimiter_1.length; _i++) {
      var char2 = delimiter_1[_i];
      if (value2.indexOf(char2) > -1)
        return true;
    }
    return false;
  }, "isSafe");
  var safePattern = /* @__PURE__ */ __name(function(prefix2) {
    var prev = result[result.length - 1];
    var prevText = prefix2 || (prev && typeof prev === "string" ? prev : "");
    if (prev && !prevText) {
      throw new TypeError('Must have text between two parameters, missing text after "'.concat(prev.name, '"'));
    }
    if (!prevText || isSafe(prevText))
      return "[^".concat(escapeString(delimiter), "]+?");
    return "(?:(?!".concat(escapeString(prevText), ")[^").concat(escapeString(delimiter), "])+?");
  }, "safePattern");
  while (i < tokens.length) {
    var char = tryConsume("CHAR");
    var name = tryConsume("NAME");
    var pattern = tryConsume("PATTERN");
    if (name || pattern) {
      var prefix = char || "";
      if (prefixes.indexOf(prefix) === -1) {
        path += prefix;
        prefix = "";
      }
      if (path) {
        result.push(path);
        path = "";
      }
      result.push({
        name: name || key++,
        prefix,
        suffix: "",
        pattern: pattern || safePattern(prefix),
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    var value = char || tryConsume("ESCAPED_CHAR");
    if (value) {
      path += value;
      continue;
    }
    if (path) {
      result.push(path);
      path = "";
    }
    var open = tryConsume("OPEN");
    if (open) {
      var prefix = consumeText();
      var name_1 = tryConsume("NAME") || "";
      var pattern_1 = tryConsume("PATTERN") || "";
      var suffix = consumeText();
      mustConsume("CLOSE");
      result.push({
        name: name_1 || (pattern_1 ? key++ : ""),
        pattern: name_1 && !pattern_1 ? safePattern(prefix) : pattern_1,
        prefix,
        suffix,
        modifier: tryConsume("MODIFIER") || ""
      });
      continue;
    }
    mustConsume("END");
  }
  return result;
}
__name(parse, "parse");
function match(str, options) {
  var keys = [];
  var re = pathToRegexp(str, keys, options);
  return regexpToFunction(re, keys, options);
}
__name(match, "match");
function regexpToFunction(re, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.decode, decode = _a === void 0 ? function(x) {
    return x;
  } : _a;
  return function(pathname) {
    var m = re.exec(pathname);
    if (!m)
      return false;
    var path = m[0], index = m.index;
    var params = /* @__PURE__ */ Object.create(null);
    var _loop_1 = /* @__PURE__ */ __name(function(i2) {
      if (m[i2] === void 0)
        return "continue";
      var key = keys[i2 - 1];
      if (key.modifier === "*" || key.modifier === "+") {
        params[key.name] = m[i2].split(key.prefix + key.suffix).map(function(value) {
          return decode(value, key);
        });
      } else {
        params[key.name] = decode(m[i2], key);
      }
    }, "_loop_1");
    for (var i = 1; i < m.length; i++) {
      _loop_1(i);
    }
    return { path, index, params };
  };
}
__name(regexpToFunction, "regexpToFunction");
function escapeString(str) {
  return str.replace(/([.+*?=^!:${}()[\]|/\\])/g, "\\$1");
}
__name(escapeString, "escapeString");
function flags(options) {
  return options && options.sensitive ? "" : "i";
}
__name(flags, "flags");
function regexpToRegexp(path, keys) {
  if (!keys)
    return path;
  var groupsRegex = /\((?:\?<(.*?)>)?(?!\?)/g;
  var index = 0;
  var execResult = groupsRegex.exec(path.source);
  while (execResult) {
    keys.push({
      // Use parenthesized substring match if available, index otherwise
      name: execResult[1] || index++,
      prefix: "",
      suffix: "",
      modifier: "",
      pattern: ""
    });
    execResult = groupsRegex.exec(path.source);
  }
  return path;
}
__name(regexpToRegexp, "regexpToRegexp");
function arrayToRegexp(paths, keys, options) {
  var parts = paths.map(function(path) {
    return pathToRegexp(path, keys, options).source;
  });
  return new RegExp("(?:".concat(parts.join("|"), ")"), flags(options));
}
__name(arrayToRegexp, "arrayToRegexp");
function stringToRegexp(path, keys, options) {
  return tokensToRegexp(parse(path, options), keys, options);
}
__name(stringToRegexp, "stringToRegexp");
function tokensToRegexp(tokens, keys, options) {
  if (options === void 0) {
    options = {};
  }
  var _a = options.strict, strict = _a === void 0 ? false : _a, _b = options.start, start = _b === void 0 ? true : _b, _c = options.end, end = _c === void 0 ? true : _c, _d = options.encode, encode = _d === void 0 ? function(x) {
    return x;
  } : _d, _e = options.delimiter, delimiter = _e === void 0 ? "/#?" : _e, _f = options.endsWith, endsWith = _f === void 0 ? "" : _f;
  var endsWithRe = "[".concat(escapeString(endsWith), "]|$");
  var delimiterRe = "[".concat(escapeString(delimiter), "]");
  var route = start ? "^" : "";
  for (var _i = 0, tokens_1 = tokens; _i < tokens_1.length; _i++) {
    var token = tokens_1[_i];
    if (typeof token === "string") {
      route += escapeString(encode(token));
    } else {
      var prefix = escapeString(encode(token.prefix));
      var suffix = escapeString(encode(token.suffix));
      if (token.pattern) {
        if (keys)
          keys.push(token);
        if (prefix || suffix) {
          if (token.modifier === "+" || token.modifier === "*") {
            var mod = token.modifier === "*" ? "?" : "";
            route += "(?:".concat(prefix, "((?:").concat(token.pattern, ")(?:").concat(suffix).concat(prefix, "(?:").concat(token.pattern, "))*)").concat(suffix, ")").concat(mod);
          } else {
            route += "(?:".concat(prefix, "(").concat(token.pattern, ")").concat(suffix, ")").concat(token.modifier);
          }
        } else {
          if (token.modifier === "+" || token.modifier === "*") {
            throw new TypeError('Can not repeat "'.concat(token.name, '" without a prefix and suffix'));
          }
          route += "(".concat(token.pattern, ")").concat(token.modifier);
        }
      } else {
        route += "(?:".concat(prefix).concat(suffix, ")").concat(token.modifier);
      }
    }
  }
  if (end) {
    if (!strict)
      route += "".concat(delimiterRe, "?");
    route += !options.endsWith ? "$" : "(?=".concat(endsWithRe, ")");
  } else {
    var endToken = tokens[tokens.length - 1];
    var isEndDelimited = typeof endToken === "string" ? delimiterRe.indexOf(endToken[endToken.length - 1]) > -1 : endToken === void 0;
    if (!strict) {
      route += "(?:".concat(delimiterRe, "(?=").concat(endsWithRe, "))?");
    }
    if (!isEndDelimited) {
      route += "(?=".concat(delimiterRe, "|").concat(endsWithRe, ")");
    }
  }
  return new RegExp(route, flags(options));
}
__name(tokensToRegexp, "tokensToRegexp");
function pathToRegexp(path, keys, options) {
  if (path instanceof RegExp)
    return regexpToRegexp(path, keys);
  if (Array.isArray(path))
    return arrayToRegexp(path, keys, options);
  return stringToRegexp(path, keys, options);
}
__name(pathToRegexp, "pathToRegexp");

// C:/Users/brody/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/pages-template-worker.ts
var escapeRegex = /[.+?^${}()|[\]\\]/g;
function* executeRequest(request) {
  const requestPath = new URL(request.url).pathname;
  for (const route of [...routes].reverse()) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult) {
      for (const handler of route.middlewares.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: mountMatchResult.path
        };
      }
    }
  }
  for (const route of routes) {
    if (route.method && route.method !== request.method) {
      continue;
    }
    const routeMatcher = match(route.routePath.replace(escapeRegex, "\\$&"), {
      end: true
    });
    const mountMatcher = match(route.mountPath.replace(escapeRegex, "\\$&"), {
      end: false
    });
    const matchResult = routeMatcher(requestPath);
    const mountMatchResult = mountMatcher(requestPath);
    if (matchResult && mountMatchResult && route.modules.length) {
      for (const handler of route.modules.flat()) {
        yield {
          handler,
          params: matchResult.params,
          path: matchResult.path
        };
      }
      break;
    }
  }
}
__name(executeRequest, "executeRequest");
var pages_template_worker_default = {
  async fetch(originalRequest, env, workerContext) {
    let request = originalRequest;
    const handlerIterator = executeRequest(request);
    let data = {};
    let isFailOpen = false;
    const next = /* @__PURE__ */ __name(async (input, init) => {
      if (input !== void 0) {
        let url = input;
        if (typeof input === "string") {
          url = new URL(input, request.url).toString();
        }
        request = new Request(url, init);
      }
      const result = handlerIterator.next();
      if (result.done === false) {
        const { handler, params, path } = result.value;
        const context = {
          request: new Request(request.clone()),
          functionPath: path,
          next,
          params,
          get data() {
            return data;
          },
          set data(value) {
            if (typeof value !== "object" || value === null) {
              throw new Error("context.data must be an object");
            }
            data = value;
          },
          env,
          waitUntil: workerContext.waitUntil.bind(workerContext),
          passThroughOnException: /* @__PURE__ */ __name(() => {
            isFailOpen = true;
          }, "passThroughOnException")
        };
        const response = await handler(context);
        if (!(response instanceof Response)) {
          throw new Error("Your Pages function should return a Response");
        }
        return cloneResponse(response);
      } else if ("ASSETS") {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      } else {
        const response = await fetch(request);
        return cloneResponse(response);
      }
    }, "next");
    try {
      return await next();
    } catch (error) {
      if (isFailOpen) {
        const response = await env["ASSETS"].fetch(request);
        return cloneResponse(response);
      }
      throw error;
    }
  }
};
var cloneResponse = /* @__PURE__ */ __name((response) => (
  // https://fetch.spec.whatwg.org/#null-body-status
  new Response(
    [101, 204, 205, 304].includes(response.status) ? null : response.body,
    response
  )
), "cloneResponse");

// C:/Users/brody/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// C:/Users/brody/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// ../.wrangler/tmp/bundle-krNb1b/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = pages_template_worker_default;

// C:/Users/brody/AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// ../.wrangler/tmp/bundle-krNb1b/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=functionsWorker-0.5005136249474365.mjs.map
