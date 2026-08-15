import { describe, expect, it } from "vitest";
import { NoteService } from "../../../../src/agent/capabilities/note/application/note.service.js";
import {
  NOTE_ENTRY_MAX_CHARS,
  NOTE_PAGE_TITLE_MAX_CHARS,
  NOTE_READ_PAGE_LIMIT,
  NOTE_SEARCH_LIMIT,
} from "../../../../src/agent/capabilities/note/application/note.constants.js";
import { InMemoryNoteDao } from "../../../helpers/in-memory-note.dao.js";

function setup(): NoteService {
  return new NoteService({ noteDao: new InMemoryNoteDao() });
}

describe("NoteService", () => {
  it("创建页：trim 标题、拒绝空/超长/重名", async () => {
    const service = setup();
    const created = await service.createPage({ title: "  雇主偏好  " });
    expect(created).toMatchObject({ ok: true, page: { title: "雇主偏好" } });

    expect(await service.createPage({ title: "   " })).toEqual({
      ok: false,
      error: "TITLE_INVALID",
    });
    expect(await service.createPage({ title: "长".repeat(NOTE_PAGE_TITLE_MAX_CHARS + 1) })).toEqual(
      { ok: false, error: "TITLE_INVALID" },
    );
    expect(await service.createPage({ title: "雇主偏好" })).toEqual({
      ok: false,
      error: "TITLE_EXISTS",
    });
  });

  it("追加条目：页须存在、内容 trim 且有上限", async () => {
    const service = setup();
    await service.createPage({ title: "项目A" });

    const appended = await service.appendNote({ page: "项目A", content: "  周五要交付  " });
    expect(appended).toMatchObject({ ok: true, entry: { content: "周五要交付" } });

    expect(await service.appendNote({ page: "不存在", content: "x" })).toEqual({
      ok: false,
      error: "PAGE_NOT_FOUND",
    });
    expect(
      await service.appendNote({ page: "项目A", content: "长".repeat(NOTE_ENTRY_MAX_CHARS + 1) }),
    ).toEqual({ ok: false, error: "CONTENT_INVALID" });
  });

  it("读页：时间正序、offset 分段、带 total", async () => {
    const service = setup();
    await service.createPage({ title: "项目A" });
    for (let i = 1; i <= NOTE_READ_PAGE_LIMIT + 5; i++) {
      await service.appendNote({ page: "项目A", content: `第${i}条` });
    }

    const first = await service.readPage({ page: "项目A" });
    if (!first.ok) throw new Error("expected ok");
    expect(first.total).toBe(NOTE_READ_PAGE_LIMIT + 5);
    expect(first.entries).toHaveLength(NOTE_READ_PAGE_LIMIT);
    expect(first.entries[0]?.content).toBe("第1条");

    const rest = await service.readPage({ page: "项目A", offset: NOTE_READ_PAGE_LIMIT });
    if (!rest.ok) throw new Error("expected ok");
    expect(rest.entries).toHaveLength(5);
    expect(rest.entries[0]?.content).toBe(`第${NOTE_READ_PAGE_LIMIT + 1}条`);

    expect(await service.readPage({ page: "不存在" })).toEqual({
      ok: false,
      error: "PAGE_NOT_FOUND",
    });
  });

  it("列页：按最近更新倒序、带条目数", async () => {
    let tick = 0;
    const dao = new InMemoryNoteDao({ now: () => new Date(1_700_000_000_000 + ++tick * 1000) });
    const service = new NoteService({ noteDao: dao });
    await service.createPage({ title: "旧页" });
    await service.createPage({ title: "新页" });
    await service.appendNote({ page: "旧页", content: "旧页刚更新" });

    const pages = await service.listPages();
    expect(pages.map(page => page.title)).toEqual(["旧页", "新页"]);
    expect(pages[0]?.entryCount).toBe(1);
    expect(pages[1]?.entryCount).toBe(0);
  });

  it("搜索：内容与页标题都命中、新旧倒序、封顶、空查询拒绝", async () => {
    const service = setup();
    await service.createPage({ title: "飞书接入" });
    await service.createPage({ title: "杂记" });
    await service.appendNote({ page: "杂记", content: "记一笔与飞书无关的事" });
    await service.appendNote({ page: "飞书接入", content: "app_id 已拿到" });

    const hits = await service.search({ query: "飞书" });
    if (hits === "QUERY_INVALID") throw new Error("expected hits");
    // 页标题命中（飞书接入的条目）+ 内容命中（杂记里提到飞书），按条目新旧倒序。
    expect(hits.map(hit => hit.pageTitle)).toEqual(["飞书接入", "杂记"]);

    for (let i = 0; i < NOTE_SEARCH_LIMIT + 3; i++) {
      await service.appendNote({ page: "杂记", content: `飞书相关第${i}条` });
    }
    const capped = await service.search({ query: "飞书" });
    if (capped === "QUERY_INVALID") throw new Error("expected hits");
    expect(capped).toHaveLength(NOTE_SEARCH_LIMIT);

    expect(await service.search({ query: "  " })).toBe("QUERY_INVALID");
  });
});
