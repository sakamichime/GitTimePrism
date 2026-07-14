/*
 * Git Stash（暂存）查询模块
 *
 * 此模块负责获取 Git 仓库中的所有 stash（暂存）记录。
 *
 * Stash 是 Git 的一个功能，允许用户将当前工作区的未提交变更临时保存起来，
 * 以便切换到其他分支或处理紧急任务。每个 stash 都是一个特殊的提交对象，
 * 存储在 `refs/stash` reflog 中。
 *
 * 通过执行 `git reflog --format=... refs/stash --` 命令获取所有 stash 记录。
 * 这里使用 reflog 而不是 `git stash list`，是因为 reflog 能提供更详细的信息
 * （包括 parents，从中可以解析出 baseHash 和 untrackedFilesHash）。
 *
 * 与 gitgraph 项目对齐：
 * - 严格遵循 `dataSource.ts` 中 `getStashes()` 的实现逻辑
 * - 使用统一的 GIT_LOG_SEPARATOR 分隔符
 * - 7 字段解析（hash/parents/selector/author/email/date/message）
 * - 从 parents 解析 baseHash 和 untrackedFilesHash
 *
 * Stash 的内部结构说明：
 * 每个 stash 实际上是一个 merge commit，有 1-2 个 parents：
 * - parent[0] = baseHash：stash 创建时的 HEAD commit（基础提交）
 * - parent[1] = untrackedFilesHash（可选）：如果 stash 时使用了 --include-untracked，
 *   则 parent[1] 是包含未跟踪文件的 commit
 *
 * 因此通过解析 parents，可以还原 stash 与原始 HEAD 的关系。
 */

use super::commands::{run_git, GitError, GIT_LOG_SEPARATOR};

/**
 * 单个 stash（暂存）记录的详细信息
 *
 * 描述一个 stash 的完整信息，包括：
 * - hash: stash commit 自身的哈希
 * - baseHash: stash 创建时的 HEAD commit（即 stash 的第一个 parent）
 * - untrackedFilesHash: 如果 stash 包含未跟踪文件，则此字段是包含未跟踪文件的 commit；
 *   否则为 None
 * - selector: 用于 git stash apply/drop 的选择器（如 "stash@{0}"）
 * - author/email/date/message: 作者信息和提交消息
 *
 * 序列化时使用 camelCase 命名（与前端的 TypeScript 类型定义匹配）：
 * - base_hash -> baseHash
 * - untracked_files_hash -> untrackedFilesHash
 */
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct StashInfo {
    /// stash commit 自身的完整哈希值（40 位十六进制）
    pub hash: String,

    /// stash 创建时的 HEAD commit 的完整哈希值
    /// 这是 stash 的第一个 parent（parent[0]）
    /// 用于在节点图中将 stash 显示在对应 commit 之后
    pub base_hash: String,

    /// 包含未跟踪文件的 commit 的完整哈希值
    /// 只有当 stash 是用 `git stash push --include-untracked` 创建时才有值
    /// 这是 stash 的第二个 parent（parent[2]，因为 parent[1] 是 index commit）
    /// 实际上 gitgraph 源码中是 parentHashes.length === 3 ? parentHashes[2] : null
    /// 这是因为 stash 通常有 1 或 2 个 parents：
    ///   - 无 --include-untracked: parents = [baseHash]（1 个）
    ///   - 有 --include-untracked: parents = [baseHash, indexHash, untrackedFilesHash]（3 个）
    /// 但 gitgraph 代码里假设 parent[1] 是 indexHash（index commit），
    /// 而 parent[2] 才是 untrackedFilesHash，所以判断条件是 length === 3
    pub untracked_files_hash: Option<String>,

    /// stash 的选择器（用于 git stash apply/pop/drop 命令）
    /// 例如 "stash@{0}"、"stash@{1}"
    /// 这是 `%gD` format 占位符的输出
    pub selector: String,

    /// stash 创建者的名字
    pub author: String,

    /// stash 创建者的邮箱
    pub email: String,

    /// stash 创建的时间戳（Unix 时间戳，单位：秒）
    pub date: i64,

    /// stash 的提交消息（通常是 stash 创建时自动生成的消息，如 "WIP on main: a1b2c3d ..."）
    pub message: String,
}

