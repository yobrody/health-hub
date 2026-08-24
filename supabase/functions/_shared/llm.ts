// _shared/llm.ts — Shared OpenRouter transport for Health Hub Edge Functions (Deno).
//
// Reads OPENROUTER_API_KEY and OPENROUTER_MODEL (default "google/gemini-2.5-flash")
// from Deno.env. Sends a chat/completions request to OpenRouter's OpenAI-compatible
// API and returns the first choice's message content as a plain string.
//
// Never throws to the caller — all network/upstream/parse failures are returned as
// {ok:false, status, error} so each function can map them to an honest HTTP status.

// deno-lint-ignore-file no-explicit-any

const OPENROUTER_BASE = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "google/gemini-2.5-flash";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  /** A plain string OR an OpenAI-style content array (for vision). */
  content: string | ContentPart[];
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
}

export type LLMResult =
  | { ok: true; content: string }
  | { ok: false; status: number; error: string };

/**
 * Returns true when OPENROUTER_API_KEY is present in the environment.
 * Call this first so the function can return its existing *_not_configured 503
 * without making a network request.
 */
export function hasKey(): boolean {
  return Boolean(Deno.env.get("OPENROUTER_API_KEY"));
}

/**
 * Calls OpenRouter's chat/completions endpoint and returns the first choice's
 * message content.  Never throws — all failures are {ok:false,...}.
 */
export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions = {},
): Promise<LLMResult> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    return { ok: false, status: 503, error: "missing_key" };
  }

  const model = Deno.env.get("OPENROUTER_MODEL") ?? DEFAULT_MODEL;

  const body: Record<string, any> = {
    model,
    messages,
    response_format: { type: "json_object" },
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_BASE, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://healthhub.app",
        "X-Title": "Health Hub",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, status: 502, error: `network_error: ${String(e)}` };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, error: `upstream_http_${res.status}` };
  }

  let payload: any;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, status: 502, error: "upstream_bad_json" };
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    return { ok: false, status: 502, error: "empty_response" };
  }

  return { ok: true, content: content.trim() };
}
