# Sparkle

_An agent that works like a colleague._

[简体中文](./README.zh-CN.md)

Sparkle is not a chatbot. She is an **AI employee who is always on the clock**.

Most "AI assistants" wait. You type, they answer, they go back to sleep. Sparkle doesn't wait for you. She wakes up when a feed publishes something worth knowing, when a to-do comes due, when a timer fires — and sometimes, when things go quiet, she wakes up on her own to see what's worth doing. Answering questions is part of her job; it is not what she is. No one writes "answers questions" as their entire job description.

The whole project is one sentence:

> **Agent as a colleague.**

## How she works

- **She takes tasks, delivers, and reports.** What you hand her, she remembers, follows up on, and closes out — and if she can't do it or botched it, she says so.
- **She has initiative.** When she spots something worth doing, she can just do it, or pitch it to her employer first — no instruction required.
- **She reads the feeds.** She watches the news sources and filters out what you'd actually want to know.
- **She browses the real web.** Hand her a link or a question and she opens a browser and goes to find out.
- **She runs commands, keeps a to-do book, checks the map** — and her idle time is her own to schedule: reviewing to-dos, following up on loose ends, or doing whatever she judges worthwhile.

None of these are features bolted onto a chatbot. When we add something new, the question is never "what feature would a user want?" — it's **"what is a new capability for this employee?"**

## How she runs

Picture Sparkle's workspace as a phone, and Sparkle-the-agent as the person holding it.

- **Every input is a peer event.** A message, a news article, a timer, a system signal — all equal citizens. There is no privileged "user message"; the messaging channel is just one app among many.
- **Background signals arrive as banners.** A single notification center batches them and wakes her. The conversation she is actively looking at behaves like the screen that's already open — new messages flow straight in, no banner needed.
- **Her abilities are apps she can walk into.** The news reader, the browser, the terminal, the to-do book, the map. She enters one, does her thing, walks back out.

There is also a small admin console: a quiet window into her working state — what she has recently been thinking, doing, and seeing.

> Her long-term memory is heading toward self-maintained work notes. For now she keeps a raw ledger of what has been said, and remembers within a context.

## Running her

Sparkle is a full-stack TypeScript monorepo (`pnpm`). Under the hood she is not one program but a handful of cooperating processes — the agent herself, plus a browser, an object store, an LLM gateway, and so on — all supervised by PM2. You bring the whole thing up with a single command.

You'll need:

- Node.js and `pnpm`, and a toolchain that can compile native modules (`better-sqlite3`) — the database is a plain in-process SQLite file, so there's no external database to run.
- An LLM you can log into.

Then:

```bash
# 1. Configuration
#    config.yaml (non-secret, already in the repo) — edit in place.
#    Copy the secret template and fill in your keys:
cp config.secret.yaml.example config.secret.yaml

# 2. Install and bring her up (build → migrate → start under PM2)
pnpm install
pnpm app:deploy
```

That's the short path. She'll be on the clock when it finishes.
