/*
 * Git 归档（archive）模块
 *
 * 此模块封装了 `git archive` 命令，用于将仓库的某个提交或分支打包为归档文件。
 *
 * 核心功能：
 * - archive：执行 `git archive --format={tar/zip} -o {output_path} {reference}`
 *
 * 使用场景：
 * - 用户在分支/标签/提交的右键菜单中选择"Create Archive"
 * - 导出某个版本的代码快照（不含 .git 目录）
 *
 * 支持的归档格式：
 * - tar：Unix 标准归档格式（需要配合 gzip/bzip2 压缩）
 * - zip：跨平台压缩格式（Windows 用户友好）
 * - tar.gz：gzip 压缩的 tar 归档（通过 format 传 "tar.gz" 时使用 tar 格式 + 自定义后缀）
 *
 * 依赖关系：
 * archive -> commands（使用 run_git 执行 git 命令，使用 GitError 处理错误）
 */

// 引入父模块（git）中的通用命令执行器和错误类型
use super::commands::{run_git, GitError};

/**
 * 归档格式枚举
 *
 * 表示 git archive 支持的归档格式。
 * Git 原生支持 tar 和 zip 两种格式。
 */
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArchiveFormat {
    /// tar 归档格式（未压缩）
    Tar,
    /// zip 压缩格式
    Zip,
}

impl ArchiveFormat {
    /**
     * 从字符串解析归档格式
     *
     * 接受 "tar" / "zip"（不区分大小写）。
     * 对于 "tar.gz" / "tgz" 也视为 Tar 格式（输出文件后缀由调用方控制）。
     *
     * 参数：
     * - s: 输入字符串
     *
     * 返回值：
     * - Ok(ArchiveFormat) - 解析成功
     * - Err(GitError) - 输入字符串不是合法的归档格式
     */
    pub fn from_str(s: &str) -> Result<Self, GitError> {
        match s.to_lowercase().as_str() {
            "tar" | "tar.gz" | "tgz" => Ok(ArchiveFormat::Tar),
            "zip" => Ok(ArchiveFormat::Zip),
            _ => Err(GitError::CommandFailed {
                exit_code: -1,
                message: format!(
                    "无效的归档格式 '{}'。合法的值为: tar, tar.gz, tgz, zip",
                    s
                ),
            }),
        }
    }

    /**
     * 转换为 git archive --format 参数的值
     *
     * 注意：git archive 的 --format 只接受 "tar" 或 "zip"，
     * 不接受 "tar.gz"（gzip 压缩通过输出文件后缀自动识别）。
     */
    pub fn to_format_arg(self) -> &'static str {
        match self {
            ArchiveFormat::Tar => "tar",
            ArchiveFormat::Zip => "zip",
        }
    }
}

/**
 * 将仓库的某个引用（提交/分支/标签）打包为归档文件
 *
 * 执行 `git archive --format={format} -o {output_path} {reference}` 命令，
 * 将指定版本的代码快照导出为 tar 或 zip 文件。
 *
 * 归档文件不包含 .git 目录，只是工作区文件的快照。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - reference: 要归档的 git 引用（提交哈希、分支名、标签名等，如 "main"、"v1.0"、"abc1234"）
 * - format: 归档格式（"tar" / "tar.gz" / "tgz" / "zip"）
 * - output_path: 输出文件的完整路径（如 "C:\\exports\\repo-v1.0.zip"）
 *
 * 返回值：
 * - Ok(()) - 归档成功
 * - Err(GitError) - 归档失败（如引用不存在、输出路径不可写、格式不支持等）
 *
 * 使用示例：
 * ```
 * // 将 main 分支导出为 zip 文件
 * archive("/path/to/repo", "main", "zip", "/exports/repo-main.zip")?;
 * // 将 v1.0 标签导出为 tar.gz 文件
 * archive("/path/to/repo", "v1.0", "tar.gz", "/exports/repo-v1.0.tar.gz")?;
 * ```
 *
 * 底层命令：`git --no-pager archive --format=zip -o /exports/repo-main.zip main`
 */
pub fn archive(
    repo_path: &str,
    reference: &str,
    format: &str,
    output_path: &str,
) -> Result<(), GitError> {
    // 解析归档格式字符串为枚举
    let fmt = ArchiveFormat::from_str(format)?;

    // 构造命令参数：archive --format={format} -o {output_path} {reference}
    let format_value = fmt.to_format_arg();
    let args = ["archive", "--format", format_value, "-o", output_path, reference];

    // 执行 git archive 命令
    run_git(repo_path, &args)?;

    Ok(())
}
