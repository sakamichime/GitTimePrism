/*
 * GitTimePrism 后端核心入口文件
 * 
 * 此文件是整个 Rust 后端的核心，负责：
 * 1. 注册所有 Tauri 命令（供前端通过 invoke() 调用的函数）
 * 2. 注册 Tauri 插件（Shell、对话框、文件系统、日志等）
 * 3. 注册全局状态（如终端 PTY 管理器）
 * 4. 在应用启动时执行初始化逻辑
 * 
 * 前端通过 `import { invoke } from '@tauri-apps/api/core'` 调用
 * 此处注册的命令，例如 `invoke('check_git_installed')`。
 */

// 引入自定义的命令模块（前端可调用的函数）
pub mod commands;
// 引入自定义的工具模块
pub mod utils;
// 引入 Git CLI 封装模块（仓库管理、文件状态、分支、提交历史等）
pub mod git;
// 引入 askpass 凭证管理模块（Task 9.8：HTTPS 远程仓库认证凭证的内存级缓存）
pub mod askpass;

// ============================================================
// 阶段 10：仓库管理 + 文件监听扩展 + 状态持久化 + 头像（P2）
// ============================================================

// 引入仓库管理模块（Task 10.1：仓库发现/注册/忽略/子模块扫描/配置导入导出）
// 实现 ~/.gittimeprism/repos.json 的读写，递归搜索工作区下的 Git 仓库
pub mod repo_manager;
// 引入状态持久化模块（Task 10.3：仓库视图状态 + 全局状态 + Code Review 90 天过期清理）
// 实现 ~/.gittimeprism/state.json 的读写，保存列宽/分隔位置/显示选项/Code Review 等
pub mod state;
// 引入头像管理模块（Task 10.4：GitHub/GitLab/Gravatar 三源头像获取 + 14 天缓存）
// 实现 ~/.gittimeprism/avatars/ 目录的缓存管理，根据 remote 源类型选择头像获取策略
pub mod avatar;

