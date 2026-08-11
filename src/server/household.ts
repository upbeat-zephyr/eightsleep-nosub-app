import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { AuthError } from "~/server/eight/auth";

export async function getSessionEmail(headers: Headers): Promise<string> {
  const cookieHeader = headers.get("cookie");
  if (!cookieHeader) {
    throw new AuthError("Auth request failed. No cookies found.", 401);
  }

  const token = cookieHeader
    .split("; ")
    .find((row) => row.startsWith("8slpAutht="))
    ?.split("=")[1];

  if (!token) {
    throw new AuthError("Auth request failed. No cookies found.", 401);
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      email: string;
    };
    return decoded.email;
  } catch {
    throw new AuthError("Auth request failed. Invalid token.", 401);
  }
}

export function getApprovedEmails(): string[] {
  return (process.env.APPROVED_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isHouseholdManager(email: string): boolean {
  const configuredManager =
    process.env.HOUSEHOLD_MANAGER_EMAIL?.trim().toLowerCase();
  const managerEmail = configuredManager?.length
    ? configuredManager
    : getApprovedEmails()[0];
  return managerEmail === email.toLowerCase();
}

export async function authorizeTargetEmail(
  requesterEmail: string,
  requestedEmail?: string,
): Promise<string> {
  const requester = requesterEmail.toLowerCase();
  const target = requestedEmail?.toLowerCase() ?? requester;

  if (target !== requester && !isHouseholdManager(requester)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You can only manage your own side.",
    });
  }

  const approvedEmails = getApprovedEmails();
  if (!approvedEmails.includes(target)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "That household account is not approved.",
    });
  }

  const targetUser = await db.query.users.findFirst({
    where: sql`lower(${users.email}) = ${target}`,
  });
  if (!targetUser) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "That person needs to log in once before their side can be managed.",
    });
  }

  return targetUser.email;
}

export async function getHouseholdMembers(requesterEmail: string): Promise<
  Array<{
    email: string;
    label: string;
    isSelf: boolean;
  }>
> {
  const requester = requesterEmail.toLowerCase();
  const approvedEmails = getApprovedEmails();
  const visibleEmails = isHouseholdManager(requester)
    ? approvedEmails
    : [requester];

  if (visibleEmails.length === 0) {
    return [];
  }

  const savedUsers = await db.select({ email: users.email }).from(users);
  const savedEmails = new Map(
    savedUsers.map((user) => [user.email.toLowerCase(), user.email]),
  );

  return visibleEmails
    .filter((email) => savedEmails.has(email))
    .map((email) => ({
      email: savedEmails.get(email)!,
      label: email === requester ? "My side" : "Partner side",
      isSelf: email === requester,
    }));
}
