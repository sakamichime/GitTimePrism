/*
 * 通用 Git 命令执行器模块
 * 
 * 此模块提供统一的 Git 命令执行接口，是所有 Git 操作的基础层。
 * 其他模块（repo、status、branch、log）都通过此模块执行 git 命令。
 * 
 * 核心功能：
 * 1. 自动在 git 命令参数前插入 "--no-pager"（防止分页器干扰输出解析）
 * 2. Windows 平台自动添加 CREATE_NO_WINDOW 标志（防止弹出黑色控制台窗口）
 * 3. 统一的错误处理（将系统错误转换为语义化的 GitError）
 * 4. 支持 UTF-8 输出解析（Git 中文消息等场景）
 * 
 * 使用示例（在其他模块中）：
 * ```
 * use crate::git::commands::{run_git, GitError};
 * 
 * let output = run_git("/path/to/repo", &["status", "--porcelain=v2"])?;
 * println!("{}", output.stdout);
 * ```
 */

use std::process::Command;
use thiserror::Error;

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
    // 验证仓库路径是否存在且可访问
    // 使用 std::path::Path 检查路径是否是一个有效的目录
    let path = std::path::Path::new(repo_path);
    if !path.exists() {
        // 路径不存在，返回 InvalidPath 错误
        return Err(GitError::InvalidPath(format!(
            "路径 '{}' 不存在",
            repo_path
        )));
    }
    if !path.is_dir() {
        // 路径不是目录，返回 InvalidPath 错误
        return Err(GitError::InvalidPath(format!(
            "路径 '{}' 不是一个目录",
            repo_path
        )));
    }

    // 创建 git 命令执行器
    // "git" 是可执行程序名，系统会从 PATH 环境变量中查找
    let mut cmd = Command::new("git");

    // 设置命令的工作目录为指定的仓库路径
    // 这样 git 命令就会在正确的仓库中执行
    cmd.current_dir(repo_path);

    // 在参数列表最前面插入 "--no-pager"
    // --no-pager 的作用是告诉 git 不要使用分页器（如 less）来显示输出
    // 这对于程序化解析 git 输出非常重要，否则 git 可能会等待用户按键
    cmd.arg("--no-pager");

    // 添加用户指定的所有参数
    cmd.args(args);

    // Windows 平台特殊处理：隐藏控制台窗口
    // 在 Windows 上，如果不添加此标志，每次执行 git 命令都会弹出黑色控制台窗口
    // CREATE_NO_WINDOW = 0x08000000 是 Windows API 的创建标志常量
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW 标志值
        // 告诉 Windows 操作系统：创建子进程时不要为其分配控制台窗口
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行命令并获取输出结果
    // .output() 会等待命令执行完毕后返回完整的输出
    match cmd.output() {
        // 命令成功启动并执行完毕（无论退出码是什么）
        Ok(output) => {
            // 将标准输出（stdout）从字节数组转换为 UTF-8 字符串
            // String::from_utf8_lossy() 在遇到无效 UTF-8 字节时会用替换字符代替
            // .trim() 去除首尾的空白字符（换行符、空格等）
            let stdout = match String::from_utf8(output.stdout.clone()) {
                Ok(s) => s.trim().to_string(),
                Err(_) => {
                    // 如果 stdout 包含无效 UTF-8 字节，使用 lossy 转换
                    String::from_utf8_lossy(&output.stdout).trim().to_string()
                }
            };

            // 将标准错误（stderr）从字节数组转换为 UTF-8 字符串
            // 处理方式与 stdout 相同
            let stderr = match String::from_utf8(output.stderr.clone()) {
                Ok(s) => s.trim().to_string(),
                Err(_) => {
                    String::from_utf8_lossy(&output.stderr).trim().to_string()
                }
            };

            // 获取命令的退出状态码
            // code() 返回 Option<i32>，Some(0) 表示成功，Some(非零) 表示失败，None 表示被信号终止
            let exit_code = output.status.code().unwrap_or(-1);

            // 检查命令是否执行成功（退出码为 0）
            if output.status.success() {
                // 成功：返回包含标准输出、标准错误和退出码的 GitOutput
                Ok(GitOutput {
                    stdout,
                    stderr,
                    exit_code,
                })
            } else {
                // 失败：根据退出码和错误信息判断具体的错误类型

                // 检查是否是 "不是 Git 仓库" 的错误
                // git 在非仓库目录下执行时会返回退出码 128，
                // stderr 中通常包含 "not a git repository" 或中文的 "不是一个 git 仓库"
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

                // 其他命令失败的情况
                Err(GitError::CommandFailed {
                    exit_code,
                    // 如果 stderr 为空，使用 stdout 作为错误消息
                    // 某些 git 命令的错误信息会输出到 stdout 而非 stderr
                    message: if stderr.is_empty() {
                        stdout
                    } else {
                        stderr
                    },
                })
            }
        }
        // 命令启动失败（例如 git 程序不存在）
        Err(e) => Err(GitError::CommandFailed {
            exit_code: -1,
            message: format!("无法启动 git 进程: {}", e),
        }),
    }
}
