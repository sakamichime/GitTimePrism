/*
 * Git 归档 Tauri IPC 命令模块
 *
 * 此模块提供前端可调用的归档命令：
 * 1. archive - 将仓库的某个引用（提交/分支/标签）打包为 tar/zip 归档文件
 *
 * 前端调用示例：
 * ```javascript
 * // 将 main 分支导出为 zip 文件
 * await invoke('archive', {
 *   repoPath: '/path/to/repo',
 *   reference: 'main',
 *   format: 'zip',
 *   outputPath: '/exports/repo-main.zip'
 * });
 * ```
 *
 * 依赖关系：
 * commands::archive -> git::archive（执行实际的归档操作）
 */

// 引入 Tauri 的命令宏，用于标记可被前端调用的函数
use tauri::command;

/// 将仓库的某个引用打包为归档文件（Tauri IPC 命令）
///
/// 执行 `git archive --format={format} -o {outputPath} {reference}`，
/// 将指定版本的代码快照导出为 tar 或 zip 文件。
///
/// 前端调用方式：
/// ```javascript
/// await invoke('archive', {
///   repoPath: '/path/to/repo',
///   reference: 'main',           // 提交哈希/分支名/标签名
///   format: 'zip',               // tar / tar.gz / tgz / zip
///   outputPath: '/exports/repo-main.zip'
/// });
/// ```
///
/// 参数：
/// - `repo_path`：仓库根目录路径
/// - `reference`：要归档的 git 引用（提交哈希、分支名、标签名等）
/// - `format`：归档格式（"tar" / "tar.gz" / "tgz" / "zip"）
/// - `output_path`：输出文件的完整路径
///
/// 返回值：
/// - Ok(())：归档成功
/// - Err(String)：归档失败
#[command]
pub fn archive(
    repo_path: String,
    reference: String,
    format: String,
    output_path: String,
) -> Result<(), String> {
    // 调用 git::archive::archive 执行实际的归档操作
    crate::git::archive::archive(&repo_path, &reference, &format, &output_path)
        .map_err(|e| e.to_string())
}
