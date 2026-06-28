"use server";

// Server action that triggers the GitHub Actions scraper via the REST API.
// Security model (the site is already behind the APP_PASSWORD login):
//   1. Second gate — caller must supply SCRAPE_TRIGGER_SECRET, so even a
//      logged-in viewer can't start a scrape; only someone who knows the secret.
//   2. Double-run guard — refuses if a run is already queued/in-progress, so a
//      double-click can't kick off a second full-catalog crawl (ban-aversion).
// The GitHub token (GH_DISPATCH_TOKEN, a fine-grained PAT with Actions:write)
// lives only in server env — it never reaches the browser.

const OWNER = "ricardozacarias";
const REPO = "scrapyard";
const WORKFLOW = "scrape.yml";
const REF = "main";

export type TriggerResult = { ok: boolean; message: string };

/** Length-checked constant-time string compare (avoids leaking the secret via timing). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function triggerScrape(
  _prev: TriggerResult,
  formData: FormData,
): Promise<TriggerResult> {
  const secret = process.env.SCRAPE_TRIGGER_SECRET;
  const token = process.env.GH_DISPATCH_TOKEN;
  const input = String(formData.get("secret") ?? "");

  if (!secret || !token) {
    return {
      ok: false,
      message: "Trigger isn't configured — set SCRAPE_TRIGGER_SECRET and GH_DISPATCH_TOKEN in Vercel.",
    };
  }
  if (!input || !constantTimeEqual(input, secret)) {
    return { ok: false, message: "Wrong admin secret." };
  }

  const gh = (path: string, init?: RequestInit) =>
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

  // Double-run guard: don't start a second crawl if one is already active.
  try {
    const res = await gh(`actions/workflows/${WORKFLOW}/runs?per_page=10`);
    if (res.ok) {
      const data = (await res.json()) as { workflow_runs?: { status?: string }[] };
      const active = (data.workflow_runs ?? []).some(
        (r) => r.status === "queued" || r.status === "in_progress",
      );
      if (active) {
        return { ok: false, message: "A scrape is already running or queued — not starting another." };
      }
    }
  } catch {
    // If the pre-check fails we still attempt the dispatch; the workflow's own
    // `concurrency` group prevents truly simultaneous runs as a backstop.
  }

  const dispatch = await gh(`actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    body: JSON.stringify({ ref: REF }),
  });

  if (dispatch.status === 204) {
    return {
      ok: true,
      message: "Scrape triggered — it'll show up in the runs list shortly (GitHub can take a minute).",
    };
  }
  const detail = await dispatch.text().catch(() => "");
  return {
    ok: false,
    message: `GitHub rejected the trigger (HTTP ${dispatch.status}). ${detail.slice(0, 140)}`,
  };
}
