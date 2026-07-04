/*
 * 壁纸服务模块
 *
 * 此模块负责管理应用的壁纸功能，包括：
 * 1. 通过 Tauri 文件对话框选择壁纸图片
 * 2. 将壁纸图片转为 base64 格式存储到 localStorage（浏览器本地存储）
 * 3. 加载已保存的壁纸数据
 * 4. 从壁纸图片中提取主色调（使用 Canvas 采样 + 简化 K-means 聚类算法）
 * 5. 清除壁纸（恢复默认渐变背景）
 *
 * 使用方式：
 * import { wallpaperService } from './services/wallpaper';
 * const state = await wallpaperService.selectWallpaper();
 *
 * localStorage 存储说明：
 * - gittimeprism_wallpaper：存储壁纸的 base64 数据 URL（如 "data:image/png;base64,..."）
 * - gittimeprism_wallpaper_colors：存储提取的主色调 JSON 数组
 */

import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';

/**
 * 主色调数据结构
 * 表示从壁纸图片中提取出的一种主要颜色
 */
export interface DominantColor {
  /** 红色通道值，范围 0-255 */
  r: number;
  /** 绿色通道值，范围 0-255 */
  g: number;
  /** 绿色通道值，范围 0-255 */
  b: number;
  /** 该颜色在图片中的占比权重，范围 0-1，所有颜色的权重之和为 1 */
  weight: number;
}

/**
 * 壁纸状态数据结构
 * 包含壁纸图片数据和提取的主色调信息
 */
export interface WallpaperState {
  /** 壁纸的 base64 数据 URL（如 "data:image/png;base64,..."），null 表示没有壁纸 */
  dataUrl: string | null;
  /** 提取的主色调列表，按权重从高到低排序 */
  dominantColors: DominantColor[];
}

/**
 * localStorage 中存储壁纸数据的键名
 */
const STORAGE_KEY_WALLPAPER = 'gittimeprism_wallpaper';

/**
 * localStorage 中存储主色调数据的键名
 */
const STORAGE_KEY_COLORS = 'gittimeprism_wallpaper_colors';

/**
 * K-means 聚类算法的聚类数量
 * 即从图片中提取多少种主色调
 */
const K_MEANS_K = 5;

/**
 * K-means 算法的最大迭代次数
 * 防止算法不收敛时无限循环
 */
const K_MEANS_MAX_ITERATIONS = 20;

/**
 * 图片缩放采样尺寸
 * 将图片缩小到此尺寸后再提取像素颜色，以提高性能
 */
const SAMPLE_SIZE = 50;

/**
 * 壁纸服务类
 *
 * 提供壁纸的选择、存储、加载、清除和颜色提取功能。
 * 使用单例模式导出，整个应用共享同一个实例。
 */
