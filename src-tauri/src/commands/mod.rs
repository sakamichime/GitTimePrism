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
// 导出 Fetch 命令模块（与 gitgraph 项目对齐）
// 提供 fetch_command 命令，从远程仓库获取更新（git fetch）
pub mod fetch;
// 导出远程仓库管理命令模块（与 gitgraph 项目对齐）
// 提供 prune_remote / add_remote / delete_remote / edit_remote / fetch_into_local_branch 命令
pub mod remote_mgmt;
// 导出仓库配置管理命令模块（Task 7.1：与 gitgraph 项目对齐）
// 提供 get_config / set_config_value / unset_config_value 命令
// 读取和修改 Git 仓库的配置（分支跟踪/远程仓库/用户身份/推送默认/差异工具）
pub mod config;
// 导出文件操作命令模块（Task 7.2：与 gitgraph 项目对齐）
// 提供 reset_file_to_revision / clean_untracked_files 命令
// 恢复文件到指定版本、清理未跟踪文件
pub mod file_ops;
// 导出归档命令模块（Task 7.2：与 gitgraph 项目对齐）
// 提供 archive 命令，将仓库的某个引用打包为 tar/zip 归档文件
pub mod archive;
// 导出合并命令模块（与 gitgraph 项目对齐）
// 提供 merge 命令，将指定对象合并到当前分支
pub mod merge;
// 导出变基命令模块（与 gitgraph 项目对齐）
// 提供 rebase 命令，将当前分支变基到指定对象之上
pub mod rebase;
// 导出拣选命令模块（与 gitgraph 项目对齐）
// 提供 cherrypick 命令，将指定提交的变更拣选到当前分支
pub mod cherry_pick;
// 导出还原命令模块（与 gitgraph 项目对齐）
// 提供 revert 命令，创建反向提交来撤销指定提交的变更
pub mod revert;
// 导出丢弃提交命令模块（与 gitgraph 项目对齐）
// 提供 drop_commit 命令，丢弃指定的提交（通过 git rebase --onto 实现）
pub mod drop_commit;
// 导出合并冲突检测命令模块（Task 8.1：与 gitgraph 项目对齐）
// 提供 detect_conflicts 命令，检测仓库中存在合并冲突的文件列表
// 用于 merge/pull/rebase 操作后检测冲突文件，前端据此打开合并编辑器
pub mod conflict;
// 导出 Blame 查询命令模块（Task 8.3：与 gitgraph 项目对齐）
// 提供 get_blame 命令，获取文件每行的提交信息（commit hash/author/date）
// 用于在文件右键菜单中选择"View Blame"时显示行级别的提交溯源信息
pub mod blame;

// 导出子模块管理命令模块（Task 9.1：与 gitgraph 项目对齐）
// 提供 list_submodules / add_submodule / update_submodules / delete_submodule 命令
// 用于前端子模块管理器组件显示和操作 Git 子模块
pub mod submodule;

// 导出 LFS 管理命令模块（Task 9.3：与 gitgraph 项目对齐）
// 提供 lfs_install / lfs_track / lfs_untrack / lfs_list / lfs_locks / lfs_pull / lfs_push 命令
// 用于前端 LFS 管理器组件显示和操作 Git LFS 跟踪规则
pub mod lfs;

// 导出标签详情查询命令模块（Task 9.5：与 gitgraph 项目对齐）
// 提供 get_tag_details 命令，获取标签的完整详情（含 GPG 签名信息）
// 用于前端点击标签时显示标签的详细信息（含签名状态）
pub mod tag_details;

// 导出 Difftool 命令模块（Task 9.6：与 gitgraph 项目对齐）
// 提供 open_dir_diff 命令，启动外部差异工具对比目录差异
// 用于前端文件右键菜单"Open in Diff Tool"选项
pub mod difftool;

// 导出 Askpass 凭证管理命令模块（Task 9.8：与 gitgraph 项目对齐）
// 提供 set_credential / get_credential / clear_credential / has_credential /
// list_credential_hosts / extract_host_from_url 命令
// 用于前端管理访问需要认证的远程仓库的凭证（内存级缓存，不持久化）
pub mod askpass;

// ============================================================
// 阶段 10：仓库管理 + 文件监听扩展 + 状态持久化 + 头像（P2）
// ============================================================

// 导出仓库管理命令模块（Task 10.1：与 gitgraph 项目对齐）
// 提供 discover_repos / register_repo / unregister_repo / ignore_repo /
// list_registered_repos / scan_submodules / export_config / import_config 命令
// 用于前端仓库管理器组件发现、注册、忽略 Git 仓库，以及导入导出仓库配置
pub mod repo_manager;

// 导出文件监听控制命令模块（Task 10.2：与 gitgraph 项目对齐）
// 提供 start_watcher / stop_watcher / mute_watcher / unmute_watcher 命令
// 用于前端在打开仓库时启动文件监听，Git 操作前后 mute/unmute 避免循环刷新
pub mod watcher;

// 导出状态持久化命令模块（Task 10.3：与 gitgraph 项目对齐）
// 提供 get_repo_state / save_repo_state / get_global_state / save_global_state /
// touch_code_review 命令
// 用于前端持久化仓库视图状态（列宽/分隔位置/显示选项/Code Review 等）到磁盘
pub mod state;

// 导出头像管理命令模块（Task 10.4：与 gitgraph 项目对齐）
// 提供 get_avatar / clear_avatar_cache 命令
// 用于前端在节点图中显示作者头像（GitHub/GitLab/Gravatar 三源获取，14 天缓存刷新）
pub mod avatar;

// 导出历史文件清理命令模块（Task 2：历史文件清理功能后端命令）
// 提供 scan_history_files / check_filter_repo_available /
// purge_files_from_history / get_repo_size 四个命令
// 用于前端清理历史对话框：扫描大文件、检测 filter-repo、清除历史文件、查询仓库大小
pub mod purge;

