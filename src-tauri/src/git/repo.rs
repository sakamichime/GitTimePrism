/*
 * Git 仓库管理模块
 * 
 * 此模块提供 Git 仓库的生命周期管理功能：
 * 1. 打开已有仓库（验证路径 + 获取基本信息）
 * 2. 初始化新仓库（在指定目录创建新的 Git 仓库）
 * 3. 克隆远程仓库（从 URL 克隆到本地目录）
 * 
 * 所有函数都通过 crate::git::commands::run_git 执行底层 git 命令，
 * 并将原始输出解析为结构化的 RepoInfo 数据。
 * 
 * 前端不直接调用此模块，而是通过 commands/repo.rs 中的 Tauri IPC 命令间接调用。
 */

use super::commands::{run_git, GitError};

/**
 * Git 仓库基本信息的数据结构
 * 
 * 描述一个 Git 仓库的核心信息，用于前端展示仓库概览。
 * 通过 serde 序列化为 JSON 后传递给前端 JavaScript。
 * 
 * 使用示例（前端）：
 * ```javascript
 * const info = await invoke('open_repo', { path: '/path/to/repo' });
 * console.log(info.path);          // 仓库路径
 * console.log(info.current_branch); // 当前分支名
 * console.log(info.is_bare);       // 是否是裸仓库
 * console.log(info.head_commit);   // HEAD 提交的完整哈希值
 * ```
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct RepoInfo {
    /// 仓库的根目录绝对路径
    /// 例如 "C:\Users\alice\my-project"
    pub path: String,

    /// 当前所在的分支名称
    /// 如果 HEAD 处于分离状态（detached HEAD），则为 None
    /// 例如 Some("main") 或 Some("feature/login")
    pub current_branch: Option<String>,

    /// 是否是裸仓库（bare repository）
    /// 裸仓库没有工作目录，通常用作远程仓库（如 GitHub 的服务端仓库）
    /// true = 裸仓库，false = 普通仓库
    pub is_bare: bool,

    /// HEAD 提交的完整哈希值（40 位十六进制字符串）
    /// 如果仓库没有任何提交（刚初始化的空仓库），则为 None
    /// 例如 Some("a1b2c3d4e5f6...") 或 None
    pub head_commit: Option<String>,
}

/**
 * 打开（验证并读取）一个 Git 仓库的基本信息
 * 
 * 此函数执行以下步骤：
 * 1. 验证指定路径是否是一个有效的 Git 仓库
 * 2. 获取当前分支名（通过 git rev-parse --abbrev-ref HEAD）
 * 3. 获取 HEAD 提交哈希（通过 git rev-parse HEAD）
 * 4. 判断是否是裸仓库（通过 git rev-parse --is-bare-repository）
 * 5. 将以上信息组装为 RepoInfo 结构体返回
 * 
 * 参数：
 * - path: 仓库的根目录路径（可以是相对路径或绝对路径）
 * 
 * 返回值：
 * - Ok(RepoInfo) - 仓库验证成功，包含仓库的基本信息
 * - Err(GitError) - 验证失败（路径无效、不是 Git 仓库等）
 * 
 * 注意：
 * - 此函数只读取仓库信息，不会修改仓库的任何内容
 * - 如果仓库为空（没有任何提交），head_commit 字段为 None
 * - 如果 HEAD 处于分离状态，current_branch 为 None
 */
pub fn open_repo(path: &str) -> Result<RepoInfo, GitError> {
    // 第一步：验证是否是 Git 仓库
    // 使用 git rev-parse --git-dir 命令来验证
    // 如果成功返回，说明当前目录在一个 Git 仓库内
    // --git-dir 会输出 .git 目录的路径
    let _git_dir = run_git(path, &["rev-parse", "--git-dir"])?;

    // 第二步：获取当前分支名称
    // git rev-parse --abbrev-ref HEAD 返回当前 HEAD 指向的引用名称
    // 如果在 "main" 分支上，返回 "main"
    // 如果处于 detached HEAD 状态，返回 HEAD 的完整哈希值
    let current_branch = match run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
        Ok(output) => {
            let branch = output.stdout.trim().to_string();
            // 如果返回的是完整的哈希值（40 位十六进制），说明处于 detached HEAD 状态
            // 此时我们不应该将其视为分支名
            if branch.len() == 40 && branch.chars().all(|c| c.is_ascii_hexdigit()) {
                None
            } else {
                Some(branch)
            }
        }
        Err(_) => None, // 获取失败时设为 None（不影响整体操作）
    };

    // 第三步：获取 HEAD 提交的完整哈希值
    // git rev-parse HEAD 返回当前 HEAD 指向的提交的完整 40 位哈希值
    // 如果仓库没有任何提交（刚 git init 的空仓库），此命令会失败
    let head_commit = match run_git(path, &["rev-parse", "HEAD"]) {
        Ok(output) => {
            let hash = output.stdout.trim().to_string();
            if hash.is_empty() {
                None
            } else {
                Some(hash)
            }
        }
        Err(_) => None, // 空仓库时设为 None
    };

    // 第四步：判断是否是裸仓库
    // git rev-parse --is-bare-repository 返回 "true" 或 "false"
    // 裸仓库没有工作目录，通常用作远程仓库
    let is_bare = match run_git(path, &["rev-parse", "--is-bare-repository"]) {
        Ok(output) => output.stdout.trim() == "true",
        Err(_) => false, // 获取失败时默认为 false（普通仓库）
    };

    // 组装并返回仓库信息
    Ok(RepoInfo {
        path: path.to_string(),
        current_branch,
        is_bare,
        head_commit,
    })
}