class WallpaperService {
  /**
   * 选择并设置壁纸
   *
   * 工作流程：
   * 1. 调用 Tauri 原生文件对话框，让用户选择一张图片
   * 2. 读取图片文件并转换为 base64 数据 URL
   * 3. 使用 Canvas 采样算法从图片中提取主色调（异步等待图片加载完成）
   * 4. 将壁纸数据和主色调数据保存到 localStorage
   * 5. 返回壁纸状态（包含数据 URL 和主色调列表）
   *
   * @returns 壁纸状态对象，如果用户取消选择则返回 null
   */
  async selectWallpaper(): Promise<WallpaperState | null> {
    try {
      // 第一步：打开文件选择对话框，筛选图片文件
      const selected = await open({
        // 允许的图片格式过滤条件
        filters: [
          {
            name: '图片文件',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'],
          },
        ],
        multiple: false,
      });

      // 如果用户取消选择，返回 null
      if (!selected) {
        return null;
      }

      // Tauri dialog 的 open 返回值可能是 string 或 string[]
      const filePath = typeof selected === 'string' ? selected : selected[0];
      if (!filePath) {
        return null;
      }

      // 第二步：读取图片文件为二进制数据
      const fileBytes = await readFile(filePath);

      // 第三步：将字节数组转换为 base64 编码字符串
      // 使用分块处理避免调用栈溢出（大图片二进制字符串可能很长）
      const chunkSize = 8192; // 每次处理 8KB
      let base64 = '';
      for (let i = 0; i < fileBytes.length; i += chunkSize) {
        // 取当前块的字节范围
        const chunk = fileBytes.subarray(i, Math.min(i + chunkSize, fileBytes.length));
        // 将字节块转为二进制字符串
        let binary = '';
        for (let j = 0; j < chunk.length; j++) {
          binary += String.fromCharCode(chunk[j]);
        }
        // 将二进制字符串编码为 base64
        base64 += btoa(binary);
      }

      // 根据文件扩展名推断 MIME 类型
      const mimeType = this.getMimeType(filePath);
      // 构建完整的数据 URL
      const dataUrl = `data:${mimeType};base64,${base64}`;

      // 第四步：异步从图片中提取主色调（等待图片加载完成）
      const dominantColors = await this.extractColorsAsync(dataUrl);

      // 第五步：保存到 localStorage
      localStorage.setItem(STORAGE_KEY_WALLPAPER, dataUrl);
      localStorage.setItem(STORAGE_KEY_COLORS, JSON.stringify(dominantColors));

      return {
        dataUrl,
        dominantColors,
      };
    } catch (err) {
      // 捕获所有异常（文件读取失败、对话框取消等），打印错误并返回 null
      console.error('选择壁纸时发生错误:', err);
      return null;
    }
  }

