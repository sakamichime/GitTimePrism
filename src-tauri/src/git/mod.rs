/*
 * Git 操作模块入口
 * 
 * 此模块是整个 Git 功能的核心，封装了所有与 Git 仓库相关的操作。
 * 前端通过 Tauri IPC 命令调用 commands/repo.rs 中的命令，
 * 命令层再调用此模块中各子模块的函数来完成实际操作。
 * 
 * 模块结构说明：
 * - commands: 通用 Git 命令执行器（底层工具，被其他模块复用）
 *             提供统一的 run_git 函数，自动处理 --no-pager 和 Windows 窗口隐藏
 * - repo:     仓库管理（打开仓库、初始化仓库、克隆仓库）
 *             负责获取仓库基本信息（当前分支、HEAD 提交等）
 * - status:   仓库状态查询（解析 git status --porcelain=v2 输出）
 *             将 Git 的状态信息解析为前端可用的结构化数据
 * - branch:   分支管理（获取本地和远程分支列表）
 *             解析 git branch -vv 和 git branch -r 的输出
 * - log:      提交历史查询（获取提交记录列表）
 *             解析 git log --pretty=format 的输出
 * 
 * 依赖关系：
 * repo → commands（使用 run_git 执行 git 命令）
 * status → commands（使用 run_git 执行 git 命令）
 * branch → commands（使用 run_git 执行 git 命令）
 * log → commands（使用 run_git 执行 git 命令）
 */

// 通用 Git 命令执行器模块
// 提供统一的 git 命令执行接口，自动处理跨平台兼容性
pub mod commands;

// 仓库管理模块
// 负责打开/初始化/克隆 Git 仓库，以及获取仓库基本信息
pub mod repo;

// 仓库状态查询模块
// 解析 git status 的输出，返回结构化的文件状态信息
pub mod status;

// 分支管理模块
// 获取本地和远程分支列表，包含分支追踪信息
pub mod branch;

// 提交历史查询模块
// 获取提交日志记录，包含作者、日期、消息等信息
pub mod log;

// 暂存/提交操作模块
// 提供 git add、git reset、git commit 等写入操作
pub mod stage;

// 文件差异对比模块
// 解析 git diff 和 git show 的输出，返回结构化的 diff 信息
pub mod diff;

// 提交节点图模块
// 解析 git log --graph 的输出，返回带图形线的提交节点列表
pub mod graph;

// 分支切换模块
// 提供 git checkout 分支切换操作
pub mod checkout;

// 撤销提交模块
// 提供 git reset 操作（soft/mixed/hard 三种模式）
pub mod reset;

// 标签管理模块
// 提供 Git 标签的增删查切换操作（轻量标签与附注标签）
pub mod tag;

// 拉取模块
// 提供 git pull 远程更新功能
pub mod pull;

// 推送模块
// 提供 git push 推送本地提交功能
pub mod push;

// 文件内容获取模块
// 提供获取工作树、暂存区、HEAD 版本文件内容的功能
pub mod file_content;

// 引用查询模块（与 gitgraph 项目对齐）
// 获取仓库中的所有引用（heads/tags/remotes/HEAD）
pub mod refs;

// Stash 查询模块（与 gitgraph 项目对齐）
// 获取仓库中的所有 stash 记录
pub mod stash;

// 提交详情查询模块（与 gitgraph 项目对齐）
// 获取单个提交的完整详情（含 GPG 签名和文件变更）
pub mod commit_details;

// 提交对比模块（与 gitgraph 项目对齐）
// 比较两个提交之间的文件差异
pub mod commit_compare;

// Fetch 模块（与 gitgraph 项目对齐）
// 从远程仓库获取更新（git fetch），支持 --all / 指定 remote、--prune、--prune-tags
// 与 pull 模块的区别：fetch 只下载不合并，pull = fetch + merge
pub mod fetch;

// 远程仓库管理模块（与 gitgraph 项目对齐）
// 提供远程仓库的增删改查操作：prune、add、delete、edit、fetch into local branch
// 与 pull/push/fetch 模块的区别：此模块专注于"远程仓库本身的管理"，而非"内容同步"
pub mod remote_mgmt;

