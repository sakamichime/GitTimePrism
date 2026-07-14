/*
 * Git 丢弃提交（drop commit）操作模块
 *
 * 此模块封装了通过 git rebase --onto 实现的"丢弃提交"功能。
 *
 * 工作原理：
 * 要丢弃提交 X，使用 `git rebase --onto X^ X` 命令。
 * 这会将 X 之后的所有提交"重新播放"到 X 的父提交之上，跳过 X 本身。
 *
 * 假设历史为 A---B---C---D (main)，要丢弃 B：
 * 执行 git rebase --onto B^ B 后，历史变为：
 *   A---C'---D' (main)
 * 其中 C' 和 D' 是 C 和 D 的副本（哈希不同，但变更内容相同）。
 *
 * 拓扑可行性检查：
 * - 不能丢弃 HEAD 的祖先提交（包括 HEAD 本身）
 *   原因：如果 X 是 HEAD 的祖先，那么 rebase --onto X^ X 会试图
 *         将 HEAD 之后的提交（没有）重新播放，导致 HEAD 移动到 X^，
 *         从而丢失从 X 到 HEAD 之间的所有提交
 *
 * 参考实现：docs/git/src/dataSource.ts 中的 dropCommit 方法
 *
 * 依赖关系：
 * drop_commit -> commands（使用 run_git 执行 git 命令）
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 检查指定的提交是否是 HEAD 的祖先（包括 HEAD 本身）
 *
 * 执行 `git merge-base --is-ancestor <hash> HEAD` 命令：
 * - 退出码 0：hash 是 HEAD 的祖先
 * - 退出码 1：hash 不是 HEAD 的祖先
 *
 * 此函数用于在丢弃提交前进行拓扑可行性检查。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - hash: 要检查的提交哈希
 *
 * 返回值：
 * - Ok(true): hash 是 HEAD 的祖先（不能丢弃）
 * - Ok(false): hash 不是 HEAD 的祖先（可以丢弃）
 * - Err(GitError): 命令执行失败（不是祖先也不是 HEAD 的判断错误）
 */
fn is_ancestor_of_head(repo_path: &str, hash: &str) -> Result<bool, GitError> {
    // git merge-base --is-ancestor 命令说明：
    // --is-ancestor: 检查第一个提交是否是第二个提交的祖先
    // 退出码 0 表示是祖先，退出码 1 表示不是祖先
    let result = run_git(repo_path, &["merge-base", "--is-ancestor", hash, "HEAD"]);

    match result {
        // 退出码为 0：hash 是 HEAD 的祖先
        Ok(_) => Ok(true),
        // 退出码为 1：hash 不是 HEAD 的祖先（这是预期行为，不是错误）
        Err(GitError::CommandFailed { exit_code: 1, .. }) => Ok(false),
        // 其他错误：返回给调用方
        Err(e) => Err(e),
    }
}

/**
 * 丢弃指定的提交
 *
 * 通过 `git rebase --onto <hash>^ <hash>` 命令实现丢弃提交。
 * 这会改写历史，将指定提交之后的所有提交重新播放到该提交的父提交之上，
 * 从而"跳过"该提交。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - hash: 要丢弃的提交哈希值
 * - sign: 是否启用 GPG 签名（-S 选项，对重写后的提交进行签名）
 *
 * 返回值：
 * - Ok(()): 丢弃成功
 * - Err(GitError): 丢弃失败（如存在冲突、提交是 HEAD 祖先等）
 *
 * 注意：
 * - ⚠️ 危险操作 ⚠️ 此操作会改写 Git 历史
 * - 如果该提交已推送到远程，可能导致其他协作者的问题
 * - 如果 rebase 过程中产生冲突，git 会暂停并等待用户解决冲突
 *   此函数会返回错误，用户解决冲突后需要执行 git rebase --continue
 * - 不能丢弃 HEAD 的祖先提交（包括 HEAD 本身），否则会丢失中间的提交
 *
 * 使用示例：
 * ```
 * // 丢弃提交 abc1234
 * drop_commit("/path/to/repo", "abc1234", false)?;
 * ```
 */
pub fn drop_commit(repo_path: &str, hash: &str, sign: bool) -> Result<(), GitError> {
    // 验证提交哈希不为空
    if hash.trim().is_empty() {
        return Err(GitError::InvalidPath("提交哈希不能为空".to_string()));
    }

    // 拓扑可行性检查：不能丢弃 HEAD 的祖先提交
    // 原因：如果 hash 是 HEAD 的祖先，rebase --onto hash^ hash 会将 HEAD
    //       移动到 hash^，从而丢失从 hash 到原 HEAD 之间的所有提交
    if is_ancestor_of_head(repo_path, hash)? {
        return Err(GitError::CommandFailed {
            exit_code: -1,
            message: format!(
                "无法丢弃提交 '{}'：该提交是 HEAD 的祖先（包括 HEAD 本身），\
                 丢弃它会导致从该提交到 HEAD 之间的所有提交丢失",
                hash
            ),
        });
    }

    // 构造 hash^ 字符串（hash 的父提交）
    // 注意：使用字符串拼接而不是直接传 "hash^"，因为 hash 是动态的
    let onto_ref = format!("{}^", hash);

    // 构造 git rebase 命令的参数列表
    let mut args: Vec<String> = vec!["rebase".to_string()];

    // 添加 GPG 签名选项 -S（必须在 --onto 之前）
    if sign {
        args.push("-S".to_string());
    }

    // 添加 --onto 选项
    // --onto <newbase> <upstream>: 将 <upstream> 之后的所有提交重新播放到 <newbase> 之上
    // 这里 newbase = hash^ （hash 的父提交），upstream = hash
    // 效果：跳过 hash，将 hash 之后的提交重新播放到 hash 的父提交之上
    args.push("--onto".to_string());
    args.push(onto_ref);
    args.push(hash.to_string());

    // 将 Vec<String> 转换为 Vec<&str> 供 run_git 使用
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 执行 git rebase 命令
    run_git(repo_path, &args_ref)?;

    Ok(())
}
