/*
 * 工具函数模块入口
 * 
 * 此文件是工具函数模块的入口，将不同功能的工具
 * 分组到子模块中：
 * - watcher: 文件系统变化监听
 * - process: 进程管理辅助函数
 */

// 文件监听工具模块（使用 notify crate 监听文件系统变化）
pub mod watcher;
// 进程管理工具模块（封装 Command 调用、隐藏控制台窗口等）
pub mod process;
