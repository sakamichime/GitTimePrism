/*
 * 通用 Git 命令执行器模块
 *
 * 此模块提供统一的 Git 命令执行接口，是所有 Git 操作的基础层。
 * 其他模块（repo、status、branch、log、graph、refs、stash、diff 等）都通过此模块执行 git 命令。
 *
 * 核心功能：
 * 1. 自动在 git 命令参数前插入 "--no-pager"（防止分页器干扰输出解析）
 * 2. Windows 平台自动添加 CREATE_NO_WINDOW 标志（防止弹出黑色控制台窗口）
 * 3. 统一的错误处理（将系统错误转换为语义化的 GitError）
 * 4. 支持 UTF-8 输出解析（Git 中文消息等场景）
 * 5. 支持环境变量注入（为 askpass 等场景准备）
 * 6. 支持原始字节输出（用于 -z NUL 分隔与二进制文件读取）
 * 7. 支持 Git 版本查询与版本比较
 * 8. 统一自定义分隔符 GIT_LOG_SEPARATOR（替代旧版 |||SEP||| 与 §）
 *
 * 使用示例（在其他模块中）：
 * ```
 * use crate::git::commands::{run_git, run_git_raw, run_git_with_env, GitError};
 *
 * let output = run_git("/path/to/repo", &["status", "--porcelain=v2"])?;
 * println!("{}", output.stdout);
 * ```
 */

use std::process::Command;
use thiserror::Error;

/**
 * 统一的自定义分隔符常量
 *
 * 用于 git log/show/reflog 等命令的 --format/--pretty=format 输出中，
 * 作为字段之间的分隔符。
 *
 * 此分隔符特点：
 * - 极长的随机字符串，几乎不可能出现在提交消息、作者名、文件路径等真实数据中
 * - 与 gitgraph 项目保持一致（确保未来对齐行为）
 * - 替代了旧版的 |||SEP|||（log.rs 使用）和 §（graph.rs 使用）
 *
 * 注意：使用此分隔符时，应配合 -z 选项（NUL 行分隔）或者 %n（换行行分隔）使用，
 * 因为分隔符本身不含换行符。
 */
pub const GIT_LOG_SEPARATOR: &str = "XX7Nal-YARtTpjCikii9nJxER19D6diSyk-AWkPb";

/**
 * Git 命令执行结果的数据结构
 *
 * 封装了 git 命令执行后的三部分输出：
 * - stdout: 标准输出（命令的正常结果，如 git log 的列表）
 * - stderr: 标准错误（命令的警告或错误信息）
 * - exit_code: 退出码（0 表示成功，非 0 表示失败）
 *
 * 此结构体可通过 serde 序列化为 JSON，方便传递给前端。
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct GitOutput {
    /// 命令的标准输出内容（已去除首尾空白字符）
    pub stdout: String,
    /// 命令的标准错误输出内容（已去除首尾空白字符）
    pub stderr: String,
    /// 命令的退出状态码（0 = 成功，非 0 = 失败）
    pub exit_code: i32,
}

/**
 * Git 操作错误枚举
 *
 * 使用 thiserror 库定义，自动实现 std::error::Error trait。
 * 每个变体代表一种可能的失败场景，方便调用方进行精确的错误处理。
 *
 * 使用 thiserror 的 #[error(...)] 属性来定义每个错误的显示消息，
 * 这样在转换为 String 时会自动使用这些消息。
 */
#[derive(Debug, Error)]
pub enum GitError {
    /**
     * 命令执行失败
     * 当 git 命令返回非零退出码时产生此错误
     * 包含退出码和 stderr 中的错误信息
     */
    #[error("Git 命令执行失败（退出码 {exit_code}）: {message}")]
    CommandFailed {
        /// 命令的退出状态码（非零值表示失败）
        exit_code: i32,
        /// 错误消息内容（来自 git 命令的 stderr 输出）
        message: String,
    },

    /**
     * 不是 Git 仓库
     * 当在非 Git 仓库目录下执行 git 命令时产生
     * 例如：在普通文件夹中执行 git status
     */
    #[error("不是一个 Git 仓库: {0}")]
    NotAGitRepo(String),

    /**
     * 无效的路径
     * 当指定的目录路径不存在或不可访问时产生
     */
    #[error("无效的路径: {0}")]
    InvalidPath(String),

    /**
     * UTF-8 编码错误
     * 当 git 命令输出包含无法用 UTF-8 解码的字节时产生
     * 通常出现在含有特殊字符的文件名或提交消息中
     */
    #[error("UTF-8 编码错误: {0}")]
    Utf8Error(String),

