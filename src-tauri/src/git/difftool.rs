/*
 * Git Difftool 模块
 *
 * 此模块负责调用外部差异工具（difftool）进行目录级别的差异对比。
 *
 * git difftool --dir-diff 会启动用户配置的差异工具（如 Beyond Compare、KDiff3、Meld 等），
 * 对比两个提交（或暂存区/工作区）之间的完整目录差异。
 *
 * 与内置的 diff 视图相比，difftool 通常提供更强大的可视化能力
 * （并排对比、三栏合并、语法高亮等），适合处理复杂的代码变更。
 *
 * 用户需要在 Git 配置中设置 diff.tool（如 `git config diff.tool bc`），
 * 否则 git difftool 会提示用户选择内置工具。
 */

use super::commands::{run_git, GitError};

/**
 * 打开目录级差异对比
 *
 * 执行 `git difftool --dir-diff [--gui] [{from}] [{to}]` 命令。
 *
 * 参数说明：
 * - from/to 为空时：对比暂存区与工作区（默认行为）
 * - 只提供 from：对比 from 与工作区
 * - 同时提供 from 和 to：对比两个提交之间的差异
 *
 * --dir-diff 选项：对比整个目录而非单个文件，
 *   difftool 会将两个版本的文件分别复制到临时目录，然后启动差异工具对比两个目录。
 *
 * --gui 选项：强制使用 GUI 差异工具（diff.guitool 配置项），
 *   不加 --gui 时使用 diff.tool 配置项。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - from: 可选，对比的起始提交哈希/引用；为 None 时默认为 HEAD
 * - to: 可选，对比的目标提交哈希/引用；为 None 时对比工作区
 *
 * 返回值：
 * - Ok(()) - difftool 启动成功
 * - Err(GitError) - 启动失败
 */
pub fn open_dir_diff(
    repo_path: &str,
    from: Option<&str>,
    to: Option<&str>,
) -> Result<(), GitError> {
    // 构建命令参数：git difftool --dir-diff [--gui] [{from}] [{to}]
    let mut args: Vec<String> = vec!["difftool".to_string(), "--dir-diff".to_string()];

    // from/to 为空时默认使用 HEAD（暂存对比工作区）
    // 注意：当 from 和 to 都为 None 时，不传任何引用参数，
    // git difftool 默认对比暂存区与工作区
    if let Some(f) = from {
        if !f.is_empty() {
            args.push(f.to_string());
        }
    }

    if let Some(t) = to {
        if !t.is_empty() {
            args.push(t.to_string());
        }
    }

    // 将 String 转为 &str 用于 run_git 调用
    let args_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let _output = run_git(repo_path, &args_refs)?;
    Ok(())
}
