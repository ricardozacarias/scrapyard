import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { AUTH_COOKIE, tokenFor } from "@/lib/auth-token";

// Password gate. When APP_PASSWORD is set, every page (except /login + static
// assets) requires a valid auth cookie; otherwise visitors are redirected to
// /login. When APP_PASSWORD is unset, the gate is off and the site stays public.
export async function middleware(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === "/login") return NextResponse.next();

  const cookie = req.cookies.get(AUTH_COOKIE)?.value;
  if (cookie && cookie === (await tokenFor(pw))) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

// Run on everything except Next internals and files with an extension (static
// assets like /geo/*.geojson and /brands/*.png stay publicly served).
export const config = {
  matcher: ["/((?!_next/|.*\\..*).*)"],
};
