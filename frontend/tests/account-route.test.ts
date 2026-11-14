// @vitest-environment node
import { DEFAULT_COOKIE_OPTIONS } from "@supabase/ssr";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import {
  appendMutableCookies,
  MutableRequestCookiesAdapter,
} from "next/dist/server/web/spec-extension/adapters/request-cookies";
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { POST, maxDuration } = await import("@/app/api/account/route");

const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const ORIGIN = "https://rewrity.example";

// The two clients as far as this route may use them: the session says who is asking and ends, the
// server's deletes the account. Anything else it reached for would fail the test.
function connect({
  claims = { sub: ACCOUNT } as { sub: string } | null,
  authError = null as Error | null,
  deleted = { error: null } as unknown,
  signOutError = null as Error | null,
} = {}) {
  const order: string[] = [];
  const getClaims = vi.fn(async () => ({
    data: claims && { claims },
    error: authError,
  }));
  const signOut = vi.fn(async () => {
    order.push("signOut");
    if (signOutError) throw signOutError;
    return { error: null };
  });
  const deleteUser = vi.fn(async () => {
    order.push("deleteUser");
    return deleted;
  });
  createClient.mockResolvedValue({ auth: { getClaims, signOut } });
  createServiceClient.mockReturnValue({ auth: { admin: { deleteUser } } });
  return { deleteUser, signOut, getClaims, order };
}

// What this browser holds of a session, in the names @supabase/ssr gives it: the session in two
// chunks and a code verifier, beside a cookie that is not the session's
const COOKIES = [
  "sb-ref-auth-token.0=part-one",
  "NEXT_LOCALE=fr",
  "sb-ref-auth-token.1=part-two",
  "sb-ref-auth-token-code-verifier=verifier",
].join("; ");

// Each of those session cookies expired, at the path and with the attributes @supabase/ssr sets
const EXPIRED = [
  "sb-ref-auth-token.0=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=lax",
  "sb-ref-auth-token.1=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=lax",
  "sb-ref-auth-token-code-verifier=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; SameSite=lax",
];

// The same once Next has read them back to add a session the session check renewed: Max-Age=0
// does not survive that, so the date is what still expires them
const READ_BACK = [
  "sb-ref-auth-token.0=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=lax",
  "sb-ref-auth-token.1=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=lax",
  "sb-ref-auth-token-code-verifier=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=lax",
];

