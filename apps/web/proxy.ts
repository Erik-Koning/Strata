// Before every page: anyone without a session cookie goes to sign in. The cookie is only a hint here; every page and
// server action checks the session itself (server/viewer.ts). The API takes bearer tokens and checks them itself.
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// /v1 is the plugin's API (rewritten to /api/v1 in next.config.ts): bearer tokens, never a cookie.
const OPEN = [/^\/sign-in$/, /^\/sign-up$/, /^\/api\//, /^\/v1\//];

export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (OPEN.some((path) => path.test(pathname))) return NextResponse.next();
  if (!getSessionCookie(request, { cookiePrefix: "strata" })) {
    const to = new URL("/sign-in", request.url);
    if (pathname !== "/") to.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(to);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