    /**
     * 文件 I/O 错误
     * 当读取或写入文件时发生错误
     * 例如：文件不存在、权限不足等
     */
    #[error("文件 I/O 错误: {0}")]
    Io(String),
}

/**
 * 执行 Git 命令的核心函数
 *
 * 此函数是所有 Git 操作的基础，提供统一的命令执行接口。
 * 自动处理以下跨平台兼容性问题：
 * 1. 在参数列表最前面插入 "--no-pager"（防止 git 使用 less 等分页器）
 * 2. 在 Windows 上添加 CREATE_NO_WINDOW 标志（防止弹出控制台窗口）
 * 3. 设置工作目录为指定的仓库路径
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径（命令将在此目录下执行）
 * - args: 要传递给 git 的参数数组（不需要包含 "git" 本身和 "--no-pager"）
 *         例如 ["status", "--porcelain=v2"] 会执行 `git --no-pager status --porcelain=v2`
 *
 * 返回值：
 * - Ok(GitOutput) - 命令执行成功，包含标准输出、标准错误和退出码
 * - Err(GitError) - 命令执行失败，包含具体的错误类型和描述
 *
 * 使用示例：
 * ```
 * // 获取仓库状态
 * let output = run_git("/my/repo", &["status", "--porcelain=v2"])?;
 *
 * // 获取当前分支名
 * let output = run_git("/my/repo", &["rev-parse", "--abbrev-ref", "HEAD"])?;
 * println!("当前分支: {}", output.stdout);
 * ```
 */
pub fn run_git(repo_path: &str, args: &[&str]) -> Result<GitOutput, GitError> {
    // 调用 run_git_with_env，传入空的环境变量数组（不注入任何额外环境变量）
    // 这样保持与原 run_git 完全兼容的行为
    run_git_with_env(repo_path, args, &[])
}

/**
 * 执行 Git 命令（带环境变量注入）
 *
 * 此函数是 run_git 的扩展版本，允许调用方注入额外的环境变量到 git 子进程。
 * 主要用于以下场景：
 * 1. askpass 场景：注入 GIT_ASKPASS / SSH_ASKPASS 等环境变量，让 git 在需要密码时
 *    调用指定的辅助程序，避免在终端中阻塞等待用户输入
 * 2. SSH 自定义：注入 GIT_SSH_COMMAND 等变量，自定义 SSH 行为
 * 3. 编码控制：注入 GIT_ENCODING 等变量
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - args: 要传递给 git 的参数数组
 * - env: 要注入的环境变量列表，每项为 (key, value) 元组
 *        例如 [("GIT_ASKPASS", "/path/to/askpass"), ("GIT_TERMINAL_PROMPT", "0")]
 *
 * 返回值：
 * - Ok(GitOutput) - 命令执行成功
 * - Err(GitError) - 命令执行失败
 */
pub fn run_git_with_env(
    repo_path: &str,
    args: &[&str],
    env: &[(&str, &str)],
) -> Result<GitOutput, GitError> {
    // 验证仓库路径是否存在且可访问
    let path = std::path::Path::new(repo_path);
    if !path.exists() {
        return Err(GitError::InvalidPath(format!(
            "路径 '{}' 不存在",
            repo_path
        )));
    }
    if !path.is_dir() {
        return Err(GitError::InvalidPath(format!(
            "路径 '{}' 不是一个目录",
            repo_path
        )));
    }

    // 创建 git 命令执行器
    let mut cmd = Command::new("git");

    // 设置命令的工作目录为指定的仓库路径
    cmd.current_dir(repo_path);

    // 在参数列表最前面插入 "--no-pager"
    cmd.arg("--no-pager");

    // 添加用户指定的所有参数
    cmd.args(args);

    // 注入调用方提供的额外环境变量
    // 这些环境变量会覆盖（或追加到）子进程继承自父进程的环境变量
    for (key, value) in env {
        cmd.env(key, value);
    }

    // Windows 平台特殊处理：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行命令并获取输出结果
    match cmd.output() {
        Ok(output) => {
            // 将 stdout 从字节数组转换为 UTF-8 字符串
            let stdout = match String::from_utf8(output.stdout.clone()) {
                Ok(s) => s.trim().to_string(),
                Err(_) => String::from_utf8_lossy(&output.stdout).trim().to_string(),
            };

            // 将 stderr 从字节数组转换为 UTF-8 字符串
            let stderr = match String::from_utf8(output.stderr.clone()) {
                Ok(s) => s.trim().to_string(),
                Err(_) => String::from_utf8_lossy(&output.stderr).trim().to_string(),
            };

            // 获取退出码
            let exit_code = output.status.code().unwrap_or(-1);

            if output.status.success() {
                Ok(GitOutput {
                    stdout,
                    stderr,
                    exit_code,
                })
            } else {
                // 检查是否是 "不是 Git 仓库" 的错误
                if exit_code == 128
                    && (stderr.contains("not a git repository")
                        || stderr.contains("不是一个 git 仓库")
                        || stderr.contains("Not a git repository")
                        || stderr.contains("does not belong to a git repository"))
                {
                    return Err(GitError::NotAGitRepo(format!(
                        "'{}' 不是一个 Git 仓库",
                        repo_path
                    )));
                }

                Err(GitError::CommandFailed {
                    exit_code,
                    message: if stderr.is_empty() { stdout } else { stderr },
                })
            }
        }
        Err(e) => Err(GitError::CommandFailed {
            exit_code: -1,
            message: format!("无法启动 git 进程: {}", e),
        }),
    }
}