/**
 * 获取 Git 仓库中的所有 stash 记录
 *
 * 执行 `git reflog --format=... refs/stash --` 命令并解析输出，
 * 返回所有 stash 记录的列表。
 *
 * format 字符串使用 GIT_LOG_SEPARATOR 作为字段分隔符，包含 7 个字段：
 * 1. %H  - stash commit 的完整哈希
 * 2. %P  - 所有 parent 的哈希（空格分隔）
 * 3. %gD - reflog 选择器（如 "stash@{0}"）
 * 4. %aN - 作者名字（受 mailmap 影响）
 * 5. %aE - 作者邮箱（受 mailmap 影响）
 * 6. %at - 作者日期（Unix 时间戳）
 * 7. %s  - 提交消息（第一行）
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 *
 * 返回值：
 * - Ok(Vec<StashInfo>) - 查询成功，返回所有 stash 记录（按 stash@{0}, stash@{1}, ... 顺序）
 * - Err(GitError) - 查询失败
 *
 * 注意：
 * - 如果仓库没有任何 stash，返回空 Vec（不视为错误）
 * - 如果仓库中没有 refs/stash 引用，git reflog 命令会返回非零退出码，
 *   此时函数会捕获错误并返回空 Vec
 */
pub fn get_stashes(repo_path: &str) -> Result<Vec<StashInfo>, GitError> {
    // 构建 format 字符串
    // 7 个字段，使用 GIT_LOG_SEPARATOR 分隔：
    //   %H  = stash commit 完整哈希
    //   %P  = 所有 parent 的哈希（空格分隔）
    //   %gD = reflog 选择器（如 "stash@{0}"）
    //   %aN = 作者名字（受 mailmap 影响）
    //   %aE = 作者邮箱（受 mailmap 影响）
    //   %at = 作者日期（Unix 时间戳，单位：秒）
    //   %s  = 提交消息第一行
    let format_str = [
        "%H", "%P", "%gD", "%aN", "%aE", "%at", "%s",
    ].join(GIT_LOG_SEPARATOR);

    let full_format = format!("--format={}", format_str);

    // 构建命令参数
    // git reflog --format=... refs/stash --
    // - --format: 指定输出格式
    // - refs/stash: 指定要查看 reflog 的引用
    // - --: 表示后续没有其他选项（避免歧义）
    let args: Vec<&str> = vec!["reflog", &full_format, "refs/stash", "--"];

    // 执行命令
    let output = match run_git(repo_path, &args) {
        Ok(out) => out,
        Err(GitError::CommandFailed { .. }) => {
            // 仓库没有 stash 时，git reflog refs/stash 会失败
            // 此时返回空列表
            return Ok(Vec::new());
        }
        Err(e) => return Err(e),
    };

    // 解析输出
    Ok(parse_stashes_output(&output.stdout))
}

/**
 * 解析 `git reflog --format=... refs/stash --` 的输出
 *
 * 输出格式：每行一个 stash 记录，字段之间用 GIT_LOG_SEPARATOR 分隔
 * 字段顺序：hash § parents § selector § author § email § date § message
 *
 * 解析规则：
 * 1. 按行分割输出
 * 2. 对每行，用 GIT_LOG_SEPARATOR 分割为 7 个字段
 * 3. 解析 parents 字段：
 *    - 如果为空，跳过此行（无效的 stash 记录）
 *    - 否则按空格分割为 parent 哈希列表
 * 4. 从 parents 提取：
 *    - base_hash = parents[0]（stash 的基础 commit）
 *    - untracked_files_hash = parents[2]（如果 parents 长度为 3）
 *
 * 参数：
 * - output: git reflog 命令的原始输出
 *
 * 返回值：
 * - Vec<StashInfo>: 解析后的 stash 记录列表
 */
fn parse_stashes_output(output: &str) -> Vec<StashInfo> {
    let mut stashes: Vec<StashInfo> = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // 使用 GIT_LOG_SEPARATOR 分割为 7 个字段
        let parts: Vec<&str> = line.split(GIT_LOG_SEPARATOR).collect();
        if parts.len() != 7 {
            // 字段数不正确，跳过此行
            continue;
        }

        let hash = parts[0].trim();
        let parents_str = parts[1].trim();
        let selector = parts[2].trim();
        let author = parts[3].trim();
        let email = parts[4].trim();
        let date_str = parts[5].trim();
        let message = parts[6].trim();

        // 如果 parents 为空，跳过此行（无效的 stash 记录）
        if parents_str.is_empty() {
            continue;
        }

        // 解析 parents 字段（空格分隔的哈希列表）
        let parent_hashes: Vec<&str> = parents_str.split_whitespace().collect();
        if parent_hashes.is_empty() {
            continue;
        }

        // base_hash 是第一个 parent（stash 创建时的 HEAD）
        let base_hash = parent_hashes[0].to_string();

        // untracked_files_hash 是第三个 parent（如果存在）
        // gitgraph 源码逻辑：parentHashes.length === 3 ? parentHashes[2] : null
        // 这是因为 stash 的 parents 结构：
        //   - 无 --include-untracked: [baseHash]
        //   - 有 --include-untracked: [baseHash, indexHash, untrackedFilesHash]
        let untracked_files_hash = if parent_hashes.len() == 3 {
            Some(parent_hashes[2].to_string())
        } else {
            None
        };

        // 解析日期（Unix 时间戳）
        let date: i64 = date_str.parse().unwrap_or(0);

        stashes.push(StashInfo {
            hash: hash.to_string(),
            base_hash,
            untracked_files_hash,
            selector: selector.to_string(),
            author: author.to_string(),
            email: email.to_string(),
            date,
            message: message.to_string(),
        });
    }

    stashes
}

