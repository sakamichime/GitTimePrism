/*
 * Git Fetch 操作模块
 *
 * 此模块封装了 git fetch 命令的执行逻辑。
 * git fetch 的作用是从远程仓库下载（fetch）更新到本地的远程跟踪分支，
 * 但不会自动合并到当前工作分支（与 git pull 不同）。
 *
 * 工作流程：
 * 1. 前端通过 Tauri IPC 调用 commands/fetch.rs 中的 fetch_command 命令
 * 2. fetch_command 调用本模块的 fetch 函数
 * 3. fetch 函数通过 git/commands.rs 中的 run_git 执行实际的 git 命令
 *
 * 依赖关系：
 * fetch -> commands（使用 run_git 执行 git 命令，使用 GitError 处理错误）
 *         commands::does_version_meet_requirement（版本检查，--prune-tags 需要 ≥2.17.0）
 */

// 引入通用的 Git 命令执行器、错误类型和版本检查函数
use super::commands::{does_version_meet_requirement, git_version, run_git, GitError};

/// FetchAndPruneTags 所需的最低 Git 版本
///
/// `--prune-tags` 选项在 Git 2.17.0 引入，
 /// 低于此版本的 Git 不支持 `git fetch --prune --prune-tags`。
/// 该常量用于版本检查，避免在低版本 Git 上执行会失败的命令。
const GIT_VERSION_REQUIREMENT_FETCH_AND_PRUNE_TAGS: &str = "2.17.0";

/// 从远程仓库获取更新（fetch）
///
/// 执行 `git fetch [--all / <remote>] [--prune] [--prune-tags]` 命令，
/// 从远程仓库下载更新到本地的远程跟踪分支。
///
/// 参数说明：
/// - `repo_path`：仓库根目录路径（git 命令将在此目录下执行）
/// - `remote`：远程仓库名（如 "origin"）；如果为 None，则使用 `--all` 拉取所有远程
/// - `prune`：是否启用 `--prune`（清理远程已删除的本地远程跟踪分支引用）
/// - `prune_tags`：是否启用 `--prune-tags`（清理远程已删除的本地标签引用）
///
/// 返回值：
/// - Ok(String)：fetch 成功，返回 git fetch 命令的标准输出信息
/// - Err(GitError)：fetch 失败，可能原因：
///   - 网络连接问题（无法访问远程仓库）
///   - 指定的远程仓库不存在
///   - Git 版本过低不支持 `--prune-tags`（需 ≥2.17.0）
///   - `prune_tags=true` 但 `prune=false`（业务规则：prune-tags 必须配合 prune 使用）
///
/// 版本检查：
/// 当 `prune_tags=true` 时，会先调用 git_version() 获取 Git 版本，
/// 使用 does_version_meet_requirement 检查是否 ≥2.17.0，
/// 若不满足则返回 GitError::CommandFailed。
///
/// 业务规则：
/// 如果 `prune_tags=true` 但 `prune=false`，返回错误信息
/// （与 gitgraph dataSource.ts 中的逻辑一致）。
///
/// 使用示例：
/// ```
/// // 拉取所有远程并清理已删除分支
/// let result = fetch("/path/to/repo", None, true, false)?;
/// // 拉取 origin 远程，清理分支和标签
/// let result = fetch("/path/to/repo", Some("origin"), true, true)?;
/// ```
pub fn fetch(
    repo_path: &str,
    remote: Option<&str>,
    prune: bool,
    prune_tags: bool,
) -> Result<String, GitError> {
    // 业务规则检查：prune_tags 必须配合 prune 使用
    // 与 gitgraph dataSource.ts 的逻辑保持一致
    if prune_tags && !prune {
        return Err(GitError::CommandFailed {
            exit_code: -1,
            message: "在启用 prune-tags 时必须同时启用 prune（--prune-tags 需要配合 --prune 使用）"
                .to_string(),
        });
    }

    // 构造 git fetch 的参数列表
    // 使用 Vec<String> 动态构建，因为参数数量和内容根据选项动态变化
    let mut args: Vec<String> = vec!["fetch".to_string()];

    // remote 为 None 时使用 --all（拉取所有远程），
    // 否则使用指定的 remote 名称（如 "origin"）
    match remote {
        Some(r) => args.push(r.to_string()),
        None => args.push("--all".to_string()),
    }

    // 如果启用 prune，添加 --prune 参数
    if prune {
        args.push("--prune".to_string());
    }

    // 如果启用 prune_tags，先进行版本检查（≥2.17.0），
    // 通过后添加 --prune-tags 参数
    if prune_tags {
        // 获取当前 Git 版本
        let version = git_version()?;
        // 检查版本是否满足 --prune-tags 的要求
        if !does_version_meet_requirement(
            &version,
            GIT_VERSION_REQUIREMENT_FETCH_AND_PRUNE_TAGS,
        ) {
            return Err(GitError::CommandFailed {
                exit_code: -1,
                message: format!(
                    "当前 Git 版本 {} 不支持 --prune-tags 选项，需要 Git ≥{}",
                    version, GIT_VERSION_REQUIREMENT_FETCH_AND_PRUNE_TAGS
                ),
            });
        }
        args.push("--prune-tags".to_string());
    }

    // 将 Vec<String> 转换为 Vec<&str> 供 run_git 使用
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 调用通用的 run_git 函数执行 git fetch 命令
    // run_git 会自动添加 --no-pager 参数，并在 Windows 上隐藏控制台窗口
    let output = run_git(repo_path, &arg_refs)?;

    // fetch 成功，返回标准输出中的文本信息
    Ok(output.stdout)
}
