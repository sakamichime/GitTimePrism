/*
 * Git 拣选（cherry-pick）操作模块
 *
 * 此模块封装了 git cherry-pick 命令的执行逻辑，用于将指定的提交"拣选"到当前分支。
 *
 * 拣选的工作原理：
 * 假设有以下历史：
 *   A---B---C (feature)
 *    \
 *     D (main)
 * 如果在 main 分支上执行 git cherry-pick C，会将 C 提交的变更应用到 main 分支：
 *   A---B---C (feature)
 *    \
 *     D---C' (main)
 * 其中 C' 是 C 的副本（哈希不同，但变更内容相同）。
 *
 * 支持的选项：
 * 1. --no-commit: 拣选但不创建提交（变更留在暂存区）
 * 2. -x: 在提交消息中附加 "(cherry picked from commit ...)" 标记
 * 3. -S: GPG 签名提交
 * 4. -m <parent>: 指定父提交索引（用于拣选合并提交）
 *
 * 参考实现：docs/git/src/dataSource.ts 中的 cherrypickCommit 方法
 *
 * 依赖关系：
 * cherry_pick -> commands（使用 run_git 执行 git 命令）
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 执行 git cherry-pick 拣选操作
 *
 * 将指定提交的变更应用到当前分支。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - hash: 要拣选的提交哈希值（可以是完整哈希或短哈希）
 * - no_commit: 是否启用 --no-commit（拣选但不创建提交，变更留在暂存区）
 * - record_origin: 是否启用 -x（在提交消息中附加来源标记）
 * - sign: 是否启用 GPG 签名（-S 选项）
 * - mainline: 父提交索引（用于拣选合并提交，0 表示不指定）
 *             当拣选合并提交时，需要指定 -m <parent> 告诉 git 使用哪个父提交作为主线
 *
 * 返回值：
 * - Ok(()): 拣选成功
 * - Err(GitError): 拣选失败（如存在冲突、提交不存在等）
 *
 * 注意：
 * - 如果拣选过程中产生冲突，git 会暂停并等待用户解决冲突
 *   此函数会返回错误，用户解决冲突后需要执行 git cherry-pick --continue
 * - 拣选不会改变原始提交，只是在当前分支上创建一个变更相同的副本
 *
 * 使用示例：
 * ```
 * // 普通拣选
 * cherrypick("/path/to/repo", "abc1234", false, false, false, 0)?;
 *
 * // 拣选合并提交（使用第一个父提交作为主线）
 * cherrypick("/path/to/repo", "abc1234", false, false, false, 1)?;
 *
 * // 拣选但不提交
 * cherrypick("/path/to/repo", "abc1234", true, false, false, 0)?;
 * ```
 */
pub fn cherrypick(
    repo_path: &str,
    hash: &str,
    no_commit: bool,
    record_origin: bool,
    sign: bool,
    mainline: u32,
) -> Result<(), GitError> {
    // 验证提交哈希不为空
    if hash.trim().is_empty() {
        return Err(GitError::InvalidPath("提交哈希不能为空".to_string()));
    }

    // 构造 git cherry-pick 命令的参数列表
    let mut args: Vec<String> = vec!["cherry-pick".to_string()];

    // 添加 --no-commit 选项
    // --no-commit: 拣选变更但不创建提交，变更会留在暂存区
    if no_commit {
        args.push("--no-commit".to_string());
    }

    // 添加 -x 选项
    // -x: 在拣选的提交消息中附加 "(cherry picked from commit <hash>)" 标记
    // 这对于记录变更来源很有用，特别是当拣选的提交来自其他分支时
    if record_origin {
        args.push("-x".to_string());
    }

    // 添加 GPG 签名选项 -S
    if sign {
        args.push("-S".to_string());
    }

    // 添加 -m <parent> 选项（仅当 mainline > 0 时）
    // -m 选项用于拣选合并提交（merge commit）
    // 合并提交有多个父提交，需要指定使用哪个父提交作为主线
    // 例如：-m 1 表示使用第一个父提交（通常是合并前的当前分支）
    if mainline > 0 {
        args.push("-m".to_string());
        args.push(mainline.to_string());
    }

    // 添加要拣选的提交哈希
    args.push(hash.to_string());

    // 将 Vec<String> 转换为 Vec<&str> 供 run_git 使用
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 执行 git cherry-pick 命令
    run_git(repo_path, &args_ref)?;

    Ok(())
}
