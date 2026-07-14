/*
 * Git 远程仓库管理模块（Remote Management）
 *
 * 此模块封装了与远程仓库管理相关的 git 命令执行逻辑，包括：
 * 1. prune_remote：清理远程已删除分支的本地引用（git remote prune）
 * 2. add_remote：添加新的远程仓库（git remote add）
 * 3. delete_remote：删除现有远程仓库（git remote remove）
 * 4. edit_remote：编辑远程仓库（重命名 + 修改 fetch/push URL）
 * 5. fetch_into_local_branch：将远程分支 fetch 到本地分支（git fetch remote branch:branch）
 *
 * 工作流程：
 * 1. 前端通过 Tauri IPC 调用 commands/remote_mgmt.rs 中的对应命令
 * 2. 命令调用本模块的对应函数
 * 3. 函数通过 git/commands.rs 中的 run_git 执行实际的 git 命令
 *
 * 依赖关系：
 * remote_mgmt -> commands（使用 run_git 执行 git 命令，使用 GitError 处理错误）
 *
 * 注意：此模块与 git/pull.rs、git/push.rs、git/fetch.rs 不同，
 * 专注于"远程仓库本身的管理"（增删改），而非"远程仓库内容的同步"（fetch/pull/push）。
 */

// 引入通用的 Git 命令执行器和错误类型
use super::commands::{run_git, GitError};

/// Prune（清理）指定远程仓库的本地引用
///
/// 执行 `git remote prune <name>` 命令。
/// 此命令会清理那些在远程仓库中已不存在的分支的本地远程跟踪引用
/// （如 origin/old-branch）。不会删除本地分支，也不会拉取新数据。
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `name`：远程仓库名（如 "origin"）
///
/// 返回值：
/// - Ok(String)：prune 成功，返回命令的标准输出信息
/// - Err(GitError)：prune 失败（如指定的远程仓库不存在）
///
/// 使用示例：
/// ```
/// let result = prune_remote("/path/to/repo", "origin")?;
/// ```
pub fn prune_remote(repo_path: &str, name: &str) -> Result<String, GitError> {
    // 执行 `git remote prune <name>`
    // 参数数组会被展开为: git --no-pager remote prune <name>
    let output = run_git(repo_path, &["remote", "prune", name])?;
    Ok(output.stdout)
}

/// 添加新的远程仓库
///
/// 执行 `git remote add <name> <url>` 命令，向仓库添加一个新的远程仓库引用。
/// 添加后可通过 `git fetch <name>` 拉取该远程的提交。
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `name`：新远程仓库名（不能与已有 remote 重名）
/// - `url`：远程仓库 URL（HTTPS 或 SSH）
///
/// 返回值：
/// - Ok(())：添加成功
/// - Err(GitError)：添加失败（如 remote 已存在、URL 格式错误）
///
/// 使用示例：
/// ```
/// add_remote("/path/to/repo", "upstream", "https://github.com/upstream/repo.git")?;
/// ```
pub fn add_remote(repo_path: &str, name: &str, url: &str) -> Result<(), GitError> {
    // 执行 `git remote add <name> <url>`
    // 不需要 fetch，调用方需要 fetch 时可以单独调用 fetch::fetch
    run_git(repo_path, &["remote", "add", name, url])?;
    Ok(())
}

/// 删除现有远程仓库
///
/// 执行 `git remote remove <name>` 命令，从仓库中删除指定的远程仓库引用。
/// 删除后所有该远程的跟踪分支引用（如 origin/*）也会被删除。
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `name`：要删除的远程仓库名
///
/// 返回值：
/// - Ok(())：删除成功
/// - Err(GitError)：删除失败（如指定的 remote 不存在）
///
/// 使用示例：
/// ```
/// delete_remote("/path/to/repo", "upstream")?;
/// ```
pub fn delete_remote(repo_path: &str, name: &str) -> Result<(), GitError> {
    // 执行 `git remote remove <name>`
    run_git(repo_path, &["remote", "remove", name])?;
    Ok(())
}

