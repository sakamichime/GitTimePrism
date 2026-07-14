/*
 * Tauri IPC 命令模块入口
 * 
 * 此文件将不同功能的命令分组到子模块中：
 * - system：系统级命令（Git 检测、打开外部链接等）
 * - terminal：终端相关命令（PTY 创建、写入、调整大小等）
 * - wallpaper：壁纸相关命令（读取图片为 base64 data URL）
 * 
 * 每个 Tauri 命令使用 #[tauri::command] 属性标记，
 * 前端通过 `invoke('命令名', { 参数 })` 来调用。
 */

// 导出系统级命令模块（Git 检测、打开外部链接）
pub mod system;
// 导出终端命令模块（PTY 创建/写入/调整/终止）
pub mod terminal;
// 导出仓库管理命令模块（打开/克隆/初始化/状态/分支/提交历史）
pub mod repo;
// 导出壁纸命令模块（读取图片为 base64 data URL）
pub mod wallpaper;
// 导出暂存/提交命令模块（暂存/取消暂存/提交）
pub mod stage;
// 导出文件差异对比命令模块（工作区 diff、暂存区 diff、提交 diff）
pub mod diff;
// 导出提交节点图命令模块（git log --graph）
pub mod graph;
// 导出分支切换命令模块（git checkout）
pub mod checkout;
// 导出撤销提交命令模块（git reset soft/mixed/hard）
pub mod reset;
// 导出标签管理命令模块（获取标签列表、创建/删除/切换标签）
pub mod tag;
// 导出远程操作命令模块（git pull 拉取更新、git push 推送提交）
pub mod remote;
// 导出文件内容获取命令模块（工作树、暂存区、HEAD 版本文件内容）
pub mod file_content;
// 导出引用查询命令模块（与 gitgraph 项目对齐）
// 提供 get_refs 命令，获取仓库中的所有引用（heads/tags/remotes/HEAD）
pub mod refs;
// 导出 Stash 查询命令模块（与 gitgraph 项目对齐）
// 提供 get_stashes 命令，获取仓库中的所有 stash 记录
pub mod stash;
// 导出提交详情查询命令模块（与 gitgraph 项目对齐）
// 提供 get_commit_details 命令，获取单个提交的完整详情（含 GPG 签名和文件变更）
pub mod commit_details;
// 导出提交对比命令模块（与 gitgraph 项目对齐）
// 提供 get_commit_comparison 命令，比较两个提交之间的文件差异
pub mod commit_compare;
