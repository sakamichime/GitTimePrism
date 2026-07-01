/**
 * Vite 构建配置文件
 * 配置前端开发服务器和构建输出选项
 * Tauri 通过此配置连接 Vite 开发服务器
 */
import { defineConfig } from 'vite';

// Vite 构建配置
const viteConfig = defineConfig({
  // 构建输出目录，Tauri 默认从 dist 目录加载前端资源
  build: {
    outDir: 'dist',
    // 静态资源内联阈值（小于 4KB 的资源转为 base64 内联）
    assetsInlineLimit: 4096,
    // 构建前清空输出目录
    emptyOutDir: true,
  },
  // 开发服务器配置
  server: {
    // 开发服务器端口号
    port: 5173,
    // 端口被占用时报错而非自动切换（Tauri 依赖固定端口）
    strictPort: true,
  },
  // 不清除终端屏幕（避免开发时频繁清除输出）
  clearScreen: false,
});

export default viteConfig;