/// 编辑现有远程仓库（重命名 + 修改 fetch/push URL）
///
/// 此函数支持三种编辑操作（按顺序执行）：
/// 1. 如果 `new_name` 与 `name` 不同：执行 `git remote rename <name> <new_name>`
/// 2. 如果 `fetch_url` 不为 None：执行 `git remote set-url <new_name> <fetch_url>`
/// 3. 如果 `push_url` 不为 None：执行 `git remote set-url --push <new_name> <push_url>`
///
/// 与 gitgraph dataSource.ts 的 editRemote 不同，此简化版本：
/// - 仅支持完全替换 fetch URL 和 push URL（不支持 add/delete 多 URL）
/// - 重命名后，后续的 set-url 命令使用新名称
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `name`：当前远程仓库名
/// - `new_name`：新远程仓库名；如果为 None 或与 name 相同，则不重命名
/// - `fetch_url`：新的 fetch URL；如果为 None，则不修改 fetch URL
/// - `push_url`：新的 push URL；如果为 None，则不修改 push URL
///
/// 返回值：
/// - Ok(())：编辑成功（所有指定的操作都执行成功）
/// - Err(GitError)：编辑失败（如 remote 不存在、重命名后 set-url 失败）
///
/// 注意：如果在执行过程中某一步失败，已执行的步骤不会回滚。
/// 例如，如果重命名成功但 set-url 失败，远程仓库已被重命名。
///
/// 使用示例：
/// ```
/// // 仅重命名
/// edit_remote("/path/to/repo", "origin", Some("upstream"), None, None)?;
/// // 修改 fetch 和 push URL
/// edit_remote("/path/to/repo", "origin", None, Some("https://..."), Some("git@..."))?;
/// ```
pub fn edit_remote(
    repo_path: &str,
    name: &str,
    new_name: Option<&str>,
    fetch_url: Option<&str>,
    push_url: Option<&str>,
) -> Result<(), GitError> {
    // 确定实际使用的远程仓库名（如果重命名了则使用新名称）
    // 这个变量会在后续的 set-url 命令中使用
    let effective_name: &str = new_name.unwrap_or(name);

    // 步骤 1：重命名（如果提供了 new_name 且与 name 不同）
    if let Some(new_n) = new_name {
        if new_n != name {
            // 执行 `git remote rename <name> <new_name>`
            run_git(repo_path, &["remote", "rename", name, new_n])?;
        }
    }

    // 步骤 2：修改 fetch URL（如果提供了 fetch_url）
    if let Some(url) = fetch_url {
        // 执行 `git remote set-url <effective_name> <url>`
        // 注意：使用 effective_name 而非 name，因为可能已经重命名
        run_git(repo_path, &["remote", "set-url", effective_name, url])?;
    }

    // 步骤 3：修改 push URL（如果提供了 push_url）
    if let Some(url) = push_url {
        // 执行 `git remote set-url --push <effective_name> <url>`
        run_git(repo_path, &["remote", "set-url", "--push", effective_name, url])?;
    }

    Ok(())
}

/// 将远程分支 fetch 到本地分支
///
/// 执行 `git fetch <remote> <remote_branch>:<local_branch>` 命令。
/// 此命令会将远程分支的内容下载到指定的本地分支，但不切换分支也不合并。
///
/// 与普通 `git fetch` 的区别：
/// - 普通 fetch 只更新远程跟踪分支（如 origin/main）
/// - 此命令直接更新指定的本地分支（如将 origin/feature fetch 到本地 feature）
///
/// 适用场景：
/// - 查看远程分支的内容而不影响当前工作分支
/// - 创建本地分支跟踪远程分支
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `remote`：远程仓库名（如 "origin"）
/// - `remote_branch`：远程分支名（不含 remote 前缀，如 "feature"）
/// - `local_branch`：本地分支名（如 "feature"）
///
/// 返回值：
/// - Ok(())：fetch 成功
/// - Err(GitError)：fetch 失败（如远程分支不存在、本地分支已存在且非快进）
///
/// 使用示例：
/// ```
/// fetch_into_local_branch("/path/to/repo", "origin", "feature", "feature")?;
/// ```
pub fn fetch_into_local_branch(
    repo_path: &str,
    remote: &str,
    remote_branch: &str,
    local_branch: &str,
) -> Result<(), GitError> {
    // 构造 refspec 字符串：`<remote_branch>:<local_branch>`
    // 这是 git fetch 命令的 refspec 格式，表示将远程分支 fetch 到本地分支
    let refspec = format!("{}:{}", remote_branch, local_branch);

    // 执行 `git fetch <remote> <refspec>`
    // 参数数组会被展开为: git --no-pager fetch <remote> <remote_branch>:<local_branch>
    run_git(repo_path, &["fetch", remote, &refspec])?;
    Ok(())
}
