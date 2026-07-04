/*
 * 动态变色引擎模块
 *
 * 此模块负责根据壁纸的主色调，动态生成整套 CSS 变量（主题配色），
 * 并应用到页面的 :root 上，实现"壁纸驱动主题"的效果。
 *
 * 核心功能：
 * 1. 接收壁纸的主色调列表（来自 wallpaper 服务）
 * 2. 根据主色调生成全套 CSS 变量（背景色、文字色、强调色、边框色等）
 * 3. 将生成的 CSS 变量应用到 :root 上
 * 4. 暗色/亮色模式有不同的生成策略
 * 5. 支持恢复默认配色（清除动态变量，回到 CSS 文件中定义的默认值）
 *
 * 使用方式：
 * import { themeEngine } from './services/theme-engine';
 * themeEngine.applyFromWallpaper(dominantColors);
 * themeEngine.resetToDefault();
 *
 * 颜色生成策略：
 * - 取权重最高的颜色作为强调色(accent)的来源
 * - 根据强调色推算：hover变体、active变体、muted变体
 * - 背景色取主色调的极暗版本（暗色主题）或极亮版本（亮色主题）
 * - 文字色确保与背景有足够对比度（WCAG 标准）
 * - 边框色取背景色稍微亮一点/暗一点的变体
 * - 语义色（success/warning/error）保持固定，不随壁纸变化
 */

import type { DominantColor } from './wallpaper.js';

/**
 * 动态主题变量集合
 * 分别存储暗色主题和亮色主题的 CSS 变量键值对
 */
export interface DynamicTheme {
  /** 暗色主题的 CSS 变量键值对（键名不含 -- 前缀） */
  dark: Record<string, string>;
  /** 亮色主题的 CSS 变量键值对（键名不含 -- 前缀） */
  light: Record<string, string>;
}

/**
 * 语义色（固定不随壁纸变化的颜色）
 * 这些颜色代表特定含义（成功、警告、错误、信息），不应受壁纸影响
 * 取自 variables.css 中的 Catppuccin Mocha（暗色）和 Latte（亮色）配色
 */
const SEMANTIC_COLORS_DARK: Record<string, string> = {
  'success': '#a6e3a1',                           // 暗色主题成功前景色（绿色）
  'success-bg': 'rgba(166, 227, 161, 0.15)',      // 暗色主题成功背景色
  'warning': '#f9e2af',                           // 暗色主题警告前景色（黄色）
  'warning-bg': 'rgba(249, 226, 175, 0.15)',      // 暗色主题警告背景色
  'error': '#f38ba8',                             // 暗色主题错误前景色（红色）
  'error-bg': 'rgba(243, 139, 168, 0.15)',        // 暗色主题错误背景色
  'info': '#89b4fa',                              // 暗色主题信息前景色（蓝色）
  'info-bg': 'rgba(137, 180, 250, 0.15)',         // 暗色主题信息背景色
  'branch-local': '#89b4fa',                      // 暗色主题本地分支颜色
  'branch-remote': '#f38ba8',                     // 暗色主题远程分支颜色
  'branch-tag': '#a6e3a1',                        // 暗色主题标签颜色
  'diff-add': '#a6e3a1',                          // 暗色主题新增行颜色
  'diff-add-bg': 'rgba(166, 227, 161, 0.15)',     // 暗色主题新增行背景色
  'diff-remove': '#f38ba8',                       // 暗色主题删除行颜色
  'diff-remove-bg': 'rgba(243, 139, 168, 0.15)',  // 暗色主题删除行背景色
  'diff-modify': '#f9e2af',                       // 暗色主题修改行颜色
  'diff-modify-bg': 'rgba(249, 226, 175, 0.15)',  // 暗色主题修改行背景色
};

