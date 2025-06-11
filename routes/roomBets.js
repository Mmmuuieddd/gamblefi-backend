/**
 * 房間投注記錄 API 路由
 */
const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const GameEvent = require('../models/GameEvent');

/**
 * 獲取特定房間的投注記錄
 * GET /api/room-bets?roomId=123
 */
router.get('/', async (req, res) => {
  try {
    const { roomId } = req.query;
    const { page = 1, limit = 1000 } = req.query;
    
    // 驗證房間ID
    if (!roomId || isNaN(parseInt(roomId))) {
      return res.status(400).json({ error: '需要提供有效的房間ID' });
    }
    
    console.log(`接收到房間${roomId}的投注記錄請求`);
    
    // 构建查詢條件 - 查詢已結算的投注
    // 同時查詢 BetSettled 和 GameResult 兩種事件
    const settledQuery = {
      roomId: parseInt(roomId),
      $or: [
        { eventType: 'BetSettled' },
        { eventType: 'GameResult' }
      ]
    };
    
    // 計算分頁
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const pageLimit = parseInt(limit);
    
    // 查詢該房間的所有已結算投注
    const records = await GameEvent.find(settledQuery)
      .sort({ blockNumber: -1, logIndex: -1 })
      .skip(skip)
      .limit(pageLimit);
      
    console.log(`找到房間${roomId}的投注記錄數量: ${records.length}`);
    
    // 獲取記錄總數
    const total = await GameEvent.countDocuments(settledQuery);
    
    // 查詢對應的 BetPlaced 事件以獲取原始投注信息
    const recordIds = records.map(r => r.relatedEventId).filter(id => id);
    const placedEvents = await GameEvent.find({
      _id: { $in: recordIds },
      eventType: 'BetPlaced'
    });
    
    // 建立 ID 映射以快速查找
    const placedEventsMap = {};
    placedEvents.forEach(pe => {
      placedEventsMap[pe._id.toString()] = pe;
    });
    
    // 格式化結果
    const bets = [];
    
    for (const record of records) {
      try {
        // 查詢對應的 BetPlaced 事件
        let placedEvent = null;
        if (record.relatedEventId) {
          placedEvent = placedEventsMap[record.relatedEventId.toString()];
        }
        
        // 獲取原始投注金額和選擇
        let betAmount = '0.001';
        let betBig = record.betBig; // 預設使用 BetSettled 事件的數據
        
        if (placedEvent && placedEvent.amount) {
          try {
            if (typeof placedEvent.amount === 'string' && placedEvent.amount.startsWith('0x')) {
              betAmount = ethers.formatEther(placedEvent.amount);
            } else if (typeof placedEvent.amount === 'string') {
              betAmount = placedEvent.amount;
            } else if (typeof placedEvent.amount === 'number') {
              betAmount = placedEvent.amount.toString();
            }
            
            // 使用 BetPlaced 事件的投注方向
            betBig = placedEvent.betBig;
            console.log(`房間${roomId}記錄: 使用 BetPlaced 事件投注方向: ${betBig ? '大' : '小'}, 金額: ${betAmount}`);
          } catch (error) {
            console.error('處理 BetPlaced 事件數據失敗:', error);
          }
        } else if (record.amount) {
          try {
            if (typeof record.amount === 'string' && record.amount.startsWith('0x')) {
              betAmount = ethers.formatEther(record.amount);
            } else if (typeof record.amount === 'string') {
              betAmount = record.amount;
            } else if (typeof record.amount === 'number') {
              betAmount = record.amount.toString();
            }
            console.log(`房間${roomId}記錄: 使用 BetSettled 事件金額: ${betAmount}`);
          } catch (error) {
            console.error('轉換投注金額失敗:', error);
          }
        }
        
        // 哈希值結果和輸贏判斷
        const resultBig = record.hashValue >= 5;
        const playerWon = record.won !== undefined ? record.won : null;
        
        bets.push({
          id: record._id.toString(),
          betId: record.betId || '',
          playerAddress: record.player,
          betAmount: betAmount,
          betBig: betBig,
          playerWon: playerWon,
          resultValue: record.hashValue,
          resultBig: resultBig,
          timestamp: record.createdAt,
          formattedTime: new Date(record.createdAt).toLocaleString('zh-TW'),
          txHash: record.transactionHash,
          revealBlock: record.revealBlock || record.resultBlock || 0
        });
      } catch (recordError) {
        console.error(`處理房間${roomId}的投注記錄時出錯:`, recordError);
        // 繼續處理下一條記錄
      }
    }
    
    console.log(`成功返回房間${roomId}的${bets.length}條投注記錄`);
    
    res.json({
      bets,
      total,
      page: parseInt(page),
      limit: pageLimit,
      pages: Math.ceil(total / pageLimit)
    });
    
  } catch (err) {
    console.error('獲取房間投注記錄失敗:', err);
    res.status(500).json({ error: '獲取房間投注記錄失敗', message: err.message });
  }
});

module.exports = router;
