/*
 * Git 配置管理 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的 Git 配置管理命令：
 * 1. get_config          - 获取仓库的完整配置信息（分支跟踪/远程仓库/用户身份/推送默认/差异工具）
 * 2. set_config_value    - 设置单个配置项的值（在 local 或 global 层级）
 * 3. unset_config_value  - 删除单个配置项（在 local 或 global 层级）
 *
 * 前端调用示例：
 * ```javascript
 * // 获取仓库配置
 * const config = await invoke('get_config', { repoPath: '/path/to/repo' });
 *
 * // 在仓库级设置 user.name
 * await invoke('set_config_value', {
 *   repoPath: '/path/to/repo',
 *   location: 'local',
 *   key: 'user.name',
 *   value: '张三'
 * });
 *
 * // 删除仓库级的 user.name
 * await invoke('unset_config_value', {
 *   repoPath: '/path/to/repo',
 *   location: 'local',
 *   key: 'user.name'
 * });
 * ```
 *
 * 依赖关系：
 * commands::config -> git::config（执行配置查询）
 * commands::config -> git::set_config（执行配置写入/删除）
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/// 获取仓库的完整配置信息（Tauri IPC 命令）
///
/// 执行 `git config --list -z --includes` 等命令，返回仓库的所有关键配置信息。
/// 包括分支跟踪设置、远程仓库地址、用户身份（local + global）、推送默认模式、差异工具等。
///
/// 前端调用方式：
/// ```javascript
/// const config = await invoke('get_config', { repoPath: '/path/to/repo' });
/// console.log(config.remotes);        // 远程仓库列表
/// console.log(config.user.local.name);  // 仓库级用户名
/// console.log(config.user.global.name); // 用户级用户名
/// console.log(config.pushDefault);     // 推送默认模式
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
///
/// 返回值：
/// - Ok(RepoConfig)：查询成功，返回完整的仓库配置
/// - Err(String)：查询失败，返回错误描述
#[command]
pub fn get_config(repo_path: String) -> Result<crate::git::config::RepoConfig, String> {
    // 调用 git::config::get_config 执行实际的配置查询
    // 将 GitError 转换为 String 以满足 Tauri 命令的返回类型要求
    crate::git::config::get_config(&repo_path).map_err(|e| e.to_string())
}

/// 设置 Git 配置项的值（Tauri IPC 命令）
///
/// 执行 `git config --{location} {key} {value}`，在指定位置设置配置项。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('set_config_value', {
///   repoPath: '/path/to/repo',
///   location: 'local',   // 或 'global'
///   key: 'user.name',
///   value: '张三'
/// });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `location`：配置位置（"local" 或 "global"）
/// - `key`：配置键名（如 "user.name"、"remote.origin.url"）
/// - `value`：配置值
///
/// 返回值：
/// - Ok(())：设置成功
/// - Err(String)：设置失败
#[command]
pub fn set_config_value(
    repo_path: String,
    location: String,
    key: String,
    value: String,
) -> Result<(), String> {
    // 将字符串位置参数解析为 ConfigLocation 枚举
    let loc = crate::git::config::ConfigLocation::from_str(&location).map_err(|e| e.to_string())?;

    // 调用 git::set_config::set_config_value 执行实际的配置写入
    crate::git::set_config::set_config_value(&repo_path, loc, &key, &value)
        .map_err(|e| e.to_string())
}

/// 删除 Git 配置项（Tauri IPC 命令）
///
/// 执行 `git config --{location} --unset-all {key}`，删除指定位置的配置项。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('unset_config_value', {
///   repoPath: '/path/to/repo',
///   location: 'local',
///   key: 'user.name'
/// });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `location`：配置位置（"local" 或 "global"）
/// - `key`：要删除的配置键名
///
/// 返回值：
/// - Ok(())：删除成功
/// - Err(String)：删除失败
#[command]
pub fn unset_config_value(
    repo_path: String,
    location: String,
    key: String,
) -> Result<(), String> {
    // 将字符串位置参数解析为 ConfigLocation 枚举
    let loc = crate::git::config::ConfigLocation::from_str(&location).map_err(|e| e.to_string())?;

    // 调用 git::set_config::unset_config_value 执行实际的配置删除
    crate::git::set_config::unset_config_value(&repo_path, loc, &key).map_err(|e| e.to_string())
}