const SEMANTIC_COLORS_LIGHT: Record<string, string> = {
  'success': '#40a02b',                           // 亮色主题成功前景色
  'success-bg': 'rgba(64, 160, 43, 0.15)',        // 亮色主题成功背景色
  'warning': '#df8e1d',                           // 亮色主题警告前景色
  'warning-bg': 'rgba(223, 142, 29, 0.15)',       // 亮色主题警告背景色
  'error': '#d20f39',                             // 亮色主题错误前景色
  'error-bg': 'rgba(210, 15, 57, 0.15)',          // 亮色主题错误背景色
  'info': '#1e66f5',                              // 亮色主题信息前景色
  'info-bg': 'rgba(30, 102, 245, 0.15)',          // 亮色主题信息背景色
  'branch-local': '#1e66f5',                      // 亮色主题本地分支颜色
  'branch-remote': '#d20f39',                     // 亮色主题远程分支颜色
  'branch-tag': '#40a02b',                        // 亮色主题标签颜色
  'diff-add': '#40a02b',                          // 亮色主题新增行颜色
  'diff-add-bg': 'rgba(64, 160, 43, 0.15)',       // 亮色主题新增行背景色
  'diff-remove': '#d20f39',                       // 亮色主题删除行颜色
  'diff-remove-bg': 'rgba(210, 15, 57, 0.15)',    // 亮色主题删除行背景色
  'diff-modify': '#df8e1d',                       // 亮色主题修改行颜色
  'diff-modify-bg': 'rgba(223, 142, 29, 0.15)',   // 亮色主题修改行背景色
};

/**
 * 应用到 :root 上的动态 CSS 变量的样式 ID
 * 用于后续查找和移除动态样式
 */
const DYNAMIC_STYLE_ID = 'gittimeprism-dynamic-theme';

/**
 * WCAG 对比度标准要求的最小对比度
 * 4.5:1 是 AA 级别对正文文字的要求
 */
const MIN_CONTRAST_RATIO = 4.5;

/**
 * 动态变色引擎类
 *
 * 根据壁纸的主色调，生成并应用动态主题配色。
 * 使用单例模式导出，整个应用共享同一个实例。
 */
class ThemeEngine {
  /**
   * 根据壁纸主色调生成并应用动态主题
   *
   * 工作流程：
   * 1. 根据主色调列表生成暗色主题和亮色主题的 CSS 变量
   * 2. 将两套变量写入 <style> 标签并添加到 <head> 中
   * 3. 暗色变量写在 :root 选择器中（默认生效）
   * 4. 亮色变量写在 [data-theme="light"] 选择器中（亮色模式切换时生效）
   *
   * @param colors - 壁纸的主色调列表（按权重降序排列）
   */
  applyFromWallpaper(colors: DominantColor[]): void {
    // 如果没有主色调数据，不做任何操作
    if (!colors || colors.length === 0) {
      return;
    }

    // 生成动态主题变量（包含暗色和亮色两套）
    const theme = this.generateTheme(colors);

    // 将生成的 CSS 变量应用到页面
    this.applyThemeToDOM(theme);
  }

  /**
   * 恢复默认主题配色
   *
   * 移除动态生成的 CSS 变量样式标签，
   * 让页面回到 variables.css 中定义的默认 Catppuccin 配色。
   */
  resetToDefault(): void {
    // 查找动态样式标签
    const styleEl = document.getElementById(DYNAMIC_STYLE_ID);
    if (styleEl) {
      // 如果存在，从 DOM 中移除
      styleEl.remove();
    }
  }

  /**
   * 根据壁纸主色调生成动态主题变量（不应用，仅计算）
   *
   * 生成策略：
   * - 强调色(accent)：取权重最高的颜色的色相，调整为高饱和度、中亮度
   * - 强调悬停色：色相不变，亮度略增
   * - 强调激活色：色相不变，亮度再增或饱和度微调
   * - 弱化强调色：强调色的半透明版本
   * - 暗色背景：取主色调色相，极低亮度（5%-15%）
   * - 亮色背景：取主色调色相，极低饱和度、极高亮度（95%-98%）
   * - 文字色：确保与背景有足够对比度
   * - 边框色：背景色的略微变体
   *
   * @param colors - 壁纸的主色调列表
   * @returns 动态主题变量集合（暗色 + 亮色）
   */
  private generateTheme(colors: DominantColor[]): DynamicTheme {
    // 取权重最高的颜色作为强调色的来源
    const primaryColor = colors[0];
    // 将 RGB 转为 HSL，方便调整色相、饱和度、亮度
    const [primaryH, primaryS, primaryL] = this.rgbToHsl(
      primaryColor.r, primaryColor.g, primaryColor.b
    );

    // 如果有第二种主色调，用来丰富背景色
    const secondaryColor = colors.length > 1 ? colors[1] : primaryColor;
    const [secondaryH, secondaryS, secondaryL] = this.rgbToHsl(
      secondaryColor.r, secondaryColor.g, secondaryColor.b
    );

    // 如果有第三种主色调，用于渐变光斑
    const tertiaryColor = colors.length > 2 ? colors[2] : secondaryColor;
    const [tertiaryH, tertiaryS, tertiaryL] = this.rgbToHsl(
      tertiaryColor.r, tertiaryColor.g, tertiaryColor.b
    );

    // ---- 生成暗色主题变量 ----
    const darkVars = this.generateDarkTheme(
      primaryH, primaryS, primaryL,
      secondaryH, secondaryS, secondaryL,
      tertiaryH, tertiaryS, tertiaryL
    );

    // ---- 生成亮色主题变量 ----
    const lightVars = this.generateLightTheme(
      primaryH, primaryS, primaryL,
      secondaryH, secondaryS, secondaryL,
      tertiaryH, tertiaryS, tertiaryL
    );

    return { dark: darkVars, light: lightVars };
  }

