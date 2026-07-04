/*
 * 壁纸服务模块
 *
 * 此模块负责管理应用的壁纸功能，包括：
 * 1. 通过 Tauri 文件对话框选择壁纸图片
 * 2. 通过 Rust 后端命令读取图片为 base64 data URL（最可靠）
 * 3. 将 base64 数据保存到 localStorage
 * 4. 从壁纸图片中提取主色调（Canvas 采样 + K-means 聚类）
 * 5. 清除壁纸（恢复默认渐变背景）
 *
 * 为什么使用 Rust 命令而不是前端 readFile？
 * @tauri-apps/plugin-fs 的 readFile 在 Windows 上因为 scope 权限配置问题
 * 经常静默失败（不报错但返回 undefined 或抛出权限异常）。
 * Rust 命令拥有完整的文件系统访问权限，最可靠。
 *
 * 为什么不用 convertFileSrc？
 * convertFileSrc 生成的 http://asset.localhost/ URL 在 Windows WebView2 中
 * 存在兼容性问题（CORS、协议处理），图片经常加载失败。
 *
 * 使用方式：
 * import { wallpaperService } from './services/wallpaper';
 * const state = await wallpaperService.selectWallpaper();
 *
 * localStorage 存储说明：
 * - gittimeprism_wallpaper_data：存储壁纸的 base64 data URL
 * - gittimeprism_wallpaper_colors：存储提取的主色调 JSON 数组
 */

import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';

/**
 * 主色调数据结构
 * 表示从壁纸图片中提取出的一种主要颜色
 */
export interface DominantColor {
  /** 红色通道值，范围 0-255 */
  r: number;
  /** 绿色通道值，范围 0-255 */
  g: number;
  /** 蓝色通道值，范围 0-255 */
  b: number;
  /** 该颜色在图片中的占比权重，范围 0-1 */
  weight: number;
}

/**
 * 壁纸状态数据结构
 */
export interface WallpaperState {
  /** 壁纸的 base64 data URL（可直接用于 CSS background-image: url(...)） */
  dataUrl: string | null;
  /** 提取的主色调列表，按权重从高到低排序 */
  dominantColors: DominantColor[];
}

/** localStorage 中存储壁纸 base64 数据的键名 */
const STORAGE_KEY_DATA = 'gittimeprism_wallpaper_data';
/** localStorage 中存储主色调数据的键名 */
const STORAGE_KEY_COLORS = 'gittimeprism_wallpaper_colors';
/** K-means 聚类数量 */
const K_MEANS_K = 5;
/** K-means 最大迭代次数 */
const K_MEANS_MAX_ITERATIONS = 20;
/** 图片采样尺寸（缩小到此大小后提取颜色） */
const SAMPLE_SIZE = 50;

/**
 * 壁纸服务类
 *
 * 使用单例模式导出，整个应用共享同一个实例。
 * 核心设计：使用 Rust 命令读取文件返回 base64 data URL，
 * 直接通过 CSS background-image 显示，最可靠。
 */
