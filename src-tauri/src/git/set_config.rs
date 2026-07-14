/*
 * Git 仓库配置（config）写入模块
 *
 * 此模块负责修改 Git 仓库的配置项，与 gitgraph 项目 dataSource.ts 的
 * setConfigValue / unsetConfigValue 方法对齐。
 *
 * 核心功能：
 * 1. set_config_value：执行 `git config --{local/global} {key} {value}` 设置配置项
 * 2. unset_config_value：执行 `git config --{local/global} --unset-all {key}` 删除配置项
 *
 * 配置位置说明：
 * - local：仓库级（.git/config），只对当前仓库生效
 * - global：用户级（~/.gitconfig），对当前用户的所有仓库生效
 *
 * 依赖关系：
 * set_config -> config（复用 ConfigLocation 枚举）
 * set_config -> commands（使用 run_git 执行 git 命令，使用 GitError 处理错误）
 */

// 引入父模块（git）中的通用命令执行器和错误类型
use super::commands::{run_git, GitError};
// 引入 config 模块中定义的 ConfigLocation 枚举（Local / Global）
use super::config::ConfigLocation;

/**
 * 设置 Git 配置项的值
 *
 * 执行 `git config --{location} {key} {value}` 命令，在指定位置设置配置项。
 * 如果该配置项已存在，会被覆盖；如果不存在，会新增。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - location: 配置位置（Local=仓库级 / Global=用户级）
 * - key: 配置键名（如 "user.name"、"remote.origin.url"、"push.default"）
 * - value: 配置值
 *
 * 返回值：
 * - Ok(()) - 设置成功
 * - Err(GitError) - 设置失败（如键名非法、git 命令执行失败等）
 *
 * 使用示例：
 * ```
 * // 在仓库级设置 user.name
 * set_config_value("/path/to/repo", ConfigLocation::Local, "user.name", "张三")?;
 * // 在用户级设置 push.default
 * set_config_value("/path/to/repo", ConfigLocation::Global, "push.default", "simple")?;
 * ```
 *
 * 底层命令：`git --no-pager config --local user.name 张三`
 */
pub fn set_config_value(
    repo_path: &str,
    location: ConfigLocation,
    key: &str,
    value: &str,
) -> Result<(), GitError> {
    // 构造命令参数：config --{local/global} {key} {value}
    // location.to_arg() 返回 "--local" 或 "--global"
    let args = ["config", location.to_arg(), key, value];

    // 执行 git config 命令
    run_git(repo_path, &args)?;

    Ok(())
}

/**
 * 删除 Git 配置项
 *
 * 执行 `git config --{location} --unset-all {key}` 命令，删除指定位置的所有同名配置项。
 * 使用 --unset-all 而非 --unset，是为了处理多值配置项（如 remote.<name>.url 可以有多个）。
 *
 * 参数：
 * - repo_path: 仓库根目录路径
 * - location: 配置位置（Local=仓库级 / Global=用户级）
 * - key: 要删除的配置键名
 *
 * 返回值：
 * - Ok(()) - 删除成功（即使键不存在也返回成功，git --unset-all 对不存在的键返回 0）
 * - Err(GitError) - 删除失败
 *
 * 使用示例：
 * ```
 * // 删除仓库级的 user.name 配置
 * unset_config_value("/path/to/repo", ConfigLocation::Local, "user.name")?;
 * ```
 *
 * 底层命令：`git --no-pager config --local --unset-all user.name`
 */
pub fn unset_config_value(
    repo_path: &str,
    location: ConfigLocation,
    key: &str,
) -> Result<(), GitError> {
    // 构造命令参数：config --{local/global} --unset-all {key}
    let args = ["config", location.to_arg(), "--unset-all", key];

    // 执行 git config --unset-all 命令
    run_git(repo_path, &args)?;

    Ok(())
}
