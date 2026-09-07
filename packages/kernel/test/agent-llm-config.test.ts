import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStaticConfig } from "../src/config/config.loader.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true })));
});

async function fixture(extra: { agent?: unknown; llm?: unknown } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "sparkle-agent-llm-config-"));
  directories.push(directory);
  const configPath = join(directory, "config.yaml");
  await writeFile(configPath, await readFile(new URL("../../../config.yaml", import.meta.url)));
  await writeFile(
    join(directory, "config.secret.yaml"),
    JSON.stringify({
      server: {
        employer: { name: "test" },
        feishu: { appId: "test", appSecret: "test" },
        ...extra,
      },
    }),
  );
  return { configPath };
}

it("loads agent-owned usage overrides, normalizes attempts and leaves the gateway without policy", async () => {
  const config = await loadStaticConfig(
    await fixture({
      agent: {
        usages: {
          agent: { attempts: [{ provider: "openai", model: "test-model" }], thinking: "high" },
        },
      },
    }),
  );
  expect(config.server.agent.usages.agent).toEqual({
    attempts: [{ provider: "openai", model: "test-model", times: 1 }],
    thinking: "high",
  });
  expect(config.server.agent.usages.vision.attempts.length).toBeGreaterThan(0);
  expect(config.server.llm).not.toHaveProperty("usages");
});

it("rejects an override at the retired gateway usage path instead of silently ignoring it", async () => {
  await expect(
    loadStaticConfig(await fixture({ llm: { usages: { agent: {} } } })),
  ).rejects.toMatchObject({
    meta: { key: "server.llm.usages", reason: "CONFIG_INVALID" },
  });
});
