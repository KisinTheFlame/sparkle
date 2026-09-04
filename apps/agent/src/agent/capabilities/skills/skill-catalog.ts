import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { parseDocument } from "yaml";

export type SkillCatalogEntry = {
  name: string;
  description: string;
};

export type SkillCatalogChange = {
  name: string;
  kind: "added" | "modified" | "removed" | "invalid";
  description?: string;
  error?: string;
};

type SkillState = {
  entry?: SkillCatalogEntry;
  fingerprint?: string;
  error?: string;
};

/** 文件目录观察器，不读取正文进上下文、不执行或修改 Skill，也不管理使用状态。 */
export class SkillCatalog {
  private readonly directory: string;
  private readonly onChange: (changes: SkillCatalogChange[]) => void;
  private readonly onError: (error: unknown) => void;
  private states = new Map<string, SkillState>();
  private initialized = false;
  private stopped = false;
  private watcher: FSWatcher | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Promise<void> = Promise.resolve();

  public constructor({
    directory,
    onChange,
    onError,
  }: {
    directory: string;
    onChange: (changes: SkillCatalogChange[]) => void;
    onError: (error: unknown) => void;
  }) {
    this.directory = directory;
    this.onChange = onChange;
    this.onError = onError;
  }

  public getEntries(): SkillCatalogEntry[] {
    return [...this.states.values()].flatMap(state => (state.entry ? [{ ...state.entry }] : []));
  }

  /** 启动/计划性重建时也现扫；与 watcher 扫描串行，避免旧扫描覆盖新状态。 */
  public refresh(): Promise<void> {
    const next = this.pending.then(async () => {
      if (this.stopped) return;
      await mkdir(this.directory, { recursive: true });
      const states = await readCatalog(this.directory);
      if (this.stopped) return;
      const changes: SkillCatalogChange[] = [];
      for (const [name, state] of states) {
        const previous = this.states.get(name);
        if (state.error) {
          if (state.error !== previous?.error) {
            changes.push({ name, kind: "invalid", error: state.error });
          }
        } else if (state.entry && this.initialized) {
          if (!previous?.entry) {
            changes.push({ ...state.entry, kind: "added" });
          } else if (state.fingerprint !== previous.fingerprint) {
            changes.push({ ...state.entry, kind: "modified" });
          }
        }
      }
      for (const name of this.states.keys()) {
        if (!states.has(name)) changes.push({ name, kind: "removed" });
      }
      this.states = states;
      this.initialized = true;
      if (changes.length > 0) this.onChange(changes);
    });
    this.pending = next.catch(() => {});
    return next;
  }

  public async startWatching(): Promise<void> {
    if (this.watcher || this.stopped) return;
    await mkdir(this.directory, { recursive: true });
    this.watcher = watch(this.directory, { recursive: true, persistent: false }, () => {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.refresh().catch(this.onError);
      }, 300);
      this.timer.unref();
    });
    this.watcher.on("error", this.onError);
    // 关闭初始扫描与挂 watcher 之间的漏报窗口。
    await this.refresh();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.watcher?.close();
    this.watcher = null;
    await this.pending;
  }
}

async function readCatalog(directory: string): Promise<Map<string, SkillState>> {
  const root = await realpath(directory);
  const children = await readdir(root, { withFileTypes: true });
  const states = new Map<string, SkillState>();
  // 不依赖文件系统枚举顺序或系统 locale，目录快照字节顺序稳定。
  for (const child of children.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (child.name.startsWith(".") || (!child.isDirectory() && !child.isSymbolicLink())) continue;
    try {
      if (child.isSymbolicLink()) throw new Error("SKILL_DIRECTORY_SYMLINK");
      const skillDirectory = join(root, child.name);
      const fingerprint = await fingerprintResources(skillDirectory);
      const source = await readFile(join(skillDirectory, "SKILL.md"), "utf8");
      const frontmatter = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
      if (!frontmatter) throw new Error("MISSING_FRONTMATTER");
      const document = parseDocument(frontmatter[1]);
      if (document.errors.length > 0) throw new Error("INVALID_FRONTMATTER");
      const metadata: unknown = document.toJS();
      if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("INVALID_FRONTMATTER");
      }
      const { name, description } = metadata as Record<string, unknown>;
      if (typeof name !== "string" || name !== child.name) throw new Error("INVALID_NAME");
      if (typeof description !== "string" || description.trim().length === 0) {
        throw new Error("INVALID_DESCRIPTION");
      }
      states.set(name, {
        entry: { name, description: description.trim() },
        fingerprint: createHash("sha256").update(fingerprint).update(source).digest("hex"),
      });
    } catch (error) {
      states.set(child.name, {
        error:
          error instanceof Error && "code" in error
            ? String(error.code)
            : error instanceof Error
              ? error.message
              : "INVALID_SKILL",
      });
    }
  }
  return states;
}

/** 资源只检查元数据和真实路径，不加载二进制；资源修改也属于 Skill 修改。 */
async function fingerprintResources(directory: string): Promise<string> {
  const fingerprint = createHash("sha256");
  async function visit(path: string): Promise<void> {
    for (const name of (await readdir(path)).sort()) {
      const resource = join(path, name);
      const stat = await lstat(resource);
      if (stat.isSymbolicLink()) {
        const resolved = await realpath(resource);
        const relativePath = relative(directory, resolved);
        if (
          isAbsolute(relativePath) ||
          relativePath === ".." ||
          relativePath.startsWith(`..${sep}`)
        ) {
          throw new Error("RESOURCE_OUTSIDE_SKILL");
        }
        // 不跟随符号链接递归，避免目录环；其真实目标仍由本目录扫描覆盖。
        fingerprint.update(JSON.stringify([relative(directory, resource), resolved]));
      } else if (stat.isDirectory()) {
        await visit(resource);
      } else if (stat.isFile()) {
        // 忽略编辑器隐藏临时文件的修改，但隐藏路径的符号链接同样必须校验。
        if (name.startsWith(".")) continue;
        fingerprint.update(
          JSON.stringify([relative(directory, resource), stat.size, stat.mtimeMs]),
        );
      } else {
        throw new Error("UNSUPPORTED_RESOURCE_TYPE");
      }
    }
  }
  await visit(directory);
  return fingerprint.digest("hex");
}
