/*
 * Git 拉取操作模块
 *
 * 此模块封装了 git pull 命令的执行逻辑。
 * git pull 的作用是从远程仓库拉取（fetch）更新，并自动合并到当前分支。
 *
 * 工作流程：
 * 1. 前端通过 Tauri IPC 调用 commands/remote.rs 中的 pull_changes 命令
 * 2. pull_changes 调用本模块的 pull 函数
 * 3. pull 函数通过 git/commands.rs 中的 run_git 执行实际的 git 命令
 *
 * 依赖关系：
 * pull -> commands（使用 run_git 执行 git 命令，使用 GitError 处理错误）
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/// 从远程仓库拉取更新
///
/// 执行 `git pull <remote> <branch>` 命令，将远程仓库的指定分支更新
/// 拉取到本地并自动合并到当前工作分支。
///
/// 参数：
/// - repo_path: 仓库根目录路径（git 命令将在此目录下执行）
/// - remote: 远程仓库名（通常为 "origin"，即默认的远程仓库名称）
/// - branch: 要拉取的远程分支名（通常与当前本地分支同名）
///
/// 返回值：
/// - Ok(String) - 拉取成功，返回 git pull 命令的标准输出信息
///                （例如 "Already up to date." 或具体的合并信息）
/// - Err(GitError) - 拉取失败，可能的原因包括：
///                   - 存在合并冲突（本地和远程修改了同一文件的同一部分）
///                   - 网络连接问题（无法访问远程仓库）
///                   - 指定的远程仓库或分支不存在
///
/// 使用示例：
/// ```
/// let result = pull("/path/to/repo", "origin", "main")?;
/// println!("拉取结果: {}", result);
/// ```
pub fn pull(repo_path: &str, remote: &str, branch: &str) -> Result<String, GitError> {
    // 调用通用的 run_git 函数执行 git pull 命令
    // run_git 会自动添加 --no-pager 参数，并在 Windows 上隐藏控制台窗口
    // 参数数组 &["pull", remote, branch] 会被展开为: git --no-pager pull <remote> <branch>
    let output = run_git(repo_path, &["pull", remote, branch])?;

    // 拉取成功，返回标准输出中的文本信息
    Ok(output.stdout)
}
