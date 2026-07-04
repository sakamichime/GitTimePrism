/*
 * Git 分支切换操作模块
 * 
 * 此模块提供 Git 仓库的分支切换功能：
 * 1. 切换分支（git checkout）- 切换到指定的本地或远程分支
 * 2. 创建并切换分支（git checkout -b）- 创建新分支并立即切换
 * 
 * 所有函数都通过 crate::git::commands::run_git 执行底层 git 命令。
 */

use super::commands::{run_git, GitError};

/**
 * 切换到指定分支
 * 
 * 执行 `git checkout <branch>` 命令，将工作区切换到指定的分支。
 * 支持切换到本地分支或远程跟踪分支。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - branch_name: 要切换到的分支名称
 * 
 * 返回值：
 * - Ok(()) - 切换成功
 * - Err(GitError) - 切换失败（例如分支不存在、有未提交的变更等）
 * 
 * 注意：
 * - 如果工作区有未提交的变更，可能会导致切换失败
 * - 切换到远程分支时，Git 会自动创建本地跟踪分支
 */
pub fn checkout_branch(repo_path: &str, branch_name: &str) -> Result<(), GitError> {
    // 验证分支名不为空
    if branch_name.trim().is_empty() {
        return Err(GitError::InvalidPath("分支名称不能为空".to_string()));
    }

    // 执行 git checkout <branch>
    run_git(repo_path, &["checkout", branch_name])?;
    Ok(())
}

/**
 * 创建新分支并切换过去
 * 
 * 执行 `git checkout -b <branch>` 命令，基于当前 HEAD 创建新分支并立即切换。
 * 
 * 参数：
 * - repo_path: 仓库根目录路径
 * - branch_name: 新分支的名称
 * 
 * 返回值：
 * - Ok(()) - 创建并切换成功
 * - Err(GitError) - 操作失败（例如分支已存在等）
 */
pub fn create_and_checkout(repo_path: &str, branch_name: &str) -> Result<(), GitError> {
    // 验证分支名不为空
    if branch_name.trim().is_empty() {
        return Err(GitError::InvalidPath("分支名称不能为空".to_string()));
    }

    // 执行 git checkout -b <branch>
    run_git(repo_path, &["checkout", "-b", branch_name])?;
    Ok(())
}
