// AI protocol adapters. The system talks to any provider that implements the
// OpenAI-compatible chat completions contract, so switching providers only
// requires changing base_url, model and the encrypted API key.
// Transport and persistence stay in routes/ai-integrations.js.

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export const firstString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

const normalizeBaseUrl = (raw) => {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("base_url is required");
  const url = new URL(raw.trim());
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("base_url must use HTTPS without credentials or a fragment");
  }
  return url.toString().replace(/\/+$/, "");
};

/** Builds a chat completion request for an OpenAI-compatible provider. */
export const buildAiChatRequest = ({ baseUrl, model, messages, temperature, maxTokens }) => {
  const url = normalizeBaseUrl(baseUrl);
  const normalizedModel = firstString(model);
  if (!normalizedModel || normalizedModel.length > 190) {
    throw new Error("model must contain 1 to 190 characters");
  }
  if (!Array.isArray(messages) || !messages.length || messages.length > 100) {
    throw new Error("messages must contain between 1 and 100 entries");
  }
  const normalizedMessages = messages.map((message) => {
    if (!isObject(message)) throw new Error("Each message must be an object");
    const role = firstString(message.role);
    const content = typeof message.content === "string" ? message.content : "";
    if (!["system", "user", "assistant"].includes(role)) throw new Error("Invalid message role");
    if (!content || Buffer.byteLength(content, "utf8") > MAX_REQUEST_BYTES) {
      throw new Error("Message content must contain up to 256 KB of text");
    }
    return { role, content };
  });
  const body = { model: normalizedModel, messages: normalizedMessages };
  if (Number.isFinite(Number(temperature))) body.temperature = Number(temperature);
  if (Number.isFinite(Number(maxTokens)) && Number(maxTokens) > 0) body.max_tokens = Number(maxTokens);
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
    throw new Error("AI request exceeds the 256 KB limit");
  }
  return { url: `${url}/chat/completions`, body: serialized };
};

/** Extracts the assistant text and usage from an OpenAI-compatible response. */
export const normalizeAiChatResponse = (body, httpStatus) => {
  if (!isObject(body)) throw new Error("AI response must be an object");
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("AI response exceeds the 1 MB limit");
  }
  const choices = Array.isArray(body.choices) ? body.choices : [];
  const text = firstString(choices[0]?.message?.content, choices[0]?.text);
  if (!text) {
    const apiError = firstString(body.error?.message, body.message);
    throw new Error(apiError ? `AI provider returned an error: ${apiError.slice(0, 200)}` : `AI provider returned no text (HTTP ${httpStatus})`);
  }
  const usage = isObject(body.usage) ? body.usage : {};
  return {
    text,
    usage: {
      promptTokens: Number(usage.prompt_tokens) || 0,
      completionTokens: Number(usage.completion_tokens) || 0,
      totalTokens: Number(usage.total_tokens) || 0,
    },
    model: firstString(body.model),
    raw: body,
  };
};

/** Normalizes the model listing response used by the connection test. */
export const normalizeAiModelsResponse = (body) => {
  if (!isObject(body)) throw new Error("AI models response must be an object");
  const models = Array.isArray(body.data) ? body.data : [];
  return models
    .map((item) => firstString(item?.id, item?.name))
    .filter(Boolean)
    .slice(0, 200);
};
