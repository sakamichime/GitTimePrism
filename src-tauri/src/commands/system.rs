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
use tauri_plugin_opener::OpenerExt; // 引入 OpenerExt trait 以使用 app.opener() 方法（替代已废弃的 shell.open）
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
    // 使用 Tauri Opener 插件打开 URL（替代已废弃的 shell.open）
    // opener() 方法会在系统默认浏览器中打开指定 URL
    // 比 shell.open() 更轻量、更安全，是 Tauri 2 推荐的方式
    app.opener()
        .open_url(&url, None::<String>)
        .map_err(|e| format!("打开外部链接失败: {}", e))
}

/**
 * 获取 Git 版本号（Task 11.4：状态栏增强）
 *
 * 调用 git::commands::git_version() 函数获取系统安装的 Git 版本号。
 * 用于在状态栏显示当前 Git 版本。
 *
 * 前端调用方式：
 * ```javascript
 * const version = await invoke('get_git_version');
 * console.log('Git 版本:', version);  // 如 "2.45.0"
 * ```
 *
 * 返回值：
 * - Ok(String) - Git 版本号字符串（如 "2.45.0"）
 * - Err(String) - 获取失败（如 Git 未安装或输出格式异常）
 */
#[command]
pub fn get_git_version() -> Result<String, String> {
    // 调用 git::commands 模块中的 git_version 函数
    // 该函数执行 `git --version` 并解析输出
    crate::git::commands::git_version()
        .map_err(|e| format!("获取 Git 版本失败: {}", e))
}

/**
 * Python 环境检测结果的数据结构（Task 1：后端新增 python 检测命令）
 *
 * 此结构体通过 serde 序列化后传递给前端 JavaScript。
 * 前端通过 invoke('check_python_installed') 的返回值获取此数据。
 *
 * 与 GitCheckResult 不同的是：
 * - version 字段使用 Option<String>，因为未安装时为 None（更符合语义）
 * - 不需要 path 字段（Python 检测不关心可执行文件路径）
 */
#[derive(Debug, Clone, serde::Serialize)]
pub struct PythonCheckResult {
    /// Python 是否已在系统中安装
    /// true 表示已安装，false 表示未安装或不可用
    pub installed: bool,
    /// Python 的版本号字符串
    /// 格式如 "3.12.0"（来自 `python --version` 输出，已去除 "Python " 前缀）
    /// 未安装时为 None
    pub version: Option<String>,
}

/**
 * 检测系统中是否已安装 Python（Task 1：后端新增 python 检测命令）
 *
 * 实现逻辑：
 * 1. 先尝试执行 `python --version`，如果成功则解析版本号返回
 * 2. 若 `python` 命令不存在（Windows 上常见仅 `python3` 可用的情况），
 *    则回退尝试 `python3 --version`
 * 3. 解析输出获取版本号（如 "Python 3.12.0" → "3.12.0"）
 * 4. 两个命令都失败时，返回 { installed: false, version: None }
 *
 * 在 Windows 上使用 CREATE_NO_WINDOW 标志防止弹出控制台黑窗口。
 *
 * 前端调用方式：
 * ```javascript
 * const result = await invoke('check_python_installed');
 * console.log(result.installed, result.version);
 * ```
 *
 * 返回值：
 * - Ok(PythonCheckResult) - 检测成功，包含安装状态和版本信息
 * - Err(String) - 检测过程中发生意外错误
 */
#[command]
pub fn check_python_installed() -> Result<PythonCheckResult, String> {
    // 第一步：尝试执行 `python --version` 命令
    // Windows 上通常使用 `python`，Linux/macOS 上也可能存在 `python` 软链接
    if let Some(version) = try_python_version("python") {
        // 成功获取版本号，说明 python 命令可用
        return Ok(PythonCheckResult {
            installed: true,
            version: Some(version),
        });
    }

    // 第二步：python 命令失败，回退尝试 `python3 --version`
    // 在某些 Linux 发行版和 macOS 上，python3 才是正确的命令名
    if let Some(version) = try_python_version("python3") {
        return Ok(PythonCheckResult {
            installed: true,
            version: Some(version),
        });
    }

    // 两个命令都失败，说明系统未安装 Python 或不在 PATH 中
    Ok(PythonCheckResult {
        installed: false,
        version: None,
    })
}

/**
 * 尝试执行指定命令名获取 Python 版本号（Task 1 辅助函数）
 *
 * 此函数为 check_python_installed 的内部辅助函数，
 * 封装了"执行 python/python3 --version 并解析输出"的逻辑，
 * 避免在主函数中重复编写两遍几乎相同的代码。
 *
 * 参数：
 * - cmd_name: 要尝试的命令名，如 "python" 或 "python3"
 *
 * 返回值：
 * - Some(String) - 命令执行成功并解析出版本号（如 "3.12.0"）
 * - None - 命令不存在、执行失败或输出格式无法识别
 *
 * 解析逻辑：
 * python --version 的输出格式为 "Python 3.12.0"
 * 需要去除 "Python " 前缀提取纯版本号
 * 注意：Python 3.4+ 将版本输出到 stdout，更早版本输出到 stderr，
 *       因此这里同时检查 stdout 和 stderr
 */
fn try_python_version(cmd_name: &str) -> Option<String> {
    // 创建指定命令名的执行器，添加 --version 参数
    let mut cmd = Command::new(cmd_name);
    cmd.arg("--version");

    // Windows 平台特殊处理：隐藏控制台窗口
    // 与 check_git_installed 保持一致的处理方式
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW 常量值
        // 0x08000000 = 创建进程时不显示控制台窗口
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行命令并捕获输出
    // output() 会同时捕获 stdout 和 stderr
    match cmd.output() {
        Ok(output) => {
            // 命令执行成功（退出码为 0）才继续解析
            if !output.status.success() {
                // 退出码非 0，说明命令存在但执行失败，不能算作"已安装"
                return None;
            }

            // Python 3.4+ 输出到 stdout，更早版本输出到 stderr
            // 优先尝试 stdout，为空时再尝试 stderr
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);

            // 选择非空的那个作为版本字符串来源
            // trim() 去除首尾空白和换行符
            let version_line = if !stdout.trim().is_empty() {
                stdout.trim()
            } else if !stderr.trim().is_empty() {
                stderr.trim()
            } else {
                // 两个输出都为空，无法判断版本
                return None;
            };

            // 解析版本号：输出格式为 "Python 3.12.0"
            // 使用 split_whitespace 按空白字符分割，取第二部分作为版本号
            // 例如 "Python 3.12.0" → ["Python", "3.12.0"] → "3.12.0"
            let mut parts = version_line.split_whitespace();
            // 跳过第一个部分（"Python" 字符串）
            let _ = parts.next();
            // 取第二个部分作为版本号
            match parts.next() {
                Some(version) if !version.is_empty() => {
                    // 成功解析出版本号
                    Some(version.to_string())
                }
                // 输出格式不符合预期，无法提取版本号
                _ => None,
            }
        }
        // 无法执行命令，说明 cmd_name 不在系统 PATH 中或根本未安装
        // Windows 上通常表现为 "系统找不到指定的文件" 错误
        Err(_) => None,
    }
}
