// The guard that keeps the database tests and the audit off a hosted project. Needs no stack.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertLocal, BASE_KEYS, parseStatus } from "./local-stack.mjs";

const stack = (API_URL) => ({
  API_URL,
  PUBLISHABLE_KEY: "publishable",
  SECRET_KEY: "secret",
});

describe("the local stack", () => {
  it("reads the values `supabase status -o env` prints, without their quotes", () => {
    assert.deepEqual(
      parseStatus(
        'API_URL="http://127.0.0.1:54321"\nSECRET_KEY="a=b"\n\nnoise',
      ),
      { API_URL: "http://127.0.0.1:54321", SECRET_KEY: "a=b" },
    );
  });

  for (const url of [
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://[::1]:54321",
  ]) {
    it(`accepts ${url}`, () => {
      assert.equal(assertLocal(stack(url)).API_URL, url);
    });
  }

  for (const url of [
    "https://abcdefgh.supabase.co",
    "http://127.0.0.1.example.com:54321",
    "http://localhost.example.com:54321",
  ]) {
    it(`refuses ${url}`, () => {
      assert.throws(() => assertLocal(stack(url)), /local stacks only/);
    });
  }

  for (const key of BASE_KEYS) {
    it(`refuses a status without ${key}`, () => {
      const { [key]: _gone, ...rest } = stack("http://127.0.0.1:54321");
      assert.throws(() => assertLocal(rest), new RegExp(`has no ${key}`));
    });
  }

  it("refuses a status without a key only this caller needs", () => {
    assert.throws(
      () =>
        assertLocal(stack("http://127.0.0.1:54321"), [
          ...BASE_KEYS,
          "MAILPIT_URL",
        ]),
      /has no MAILPIT_URL/,
    );
  });
});
