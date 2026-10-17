import { NextResponse, type NextRequest } from "next/server";

// Optional demo gate: when DEMO_PASSWORD is set (Cloud Run), require HTTP basic auth so a public URL
// cannot be used to run up Gemini costs. Any username works; only the password is checked.
export function proxy(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD;
  if (!password) return NextResponse.next();
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Territory Performance Copilot demo"' },
  });
}

export const config = { matcher: ["/((?!_next/static|favicon.ico).*)"] };