  /**
   * 生成暗色主题的 CSS 变量
   *
   * 暗色主题策略：
   * - 背景色：使用壁纸主色调的色相，极低亮度
   * - 文字色：浅色，确保与深色背景有足够对比度
   * - 强调色：壁纸主色调的色相，提高饱和度和亮度
   * - 边框色：背景色稍亮一点的变体
   *
   * @param pH - 主色调色相 (0-360)
   * @param pS - 主色调饱和度 (0-100)
   * @param pL - 主色调亮度 (0-100)
   * @param sH - 次色调色相
   * @param sS - 次色调饱和度
   * @param sL - 次色调亮度
   * @param tH - 第三色调色相
   * @param tS - 第三色调饱和度
   * @param tL - 第三色调亮度
   * @returns 暗色主题的 CSS 变量键值对
   */
  private generateDarkTheme(
    pH: number, pS: number, pL: number,
    sH: number, sS: number, sL: number,
    tH: number, tS: number, tL: number
  ): Record<string, string> {
    // ---- 背景色阶 ----
    // 主背景色：壁纸色相 + 低饱和度(15%) + 极低亮度(10%)
    const bgPrimary = this.hslToHex(pH, 15, 10);
    // 次级背景色：略低于主背景亮度，用于毛玻璃面板
    const bgSecondary = `hsla(${pH}, 15%, 8%, 0.32)`;
    // 三级背景色：更暗一点，用于毛玻璃栏
    const bgTertiary = `hsla(${pH}, 15%, 6%, 0.42)`;
    // 表面色：比主背景亮一些，用于按钮/输入框
    const bgSurface = this.hslToHex(pH, 12, 20);
    // 悬停背景色：比表面色更亮一点
    const bgHover = this.hslToHex(pH, 10, 28);
    // 激活背景色：悬停色再亮一点
    const bgActive = this.hslToHex(pH, 10, 35);

    // ---- 强调色 ----
    // 主强调色：壁纸色相 + 高饱和度(65%) + 中等亮度(65%)
    const accent = this.hslToHex(pH, 65, 65);
    // 强调悬停色：亮度提高 5%
    const accentHover = this.hslToHex(pH, 65, 70);
    // 强调激活色：亮度提高 10%，饱和度略降
    const accentActive = this.hslToHex(pH, 60, 75);
    // 弱化强调色：半透明版本
    const accentMuted = `hsla(${pH}, 65%, 65%, 0.2)`;

    // ---- 文字色阶 ----
    // 主文字色：极浅色，与深色背景形成高对比度
    const textPrimary = this.ensureContrast(
      this.hslToHex(pH, 10, 85), bgPrimary
    );
    // 次要文字色：比主文字色稍暗
    const textSecondary = this.hslToHex(pH, 8, 70);
    // 弱化文字色：更暗的文字色，用于提示
    const textMuted = this.hslToHex(pH, 5, 45);
    // 反色文字：深色文字，用于强调色按钮上的文字
    const textInverse = bgPrimary;

    // ---- 边框色 ----
    // 边框色：背景色稍亮的半透明版本
    const border = `hsla(${pH}, 12%, 28%, 0.4)`;
    // 弱化边框色
    const borderSubtle = `hsla(${pH}, 10%, 20%, 0.3)`;
    // 分隔线颜色
    const divider = `hsla(${pH}, 10%, 20%, 0.3)`;

    // ---- 阴影 ----
    const shadowSm = `0 1px 2px rgba(0, 0, 0, 0.3)`;
    const shadowMd = `0 4px 8px rgba(0, 0, 0, 0.4)`;
    const shadowLg = `0 8px 16px rgba(0, 0, 0, 0.5)`;

    // ---- 底层渐变背景（毛玻璃效果的底层） ----
    // 使用壁纸主色调生成彩色光斑，让毛玻璃效果能看到壁纸颜色
    const appBg = [
      // 第一个光斑：主色调，位于左中
      `radial-gradient(ellipse at 20% 50%, hsla(${pH}, 60%, 50%, 0.25) 0%, transparent 50%)`,
      // 第二个光斑：次色调，位于右上
      `radial-gradient(ellipse at 80% 20%, hsla(${sH}, 50%, ${Math.min(sL, 60)}%, 0.18) 0%, transparent 50%)`,
      // 第三个光斑：第三色调，位于下中
      `radial-gradient(ellipse at 50% 80%, hsla(${tH}, 45%, ${Math.min(tL, 55)}%, 0.15) 0%, transparent 50%)`,
      // 基础渐变：从主背景色到更暗的版本
      `linear-gradient(135deg, ${bgPrimary} 0%, ${this.hslToHex(pH, 15, 7)} 50%, ${this.hslToHex(pH, 15, 4)} 100%)`,
    ].join(',\n    ');

    // ---- 滚动条 ----
    const scrollbarThumb = `hsla(${pH}, 10%, 28%, 0.4)`;

    // 合并所有变量（动态生成的 + 固定的语义色）

    const vars: Record<string, string> = {
      // 背景色阶
      'bg-primary': bgPrimary,
      'bg-secondary': bgSecondary,
      'bg-tertiary': bgTertiary,
      'bg-surface': bgSurface,
      'bg-hover': bgHover,
      'bg-active': bgActive,
      // 文字色阶
      'text-primary': textPrimary,
      'text-secondary': textSecondary,
      'text-muted': textMuted,
      'text-inverse': textInverse,
      // 强调色
      'accent': accent,
      'accent-hover': accentHover,
      'accent-active': accentActive,
      'accent-muted': accentMuted,
      // 边框色
      'border': border,
      'border-subtle': borderSubtle,
      'divider': divider,
      // 阴影
      'shadow-sm': shadowSm,
      'shadow-md': shadowMd,
      'shadow-lg': shadowLg,
      // 底层渐变背景
      'app-bg': appBg,
      // 滚动条
      'scrollbar-thumb': scrollbarThumb,
    };

    // 合入固定的语义色（不随壁纸变化）
    Object.assign(vars, SEMANTIC_COLORS_DARK);

    return vars;
  }

