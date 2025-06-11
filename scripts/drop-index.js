/**
 * 刪除 MongoDB 索引腳本
 * 用於修復唯一索引衝突問題
 */

const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

async function dropIndex() {
  console.log('開始連接到 MongoDB...');
  try {
    // 使用原生 MongoDB 客戶端
    const client = new MongoClient('mongodb://localhost:27017/');
    await client.connect();
    console.log('已連接到 MongoDB');

    // 獲取數據庫和集合
    const db = client.db('stickman-nft');
    const collection = db.collection('gameevents');
    
    // 檢查索引是否存在
    const indexes = await collection.indexes();
    console.log('現有索引:', indexes);
    
    // 尋找並刪除特定索引
    let indexFound = false;
    for (const index of indexes) {
      // 檢查是否是目標索引 (blockNumber_1_logIndex_1)
      if (index.key && index.key.blockNumber === 1 && index.key.logIndex === 1) {
        console.log('找到目標索引:', index.name);
        indexFound = true;
        
        // 刪除索引
        await collection.dropIndex(index.name);
        console.log(`成功刪除索引 ${index.name}`);
      }
    }
    
    if (!indexFound) {
      console.log('未找到目標索引');
    }
    
    await client.close();
    console.log('已關閉 MongoDB 連接');
  } catch (error) {
    console.error('刪除索引時發生錯誤:', error);
  } finally {
    process.exit(0);
  }
}

// 執行刪除索引操作
dropIndex();
