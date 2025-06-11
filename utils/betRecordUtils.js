/**
 * 投注記錄工具
 * 負責保存投注和結算記錄到JSON文件
 */
const fs = require('fs').promises;
const path = require('path');
const { ethers } = require('ethers');

/**
 * 確保目錄存在，不存在則創建
 * @param {string} dirPath - 目錄路徑
 */
const ensureDirectoryExists = async (dirPath) => {
  try {
    await fs.access(dirPath);
  } catch (error) {
    await fs.mkdir(dirPath, { recursive: true });
    console.log(`創建目錄: ${dirPath}`);
  }
};

/**
 * 格式化地址為統一的小寫形式
 * @param {string} address - 區塊鏈地址
 * @returns {string} - 格式化後的地址
 */
const formatAddress = (address) => {
  if (!address || typeof address !== 'string') return '';
  
  try {
    // 轉換為校驗和地址格式
    const checkSumAddress = ethers.getAddress(address);
    return checkSumAddress.toLowerCase();
  } catch (error) {
    console.error(`地址格式化失敗: ${address}`, error);
    return address.toLowerCase();
  }
};

/**
 * 格式化時間為易讀的形式
 * @param {string|Date} timestamp - 時間戳
 * @returns {string} - 格式化後的時間字符串
 */
const formatTime = (timestamp) => {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  const amPm = date.getHours() >= 12 ? '下午' : '上午';
  
  return `${year}/${month}/${day} ${amPm}${hours}:${minutes}:${seconds}`;
};

/**
 * 記錄投注事件
 * @param {Object} betEvent - 投注事件數據
 * @returns {Promise<string>} - 保存的文件路徑
 */
const recordBetPlaced = async (betEvent) => {
  try {
    if (!betEvent) {
      console.error('投注事件為空');
      return null;
    }
    
    if (!betEvent.player || !betEvent.transactionHash) {
      console.error('投注事件缺少關鍵數據: player 或 transactionHash');
      console.log('收到的數據:', betEvent);
      return null;
    }
    
    // 準備記錄數據
    const betAmount = ethers.formatEther(betEvent.amount || '0');
    const timestamp = new Date();
    const isoTimestamp = timestamp.toISOString();
    const formattedTime = formatTime(timestamp);
    
    const playerAddress = betEvent.player;
    const playerAddressLowerCase = formatAddress(playerAddress);
    const txShortHash = betEvent.transactionHash.substring(0, 8);
    
    // 創建記錄對象
    const betRecord = {
      roomId: Number(betEvent.roomId || 0),
      playerAddress,
      playerAddressLowerCase,
      timestamp: isoTimestamp,
      formattedTime,
      betAmount,
      betBig: betEvent.betBig,
      betChoice: betEvent.betBig ? '大' : '小',
      transactionHash: betEvent.transactionHash,
      blockNumber: Number(betEvent.blockNumber || 0),
      commitBlock: Number(betEvent.commitBlock || 0),
      revealBlock: Number(betEvent.revealBlock || 0),
      eventType: 'BetPlaced'
    };
    
    // 如果有關聯的MongoDB記錄ID，添加它
    if (betEvent._id) {
      betRecord.id = betEvent._id.toString();
    }
    
    // 確保記錄目錄存在
    const baseDir = path.join(__dirname, '..', 'DATA');
    await ensureDirectoryExists(baseDir);
    
    // 為每個玩家創建單獨的目錄
    const playerDir = path.join(baseDir, playerAddress);
    await ensureDirectoryExists(playerDir);
    
    // 命名格式: bet_YYYY-MM-DD_HH-MM-SS_txHash前8位.json
    const now = Date.now();
    const filename = `bet_${now}_${txShortHash}.json`;
    const filePath = path.join(playerDir, filename);
    
    // 保存記錄到文件
    await fs.writeFile(filePath, JSON.stringify(betRecord, null, 2), 'utf8');
    console.log(`已保存投注記錄至: ${filePath}`);
    
    return filePath;
  } catch (error) {
    console.error('記錄投注事件時發生錯誤:', error);
    return null;
  }
};

/**
 * 記錄結算事件，並與投注事件關聯
 * @param {Object} settledEvent - 結算事件數據
 * @param {Object} originalBetEvent - 原始投注事件數據（可選）
 * @returns {Promise<string>} - 保存的文件路徑
 */
