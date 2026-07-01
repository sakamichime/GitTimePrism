## Agent skills

### Issue tracker

Issues are tracked on GitHub (no external PRs as triage surface). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles mapped to GitHub labels (default names). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (one `CONTEXT.md` + `docs/adr/` at repo root). See `docs/agents/domain.md`.

## Project rules

### 代码开发规范
本项目采用Tauri（Rust 后端 + JavaScript TypeScript前端）语言开发，代码规范如下：
编写代码时必须写注释，注释要中文，注释要详细，详细到每一个函数、类、变量等都是干什么的以及编程的代码逻辑注释都必须要写清楚，让我这个不会编程的人也能看得懂
在任务完成时还要更新项目目录结构.md文件。
编写代码时必须使用Tauri（Rust 后端 + JavaScript TypeScript前端）语言的语法，不能使用其他语言的语法。

提交git时必须用中文写提交信息，标题栏也要中文

### Git 提交规范

- 提交信息使用中文
- 标题也使用中文
