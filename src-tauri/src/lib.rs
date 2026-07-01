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
        // 注册日志插件：设置日志级别为 Info，输出到 stdout
        // .build() 返回 TauriPlugin，直接传给 .plugin() 即可
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        
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
        ])
        
        // 注册终端 PTY 管理器为全局状态（所有命令都可以访问）
        .manage(commands::terminal::PtyManager::new())
        
        // 应用启动时执行的初始化逻辑
        .setup(|app| {
            // 记录启动日志（需要先注册日志插件才能使用 log::info!）
            log::info!("GitTimePrism 应用启动完成");
            
            // 调用文件监听初始化（基础框架版本，暂不监听具体目录）
            // app.handle() 返回 &AppHandle，但 init_file_watcher 需要 AppHandle（所有权）
            // 所以使用 clone() 获取一个独立的 AppHandle 副本
            utils::watcher::init_file_watcher(app.handle().clone())?;
            
            Ok(())
        })
        
        // 运行应用（加载配置文件中定义的资源）
        // 使用 match 而非 expect，在启动失败时输出错误信息而非直接 panic
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("[GitTimePrism] 应用启动失败: {}", e);
            // 在某些环境（如沙箱）下，log 插件可能因权限不足而初始化失败
            // 此时尝试不使用 log 插件重新启动
            eprintln!("[GitTimePrism] 尝试跳过日志插件重新启动...");
            
            // 重新构建不带日志插件的 Tauri 应用
            tauri::Builder::default()
                .plugin(tauri_plugin_shell::init())
                .plugin(tauri_plugin_dialog::init())
                .plugin(tauri_plugin_fs::init())
                .invoke_handler(tauri::generate_handler![
                    commands::system::check_git_installed,
                    commands::system::open_external_url,
                    commands::terminal::start_pty,
                    commands::terminal::write_to_pty,
                    commands::terminal::resize_pty,
                    commands::terminal::kill_pty,
                ])
                .manage(commands::terminal::PtyManager::new())
                .setup(|app| {
                    eprintln!("[GitTimePrism] 应用启动完成（无日志功能）");
                    let _ = utils::watcher::init_file_watcher(app.handle().clone());
                    Ok(())
                })
                .run(tauri::generate_context!())
                .expect("启动 GitTimePrism 应用时发生错误（无日志模式）");
        })
}