const recordBetSettled = async (settledEvent, originalBetEvent = null) => {
  try {
    if (!settledEvent) {
      console.error('結算事件為空');
      return null;
    }
    
    if (!settledEvent.player || !settledEvent.transactionHash) {
      console.error('結算事件缺少關鍵數據: player 或 transactionHash');
      console.log('收到的數據:', settledEvent);
      return null;
    }
    
    const playerAddress = settledEvent.player;
    const playerAddressLowerCase = formatAddress(playerAddress);
    
    // 準備記錄數據
    const timestamp = new Date();
    const isoTimestamp = timestamp.toISOString();
    const formattedTime = formatTime(timestamp);
    const txShortHash = settledEvent.transactionHash.substring(0, 8);
    
    // 獲取金額
    let betAmount = '0';
    let rewardAmount = '0';
    let betBig = null;
    let betChoice = '不明';
    
    // 如果有原始投注數據，使用它
    if (originalBetEvent) {
      // 檢查 amount 是否已經是字串格式
      if (typeof originalBetEvent.amount === 'string' && originalBetEvent.amount.includes('.')) {
        betAmount = originalBetEvent.amount; // 已經是格式化後的字串，直接使用
      } else {
        betAmount = ethers.formatEther(originalBetEvent.amount || '0');
      }
      betBig = originalBetEvent.betBig;
      betChoice = originalBetEvent.betBig ? '大' : '小';
    }
    
    // 格式化獎勵金額 - 優先使用 rewardAmount 字段，因為這是已經計算好的獎勵金額
    if (settledEvent.rewardAmount) {
      console.log(`使用 settledEvent.rewardAmount: ${settledEvent.rewardAmount}`);
      if (typeof settledEvent.rewardAmount === 'string' && settledEvent.rewardAmount.includes('.')) {
        rewardAmount = settledEvent.rewardAmount; // 已經是格式化後的字串，直接使用
      } else {
        rewardAmount = ethers.formatEther(settledEvent.rewardAmount);
      }
    } else if (settledEvent.amount) {
      console.log(`使用 settledEvent.amount: ${settledEvent.amount}`);
      // 檢查金額是否已經是字串格式
      if (typeof settledEvent.amount === 'string' && settledEvent.amount.includes('.')) {
        rewardAmount = settledEvent.amount; // 已經是格式化後的字串，直接使用
      } else {
        rewardAmount = ethers.formatEther(settledEvent.amount);
      }
    }
    console.log(`最終獎勵金額: ${rewardAmount}`);

    
    // 轉換哈希值為數字結果
    const hashValue = Number(settledEvent.hashValue || 0);
    const isSmall = hashValue < 5;  // 0-4 為小，5-9 為大
    const hashValueText = `${hashValue}(${isSmall ? '小' : '大'})`;
    
    // 創建統合記錄對象，結合投注和結算信息
    const settledRecord = {
      id: settledEvent._id ? settledEvent._id.toString() : undefined,
      roomId: Number(settledEvent.roomId || 0),
      playerAddress,
      playerAddressLowerCase,
      timestamp: isoTimestamp,
      formattedTime,
      betAmount,
      betBig,
      betChoice,
      won: settledEvent.won,
      result: settledEvent.won ? '贏' : '輸',
      rewardAmount,
      hashValue,
      hashValueText,
      transactionHash: settledEvent.transactionHash,
      blockHash: settledEvent.blockHash,
      blockNumber: Number(settledEvent.blockNumber || 0),
      resultBlock: Number(settledEvent.resultBlock || 0),
      eventType: 'BetSettled',
      betId: settledEvent.betId
    };
    
    // 如果有關聯的投注事件ID，添加它
    if (originalBetEvent && originalBetEvent._id) {
      settledRecord.relatedEventId = originalBetEvent._id.toString();
    }
    
    // 確保記錄目錄存在
    const baseDir = path.join(__dirname, '..', 'DATA');
    await ensureDirectoryExists(baseDir);
    
    // 為每個玩家創建單獨的目錄
    const playerDir = path.join(baseDir, playerAddress);
    await ensureDirectoryExists(playerDir);
    
    // 先檢查該交易是否已經存在JSON檔案，避免重複生成
    // 取得當前資料夾中的所有檔案
    let existingFiles;
    try {
      existingFiles = await fs.readdir(playerDir);
    } catch (err) {
      existingFiles = [];
      console.log(`讀取玩家目錄失敗，假設為空目錄: ${err.message}`);
    }
    
    // 檢查是否已有相同交易哈希的檔案
    const existingFile = existingFiles.find(file => file.includes(txShortHash));
    if (existingFile) {
      console.log(`跳過重複的結算事件記錄，交易哈希已存在: ${txShortHash}`);
      const existingPath = path.join(playerDir, existingFile);
      return existingPath; // 返回已存在的檔案路徑
    }
    
    // 如果沒有重複，則生成新的JSON檔案
    const now = Date.now();
    const filename = `bet_${now}_${txShortHash}.json`;
    const filePath = path.join(playerDir, filename);
    
    // 保存記錄到文件
    await fs.writeFile(filePath, JSON.stringify(settledRecord, null, 2), 'utf8');
    console.log(`已保存結算記錄至: ${filePath}`);
    
    return filePath;
  } catch (error) {
    console.error('記錄結算事件時發生錯誤:', error);
    return null;
  }
};

// 恢復在投注階段記錄JSON
module.exports = {
  recordBetPlaced,
  recordBetSettled,
  formatTime,
  formatAddress,
  ensureDirectoryExists
};