/**
 * 执行 Git 命令并返回原始字节输出
 *
 * 此函数与 run_git 的区别在于：
 * - run_git 返回 UTF-8 字符串（自动 trim）
 * - run_git_raw 返回原始字节数组（不进行任何解码或 trim 处理）
 *
 * 使用场景：
 * 1. 配合 -z 选项使用：git 的 -z 选项使用 NUL 字符（\0）作为字段分隔符，
 *    NUL 字符在 UTF-8 字符串中处理不便，需要按字节切分
 * 2. 二进制文件读取：使用 `git show <hash>:<binary_file>` 读取二进制文件内容时
 *    不能进行 UTF-8 解码（会损坏数据），必须保留原始字节
 * 3. 精确控制输出：调用方需要精确控制如何处理输出（如自定义 trim、自定义分隔符）
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - args: 要传递给 git 的参数数组
 *
 * 返回值：
 * - Ok(Vec<u8>) - 命令执行成功，包含 stdout 的原始字节数组
 * - Err(GitError) - 命令执行失败
 *
 * 使用示例：
 * ```
 * // 使用 -z 选项获取 NUL 分隔的状态输出
 * let bytes = run_git_raw("/my/repo", &["status", "-s", "--porcelain", "-z"])?;
 * let fields: Vec<&[u8]> = bytes.split(|&b| b == 0).collect();
 * ```
 */
pub fn run_git_raw(repo_path: &str, args: &[&str]) -> Result<Vec<u8>, GitError> {
    // 验证仓库路径是否存在且可访问
    let path = std::path::Path::new(repo_path);
    if !path.exists() {
        return Err(GitError::InvalidPath(format!(
            "路径 '{}' 不存在",
            repo_path
        )));
    }
    if !path.is_dir() {
        return Err(GitError::InvalidPath(format!(
            "路径 '{}' 不是一个目录",
            repo_path
        )));
    }

    // 创建 git 命令执行器
    let mut cmd = Command::new("git");
    cmd.current_dir(repo_path);
    cmd.arg("--no-pager");
    cmd.args(args);

    // Windows 平台：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行命令并获取输出
    match cmd.output() {
        Ok(output) => {
            // 获取退出码
            let exit_code = output.status.code().unwrap_or(-1);

            if output.status.success() {
                // 成功：返回 stdout 的原始字节数组（不进行任何 trim 或解码）
                Ok(output.stdout)
            } else {
                // 失败：尝试解析 stderr 用于错误信息
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

                // 检查是否是 "不是 Git 仓库" 的错误
                if exit_code == 128
                    && (stderr.contains("not a git repository")
                        || stderr.contains("不是一个 git 仓库")
                        || stderr.contains("Not a git repository")
                        || stderr.contains("does not belong to a git repository"))
                {
                    return Err(GitError::NotAGitRepo(format!(
                        "'{}' 不是一个 Git 仓库",
                        repo_path
                    )));
                }

                Err(GitError::CommandFailed {
                    exit_code,
                    message: if stderr.is_empty() { stdout } else { stderr },
                })
            }
        }
        Err(e) => Err(GitError::CommandFailed {
            exit_code: -1,
            message: format!("无法启动 git 进程: {}", e),
        }),
    }
}