/**
 * Tauri 应用主运行函数
 * 
 * 此函数配置并启动整个 Tauri 应用：
 * 1. 注册插件（Shell、对话框、文件系统、日志）
 * 2. 注册所有 IPC 命令
 * 3. 注册全局状态
 * 4. 设置应用启动回调
 * 5. 运行应用
 * 
 * #[cfg_attr(mobile, tauri::mobile_entry_point)] 属性标记表示
 * 此函数也是移动端的入口点
 */
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 注册 Tauri 插件（插件提供额外的系统功能）
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // 暂时不注册日志插件，避免沙箱环境下的文件写入权限问题
        // .plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())
        
        // 注册所有 IPC 命令（前端通过 invoke('命令名') 调用）
        .invoke_handler(tauri::generate_handler![
            // 系统命令
            commands::system::check_git_installed,
            commands::system::open_external_url,
            // 获取 Git 版本号（Task 11.4：状态栏增强）
            commands::system::get_git_version,
            // 终端命令
            commands::terminal::start_pty,
            commands::terminal::write_to_pty,
            commands::terminal::resize_pty,
            commands::terminal::kill_pty,
            // 仓库管理命令（第二阶段核心功能）
            commands::repo::open_repo,
            commands::repo::init_repo,
            commands::repo::clone_repo,
            commands::repo::get_repo_status,
            commands::repo::get_branches,
            commands::repo::get_commit_log,
            commands::repo::get_file_history,
            // 壁纸命令（读取图片为 base64 data URL）
            commands::wallpaper::read_image_as_data_url,
            // 暂存/提交命令
            commands::stage::stage_file,
            commands::stage::unstage_file,
            commands::stage::stage_all,
            commands::stage::commit_changes,
            // 文件差异对比命令
            commands::diff::get_workdir_diff,
            commands::diff::get_staged_diff,
            commands::diff::get_commit_diff,
            // 提交节点图命令
            commands::graph::get_commit_graph,
            // 分支切换命令
            commands::checkout::checkout_branch,
            commands::checkout::create_and_checkout,
            // 分支管理命令（与 gitgraph 项目对齐）
            // 重命名分支（git branch -m）
            commands::checkout::rename_branch,
            // 删除本地分支（git branch -d/-D）
            commands::checkout::delete_branch,
            // 删除远程分支（git push --delete + 兜底 git branch -d -r）
            commands::checkout::delete_remote_branch,
            // 检出到指定提交（detached HEAD）
            commands::checkout::checkout_commit,
            // 创建新分支（支持 -b/-f 和可选 checkout）
            commands::checkout::create_branch,
            // 撤销提交命令（git reset soft/mixed/hard）
            commands::reset::reset_commit,
            // 标签管理命令（获取标签列表、创建/删除/切换标签）
            commands::tag::get_tags,
            commands::tag::create_tag,
            commands::tag::delete_tag,
            commands::tag::checkout_tag,
            // 远程操作命令（git pull 拉取更新、git push 推送提交）
            commands::remote::pull_changes,
            commands::remote::push_changes,
            // 带选项的远程操作命令（与 gitgraph 项目对齐）
            // 带选项的 pull（支持 --squash / --no-ff / -S）
            commands::remote::pull_changes_with_options,
            // 带选项的 push（支持 --set-upstream / --force / --force-with-lease）
            commands::remote::push_changes_with_options,
            // 推送标签到远程仓库（git push <remote> <tag>）
            commands::remote::push_tag,
            // 文件内容获取命令（工作树、暂存区、HEAD 版本、指定提交版本）
            commands::file_content::get_worktree_file_content,
            commands::file_content::get_staged_file_content,
            commands::file_content::get_head_file_content,
            commands::file_content::get_file_content_at_commit,
            // 写入文件内容命令（Task 8.2：合并编辑器解决冲突后写回文件）
            commands::file_content::write_file_content,
            // 引用查询命令（与 gitgraph 项目对齐）
            // 获取仓库中的所有引用（heads/tags/remotes/HEAD）
            commands::refs::get_refs,
            // Stash 查询与操作命令（与 gitgraph 项目对齐）
            // 获取仓库中的所有 stash 记录
            commands::stash::get_stashes,
            // 应用指定 stash（保留 stash 记录，对应 git stash apply）
            commands::stash::apply_stash,
            // 弹出指定 stash（应用后删除，对应 git stash pop）
            commands::stash::pop_stash,
            // 删除指定 stash（不应用，对应 git stash drop）
            commands::stash::drop_stash,
            // 将当前未提交变更保存为 stash（对应 git stash push）
            commands::stash::push_stash,
            // 从 stash 创建新分支并切换过去（对应 git stash branch）
            commands::stash::branch_from_stash,
            // 提交详情查询命令（与 gitgraph 项目对齐）
            // 获取单个提交的完整详情（含 GPG 签名和文件变更）
            commands::commit_details::get_commit_details,
            // 提交对比命令（与 gitgraph 项目对齐）
            // 比较两个提交之间的文件差异
            commands::commit_compare::get_commit_comparison,
            // 带注解的提交节点图命令（与 gitgraph 项目对齐）
            // 返回 AnnotatedCommit 列表（含 heads/tags/remotes/stash 注解）
            commands::graph::get_annotated_commit_graph,
            // Fetch 命令（与 gitgraph 项目对齐）
            // 从远程仓库获取更新（git fetch），支持 --all / 指定 remote、--prune、--prune-tags
            commands::fetch::fetch_command,
            // 远程仓库管理命令（与 gitgraph 项目对齐）
            // 清理指定远程仓库的本地引用（git remote prune）
            commands::remote_mgmt::prune_remote,
            // 添加新的远程仓库（git remote add）
            commands::remote_mgmt::add_remote,
            // 删除现有远程仓库（git remote remove）
            commands::remote_mgmt::delete_remote,
            // 编辑远程仓库（重命名 + set-url + set-url --push）
            commands::remote_mgmt::edit_remote,
            // 将远程分支 fetch 到本地分支（git fetch remote branch:branch）
            commands::remote_mgmt::fetch_into_local_branch,
            // 合并命令（与 gitgraph 项目对齐）
            // 将指定对象合并到当前分支（支持 --squash / --no-ff / --no-commit / -S）
            commands::merge::merge,
            // 变基命令（与 gitgraph 项目对齐）
            // 将当前分支变基到指定对象之上（支持 --ignore-date / -S / 交互式）
            commands::rebase::rebase,
            // 拣选命令（与 gitgraph 项目对齐）
            // 将指定提交的变更拣选到当前分支（支持 --no-commit / -x / -S / -m）
            commands::cherry_pick::cherrypick,
            // 还原命令（与 gitgraph 项目对齐）
            // 创建反向提交来撤销指定提交的变更（支持 --no-edit / -S / -m）
            commands::revert::revert,
            // 丢弃提交命令（与 gitgraph 项目对齐）
            // 丢弃指定的提交（通过 git rebase --onto 实现，含拓扑可行性检查）
            commands::drop_commit::drop_commit,
            // 仓库配置查询命令（Task 7.1：与 gitgraph 项目对齐）
            // 获取仓库的完整配置信息（分支跟踪/远程仓库/用户身份/推送默认/差异工具）
            commands::config::get_config,
            // 设置 Git 配置项的值（在 local 或 global 层级）
            commands::config::set_config_value,
            // 删除 Git 配置项（在 local 或 global 层级）
            commands::config::unset_config_value,
            // 文件操作命令（Task 7.2：与 gitgraph 项目对齐）
            // 将单个文件恢复到指定提交的版本（git checkout {hash} -- {file}）
            commands::file_ops::reset_file_to_revision,
            // 清理未跟踪的文件（git clean -f[d]）
            commands::file_ops::clean_untracked_files,
            // 归档命令（Task 7.2：与 gitgraph 项目对齐）
            // 将仓库的某个引用打包为 tar/zip 归档文件
            commands::archive::archive,
            // 合并冲突检测命令（Task 8.1：与 gitgraph 项目对齐）
            // 检测仓库中存在合并冲突的文件列表（返回 ConflictFile 数组）
            // 用于 merge/pull/rebase 操作后检测冲突文件，前端据此打开合并编辑器
            commands::conflict::detect_conflicts,
            // Blame 查询命令（Task 8.3：与 gitgraph 项目对齐）
            // 获取文件每行的提交溯源信息（commit hash/author/email/date/line content）
            // 用于在文件右键菜单中选择"View Blame"时显示行级别的提交信息
            commands::blame::get_blame,
            // 子模块管理命令（Task 9.1：与 gitgraph 项目对齐）
            // 获取仓库中所有子模块列表（读取 .gitmodules + git submodule status）
            commands::submodule::list_submodules,
            // 添加新的子模块（git submodule add [-b branch] url path）
            commands::submodule::add_submodule,
            // 更新子模块（git submodule update [--init] [--recursive]）
            commands::submodule::update_submodules,
            // 删除子模块（git submodule deinit + git rm + 清理 .git/modules）
            commands::submodule::delete_submodule,
            // LFS 管理命令（Task 9.3：与 gitgraph 项目对齐）
            // 初始化 LFS（git lfs install）
            commands::lfs::lfs_install,
            // 添加 LFS 跟踪规则（git lfs track {pattern}）
            commands::lfs::lfs_track,
            // 移除 LFS 跟踪规则（git lfs untrack {pattern}）
            commands::lfs::lfs_untrack,
            // 获取 LFS 跟踪的文件类型列表（解析 .gitattributes）
            commands::lfs::lfs_list,
            // 获取 LFS 文件锁列表（git lfs locks --json）
            commands::lfs::lfs_locks,
            // 拉取 LFS 对象（git lfs pull）
            commands::lfs::lfs_pull,
            // 推送 LFS 对象（git lfs push --all origin）
            commands::lfs::lfs_push,
            // 标签详情查询命令（Task 9.5：与 gitgraph 项目对齐）
            // 获取标签的完整详情（含 GPG 签名信息，git for-each-ref + git verify-tag --raw）
            commands::tag_details::get_tag_details,
            // Difftool 命令（Task 9.6：与 gitgraph 项目对齐）
            // 打开目录级差异对比（git difftool --dir-diff [from] [to]）
            commands::difftool::open_dir_diff,
            // 文件编码命令（Task 9.7：文件编码支持）
            // 获取支持的文件编码列表（用于设置面板的文件编码下拉选择）
            commands::file_content::get_supported_encodings,
            // Askpass 凭证管理命令（Task 9.8：HTTPS 远程仓库认证）
            // 设置凭证到内存缓存（host + username + password）
            commands::askpass::set_credential,
            // 获取指定 host 的凭证
            commands::askpass::get_credential,
            // 清除凭证（指定 host 或全部清除）
            commands::askpass::clear_credential,
            // 检查是否已缓存指定 host 的凭证
            commands::askpass::has_credential,
            // 列出所有已缓存凭证的 host
            commands::askpass::list_credential_hosts,
            // 从 Git 远程 URL 中提取 host
            commands::askpass::extract_host_from_url,

            // ============================================================
            // 阶段 10 命令：仓库管理 + 文件监听 + 状态持久化 + 头像
            // ============================================================

            // 仓库管理命令（Task 10.1：与 gitgraph 项目对齐）
            // 递归搜索工作区下的所有 Git 仓库（识别含 .git 目录的文件夹）
            commands::repo_manager::discover_repos,
            // 注册仓库到 ~/.gittimeprism/repos.json（记录路径和上次打开时间）
            commands::repo_manager::register_repo,
            // 取消注册仓库（从 repos.json 中移除）
            commands::repo_manager::unregister_repo,
            // 忽略仓库（加入忽略列表，发现时不再返回）
            commands::repo_manager::ignore_repo,
            // 列出所有已注册仓库（按上次打开时间排序）
            commands::repo_manager::list_registered_repos,
            // 扫描仓库的子模块（git submodule status）
            commands::repo_manager::scan_submodules,
            // 导出仓库配置为 .gittimeprism.json 文件
            commands::repo_manager::export_config,
            // 从 .gittimeprism.json 文件导入配置
            commands::repo_manager::import_config,

            // 文件监听控制命令（Task 10.2：与 gitgraph 项目对齐）
            // 启动文件监听器（监听指定仓库目录的 .git 文件变化）
            commands::watcher::start_watcher,
            // 停止文件监听器（关闭仓库或切换仓库时调用）
            commands::watcher::stop_watcher,
            // 静音文件监听（Git 操作前调用，避免自身操作触发刷新）
            commands::watcher::mute_watcher,
            // 取消静音（Git 操作后调用，1.5 秒内的事件仍被忽略）
            commands::watcher::unmute_watcher,

            // 状态持久化命令（Task 10.3：与 gitgraph 项目对齐）
            // 获取指定仓库的状态（含 Code Review 90 天过期清理）
            commands::state::get_repo_state,
            // 保存指定仓库的状态（列宽/分隔位置/显示选项/Code Review 等）
            commands::state::save_repo_state,
            // 获取全局状态（主题/最近仓库列表/快捷键配置等）
            commands::state::get_global_state,
            // 保存全局状态
            commands::state::save_global_state,
            // 更新 Code Review 的 lastActive 时间戳（避免被 90 天过期清理）
            commands::state::touch_code_review,

            // 头像管理命令（Task 10.4：与 gitgraph 项目对齐）
            // 获取指定用户的头像（异步，带 14 天缓存，根据 remote 源类型选择获取策略）
            commands::avatar::get_avatar,
            // 清除所有头像缓存（用户在设置中点击"清除头像缓存"时调用）
            commands::avatar::clear_avatar_cache,
        ])
        
        // 注册终端 PTY 管理器为全局状态（所有命令都可以访问）
        .manage(commands::terminal::PtyManager::new())
        
        // 应用启动时执行的初始化逻辑
        .setup(|app| {
            // 记录启动信息到控制台
            eprintln!("[GitTimePrism] 应用启动完成");
            
            // 调用文件监听初始化（基础框架版本，暂不监听具体目录）
            utils::watcher::init_file_watcher(app.handle().clone())?;

            // Windows 平台：为透明窗口设置 DWM 扩展属性
            // 启用 DWM 组合效果，让窗口背景真正透明
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_decorations(false);
                    eprintln!("[GitTimePrism] Windows 透明窗口已配置");
                }
            }
            
            Ok(())
        })
        
        // 运行应用（加载配置文件中定义的资源）
        .run(tauri::generate_context!())
        .expect("启动 GitTimePrism 应用时发生错误");
}
