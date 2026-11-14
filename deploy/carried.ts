/**
 * bun deploy/carried.ts <url of the full read> <json>     (run by the watcher, with READBACK_CARRY_KEY from the vault)
 * Tells the public copy what the watcher carried to GitHub and to Entire for one signature.
 */
const [url, body] = process.argv.slice(2);
const key = process.env.READBACK_CARRY_KEY;
if (!url || !body || !key) {
  console.error('usage: READBACK_CARRY_KEY=… bun deploy/carried.ts <url> <json>');
  process.exit(2);
}
const r = await fetch(`${url}/api/carried`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'readback-watch' }, body: JSON.stringify({ ...JSON.parse(body), key }), signal: AbortSignal.timeout(15_000) });
if (!r.ok) {
  console.error(`the public copy answered ${r.status}`);
  process.exit(1);
}