  /**
   * 加载已保存的壁纸
   *
   * 从 localStorage 中读取之前保存的壁纸数据和主色调数据。
   * 如果没有保存过壁纸，返回 null。
   *
   * @returns 壁纸状态对象，如果没有保存过壁纸则返回 null
   */
  loadWallpaper(): WallpaperState | null {
    // 读取壁纸数据 URL
    const dataUrl = localStorage.getItem(STORAGE_KEY_WALLPAPER);
    if (!dataUrl) {
      return null;
    }

    // 读取主色调数据
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
   * 清除壁纸，恢复默认
   *
   * 从 localStorage 中删除壁纸数据和主色调数据。
   */
  clearWallpaper(): void {
    localStorage.removeItem(STORAGE_KEY_WALLPAPER);
    localStorage.removeItem(STORAGE_KEY_COLORS);
  }

  /**
   * 异步从图片数据 URL 中提取主色调
   *
   * 与 extractColors 的区别：此方法使用 Promise 等待 Image 对象加载完成后再绘制，
   * 避免了在图片未加载完时调用 drawImage 导致的空白画布问题。
   *
   * 算法流程：
   * 1. 创建 Image 对象并等待其加载完成
   * 2. 将图片绘制到 50x50 的小画布上（缩小采样）
   * 3. 获取所有像素颜色数据
   * 4. 过滤极端颜色（纯黑/纯白）
   * 5. 使用 K-means 聚类提取 5 种主色调
   *
   * @param dataUrl - 图片的 base64 数据 URL
   * @returns 主色调列表，按权重从高到低排序
   */
  private extractColorsAsync(dataUrl: string): Promise<DominantColor[]> {
    return new Promise((resolve) => {
      // 创建离屏 Canvas
      const canvas = document.createElement('canvas');
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        resolve([]);
        return;
      }

      // 创建 Image 对象
      const img = new Image();

      // 图片加载完成后的回调
      img.onload = () => {
        // 将图片绘制到画布上（缩放到 SAMPLE_SIZE x SAMPLE_SIZE）
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        // 获取画布上所有像素的颜色数据
        const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const pixels = imageData.data;

        // 收集有效的像素颜色（过滤极端颜色）
        const validPixels: [number, number, number][] = [];

        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i];
          const g = pixels[i + 1];
          const b = pixels[i + 2];

          // 过滤掉接近纯黑或纯白的极端像素
          const isTooDark = r < 15 && g < 15 && b < 15;
          const isTooBright = r > 240 && g > 240 && b > 240;

          if (!isTooDark && !isTooBright) {
            validPixels.push([r, g, b]);
          }
        }

        // 如果没有有效像素，返回空数组
        if (validPixels.length === 0) {
          resolve([]);
          return;
        }

        // 使用 K-means 聚类提取主色调
        const clusters = this.kMeansClustering(validPixels, K_MEANS_K);
        const totalPixels = validPixels.length;

        // 将聚类结果转换为主色调数据
        const dominantColors: DominantColor[] = clusters.map((cluster) => ({
          r: Math.round(cluster.center[0]),
          g: Math.round(cluster.center[1]),
          b: Math.round(cluster.center[2]),
          weight: cluster.count / totalPixels,
        }));

        // 按权重从高到低排序
        dominantColors.sort((a, b) => b.weight - a.weight);

        resolve(dominantColors);
      };

      // 图片加载失败的回调 - 返回空数组
      img.onerror = () => {
        console.error('壁纸图片加载失败');
        resolve([]);
      };

      // 设置图片源，触发加载
      img.src = dataUrl;
    });
  }

  /**
   * 简化的 K-means 聚类算法
   *
   * 使用"最远点采样"选择初始中心（比纯随机更稳定）
   * 使用欧几里得距离衡量颜色相似度
   *
   * @param pixels - 所有有效像素的 RGB 颜色数组
   * @param k - 聚类数量（要提取的主色调数量）
   * @returns 聚类结果数组，每个元素包含聚类中心颜色和该聚类的像素数量
   */
  private kMeansClustering(
    pixels: [number, number, number][],
    k: number
  ): { center: [number, number, number]; count: number }[] {
    if (pixels.length <= k) {
      return pixels.map((p) => ({ center: p, count: 1 }));
    }

    // 使用"最远点采样"策略选择初始中心
    const centers: [number, number, number][] = [];

    // 第一个中心：随机选择一个像素
    const firstIndex = Math.floor(Math.random() * pixels.length);
    centers.push([...pixels[firstIndex]]);

    // 后续中心：选择离已有中心最远的像素
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

    // 迭代优化聚类
    let assignment = new Int32Array(pixels.length).fill(-1);

    for (let iter = 0; iter < K_MEANS_MAX_ITERATIONS; iter++) {
      let changed = false;

      // 将每个像素分配到最近的聚类中心
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

      // 算法收敛则提前退出
      if (!changed) {
        break;
      }

      // 重新计算每个聚类的中心
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

    // 生成最终聚类结果
    const clusterCounts = new Array(k).fill(0);
    for (let p = 0; p < pixels.length; p++) {
      if (assignment[p] >= 0 && assignment[p] < k) {
        clusterCounts[assignment[p]]++;
      }
    }

    const result: { center: [number, number, number]; count: number }[] = [];
    for (let c = 0; c < k; c++) {
      if (clusterCounts[c] > 0) {
        result.push({
          center: centers[c],
          count: clusterCounts[c],
        });
      }
    }

    return result;
  }

  /**
   * 计算两种颜色之间的欧几里得距离（平方）
   *
   * @param a - 第一种颜色的 RGB 值
   * @param b - 第二种颜色的 RGB 值
   * @returns 两种颜色的距离平方值
   */
  private colorDistance(
    a: [number, number, number],
    b: [number, number, number]
  ): number {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }

  /**
   * 根据文件路径推断图片的 MIME 类型
   *
   * @param filePath - 文件路径（包含扩展名）
   * @returns 对应的 MIME 类型字符串
   */
  private getMimeType(filePath: string): string {
    const lower = filePath.toLowerCase();

    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.bmp')) return 'image/bmp';
    if (lower.endsWith('.gif')) return 'image/gif';

    return 'image/png';
  }
}

/**
 * 壁纸服务单例
 * 整个应用共享同一个壁纸服务实例
 */
export const wallpaperService = new WallpaperService();
