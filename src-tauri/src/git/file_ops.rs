/*
 * Git 文件操作模块（File Operations）
 *
 * 此模块封装了与工作区文件操作相关的 git 命令，与 gitgraph 项目 dataSource.ts 的
 * cleanUntrackedFiles 方法对齐，并新增了 reset_file_to_revision 功能。
 *
 * 核心功能：
 * 1. reset_file_to_revision：将单个文件恢复到指定提交的版本（`git checkout {hash} -- {file}`）
 * 2. clean_untracked_files：清理未跟踪的文件（`git clean -f[d]`）
 *
 * 使用场景：
 * - 用户在提交详情中右键文件，选择"Reset File to This Revision"时调用 reset_file_to_revision
 * - 用户在未提交变更的右键菜单中选择"Clean"时调用 clean_untracked_files
 *
 * 依赖关系：
 * file_ops -> commands（使用 run_git 执行 git 命令，使用 GitError 处理错误）
 */

// 引入父模块（git）中的通用命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 将单个文件恢复到指定提交的版本
 *
 * 执行 `git checkout {hash} -- {file}` 命令，将工作区和暂存区中的指定文件
 * 恢复到指定提交时的状态。此操作会同时修改工作区和暂存区。
 *
 * 使用场景：
 * - 在提交详情视图的文件右键菜单中，用户选择"Reset File to This Revision"
 * - 用户想丢弃某个文件的所有修改，恢复到历史某个版本
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - hash: 目标提交的哈希值（也可以是分支名、标签名、HEAD 等任何 git 引用）
 * - file: 要恢复的文件路径（相对于仓库根目录）
 *
 * 返回值：
 * - Ok(()) - 恢复成功
 * - Err(GitError) - 恢复失败（如 hash 不存在、文件不存在于该提交等）
 *
 * 使用示例：
 * ```
 * // 将 src/main.rs 恢复到 abc1234 提交时的版本
 * reset_file_to_revision("/path/to/repo", "abc1234", "src/main.rs")?;
 * ```
 *
 * 底层命令：`git --no-pager checkout abc1234 -- src/main.rs`
 */
pub fn reset_file_to_revision(
    repo_path: &str,
    hash: &str,
    file: &str,
) -> Result<(), GitError> {
    // 构造命令参数：checkout {hash} -- {file}
    // -- 用于分隔引用（hash）和文件路径，避免歧义
    let args = ["checkout", hash, "--", file];

    // 执行 git checkout 命令
    run_git(repo_path, &args)?;

    Ok(())
}

/**
 * 清理未跟踪的文件
 *
 * 执行 `git clean -f[d]` 命令，删除工作区中未被 Git 跟踪的文件。
 * - `-f`：强制删除（git clean 默认不会删除文件，需要 -f 才会真正执行）
 * - `-d`：同时删除未跟踪的目录（directories=true 时添加）
 *
 * ⚠️ 此操作不可逆，被删除的文件无法恢复！调用方应在前端做二次确认。
 *
 * 使用场景：
 * - 用户在未提交变更的右键菜单中选择"Clean Untracked Files"
 * - 清理构建产物、临时文件等未被 Git 跟踪的文件
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - directories: 是否同时删除未跟踪的目录（true=添加 -d 选项）
 *
 * 返回值：
 * - Ok(()) - 清理成功
 * - Err(GitError) - 清理失败
 *
 * 使用示例：
 * ```
 * // 仅清理未跟踪的文件（不包含目录）
 * clean_untracked_files("/path/to/repo", false)?;
 * // 清理未跟踪的文件和目录
 * clean_untracked_files("/path/to/repo", true)?;
 * ```
 *
 * 底层命令：
 * - directories=false: `git --no-pager clean -f`
 * - directories=true:  `git --no-pager clean -fd`
 */
pub fn clean_untracked_files(
    repo_path: &str,
    directories: bool,
) -> Result<(), GitError> {
    // 根据是否包含目录，构造不同的 -f 参数
    // directories=true 时为 "-fd"，否则为 "-f"
    let force_arg = if directories { "-fd" } else { "-f" };

    // 构造命令参数：clean -f[d]
    let args = ["clean", force_arg];

    // 执行 git clean 命令
    run_git(repo_path, &args)?;

    Ok(())
}
