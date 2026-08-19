export interface AnthropicRequestConversion {
  payload: Record<string, unknown>;
  hasImage: boolean;
  thinkingEnabled: boolean | null;
  thinkingBudget: number | null;
}

export interface AnthropicConversionError {
  code: string;
  message: string;
}

type RequestConversionResult =
  | AnthropicRequestConversion
  | AnthropicConversionError;

interface ConvertedMessages {
  messages: Array<Record<string, unknown>>;
  hasImage: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isConversionError(
  value: unknown,
): value is AnthropicConversionError {
  return isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.message === "string";
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => isRecord(item) && typeof item.text === "string"
      ? item.text
      : "")
    .join("");
}

function systemText(system: unknown): string | AnthropicConversionError | null {
  if (system === undefined) return null;
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) {
    return {
      code: "invalid_request_error",
      message: "system 必须是字符串或文本内容块数组。",
    };
  }
  const parts: string[] = [];
  for (const block of system) {
    if (
      !isRecord(block) ||
      block.type !== "text" ||
      typeof block.text !== "string"
    ) {
      return {
        code: "invalid_request_error",
        message: "system 内容块仅支持 type=text。",
      };
    }
    parts.push(block.text);
  }
  return parts.join("\n");
}

function imagePart(
  block: Record<string, unknown>,
): Record<string, unknown> | AnthropicConversionError {
  if (!isRecord(block.source)) {
    return {
      code: "invalid_request_error",
      message: "image 内容块必须包含 source。",
    };
  }
  const source = block.source;
  if (
    source.type === "base64" &&
    typeof source.media_type === "string" &&
    typeof source.data === "string"
  ) {
    return {
      type: "image_url",
      image_url: {
        url: "data:" + source.media_type + ";base64," + source.data,
      },
    };
  }
  if (source.type === "url" && typeof source.url === "string") {
    return {
      type: "image_url",
      image_url: { url: source.url },
    };
  }
  return {
    code: "invalid_request_error",
    message: "image.source 仅支持 base64 或 url。",
  };
}

