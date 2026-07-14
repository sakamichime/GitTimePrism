/*
 * 文件内容获取 Tauri IPC 命令模块
 * 
 * 此模块提供前端可调用的文件内容获取命令：
 * 1. get_worktree_file_content - 获取工作树中文件的完整内容
 * 2. get_staged_file_content - 获取暂存区中文件的完整内容
 * 3. get_head_file_content - 获取 HEAD 提交中文件的完整内容
 * 4. get_file_content_at_commit - 获取指定提交中文件的完整内容
 * 
 * 前端调用示例：
 * ```javascript
 * // 获取工作树文件内容
 * const worktreeContent = await invoke('get_worktree_file_content', {
 *   repoPath: '/path',
 *   filePath: 'src/main.rs'
 * });
 * 
 * // 获取暂存区文件内容
 * const stagedContent = await invoke('get_staged_file_content', {
 *   repoPath: '/path',
 *   filePath: 'src/main.rs'
 * });
 * 
 * // 获取 HEAD 提交中的文件内容
 * const headContent = await invoke('get_head_file_content', {
 *   repoPath: '/path',
 *   filePath: 'src/main.rs'
 * });
 * 
 * // 获取指定提交中的文件内容
 * const commitContent = await invoke('get_file_content_at_commit', {
 *   repoPath: '/path',
 *   commitHash: 'abc1234',
 *   filePath: 'src/main.rs'
 * });
 * ```
 */

use tauri::command;

/**
 * 获取工作树中文件的完整内容
 * 
 * 读取工作目录中的文件内容。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(String) - 读取失败
 */
#[command]
pub fn get_worktree_file_content(
    repo_path: String,
    file_path: String,
    encoding: Option<String>,
) -> Result<String, String> {
    // 如果指定了编码，使用带编码的版本；否则使用默认 UTF-8 版本
    match encoding {
        Some(enc) if !enc.is_empty() && enc.to_lowercase() != "utf8" && enc.to_lowercase() != "utf-8" => {
            crate::git::file_content::get_worktree_file_content_with_encoding(&repo_path, &file_path, &enc)
                .map_err(|e| e.to_string())
        }
        _ => {
            crate::git::file_content::get_worktree_file_content(&repo_path, &file_path)
                .map_err(|e| e.to_string())
        }
    }
}

/**
 * 获取暂存区中文件的完整内容
 * 
 * 使用 `git show :file_path` 获取暂存区中的文件内容。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(String) - 读取失败
 */
#[command]
pub fn get_staged_file_content(
    repo_path: String,
    file_path: String,
    encoding: Option<String>,
) -> Result<String, String> {
    // 如果指定了编码，使用带编码的版本；否则使用默认 UTF-8 版本
    match encoding {
        Some(enc) if !enc.is_empty() && enc.to_lowercase() != "utf8" && enc.to_lowercase() != "utf-8" => {
            crate::git::file_content::get_staged_file_content_with_encoding(&repo_path, &file_path, &enc)
                .map_err(|e| e.to_string())
        }
        _ => {
            crate::git::file_content::get_staged_file_content(&repo_path, &file_path)
                .map_err(|e| e.to_string())
        }
    }
}

/**
 * 获取 HEAD 提交中文件的完整内容
 * 
 * 使用 `git show HEAD:file_path` 获取 HEAD 提交中的文件内容。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(String) - 读取失败
 */
#[command]
pub fn get_head_file_content(
    repo_path: String,
    file_path: String,
    encoding: Option<String>,
) -> Result<String, String> {
    // 如果指定了编码，使用带编码的版本；否则使用默认 UTF-8 版本
    match encoding {
        Some(enc) if !enc.is_empty() && enc.to_lowercase() != "utf8" && enc.to_lowercase() != "utf-8" => {
            crate::git::file_content::get_head_file_content_with_encoding(&repo_path, &file_path, &enc)
                .map_err(|e| e.to_string())
        }
        _ => {
            crate::git::file_content::get_head_file_content(&repo_path, &file_path)
                .map_err(|e| e.to_string())
        }
    }
}

/**
 * 获取指定提交中文件的完整内容
 *
 * 使用 `git show <commit_hash>:file_path` 获取指定提交中的文件内容。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - commit_hash: 提交哈希值
 * - file_path: 文件路径（相对于仓库根目录）
 *
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(String) - 读取失败
 */
#[command]
pub fn get_file_content_at_commit(
    repo_path: String,
    commit_hash: String,
    file_path: String,
    encoding: Option<String>,
) -> Result<String, String> {
    // 如果指定了编码，使用带编码的版本；否则使用默认 UTF-8 版本
    match encoding {
        Some(enc) if !enc.is_empty() && enc.to_lowercase() != "utf8" && enc.to_lowercase() != "utf-8" => {
            crate::git::file_content::get_file_content_at_commit_with_encoding(&repo_path, &commit_hash, &file_path, &enc)
                .map_err(|e| e.to_string())
        }
        _ => {
            crate::git::file_content::get_file_content_at_commit(&repo_path, &commit_hash, &file_path)
                .map_err(|e| e.to_string())
        }
    }
}

/**
 * 获取支持的文件编码列表
 *
 * 返回前端可选择的编码名称列表，用于设置面板的文件编码下拉选择。
 *
 * 返回值：
 * - Ok(Vec<String>) - 支持的编码名称列表
 */
#[command]
pub fn get_supported_encodings() -> Vec<String> {
    crate::git::file_content::get_supported_encodings()
}

/**
 * 将内容写入工作树中的文件（Task 8.2：合并编辑器使用）
 *
 * 直接写入工作目录中的文件，覆盖原有内容。
 * 用于合并编辑器在用户解决冲突后将合并结果写回文件。
 *
 * 前端调用方式：
 * ```typescript
 * await invoke('write_file_content', {
 *   repoPath: '/path/to/repo',
 *   filePath: 'src/main.rs',
 *   content: '新的文件内容...'
 * });
 * ```
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * - content: 要写入的文件内容
 *
 * 返回值：
 * - Ok(()) - 写入成功
 * - Err(String) - 写入失败，错误信息已转换为字符串
 */
#[command]
pub fn write_file_content(
    repo_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    crate::git::file_content::write_file_content(&repo_path, &file_path, &content)
        .map_err(|e| e.to_string())
}
