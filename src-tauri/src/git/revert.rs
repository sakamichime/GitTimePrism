/*
 * Git 还原（revert）操作模块
 *
 * 此模块封装了 git revert 命令的执行逻辑，用于创建一个反向提交来撤销指定提交的变更。
 *
 * revert 与 reset 的区别：
 * - reset: 移动分支指针到历史中的某个提交（改写历史，危险操作）
 *          适合：本地未推送的提交
 * - revert: 创建一个新的反向提交，撤销指定提交的变更（不改写历史，安全操作）
 *           适合：已推送到远程的提交
 *
 * 工作原理：
 * 假设历史为 A---B---C---D (main)
 * 执行 git revert B 后，历史变为：
 *   A---B---C---D---B' (main)
 * 其中 B' 是 B 的反向提交（撤销 B 引入的变更）。
 *
 * 支持的选项：
 * 1. --no-edit: 使用默认的提交消息（不打开编辑器）
 * 2. -S: GPG 签名提交
 * 3. -m <parent>: 指定父提交索引（用于还原合并提交）
 *
 * 参考实现：docs/git/src/dataSource.ts 中的 revertCommit 方法
 *
 * 依赖关系：
 * revert -> commands（使用 run_git 执行 git 命令）
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 执行 git revert 还原操作
 *
 * 创建一个反向提交，撤销指定提交引入的变更。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - hash: 要还原的提交哈希值（可以是完整哈希或短哈希）
 * - sign: 是否启用 GPG 签名（-S 选项）
 * - mainline: 父提交索引（用于还原合并提交，0 表示不指定）
 *             当还原合并提交时，需要指定 -m <parent> 告诉 git 使用哪个父提交作为主线
 *
 * 返回值：
 * - Ok(()): 还原成功
 * - Err(GitError): 还原失败（如存在冲突、提交不存在等）
 *
 * 注意：
 * - 还原不会改写历史，而是创建新的提交（安全操作）
 * - 如果还原过程中产生冲突，git 会暂停并等待用户解决冲突
 *   此函数会返回错误，用户解决冲突后需要执行 git revert --continue
 * - 默认使用 --no-edit 选项，不打开编辑器，使用自动生成的提交消息
 *
 * 使用示例：
 * ```
 * // 普通还原
 * revert("/path/to/repo", "abc1234", false, 0)?;
 *
 * // 还原合并提交（使用第一个父提交作为主线）
 * revert("/path/to/repo", "abc1234", false, 1)?;
 * ```
 */
pub fn revert(
    repo_path: &str,
    hash: &str,
    sign: bool,
    mainline: u32,
) -> Result<(), GitError> {
    // 验证提交哈希不为空
    if hash.trim().is_empty() {
        return Err(GitError::InvalidPath("提交哈希不能为空".to_string()));
    }

    // 构造 git revert 命令的参数列表
    let mut args: Vec<String> = vec!["revert".to_string()];

    // 添加 --no-edit 选项
    // --no-edit: 使用自动生成的提交消息，不打开编辑器
    // 这与 gitgraph 的实现保持一致
    args.push("--no-edit".to_string());

    // 添加 GPG 签名选项 -S
    if sign {
        args.push("-S".to_string());
    }

    // 添加 -m <parent> 选项（仅当 mainline > 0 时）
    // -m 选项用于还原合并提交（merge commit）
    // 合并提交有多个父提交，需要指定使用哪个父提交作为主线
    // 例如：-m 1 表示使用第一个父提交（通常是合并前的当前分支）
    if mainline > 0 {
        args.push("-m".to_string());
        args.push(mainline.to_string());
    }

    // 添加要还原的提交哈希
    args.push(hash.to_string());

    // 将 Vec<String> 转换为 Vec<&str> 供 run_git 使用
    let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();

    // 执行 git revert 命令
    run_git(repo_path, &args_ref)?;

    Ok(())
}
