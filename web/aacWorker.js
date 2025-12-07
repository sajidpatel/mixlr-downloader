let position = 0;
let streamUrl = '';
let polling = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

self.onmessage = (event) => {
  const { type, url } = event.data || {};
  if (type === 'start' && url) {
    streamUrl = url;
    polling = true;
    poll();
  }
  if (type === 'stop') {
    polling = false;
    try {
      self.close();
    } catch {}
  }
};

async function poll() {
  while (polling) {
    try {
      const res = await fetch(streamUrl, {
        headers: { Range: `bytes=${position}-` },
        cache: 'no-store',
      });

      if (res.status === 206 || res.status === 200) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 0) {
          position += buf.byteLength;
          postMessage({ type: 'chunk', data: buf }, [buf]);
        }
      }
    } catch (e) {
      postMessage({ type: 'error', message: e.message || String(e) });
      // brief backoff on error
      await sleep(600);
    }

    await sleep(300);
  }
}
