/*
 * Git 拉取操作模块
 *
 * 此模块封装了 git pull 命令的执行逻辑。
 * git pull 的作用是从远程仓库拉取（fetch）更新，并自动合并到当前分支。
 *
 * 工作流程：
 * 1. 前端通过 Tauri IPC 调用 commands/remote.rs 中的 pull_changes 命令
 * 2. pull_changes 调用本模块的 pull 或 pull_with_options 函数
 * 3. 函数通过 git/commands.rs 中的 run_git 执行实际的 git 命令
 *
 * 依赖关系：
 * pull -> commands（使用 run_git 执行 git 命令，使用 GitError 处理错误）
 *
 * 合并冲突检测（Task 8.1）：
 * 当 pull 操作产生冲突时（本地和远程修改了同一文件的同一部分），
 * run_git 会返回 CommandFailed 错误。
 * 调用方可以在 pull 失败后调用 `crate::git::status::detect_conflicts(repo_path)`
 * 获取冲突文件列表（ConflictFile 数组），每个文件包含 path/ours_hash/theirs_hash/base_hash。
 * 前端据此打开合并编辑器（merge-editor.ts）让用户解决冲突。
 * 冲突解决后，用户执行 git add 标记冲突已解决，再执行 git commit 完成 pull 合并。
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/// 从远程仓库拉取更新
///
/// 执行 `git pull <remote> <branch>` 命令，将远程仓库的指定分支更新
/// 拉取到本地并自动合并到当前工作分支。
///
/// 这是简化的 pull 函数，不支持任何选项。如需使用 --squash / --no-ff / -S 等选项，
/// 请使用 pull_with_options 函数。
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

/**
 * 检查暂存区是否有变更
 *
 * 执行 `git diff --cached --quiet` 命令：
 * - 退出码 0：暂存区没有变更
 * - 退出码 1：暂存区有变更
 *
 * 此函数用于 squash 拉取后判断是否需要自动创建提交。
 * 与 merge.rs 中的同名函数实现一致，为了保持模块独立性而单独定义。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(true): 暂存区有变更
 * - Ok(false): 暂存区没有变更
 * - Err(GitError): 命令执行失败
 */
fn has_staged_changes(repo_path: &str) -> Result<bool, GitError> {
    // git diff --cached --quiet 命令说明：
    // --cached: 只比较暂存区与 HEAD 的差异
    // --quiet: 静默模式，有差异时退出码为 1，无差异时退出码为 0
    let result = run_git(repo_path, &["diff", "--cached", "--quiet"]);

    match result {
        // 退出码为 0：暂存区无变更
        Ok(_) => Ok(false),
        // 退出码为 1：暂存区有变更（这是预期行为，不是错误）
        Err(GitError::CommandFailed { exit_code: 1, .. }) => Ok(true),
        // 其他错误：返回给调用方
        Err(e) => Err(e),
    }
}

/// 从远程仓库拉取更新（带选项）
///
/// 执行 `git pull <remote> <branch> [--squash|--no-ff] [-S]` 命令。
/// 与 pull 函数的区别：此函数支持以下选项：
/// - squash: 启用 --squash（压缩拉取，将合并内容放入暂存区不创建合并提交）
/// - no_fast_forward: 启用 --no-ff（禁止快进，强制创建合并提交）
/// - sign: 启用 -S（GPG 签名提交）
///
/// 对于 squash 拉取，会自动检查暂存区是否有变更，如果有则自动创建提交
/// （与 gitgraph 的 pullBranch 实现保持一致）。
///
/// 参数：
/// - repo_path: 仓库根目录路径
/// - remote: 远程仓库名（通常为 "origin"）
/// - branch: 要拉取的远程分支名
/// - squash: 是否启用 --squash（压缩拉取）
/// - no_fast_forward: 是否启用 --no-ff（禁止快进，强制创建合并提交）
///                    注意：squash=true 时此参数被忽略（squash 优先级高于 no-ff）
/// - sign: 是否启用 GPG 签名（-S 选项）
///
/// 返回值：
/// - Ok(String) - 拉取成功，返回命令的输出信息
/// - Err(GitError) - 拉取失败
///
/// 参考实现：docs/git/src/dataSource.ts 中的 pullBranch 方法
pub fn pull_with_options(
    repo_path: &str,
    remote: &str,
    branch: &str,
    squash: bool,
    no_fast_forward: bool,
    sign: bool,
) -> Result<String, GitError> {
    // 构造 git pull 命令的参数列表
    let mut args: Vec<String> = vec!["pull".to_string(), remote.to_string(), branch.to_string()];

    // 添加 --squash 或 --no-ff 选项
    // 注意：squash 和 no-ff 是互斥的策略，squash 优先（与 gitgraph 实现保持一致）
    if squash {
        args.push("--squash".to_string());
    } else if no_fast_forward {
        args.push("--no-ff".to_string());
    }

    // 添加 GPG 签名选项 -S
    if sign {
        args.push("-S".to_string());
    }

    // 将 Vec<String> 转换为 Vec<&str> 供 run_git 使用
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 执行 git pull 命令
    let output = run_git(repo_path, &args_ref)?;

    // 对于 squash 拉取，需要自动检查暂存区是否有变更并创建提交
    // 因为 git pull --squash 不会自动创建提交，只是把变更放入暂存区
    if squash {
        // 检查暂存区是否有变更
        if has_staged_changes(repo_path)? {
            // 构造提交消息：与 gitgraph 保持一致的格式
            let commit_message = format!("Merge branch '{}/{}'", remote, branch);

            // 执行 git commit 创建提交
            let mut commit_args: Vec<String> = vec!["commit".to_string()];
            if sign {
                commit_args.push("-S".to_string());
            }
            commit_args.push("-m".to_string());
            commit_args.push(commit_message);

            let commit_args_ref: Vec<&str> =
                commit_args.iter().map(|s| s.as_str()).collect();
            run_git(repo_path, &commit_args_ref)?;
        }
    }

    // 返回 pull 命令的输出信息
    Ok(output.stdout)
}
