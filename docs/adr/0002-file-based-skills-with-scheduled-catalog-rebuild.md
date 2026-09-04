# Skill 采用文件包与计划性目录重建

Sparkle 的 Skill 是 `~/sparkle/skills/<name>/` 下的普通文件包，以带 `name` 和 `description` frontmatter 的 `SKILL.md` 为入口，可附带 `references/`、`scripts/` 和 `assets/`。Sparkle 通过既有 Terminal App 的 Bash 读取、创建和修改 Skill，不引入独立 Skill Runtime、动态工具或作者与审批模型；Sparkle 可自主选择任意有效 Skill，Skill 不因携带脚本而获得新权限。

为保持 prompt cache 的稳定前缀，会话中 Skill 目录变化只经文件监听合并为一条 user message 追加到尾部，不就地改写 system prompt。完整的 Skill 名称与描述目录只在进程启动、上下文 reset，以及自动或手动压缩成功后重建进 system prompt，随后再作为新的稳定前缀。Skill 正文与附带资源始终按需经 Bash 读取，不进 system prompt。无效包不进目录并通知 Sparkle；写入采用临时文件原子替换，资源不得逃逸 Skill 目录。

## 一期边界

读取、使用、沉淀与组合 Skill 由 prompt 引导 Sparkle 通过 Bash 完成。可在同类工作的方法稳定、发现现有 Skill 的错误或缺口、或雇主明确要求时沉淀；不区分文件作者，Sparkle 可以修改任何 Skill，不设审批流程，也不以 `disable-model-invocation` 限制自主使用。Skill 可以引用其他 Skill；循环与冲突由 Sparkle 按提示处理，不建设依赖引擎。system prompt 与雇主当前指令优先于 Skill，无法安全解决的冲突向雇主确认。

文件监听只负责目录变化通知，不跟踪当前任务正在使用哪个 Skill，不因修改或删除而自动中断任务、强制重读或增加执行门禁。压缩后不要求专门恢复或重读 Skill，不为此修改摘要提示或 system reminder；仅保留已决定的 system prompt 目录快照重建。

不增加 Skill 数量、description 长度、入口文件大小或目录总量的产品级限制。有效性检查保持最小范围：入口文件存在、frontmatter 可解析、`name` 与 `description` 齐全、目录名与 `name` 一致；不做版本锁定、作者权限或独立执行状态管理。
