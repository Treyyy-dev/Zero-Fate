/**
 * Sends the startup self-test report (and the first runtime errors) to the
 * published page's private data store, so the developer can read exactly
 * which check failed on the player's real device. Does nothing outside the
 * claude.ai artifact viewer (e.g. when running with `npm run dev`).
 */
let dbPromise = null;
const errors = [];

function getDB() {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        if (!window.claude?.use) return null;
        return await window.claude.use('db');
      } catch {
        return null;
      }
    })();
  }
  return dbPromise;
}

export async function reportSelfTest(report, extra = {}) {
  const db = await getDB();
  if (!db || !report) return;
  try {
    await db.doc('diagnostics/selftest').set({
      at: new Date().toISOString(),
      passed: report.passed,
      total: report.total,
      results: report.results.map((r) => ({ name: r.name, pass: r.pass, detail: String(r.detail).slice(0, 300) })),
      userAgent: navigator.userAgent.slice(0, 200),
      ...extra,
    });
  } catch {
    /* viewer without write access — ignore */
  }
}

export function installErrorReporting() {
  const push = async (message) => {
    if (errors.length >= 8) return;
    errors.push({ at: new Date().toISOString(), message: String(message).slice(0, 500) });
    const db = await getDB();
    if (!db) return;
    try {
      await db.doc('diagnostics/errors').set({ errors });
    } catch {
      /* ignore */
    }
  };
  window.addEventListener('error', (e) => push(`${e.message} @ ${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => push(`unhandled: ${e.reason?.stack ?? e.reason}`));
}
