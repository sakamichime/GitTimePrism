/*
 * Git 提交对比模块
 *
 * 此模块负责比较两个 Git 提交之间的差异，返回文件变更列表。
 * 用于前端的"提交对比视图"（Commit Comparison View）。
 *
 * 与 gitgraph 项目对齐：
 * - 严格遵循 `dataSource.ts` 中 `getCommitComparison()` 的实现逻辑
 * - 复用 `get_diff_name_status_internal + get_diff_num_stat_internal`
 * - 当 to_hash 为 UNCOMMITTED（"*"）时，用空字符串替换 to_hash，
 *   并获取 status_files（deleted + untracked）传入 generate_file_changes
 *
 * 注意：UNCOMMITTED 是 gitgraph 中表示"未提交变更"的虚拟 hash 值，
 * 当用户选择 HEAD 与"未提交变更"对比时，to_hash 会是 "*"。
 * 此时需要：
 * - 用空字符串替换 to_hash（让 diff 命令比较 from_hash 与工作区）
 * - 获取 status_files，把 deleted 和 untracked 文件合并到 file_changes 中
 */

use super::commands::GitError;
use super::diff::FileChange;
use super::graph::UNCOMMITTED;

/**
 * 提交对比结果
 *
 * 对应 gitgraph 项目 types.ts 中的 `GitCommitComparisonData` 接口。
 * 包含两个提交之间的文件变更列表。
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）：
 * - file_changes -> fileChanges
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitComparison {
    /// 两提交之间的文件变更列表
    /// 每个文件变更包含类型、新旧路径和行数统计
    pub file_changes: Vec<FileChange>,
}

/**
 * 获取两个提交之间的对比结果
 *
 * 此函数对应 gitgraph 项目中 `DataSource.getCommitComparison()` 的实现。
 *
 * 算法步骤：
 * 1. 如果 to_hash == UNCOMMITTED（"*"），用空字符串替换 to_hash
 * 2. 如果 to_hash == UNCOMMITTED，获取 status_files（deleted + untracked）
 * 3. 调用 get_diff_name_status_internal 获取文件变更类型和路径
 * 4. 调用 get_diff_num_stat_internal 获取文件变更行数统计
 * 5. 调用 generate_file_changes 合并两路结果，生成完整的 file_changes 列表
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - from_hash: 对比的起始 commit hash
 * - to_hash: 对比的目标 commit hash
 *              如果是 UNCOMMITTED（"*"），表示与工作区对比
 *
 * 返回值：
 * - Ok(CommitComparison) - 查询成功
 * - Err(GitError) - 查询失败
 */
pub fn get_commit_comparison(
    repo_path: &str,
    from_hash: &str,
    to_hash: &str,
) -> Result<CommitComparison, GitError> {
    // 步骤 1：处理 UNCOMMITTED 情况
    // 对应 gitgraph: this.getDiffNameStatus(repo, fromHash, toHash === UNCOMMITTED ? '' : toHash)
    let is_uncommitted = to_hash == UNCOMMITTED;
    let effective_to_hash = if is_uncommitted { "" } else { to_hash };

    // 步骤 2：获取 status_files（仅当 to_hash == UNCOMMITTED 时）
    // 对应 gitgraph: toHash === UNCOMMITTED ? this.getStatus(repo) : Promise.resolve(null)
    let status_files = if is_uncommitted {
        Some(super::status::get_status_files(repo_path)?)
    } else {
        None
    };

    // 步骤 3：获取文件变更类型和路径
    let name_status_records = super::diff::get_diff_name_status_internal(
        repo_path,
        from_hash,
        effective_to_hash,
    )?;

    // 步骤 4：获取文件变更行数统计
    let num_stat_records = super::diff::get_diff_num_stat_internal(
        repo_path,
        from_hash,
        effective_to_hash,
    )?;

    // 步骤 5：合并两路结果，生成 file_changes
    let file_changes = super::diff::generate_file_changes(
        name_status_records,
        num_stat_records,
        status_files.as_ref(),
    );

    Ok(CommitComparison { file_changes })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uncommitted_constant_match() {
        // 验证 UNCOMMITTED 常量值
        assert_eq!(UNCOMMITTED, "*");
    }
}
