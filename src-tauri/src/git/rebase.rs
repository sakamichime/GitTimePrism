/*
 * Git 变基（rebase）操作模块
 *
 * 此模块封装了 git rebase 命令的执行逻辑，用于将当前分支的提交"变基"到指定对象之上。
 *
 * 变基的工作原理：
 * 假设当前分支为 feature，原始历史为：
 *   A---B---C (feature)
 *        \
 *         D---E (main)
 * 执行 git rebase main 后，历史变为：
 *   A---B---D---E (main)
 *        \
 *         C'---B'---C' (feature)
 * 即 feature 分支的提交被"重新播放"到 main 分支的最新提交之上。
 *
 * 支持的选项：
 * 1. --ignore-date: 保持原始提交日期不变（默认会更新提交日期）
 * 2. -S: GPG 签名提交
 * 3. --interactive: 交互式变基（由前端在 PTY 终端启动，本模块返回特殊标记）
 *
 * 参考实现：docs/git/src/dataSource.ts 中的 rebase 方法
 *
 * 依赖关系：
 * rebase -> commands（使用 run_git 执行 git 命令）
 *
 * 合并冲突检测（Task 8.1）：
 * 当 rebase 操作产生冲突时（变基过程中提交重放产生冲突），
 * run_git 会返回 CommandFailed 错误，git 会暂停变基等待用户解决冲突。
 * 调用方可以在 rebase 失败后调用 `crate::git::status::detect_conflicts(repo_path)`
 * 获取冲突文件列表（ConflictFile 数组），每个文件包含 path/ours_hash/theirs_hash/base_hash。
 * 前端据此打开合并编辑器（merge-editor.ts）让用户解决冲突。
 * 冲突解决后，用户执行 git add 标记冲突已解决，再执行 git rebase --continue 继续变基。
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 交互式变基的特殊标记
 *
 * 当 interactive=true 时，rebase 函数会返回此标记。
 * 前端收到此标记后，会在 PTY 终端中启动交互式变基，
 * 让用户在终端中完成交互式操作。
 */
pub const INTERACTIVE_REBASE_MARKER: &str = "__INTERACTIVE_REBASE__";

/**
 * 执行 git rebase 变基操作
 *
 * 将当前分支的提交变基到指定的对象（分支或提交）之上。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - obj: 要变基到的目标对象（分支名、远程跟踪分支名、或提交哈希）
 * - ignore_date: 是否启用 --ignore-date（保持原始提交日期不变）
 * - sign: 是否启用 GPG 签名（-S 选项）
 * - interactive: 是否启用交互式变基（true 时返回特殊标记，由前端处理）
 *
 * 返回值：
 * - Ok(()): 变基成功完成
 * - Err(GitError): 变基失败（如存在冲突、对象不存在等）
 *
 * 注意：
 * - 当 interactive=true 时，函数总是返回 Ok(())（不实际执行变基），
 *   前端通过判断 interactive 参数自行决定是否启动 PTY 终端
 *   （实际上前端会直接调用 PTY，不会调用此后端命令，这里保留参数为了 API 一致性）
 * - 变基是改写历史的操作，如果分支已推送到远程，可能导致其他协作者的问题
 * - 如果变基过程中产生冲突，git 会暂停变基并等待用户解决冲突
 *   此函数会返回错误，用户解决冲突后需要执行 git rebase --continue
 *
 * 使用示例：
 * ```
 * // 将当前分支变基到 main 分支
 * rebase("/path/to/repo", "main", false, false, false)?;
 *
 * // 变基并保持原始提交日期
 * rebase("/path/to/repo", "main", true, false, false)?;
 * ```
 */
pub fn rebase(
    repo_path: &str,
    obj: &str,
    ignore_date: bool,
    sign: bool,
    interactive: bool,
) -> Result<(), GitError> {
    // 验证变基目标不为空
    if obj.trim().is_empty() {
        return Err(GitError::InvalidPath("变基目标不能为空".to_string()));
    }

    // 交互式变基由前端在 PTY 终端中执行
    // 这里不实际执行命令，直接返回成功
    // 前端通过判断 interactive 参数决定是否调用 PTY
    if interactive {
        // 交互式变基需要用户在终端中交互，后端不处理
        // 返回成功，让前端去启动 PTY 终端
        return Ok(());
    }

    // 构造 git rebase 命令的参数列表
    let mut args: Vec<String> = vec!["rebase".to_string(), obj.to_string()];

    // 添加 --ignore-date 选项
    // --ignore-date: 在变基过程中保持原始提交的作者日期不变
    // 默认情况下，变基会更新提交的提交日期（committer date）
    if ignore_date {
        args.push("--ignore-date".to_string());
    }

    // 添加 GPG 签名选项 -S
    // 变基会重写提交，启用了 -S 后新的提交也会被签名
    if sign {
        args.push("-S".to_string());
    }

    // 将 Vec<String> 转换为 Vec<&str> 供 run_git 使用
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 执行 git rebase 命令
    // 如果变基产生冲突，run_git 会返回 CommandFailed 错误
    run_git(repo_path, &args_ref)?;

    Ok(())
}
