import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  TerminalService,
  type TerminalServiceConfig,
} from "../../src/agent/capabilities/terminal/application/terminal.service.js";
import type { TerminalOutputRecord } from "../../src/agent/capabilities/terminal/application/terminal-output.dao.js";
import { initTestLoggerRuntime } from "../helpers/logger.js";

initTestLoggerRuntime();

async function createService(config: Partial<TerminalServiceConfig> = {}) {
  const records = new Map<string, TerminalOutputRecord>();
  const service = new TerminalService({
    config: {
      initialCwd: os.tmpdir(),
      commandTimeoutMs: 5000,
      previewBytes: 5,
      maxOutputBytes: 1024,
      maxCommandLength: 4096,
      readOutputMaxSize: 5,
      shell: "/bin/sh",
      ...config,
    },
    terminalStateDao: {
      loadCwd: async () => null,
      saveCwd: async () => {},
    },
    terminalOutputDao: {
      save: async record => {
        records.set(record.outputId, { ...record, createdAt: new Date() });
      },
      findByOutputId: async ({ outputId }) => records.get(outputId) ?? null,
    },
  });
  await service.initialize();
  return { service, records };
}

describe("terminal UTF-8 output", () => {
  it("keeps previews on character boundaries for both streams", async () => {
    const { service } = await createService();
    const result = await service.runBash({ command: "printf '中😀文'; printf '中😀文' >&2" });
    expect(result).toMatchObject({
      ok: true,
      stdoutPreview: "中",
      stderrPreview: "中",
      stdoutTruncated: true,
      stderrTruncated: true,
      stdoutTotalBytes: 10,
      stderrTotalBytes: 10,
    });
  });

  it("round-trips paginated output without replacement characters or lost bytes", async () => {
    const { service, records } = await createService();
    const full = "Aé中😀文Z";
    records.set("out_test", {
      outputId: "out_test",
      stdout: full,
      stderr: full,
      createdAt: new Date(),
    });
    for (const stream of ["stdout", "stderr"] as const) {
      for (const size of [1, 2, 3, 4, 5]) {
        let offset = 0;
        let text = "";
        for (let page = 0; page < 20; page++) {
          const result = await service.readOutput({ outputId: "out_test", stream, offset, size });
          if (!result.ok) throw new Error(result.message);
          expect(result.content).not.toContain("\uFFFD");
          expect(result.nextOffset).toBeGreaterThan(offset);
          expect(result.nextOffset - offset).toBe(Buffer.byteLength(result.content));
          text += result.content;
          offset = result.nextOffset;
          if (result.eof) break;
        }
        expect(text).toBe(full);
        expect(offset).toBe(Buffer.byteLength(full));
      }
    }
  });

  it("does not persist a partial character at the capture limit", async () => {
    const { service, records } = await createService({ maxOutputBytes: 5, previewBytes: 100 });
    const result = await service.runBash({ command: "printf '中😀文'; printf '中😀文' >&2" });
    expect(result).toMatchObject({
      ok: true,
      stdoutPreview: "中",
      stderrPreview: "中",
      stdoutTruncated: true,
    });
    expect([...records.values()][0]).toMatchObject({ stdout: "中", stderr: "中" });
  });

  it("aligns an offset inside a character and handles EOF", async () => {
    const { service, records } = await createService();
    records.set("out_test", {
      outputId: "out_test",
      stdout: "中😀文",
      stderr: "",
      createdAt: new Date(),
    });
    for (const offset of [3, 4, 5, 6]) {
      expect(
        await service.readOutput({ outputId: "out_test", stream: "stdout", offset, size: 4 }),
      ).toMatchObject({ ok: true, content: "😀", offset: 3, size: 4, nextOffset: 7, eof: false });
    }
    for (const offset of [10, 100]) {
      expect(
        await service.readOutput({ outputId: "out_test", stream: "stdout", offset }),
      ).toMatchObject({ ok: true, content: "", nextOffset: 10, eof: true });
    }
    expect(await service.readOutput({ outputId: "out_test", stream: "stderr" })).toMatchObject({
      ok: true,
      content: "",
      nextOffset: 0,
      eof: true,
    });
  });

  it("makes progress even when the server page budget is smaller than one character", async () => {
    const { service, records } = await createService({ previewBytes: 1, readOutputMaxSize: 1 });
    const result = await service.runBash({ command: "printf '😀'" });
    expect(result).toMatchObject({ ok: true, stdoutPreview: "", stdoutTruncated: true });
    const outputId = [...records.keys()][0]!;
    expect(await service.readOutput({ outputId, stream: "stdout" })).toMatchObject({
      ok: true,
      content: "😀",
      nextOffset: 4,
      eof: true,
    });
  });

  it("preserves characters split across process chunks and genuine invalid bytes", async () => {
    const { service } = await createService({ previewBytes: 100 });
    const result = await service.runBash({
      command: "printf '\\344'; sleep 0.03; printf '\\270\\255\\377\\344'",
    });
    expect(result).toMatchObject({ ok: true, stdoutPreview: "中\uFFFD\uFFFD" });
  });

  it("drops an unfinished character from captured timeout output", async () => {
    const { service, records } = await createService({ commandTimeoutMs: 200 });
    const result = await service.runBash({
      command: "printf 'A\\344'; printf 'A\\360\\237' >&2; sleep 10",
    });
    expect(result).toMatchObject({
      ok: false,
      error: "TIMEOUT",
      stdoutPreview: "A",
      stderrPreview: "A",
    });
    expect([...records.values()][0]).toMatchObject({ stdout: "A", stderr: "A" });
  });
});
