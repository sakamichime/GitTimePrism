/*
 * 状态持久化 Tauri IPC 命令模块（阶段 10：Task 10.3）
 *
 * 此模块是前端与 state 模块之间的桥梁。
 * 每个函数使用 #[tauri::command] 宏标记，前端通过 invoke() 调用。
 *
 * 提供以下 5 个命令：
 * 1. get_repo_state    - 获取指定仓库的状态（含 Code Review 过期清理）
 * 2. save_repo_state   - 保存指定仓库的状态
 * 3. get_global_state  - 获取全局状态
 * 4. save_global_state - 保存全局状态
 * 5. touch_code_review - 更新 Code Review 的 lastActive 时间戳
 *
 * 前端调用示例：
 * ```javascript
 * import { invoke } from '@tauri-apps/api/core';
 *
 * // 启动时恢复仓库状态
 * const state = await invoke('get_repo_state', { repoPath: 'C:\\Projects\\my-repo' });
 * // 修改状态后保存
 * state.scroll_top = 500;
 * await invoke('save_repo_state', { repoPath: 'C:\\Projects\\my-repo', state });
 *
 * // 全局状态
 * const global = await invoke('get_global_state');
 * global.theme = 'light';
 * await invoke('save_global_state', { state: global });
 * ```
 */

use tauri::command;

// 引入 state 模块的类型
use crate::state::{RepoState, GlobalState};

/**
 * 获取指定仓库的状态
 *
 * 从 ~/.gittimeprism/state.json 读取指定仓库的状态。
 * 如果该仓库没有保存过状态，返回默认状态（列宽默认值、显示选项默认 true 等）。
 *
 * 读取时会自动清理过期的 Code Review 状态（90 天过期）。
 *
 * 前端调用方式：
 * ```javascript
 * const state = await invoke('get_repo_state', { repoPath: 'C:\\Projects\\my-repo' });
 * console.log(state.column_widths, state.cdv_divider, state.show_tags);
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径
 *
 * 返回值：
 * - Ok(RepoState) - 仓库状态（含默认值合并）
 * - Err(String) - 失败（极少见）
 */
#[command]
pub fn get_repo_state(repo_path: String) -> Result<RepoState, String> {
    // 调用 state::get_repo_state 执行实际的读取
    Ok(crate::state::get_repo_state(&repo_path))
}

/**
 * 保存指定仓库的状态
 *
 * 将仓库状态写入 ~/.gittimeprism/state.json。
 * 保存前会自动清理过期的 Code Review 状态。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('save_repo_state', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   state: { column_widths: {...}, cdv_divider: 50, ... }
 * });
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径
 * - state: 要保存的仓库状态
 *
 * 返回值：
 * - Ok(()) - 保存成功
 * - Err(String) - 保存失败
 */
#[command]
pub fn save_repo_state(repo_path: String, state: RepoState) -> Result<(), String> {
    // 调用 state::save_repo_state 执行实际的保存
    crate::state::save_repo_state(&repo_path, state)
}

/**
 * 获取全局状态
 *
 * 从 ~/.gittimeprism/state.json 读取全局状态。
 * 包括主题、最近仓库列表、快捷键配置等。
 *
 * 前端调用方式：
 * ```javascript
 * const global = await invoke('get_global_state');
 * console.log(global.theme, global.recent_repos, global.keyboard_shortcuts);
 * ```
 *
 * 返回值：
 * - Ok(GlobalState) - 全局状态
 * - Err(String) - 失败
 */
#[command]
pub fn get_global_state() -> Result<GlobalState, String> {
    // 调用 state::get_global_state 执行实际的读取
    Ok(crate::state::get_global_state())
}

/**
 * 保存全局状态
 *
 * 将全局状态写入 ~/.gittimeprism/state.json。
 * 此操作不会影响已保存的仓库状态。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('save_global_state', {
 *   state: { theme: 'light', recent_repos: [...], ... }
 * });
 * ```
 *
 * 参数：
 * - state: 要保存的全局状态
 *
 * 返回值：
 * - Ok(()) - 保存成功
 * - Err(String) - 保存失败
 */
#[command]
pub fn save_global_state(state: GlobalState) -> Result<(), String> {
    // 调用 state::save_global_state 执行实际的保存
    crate::state::save_global_state(state)
}

/**
 * 更新 Code Review 的 lastActive 时间戳
 *
 * 当用户在 Code Review 中查看文件或导航时，调用此命令更新 lastActive。
 * 这样可以保持 Code Review 的活跃状态，避免被 90 天过期清理。
 *
 * 前端调用方式：
 * ```javascript
 * await invoke('touch_code_review', {
 *   repoPath: 'C:\\Projects\\my-repo',
 *   reviewId: 'review-123'
 * });
 * ```
 *
 * 参数：
 * - repoPath: 仓库路径
 * - reviewId: Code Review 的唯一标识符
 *
 * 返回值：
 * - Ok(()) - 更新成功（如果 Code Review 不存在则忽略）
 * - Err(String) - 失败
 */
#[command]
pub fn touch_code_review(repo_path: String, review_id: String) -> Result<(), String> {
    // 调用 state::touch_code_review 执行实际的更新
    crate::state::touch_code_review(&repo_path, &review_id)
}
