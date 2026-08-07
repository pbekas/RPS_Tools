import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: { signIn: "/login" },
});

export const config = {
  matcher: [
    "/",
    "/calls/:path*",
    "/queue",
    "/settings",
    "/api/calls/:path*",
    "/api/qa/:path*",
    "/api/users/:path*",
    "/api/topics/:path*",
  ],
};
