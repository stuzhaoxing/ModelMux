export interface GatewayTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

const MAX_JSON_CAPTURE_CHARS = 256 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeTokenCount(value: unknown): number | null {
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) return null;
  return count;
}

export function tokenUsageFromPayload(payload: unknown): GatewayTokenUsage | null {
  if (!isRecord(payload) || !isRecord(payload.usage)) return null;
  const usage = payload.usage;
  const inputTokens = safeTokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = safeTokenCount(usage.completion_tokens ?? usage.output_tokens);
  const reportedTotal = safeTokenCount(usage.total_tokens);
  if (inputTokens === null && outputTokens === null && reportedTotal === null) return null;
  const safeInput = inputTokens ?? 0;
  const safeOutput = outputTokens ?? 0;
  return {
    inputTokens: safeInput,
    outputTokens: safeOutput,
    totalTokens: reportedTotal ?? safeInput + safeOutput,
  };
}

function tokenCountFromText(source: string, names: string[]): number | null {
  for (const name of names) {
    const match = source.match(new RegExp(`"${name}"\\s*:\\s*(\\d+)`));
    if (!match) continue;
    const value = safeTokenCount(match[1]);
    if (value !== null) return value;
  }
  return null;
}

function tokenUsageFromJsonText(source: string): GatewayTokenUsage | null {
  try {
    return tokenUsageFromPayload(JSON.parse(source));
  } catch {
    const usageIndex = source.lastIndexOf('"usage"');
    if (usageIndex < 0) return null;
    const usageSource = source.slice(usageIndex);
    const inputTokens = tokenCountFromText(usageSource, ["prompt_tokens", "input_tokens"]);
    const outputTokens = tokenCountFromText(usageSource, ["completion_tokens", "output_tokens"]);
    const totalTokens = tokenCountFromText(usageSource, ["total_tokens"]);
    if (inputTokens === null && outputTokens === null && totalTokens === null) return null;
    const safeInput = inputTokens ?? 0;
    const safeOutput = outputTokens ?? 0;
    return {
      inputTokens: safeInput,
      outputTokens: safeOutput,
      totalTokens: totalTokens ?? safeInput + safeOutput,
    };
  }
}

class TokenUsageCollector {
  private readonly decoder = new TextDecoder();
  private readonly eventStream: boolean;
  private buffer = "";
  private capturedJson = "";
  private latestUsage: GatewayTokenUsage | null = null;

  constructor(eventStream: boolean) {
    this.eventStream = eventStream;
  }

  push(chunk: Uint8Array): void {
    this.consume(this.decoder.decode(chunk, { stream: true }));
  }

  finish(): GatewayTokenUsage | null {
    this.consume(this.decoder.decode());
    if (this.eventStream) this.consumeEventLine(this.buffer);
    return this.latestUsage ?? tokenUsageFromJsonText(this.capturedJson);
  }

  private consume(text: string): void {
    if (!text) return;
    this.capturedJson = `${this.capturedJson}${text}`.slice(-MAX_JSON_CAPTURE_CHARS);
    if (!this.eventStream) return;
    this.buffer += text;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) this.consumeEventLine(line);
  }

  private consumeEventLine(line: string): void {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trimStart();
    if (!data || data === "[DONE]") return;
    try {
      this.latestUsage = tokenUsageFromPayload(JSON.parse(data)) ?? this.latestUsage;
    } catch {
      // Invalid provider events stay transparent to the client and are not metered.
    }
  }
}

export function meterTokenUsage(
  body: ReadableStream<Uint8Array>,
  eventStream: boolean,
  onUsage: (usage: GatewayTokenUsage) => Promise<void>,
): ReadableStream<Uint8Array> {
  const collector = new TokenUsageCollector(eventStream);
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      collector.push(chunk);
      controller.enqueue(chunk);
    },
    flush() {
      const usage = collector.finish();
      if (!usage) return;
      void onUsage(usage).catch((error) => {
        console.error("[competition] Token 用量写入失败", error);
      });
    },
  }));
}
