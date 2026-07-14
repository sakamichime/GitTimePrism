/*
 * 子模块管理 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的子模块管理命令：
 * 1. list_submodules - 获取仓库中所有子模块的列表
 * 2. add_submodule - 添加新的子模块
 * 3. update_submodules - 更新子模块（init/recursive）
 * 4. delete_submodule - 删除子模块
 *
 * 前端调用示例：
 * ```javascript
 * // 获取所有子模块
 * const submodules = await invoke('list_submodules', { repoPath: '/path/to/repo' });
 *
 * // 添加子模块
 * await invoke('add_submodule', {
 *   repoPath: '/path/to/repo',
 *   url: 'https://github.com/example/lib.git',
 *   path: 'vendor/lib',
 *   branch: 'main'  // 可选
 * });
 *
 * // 更新子模块（初始化 + 递归）
 * await invoke('update_submodules', {
 *   repoPath: '/path/to/repo',
 *   init: true,
 *   recursive: true
 * });
 *
 * // 删除子模块
 * await invoke('delete_submodule', {
 *   repoPath: '/path/to/repo',
 *   path: 'vendor/lib'
 * });
 * ```
 */

use tauri::command;

/**
 * 获取仓库中所有子模块的列表
 *
 * 读取 `.gitmodules` 文件并执行 `git submodule status`，
 * 返回每个子模块的完整信息（path/url/branch/commit/status/isInitialized）。
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 *
 * 返回值：
 * - Ok(Vec<SubmoduleInfo>) - 查询成功，返回子模块列表（无子模块时为空数组）
 * - Err(String) - 查询失败
 */
#[command]
pub fn list_submodules(
    repo_path: String,
) -> Result<Vec<crate::git::submodule::SubmoduleInfo>, String> {
    // 调用 git::submodule::list_submodules 执行实际的子模块查询操作
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::submodule::list_submodules(&repo_path).map_err(|e| e.to_string())
}

/**
 * 添加新的子模块
 *
 * 执行 `git submodule add [-b {branch}] {url} {path}` 命令。
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 * - url: 子模块的远程仓库 URL（HTTPS 或 SSH）
 * - path: 子模块在主仓库中的相对路径
 * - branch: 可选，子模块跟踪的分支名；为 null 时不指定分支
 *
 * 返回值：
 * - Ok(()) - 添加成功
 * - Err(String) - 添加失败
 */
#[command]
pub fn add_submodule(
    repo_path: String,
    url: String,
    path: String,
    branch: Option<String>,
) -> Result<(), String> {
    // 将 Option<String> 转换为 Option<&str> 传给底层函数
    let branch_ref = branch.as_deref();
    crate::git::submodule::add_submodule(&repo_path, &url, &path, branch_ref)
        .map_err(|e| e.to_string())
}

/**
 * 更新子模块
 *
 * 执行 `git submodule update [--init] [--recursive]` 命令。
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 * - init: 是否执行 --init（初始化未初始化的子模块）
 * - recursive: 是否执行 --recursive（递归更新嵌套子模块）
 *
 * 返回值：
 * - Ok(()) - 更新成功
 * - Err(String) - 更新失败
 */
#[command]
pub fn update_submodules(
    repo_path: String,
    init: bool,
    recursive: bool,
) -> Result<(), String> {
    crate::git::submodule::update_submodules(&repo_path, init, recursive)
        .map_err(|e| e.to_string())
}

/**
 * 删除子模块
 *
 * 执行 `git submodule deinit -f {path}` + `git rm -f {path}` + 删除 .git/modules/{path}。
 *
 * 参数：
 * - repo_path: 主仓库的根目录路径
 * - path: 要删除的子模块路径
 *
 * 返回值：
 * - Ok(()) - 删除成功
 * - Err(String) - 删除失败
 */
#[command]
pub fn delete_submodule(
    repo_path: String,
    path: String,
) -> Result<(), String> {
    crate::git::submodule::delete_submodule(&repo_path, &path).map_err(|e| e.to_string())
}
