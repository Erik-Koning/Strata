"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "../../server/auth.ts";
import { getViewer } from "../../server/viewer.ts";

const back = (code: string, key: string, value: string): never =>
  redirect(`/activate?user_code=${encodeURIComponent(code)}&${key}=${encodeURIComponent(value)}`);

// The browser side of the device flow: claim the user code for the signed-in person, then
// approve or deny it. Better Auth takes the camelCase `userCode` when approving.
export async function decideDevice(formData: FormData): Promise<void> {
  const code = String(formData.get("user_code") ?? "").trim();
  const decision = String(formData.get("decision") ?? "approve");
  if (!(await getViewer())) redirect(`/sign-in?next=${encodeURIComponent(`/activate?user_code=${code}`)}`);
  if (!code) back("", "error", "No sign-in code was provided.");

  const requestHeaders = await headers();
  // redirect() works by throwing, so it runs after the try: inside it, the catch would turn every success into an error.
  let outcome: [key: string, value: string];
  try {
    if (decision === "deny") {
      await auth().api.deviceDeny({ body: { userCode: code }, headers: requestHeaders });
      outcome = ["done", "denied"];
    } else {
      // Claim the code for this person first; approve refuses a code no verifying session has claimed.
      await auth().api.deviceVerify({ query: { user_code: code }, headers: requestHeaders });
      await auth().api.deviceApprove({ body: { userCode: code }, headers: requestHeaders });
      outcome = ["done", "approved"];
    }
  } catch (error) {
    outcome = ["error", error instanceof Error ? error.message : "Could not approve the sign-in."];
  }
  back(code, ...outcome);
}
