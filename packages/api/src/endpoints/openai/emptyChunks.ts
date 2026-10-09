export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const EVENT_BOUNDARY = /\r?\n\r?\n/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEmptyChoice(choice: unknown): boolean {
  if (!isRecord(choice) || choice.finish_reason != null || choice.logprobs != null) {
    return false;
  }
  return isRecord(choice.delta) && Object.keys(choice.delta).length === 0;
}

/**
 * A chat completion chunk whose choices carry an empty delta and no finish reason holds no
 * content. Some gateways send them as keepalives before the upstream answers, and LangChain
 * turns a role-less first delta into a ChatMessageChunk, which drops every streamed tool call.
 */
export function isEmptyCompletionChunk(event: string): boolean {
  const data = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (data === '' || data === '[DONE]') {
    return false;
  }
  let chunk: unknown;
  try {
    chunk = JSON.parse(data);
  } catch {
    return false;
  }
  if (!isRecord(chunk) || chunk.usage != null || !Array.isArray(chunk.choices)) {
    return false;
  }
  return chunk.choices.length > 0 && chunk.choices.every(isEmptyChoice);
}

function dropEmptyChunks(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(bytes, controller) {
        buffer += decoder.decode(bytes, { stream: true });
        let boundary = EVENT_BOUNDARY.exec(buffer);
        while (boundary !== null) {
          const end = boundary.index + boundary[0].length;
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end);
          if (!isEmptyCompletionChunk(event)) {
            controller.enqueue(encoder.encode(event));
          }
          boundary = EVENT_BOUNDARY.exec(buffer);
        }
      },
      flush(controller) {
        buffer += decoder.decode();
        if (buffer !== '' && !isEmptyCompletionChunk(buffer)) {
          controller.enqueue(encoder.encode(buffer));
        }
      },
    }),
  );
}

export function withoutEmptyStreamChunks(fetchImpl?: Fetch): Fetch {
  return async (input, init) => {
    const response = await (fetchImpl ?? globalThis.fetch)(input, init);
    const contentType = response.headers.get('content-type') ?? '';
    const body = response.body as ReadableStream<Uint8Array> | null;
    if (!contentType.includes('text/event-stream') || typeof body?.pipeThrough !== 'function') {
      return response;
    }
    const filtered = new Response(dropEmptyChunks(body), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    Object.defineProperty(filtered, 'url', { value: response.url });
    return filtered;
  };
}
