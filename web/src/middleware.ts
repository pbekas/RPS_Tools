import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/",
    "/calls/:path*",
    "/queue",
    "/ops",
    "/coaching",
    "/settings",
    "/users",
    "/contracts",
    "/contracts/:path*",
    "/api/calls/:path*",
    "/api/call-logs/:path*",
    "/api/coaching/:path*",
    "/api/uploads",
    "/api/flags/:path*",
    "/api/qa/:path*",
    "/api/users/:path*",
    "/api/topics/:path*",
    "/api/contracts/:path*",
  ],
};