/**
 * ============================================================
 * Stash 操作方法（apply/pop/drop/push/branch）
 * ============================================================
 *
 * 以下 5 个函数实现了 git stash 的全部操作命令，对应前端
 * 的 stash-manager.ts 中各按钮触发的后端逻辑：
 *   - apply_stash：应用 stash（保留 stash 列表中的记录）
 *   - pop_stash：弹出 stash（应用后从列表中删除）
 *   - drop_stash：删除 stash（不应用，直接丢弃）
 *   - push_stash：将当前未提交变更保存为新的 stash
 *   - branch_from_stash：从 stash 创建新分支并切换过去
 *
 * 实现参考 gitgraph 项目的 dataSource.ts 中同名方法，
 * 命令参数与 git CLI 的 stash 子命令保持一致。
 */

/**
 * 应用指定的 stash（保留 stash 记录）
 *
 * 执行 `git stash apply [--index] {selector}` 命令。
 * apply 与 pop 的区别：apply 不会从 stash 列表中删除该 stash，
 * 用户需要手动 drop；pop = apply + drop。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - selector: stash 选择器（如 "stash@{0}"）
 * - index: 是否尝试恢复暂存区（--index 选项）
 *   true  = 使用 --index，尝试恢复原暂存区状态
 *   false = 不使用 --index，所有变更都合并到工作区
 *
 * 返回值：
 * - Ok(()) - 命令执行成功
 * - Err(GitError) - 命令执行失败（如选择器不存在、有冲突等）
 */
pub fn apply_stash(repo_path: &str, selector: &str, index: bool) -> Result<(), GitError> {
    // 构建参数列表：stash apply [--index] {selector}
    let mut args: Vec<&str> = vec!["stash", "apply"];
    // 如果需要恢复暂存区，添加 --index 选项
    if index {
        args.push("--index");
    }
    // 添加 stash 选择器（必须是最后一个位置参数）
    args.push(selector);

    // 执行命令（不需要解析输出，只关心退出码）
    run_git(repo_path, &args)?;
    Ok(())
}

/**
 * 弹出指定的 stash（应用后删除）
 *
 * 执行 `git stash pop [--index] {selector}` 命令。
 * pop = apply + drop，如果 apply 过程中产生冲突，
 * stash 不会被删除（保留以供用户处理冲突）。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - selector: stash 选择器（如 "stash@{0}"）
 * - index: 是否尝试恢复暂存区（--index 选项）
 *
 * 返回值：
 * - Ok(()) - 命令执行成功
 * - Err(GitError) - 命令执行失败（如冲突、选择器不存在等）
 */
pub fn pop_stash(repo_path: &str, selector: &str, index: bool) -> Result<(), GitError> {
    // 构建参数列表：stash pop [--index] {selector}
    let mut args: Vec<&str> = vec!["stash", "pop"];
    // 如果需要恢复暂存区，添加 --index 选项
    if index {
        args.push("--index");
    }
    // 添加 stash 选择器
    args.push(selector);

    // 执行命令
    run_git(repo_path, &args)?;
    Ok(())
}

/**
 * 删除指定的 stash（不应用）
 *
 * 执行 `git stash drop {selector}` 命令。
 * 直接从 stash 列表中删除该 stash，不影响当前工作区。
 * 此操作不可逆，删除后无法恢复 stash 中的变更。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - selector: stash 选择器（如 "stash@{0}"）
 *
 * 返回值：
 * - Ok(()) - 命令执行成功
 * - Err(GitError) - 命令执行失败（如选择器不存在）
 */
pub fn drop_stash(repo_path: &str, selector: &str) -> Result<(), GitError> {
    // 构建参数列表：stash drop {selector}
    let args: Vec<&str> = vec!["stash", "drop", selector];

    // 执行命令
    run_git(repo_path, &args)?;
    Ok(())
}

/**
 * 将当前未提交的变更保存为新的 stash
 *
 * 执行 `git stash push [--include-untracked] [--message {msg}]` 命令。
 * 该命令会：
 *   1. 保存当前工作区和暂存区的变更到新的 stash
 *   2. 重置工作区和暂存区到 HEAD 状态（clean working tree）
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - include_untracked: 是否包含未跟踪文件（--include-untracked 选项）
 *   true  = 包含未跟踪文件（git 未跟踪的新文件也会被 stash）
 *   false = 只 stash 已跟踪文件的变更
 * - message: stash 的描述消息；如果为 None 或空字符串，不加 --message 选项
 *   （git 会自动生成类似 "WIP on {branch}: {hash} {msg}" 的默认消息）
 *
 * 返回值：
 * - Ok(()) - 命令执行成功
 * - Err(GitError) - 命令执行失败（如没有可 stash 的变更）
 */
