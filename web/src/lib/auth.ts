import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { getUser, upsertUser } from "@/lib/firestore";

const domain = (process.env.ALLOWED_EMAIL_DOMAIN || "releviumpain.com").toLowerCase();

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      authorization: {
        params: {
          hd: domain,
          prompt: "select_account",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      const email = (user.email || "").toLowerCase();
      if (!email.endsWith(`@${domain}`)) return false;
      try {
        const existing = await getUser(email);
        if (!existing) {
          await upsertUser({
            email,
            name: user.name || email,
            role: "Agent",
          });
        } else if (user.name && existing.name !== user.name) {
          await upsertUser({
            email,
            name: user.name,
            role: existing.role || "Agent",
          });
        }
      } catch {
        // Allow login even if Firestore briefly fails; role resolves later
      }
      return true;
    },
    async jwt({ token }) {
      const email = (token.email || "").toLowerCase();
      if (email) {
        try {
          const u = await getUser(email);
          token.role = u?.role || "Agent";
          token.name = u?.name || token.name;
        } catch {
          token.role = token.role || "Agent";
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string;
        session.user.name = (token.name as string) || session.user.name;
        (session.user as { role?: string }).role = (token.role as string) || "Agent";
      }
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};