class WallpaperService {
  /**
   * 选择并设置壁纸
   *
   * 工作流程：
   * 1. 打开文件选择对话框
   * 2. 调用 Rust 命令 read_image_as_data_url 读取图片为 base64
   * 3. 异步提取图片主色调
   * 4. 保存 base64 和颜色到 localStorage
   *
   * @returns 壁纸状态，取消返回 null，失败返回 null（保持当前状态不变）
   */
  async selectWallpaper(): Promise<WallpaperState | null> {
    try {
      // 第一步：打开文件选择对话框
      const selected = await open({
        filters: [
          {
            name: '图片文件',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'],
          },
        ],
        multiple: false,
      });

      // 用户取消选择
      if (!selected) {
        return null;
      }

      // 获取文件路径
      const filePath = typeof selected === 'string' ? selected : selected[0];
      if (!filePath) {
        return null;
      }

      console.log('[壁纸] 选择文件:', filePath);

      // 第二步：调用 Rust 命令读取图片为 base64 data URL
      // Rust 命令拥有完整文件系统权限，比前端 readFile 可靠
      let dataUrl: string;
      try {
        dataUrl = await invoke<string>('read_image_as_data_url', { path: filePath });
      } catch (invokeErr) {
        console.error('[壁纸] Rust 命令读取图片失败:', invokeErr);
        return null; // 失败时返回 null，保持当前状态不变
      }

      // Rust 命令失败时返回空字符串
      if (!dataUrl || dataUrl.length === 0) {
        console.error('[壁纸] Rust 命令返回空数据');
        return null;
      }

      console.log('[壁纸] base64 数据大小:', Math.round(dataUrl.length / 1024), 'KB');

      // 第三步：异步提取主色调
      const dominantColors = await this.extractColorsAsync(dataUrl);
      console.log('[壁纸] 提取到主色调:', dominantColors.length, '种');

      // 第四步：保存到 localStorage（大图片可能超出存储限制，用 try/catch 保护）
      try {
        localStorage.setItem(STORAGE_KEY_DATA, dataUrl);
        localStorage.setItem(STORAGE_KEY_COLORS, JSON.stringify(dominantColors));
        console.log('[壁纸] 数据已保存到 localStorage');
      } catch (storageErr) {
        // localStorage 通常有 5-10MB 限制，大图片 base64 可能超出
        console.warn('[壁纸] 保存到 localStorage 失败（可能超出存储限制）:', storageErr);
        // 不影响当前显示，但下次启动时壁纸不会被恢复
      }

      return {
        dataUrl,
        dominantColors,
      };
    } catch (err) {
      console.error('[壁纸] 选择壁纸时发生错误:', err);
      return null; // 出错时返回 null，保持当前状态不变
    }
  }

  /**
   * 加载已保存的壁纸
   *
   * 从 localStorage 读取 base64 data URL 和颜色数据。
   *
   * @returns 壁纸状态，没有则返回 null
   */
  loadWallpaper(): WallpaperState | null {
    const dataUrl = localStorage.getItem(STORAGE_KEY_DATA);
    if (!dataUrl) {
      return null;
    }

    const colorsJson = localStorage.getItem(STORAGE_KEY_COLORS);
    let dominantColors: DominantColor[] = [];
    if (colorsJson) {
      try {
        dominantColors = JSON.parse(colorsJson);
      } catch {
        dominantColors = [];
      }
    }

    return {
      dataUrl,
      dominantColors,
    };
  }

  /**
   * 清除壁纸
   */
  clearWallpaper(): void {
    localStorage.removeItem(STORAGE_KEY_DATA);
    localStorage.removeItem(STORAGE_KEY_COLORS);
    // 兼容旧版本：清除旧格式的壁纸数据
    localStorage.removeItem('gittimeprism_wallpaper_path');
    localStorage.removeItem('gittimeprism_wallpaper');
  }

  /**
   * 异步从图片 data URL 中提取主色调
   *
   * 使用 Image 对象加载 data URL，等待 onload 后绘制到 Canvas 上提取颜色。
   * data URL 不受 CORS 限制，是最可靠的图片加载方式。
   *
   * @param dataUrl - 图片的 base64 data URL
   * @returns 主色调列表
   */
  private extractColorsAsync(dataUrl: string): Promise<DominantColor[]> {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve([]);
        return;
      }

      const img = new Image();
      // data URL 不需要设置 crossOrigin（不受 CORS 限制）

      img.onload = () => {
        // 将图片绘制到小画布上（缩放采样）
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        // 获取像素数据
        const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const pixels = imageData.data;
        const validPixels: [number, number, number][] = [];

        // 过滤极端颜色（太暗或太亮的像素不参与聚类）
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
          const isTooDark = r < 15 && g < 15 && b < 15;
          const isTooBright = r > 240 && g > 240 && b > 240;
          if (!isTooDark && !isTooBright) {
            validPixels.push([r, g, b]);
          }
        }

