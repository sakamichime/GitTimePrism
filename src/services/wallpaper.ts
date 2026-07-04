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
  /** 蓝色通道值，范围 0-255 */
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
   * 3. 使用 Canvas 采样算法从图片中提取主色调
   * 4. 将壁纸数据和主色调数据保存到 localStorage
   * 5. 返回壁纸状态（包含数据 URL 和主色调列表）
   *
   * @returns 壁纸状态对象，如果用户取消选择则返回 null
   */
  async selectWallpaper(): Promise<WallpaperState | null> {
    // 第一步：打开文件选择对话框，筛选图片文件
    const selected = await open({
      // 允许的图片格式过滤条件
      filters: [
        {
          name: '图片文件', // 过滤器名称
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'], // 允许的文件扩展名
        },
      ],
      multiple: false, // 不允许多选，一次只能选一张图片
    });

    // 如果用户取消选择（点击了取消按钮或关闭对话框），返回 null
    if (!selected) {
      return null;
    }

    // Tauri dialog 的 open 返回值可能是 string 或 string[]
    // 因为 multiple: false，通常是 string，但需要兼容处理
    const filePath = typeof selected === 'string' ? selected : selected[0];
    if (!filePath) {
      return null;
    }

    // 第二步：读取图片文件为二进制数据
    // 使用 Tauri 的 fs 插件读取文件，返回 Uint8Array（字节数组）
    const fileBytes = await readFile(filePath);

    // 第三步：将字节数组转换为 base64 编码字符串
    // base64 是一种将二进制数据编码为文本字符串的方式，适合存储图片
    let base64 = '';
    // 将 Uint8Array 中的每个字节转为字符，拼接成二进制字符串
    // acc 是累加的字符串，byte 是当前字节的数值
    const binaryString = Array.from(fileBytes).reduce<string>(
      (acc: string, byte: number) => acc + String.fromCharCode(byte),
      ''
    );
    // 使用 btoa() 函数将二进制字符串编码为 base64 字符串
    base64 = btoa(binaryString);

    // 根据文件扩展名推断 MIME 类型，用于构建数据 URL
    const mimeType = this.getMimeType(filePath);
    // 构建完整的数据 URL（如 "data:image/png;base64,iVBORw0KGgo..."）
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // 第四步：从图片中提取主色调
    const dominantColors = this.extractColors(dataUrl);

    // 第五步：保存到 localStorage（浏览器本地存储）
    localStorage.setItem(STORAGE_KEY_WALLPAPER, dataUrl);
    localStorage.setItem(STORAGE_KEY_COLORS, JSON.stringify(dominantColors));

    // 返回壁纸状态
    return {
      dataUrl,
      dominantColors,
    };
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
    // 如果没有保存过壁纸，返回 null
    if (!dataUrl) {
      return null;
    }

    // 读取主色调数据（JSON 格式的字符串）
    const colorsJson = localStorage.getItem(STORAGE_KEY_COLORS);
    // 尝试解析 JSON，如果解析失败则使用空数组
    let dominantColors: DominantColor[] = [];
    if (colorsJson) {
      try {
        dominantColors = JSON.parse(colorsJson);
      } catch {
        // JSON 解析失败，说明存储数据损坏，使用空数组
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
   * 清除后，应用将使用默认的渐变背景。
   */
  clearWallpaper(): void {
    // 删除壁纸数据
    localStorage.removeItem(STORAGE_KEY_WALLPAPER);
    // 删除主色调数据
    localStorage.removeItem(STORAGE_KEY_COLORS);
  }

  /**
   * 从图片数据 URL 中提取主色调
   *
   * 使用 Canvas 采样 + 简化 K-means 聚类算法：
   * 1. 将图片绘制到 50x50 的小画布上（缩小采样，提高性能）
   * 2. 获取所有像素的颜色数据
   * 3. 过滤掉接近白色和接近黑色的极端像素
   * 4. 使用 K-means 聚类算法将相似颜色归为 5 组
   * 5. 每组的中心颜色就是主色调，按权重（该组像素数量占比）排序
   *
   * 这是一个私有方法，只在本类内部调用。
   *
   * @param dataUrl - 图片的 base64 数据 URL
   * @returns 主色调列表，按权重从高到低排序
   */
  private extractColors(dataUrl: string): DominantColor[] {
    // 创建一个离屏 Canvas 元素（不在页面上显示）
    const canvas = document.createElement('canvas');
    // 设置画布尺寸为采样尺寸（50x50）
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    // 获取 2D 绑定上下文，用于绘制图片和读取像素数据
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      // 如果获取上下文失败（极少见），返回空数组
      return [];
    }

    // 创建 Image 对象来加载图片
    const img = new Image();
    // 设置图片源为数据 URL
    img.src = dataUrl;

    // 注意：这里使用同步方式绘制图片
    // 因为 data URL 不需要网络请求，图片数据立即可用
    // 将图片绘制到画布上，自动缩放到 50x50
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    // 获取画布上所有像素的颜色数据
    // 返回一个 Uint8ClampedArray，每 4 个元素代表一个像素的 RGBA 值
    const imageData = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const pixels = imageData.data;

    // 收集有效的像素颜色（过滤极端颜色）
    const validPixels: [number, number, number][] = [];

    // 遍历所有像素
    for (let i = 0; i < pixels.length; i += 4) {
      // 获取当前像素的 RGB 值
      const r = pixels[i];     // 红色通道
      const g = pixels[i + 1]; // 绿色通道
      const b = pixels[i + 2]; // 蓝色通道
      // pixels[i + 3] 是透明度通道，这里不使用

      // 过滤掉接近纯黑或纯白的极端像素
      // 这些颜色通常不是壁纸的主色调
      const isTooDark = r < 15 && g < 15 && b < 15;   // 太暗（接近纯黑）
      const isTooBright = r > 240 && g > 240 && b > 240; // 太亮（接近纯白）

      // 只收集非极端的像素颜色
      if (!isTooDark && !isTooBright) {
        validPixels.push([r, g, b]);
      }
    }

    // 如果没有有效像素（整张图都是纯黑或纯白），返回空数组
    if (validPixels.length === 0) {
      return [];
    }

    // 使用 K-means 聚类算法提取主色调
    const clusters = this.kMeansClustering(validPixels, K_MEANS_K);

    // 计算总像素数（用于计算每种颜色的权重占比）
    const totalPixels = validPixels.length;

    // 将聚类结果转换为主色调数据
    const dominantColors: DominantColor[] = clusters.map((cluster) => ({
      r: Math.round(cluster.center[0]), // 聚类中心的红色分量，四舍五入取整
      g: Math.round(cluster.center[1]), // 聚类中心的绿色分量，四舍五入取整
      b: Math.round(cluster.center[2]), // 聚类中心的蓝色分量，四舍五入取整
      weight: cluster.count / totalPixels, // 该颜色占比 = 该聚类像素数 / 总像素数
    }));

    // 按权重从高到低排序（权重高的排前面，即最主要的颜色在最前面）
    dominantColors.sort((a, b) => b.weight - a.weight);

    return dominantColors;
  }

  /**
   * 简化的 K-means 聚类算法
   *
   * K-means 是一种常用的无监督聚类算法：
   * 1. 随机选择 K 个初始聚类中心
   * 2. 将每个像素分配到最近的聚类中心
   * 3. 重新计算每个聚类的中心（取该聚类所有像素的平均值）
   * 4. 重复步骤 2-3 直到聚类中心不再变化或达到最大迭代次数
   *
   * 简化版说明：
   * - 使用"最远点采样"选择初始中心（比纯随机更稳定）
   * - 使用欧几里得距离衡量颜色相似度
   * - 迭代次数有限，保证算法不会无限循环
   *
   * @param pixels - 所有有效像素的 RGB 颜色数组
   * @param k - 聚类数量（要提取的主色调数量）
   * @returns 聚类结果数组，每个元素包含聚类中心颜色和该聚类的像素数量
   */
  private kMeansClustering(
    pixels: [number, number, number][],
    k: number
  ): { center: [number, number, number]; count: number }[] {
    // 如果像素数量少于聚类数，直接返回每个像素作为一个聚类
    if (pixels.length <= k) {
      return pixels.map((p) => ({ center: p, count: 1 }));
    }

    // ---- 第一步：初始化聚类中心 ----
    // 使用"最远点采样"策略选择初始中心，比纯随机更稳定
    const centers: [number, number, number][] = [];

    // 第一个中心：随机选择一个像素
    const firstIndex = Math.floor(Math.random() * pixels.length);
    centers.push([...pixels[firstIndex]]);

    // 后续中心：选择离已有中心最远的像素
    for (let i = 1; i < k; i++) {
      let maxDistance = -1;    // 最大距离
      let maxDistanceIdx = 0;  // 最大距离对应的像素索引

      // 遍历所有像素，找到离已有中心最远的像素
      for (let p = 0; p < pixels.length; p++) {
        // 计算当前像素到所有已有中心的最小距离
        let minDistToCenters = Infinity;
        for (const center of centers) {
          const dist = this.colorDistance(pixels[p], center);
          if (dist < minDistToCenters) {
            minDistToCenters = dist;
          }
        }
        // 如果这个像素离已有中心的最小距离更大，选它作为候选
        if (minDistToCenters > maxDistance) {
          maxDistance = minDistToCenters;
          maxDistanceIdx = p;
        }
      }

      // 将离已有中心最远的像素添加为新的中心
      centers.push([...pixels[maxDistanceIdx]]);
    }

    // ---- 第二步：迭代优化聚类 ----
    // assignment 数组记录每个像素属于哪个聚类（聚类的索引号）
    let assignment = new Int32Array(pixels.length).fill(-1);

    for (let iter = 0; iter < K_MEANS_MAX_ITERATIONS; iter++) {
      // 标记本轮是否有像素改变了归属
      let changed = false;

      // 将每个像素分配到最近的聚类中心
      for (let p = 0; p < pixels.length; p++) {
        let minDist = Infinity;  // 到最近中心的距离
        let bestCluster = 0;     // 最近中心的索引

        // 遍历所有聚类中心，找最近的
        for (let c = 0; c < centers.length; c++) {
          const dist = this.colorDistance(pixels[p], centers[c]);
          if (dist < minDist) {
            minDist = dist;
            bestCluster = c;
          }
        }

        // 如果这个像素的归属发生了变化，标记 changed 为 true
        if (assignment[p] !== bestCluster) {
          assignment[p] = bestCluster;
          changed = true;
        }
      }

      // 如果没有像素改变归属，说明算法已经收敛，提前退出
      if (!changed) {
        break;
      }

      // 重新计算每个聚类的中心（取该聚类所有像素颜色的平均值）
      for (let c = 0; c < centers.length; c++) {
        let sumR = 0, sumG = 0, sumB = 0, count = 0;

        // 累加该聚类中所有像素的 RGB 值
        for (let p = 0; p < pixels.length; p++) {
          if (assignment[p] === c) {
            sumR += pixels[p][0];
            sumG += pixels[p][1];
            sumB += pixels[p][2];
            count++;
          }
        }

        // 如果该聚类有像素，更新中心为平均值
        if (count > 0) {
          centers[c] = [
            sumR / count, // 红色平均值
            sumG / count, // 绿色平均值
            sumB / count, // 蓝色平均值
          ];
        }
      }
    }

    // ---- 第三步：生成最终聚类结果 ----
    // 统计每个聚类的像素数量
    const clusterCounts = new Array(k).fill(0);
    for (let p = 0; p < pixels.length; p++) {
      if (assignment[p] >= 0 && assignment[p] < k) {
        clusterCounts[assignment[p]]++;
      }
    }

    // 构建结果数组
    const result: { center: [number, number, number]; count: number }[] = [];
    for (let c = 0; c < k; c++) {
      // 过滤掉像素数量为 0 的空聚类
      if (clusterCounts[c] > 0) {
        result.push({
          center: centers[c],     // 聚类中心颜色
          count: clusterCounts[c], // 该聚类的像素数量
        });
      }
    }

    return result;
  }

  /**
   * 计算两种颜色之间的欧几里得距离
   *
   * 距离越小表示两种颜色越相似。
   * 使用 RGB 三维空间中的直线距离公式：
   * distance = √((r1-r2)² + (g1-g2)² + (b1-b2)²)
   *
   * 为了性能优化，省略了开平方运算（开方不影响距离大小比较的结果）。
   *
   * @param a - 第一种颜色的 RGB 值
   * @param b - 第二种颜色的 RGB 值
   * @returns 两种颜色的距离平方值（省略开方）
   */
  private colorDistance(
    a: [number, number, number],
    b: [number, number, number]
  ): number {
    const dr = a[0] - b[0]; // 红色差值
    const dg = a[1] - b[1]; // 绿色差值
    const db = a[2] - b[2]; // 蓝色差值
    // 返回距离的平方（省略 Math.sqrt 以提高性能）
    return dr * dr + dg * dg + db * db;
  }

  /**
   * 根据文件路径推断图片的 MIME 类型
   *
   * MIME 类型用于构建数据 URL 的前缀（如 "data:image/png;base64,..."），
   * 告诉浏览器这是什么格式的图片。
   *
   * @param filePath - 文件路径（包含扩展名）
   * @returns 对应的 MIME 类型字符串
   */
  private getMimeType(filePath: string): string {
    // 将文件路径转为小写，方便匹配（不区分大小写）
    const lower = filePath.toLowerCase();

    // 根据文件扩展名返回对应的 MIME 类型
    if (lower.endsWith('.png')) return 'image/png';           // PNG 格式
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'; // JPEG 格式
    if (lower.endsWith('.webp')) return 'image/webp';         // WebP 格式
    if (lower.endsWith('.bmp')) return 'image/bmp';           // BMP 格式
    if (lower.endsWith('.gif')) return 'image/gif';           // GIF 格式

    // 默认使用 PNG 类型（大多数壁纸都是 PNG 格式）
    return 'image/png';
  }
}

/**
 * 壁纸服务单例
 * 整个应用共享同一个壁纸服务实例，确保状态一致
 */
export const wallpaperService = new WallpaperService();
