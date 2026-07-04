/*
 * Git 推送操作模块
 *
 * 此模块封装了 git push 命令的执行逻辑。
 * git push 的作用是将本地的提交推送到远程仓库，使远程分支与本地分支同步。
 *
 * 工作流程：
 * 1. 前端通过 Tauri IPC 调用 commands/remote.rs 中的 push_changes 命令
 * 2. push_changes 调用本模块的 push 函数
 * 3. push 函数通过 git/commands.rs 中的 run_git 执行实际的 git 命令
 *
 * 依赖关系：
 * push -> commands（使用 run_git 执行 git 命令，使用 GitError 处理错误）
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/// 推送本地提交到远程仓库
///
/// 执行 `git push <remote> <branch>` 命令，将本地指定分支上的提交
/// 推送到远程仓库的对应分支。
///
/// 参数：
/// - repo_path: 仓库根目录路径（git 命令将在此目录下执行）
/// - remote: 远程仓库名（通常为 "origin"，即默认的远程仓库名称）
/// - branch: 要推送的本地分支名（远程分支会同步更新）
///
/// 返回值：
/// - Ok(String) - 推送成功，返回 git push 命令的标准输出信息
///                （通常为空或包含推送进度信息）
/// - Err(GitError) - 推送失败，可能的原因包括：
///                   - 远程有新的提交（需要先拉取合并）
///                   - 网络连接问题（无法访问远程仓库）
///                   - 权限不足（没有推送权限）
///                   - 指定的远程仓库或分支不存在
///
/// 使用示例：
/// ```
/// let result = push("/path/to/repo", "origin", "main")?;
/// println!("推送结果: {}", result);
/// ```
pub fn push(repo_path: &str, remote: &str, branch: &str) -> Result<String, GitError> {
    // 调用通用的 run_git 函数执行 git push 命令
    // run_git 会自动添加 --no-pager 参数，并在 Windows 上隐藏控制台窗口
    // 参数数组 &["push", remote, branch] 会被展开为: git --no-pager push <remote> <branch>
    let output = run_git(repo_path, &["push", remote, branch])?;

    // 推送成功，返回标准输出中的文本信息
    Ok(output.stdout)
}