// 仓库配置查询模块（Task 7.1：与 gitgraph 项目对齐）
// 读取 Git 仓库的配置信息（分支跟踪/远程仓库/用户身份/推送默认/差异工具）
// 执行 git config --list -z --includes [--local/--global] 并解析为 RepoConfig 结构
pub mod config;

// 仓库配置写入模块（Task 7.1：与 gitgraph 项目对齐）
// 修改 Git 仓库的配置项：set_config_value / unset_config_value
// 执行 git config --{local/global} {key} {value} 或 git config --{local/global} --unset-all {key}
pub mod set_config;

// 文件操作模块（Task 7.2：与 gitgraph 项目对齐）
// 提供工作区文件操作：reset_file_to_revision（恢复文件到指定版本）、clean_untracked_files（清理未跟踪文件）
pub mod file_ops;

// 归档模块（Task 7.2：与 gitgraph 项目对齐）
// 将仓库的某个引用（提交/分支/标签）打包为 tar/zip 归档文件
// 执行 git archive --format={tar/zip} -o {out} {ref}
pub mod archive;

// 合并操作模块（与 gitgraph 项目对齐）
// 提供 git merge 合并操作，支持 --squash / --no-ff / --no-commit / -S 等选项
// squash 合并且未指定 --no-commit 时会自动创建提交
pub mod merge;

// 变基操作模块（与 gitgraph 项目对齐）
// 提供 git rebase 变基操作，支持 --ignore-date / -S / 交互式变基
// 交互式变基由前端在 PTY 终端中执行
pub mod rebase;

// 拣选操作模块（与 gitgraph 项目对齐）
// 提供 git cherry-pick 拣选操作，支持 --no-commit / -x / -S / -m 选项
// 用于将指定提交的变更应用到当前分支
pub mod cherry_pick;

// 还原操作模块（与 gitgraph 项目对齐）
// 提供 git revert 还原操作，支持 --no-edit / -S / -m 选项
// 通过创建反向提交来撤销指定提交的变更（不改写历史）
pub mod revert;

// 丢弃提交操作模块（与 gitgraph 项目对齐）
// 通过 git rebase --onto 实现丢弃提交功能
// 含拓扑可行性检查（不能丢弃 HEAD 的祖先提交）
pub mod drop_commit;

// Blame 查询模块（Task 8.3：与 gitgraph 项目对齐）
// 执行 git blame --porcelain 命令，解析行级别的提交信息
// 返回 BlameLine 列表（含 commit hash/author/email/date/line content）
// 用于前端显示文件每行的提交溯源信息
pub mod blame;

// 子模块管理模块（Task 9.1：与 gitgraph 项目对齐）
// 执行 git submodule status / add / update / deinit 命令
// 返回 SubmoduleInfo 列表（含 path/url/branch/current_commit/status/is_initialized）
// 用于前端子模块管理器组件显示和操作子模块
pub mod submodule;

// LFS（Large File Storage）管理模块（Task 9.3：与 gitgraph 项目对齐）
// 执行 git lfs install / track / untrack / locks / pull / push 命令
// 返回 LfsPattern 列表和 LfsLock 列表
// 用于前端 LFS 管理器组件显示和操作 LFS 跟踪规则
pub mod lfs;

// 标签详情查询模块（Task 9.5：与 gitgraph 项目对齐）
// 执行 git for-each-ref + git verify-tag --raw 命令
// 返回 TagDetails（含 type/object/tagger/date/message/signature）
// 复用 commit_details.rs 中的 CommitSignature 和 SignatureStatus 结构体
// 用于前端点击标签时显示标签的详细信息（含 GPG 签名状态）
pub mod tag_details;

// Difftool 模块（Task 9.6：与 gitgraph 项目对齐）
// 执行 git difftool --dir-diff 命令，启动外部差异工具对比目录差异
// 用于前端文件右键菜单"Open in Diff Tool"选项
pub mod difftool;