const request = ({
  body = JSON.stringify({ account: ACCOUNT }) as string | undefined,
  origin = ORIGIN as string | null,
  host = "rewrity.example" as string | null,
  forwardedHost = null as string | null,
  cookie = COOKIES as string | null,
} = {}) =>
  POST(
    new Request("http://internal-address/api/account", {
      method: "POST",
      body,
      headers: {
        ...(origin === null ? {} : { origin }),
        ...(host === null ? {} : { host }),
        ...(forwardedHost === null
          ? {}
          : { "x-forwarded-host": forwardedHost }),
        ...(cookie === null ? {} : { cookie }),
      },
    }),
  );

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  createClient.mockReset();
  createServiceClient.mockReset();
  logged = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("POST /api/account", () => {
  describe("when it is allowed to run", () => {
    it("deletes exactly the session's account, for good, then signs out here only", async () => {
      const { deleteUser, signOut, order } = connect();
      const response = await request();
      expect(response.status).toBe(200);
      expect(deleteUser).toHaveBeenCalledExactlyOnceWith(ACCOUNT, false);
      expect(signOut).toHaveBeenCalledExactlyOnceWith({ scope: "local" });
      expect(order).toEqual(["deleteUser", "signOut"]);
    });

    it("counts an account already gone as done, and still ends the session", async () => {
      const { signOut } = connect({
        deleted: {
          error: new AuthApiError("User not found", 404, "user_not_found"),
        },
      });
      expect((await request()).status).toBe(200);
      expect(signOut).toHaveBeenCalledTimes(1);
      expect(logged).not.toHaveBeenCalled();
    });

    // @supabase/ssr clears them through the cookie store as it signs out
    it("leaves the cookies to a sign-out that answers", async () => {
      connect();
      const response = await request();
      expect(response.status).toBe(200);
      expect(response.headers.getSetCookie()).toEqual([]);
    });

    it("answers success once the account is gone, even if the sign-out throws, and expires the session cookies itself", async () => {
      connect({ signOutError: new Error("the network went") });
      const response = await request();
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ deleted: true });
      expect(response.headers.getSetCookie()).toEqual(EXPIRED);
    });

    it("takes the host a proxy reports", async () => {
      const { deleteUser } = connect();
      const response = await request({
        host: "internal-address",
        forwardedHost: "rewrity.example, other",
      });
      expect(response.status).toBe(200);
      expect(deleteUser).toHaveBeenCalledTimes(1);
    });
  });

  describe("refuses, without deleting anything", () => {
    const refused = async (
      expected: number,
      code: string,
      options?: Parameters<typeof request>[0],
      scene?: Parameters<typeof connect>[0],
    ) => {
      const { deleteUser, signOut } = connect(scene);
      const response = await request(options);
      expect(response.status).toBe(expected);
      expect(await response.json()).toEqual({ error: code });
      expect(deleteUser).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
    };

    it.each([
      ["no Origin", { origin: null }],
      ["another site's Origin", { origin: "https://evil.example" }],
      ["a look-alike", { origin: "https://rewrity.example.evil.example" }],
      ["a port that differs", { origin: "https://rewrity.example:8443" }],
      ["an Origin that is no address", { origin: "null" }],
      ["no Host", { host: null }],
    ])("a request with %s", async (_case, options) => {
      await refused(403, "invalid_request", options);
      expect(createClient).not.toHaveBeenCalled();
    });

    it.each([
      ["no body", { body: "" }],
      ["a body that is not JSON", { body: "not json" }],
      ["a body without the id", { body: "{}" }],
      ["an empty id", { body: JSON.stringify({ account: "" }) }],
      ["an id of the wrong type", { body: JSON.stringify({ account: 1 }) }],
      ["a body that is null", { body: "null" }],
      [
        "too long a body",
        { body: JSON.stringify({ account: "x".repeat(300) }) },
      ],
    ])("%s", async (_case, options) => {
      await refused(400, "invalid_request", options);
    });

    it("without a signed-in session", async () => {
      await refused(401, "unauthorized", undefined, { claims: null });
    });

    it.each([
      ["out of reach", new AuthRetryableFetchError("down", 503)],
      [
        "overloaded",
        new AuthApiError("slow down", 429, "over_request_rate_limit"),
      ],
      ["failing", new AuthApiError("failed", 500, "unexpected_failure")],
    ])(
      "while Auth is %s, which is not a sign-out",
      async (_case, authError) => {
        await refused(500, "server_error", undefined, { authError });
      },
    );

    // A tab left open after signing in as someone else: the cookie names the other account
    it("an account other than the session's, which cannot be undone", async () => {
      await refused(
        409,
        "invalid_request",
        { body: JSON.stringify({ account: "someone-else" }) },
        { claims: { sub: ACCOUNT } },
      );
    });
  });

  describe("without the keys", () => {
    it("answers 503 on a preview that has no secret key", async () => {
      const { deleteUser, getClaims, signOut } = connect();
      createServiceClient.mockReturnValue(null);
      const response = await request();
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "not_configured" });
      expect(deleteUser).not.toHaveBeenCalled();
      expect(getClaims).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
    });

    it("answers 503 without Supabase at all", async () => {
      createClient.mockResolvedValue(null);
      createServiceClient.mockReturnValue(null);
      expect((await request()).status).toBe(503);
    });
  });

  describe("when the deletion fails", () => {
    it("answers 500, leaves the session alone and logs a code, never a message", async () => {
      const { signOut } = connect({
        deleted: {
          error: new AuthApiError("secret detail", 500, "unexpected_failure"),
        },
      });
      const response = await request();
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "server_error" });
      expect(signOut).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        "Account deletion failed",
        "unexpected_failure",
      );
    });

    it("answers 500 when the call itself throws, and leaves the session alone", async () => {
      const { signOut } = connect();
      createServiceClient.mockReturnValue({
        auth: {
          admin: {
            deleteUser: async () => {
              throw new Error("secret detail");
            },
          },
        },
      });
      expect((await request()).status).toBe(500);
      expect(signOut).not.toHaveBeenCalled();
      expect(JSON.stringify(logged.mock.calls)).not.toContain("secret detail");
    });
  });

  describe("when Auth stops answering", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const never = () => new Promise<never>(() => {});

    // What `pending` has come to `ms` from now
    async function resultAfter<T>(pending: Promise<T>, ms: number) {
      await vi.advanceTimersByTimeAsync(ms);
      return Promise.race([pending, Promise.resolve("still waiting" as const)]);
    }

    it("gives up on the deletion after 8 s, as a failure, and leaves the session alone", async () => {
      const { deleteUser, signOut } = connect();
      deleteUser.mockImplementation(never);
      const pending = request();
      expect(await resultAfter(pending, 7_999)).toBe("still waiting");
      const response = await resultAfter(pending, 1);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(500);
      expect(await (response as Response).json()).toEqual({
        error: "server_error",
      });
      expect(signOut).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        "Account deletion failed",
        "deadline",
      );
    });

    // The account is gone by then: only this browser's cookies are left to clear
    it("still answers success after 8 s when the sign-out stalls", async () => {
      const { signOut } = connect();
      signOut.mockImplementation(never);
      const pending = request();
      expect(await resultAfter(pending, 7_999)).toBe("still waiting");
      const response = await resultAfter(pending, 1);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(200);
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        "Sign-out after deletion failed",
        "deadline",
      );
    });

    // Auth may not have ended the session, and this browser would look signed in, to an account
    // that is gone, until its token expires
    it("then expires this browser's session cookies itself, and no other cookie", async () => {
      const { signOut } = connect();
      signOut.mockImplementation(never);
      const response = await resultAfter(request(), 8_000);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(200);
      expect(await (response as Response).json()).toEqual({ deleted: true });
      expect((response as Response).headers.getSetCookie()).toEqual(EXPIRED);
    });

    // A session near its end is renewed by the session check, through Next's cookie store, and Next
    // adds that store to the answer by reading the answer's own cookies back
    it("keeps them expired when the session check renewed the session in the same request", async () => {
      const store = MutableRequestCookiesAdapter.wrap(
        new RequestCookies(new Headers({ cookie: COOKIES })),
      );
      const { getClaims, signOut } = connect();
      getClaims.mockImplementation(async () => {
        store.set("sb-ref-auth-token.0", "renewed-one", DEFAULT_COOKIE_OPTIONS);
        store.set("sb-ref-auth-token.1", "renewed-two", DEFAULT_COOKIE_OPTIONS);
        return { data: { claims: { sub: ACCOUNT } }, error: null };
      });
      signOut.mockImplementation(never);
      const response = await resultAfter(request(), 8_000);
      expect(response).toBeInstanceOf(Response);
      // What Next's route module does to the answer before it leaves
      const headers = new Headers((response as Response).headers);
      expect(appendMutableCookies(headers, store)).toBe(true);
      expect(headers.getSetCookie()).toEqual(READ_BACK);
    });

    // A key set not cached yet, or a legacy token that goes to Auth
    it("gives the session check 8 s as well, then answers as when Auth is down, and deletes nothing", async () => {
      const { getClaims, deleteUser, signOut } = connect();
      getClaims.mockImplementation(never);
      const pending = request();
      expect(await resultAfter(pending, 7_999)).toBe("still waiting");
      const response = await resultAfter(pending, 1);
      expect(response).toBeInstanceOf(Response);
      expect((response as Response).status).toBe(500);
      expect(await (response as Response).json()).toEqual({
        error: "server_error",
      });
      expect(deleteUser).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        "Account refused",
        "auth_down",
      );
    });

    it("answers within the function's own limit when all three calls take all their time", async () => {
      const { getClaims, deleteUser, signOut } = connect();
      getClaims.mockImplementation(async () => {
        await new Promise((done) => setTimeout(done, 7_999));
        return { data: { claims: { sub: ACCOUNT } }, error: null };
      });
      deleteUser.mockImplementation(
        () => new Promise((done) => setTimeout(done, 7_999, { error: null })),
      );
      signOut.mockImplementation(never);
      const pending = request();
      expect(await resultAfter(pending, 23_997)).toBe("still waiting");
      expect(await resultAfter(pending, 1)).toBeInstanceOf(Response);
      expect(23_998).toBeLessThan(maxDuration * 1000);
    });
  });

  describe("what a refusal before the deletion leaves in the logs", () => {
    it.each([
      ["the secret key", () => createServiceClient.mockReturnValue(null)],
      ["Supabase", () => createClient.mockResolvedValue(null)],
    ])("one line with its code, without %s", async (_case, unset) => {
      connect();
      unset();
      expect((await request()).status).toBe(503);
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        "Account refused",
        "not_configured",
      );
    });

    it("one line with its code while Auth is down, and nothing of its message", async () => {
      connect({ authError: new AuthRetryableFetchError("secret detail", 0) });
      expect((await request()).status).toBe(500);
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        "Account refused",
        "auth_down",
      );
    });

    // Neither is a fault of the site
    it.each([
      ["no session", { claims: null }],
      [
        "a rejected token",
        { claims: null, authError: new AuthApiError("bad", 403, "bad_jwt") },
      ],
    ])("nothing for %s", async (_case, scene) => {
      connect(scene);
      expect((await request()).status).toBe(401);
      expect(logged).not.toHaveBeenCalled();
    });
  });
});
