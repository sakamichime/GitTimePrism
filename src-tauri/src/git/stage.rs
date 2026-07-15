/*
 * Git 暂存/提交操作模块
 * 
 * 此模块提供 Git 仓库的写入操作：
 * 1. 暂存文件（git add）- 将工作区变更添加到暂存区
 * 2. 取消暂存（git reset HEAD）- 从暂存区移除文件
 * 3. 创建提交（git commit）- 将暂存区的变更提交到仓库
 * 
 * 所有函数都通过 crate::git::commands::run_git 执行底层 git 命令。
 */

use super::commands::{run_git, GitError};

/**
 * 将指定文件添加到暂存区
 * 
 * 执行 `git add <file>` 命令，将文件的当前状态添加到 Git 索引（暂存区）。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 要暂存的文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(()) - 暂存成功
 * - Err(GitError) - 暂存失败
 */
pub fn stage_file(repo_path: &str, file_path: &str) -> Result<(), GitError> {
    run_git(repo_path, &["add", "--", file_path])?;
    Ok(())
}

/**
 * 将所有变更文件添加到暂存区
 * 
 * 执行 `git add -A` 命令，将所有工作区和暂存区的变更（包括新增、修改、删除）
 * 一次性添加到暂存区。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * 
 * 返回值：
 * - Ok(()) - 全部暂存成功
 * - Err(GitError) - 暂存失败
 */
pub fn stage_all(repo_path: &str) -> Result<(), GitError> {
    run_git(repo_path, &["add", "-A"])?;
    Ok(())
}

/**
 * 从暂存区移除指定文件
 * 
 * 执行 `git reset HEAD -- <file>` 命令，将文件从暂存区移回工作区，
 * 但保留文件的变更内容（不会丢弃修改）。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - file_path: 要取消暂存的文件路径（相对于仓库根目录）
 * 
 * 返回值：
 * - Ok(()) - 取消暂存成功
 * - Err(GitError) - 操作失败
 */
pub fn unstage_file(repo_path: &str, file_path: &str) -> Result<(), GitError> {
    run_git(repo_path, &["reset", "HEAD", "--", file_path])?;
    Ok(())
}

/**
 * 创建新的提交
 * 
 * 执行 `git commit -m "<message>"` 命令，将暂存区的所有变更提交到仓库，
 * 并附上指定的提交消息。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - message: 提交消息字符串（可以包含多行）
 * 
 * 返回值：
 * - Ok(String) - 提交成功，返回新提交的完整哈希值
 * - Err(GitError) - 提交失败（例如暂存区为空、消息为空等）
 * 
 * 注意：
 * - 如果暂存区为空，git commit 会返回错误
 * - 提交消息不应为空，否则 git 会拒绝提交
 */
pub fn commit_changes(repo_path: &str, message: &str) -> Result<String, GitError> {
    // 验证提交消息不为空
    if message.trim().is_empty() {
        return Err(GitError::InvalidPath("提交消息不能为空".to_string()));
    }

    // 执行 git commit -m "message"
    // -m 参数指定提交消息
    // run_git 的返回值此处不需要使用（仅确认命令成功即可），用 _ 丢弃
    let _ = run_git(repo_path, &["commit", "-m", message])?;

    // 获取新提交的哈希值
    // git commit 成功后，HEAD 指向新提交
    let hash_output = run_git(repo_path, &["rev-parse", "HEAD"])?;
    let commit_hash = hash_output.stdout.trim().to_string();

    Ok(commit_hash)
}
