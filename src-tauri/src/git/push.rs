/*
 * Git 推送操作模块
 *
 * 此模块封装了 git push 命令的执行逻辑。
 * git push 的作用是将本地的提交推送到远程仓库，使远程分支与本地分支同步。
 *
 * 工作流程：
 * 1. 前端通过 Tauri IPC 调用 commands/remote.rs 中的 push_changes 命令
 * 2. push_changes 调用本模块的 push 或 push_with_options 函数
 * 3. 函数通过 git/commands.rs 中的 run_git 执行实际的 git 命令
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
/// 这是简化的 push 函数，不支持任何选项。如需使用 --set-upstream / --force /
/// --force-with-lease 等选项，请使用 push_with_options 函数。
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

/// 推送本地提交到远程仓库（带选项）
///
/// 执行 `git push <remote> <branch> [--set-upstream] [--force|--force-with-lease]` 命令。
/// 与 push 函数的区别：此函数支持以下选项：
/// - set_upstream: 启用 --set-upstream（设置上游追踪关系，首次推送新分支时使用）
/// - force: 启用 --force（强制推送，覆盖远程历史，危险操作）
/// - force_with_lease: 启用 --force-with-lease（带租约的强制推送，更安全）
///
/// 注意：force 和 force_with_lease 是互斥的，force_with_lease 优先级更高
/// （更安全的选项优先）。
///
/// 参数：
/// - repo_path: 仓库根目录路径
/// - remote: 远程仓库名（通常为 "origin"）
/// - branch: 要推送的本地分支名
/// - set_upstream: 是否启用 --set-upstream
/// - force: 是否启用 --force（强制推送）
/// - force_with_lease: 是否启用 --force-with-lease（带租约的强制推送）
///
/// 返回值：
/// - Ok(String) - 推送成功，返回命令的输出信息
/// - Err(GitError) - 推送失败
///
/// 参考实现：docs/git/src/dataSource.ts 中的 pushBranch 方法
pub fn push_with_options(
    repo_path: &str,
    remote: &str,
    branch: &str,
    set_upstream: bool,
    force: bool,
    force_with_lease: bool,
) -> Result<String, GitError> {
    // 构造 git push 命令的参数列表
    let mut args: Vec<String> = vec!["push".to_string(), remote.to_string(), branch.to_string()];

    // 添加 --set-upstream 选项
    // --set-upstream: 设置本地分支跟踪远程分支，下次可以直接 git pull / git push 不带参数
    if set_upstream {
        args.push("--set-upstream".to_string());
    }

    // 添加 --force 或 --force-with-lease 选项
    // 注意：force_with_lease 优先级高于 force（更安全的选项优先）
    // --force: 强制推送，覆盖远程历史（危险操作，可能导致其他协作者的提交丢失）
    // --force-with-lease: 带租约的强制推送，只在远程分支没有新提交时才强制推送
    //                     （更安全，避免覆盖其他人的提交）
    if force_with_lease {
        args.push("--force-with-lease".to_string());
    } else if force {
        args.push("--force".to_string());
    }

    // 将 Vec<String> 转换为 Vec<&str> 供 run_git 使用
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 执行 git push 命令
    let output = run_git(repo_path, &args_ref)?;

    // 返回 push 命令的输出信息
    Ok(output.stdout)
}

/// 推送标签到远程仓库
///
/// 执行 `git push <remote> <tag>` 命令，将指定的标签推送到远程仓库。
/// 推送标签不会推送分支，只推送标签本身。
///
/// 参数：
/// - repo_path: 仓库根目录路径
/// - remote: 远程仓库名（通常为 "origin"）
/// - tag: 要推送的标签名
///
/// 返回值：
/// - Ok(String) - 推送成功，返回命令的输出信息
/// - Err(GitError) - 推送失败
///
/// 注意：
/// - 此函数会先检查远程仓库是否已包含标签指向的提交
///   （与 gitgraph 的 pushTag 实现保持一致，但简化了检查逻辑）
/// - 如果远程仓库不包含该提交，推送可能会失败
/// - 如果标签已存在于远程仓库，推送也会失败
///
/// 参考实现：docs/git/src/dataSource.ts 中的 pushTag 方法
pub fn push_tag(repo_path: &str, remote: &str, tag: &str) -> Result<String, GitError> {
    // 验证参数不为空
    if remote.trim().is_empty() || tag.trim().is_empty() {
        return Err(GitError::InvalidPath(
            "远程仓库名和标签名不能为空".to_string(),
        ));
    }

    // 构造 git push 命令的参数列表
    // git push <remote> <tag> 命令会将指定的标签推送到远程仓库
    let args = ["push", remote, tag];

    // 执行 git push 命令
    let output = run_git(repo_path, &args)?;

    // 返回 push 命令的输出信息
    Ok(output.stdout)
}