  /**
   * 生成亮色主题的 CSS 变量
   *
   * 亮色主题策略：
   * - 背景色：壁纸主色调的色相，极低饱和度 + 极高亮度
   * - 文字色：深色，确保与浅色背景有足够对比度
   * - 强调色：壁纸主色调的色相，较高饱和度 + 中等亮度
   * - 边框色：背景色稍暗一点的变体
   *
   * @param pH - 主色调色相 (0-360)
   * @param pS - 主色调饱和度 (0-100)
   * @param pL - 主色调亮度 (0-100)
   * @param sH - 次色调色相
   * @param sS - 次色调饱和度
   * @param sL - 次色调亮度
   * @param tH - 第三色调色相
   * @param tS - 第三色调饱和度
   * @param tL - 第三色调亮度
   * @returns 亮色主题的 CSS 变量键值对
   */
  private generateLightTheme(
    pH: number, pS: number, pL: number,
    sH: number, sS: number, sL: number,
    tH: number, tS: number, tL: number
  ): Record<string, string> {
    // ---- 背景色阶 ----
    // 主背景色：壁纸色相 + 极低饱和度(8%) + 极高亮度(96%)
    const bgPrimary = this.hslToHex(pH, 8, 96);
    // 次级背景色：略低亮度，用于毛玻璃面板
    const bgSecondary = `hsla(${pH}, 8%, 93%, 0.35)`;
    // 三级背景色：更暗一点，用于毛玻璃栏
    const bgTertiary = `hsla(${pH}, 8%, 90%, 0.45)`;
    // 表面色：比主背景暗一些，用于按钮/输入框
    const bgSurface = this.hslToHex(pH, 6, 85);
    // 悬停背景色
    const bgHover = this.hslToHex(pH, 6, 80);
    // 激活背景色
    const bgActive = this.hslToHex(pH, 5, 75);

    // ---- 强调色 ----
    // 亮色主题强调色：壁纸色相 + 高饱和度 + 中低亮度（在浅色背景上要足够深）
    const accent = this.hslToHex(pH, 70, 45);
    // 强调悬停色：亮度略增
    const accentHover = this.hslToHex(pH, 65, 50);
    // 强调激活色
    const accentActive = this.hslToHex(pH, 60, 55);
    // 弱化强调色
    const accentMuted = `hsla(${pH}, 70%, 45%, 0.15)`;

    // ---- 文字色阶 ----
    // 主文字色：深色，与浅色背景形成高对比度
    const textPrimary = this.ensureContrast(
      this.hslToHex(pH, 15, 20), bgPrimary
    );
    // 次要文字色：比主文字色稍浅
    const textSecondary = this.hslToHex(pH, 10, 30);
    // 弱化文字色
    const textMuted = this.hslToHex(pH, 5, 60);
    // 反色文字：浅色文字，用于强调色按钮上
    const textInverse = bgPrimary;

    // ---- 边框色 ----
    const border = `hsla(${pH}, 6%, 75%, 0.4)`;
    const borderSubtle = `hsla(${pH}, 5%, 82%, 0.3)`;
    const divider = `hsla(${pH}, 5%, 82%, 0.3)`;

    // ---- 阴影 ----
    const shadowSm = `0 1px 2px rgba(0, 0, 0, 0.1)`;
    const shadowMd = `0 4px 8px rgba(0, 0, 0, 0.12)`;
    const shadowLg = `0 8px 16px rgba(0, 0, 0, 0.15)`;

    // ---- 底层渐变背景（毛玻璃效果的底层） ----
    const appBg = [
      // 第一个光斑：主色调，位于左中
      `radial-gradient(ellipse at 20% 50%, hsla(${pH}, 55%, 45%, 0.20) 0%, transparent 50%)`,
      // 第二个光斑：次色调，位于右上
      `radial-gradient(ellipse at 80% 20%, hsla(${sH}, 45%, ${Math.max(sL, 40)}%, 0.15) 0%, transparent 50%)`,
      // 第三个光斑：第三色调，位于下中
      `radial-gradient(ellipse at 50% 80%, hsla(${tH}, 40%, ${Math.max(tL, 35)}%, 0.12) 0%, transparent 50%)`,
      // 基础渐变：从主背景色到稍暗的版本
      `linear-gradient(135deg, ${bgPrimary} 0%, ${this.hslToHex(pH, 8, 93)} 50%, ${this.hslToHex(pH, 8, 90)} 100%)`,
    ].join(',\n    ');

    // ---- 滚动条 ----
    const scrollbarThumb = `hsla(${pH}, 6%, 75%, 0.4)`;

    // 合并所有变量
    const vars: Record<string, string> = {
      // 背景色阶
      'bg-primary': bgPrimary,
      'bg-secondary': bgSecondary,
      'bg-tertiary': bgTertiary,
      'bg-surface': bgSurface,
      'bg-hover': bgHover,
      'bg-active': bgActive,
      // 文字色阶
      'text-primary': textPrimary,
      'text-secondary': textSecondary,
      'text-muted': textMuted,
      'text-inverse': textInverse,
      // 强调色
      'accent': accent,
      'accent-hover': accentHover,
      'accent-active': accentActive,
      'accent-muted': accentMuted,
      // 边框色
      'border': border,
      'border-subtle': borderSubtle,
      'divider': divider,
      // 阴影
      'shadow-sm': shadowSm,
      'shadow-md': shadowMd,
      'shadow-lg': shadowLg,
      // 底层渐变背景
      'app-bg': appBg,
      // 滚动条
      'scrollbar-thumb': scrollbarThumb,
    };

    // 合入固定的语义色（不随壁纸变化）
    Object.assign(vars, SEMANTIC_COLORS_LIGHT);

    return vars;
  }

