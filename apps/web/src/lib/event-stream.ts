export async function* readEventStream(response: Response): AsyncGenerator<{ event: string; data: string }> {
  if (!response.body) throw new Error('Event stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let event = 'message';
  let data: string[] = [];
  try {
    let done = false;
    while (!done) {
      const next = await reader.read();
      done = next.done;
      pending += decoder.decode(next.value ?? new Uint8Array(), { stream: !done });
      for (;;) {
        const index = pending.search(/[\r\n]/);
        if (index < 0) break;
        const line = pending.slice(0, index);
        pending = pending.slice(index + (pending.slice(index, index + 2) === '\r\n' ? 2 : 1));
        if (!line) {
          if (data.length) yield { event, data: data.join('\n') };
          event = 'message';
          data = [];
        } else if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
