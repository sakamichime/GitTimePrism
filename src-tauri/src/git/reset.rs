/*
 * Git 撤销提交（reset）操作模块
 *
 * 此模块封装了 git reset 的三种模式：
 * - soft：  只撤销 commit，保留更改在暂存区（最安全）
 * - mixed： 撤销 commit 和暂存，保留更改在工作区（默认模式）
 * - hard：  撤销 commit、暂存和工作区的所有更改（危险，会丢失未提交内容）
 *
 * 使用场景：
 * - 用户刚刚 commit 后发现提交信息写错了 → soft reset，重新 commit
 * - 用户想重新组织提交的文件 → mixed reset，重新 add
 * - 用户想彻底丢弃某次提交的所有更改 → hard reset（谨慎！）
 *
 * 依赖：
 * - 使用 super::commands::{run_git, GitError} 执行实际的 git 命令
 */

// 引入父模块（git）中的通用命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 执行 git reset --soft <commit>
 *
 * 作用：撤销 commit，但保留所有更改在暂存区（staged 状态）
 * 相当于"时光倒流"到指定的 commit，HEAD 指针移动过去，
 * 但暂存区的内容保持为"撤销前的状态"，所以用户可以直接重新 commit。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径（必须是有效的 Git 仓库）
 * - commit:    要回退到的目标 commit（可以是 SHA、分支名、HEAD~1 等）
 *
 * 返回：
 * - Ok(())：命令执行成功
 * - Err(GitError)：执行失败（例如不是 Git 仓库、commit 不存在等）
 *
 * 底层命令：git --no-pager reset --soft <commit>
 */
pub fn reset_soft(repo_path: &str, commit: &str) -> Result<(), GitError> {
    // 构造 git reset --soft 命令的参数列表
    // "reset" 是 git 子命令，"--soft" 指定软重置模式，commit 是目标提交
    let args = ["reset", "--soft", commit];

    // 调用通用执行器运行 git 命令
    // run_git 会自动处理 --no-pager、Windows 窗口隐藏等跨平台细节
    let _output = run_git(repo_path, &args)?;

    // 命令成功执行，返回 Ok
    Ok(())
}

/**
 * 执行 git reset --mixed <commit>
 *
 * 作用：撤销 commit 和暂存（unstage），但保留更改在工作区（未暂存状态）
 * 这是 git reset 的默认模式。HEAD 指针移动过去，暂存区被清空为目标 commit 的状态，
 * 所以用户之前暂存的文件会变成"未暂存"状态，需要重新 git add。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - commit:    要回退到的目标 commit
 *
 * 返回：
 * - Ok(())：命令执行成功
 * - Err(GitError)：执行失败
 *
 * 底层命令：git --no-pager reset --mixed <commit>
 */
pub fn reset_mixed(repo_path: &str, commit: &str) -> Result<(), GitError> {
    // 构造 git reset --mixed 命令的参数列表
    let args = ["reset", "--mixed", commit];

    // 执行命令
    let _output = run_git(repo_path, &args)?;

    Ok(())
}

/**
 * 执行 git reset --hard <commit>
 *
 * ⚠️ 危险操作 ⚠️
 * 作用：撤销 commit、暂存、工作区的所有更改，彻底回到目标 commit 的状态
 * 所有未提交的修改（包括已暂存和未暂存的）都会被永久丢弃，无法恢复！
 *
 * 使用此函数前务必让用户二次确认，避免误操作导致数据丢失。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - commit:    要回退到的目标 commit
 *
 * 返回：
 * - Ok(())：命令执行成功
 * - Err(GitError)：执行失败
 *
 * 底层命令：git --no-pager reset --hard <commit>
 */
pub fn reset_hard(repo_path: &str, commit: &str) -> Result<(), GitError> {
    // 构造 git reset --hard 命令的参数列表
    let args = ["reset", "--hard", commit];

    // 执行命令（危险操作，但这里只做执行，确认逻辑交给前端）
    let _output = run_git(repo_path, &args)?;

    Ok(())
}

/**
 * 检查仓库是否有足够的提交可以撤销
 *
 * 执行 `git rev-parse --verify HEAD~1` 来验证 HEAD~1 是否存在。
 * 如果仓库只有 1 个提交（或没有提交），HEAD~1 不存在，无法撤销。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 *
 * 返回：
 * - Ok(true)：有足够的提交可以撤销（HEAD~1 存在）
 * - Ok(false)：没有足够的提交（仓库为空或只有 1 个提交）
 * - Err(GitError)：执行检查时出错
 */
