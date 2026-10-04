// Counting, for every page. Aggregate counts only: no anonymous id, no
// cookie, nothing that could identify a visitor. `/e` accepts exactly
// `{ "name": "<allowed event>" }` (contract.yaml's events.allowed) and bumps
// a same-day, same-name counter. Every POST is same-origin JSON: the Worker
// refuses anything else (worker/src/guard.ts), so never use sendBeacon,
// which sends text/plain.

export function sendEvent(name: string): void {
  fetch("/e", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    keepalive: true,
  }).catch(() => {
    // Best-effort telemetry: a failed send is not the user's problem.
  });
}
