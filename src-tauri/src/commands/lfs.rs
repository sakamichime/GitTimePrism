/*
 * LFS 管理 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的 Git LFS 管理命令：
 * 1. lfs_install - 初始化 LFS
 * 2. lfs_track - 添加跟踪规则
 * 3. lfs_untrack - 移除跟踪规则
 * 4. lfs_list - 获取跟踪的文件类型列表
 * 5. lfs_locks - 获取文件锁列表
 * 6. lfs_pull - 拉取 LFS 对象
 * 7. lfs_push - 推送 LFS 对象
 *
 * 前端调用示例：
 * ```javascript
 * // 初始化 LFS
 * await invoke('lfs_install', { repoPath: '/path/to/repo' });
 *
 * // 添加跟踪规则
 * await invoke('lfs_track', { repoPath: '/path/to/repo', pattern: '*.psd' });
 *
 * // 获取跟踪列表
 * const patterns = await invoke('lfs_list', { repoPath: '/path/to/repo' });
 * ```
 */

use tauri::command;

/**
 * 初始化 LFS
 *
 * 执行 `git lfs install` 命令。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(()) - 安装成功
 * - Err(String) - 安装失败
 */
#[command]
pub fn lfs_install(repo_path: String) -> Result<(), String> {
    crate::git::lfs::lfs_install(&repo_path).map_err(|e| e.to_string())
}

/**
 * 添加 LFS 跟踪规则
 *
 * 执行 `git lfs track {pattern}` 命令。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - pattern: 要跟踪的文件模式（如 "*.psd"）
 *
 * 返回值：
 * - Ok(()) - 添加成功
 * - Err(String) - 添加失败
 */
#[command]
pub fn lfs_track(repo_path: String, pattern: String) -> Result<(), String> {
    crate::git::lfs::lfs_track(&repo_path, &pattern).map_err(|e| e.to_string())
}

/**
 * 移除 LFS 跟踪规则
 *
 * 执行 `git lfs untrack {pattern}` 命令。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - pattern: 要移除跟踪的文件模式
 *
 * 返回值：
 * - Ok(()) - 移除成功
 * - Err(String) - 移除失败
 */
#[command]
pub fn lfs_untrack(repo_path: String, pattern: String) -> Result<(), String> {
    crate::git::lfs::lfs_untrack(&repo_path, &pattern).map_err(|e| e.to_string())
}

/**
 * 获取 LFS 跟踪的文件类型列表
 *
 * 解析 .gitattributes 文件获取 LFS 跟踪的文件类型。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<LfsPattern>) - 跟踪规则列表
 * - Err(String) - 查询失败
 */
#[command]
pub fn lfs_list(repo_path: String) -> Result<Vec<crate::git::lfs::LfsPattern>, String> {
    crate::git::lfs::lfs_list(&repo_path).map_err(|e| e.to_string())
}

/**
 * 获取 LFS 文件锁列表
 *
 * 执行 `git lfs locks --json` 命令。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<LfsLock>) - 文件锁列表
 * - Err(String) - 查询失败
 */
#[command]
pub fn lfs_locks(repo_path: String) -> Result<Vec<crate::git::lfs::LfsLock>, String> {
    crate::git::lfs::lfs_locks(&repo_path).map_err(|e| e.to_string())
}

/**
 * 拉取 LFS 对象
 *
 * 执行 `git lfs pull` 命令。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(()) - 拉取成功
 * - Err(String) - 拉取失败
 */
#[command]
pub fn lfs_pull(repo_path: String) -> Result<(), String> {
    crate::git::lfs::lfs_pull(&repo_path).map_err(|e| e.to_string())
}

/**
 * 推送 LFS 对象
 *
 * 执行 `git lfs push --all origin` 命令。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 *
 * 返回值：
 * - Ok(()) - 推送成功
 * - Err(String) - 推送失败
 */
#[command]
pub fn lfs_push(repo_path: String) -> Result<(), String> {
    crate::git::lfs::lfs_push(&repo_path).map_err(|e| e.to_string())
}