function convertMessages(
  sourceMessages: unknown,
): ConvertedMessages | AnthropicConversionError {
  if (!Array.isArray(sourceMessages) || sourceMessages.length === 0) {
    return {
      code: "invalid_request_error",
      message: "messages 必须是非空数组。",
    };
  }

  const messages: Array<Record<string, unknown>> = [];
  let hasImage = false;
  for (const item of sourceMessages) {
    if (
      !isRecord(item) ||
      (item.role !== "user" && item.role !== "assistant")
    ) {
      return {
        code: "invalid_request_error",
        message: "messages[].role 只能是 user 或 assistant。",
      };
    }
    if (typeof item.content === "string") {
      messages.push({ role: item.role, content: item.content });
      continue;
    }
    if (!Array.isArray(item.content)) {
      return {
        code: "invalid_request_error",
        message: "messages[].content 必须是字符串或内容块数组。",
      };
    }

    if (item.role === "assistant") {
      const content: Array<Record<string, unknown>> = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      for (const block of item.content) {
        if (!isRecord(block)) {
          return {
            code: "invalid_request_error",
            message: "assistant 内容块必须是对象。",
          };
        }
        if (block.type === "text" && typeof block.text === "string") {
          content.push({ type: "text", text: block.text });
          continue;
        }
        if (
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
        ) {
          toolCalls.push({
            id: block.id,
            type: "function",
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
          continue;
        }
        return {
          code: "invalid_request_error",
          message: "assistant 内容块仅支持 text 或 tool_use。",
        };
      }
      messages.push({
        role: "assistant",
        content: content.length > 0 ? content : null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    let pending: Array<Record<string, unknown>> = [];
    const flushUserContent = () => {
      if (pending.length === 0) return;
      messages.push({ role: "user", content: pending });
      pending = [];
    };
    for (const block of item.content) {
      if (!isRecord(block)) {
        return {
          code: "invalid_request_error",
          message: "user 内容块必须是对象。",
        };
      }
      if (block.type === "text" && typeof block.text === "string") {
        pending.push({ type: "text", text: block.text });
        continue;
      }
      if (block.type === "image") {
        const converted = imagePart(block);
        if (isConversionError(converted)) return converted;
        pending.push(converted);
        hasImage = true;
        continue;
      }
      if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string"
      ) {
        flushUserContent();
        messages.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: textFromContent(block.content),
        });
        continue;
      }
      return {
        code: "invalid_request_error",
        message: "user 内容块仅支持 text、image 或 tool_result。",
      };
    }
    flushUserContent();
  }
  return { messages, hasImage };
}

function convertTools(
  tools: unknown,
): Array<Record<string, unknown>> | AnthropicConversionError | null {
  if (tools === undefined) return null;
  if (!Array.isArray(tools)) {
    return { code: "invalid_request_error", message: "tools 必须是数组。" };
  }
  const converted: Array<Record<string, unknown>> = [];
  for (const tool of tools) {
    if (
      !isRecord(tool) ||
      typeof tool.name !== "string" ||
      !isRecord(tool.input_schema)
    ) {
      return {
        code: "invalid_request_error",
        message: "tools[] 必须包含 name 和 input_schema。",
      };
    }
    converted.push({
      type: "function",
      function: {
        name: tool.name,
        ...(typeof tool.description === "string"
          ? { description: tool.description }
          : {}),
        parameters: tool.input_schema,
      },
    });
  }
  return converted;
}

function convertToolChoice(
  toolChoice: unknown,
): unknown | AnthropicConversionError {
  if (toolChoice === undefined) return undefined;
  if (!isRecord(toolChoice) || typeof toolChoice.type !== "string") {
    return {
      code: "invalid_request_error",
      message: "tool_choice 必须是包含 type 的对象。",
    };
  }
  if (toolChoice.type === "auto") return "auto";
  if (toolChoice.type === "any") return "required";
  if (toolChoice.type === "none") return "none";
  if (toolChoice.type === "tool" && typeof toolChoice.name === "string") {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }
  return {
    code: "invalid_request_error",
    message: "不支持当前 tool_choice。",
  };
}

export function convertAnthropicRequest(
  body: Record<string, unknown>,
): RequestConversionResult {
  if (typeof body.model !== "string" || !body.model.trim()) {
    return { code: "invalid_request_error", message: "model 不能为空。" };
  }
  if (
    !Number.isSafeInteger(body.max_tokens) ||
    Number(body.max_tokens) < 0
  ) {
    return {
      code: "invalid_request_error",
      message: "max_tokens 必须是非负整数。",
    };
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    return {
      code: "invalid_request_error",
      message: "stream 必须是布尔值。",
    };
  }

  const convertedMessages = convertMessages(body.messages);
  if (isConversionError(convertedMessages)) return convertedMessages;
  const convertedSystem = systemText(body.system);
  if (isConversionError(convertedSystem)) return convertedSystem;
  const tools = convertTools(body.tools);
  if (isConversionError(tools)) return tools;
  const toolChoice = convertToolChoice(body.tool_choice);
  if (isConversionError(toolChoice)) return toolChoice;

  const messages = [...convertedMessages.messages];
  if (convertedSystem) {
    messages.unshift({ role: "system", content: convertedSystem });
  }
  const payload: Record<string, unknown> = {
    model: body.model,
    messages,
    max_tokens: body.max_tokens,
    stream: body.stream === true,
  };
  if (body.temperature !== undefined) payload.temperature = body.temperature;
  if (body.top_p !== undefined) payload.top_p = body.top_p;
  if (body.stop_sequences !== undefined) {
    if (
      !Array.isArray(body.stop_sequences) ||
      !body.stop_sequences.every((item) => typeof item === "string")
    ) {
      return {
        code: "invalid_request_error",
        message: "stop_sequences 必须是字符串数组。",
      };
    }
    payload.stop = body.stop_sequences;
  }
  if (tools) payload.tools = tools;
  if (toolChoice !== undefined) payload.tool_choice = toolChoice;
  if (body.stream === true) {
    payload.stream_options = { include_usage: true };
  }

  let thinkingEnabled: boolean | null = null;
  let thinkingBudget: number | null = null;
  if (body.thinking !== undefined) {
    if (!isRecord(body.thinking)) {
      return {
        code: "invalid_request_error",
        message: "thinking 必须是对象。",
      };
    }
    if (body.thinking.type === "enabled") {
      thinkingEnabled = true;
      if (
        !Number.isSafeInteger(body.thinking.budget_tokens) ||
        Number(body.thinking.budget_tokens) <= 0
      ) {
        return {
          code: "invalid_request_error",
          message: "thinking.budget_tokens 必须是正整数。",
        };
      }
      thinkingBudget = Number(body.thinking.budget_tokens);
    } else if (body.thinking.type === "disabled") {
      thinkingEnabled = false;
    } else {
      return {
        code: "invalid_request_error",
        message: "thinking.type 仅支持 enabled 或 disabled。",
      };
    }
  }

  return {
    payload,
    hasImage: convertedMessages.hasImage,
    thinkingEnabled,
    thinkingBudget,
  };
}

function responseHeaders(response: Response, streaming: boolean): Headers {
  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set(
    "Content-Type",
    streaming
      ? "text/event-stream; charset=utf-8"
      : "application/json; charset=utf-8",
  );
  headers.set("Cache-Control", "no-store");
  if (streaming) headers.set("X-Accel-Buffering", "no");
  const requestId = response.headers.get("X-ModelMux-Request-Id");
  if (requestId) headers.set("request-id", requestId);
  return headers;
}

function requestId(response: Response): string {
  return response.headers.get("X-ModelMux-Request-Id") ?? "";
}

function messageId(response: Response): string {
  const id = requestId(response).replaceAll("-", "");
  return "msg_" + (id || "unknown");
}

function stopReason(value: unknown): string | null {
  if (value === "stop") return "end_turn";
  if (value === "length") return "max_tokens";
  if (value === "tool_calls") return "tool_use";
  if (value === "content_filter") return "refusal";
  return null;
}

function usage(value: unknown): { input_tokens: number; output_tokens: number } {
  const source = isRecord(value) ? value : {};
  return {
    input_tokens: Number(source.prompt_tokens ?? source.input_tokens ?? 0),
    output_tokens: Number(
      source.completion_tokens ?? source.output_tokens ?? 0,
    ),
  };
}

function errorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "not_found_error";
  if (status === 413) return "request_too_large";
  if (status === 429) return "rate_limit_error";
  if (status >= 500) return "api_error";
  return "invalid_request_error";
}

async function convertError(response: Response): Promise<Response> {
  let source: unknown;
  try {
    source = await response.json();
  } catch {
    source = null;
  }
  const record = isRecord(source) ? source : {};
  const sourceError = isRecord(record.error) ? record.error : record;
  const message = typeof sourceError.message === "string"
    ? sourceError.message
    : "模型服务请求失败。";
  return new Response(
    JSON.stringify({
      type: "error",
      error: { type: errorType(response.status), message },
      request_id: requestId(response),
    }),
    { status: response.status, headers: responseHeaders(response, false) },
  );
}

function contentBlocks(message: unknown): Array<Record<string, unknown>> {
  const source = isRecord(message) ? message : {};
  const blocks: Array<Record<string, unknown>> = [];
  const text = textFromContent(source.content);
  if (text) blocks.push({ type: "text", text });
  if (Array.isArray(source.tool_calls)) {
    for (const item of source.tool_calls) {
      if (!isRecord(item) || !isRecord(item.function)) continue;
      let input: unknown = {};
      try {
        input = JSON.parse(String(item.function.arguments ?? "{}"));
      } catch {
        input = {};
      }
      blocks.push({
        type: "tool_use",
        id: typeof item.id === "string" ? item.id : "toolu_unknown",
        name: String(item.function.name ?? ""),
        input,
      });
    }
  }
  return blocks;
}

async function convertJson(
  response: Response,
  model: string,
): Promise<Response> {
  let source: unknown;
  try {
    source = await response.json();
  } catch {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "api_error",
          message: "上游模型返回了无法解析的响应。",
        },
        request_id: requestId(response),
      }),
      { status: 502, headers: responseHeaders(response, false) },
    );
  }
  const record = isRecord(source) ? source : {};
  const firstChoice = Array.isArray(record.choices) && isRecord(record.choices[0])
    ? record.choices[0]
    : {};
  return new Response(
    JSON.stringify({
      id: messageId(response),
      type: "message",
      role: "assistant",
      model,
      content: contentBlocks(firstChoice.message),
      stop_reason: stopReason(firstChoice.finish_reason),
      stop_sequence: null,
      usage: usage(record.usage),
    }),
    { status: response.status, headers: responseHeaders(response, false) },
  );
}