        if (validPixels.length === 0) {
          resolve([]);
          return;
        }

        // K-means 聚类提取主色调
        const clusters = this.kMeansClustering(validPixels, K_MEANS_K);
        const totalPixels = validPixels.length;

        const dominantColors: DominantColor[] = clusters.map((cluster) => ({
          r: Math.round(cluster.center[0]),
          g: Math.round(cluster.center[1]),
          b: Math.round(cluster.center[2]),
          weight: cluster.count / totalPixels,
        }));

        dominantColors.sort((a, b) => b.weight - a.weight);
        resolve(dominantColors);
      };

      img.onerror = (e) => {
        console.error('[壁纸] 图片加载失败:', e);
        resolve([]);
      };

      // 触发加载
      img.src = dataUrl;
    });
  }

  /**
   * 简化的 K-means 聚类算法
   */
  private kMeansClustering(
    pixels: [number, number, number][],
    k: number
  ): { center: [number, number, number]; count: number }[] {
    if (pixels.length <= k) {
      return pixels.map((p) => ({ center: p, count: 1 }));
    }

    // 最远点采样初始化
    const centers: [number, number, number][] = [];
    const firstIndex = Math.floor(Math.random() * pixels.length);
    centers.push([...pixels[firstIndex]]);

    for (let i = 1; i < k; i++) {
      let maxDistance = -1;
      let maxDistanceIdx = 0;

      for (let p = 0; p < pixels.length; p++) {
        let minDistToCenters = Infinity;
        for (const center of centers) {
          const dist = this.colorDistance(pixels[p], center);
          if (dist < minDistToCenters) {
            minDistToCenters = dist;
          }
        }
        if (minDistToCenters > maxDistance) {
          maxDistance = minDistToCenters;
          maxDistanceIdx = p;
        }
      }
      centers.push([...pixels[maxDistanceIdx]]);
    }

    // 迭代优化
    let assignment = new Int32Array(pixels.length).fill(-1);

    for (let iter = 0; iter < K_MEANS_MAX_ITERATIONS; iter++) {
      let changed = false;

      for (let p = 0; p < pixels.length; p++) {
        let minDist = Infinity;
        let bestCluster = 0;

        for (let c = 0; c < centers.length; c++) {
          const dist = this.colorDistance(pixels[p], centers[c]);
          if (dist < minDist) {
            minDist = dist;
            bestCluster = c;
          }
        }

        if (assignment[p] !== bestCluster) {
          assignment[p] = bestCluster;
          changed = true;
        }
      }

      if (!changed) break;

      for (let c = 0; c < centers.length; c++) {
        let sumR = 0, sumG = 0, sumB = 0, count = 0;
        for (let p = 0; p < pixels.length; p++) {
          if (assignment[p] === c) {
            sumR += pixels[p][0];
            sumG += pixels[p][1];
            sumB += pixels[p][2];
            count++;
          }
        }
        if (count > 0) {
          centers[c] = [sumR / count, sumG / count, sumB / count];
        }
      }
    }

    // 生成结果
    const clusterCounts = new Array(k).fill(0);
    for (let p = 0; p < pixels.length; p++) {
      if (assignment[p] >= 0 && assignment[p] < k) {
        clusterCounts[assignment[p]]++;
      }
    }

    const result: { center: [number, number, number]; count: number }[] = [];
    for (let c = 0; c < k; c++) {
      if (clusterCounts[c] > 0) {
        result.push({ center: centers[c], count: clusterCounts[c] });
      }
    }
    return result;
  }

  /** 计算颜色距离平方 */
  private colorDistance(
    a: [number, number, number],
    b: [number, number, number]
  ): number {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }
}

/** 壁纸服务单例 */
export const wallpaperService = new WallpaperService();
