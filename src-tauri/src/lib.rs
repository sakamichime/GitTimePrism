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
            // 文件内容获取命令（工作树、暂存区、HEAD 版本、指定提交版本）
            commands::file_content::get_worktree_file_content,
            commands::file_content::get_staged_file_content,
            commands::file_content::get_head_file_content,
            commands::file_content::get_file_content_at_commit,
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