pub fn push_stash(
    repo_path: &str,
    include_untracked: bool,
    message: Option<&str>,
) -> Result<(), GitError> {
    // 构建参数列表：stash push [--include-untracked] [--message {msg}]
    let mut args: Vec<&str> = vec!["stash", "push"];

    // 如果需要包含未跟踪文件，添加 --include-untracked 选项
    if include_untracked {
        args.push("--include-untracked");
    }

    // 如果提供了非空消息，添加 --message 选项
    // 注意：只有 message 是 Some 且非空字符串时才添加
    if let Some(msg) = message {
        if !msg.is_empty() {
            args.push("--message");
            args.push(msg);
        }
    }

    // 执行命令
    run_git(repo_path, &args)?;
    Ok(())
}

/**
 * 从 stash 创建新分支并切换过去
 *
 * 执行 `git stash branch {branch_name} {selector}` 命令。
 * 该命令会：
 *   1. 创建一个新分支，基于 stash 创建时的 base commit（即 stash 的第一个 parent）
 *   2. 切换到新分支
 *   3. 应用 stash 中的变更到工作区
 *   4. 如果应用成功，从 stash 列表中删除该 stash
 *
 * 适用场景：当 stash 的 base commit 已经落后于当前分支很多提交时，
 * 直接 apply 可能产生大量冲突；此时使用 branch 从 stash 创建新分支，
 * 可以在一个干净的环境中处理 stash 的变更。
 *
 * 参数：
 * - repo_path: Git 仓库的根目录路径
 * - branch_name: 要创建的新分支名称（不能与已有分支重名）
 * - selector: stash 选择器（如 "stash@{0}"）
 *
 * 返回值：
 * - Ok(()) - 命令执行成功
 * - Err(GitError) - 命令执行失败（如分支已存在、stash 不存在等）
 */
pub fn branch_from_stash(
    repo_path: &str,
    branch_name: &str,
    selector: &str,
) -> Result<(), GitError> {
    // 构建参数列表：stash branch {branch_name} {selector}
    let args: Vec<&str> = vec!["stash", "branch", branch_name, selector];

    // 执行命令
    run_git(repo_path, &args)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_stashes_output_basic() {
        // 模拟 git reflog --format=... refs/stash -- 的输出
        // 字段：hash § parents § selector § author § email § date § message
        let separator = GIT_LOG_SEPARATOR;
        let output = format!(
            "abc123{}def456 789abc{}stash@{{0}}{}张三{}zhangsan@example.com{{}}{}1700000000{}WIP on main: def456 修复bug\n",
            separator, separator, separator, separator, separator, separator
        );

        let stashes = parse_stashes_output(&output);

        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].hash, "abc123");
        assert_eq!(stashes[0].base_hash, "def456");
        assert_eq!(stashes[0].untracked_files_hash, None);
        assert_eq!(stashes[0].selector, "stash@{0}");
        assert_eq!(stashes[0].author, "张三");
        assert_eq!(stashes[0].message, "WIP on main: def456 修复bug");
    }

    #[test]
    fn test_parse_stashes_output_with_untracked() {
        // 测试带 untracked files 的 stash（parents 长度为 3）
        let separator = GIT_LOG_SEPARATOR;
        let output = format!(
            "abc123{}def456 idx789 unt012{}stash@{{0}}{}张三{}zhangsan@example.com{{}}{}1700000000{}WIP on main\n",
            separator, separator, separator, separator, separator, separator
        );

        let stashes = parse_stashes_output(&output);

        assert_eq!(stashes.len(), 1);
        assert_eq!(stashes[0].base_hash, "def456");
        assert_eq!(
            stashes[0].untracked_files_hash,
            Some("unt012".to_string())
        );
    }

    #[test]
    fn test_parse_stashes_output_empty() {
        // 空输出应该返回空列表
        let stashes = parse_stashes_output("");
        assert!(stashes.is_empty());
    }

    #[test]
    fn test_parse_stashes_output_no_parents() {
        // parents 为空的行应该被跳过
        let separator = GIT_LOG_SEPARATOR;
        let output = format!(
            "abc123{}{}stash@{{0}}{}张三{}zhangsan@example.com{{}}{}1700000000{}WIP\n",
            separator, separator, separator, separator, separator, separator
        );

        let stashes = parse_stashes_output(&output);
        assert!(stashes.is_empty());
    }
}
