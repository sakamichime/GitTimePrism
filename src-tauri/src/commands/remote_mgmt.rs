/*
 * Git 远程仓库管理 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的远程仓库管理命令：
 * 1. prune_remote      - 清理指定远程仓库的本地引用（git remote prune）
 * 2. add_remote        - 添加新的远程仓库（git remote add）
 * 3. delete_remote     - 删除现有远程仓库（git remote remove）
 * 4. edit_remote       - 编辑远程仓库（重命名 + set-url + set-url --push）
 * 5. fetch_into_local_branch - 将远程分支 fetch 到本地分支（git fetch remote branch:branch）
 *
 * 前端调用示例：
 * ```javascript
 * // 添加新远程
 * await invoke('add_remote', { repoPath: '/path/to/repo', name: 'upstream', url: 'https://...' });
 * // 重命名远程
 * await invoke('edit_remote', { repoPath: '/path/to/repo', name: 'origin', newName: 'upstream', fetchUrl: null, pushUrl: null });
 * ```
 *
 * 依赖关系：
 * commands::remote_mgmt -> git::remote_mgmt（执行实际的 git remote 命令）
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/// 清理指定远程仓库的本地引用（Tauri IPC 命令）
///
/// 执行 `git remote prune <name>`，清理远程已删除分支的本地远程跟踪引用。
///
/// 前端调用方式：
/// ```javascript
/// const result = await invoke('prune_remote', { repoPath: '/path/to/repo', name: 'origin' });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `name`：远程仓库名
///
/// 返回值：
/// - Ok(String)：prune 成功，返回命令输出
/// - Err(String)：prune 失败，返回错误描述
#[command]
pub fn prune_remote(repo_path: String, name: String) -> Result<String, String> {
    crate::git::remote_mgmt::prune_remote(&repo_path, &name).map_err(|e| e.to_string())
}

/// 添加新的远程仓库（Tauri IPC 命令）
///
/// 执行 `git remote add <name> <url>`。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('add_remote', { repoPath: '/path/to/repo', name: 'upstream', url: 'https://...' });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `name`：新远程仓库名（不能与已有 remote 重名）
/// - `url`：远程仓库 URL
///
/// 返回值：
/// - Ok(())：添加成功
/// - Err(String)：添加失败
#[command]
pub fn add_remote(repo_path: String, name: String, url: String) -> Result<(), String> {
    crate::git::remote_mgmt::add_remote(&repo_path, &name, &url).map_err(|e| e.to_string())
}

/// 删除现有远程仓库（Tauri IPC 命令）
///
/// 执行 `git remote remove <name>`。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('delete_remote', { repoPath: '/path/to/repo', name: 'upstream' });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `name`：要删除的远程仓库名
///
/// 返回值：
/// - Ok(())：删除成功
/// - Err(String)：删除失败
#[command]
pub fn delete_remote(repo_path: String, name: String) -> Result<(), String> {
    crate::git::remote_mgmt::delete_remote(&repo_path, &name).map_err(|e| e.to_string())
}

/// 编辑现有远程仓库（Tauri IPC 命令）
///
/// 支持重命名、修改 fetch URL、修改 push URL。
/// 执行 `git remote rename` + `git remote set-url` + `git remote set-url --push`。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('edit_remote', {
///   repoPath: '/path/to/repo',
///   name: 'origin',
///   newName: 'upstream',          // null 表示不重命名
///   fetchUrl: 'https://new-url',  // null 表示不修改 fetch URL
///   pushUrl: null                  // null 表示不修改 push URL
/// });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `name`：当前远程仓库名
/// - `new_name`：新名称；None 表示不重命名
/// - `fetch_url`：新 fetch URL；None 表示不修改
/// - `push_url`：新 push URL；None 表示不修改
///
/// 返回值：
/// - Ok(())：编辑成功
/// - Err(String)：编辑失败
#[command]
pub fn edit_remote(
    repo_path: String,
    name: String,
    new_name: Option<String>,
    fetch_url: Option<String>,
    push_url: Option<String>,
) -> Result<(), String> {
    // 将 Option<String> 转换为 Option<&str> 供底层函数使用
    let new_name_ref: Option<&str> = new_name.as_deref();
    let fetch_url_ref: Option<&str> = fetch_url.as_deref();
    let push_url_ref: Option<&str> = push_url.as_deref();

    crate::git::remote_mgmt::edit_remote(
        &repo_path,
        &name,
        new_name_ref,
        fetch_url_ref,
        push_url_ref,
    )
    .map_err(|e| e.to_string())
}

/// 将远程分支 fetch 到本地分支（Tauri IPC 命令）
///
/// 执行 `git fetch <remote> <remote_branch>:<local_branch>`。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('fetch_into_local_branch', {
///   repoPath: '/path/to/repo',
///   remote: 'origin',
///   remoteBranch: 'feature',
///   localBranch: 'feature'
/// });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `remote`：远程仓库名
/// - `remote_branch`：远程分支名
/// - `local_branch`：本地分支名
///
/// 返回值：
/// - Ok(())：fetch 成功
/// - Err(String)：fetch 失败
#[command]
pub fn fetch_into_local_branch(
    repo_path: String,
    remote: String,
    remote_branch: String,
    local_branch: String,
) -> Result<(), String> {
    crate::git::remote_mgmt::fetch_into_local_branch(&repo_path, &remote, &remote_branch, &local_branch)
        .map_err(|e| e.to_string())
}