/**
 * 获取 Git 可执行程序的版本号
 *
 * 执行 `git --version` 命令并解析输出，返回形如 "2.45.0" 的版本字符串。
 *
 * git --version 的输出格式：
 * - Windows: "git version 2.45.0.windows.1"
 * - Linux/macOS: "git version 2.45.0"
 *
 * 解析逻辑：从输出中提取第一个匹配 `数字.数字.数字` 模式的子串作为版本号。
 * 如果无法解析，则返回原始输出（去除前缀 "git version "）。
 *
 * 返回值：
 * - Ok(String) - 解析成功，返回版本号字符串（如 "2.45.0"）
 * - Err(GitError) - 解析失败（git 未安装或输出格式异常）
 *
 * 使用示例：
 * ```
 * let version = git_version()?;
 * if does_version_meet_requirement(&version, "2.17.0") {
 *     // 支持 --prune --tags
 * }
 * ```
 */
pub fn git_version() -> Result<String, GitError> {
    // 执行 `git --version`（不需要指定仓库路径，因为是全局命令）
    // 这里直接调用 Command，不通过 run_git，因为：
    // 1. 不需要仓库路径（任何目录都可以执行）
    // 2. 不需要 --no-pager 前缀（--version 输出不会分页）
    let mut cmd = Command::new("git");
    cmd.arg("--version");

    // Windows 平台：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let output = cmd.output().map_err(|e| GitError::CommandFailed {
        exit_code: -1,
        message: format!("无法启动 git 进程: {}", e),
    })?;

    if !output.status.success() {
        return Err(GitError::CommandFailed {
            exit_code: output.status.code().unwrap_or(-1),
            message: String::from_utf8_lossy(&output.stderr).trim().to_string(),
        });
    }

    // 解析输出：从 "git version 2.45.0.windows.1" 中提取 "2.45.0"
    let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // 使用正则表达式风格的字符串解析：提取第一段 "数字.数字[.数字]" 模式
    // 由于不引入 regex crate（避免新增依赖），手动实现解析逻辑
    let parsed = parse_version_from_string(&version_str);
    Ok(parsed)
}

/**
 * 从字符串中解析出版本号
 *
 * 从任意字符串中提取第一个匹配 "major.minor.patch" 或 "major.minor" 的子串。
 * 例如：
 * - "git version 2.45.0.windows.1" -> "2.45.0"
 * - "git version 2.45" -> "2.45"
 * - "git version 2.45.0" -> "2.45.0"
 *
 * 参数：
 * - s: 包含版本号的字符串
 *
 * 返回值：
 * - 解析出的版本号字符串（如 "2.45.0"）
 * - 如果无法解析，返回原字符串去除 "git version " 前缀后的内容
 */
fn parse_version_from_string(s: &str) -> String {
    // 先去除常见的前缀 "git version "
    let cleaned = s.strip_prefix("git version ").unwrap_or(s).trim();

    // 找到第一个数字字符的位置（版本号的起始）
    let bytes = cleaned.as_bytes();
    let mut start = None;
    for (i, &b) in bytes.iter().enumerate() {
        if b.is_ascii_digit() {
            start = Some(i);
            break;
        }
    }

    let start = match start {
        Some(s) => s,
        None => return cleaned.to_string(),
    };

    // 从 start 开始，收集连续的 [0-9.] 字符
    let mut end = start;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if b.is_ascii_digit() || b == b'.' {
            end = i + 1;
        } else {
            break;
        }
    }

    // 取出 major.minor[.patch] 部分作为版本号
    // 处理 "2.45.0.windows.1" 这种情况：取前 3 段（如果有）
    let raw_version = &cleaned[start..end];
    let parts: Vec<&str> = raw_version.split('.').collect();
    let version_parts: Vec<&str> = parts.iter().take(3).copied().collect();
    version_parts.join(".")
}

/**
 * 检查 Git 版本是否满足要求
 *
 * 比较 `version` 是否 >= `requirement`，支持以下格式：
 * - "2.45.0" (major.minor.patch)
 * - "2.45"   (major.minor，patch 默认为 0)
 * - "2"      (major，minor 和 patch 默认为 0)
 *
 * 比较规则：
 * 1. 先比较 major，如果 version.major > requirement.major 则满足
 * 2. 如果 major 相等，再比较 minor
 * 3. 如果 minor 也相等，再比较 patch
 * 4. 如果完全相等，则满足
 *
 * 如果任一版本号无法解析，则默认返回 true（保守策略，假设版本满足要求）
 *
 * 参数：
 * - version: 实际的版本号字符串（如 git_version() 的返回值）
 * - requirement: 要求的最低版本号字符串（如 "2.17.0"）
 *
 * 返回值：
 * - true: version >= requirement
 * - false: version < requirement
 *
 * 使用示例：
 * ```
 * let ver = git_version()?;
 * if does_version_meet_requirement(&ver, "2.17.0") {
 *     // 支持 fetch --prune --tags
 * }
 * if does_version_meet_requirement(&ver, "2.4.0") {
 *     // 支持 %G? %GS %GK（GPG 签名信息）
 * }
 * ```
 */
