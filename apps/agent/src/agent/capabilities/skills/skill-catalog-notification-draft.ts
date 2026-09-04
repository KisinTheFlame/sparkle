import { renderServerStaticTemplate } from "@sparkle/kernel/runtime/read-static-text";
import type { NotificationDraft } from "../../runtime/root-agent/notification/notification-draft.js";
import type { SkillCatalogChange } from "./skill-catalog.js";
import { escapeContextText } from "../../runtime/context/escape-context-text.js";

export class SkillCatalogNotificationDraft implements NotificationDraft {
  public readonly sourceId = "skills:catalog";
  public readonly group = "Skills";
  public readonly displayName = "Skills";
  private readonly changes: SkillCatalogChange[];

  public constructor({ changes }: { changes: SkillCatalogChange[] }) {
    this.changes = changes;
  }

  public merge(previous: NotificationDraft): NotificationDraft {
    if (!(previous instanceof SkillCatalogNotificationDraft)) return this;
    const changes = new Map(previous.changes.map(change => [change.name, change]));
    for (const change of this.changes) changes.set(change.name, change);
    return new SkillCatalogNotificationDraft({ changes: [...changes.values()] });
  }

  public render(): string {
    return renderServerStaticTemplate(import.meta.url, "context/notifications/skill-catalog.hbs", {
      changes: this.changes.map(change => ({
        ...change,
        name: escapeContextText(change.name),
        description: change.description && escapeContextText(change.description),
        error: change.error && escapeContextText(change.error),
        added: change.kind === "added",
        modified: change.kind === "modified",
        removed: change.kind === "removed",
        invalid: change.kind === "invalid",
      })),
    }).trim();
  }
}
