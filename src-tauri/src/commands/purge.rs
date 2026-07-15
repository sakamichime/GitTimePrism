/*
 * Git 历史文件清理 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的历史文件清理相关命令：
 * 1. scan_history_files - 扫描仓库历史中的所有文件，返回文件列表及大小统计
 * 2. check_filter_repo_available - 检测系统是否安装了 git-filter-repo 工具
 * 3. purge_files_from_history - 从 Git 历史中清除指定文件（重写历史）
 * 4. get_repo_size - 获取仓库当前大小（人类可读字符串）
 *
 * 前端调用示例：
 * ```javascript
 * // 扫描历史文件
 * const files = await invoke('scan_history_files', { repoPath: '/path/to/repo' });
 *
 * // 检测 filter-repo 是否可用
 * const status = await invoke('check_filter_repo_available');
 *
 * // 清理历史中的大文件
 * const result = await invoke('purge_files_from_history', {
 *   repoPath: '/path/to/repo',
 *   filePaths: ['large_file.bin'],
 *   createBackup: true,
 *   backupBranchName: 'backup-before-purge'
 * });
 *
 * // 获取仓库大小
 * const size = await invoke('get_repo_size', { repoPath: '/path/to/repo' });
 * ```
 *
 * 依赖关系：
 * commands::purge -> git::purge（执行实际的扫描与清理操作）
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

// 引入 git::purge 模块（历史文件清理的核心实现）
use crate::git::purge;

/**
 * 扫描 Git 历史中的所有文件（Tauri IPC 命令）
 *
 * 执行 `git rev-list --objects --all` + `git cat-file --batch-check`，
 * 扫描仓库历史中所有出现过的文件，按路径去重并统计：
 * - max_size: 该文件所有版本中最大的大小
 * - total_size: 该文件所有版本的总大小
 * - commit_count: 该文件在历史中出现的次数
 *
 * 返回按 max_size 降序排序的文件列表，前端据此显示文件列表并支持筛选大文件。
 *
 * 前端调用方式：
 * ```javascript
 * const files = await invoke('scan_history_files', {
 *   repoPath: '/path/to/repo'
 * });
 * ```
 *
 * 参数：
 * - `repo_path`：仓库根目录路径
 *
 * 返回值：
 * - Ok(Vec<HistoryFileInfo>)：扫描成功，返回文件列表
 * - Err(String)：扫描失败，返回错误信息字符串
 */
#[command]
pub async fn scan_history_files(
    repo_path: String,
) -> Result<Vec<purge::HistoryFileInfo>, String> {
    // 调用 git::purge::scan_history_files 执行实际扫描
    // 使用 map_err 将 GitError 转换为 String（Tauri 要求返回 Result<T, String>）
    purge::scan_history_files(&repo_path).map_err(|e| e.to_string())
}

/**
 * 检测 git-filter-repo 工具是否可用（Tauri IPC 命令）
 *
 * 执行 `git filter-repo --version` 检测系统是否安装了 git-filter-repo 工具。
 * 前端据此决定是显示"建议安装 filter-repo"的提示，
 * 还是直接使用 filter-branch（兼容方案，但较慢）。
 *
 * 前端调用方式：
 * ```javascript
 * const status = await invoke('check_filter_repo_available');
 * if (!status.available) {
 *   // 显示"建议安装 filter-repo"的提示
 * }
 * ```
 *
 * 返回值：
 * - Ok(FilterRepoStatus)：检测完成（无论是否可用都返回 Ok）
 *   - available: 是否可用
 *   - version: 版本号字符串（不可用时为 null）
 * - Err(String)：检测过程中发生异常
 */
#[command]
pub async fn check_filter_repo_available() -> Result<purge::FilterRepoStatus, String> {
    // 调用 git::purge::check_filter_repo_available 执行检测
    purge::check_filter_repo_available().map_err(|e| e.to_string())
}

/**
 * 从 Git 历史中清除指定文件（Tauri IPC 命令）
 *
 * ⚠️ 危险操作 ⚠️ 此命令会改写 Git 历史，所有提交的 hash 都会改变。
 *
 * 执行步骤：
 * 1. 获取操作前的仓库大小
 * 2. 如果 create_backup 为 true 且提供了 backup_branch_name，创建备份分支
 * 3. 检测 filter-repo 是否可用
 * 4. 优先使用 filter-repo（更快），否则回退到 filter-branch（兼容）
 * 5. 获取操作后的仓库大小
 * 6. 执行 reflog expire + gc 清理残留对象
 * 7. 返回 PurgeResult 包含操作结果
 *
 * 前端调用方式：
 * ```javascript
 * const result = await invoke('purge_files_from_history', {
 *   repoPath: '/path/to/repo',
 *   filePaths: ['large_file.bin', 'secret.key'],
 *   createBackup: true,
 *   backupBranchName: 'backup-before-purge'
 * });
 * if (result.success) {
 *   console.log(`清理成功！仓库从 ${result.before_size} 减小到 ${result.after_size}`);
 * }
 * ```
 *
 * 参数：
 * - `repo_path`：仓库根目录路径
 * - `file_paths`：要清除的文件路径列表（相对于仓库根目录）
 * - `create_backup`：是否创建备份分支
 * - `backup_branch_name`：备份分支名（create_backup 为 true 时使用）；不创建时传 null
 *
 * 返回值：
 * - Ok(PurgeResult)：操作完成（无论成功或失败都返回 Ok，通过 success 字段区分）
 *   - success: 是否成功
 *   - before_size / after_size: 操作前后的仓库大小
 *   - backup_branch: 备份分支名（如果创建了）
 *   - method: 使用的清理方法（"filter-repo" 或 "filter-branch"）
 *   - error: 错误信息（失败时）
 * - Err(String)：操作过程中发生异常
 */
#[command]
pub async fn purge_files_from_history(
    repo_path: String,
    file_paths: Vec<String>,
    create_backup: bool,
    backup_branch_name: Option<String>,
) -> Result<purge::PurgeResult, String> {
    // 调用 git::purge::purge_files_from_history 执行实际清理
    // backup_branch_name.as_deref() 将 Option<String> 转换为 Option<&str>
    // （因为核心函数接受 Option<&str> 而非 Option<String>）
    purge::purge_files_from_history(
        &repo_path,
        &file_paths,
        create_backup,
        backup_branch_name.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/**
 * 获取 Git 仓库的当前大小（Tauri IPC 命令）
 *
 * 执行 `git count-objects -vH` 并解析输出中的 size-pack 行，
 * 返回人类可读的仓库大小字符串（如 "12.5 MiB"）。
 *
 * 前端调用方式：
 * ```javascript
 * const size = await invoke('get_repo_size', {
 *   repoPath: '/path/to/repo'
 * });
 * console.log(`仓库大小: ${size}`);  // 输出: 仓库大小: 12.5 MiB
 * ```
 *
 * 参数：
 * - `repo_path`：仓库根目录路径
 *
 * 返回值：
 * - Ok(String)：仓库大小字符串（如 "12.5 MiB"）
 * - Err(String)：命令执行失败
 */
#[command]
pub async fn get_repo_size(repo_path: String) -> Result<String, String> {
    // 调用 git::purge::get_repo_size 获取仓库大小
    purge::get_repo_size(&repo_path).map_err(|e| e.to_string())
}