/**
 * 在指定目录初始化一个新的 Git 仓库
 * 
 * 此函数执行 `git init` 命令在指定路径创建一个新的 Git 仓库，
 * 然后调用 open_repo 获取并返回新仓库的基本信息。
 * 
 * 参数：
 * - path: 要初始化仓库的目录路径
 *         如果目录不存在，git init 会在创建 .git 目录的同时创建该目录
 * 
 * 返回值：
 * - Ok(RepoInfo) - 初始化成功，包含新仓库的基本信息
 * - Err(GitError) - 初始化失败（路径无效、权限不足等）
 * 
 * 注意：
 * - 如果目录中已有 .git 目录，git init 不会报错，而是重新初始化
 * - 初始化后默认分支名取决于 git 配置（通常是 "main" 或 "master"）
 * - 新仓库没有任何提交，head_commit 为 None
 */
pub fn init_repo(path: &str) -> Result<RepoInfo, GitError> {
    // 执行 git init 命令创建新仓库
    // git init 会在指定目录下创建 .git 子目录（包含仓库的所有元数据）
    let _output = run_git(path, &["init"])?;

    // 初始化成功后，调用 open_repo 获取并返回新仓库的基本信息
    // 这样可以确保返回的信息与 open_repo 的格式完全一致
    open_repo(path)
}

/**
 * 从远程 URL 克隆一个 Git 仓库到本地目录
 * 
 * 此函数执行 `git clone <url> <path>` 命令，
 * 将远程仓库的完整历史记录下载到指定的本地路径。
 * 
 * 参数：
 * - url: 远程仓库的 URL（支持 HTTPS、SSH、git:// 等协议）
 *        例如 "https://github.com/user/repo.git"
 * - path: 本地克隆目标目录的路径
 *        例如 "C:\Projects\my-repo"
 *        如果目录不存在，git clone 会自动创建
 *        如果目录已存在且非空，git clone 会报错
 * 
 * 返回值：
 * - Ok(String) - 克隆成功，返回克隆后的仓库路径
 * - Err(GitError) - 克隆失败（网络错误、URL 无效、权限不足等）
 * 
 * 注意：
 * - clone_repo 是耗时操作（需要下载完整的仓库历史）
 * - 在 Tauri IPC 层（commands/repo.rs）中，此函数通过
 *   tauri::async_runtime::spawn_blocking 在子线程中执行，避免阻塞主线程
 * - 克隆完成后，本地目录会自动设置为远程仓库的默认分支（通常是 main）
 */
pub fn clone_repo(url: &str, path: &str) -> Result<String, GitError> {
    // 获取目标目录的父目录路径
    // git clone 命令需要父目录已存在，它会自动创建最后一层目录
    let parent_dir = std::path::Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string());

    // 如果有父目录，验证父目录是否存在
    if let Some(ref parent) = parent_dir {
        if !std::path::Path::new(parent).exists() {
            return Err(GitError::InvalidPath(format!(
                "目标路径的父目录 '{}' 不存在",
                parent
            )));
        }
    }

    // 构建克隆命令的参数列表
    // git clone <url> <path>
    // url: 远程仓库地址
    // path: 本地存储路径
    let clone_args: Vec<&str> = vec![url, path];

    // 获取父目录作为工作目录（如果存在）
    // 因为目标目录可能还不存在，所以需要在父目录下执行 clone 命令
    let work_dir = parent_dir.unwrap_or_else(|| ".".to_string());

    // 使用 crate::utils::process::execute_command_silent 执行 git clone
    // 因为 clone 的目标目录可能还不存在，不能使用 run_git（它要求目录存在）
    // 所以这里直接调用底层函数，并手动添加 --no-pager 和 Windows 标志
    let mut cmd = std::process::Command::new("git");
    cmd.current_dir(&work_dir);
    cmd.arg("--no-pager");
    cmd.args(&["clone", url, path]);

    // Windows 平台特殊处理：隐藏控制台窗口
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    // 执行克隆命令
    match cmd.output() {
        Ok(output) => {
            if output.status.success() {
                // 克隆成功，返回克隆后的仓库路径
                Ok(path.to_string())
            } else {
                // 克隆失败，解析错误信息
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                let exit_code = output.status.code().unwrap_or(-1);

                Err(GitError::CommandFailed {
                    exit_code,
                    message: if stderr.is_empty() {
                        stdout
                    } else {
                        stderr
                    },
                })
            }
        }
        Err(e) => Err(GitError::CommandFailed {
            exit_code: -1,
            message: format!("无法启动 git clone 进程: {}", e),
        }),
    }
}
