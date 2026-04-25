// 导入Node.js文件系统Promise API
import fs from "node:fs/promises";

/**
 * 读取JSON格式文件
 * @param {string} path 文件路径
 * @returns {Object} 解析后的JSON对象
 */
export async function readJsonFile(path) {
  // 读取文件内容，编码为UTF-8
  const content = await fs.readFile(path, "utf8");
  // 解析JSON并返回
  return JSON.parse(content);
}

/**
 * 读取JSON Lines格式文件（每行一个JSON对象）
 * @param {string} path 文件路径
 * @returns {Array} 解析后的对象数组
 */
export async function readJsonLines(path) {
  // 读取文件内容，编码为UTF-8
  const content = await fs.readFile(path, "utf8");
  // 按行拆分，去除空行，逐行解析JSON
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