function event(name: string, data: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(
    "event: " + name + "\ndata: " + JSON.stringify(data) + "\n\n",
  );
}

function convertStream(response: Response, model: string): Response {
  if (!response.body) {
    return new Response(null, {
      status: response.status,
      headers: responseHeaders(response, true),
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const toolBlocks = new Map<number, {
    blockIndex: number;
    id: string;
    name: string;
  }>();
  let buffer = "";
  let nextBlockIndex = 0;
  let textBlockIndex: number | null = null;
  let finalReason: string | null = null;
  let finalUsage = { input_tokens: 0, output_tokens: 0 };
  let finalized = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(event("message_start", {
        type: "message_start",
        message: {
          id: messageId(response),
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        },
      }));

      const finalize = () => {
        if (finalized) return;
        finalized = true;
        if (textBlockIndex !== null) {
          controller.enqueue(event("content_block_stop", {
            type: "content_block_stop",
            index: textBlockIndex,
          }));
        }
        for (const tool of [...toolBlocks.values()].sort(
          (left, right) => left.blockIndex - right.blockIndex,
        )) {
          controller.enqueue(event("content_block_stop", {
            type: "content_block_stop",
            index: tool.blockIndex,
          }));
        }
        controller.enqueue(event("message_delta", {
          type: "message_delta",
          delta: {
            stop_reason: finalReason ??
              (toolBlocks.size > 0 ? "tool_use" : "end_turn"),
            stop_sequence: null,
          },
          usage: finalUsage,
        }));
        controller.enqueue(event("message_stop", { type: "message_stop" }));
      };

      const emitBlock = (block: string) => {
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) return;
        if (data === "[DONE]") {
          finalize();
          return;
        }

        let chunk: unknown;
        try {
          chunk = JSON.parse(data);
        } catch {
          return;
        }
        if (!isRecord(chunk)) return;
        if (chunk.usage !== undefined) finalUsage = usage(chunk.usage);
        const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
        for (const choice of choices) {
          if (!isRecord(choice)) continue;
          if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
            finalReason = stopReason(choice.finish_reason);
          }
          const delta = isRecord(choice.delta) ? choice.delta : {};
          if (typeof delta.content === "string" && delta.content) {
            if (textBlockIndex === null) {
              textBlockIndex = nextBlockIndex;
              nextBlockIndex += 1;
              controller.enqueue(event("content_block_start", {
                type: "content_block_start",
                index: textBlockIndex,
                content_block: { type: "text", text: "" },
              }));
            }
            controller.enqueue(event("content_block_delta", {
              type: "content_block_delta",
              index: textBlockIndex,
              delta: { type: "text_delta", text: delta.content },
            }));
          }
          if (!Array.isArray(delta.tool_calls)) continue;
          for (const item of delta.tool_calls) {
            if (!isRecord(item)) continue;
            const sourceIndex = Number(item.index ?? 0);
            let tool = toolBlocks.get(sourceIndex);
            const fn = isRecord(item.function) ? item.function : {};
            if (!tool) {
              tool = {
                blockIndex: nextBlockIndex,
                id: typeof item.id === "string" ? item.id : "toolu_unknown",
                name: typeof fn.name === "string" ? fn.name : "",
              };
              nextBlockIndex += 1;
              toolBlocks.set(sourceIndex, tool);
              controller.enqueue(event("content_block_start", {
                type: "content_block_start",
                index: tool.blockIndex,
                content_block: {
                  type: "tool_use",
                  id: tool.id,
                  name: tool.name,
                  input: {},
                },
              }));
            }
            if (typeof fn.arguments === "string" && fn.arguments) {
              controller.enqueue(event("content_block_delta", {
                type: "content_block_delta",
                index: tool.blockIndex,
                delta: {
                  type: "input_json_delta",
                  partial_json: fn.arguments,
                },
              }));
            }
          }
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          buffer += decoder.decode(value, { stream: !done });
          buffer = buffer.replaceAll("\r\n", "\n");
          let boundary = buffer.indexOf("\n\n");
          while (boundary >= 0) {
            emitBlock(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
            boundary = buffer.indexOf("\n\n");
          }
          if (done) break;
        }
        if (buffer.trim()) emitBlock(buffer.trim());
        finalize();
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: response.status,
    headers: responseHeaders(response, true),
  });
}

export async function convertOpenAIResponseToAnthropic(
  response: Response,
  model: string,
): Promise<Response> {
  if (!response.ok) return convertError(response);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return convertStream(response, model);
  }
  return convertJson(response, model);
}
