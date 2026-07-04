/*
 * 标签管理 Tauri IPC 命令模块
 * 
 * 此模块是前端与 Git 标签管理操作之间的桥梁。
 * 每个函数使用 #[tauri::command] 宏标记，前端通过 invoke() 调用。
 * 
 * 提供以下 4 个命令：
 * 1. get_tags     - 获取仓库的所有标签列表
 * 2. create_tag   - 创建新标签（轻量或附注）
 * 3. delete_tag   - 删除指定标签
 * 4. checkout_tag - 切换到指定标签（detached HEAD 模式）
 */

use tauri::command;

/**
 * 获取仓库的所有标签列表
 * 
 * 返回每个标签的名称、对应提交哈希、是否为附注标签、标签消息等信息。
 * 
 * 前端调用方式：
 * ```javascript
 * const tags = await invoke('get_tags', { repoPath: 'C:\\Projects\\my-repo' });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * 
 * 返回值：
 * - Ok(Vec<TagInfo>) - 标签信息列表
 * - Err(String) - 获取失败时的错误信息
 */
#[command]
pub fn get_tags(repo_path: String) -> Result<Vec<crate::git::tag::TagInfo>, String> {
    // 调用 git 模块中的 list_tags 函数，将 GitError 转换为 String 返回给前端
    crate::git::tag::list_tags(&repo_path).map_err(|e| e.to_string())
}

/**
 * 创建新的 Git 标签
 * 
 * 支持创建轻量标签和附注标签两种类型。
 * 
 * 前端调用方式：
 * ```javascript
 * // 创建轻量标签
 * await invoke('create_tag', { repoPath: '...', tagName: 'v1.0', commit: 'abc123', mode: 'lightweight' });
 * // 创建附注标签
 * await invoke('create_tag', { repoPath: '...', tagName: 'v1.0', commit: 'abc123', mode: 'annotated', message: 'Release v1.0' });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - tag_name: 要创建的标签名称
 * - commit: 标签要指向的提交哈希值
 * - mode: 标签模式，"lightweight" 或 "annotated"
 * - message: 附注标签的消息内容（轻量标签时可为 None）
 * 
 * 返回值：
 * - Ok(()) - 创建成功
 * - Err(String) - 创建失败时的错误信息
 */
#[command]
pub fn create_tag(
    repo_path: String,
    tag_name: String,
    commit: String,
    mode: String,
    message: Option<String>,
) -> Result<(), String> {
    // 调用 git 模块中的 create_tag 函数
    // message.as_deref() 将 Option<String> 转换为 Option<&str>
    crate::git::tag::create_tag(&repo_path, &tag_name, &commit, &mode, message.as_deref())
        .map_err(|e| e.to_string())
}

/**
 * 删除指定的 Git 标签
 * 
 * 只删除本地标签，不影响远程仓库。
 * 
 * 前端调用方式：
 * ```javascript
 * await invoke('delete_tag', { repoPath: 'C:\\Projects\\my-repo', tagName: 'v1.0' });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - tag_name: 要删除的标签名称
 * 
 * 返回值：
 * - Ok(()) - 删除成功
 * - Err(String) - 删除失败时的错误信息
 */
#[command]
pub fn delete_tag(repo_path: String, tag_name: String) -> Result<(), String> {
    // 调用 git 模块中的 delete_tag 函数
    crate::git::tag::delete_tag(&repo_path, &tag_name).map_err(|e| e.to_string())
}

/**
 * 切换到指定标签（detached HEAD 模式）
 * 
 * 切换后进入分离头指针状态，因为标签不是分支。
 * 
 * 前端调用方式：
 * ```javascript
 * await invoke('checkout_tag', { repoPath: 'C:\\Projects\\my-repo', tagName: 'v1.0' });
 * ```
 * 
 * 参数：
 * - repo_path: 仓库根目录的路径字符串
 * - tag_name: 要切换到的标签名称
 * 
 * 返回值：
 * - Ok(()) - 切换成功
 * - Err(String) - 切换失败时的错误信息
 */
#[command]
pub fn checkout_tag(repo_path: String, tag_name: String) -> Result<(), String> {
    // 调用 git 模块中的 checkout_tag 函数
    crate::git::tag::checkout_tag(&repo_path, &tag_name).map_err(|e| e.to_string())
}
