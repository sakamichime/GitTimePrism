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
