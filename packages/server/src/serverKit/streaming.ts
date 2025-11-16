interface AgentStreamLike {
  toDataStreamResponse?: () => Response;
  toReadableStream?: () => ReadableStream<Uint8Array>;
}

export function sendSseEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown,
) {
  const encoder = new TextEncoder();
  const formatted = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  controller.enqueue(encoder.encode(formatted));
}

export function hasDataStreamResponse(
  value: unknown,
): value is Required<Pick<AgentStreamLike, "toDataStreamResponse">> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AgentStreamLike).toDataStreamResponse === "function"
  );
}

export function hasReadableStream(
  value: unknown,
): value is Required<Pick<AgentStreamLike, "toReadableStream">> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as AgentStreamLike).toReadableStream === "function"
  );
}

