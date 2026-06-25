import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_COOKIE, tokenFor } from "@/lib/auth-token";

export const dynamic = "force-dynamic";

async function login(formData: FormData) {
  "use server";
  const pw = process.env.APP_PASSWORD;
  const input = String(formData.get("password") ?? "");
  const nextRaw = String(formData.get("next") ?? "/");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";

  if (!pw || input !== pw) {
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  const store = await cookies();
  store.set(AUTH_COOKIE, await tokenFor(pw), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  redirect(next);
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = sp.error === "1";

  return (
    <main className="login-main">
      <form className="login-card" action={login}>
        <div className="login-brand">
          scrap<span className="hl">yard</span>
        </div>
        <p className="login-sub">This dashboard is private. Enter the password to continue.</p>
        <input type="hidden" name="next" value={next} />
        <input
          type="password"
          name="password"
          placeholder="Password"
          autoComplete="current-password"
          aria-label="Password"
          autoFocus
        />
        {error && <p className="login-error">Incorrect password — try again.</p>}
        <button className="btn" type="submit">
          Enter
        </button>
      </form>
    </main>
  );
}
