import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
const dependency = (prefix, name) => {
  const entries = readdirSync(resolve(root, "node_modules/.pnpm")).filter((n) =>
    n.startsWith(prefix),
  );
  const dir = entries.find((n) => n !== prefix) ?? entries[0];
  assert.ok(dir, `Missing ${prefix}`);
  return createRequire(
    resolve(root, "node_modules/.pnpm", dir, "package.json"),
  )(resolve(root, "node_modules/.pnpm", dir, "node_modules", name));
};
test("patched query decoder is callable by existing CommonJS consumers and handles malformed input linearly", () => {
  const decode = dependency(
    "decode-uri-component@0.5.0",
    "decode-uri-component",
  );
  assert.equal(typeof decode, "function");
  assert.equal(decode("%E3%83%9E%E3%83%B3%E7%B5%84"), "マン組");
  const start = performance.now();
  const value = decode("%C3%A5%FF".repeat(10000));
  assert.ok(value.includes("å"));
  assert.ok(performance.now() - start < 2000);
  const query = dependency("query-string@7.1.3", "query-string");
  assert.equal(query.parse("name=%E3%83%9E%E3%83%B3%E7%B5%84").name, "マン組");
});
test("braces rejects hostile nesting for both parsed input and supplied ASTs", () => {
  const braces = dependency("braces@3.0.3", "braces");
  assert.deepEqual(braces.expand("photo-{1..3}.webp"), [
    "photo-1.webp",
    "photo-2.webp",
    "photo-3.webp",
  ]);
  assert.throws(
    () => braces("{".repeat(10000) + "x" + "}".repeat(10000)),
    SyntaxError,
  );
  let ast = { type: "text", value: "x" };
  for (let i = 0; i < 1000; i++) ast = { type: "root", nodes: [ast] };
  for (const method of ["compile", "expand", "stringify"])
    assert.throws(() => braces[method](ast), SyntaxError);
});
test("RSA verification rejects extra nested DigestAlgorithm elements while valid signatures pass", () => {
  const forge = dependency("node-forge@1.4.0", "node-forge"),
    keys = forge.pki.rsa.generateKeyPair({ bits: 1024, workers: 0 });
  const md = forge.md.sha256
    .create()
    .update("Mangumi dependency regression", "utf8");
  assert.equal(
    keys.publicKey.verify(md.digest().bytes(), keys.privateKey.sign(md)),
    true,
  );
  const asn1 = forge.asn1;
  const digest = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OID,
        false,
        asn1.oidToDer(forge.oids.sha256).getBytes(),
      ),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ""),
      asn1.create(
        asn1.Class.UNIVERSAL,
        asn1.Type.OCTETSTRING,
        false,
        "garbage",
      ),
    ]),
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.OCTETSTRING,
      false,
      md.digest().bytes(),
    ),
  ]);
  const malformed = forge.pki.rsa.encrypt(
    asn1.toDer(digest).getBytes(),
    keys.privateKey,
    0x01,
  );
  assert.throws(
    () => keys.publicKey.verify(md.digest().bytes(), malformed),
    /DigestInfo/,
  );
});
test("uuid used by xcode retains CommonJS compatibility and validates output buffer bounds", () => {
  const uuid = dependency("uuid@11.1.1", "uuid");
  assert.match(uuid.v4(), /^[a-f\d-]{36}$/);
  assert.throws(() => uuid.v5("x", uuid.v5.DNS, new Uint8Array(8)), RangeError);
});