  /**
   * 将动态主题应用到 DOM
   *
   * 生成一个 <style> 标签，包含 :root 和 [data-theme="light"] 两个选择器，
   * 分别设置暗色主题和亮色主题的 CSS 变量。
   * 这个 <style> 标签的优先级高于 variables.css 中的默认值，
   * 因为后加载的样式会覆盖先加载的。
   *
   * @param theme - 动态主题变量集合
   */
  private applyThemeToDOM(theme: DynamicTheme): void {
    // 查找或创建动态样式标签
    let styleEl = document.getElementById(DYNAMIC_STYLE_ID) as HTMLStyleElement | null;
    if (!styleEl) {
      // 如果不存在，创建新的 <style> 标签
      styleEl = document.createElement('style');
      styleEl.id = DYNAMIC_STYLE_ID;
      document.head.appendChild(styleEl);
    }

    // 生成暗色主题的 CSS 变量声明
    // 格式：--变量名: 值;
    const darkVarsCSS = Object.entries(theme.dark)
      .map(([key, value]) => `  --${key}: ${value};`)
      .join('\n');

    // 生成亮色主题的 CSS 变量声明
    const lightVarsCSS = Object.entries(theme.light)
      .map(([key, value]) => `  --${key}: ${value};`)
      .join('\n');

    // 组合成完整的 CSS 规则
    styleEl.textContent = [
      `/* 动态主题 - 由壁纸变色引擎自动生成 */`,
      `:root {`,
      darkVarsCSS,
      `}`,
      ``,
      `[data-theme="light"] {`,
      lightVarsCSS,
      `}`,
    ].join('\n');
  }

