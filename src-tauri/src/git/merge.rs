/*
 * Git 合并（merge）操作模块
 *
 * 此模块封装了 git merge 命令的执行逻辑，用于将指定的分支或提交合并到当前分支。
 *
 * 支持的合并模式：
 * 1. 普通合并：可能产生 fast-forward（快进）或创建合并提交
 * 2. --no-ff 合并：强制创建合并提交（即使可以快进也不快进）
 * 3. --squash 合并：将合并内容压缩到暂存区，不创建合并提交
 * 4. --no-commit 合并：执行合并但不自动创建提交（变更留在暂存区）
 *
 * 对于 --squash 合并（且未指定 --no-commit），会自动执行一次提交，
 * 提交消息格式为 "Merge branch/commit '<obj>'"。
 *
 * 参考实现：docs/git/src/dataSource.ts 中的 merge 方法
 *
 * 依赖关系：
 * merge -> commands（使用 run_git 执行 git 命令）
 * merge -> stage（使用 commit_changes 创建 squash 后的提交）
 *
 * 合并冲突检测（Task 8.1）：
 * 当 merge 操作产生冲突时，run_git 会返回 CommandFailed 错误。
 * 调用方可以在 merge 失败后调用 `crate::git::status::detect_conflicts(repo_path)`
 * 获取冲突文件列表（ConflictFile 数组），每个文件包含 path/ours_hash/theirs_hash/base_hash。
 * 前端据此打开合并编辑器（merge-editor.ts）让用户解决冲突。
 * 冲突解决后，用户执行 git add 标记冲突已解决，再执行 git commit 完成合并。
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 检查暂存区是否有变更
 *
 * 执行 `git diff --cached --quiet` 命令：
 * - 退出码 0：暂存区没有变更
 * - 退出码 1：暂存区有变更
 *
 * 此函数用于 squash 合并后判断是否需要自动创建提交。
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
    // 注意：--quiet 模式下退出码 1 不是错误，而是表示"有差异"
    let result = run_git(repo_path, &["diff", "--cached", "--quiet"]);

    // 根据返回结果判断
    match result {
        // 退出码为 0：暂存区无变更
        Ok(_) => Ok(false),
        // 退出码为 1：暂存区有变更（这是预期行为，不是真正的错误）
        Err(GitError::CommandFailed { exit_code: 1, .. }) => Ok(true),
        // 其他错误：返回给调用方
        Err(e) => Err(e),
    }
}

/**
 * 获取当前 HEAD 的提交哈希
 *
 * 执行 `git rev-parse HEAD` 获取当前 HEAD 指向的提交哈希。
 * 用于在 squash 合并前后判断 HEAD 是否变化（判断是否产生了新提交）。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(String): 当前 HEAD 的提交哈希（40 位完整哈希）
 * - Err(GitError): 命令执行失败
 */
fn get_head_hash(repo_path: &str) -> Result<String, GitError> {
    // 执行 git rev-parse HEAD
    let output = run_git(repo_path, &["rev-parse", "HEAD"])?;
    // 返回去除了首尾空白字符的哈希字符串
    Ok(output.stdout.trim().to_string())
}

/**
 * 执行 git merge 合并操作
 *
 * 将指定的对象（分支、远程跟踪分支或提交）合并到当前分支。
 * 根据参数选择不同的合并策略：
 *
 * 参数组合说明：
 * - squash=false, no_fast_forward=false: 普通合并（优先 fast-forward，否则创建合并提交）
 * - squash=false, no_fast_forward=true: 强制创建合并提交（--no-ff）
 * - squash=true, no_commit=false: squash 合并并自动提交
 * - squash=true, no_commit=true: squash 合并但不提交（变更留在暂存区）
 * - squash=false, no_commit=true: 合并但不提交（变更留在暂存区）
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - obj: 要合并的对象（分支名、远程跟踪分支名如 origin/main、或提交哈希）
 * - squash: 是否启用 --squash（压缩合并）
 * - no_fast_forward: 是否启用 --no-ff（禁止快进，强制创建合并提交）
 *                    注意：squash=true 时此参数被忽略（squash 优先级高于 no-ff）
 * - no_commit: 是否启用 --no-commit（合并不自动提交）
 * - sign: 是否启用 GPG 签名（-S 选项）
 *
 * 返回值：
 * - Ok(Some(String)): 合并成功且产生了新提交，返回新提交的哈希
 * - Ok(None): 合并成功但未产生新提交（如 --no-commit 模式，或已是最新无需合并）
 * - Err(GitError): 合并失败（如存在合并冲突、对象不存在等）
 *
 * 使用示例：
 * ```
 * // 普通合并 feature 分支到当前分支
 * merge("/path/to/repo", "feature", false, false, false, false)?;
 *
 * // squash 合并并自动提交
 * merge("/path/to/repo", "feature", true, false, false, false)?;
 * ```
 */
pub fn merge(
    repo_path: &str,
    obj: &str,
    squash: bool,
    no_fast_forward: bool,
    no_commit: bool,
    sign: bool,
) -> Result<Option<String>, GitError> {
    // 验证合并对象不为空
    if obj.trim().is_empty() {
        return Err(GitError::InvalidPath("合并对象不能为空".to_string()));
    }

    // 记录合并前的 HEAD 哈希，用于后续判断是否产生了新提交
    let head_before = get_head_hash(repo_path).ok();

    // 构造 git merge 命令的参数列表
    // 使用 Vec<String> 动态构建参数，因为参数数量根据选项动态变化
    let mut args: Vec<String> = vec!["merge".to_string(), obj.to_string()];

    // 添加 --squash 或 --no-ff 选项
    // 注意：squash 和 no-ff 是互斥的合并策略，squash 优先（与 gitgraph 实现保持一致）
    if squash {
        args.push("--squash".to_string());
    } else if no_fast_forward {
        args.push("--no-ff".to_string());
    }

    // 添加 --no-commit 选项
    if no_commit {
        args.push("--no-commit".to_string());
    }

    // 添加 GPG 签名选项 -S
    if sign {
        args.push("-S".to_string());
    }

    // 将 Vec<String> 转换为 Vec<&str> 供 run_git 使用
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 执行 git merge 命令
    // 如果合并产生冲突，run_git 会返回 CommandFailed 错误
    let _output = run_git(repo_path, &args_ref)?;

    // 对于 squash 合并且未指定 --no-commit 的情况，需要自动创建提交
    // 因为 git merge --squash 默认不会创建提交，只是把变更放入暂存区
    if squash && !no_commit {
        // 检查暂存区是否有变更（squash 合并应该会将有变更的文件加入暂存区）
        if has_staged_changes(repo_path)? {
            // 构造提交消息：与 gitgraph 保持一致的格式
            // 例如：Merge branch 'feature' 或 Merge commit 'abc1234'
            let commit_message = format!("Merge '{}'", obj);

            // 执行 git commit 创建提交
            // 注意：这里不复用 stage::commit_changes，因为需要支持 -S 签名选项
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

    // 获取合并后的 HEAD 哈希
    let head_after = get_head_hash(repo_path).ok();

    // 判断是否产生了新提交
    // 通过比较合并前后的 HEAD 哈希来判断
    match (head_before, head_after) {
        (Some(before), Some(after)) => {
            if before != after {
                // HEAD 发生了变化，说明产生了新提交
                Ok(Some(after))
            } else {
                // HEAD 没有变化（可能是 --no-commit 模式，或已是最新无需合并）
                Ok(None)
            }
        }
        // 无法获取 HEAD 哈希，无法判断是否产生了新提交，返回 None
        _ => Ok(None),
    }
}
