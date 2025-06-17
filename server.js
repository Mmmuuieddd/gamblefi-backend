/**
 * 區塊鏈博彩遊戲自動揭示服務
 * 專注於監聽鏈上的 BetPlaced 事件並在適當時機自動結算投注
 * 同時提供玩家遊戲記錄查詢功能
 */
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const mongoose = require('mongoose'); // 加入 mongoose 引入
const { getAutoRevealService } = require('./services');
const { connectToDatabase, monitorDatabaseConnection, closeDatabaseConnection } = require('./config/database');
const gameRecordRoutes = require('./routes/gameRecord');
const roomBetsRoutes = require('./routes/roomBets');

// 載入環境變量
dotenv.config();

// 初始化 Express 應用
const app = express();

// 設置中間件
app.use(express.json());
app.use(cors());

// 基本配置
const PORT = process.env.PORT || 3001;

// 註冊路由
app.use('/api/game-records', gameRecordRoutes);
app.use('/api/room-bets', roomBetsRoutes);

// 健康檢查 API
app.get('/health', async (req, res) => {
  try {
    const autoRevealService = getAutoRevealService();
    const dbConnected = mongoose.connection.readyState === 1;
    const wsHealthy = autoRevealService ? await autoRevealService.isWebSocketHealthy() : false;
    
    const isHealthy = dbConnected && wsHealthy;
    const status = isHealthy ? 200 : 503;
    
    const response = {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      service: 'gambling-auto-reveal-service',
      database: {
        connected: dbConnected,
        status: dbConnected ? 'connected' : 'disconnected'
      },
      websocket: {
        connected: wsHealthy,
        lastBlockTime: autoRevealService?.wsManager?.lastBlockTime 
          ? new Date(autoRevealService.wsManager.lastBlockTime).toISOString()
          : 'unknown',
        blockAge: autoRevealService?.wsManager?.lastBlockTime 
          ? Date.now() - autoRevealService.wsManager.lastBlockTime 
          : 'unknown',
        status: wsHealthy ? 'connected' : 'disconnected'
      }
    };

    // 只有在不健康時才記錄警告
    if (!isHealthy) {
      console.warn('健康檢查失敗:', JSON.stringify(response, null, 2));
    } else {
      // 健康時只記錄調試信息
      console.debug('健康檢查通過');
    }

    res.status(status).json(response);
  } catch (error) {
    console.error('健康檢查處理出錯:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 服務狀態 API
app.get('/status', (req, res) => {
  try {
    const autoRevealService = getAutoRevealService();
    
    // 檢查服務是否在運行
    const isRunning = autoRevealService && autoRevealService.isRunning;
    
    // 獲取待處理投注數量
    const pendingBetsCount = autoRevealService ? autoRevealService.pendingBets.size : 0;
    
    res.json({
      status: isRunning ? 'running' : 'stopped',
      pendingBets: pendingBetsCount,
      startTime: global.serviceStartTime,
      databaseConnected: mongoose.connection.readyState === 1
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 初始化服務
async function initializeServices() {
  try {
    // 連接資料庫
    console.log('正在連接資料庫...');
    const dbConnected = await connectToDatabase();
    if (!dbConnected) {
      console.error('資料庫連接失敗，服務可能無法正常運行');
    } else {
      // 監控資料庫連接狀態
      monitorDatabaseConnection();
    }
    
    // 初始化自動揭示服務
    console.log('正在初始化自動揭示服務...');
    const autoRevealService = getAutoRevealService();
    try {
      const initialized = await autoRevealService.initialize();
      
      if (initialized) {
        console.log('自動揭示服務已成功啟動');
        global.autoRevealService = autoRevealService;
        global.serviceStartTime = new Date().toISOString();
      } else {
        console.error('自動揭示服務初始化失敗');
      }
    } catch (serviceError) {
      console.error('自動揭示服務初始化過程中發生錯誤:', serviceError);
      console.warn('服務將以降級模式運行，某些功能可能不可用');
      // 儘管有錯誤，我們仍將其設置為全局變數以避免其他地方出錯
      global.autoRevealService = autoRevealService;
      global.serviceStartTime = new Date().toISOString();
    }
  } catch (error) {
    console.error('初始化服務時發生錯誤:', error);
  }
}

// 啟動服務器
app.listen(PORT, async () => {
  console.log(`伺服器運行在端口 ${PORT}`);
  await initializeServices();
});

// 處理程序關閉
process.on('SIGINT', async () => {
  console.log('收到關閉信號，正在停止服務...');
  
  if (global.autoRevealService) {
    await global.autoRevealService.stop();
  }
  
  // 關閉資料庫連接
  await closeDatabaseConnection();
  
  console.log('所有服務已停止，程序退出');
  process.exit(0);
});

// 處理未捕獲的異常
process.on('uncaughtException', (error) => {
  console.error('未捕獲的異常:', error);
  // 不退出進程，讓服務繼續運行
});

// 處理未處理的拒絕承諾
process.on('unhandledRejection', (reason, promise) => {
  console.error('未處理的拒絕承諾:', reason);
  // 不退出進程，讓服務繼續運行
});