  /**
   * 将 RGB 颜色转换为 HSL 颜色
   *
   * HSL 表示：色相(Hue)、饱和度(Saturation)、亮度(Lightness)
   * - 色相：0-360 的角度，表示颜色在色轮上的位置
   * - 饱和度：0-100%，0% 是灰色，100% 是纯色
   * - 亮度：0-100%，0% 是黑色，100% 是白色，50% 是纯色
   *
   * 转换公式参考：https://www.rapidtables.com/convert/color/rgb-to-hsl.html
   *
   * @param r - 红色通道值 (0-255)
   * @param g - 绿色通道值 (0-255)
   * @param b - 蓝色通道值 (0-255)
   * @returns [色相(0-360), 饱和度(0-100), 亮度(0-100)] 的元组
   */
  private rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    // 将 RGB 从 0-255 范围归一化到 0-1 范围
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;

    // 找出 RGB 三通道中的最大值和最小值
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);

    // 亮度(L) = (最大值 + 最小值) / 2
    const l = (max + min) / 2;

    // 如果最大值等于最小值，说明三个通道相等（灰色）
    // 此时色相和饱和度都为 0
    if (max === min) {
      return [0, 0, Math.round(l * 100)];
    }

    // 计算中间变量 d（最大值与最小值之差）
    const d = max - min;

    // 饱和度(S)的计算取决于亮度：
    // - 亮度 <= 50% 时，S = d / (max + min)
    // - 亮度 > 50% 时，S = d / (2 - max - min)
    const s = l > 0.5
      ? d / (2 - max - min)
      : d / (max + min);

    // 色相(H)的计算取决于哪个通道是最大值
    let h = 0;
    if (max === rn) {
      // 红色最大：色相在 0-60 度或 300-360 度之间
      h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
    } else if (max === gn) {
      // 绿色最大：色相在 60-180 度之间
      h = ((bn - rn) / d + 2) / 6;
    } else {
      // 蓝色最大：色相在 180-300 度之间
      h = ((rn - gn) / d + 4) / 6;
    }

    // 返回 [色相(0-360), 饱和度(0-100), 亮度(0-100)]
    return [
      Math.round(h * 360),       // 色相：从 0-1 转换到 0-360
      Math.round(s * 100),       // 饱和度：从 0-1 转换到 0-100
      Math.round(l * 100),       // 亮度：从 0-1 转换到 0-100
    ];
  }

  /**
   * 将 HSL 颜色转换为 RGB 颜色
   *
   * 转换公式参考：https://www.rapidtables.com/convert/color/hsl-to-rgb.html
   *
   * @param h - 色相 (0-360)
   * @param s - 饱和度 (0-100)
   * @param l - 亮度 (0-100)
   * @returns [红(0-255), 绿(0-255), 蓝(0-255)] 的元组
   */
  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    // 将 HSL 从百分比范围归一化到 0-1 范围
    const hn = h / 360;
    const sn = s / 100;
    const ln = l / 100;

    // 如果饱和度为 0，颜色是灰色（RGB 三通道相等）
    if (sn === 0) {
      const val = Math.round(ln * 255);
      return [val, val, val];
    }

    // 辅助函数：根据色相和亮度计算单个通道的值
    const hueToRgb = (p: number, q: number, t: number): number => {
      // 确保 t 在 0-1 范围内
      if (t < 0) t += 1;
      if (t > 1) t -= 1;

      // 根据 t 的值选择不同的计算方式
      if (t < 1 / 6) return p + (q - p) * 6 * t;           // 0-60 度区间
      if (t < 1 / 2) return q;                               // 60-180 度区间
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; // 180-240 度区间
      return p;                                               // 240-360 度区间
    };

    // 计算中间变量 q 和 p
    // q = 亮度 > 50% 时：L + (1-L) * S，否则 L * (1+S)
    // p = 2L - q
    const q = ln < 0.5
      ? ln * (1 + sn)
      : ln + sn - ln * sn;
    const p = 2 * ln - q;

    // 分别计算 RGB 三通道
    const r = hueToRgb(p, q, hn + 1 / 3);  // 红色通道
    const g = hueToRgb(p, q, hn);           // 绿色通道
    const b = hueToRgb(p, q, hn - 1 / 3);  // 蓝色通道

    return [
      Math.round(r * 255),  // 红色：从 0-1 转换到 0-255
      Math.round(g * 255),  // 绿色：从 0-1 转换到 0-255
      Math.round(b * 255),  // 蓝色：从 0-1 转换到 0-255
    ];
  }

  /**
   * 将 HSL 颜色转换为十六进制颜色字符串
   *
   * 先转 RGB，再转为 #RRGGBB 格式。
   *
   * @param h - 色相 (0-360)
   * @param s - 饱和度 (0-100)
   * @param l - 亮度 (0-100)
   * @returns 十六进制颜色字符串，如 "#1e1e2e"
   */
  private hslToHex(h: number, s: number, l: number): string {
    const [r, g, b] = this.hslToRgb(h, s, l);
    // 将每个通道值转为两位十六进制字符串，并拼接
    // padStart(2, '0') 确保单位数前面补零（如 15 → "0f"）
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * 确保文字颜色与背景颜色有足够的对比度
   *
   * 使用 WCAG 2.0 对比度算法计算两种颜色的对比度。
   * 如果对比度不足 4.5:1（AA 级标准），会逐步调整文字颜色的亮度，
   * 直到满足对比度要求。
   *
   * 对比度计算公式：
   * ratio = (L1 + 0.05) / (L2 + 0.05)
   * 其中 L1 是较亮颜色的相对亮度，L2 是较暗颜色的相对亮度
   *
   * @param textColor - 文字颜色的十六进制字符串（如 "#cdd6f4"）
   * @param bgColor - 背景颜色的十六进制字符串（如 "#1e1e2e"）
   * @returns 调整后的文字颜色（确保与背景对比度 >= 4.5:1）
   */
  private ensureContrast(textColor: string, bgColor: string): string {
    // 计算当前对比度
    const ratio = this.getContrastRatio(textColor, bgColor);

    // 如果对比度已经足够，直接返回原色
    if (ratio >= MIN_CONTRAST_RATIO) {
      return textColor;
    }

    // 对比度不足，需要调整文字颜色的亮度
    // 先将文字颜色转为 HSL
    const textRgb = this.hexToRgb(textColor);
    const [h, s, l] = this.rgbToHsl(textRgb[0], textRgb[1], textRgb[2]);

    // 判断文字应该变亮还是变暗
    // 如果背景是深色，文字应该变亮；如果背景是浅色，文字应该变暗
    const bgRgb = this.hexToRgb(bgColor);
    const bgLuminance = this.getRelativeLuminance(bgRgb[0], bgRgb[1], bgRgb[2]);
    const isDarkBg = bgLuminance < 0.5; // 背景亮度 < 0.5 视为深色背景

    // 逐步调整亮度，每次步进 5%，最多尝试 20 次
    let adjustedL = l;
    for (let i = 0; i < 20; i++) {
      // 深色背景→文字变亮，浅色背景→文字变暗
      adjustedL = isDarkBg ? adjustedL + 5 : adjustedL - 5;

      // 限制亮度范围在 5%-95%（避免纯黑或纯白）
      adjustedL = Math.max(5, Math.min(95, adjustedL));

      // 生成调整后的颜色
      const adjustedColor = this.hslToHex(h, s, adjustedL);
      // 重新计算对比度
      const newRatio = this.getContrastRatio(adjustedColor, bgColor);

      // 如果对比度满足要求，返回调整后的颜色
      if (newRatio >= MIN_CONTRAST_RATIO) {
        return adjustedColor;
      }
    }

    // 如果 20 次调整后仍不满足，返回最后一次调整的颜色
    // 这种情况极少发生，说明壁纸颜色极为极端
    return this.hslToHex(h, s, adjustedL);
  }

  /**
   * 计算两种颜色之间的对比度
   *
   * 使用 WCAG 2.0 对比度算法。
   * 对比度范围：1:1（无对比）到 21:1（黑白对比）。
   *
   * @param color1 - 第一种颜色的十六进制字符串
   * @param color2 - 第二种颜色的十六进制字符串
   * @returns 对比度比值（如 4.5 表示 4.5:1）
   */
  private getContrastRatio(color1: string, color2: string): number {
    // 将十六进制颜色转为 RGB
    const rgb1 = this.hexToRgb(color1);
    const rgb2 = this.hexToRgb(color2);

    // 计算两种颜色的相对亮度
    const l1 = this.getRelativeLuminance(rgb1[0], rgb1[1], rgb1[2]);
    const l2 = this.getRelativeLuminance(rgb2[0], rgb2[1], rgb2[2]);

    // 较亮颜色放分子，较暗颜色放分母
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);

    // WCAG 对比度公式
    return (lighter + 0.05) / (darker + 0.05);
  }

  /**
   * 计算颜色的相对亮度
   *
   * 相对亮度是 WCAG 2.0 定义的颜色亮度标准，
   * 范围从 0（纯黑）到 1（纯白）。
   *
   * 公式：
   * L = 0.2126 * R' + 0.7152 * G' + 0.0722 * B'
   * 其中 R', G', B' 是经过 gamma 校正的 sRGB 值
   *
   * @param r - 红色通道值 (0-255)
   * @param g - 绿色通道值 (0-255)
   * @param b - 蓝色通道值 (0-255)
   * @returns 相对亮度值 (0-1)
   */
  private getRelativeLuminance(r: number, g: number, b: number): number {
    // 将 0-255 范围归一化到 0-1
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;

    // Gamma 校正（sRGB 到线性 RGB 的转换）
    // 亮度 <= 0.03928 的部分使用线性映射
    // 亮度 > 0.03928 的部分使用幂函数映射
    const sR = rn <= 0.03928 ? rn / 12.92 : Math.pow((rn + 0.055) / 1.055, 2.4);
    const sG = gn <= 0.03928 ? gn / 12.92 : Math.pow((gn + 0.055) / 1.055, 2.4);
    const sB = bn <= 0.03928 ? bn / 12.92 : Math.pow((bn + 0.055) / 1.055, 2.4);

    // 加权求和：绿色权重最大（人眼对绿色最敏感）
    return 0.2126 * sR + 0.7152 * sG + 0.0722 * sB;
  }

  /**
   * 将十六进制颜色字符串转换为 RGB 值
   *
   * @param hex - 十六进制颜色字符串（如 "#1e1e2e" 或 "#fff"）
   * @returns [红, 绿, 蓝] 的元组，每个值范围 0-255
   */
  private hexToRgb(hex: string): [number, number, number] {
    // 去掉 # 前缀
    const cleanHex = hex.replace('#', '');

    // 处理简写格式（如 "#fff" → "#ffffff"）
    const fullHex = cleanHex.length === 3
      ? cleanHex.split('').map(c => c + c).join('')
      : cleanHex;

    // 分别解析 RGB 三通道
    const r = parseInt(fullHex.substring(0, 2), 16); // 红色通道
    const g = parseInt(fullHex.substring(2, 4), 16); // 绿色通道
    const b = parseInt(fullHex.substring(4, 6), 16); // 蓝色通道

    return [r, g, b];
  }
}

/**
 * 动态变色引擎单例
 * 整个应用共享同一个引擎实例，确保主题状态一致
 */
export const themeEngine = new ThemeEngine();
