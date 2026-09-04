/** 将文件元数据作为伪 XML 标签中的文本呈现，而不是上下文结构。 */
export function escapeContextText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
