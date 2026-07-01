/*
 * 系统级命令模块
 * 
 * 包含 Git 安装检测和打开外部链接等功能。
 * 这些命令是应用启动后最先被前端调用的，
 * 用于判断系统环境是否满足使用条件。
 * 
 * 前端调用方式：
 * - invoke('check_git_installed') → 返回 GitCheckResult
 * - invoke('open_external_url', { url: 'https://...' })
 */

use tauri::command;
use tauri_plugin_shell::ShellExt; // 引入 ShellExt trait 以使用 app.shell() 方法
use std::process::Command;

/**
 * Git 检测结果的数据结构
 * 
 * 此结构体通过 serde 序列化后传递给前端 JavaScript。
 * 前端通过 invoke('check_git_installed') 的返回值获取此数据。
 */
#[derive(serde::Serialize, Clone)]
pub struct GitCheckResult {
    /// Git 是否已在系统中安装
    /// true 表示已安装，false 表示未安装或不可用
    pub installed: bool,
    /// Git 的版本号字符串
    /// 格式如 "2.43.0.windows.1"（来自 `git --version` 输出）
    pub version: String,
    /// Git 可执行文件的完整路径
    /// 例如 "C:\Program Files\Git\cmd\git.exe"
    pub path: String,
}

/**
 * 检测系统中是否已安装 Git
 * 
 * 通过调用 `git --version` 命令来判断 Git 是否可用。
 * 在 Windows 上使用 CREATE_NO_WINDOW 标志防止弹出控制台黑窗口。
 * 
 * 前端调用方式：
 * ```javascript
 * const result = await invoke('check_git_installed');
 * console.log(result.installed, result.version);
 * ```
 * 
 * 返回值：
 * - Ok(GitCheckResult) - 检测成功，包含安装状态和版本信息
 * - Err(String) - 检测过程中发生意外错误
 */
#[command]
pub fn check_git_installed() -> Result<GitCheckResult, String> {
    // 创建 git 命令执行器
    let mut cmd = Command::new("git");
    // 添加 --version 参数来获取 Git 版本信息
    cmd.arg("--version");

    // Windows 平台特殊处理：隐藏控制台窗口
    // 如果不加此标志，每次执行命令都会弹出黑色控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW 常量值
        // 0x08000000 = 创建进程时不显示控制台窗口
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行命令并获取输出结果
    match cmd.output() {
        Ok(output) => {
            // 将命令的标准输出转换为字符串，并去除首尾空白字符
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

            if output.status.success() {
                // 命令执行成功（退出码为 0），说明 Git 已安装
                // git --version 的输出格式为 "git version 2.43.0.windows.1"
                // 需要去掉 "git version " 前缀来提取纯版本号
                let version = stdout
                    .strip_prefix("git version ")
                    .unwrap_or(&stdout)
                    .to_string();

                // 尝试获取 git 可执行文件的完整路径
                let git_path = get_git_path().unwrap_or_else(|| "git".to_string());

                // 返回已安装的结果
                Ok(GitCheckResult {
                    installed: true,
                    version,
                    path: git_path,
                })
            } else {
                // 命令执行失败（退出码非 0），Git 可能已损坏
                Ok(GitCheckResult {
                    installed: false,
                    version: String::new(),
                    path: String::new(),
                })
            }
        }
        Err(_) => {
            // 无法执行命令，说明 git 不在系统 PATH 中或根本未安装
            // Windows 上通常表现为 "找不到指定的文件" 错误
            Ok(GitCheckResult {
                installed: false,
                version: String::new(),
                path: String::new(),
            })
        }
    }
}

/**
 * 获取 git 可执行文件的完整路径
 * 
 * 通过系统的 `where` 命令（Windows）或 `which` 命令（Linux/macOS）
 * 来查找 git 的安装位置。
 * 
 * 返回值：
 * - Some(String) - 找到了 git 的路径
 * - None - 未找到
 */
fn get_git_path() -> Option<String> {
    // 根据操作系统选择不同的命令
    // Windows 使用 `where`，Unix 系统使用 `which`
    let which_cmd = if cfg!(target_os = "windows") { "where" } else { "which" };

    let mut cmd = Command::new(which_cmd);
    cmd.arg("git");

    // Windows 上同样需要隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行命令
    if let Ok(output) = cmd.output() {
        if output.status.success() {
            // 命令成功执行，取第一行结果作为路径
            let path = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            
            // 如果路径非空，返回它
            if !path.is_empty() {
                return Some(path);
            }
        }
    }
    // 未找到 git 路径
    None
}

/**
 * 打开外部 URL（在系统默认浏览器中打开）
 * 
 * 使用 Tauri Shell 插件的 open 功能来打开外部链接。
 * 主要用于打开 Git 官网下载页面。
 * 
 * 前端调用方式：
 * ```javascript
 * await invoke('open_external_url', { url: 'https://git-scm.com/download/win' });
 * ```
 * 
 * 参数：
 * - app: Tauri 应用句柄，用于调用 Shell 插件功能
 * - url: 要打开的外部 URL 字符串
 */
#[command]
pub fn open_external_url(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // 使用 Tauri Shell 插件打开 URL
    // open() 方法会在系统默认浏览器中打开指定 URL
    // 第二个参数为 None 表示使用系统默认程序打开
    // 注意：此 API 在 Tauri 2 中已标记为 deprecated，推荐使用 tauri-plugin-opener
    app.shell()
        .open(url, None)
        .map_err(|e| format!("打开外部链接失败: {}", e))
}
