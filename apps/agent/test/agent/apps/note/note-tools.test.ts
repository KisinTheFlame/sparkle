import { describe, expect, it } from "vitest";
import { NoteApp } from "../../../../src/agent/apps/note/note.app.js";
import { NoteService } from "../../../../src/agent/capabilities/note/application/note.service.js";
import { InMemoryNoteDao } from "../../../helpers/in-memory-note.dao.js";

function setup(): { app: NoteApp; service: NoteService } {
  const service = new NoteService({ noteDao: new InMemoryNoteDao() });
  return { app: new NoteApp({ noteService: service }), service };
}

function tool(app: NoteApp, name: string) {
  const found = app.tools.find(candidate => candidate.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

describe("note App tools", () => {
  it("暴露五个工具", () => {
    const { app } = setup();
    expect(app.tools.map(t => t.name)).toEqual([
      "create_page",
      "list_pages",
      "read_page",
      "append_note",
      "search_notes",
    ]);
  });

  it("create_page + append_note：紧凑确认；页不存在给指路错误", async () => {
    const { app } = setup();
    const created = await tool(app, "create_page").execute({ title: "项目A" }, {});
    expect(JSON.parse(created.content)).toEqual({ ok: true, title: "项目A" });

    const appended = await tool(app, "append_note").execute(
      { page: "项目A", content: "周五交付" },
      {},
    );
    expect(JSON.parse(appended.content)).toMatchObject({ ok: true });

    const missing = await tool(app, "append_note").execute({ page: "没这页", content: "x" }, {});
    const parsed = JSON.parse(missing.content);
    expect(parsed).toMatchObject({ ok: false, error: "PAGE_NOT_FOUND" });
    expect(parsed.message).toContain("list_pages");
  });

  it("read_page / list_pages / search_notes 返回屏幕文本", async () => {
    const { app } = setup();
    await tool(app, "create_page").execute({ title: "项目A" }, {});
    await tool(app, "append_note").execute({ page: "项目A", content: "周五交付" }, {});

    const pages = await tool(app, "list_pages").execute({}, {});
    expect(pages.content).toContain("<note_pages>");
    expect(pages.content).toContain("项目A（1 条");

    const page = await tool(app, "read_page").execute({ page: "项目A" }, {});
    expect(page.content).toContain('<note_page title="项目A">');
    expect(page.content).toContain("周五交付");

    const hits = await tool(app, "search_notes").execute({ query: "交付" }, {});
    expect(hits.content).toContain('<note_search_results query="交付">');
    expect(hits.content).toContain("《项目A》");

    const none = await tool(app, "search_notes").execute({ query: "无关词" }, {});
    expect(none.content).toContain("（没有命中）");
  });

  it("onFocus 列页清单；空笔记本给空态", async () => {
    const { app } = setup();
    const effects = await app.onFocus();
    expect(effects).toHaveLength(1);
    const effect = effects[0] as { type: string; content: string };
    expect(effect.type).toBe("append_message");
    expect(effect.content).toContain("（还没有任何笔记页）");
  });
});