pub fn does_version_meet_requirement(version: &str, requirement: &str) -> bool {
    let v1 = parse_version_components(version);
    let v2 = parse_version_components(requirement);

    // 如果任一版本号无法解析，返回 true（保守策略）
    let v1 = match v1 {
        Some(v) => v,
        None => return true,
    };
    let v2 = match v2 {
        Some(v) => v,
        None => return true,
    };

    // 比较 major
    if v1.0 > v2.0 {
        return true;
    }
    if v1.0 < v2.0 {
        return false;
    }

    // major 相等，比较 minor
    if v1.1 > v2.1 {
        return true;
    }
    if v1.1 < v2.1 {
        return false;
    }

    // minor 也相等，比较 patch
    if v1.2 > v2.2 {
        return true;
    }
    if v1.2 < v2.2 {
        return false;
    }

    // 完全相等
    true
}

/**
 * 解析版本字符串为 (major, minor, patch) 元组
 *
 * 从版本字符串中提取出主版本号、次版本号、修订号。
 * 例如：
 * - "2.45.0" -> (2, 45, 0)
 * - "2.45"   -> (2, 45, 0)
 * - "2"      -> (2, 0, 0)
 * - "abc"    -> None（无法解析）
 *
 * 参数：
 * - version: 版本字符串
 *
 * 返回值：
 * - Some((major, minor, patch)) - 解析成功
 * - None - 无法解析（字符串不以数字开头）
 */
fn parse_version_components(version: &str) -> Option<(u32, u32, u32)> {
    // 提取字符串开头的 "数字.数字.数字" 部分
    let trimmed = version.trim();

    // 找到第一个数字的位置
    let bytes = trimmed.as_bytes();
    let mut start = None;
    for (i, &b) in bytes.iter().enumerate() {
        if b.is_ascii_digit() {
            start = Some(i);
            break;
        }
    }
    let start = start?;

    // 收集连续的 [0-9.] 字符
    let mut end = start;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if b.is_ascii_digit() || b == b'.' {
            end = i + 1;
        } else {
            break;
        }
    }

    let version_part = &trimmed[start..end];
    let components: Vec<&str> = version_part.split('.').collect();

    // 至少要有 major
    if components.is_empty() {
        return None;
    }

    let major: u32 = components[0].parse().ok()?;
    let minor: u32 = if components.len() > 1 {
        components[1].parse().unwrap_or(0)
    } else {
        0
    };
    let patch: u32 = if components.len() > 2 {
        components[2].parse().unwrap_or(0)
    } else {
        0
    };

    Some((major, minor, patch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_does_version_meet_requirement() {
        // 等于要求版本
        assert!(does_version_meet_requirement("2.17.0", "2.17.0"));
        // 大于要求版本
        assert!(does_version_meet_requirement("2.45.0", "2.17.0"));
        assert!(does_version_meet_requirement("3.0.0", "2.17.0"));
        assert!(does_version_meet_requirement("2.17.1", "2.17.0"));
        // 小于要求版本
        assert!(!does_version_meet_requirement("2.16.0", "2.17.0"));
        assert!(!does_version_meet_requirement("1.99.99", "2.0.0"));
        // 缺省 patch
        assert!(does_version_meet_requirement("2.17", "2.17.0"));
        // 缺省 minor 和 patch
        assert!(does_version_meet_requirement("3", "2.17.0"));
        // Windows 风格版本号
        assert!(does_version_meet_requirement("2.45.0.windows.1", "2.17.0"));
    }

    #[test]
    fn test_parse_version_from_string() {
        assert_eq!(parse_version_from_string("git version 2.45.0"), "2.45.0");
        assert_eq!(
            parse_version_from_string("git version 2.45.0.windows.1"),
            "2.45.0"
        );
        assert_eq!(parse_version_from_string("git version 2.45"), "2.45");
    }
}
