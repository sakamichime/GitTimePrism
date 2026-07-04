/*
 * 分支切换 Tauri IPC 命令模块
 * 
 * 此模块是前端与 Git 分支切换操作之间的桥梁。
 * 每个函数使用 #[tauri::command] 宏标记，前端通过 invoke() 调用。
 * 
 * 提供以下 2 个命令：
 * 1. checkout_branch    - 切换到指定分支
 * 2. create_and_checkout - 创建新分支并切换
 */

use tauri::command;

/**
 * 切换到指定分支
 * 
 * 执行 `git checkout <branch>` 命令，将工作区切换到指定的分支。
 * 
 * 前端调用方式：
 * ```javascript
 * await invoke('checkout_branch', { repoPath: 'C:\\Projects\\my-repo', branchName: 'main' });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - branch_name: 要切换到的分支名称
 * 
 * 返回值：
 * - Ok(()) - 切换成功
 * - Err(String) - 切换失败
 */
#[command]
pub fn checkout_branch(repo_path: String, branch_name: String) -> Result<(), String> {
    crate::git::checkout::checkout_branch(&repo_path, &branch_name).map_err(|e| e.to_string())
}

/**
 * 创建新分支并切换过去
 * 
 * 执行 `git checkout -b <branch>` 命令，基于当前 HEAD 创建新分支并立即切换。
 * 
 * 前端调用方式：
 * ```javascript
 * await invoke('create_and_checkout', { repoPath: 'C:\\Projects\\my-repo', branchName: 'feature-x' });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - branch_name: 新分支的名称
 * 
 * 返回值：
 * - Ok(()) - 创建并切换成功
 * - Err(String) - 操作失败
 */
#[command]
pub fn create_and_checkout(repo_path: String, branch_name: String) -> Result<(), String> {
    crate::git::checkout::create_and_checkout(&repo_path, &branch_name).map_err(|e| e.to_string())
}
