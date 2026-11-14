/**
 * POST over IPv4 only, answering like fetch.
 *
 * The model API refuses some IPv6 addresses with 400 "User location is not supported for the API use" (seen on Fly:
 * the same key and request pass over IPv4). fetch picks the address family by itself and keeps the connection, so a
 * server process could be stuck on the refused one for its whole life.
 */
import { request } from 'node:https';

export function post4(url: string, init: { headers: Record<string, string>; body: string; signal?: AbortSignal }): Promise<Response> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ host: u.hostname, path: u.pathname + u.search, method: 'POST', family: 4, headers: { ...init.headers, 'content-length': Buffer.byteLength(init.body) } }, (res) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          res.on('data', (d: Buffer) => c.enqueue(new Uint8Array(d)));
          res.on('end', () => c.close());
          res.on('error', (e) => c.error(e));
        },
        cancel() {
          res.destroy();
        },
      });
      resolve(new Response(body, { status: res.statusCode ?? 502 }));
    });
    req.on('error', reject);
    init.signal?.addEventListener('abort', () => req.destroy(new Error('The model did not answer in time.')), { once: true });
    req.end(init.body);
  });
}
