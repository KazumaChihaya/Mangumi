import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, ".."),
  report = JSON.parse(
    await readFile(
      resolve(process.argv[2] ?? ".local/dependency-audit.json"),
      "utf8",
    ),
  );
assert.ok(
  report.advisories && report.metadata,
  "Dependency audit did not return a valid advisory report",
);
const mitigations = {
  "GHSA-vfj7-8cjw-p6xm": {
    module: "braces",
    version: "3.0.3",
    patch: "patches/braces@3.0.3.patch",
    evidence: "Brace nesting exceeds 128 levels",
  },
  "GHSA-86w9-cpqp-85rv": {
    module: "node-forge",
    version: "1.4.0",
    patch: "patches/node-forge@1.4.0.patch",
    evidence: "obj.value[0].value.length > 2",
  },
};
for (const advisory of Object.values(report.advisories)) {
  const mitigation = mitigations[advisory.github_advisory_id];
  assert.ok(
    mitigation,
    `Unmitigated dependency advisory: ${advisory.github_advisory_id} (${advisory.module_name})`,
  );
  assert.equal(advisory.module_name, mitigation.module);
  assert.ok(advisory.findings.every((f) => f.version === mitigation.version));
  assert.ok(
    (await readFile(resolve(root, mitigation.patch), "utf8")).includes(
      mitigation.evidence,
    ),
  );
}
console.log(
  "Audit contains only the 2 explicitly documented, locally patched upstream advisories. Run test:security to verify the installed fixes.",
);
