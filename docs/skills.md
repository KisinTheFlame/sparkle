# Sparkle Skill

Skill 是可复用的工作方法文件包，不是独立 App 或新工具。雇主与 Sparkle 都可以创建、修改，不区分作者、不设审批或版本管理。

## 放在哪里

固定目录为运行 agent 的系统用户的 `~/sparkle/skills/`，首次启动会自动创建。它独立于 Terminal 当前目录，也不随 `initialCwd` 配置或 `cd` 改变。

```text
~/sparkle/skills/
└── report/
    ├── SKILL.md
    ├── references/    # 可选
    ├── scripts/       # 可选
    └── assets/        # 可选
```

`SKILL.md` 示例：

```markdown
---
name: report
description: 汇总指定时间范围的工作成果、未完成项与风险，生成工作报告。
---

# 工作报告

1. 确定报告的时间范围与接收对象。
2. 查证成果和状态，区分事实与推断。
3. 先给结论，再列未完成项、风险和需要雇主决定的事项。
```

入口必须存在，YAML frontmatter 必须可解析；`name` 是与目录名一致的字符串，`description` 是非空字符串。其他字段不参与选择控制，`disable-model-invocation` 不限制 Sparkle 自主采用方法。没有数量、description 长度、文件大小或目录总量的产品级限制。

## 如何生效

- 启动、上下文 reset、自动或手动压缩成功后：完整名称与描述目录进入 system prompt，并冻结到下一次重建。
- 运行中新增、修改或删除：文件监听短窗合并变化，经现有通知中心向 Sparkle 追加 user message；不重写 system prompt，也不打断正在执行的任务。
- 需要使用时：Sparkle 切到 terminal，通过 Bash 读取 `SKILL.md`，按入口路由再读取资源或运行脚本。目录监听不会执行脚本，也不会将正文自动注入上下文。
- 无效包：排除出目录并通知原因；修复后重新进入目录。同一无效状态不反复通知。
- 不跟踪“当前使用的 Skill”，不在压缩后强制重读，不增加专用摘要提示或 system reminder。

## 维护约定

同类工作的方法稳定、发现已有方法错误或缺口、或雇主明确要求时，Sparkle 可以沉淀 Skill。方法放 Skill；事实、经历与结论放工作笔记。写入使用同目录隐藏临时文件，完成后原子替换正式文件，避免监听器读到半份内容。

包内资源保持在该 Skill 目录内，不嵌入凭据或敏感业务数据。目录发现会拒绝 Skill 目录符号链接、逃逸包目录的资源符号链接及特殊文件；Bash 仍是既有执行能力，这些检查不是新的 shell 沙箱。资源路径与外部操作授权仍由工作指令约束。

Skill 可以引用其他 Skill，循环与冲突由 Sparkle 按提示处理；不建设依赖引擎。系统规则和雇主当前指令优先，Skill 不授予额外权限。
