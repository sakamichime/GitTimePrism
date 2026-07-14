/*
 * 文件监听控制 Tauri IPC 命令模块（阶段 10：Task 10.2）
 *
 * 此模块提供前端控制文件监听器的命令接口。
 * 每个函数使用 #[tauri::command] 宏标记，前端通过 invoke() 调用。
 *
 * 提供以下 4 个命令：
 * 1. start_watcher  - 开始监听指定仓库目录
 * 2. stop_watcher   - 停止文件监听
 * 3. mute_watcher   - 静音文件监听（Git 操作前调用）
 * 4. unmute_watcher - 取消静音（Git 操作后调用）
 *
 * 前端调用示例：
 * ```javascript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 打开仓库时启动监听
 * await invoke('start_watcher', { repoPath: 'C:\\Projects\\my-repo' });
 *
 * // 执行 Git 操作前静音
 * await invoke('mute_watcher');
 *
 * // 执行完 Git 操作后取消静音
 * await invoke('unmute_watcher');
 *
 * // 关闭仓库时停止监听
 * await invoke('stop_watcher');
 * ```
 *
 * 监听器触发事件：
 * - 当文件变化匹配过滤规则且通过防抖后，会向前端发送 'repo_changed' 事件
 * - 前端通过 listen('repo_changed', callback) 监听此事件并触发刷新
 */

use tauri::command;

/**
 * 启动文件监听器
 *
 * 开始监听指定仓库目录下的文件变化。
 * 如果当前已有监听器在运行，会先停止旧的监听器。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('start_watcher', { repoPath: 'C:\\Projects\\my-repo' });
 * ```
 *
 * 参数：
 * - repoPath: 要监听的仓库路径
 *
 * 返回值：
 * - Ok(()) - 启动成功
 * - Err(String) - 启动失败（如应用句柄未初始化）
 */
#[command]
pub fn start_watcher(repo_path: String) -> Result<(), String> {
    // 调用 utils::watcher::start_watcher 执行实际的启动
    crate::utils::watcher::start_watcher(&repo_path)
}

/**
 * 停止文件监听器
 *
 * 停止当前监听并清理状态。关闭仓库或切换仓库时调用。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('stop_watcher');
 * ```
 *
 * 返回值：
 * - Ok(()) - 停止成功
 * - Err(String) - 失败
 */
#[command]
pub fn stop_watcher() -> Result<(), String> {
    // 调用 utils::watcher::stop_watcher 执行实际的停止
    crate::utils::watcher::stop_watcher()
}

/**
 * 静音文件监听
 *
 * 在执行 Git 操作前调用，防止 GitTimePrism 自身的操作触发文件监听，
 * 进而触发自身刷新（导致循环刷新）。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('mute_watcher');
 * ```
 *
 * 返回值：
 * - Ok(()) - 静音成功
 * - Err(String) - 失败
 */
#[command]
pub fn mute_watcher() -> Result<(), String> {
    // 调用 utils::watcher::mute_watcher 执行实际的静音
    crate::utils::watcher::mute_watcher()
}

/**
 * 取消静音文件监听
 *
 * 在 Git 操作完成后调用，恢复正常监听。
 * 取消静音后，1.5 秒内的事件仍被忽略，避免 Git 操作产生的残留事件触发刷新。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('unmute_watcher');
 * ```
 *
 * 返回值：
 * - Ok(()) - 取消静音成功
 * - Err(String) - 失败
 */
#[command]
pub fn unmute_watcher() -> Result<(), String> {
    // 调用 utils::watcher::unmute_watcher 执行实际的取消静音
    crate::utils::watcher::unmute_watcher()
}
