/*
 * 仓库管理 Tauri IPC 命令模块（阶段 10：Task 10.1）
 *
 * 此模块是前端与 repo_manager 模块之间的桥梁。
 * 每个函数使用 #[tauri::command] 宏标记，前端通过 invoke() 调用。
 *
 * 提供以下 8 个命令：
 * 1. discover_repos      - 递归搜索指定路径下的所有 Git 仓库
 * 2. register_repo       - 注册仓库到 ~/.gittimeprism/repos.json
 * 3. unregister_repo     - 取消注册仓库
 * 4. ignore_repo         - 加入忽略列表
 * 5. list_registered_repos - 列出所有已注册仓库
 * 6. scan_submodules      - 扫描仓库的子模块
 * 7. export_config       - 导出仓库配置为 .gittimeprism.json
 * 8. import_config       - 从 .gittimeprism.json 导入配置
 *
 * 前端调用示例：
 * ```javascript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 发现仓库
 * const repos = await invoke('discover_repos', { workspacePath: 'C:\\Projects', maxDepth: 3 });
 *
 * // 注册仓库
 * await invoke('register_repo', { repoPath: 'C:\\Projects\\my-repo' });
 *
 * // 列出已注册仓库
 * const registered = await invoke('list_registered_repos');
 * ```
 */

use tauri::command;

// 引入 repo_manager 模块的 RepoEntry 结构体（用于返回类型注解）
use crate::repo_manager::RepoEntry;

/**
 * 发现指定路径下的所有 Git 仓库
 *
 * 递归搜索 workspace_path 下的所有 Git 仓库（识别含 .git 目录的文件夹），
 * 搜索深度由 max_depth 控制。
 *
 * 前端调用方式：
 * ```javascript
 * const repos = await invoke('discover_repos', {
 *   workspacePath: 'C:\\Projects',
 *   maxDepth: 3
 * });
 * // repos 是 RepoEntry 数组
 * repos.forEach(r => console.log(r.path, r.name, r.is_registered));
 * ```
 *
 * 参数：
 * - workspacePath: 工作区根路径
 * - maxDepth: 最大递归深度（0 = 仅检查根路径，1 = 检查一层子目录）
 *
 * 返回值：
 * - Ok(Vec<RepoEntry>) - 发现的仓库列表
 * - Err(String) - 失败（极少见，主要是权限问题）
 */
#[command]
pub fn discover_repos(workspace_path: String, max_depth: usize) -> Result<Vec<RepoEntry>, String> {
    // 调用 repo_manager::discover_repos 执行实际的搜索
    Ok(crate::repo_manager::discover_repos(&workspace_path, max_depth))
}

/**
 * 注册仓库到配置文件
 *
 * 将指定仓库路径加入已注册列表，并记录打开时间。
 * 如果仓库已在列表中，仅更新打开时间。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('register_repo', { repoPath: 'C:\\Projects\\my-repo' });
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径
 *
 * 返回值：
 * - Ok(()) - 注册成功
 * - Err(String) - 失败（配置文件读写错误）
 */
#[command]
pub fn register_repo(repo_path: String) -> Result<(), String> {
    // 调用 repo_manager::register_repo 执行实际的注册
    crate::repo_manager::register_repo(&repo_path)
}

/**
 * 取消注册仓库
 *
 * 将仓库从已注册列表中移除，并删除其打开时间记录。
 * 注意：取消注册不会将仓库加入忽略列表，下次发现时仍会显示。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('unregister_repo', { repoPath: 'C:\\Projects\\my-repo' });
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径
 *
 * 返回值：
 * - Ok(()) - 取消注册成功
 * - Err(String) - 失败
 */
#[command]
pub fn unregister_repo(repo_path: String) -> Result<(), String> {
    // 调用 repo_manager::unregister_repo 执行实际的取消注册
    crate::repo_manager::unregister_repo(&repo_path)
}

/**
 * 忽略仓库
 *
 * 将仓库加入忽略列表，发现时不再返回该仓库。
 * 同时从已注册列表中移除。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('ignore_repo', { repoPath: 'C:\\Projects\\my-repo' });
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径
 *
 * 返回值：
 * - Ok(()) - 加入忽略列表成功
 * - Err(String) - 失败
 */
#[command]
pub fn ignore_repo(repo_path: String) -> Result<(), String> {
    // 调用 repo_manager::ignore_repo 执行实际的忽略操作
    crate::repo_manager::ignore_repo(&repo_path)
}

/**
 * 列出所有已注册的仓库
 *
 * 读取 ~/.gittimeprism/repos.json，返回所有已注册仓库的 RepoEntry 列表。
 *
 * 前端调用方式：
 * ```javascript
 * const repos = await invoke('list_registered_repos');
 * // repos 是 RepoEntry 数组
 * repos.forEach(r => console.log(r.path, r.last_opened));
 * ```
 *
 * 返回值：
 * - Ok(Vec<RepoEntry>) - 已注册的仓库列表
 * - Err(String) - 失败（极少见）
 */
#[command]
pub fn list_registered_repos() -> Result<Vec<RepoEntry>, String> {
    // 调用 repo_manager::list_registered_repos 执行实际的查询
    Ok(crate::repo_manager::list_registered_repos())
}

/**
 * 扫描仓库的子模块
 *
 * 执行 git submodule status 列出仓库的所有子模块。
 * 返回子模块路径列表（相对仓库根目录）。
 *
 * 前端调用方式：
 * ```javascript
 * const submodules = await invoke('scan_submodules', { repoPath: 'C:\\Projects\\my-repo' });
 * // submodules 是字符串数组
 * submodules.forEach(s => console.log(s));
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径
 *
 * 返回值：
 * - Ok(Vec<String>) - 子模块路径列表（空列表表示无子模块）
 * - Err(String) - 失败（极少见）
 */
#[command]
pub fn scan_submodules(repo_path: String) -> Result<Vec<String>, String> {
    // 调用 repo_manager::scan_submodules 执行实际的扫描
    Ok(crate::repo_manager::scan_submodules(&repo_path))
}

/**
 * 导出仓库配置为 .gittimeprism.json 文件
 *
 * 将指定仓库的配置（注册状态、上次打开时间、子模块列表）导出为 JSON 文件。
 * 用户可以用此文件备份配置或在其他设备上导入。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('export_config', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   outputPath: 'C:\\Backups\\my-repo.gittimeprism.json'
 * });
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径
 * - outputPath: 导出文件路径
 *
 * 返回值：
 * - Ok(()) - 导出成功
 * - Err(String) - 导出失败
 */
#[command]
pub fn export_config(repo_path: String, output_path: String) -> Result<(), String> {
    // 调用 repo_manager::export_config 执行实际的导出
    crate::repo_manager::export_config(&repo_path, &output_path)
}

/**
 * 从 .gittimeprism.json 文件导入配置
 *
 * 读取导出的配置文件，将其中的仓库注册到当前 GitTimePrism 中。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('import_config', {
 *   configPath: 'C:\\Backups\\my-repo.gittimeprism.json'
 * });
 * ```
 *
 * 参数：
 * - configPath: 配置文件路径
 *
 * 返回值：
 * - Ok(()) - 导入成功
 * - Err(String) - 导入失败
 */
#[command]
pub fn import_config(config_path: String) -> Result<(), String> {
    // 调用 repo_manager::import_config 执行实际的导入
    crate::repo_manager::import_config(&config_path)
}
