import "next-auth";
import "next-auth/jwt";
import type { ModuleId } from "@/lib/permissions";

declare module "next-auth" {
  interface Session {
    user: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role?: string;
      modules?: ModuleId[];
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string;
    modules?: ModuleId[];
  }
}
