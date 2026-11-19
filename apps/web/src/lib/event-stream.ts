/** Parse SSE framing independently from the JSON/base64 event payload contract. */
export async function* readEventStream(response: Response): AsyncGenerator<{ event: string; data: string }> {
  if (!response.body) throw new Error('Event stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event = 'message';
  let data: string[] = [];
  let eof = false;
  let eventSize = 0;
  try {
    while (!eof) {
      const next = await reader.read();
      eof = next.done;
      pending += decoder.decode(next.value ?? new Uint8Array(), { stream: !eof });
      for (;;) {
        const index = pending.search(/[\r\n]/);
        if (index < 0 || (!eof && index === pending.length - 1 && pending[index] === '\r')) break;
        const line = pending.slice(0, index);
        pending = pending.slice(index + (pending.slice(index, index + 2) === '\r\n' ? 2 : 1));
        if (!line) {
          if (data.length) yield { event, data: data.join('\n') };
          event = 'message';
          data = [];
          eventSize = 0;
        } else if (!line.startsWith(':')) {
          eventSize += line.length;
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'event') event = value || 'message';
          if (field === 'data') data.push(value);
        }
        if (eventSize > 1_048_576) throw new Error('Event stream frame is too large');
      }
      if (pending.length + eventSize > 1_048_576) throw new Error('Event stream frame is too large');
    }
    // SSE dispatches only complete, blank-line terminated events. A partial frame
    // at EOF is a failure; it must never masquerade as a committed result.
    if (pending.trim() || data.length) throw new Error('Event stream ended mid-frame');
  } finally {
    try {
      if (!eof) await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