fn can_reset(repo_path: &str) -> Result<bool, GitError> {
    let result = run_git(repo_path, &["rev-parse", "--verify", "HEAD~1"]);
    match result {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/**
 * 统一的 reset 入口函数
 *
 * 根据传入的 mode 字符串，自动调用对应的 reset 函数：
 * - "soft"  → reset_soft  （保留更改在暂存区）
 * - "mixed" → reset_mixed （保留更改在工作区）
 * - "hard"  → reset_hard  （完全丢弃更改）
 *
 * 此函数是前端 Tauri 命令直接调用的接口，前端只需传一个 mode 字符串即可。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - mode:      重置模式，必须是 "soft"、"mixed"、"hard" 之一（大小写敏感）
 *
 * 返回：
 * - Ok(())：命令执行成功
 * - Err(GitError)：执行失败，或 mode 参数无效
 *
 * 错误处理：
 * - 如果 mode 不是上述三个值之一，会返回 GitError::CommandFailed，
 *   错误消息中会提示合法的模式值
 * - 如果仓库没有足够的提交可以撤销（只有 0 或 1 个提交），也会返回错误
 */
pub fn reset_commit(repo_path: &str, mode: &str) -> Result<(), GitError> {
    // 调用新的扩展版本，传入 None 表示使用默认的 HEAD~1
    reset_commit_to(repo_path, mode, None)
}

/**
 * 统一的 reset 入口函数（扩展版本，支持 reset 到任意 commit）
 *
 * 根据传入的 mode 字符串和可选的 commit 参数，执行 reset 操作。
 * 与 reset_commit 的区别：此函数支持指定任意 commit 作为重置目标。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - mode:      重置模式，必须是 "soft"、"mixed"、"hard" 之一（大小写敏感）
 * - commit:    要重置到的目标 commit（可选）
 *              - Some(commit): 重置到指定的 commit（可以是 SHA、分支名、HEAD~N 等）
 *              - None: 重置到 HEAD~1（撤销最近一次提交，与原 reset_commit 行为一致）
 *
 * 返回：
 * - Ok(())：命令执行成功
 * - Err(GitError)：执行失败，或 mode 参数无效
 *
 * 错误处理：
 * - 如果 mode 不是 "soft"、"mixed"、"hard" 之一，返回错误
 * - 如果 commit 为 None 且仓库提交不足（只有 0 或 1 个提交），返回错误
 *   （因为 HEAD~1 不存在）
 * - 如果 commit 为 Some，则不做 HEAD~1 存在性检查（由 git 命令本身验证 commit 有效性）
 *
 * 参考实现：docs/git/src/dataSource.ts 中的 resetToCommit 方法
 */
pub fn reset_commit_to(
    repo_path: &str,
    mode: &str,
    commit: Option<&str>,
) -> Result<(), GitError> {
    // 确定要重置到的目标 commit
    // 如果 commit 参数为 None 或空字符串，使用默认的 HEAD~1
    let target = match commit {
        Some(c) if !c.trim().is_empty() => c,
        // None 或空字符串：使用 HEAD~1（撤销最近一次提交）
        _ => {
            // 对于 HEAD~1 的情况，先检查是否有足够的提交可以撤销
            if !can_reset(repo_path)? {
                return Err(GitError::CommandFailed {
                    exit_code: -1,
                    message:
                        "无法撤销：仓库中没有足够的提交记录（需要至少 2 个提交才能撤销）"
                            .to_string(),
                });
            }
            "HEAD~1"
        }
    };

    // 根据 mode 字符串分发到对应的具体实现函数
    match mode {
        // 软重置：撤销 commit，保留暂存
        "soft" => reset_soft(repo_path, target),
        // 混合重置：撤销 commit 和暂存，保留工作区
        "mixed" => reset_mixed(repo_path, target),
        // 硬重置：完全撤销，丢弃所有更改
        "hard" => reset_hard(repo_path, target),
        // 其他值视为非法参数，返回错误
        _ => Err(GitError::CommandFailed {
            exit_code: -1,
            message: format!(
                "无效的 reset 模式: '{}'。合法的模式为: soft, mixed, hard",
                mode
            ),
        }),
    }
}
