/*
 * Git 文件内容获取模块
 * 
 * 此模块负责获取文件在不同版本中的完整内容：
 * 1. 工作树版本 - 当前工作目录中的文件内容
 * 2. 暂存区版本 - 已暂存但未提交的文件内容
 * 3. HEAD 版本 - 最后一次提交中的文件内容
 * 4. 指定提交版本 - 任意提交中的文件内容
 * 
 * 用于左右分栏对比视图，显示文件在不同阶段的完整内容。
 */

use super::commands::{run_git, GitError};
use std::fs;
use std::path::Path;

/**
 * 获取工作树中文件的完整内容
 * 
 * 直接读取工作目录中的文件。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_worktree_file_content(repo_path: &str, file_path: &str) -> Result<String, GitError> {
    let full_path = Path::new(repo_path).join(file_path);
    
    if !full_path.exists() {
        return Err(GitError::Io(format!(
            "文件不存在: {}",
            full_path.display()
        )));
    }
    
    fs::read_to_string(&full_path).map_err(|e| {
        GitError::Io(format!(
            "读取文件失败 {}: {}",
            full_path.display(),
            e
        ))
    })
}

/**
 * 获取暂存区中文件的完整内容
 * 
 * 使用 `git show :file_path` 获取暂存区中的文件内容。
 * `:` 表示暂存区（index）。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(String) - 文件内容
 * - Err(GitError) - 读取失败
 */
pub fn get_staged_file_content(repo_path: &str, file_path: &str) -> Result<String, GitError> {
    let ref_spec = format!(":{}", file_path);
    let output = run_git(repo_path, &["show", &ref_spec])?;
    Ok(output.stdout)
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
 * - Err(GitError) - 读取失败
 */
pub fn get_head_file_content(repo_path: &str, file_path: &str) -> Result<String, GitError> {
    let ref_spec = format!("HEAD:{}", file_path);
    let output = run_git(repo_path, &["show", &ref_spec])?;
    Ok(output.stdout)
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
 * - Err(GitError) - 读取失败
 */
pub fn get_file_content_at_commit(repo_path: &str, commit_hash: &str, file_path: &str) -> Result<String, GitError> {
    let ref_spec = format!("{}:{}", commit_hash, file_path);
    let output = run_git(repo_path, &["show", &ref_spec])?;
    Ok(output.stdout)
}
