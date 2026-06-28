"use client";

import { useActionState } from "react";

import { triggerScrape, type TriggerResult } from "./trigger-action";

const INITIAL: TriggerResult = { ok: false, message: "" };

export default function TriggerScrape() {
  const [state, formAction, pending] = useActionState(triggerScrape, INITIAL);

  return (
    <form action={formAction} className="row" style={{ flexWrap: "wrap", gap: 10, alignItems: "center" }}>
      <input
        type="password"
        name="secret"
        placeholder="Admin secret"
        aria-label="Admin secret"
        autoComplete="off"
        style={{ maxWidth: 220 }}
      />
      <button className="btn" type="submit" disabled={pending}>
        {pending ? "Triggering…" : "Run scrape now"}
      </button>
      {state.message && (
        <span
          style={{
            fontSize: 13,
            color: state.ok ? "var(--ok, #2e7d32)" : "var(--bad, #c0392b)",
            flexBasis: "100%",
          }}
        >
          {state.message}
        </span>
      )}
    </form>
  );
}
